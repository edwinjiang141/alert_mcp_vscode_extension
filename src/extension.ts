import * as vscode from 'vscode';
import { promptAndStoreLlmApiKey, promptAndStoreMcpToken } from './commands/commandHelpers';
import { AssistantOrchestrator } from './orchestration/assistantOrchestrator';
import { SecretStorageService } from './services/secretStorageService';
import { SettingsService } from './services/settingsService';
import { McpClientService } from './services/mcp/mcpClientService';
import { ChatPanel } from './views/chatPanel';
import { OpsSidebarProvider } from './views/opsSidebarProvider';
import { SettingsPanel } from './views/settingsPanel';
import type { ChatTurn } from './types/appTypes';

interface AskMessagePayload {
  question: string;
  preferredTools?: string[];
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('OEM Assistant');
  const settingsService = new SettingsService();
  const secrets = new SecretStorageService(context);
  const mcpService = new McpClientService(output, secrets);
  const sidebar = new OpsSidebarProvider(mcpService, settingsService);
  const treeView = vscode.window.createTreeView('alertMcp.sidebar', {
    treeDataProvider: sidebar
  });

  context.subscriptions.push(output, treeView);

  let panel: ChatPanel | undefined;
  let panelMessageDisposable: vscode.Disposable | undefined;
  const sessionContext: ChatTurn[] = [];
  const MAX_SESSION_CONTEXT_CHARS = 128 * 1024;
  let oemSessionId: string | undefined;

  const trimSessionContext = (): void => {
    let total = sessionContext.reduce((sum, turn) => sum + turn.content.length, 0);
    while (total > MAX_SESSION_CONTEXT_CHARS && sessionContext.length > 2) {
      const removed = sessionContext.shift();
      total -= removed?.content.length ?? 0;
    }
  };

  const pushSessionTurn = (turn: ChatTurn): void => {
    sessionContext.push(turn);
    trimSessionContext();
  };

  const syncPanelToolCatalog = (): void => {
    if (!panel) {
      return;
    }
    panel.postToolCatalog(
      mcpService.getCachedTools().map(tool => ({
        name: tool.name,
        description: tool.description ?? 'No description from MCP server.'
      }))
    );
  };

  const connectMcp = async (): Promise<void> => {
    const settings = settingsService.get();
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Connecting MCP server...'
      },
      async () => {
        await mcpService.connect(settings);
      }
    );

    sidebar.refresh();
    syncPanelToolCatalog();
    openPanel().postInfo(`MCP connected: ${mcpService.getConnectedUrl() ?? settings.mcp.serverUrl}`);
    vscode.window.showInformationMessage('MCP server connected.');
  };

  const askAssistant = async (payload?: string | AskMessagePayload): Promise<void> => {
    const currentPanel = openPanel();

    const parsedPayload: AskMessagePayload | undefined = typeof payload === 'string'
      ? { question: payload }
      : payload;

    const userQuestion = parsedPayload?.question ?? await vscode.window.showInputBox({
      prompt: 'Ask the alert assistant',
      placeHolder: '例如：@ask_ops 查询最近2小时所有P1告警，并给出处置建议'
    });

    if (!userQuestion) {
      return;
    }

    const settings = settingsService.get();
    const orchestrator = new AssistantOrchestrator(settings, secrets, mcpService, output);

    try {
      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Running alert assistant...'
        },
        async () => orchestrator.ask(userQuestion, sessionContext, {
          preferredTools: parsedPayload?.preferredTools ?? [],
          oemSessionId
        })
      );

      currentPanel.postAssistantResult(userQuestion, result);
      pushSessionTurn({ role: 'user', content: userQuestion });
      pushSessionTurn({ role: 'assistant', content: result.finalText });
      oemSessionId = extractSessionId(result.finalText) ?? extractSessionId(result.steps.map(step => step.detail).join('\n')) ?? oemSessionId;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output.appendLine(`[ERROR] ${message}`);
      currentPanel.postInfo(message);
      vscode.window.showErrorMessage(message);
    }
  };

  const openPanel = (): ChatPanel => {
    panel = ChatPanel.createOrShow(context);

    panelMessageDisposable?.dispose();
    panelMessageDisposable = panel.onDidReceiveMessage(async message => {
      if (message.type === 'connect') {
        await connectMcp();
        return;
      }
      if (message.type === 'ask') {
        await askAssistant(message.payload);
      }
    });
    context.subscriptions.push(panelMessageDisposable);
    syncPanelToolCatalog();

    return panel;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('alertMcp.openConsole', () => {
      openPanel();
    }),
    vscode.commands.registerCommand('alertMcp.connectMcp', connectMcp),
    vscode.commands.registerCommand('alertMcp.disconnectMcp', async () => {
      await mcpService.disconnect();
      sessionContext.length = 0;
      oemSessionId = undefined;
      sidebar.refresh();
      syncPanelToolCatalog();
      vscode.window.showInformationMessage('MCP server disconnected.');
    }),
    vscode.commands.registerCommand('alertMcp.askAssistant', askAssistant),
    vscode.commands.registerCommand('alertMcp.showToolDescription', async (toolName: string, toolDescription: string) => {
      const safeDescription = toolDescription || 'No description from MCP server.';
      vscode.window.showInformationMessage(`${toolName}: ${safeDescription}`);
      const currentPanel = openPanel();
      currentPanel.postInfo(`Tool: ${toolName}\n${safeDescription}`);
    }),
    vscode.commands.registerCommand('alertMcp.openSettings', async () => {
      await SettingsPanel.createOrShow(context, settingsService, secrets);
    }),
    vscode.commands.registerCommand('alertMcp.setLlmApiKey', async () => {
      await promptAndStoreLlmApiKey(secrets);
    }),
    vscode.commands.registerCommand('alertMcp.setMcpBearerToken', async () => {
      await promptAndStoreMcpToken(secrets);
    }),
    vscode.commands.registerCommand('alertMcp.refreshSidebar', async () => {
      if (mcpService.isConnected()) {
        await mcpService.refreshTools();
      }
      sidebar.refresh();
      syncPanelToolCatalog();
    }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('alertMcp')) {
        sidebar.refresh();
      }
    }),
    {
      dispose: () => {
        void mcpService.disconnect();
      }
    }
  );
}

function extractSessionId(text: string): string | undefined {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const direct = parsed.session_id ?? parsed.sessionId;
    if (typeof direct === 'string' && direct.trim()) {
      return direct.trim();
    }
  } catch {
    // ignore parse errors and fallback to regex
  }

  const match = /"session_id"\s*:\s*"([^"]+)"/i.exec(text);
  return match?.[1];
}
