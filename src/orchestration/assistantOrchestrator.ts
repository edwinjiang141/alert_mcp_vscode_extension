import * as vscode from 'vscode';
import type {
  AssistantResult,
  ChatTurn,
  ExecutionStep,
  OpenAiCompatibleTool
} from '../types/appTypes';
import type { ExtensionSettings } from '../types/appTypes';
import { SecretStorageService } from '../services/secretStorageService';
import { OpenAiCompatibleLlmService } from '../services/llm/openAiCompatibleLlmService';
import { McpClientService } from '../services/mcp/mcpClientService';

export class AssistantOrchestrator {
  constructor(
    private readonly settings: ExtensionSettings,
    private readonly secrets: SecretStorageService,
    private readonly mcp: McpClientService,
    private readonly output: vscode.OutputChannel
  ) {}

  async ask(userText: string): Promise<AssistantResult> {
    if (!this.mcp.isConnected()) {
      throw new Error('MCP server is not connected. Please connect first.');
    }

    if (this.settings.llm.provider === 'copilot') {
      throw new Error('Copilot mode is reserved for a later version. Use openai-compatible for the MVP.');
    }

    const apiKey = await this.secrets.getLlmApiKey();
    if (!apiKey) {
      throw new Error('LLM API key is not configured. Run: Alert MCP: Set LLM API Key');
    }

    const llm = new OpenAiCompatibleLlmService(
      this.settings.llm.baseUrl,
      apiKey,
      this.settings.llm.model,
      this.settings.llm.temperature
    );

    const tools = this.mcp.getCachedTools();
    const toolSpecs: OpenAiCompatibleTool[] = tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description ?? 'MCP tool',
        parameters: ((tool as any).inputSchema as Record<string, unknown>) ?? {
          type: 'object',
          properties: {}
        }
      }
    }));

    const oemPassword = await this.secrets.getOemPassword();
    const hasOemCredentials = Boolean(this.settings.oem.baseUrl && this.settings.oem.username && oemPassword);

    const systemPrompt = [
      'You are a focused alert operations assistant.',
      'Use MCP tools when you need live alert data or operational actions.',
      'For destructive or risky actions, explain intent clearly before taking action.',
      'Never expose secrets, passwords, tokens, usernames, or private endpoints in your final response.',
      hasOemCredentials
        ? 'OEM credentials are already configured in extension settings. For OEM login requests, call login tool directly without asking credentials again.'
        : 'OEM credentials are incomplete. If login is requested, ask user to complete OEM settings first.',
      this.mcp.getInstructions()
    ].filter(Boolean).join('\n\n');

    const shouldForceOemLogin = this.shouldForceOemLoginFirst(userText, tools.map(tool => tool.name));
    const normalizedUserText = shouldForceOemLogin
      ? `${userText}\n\n请先调用 OEM 登录工具完成会话建立，然后再继续后续任务，不要重复要求用户输入 OEM 账号密码。`
      : userText;

    const steps: ExecutionStep[] = [];
    const messages: ChatTurn[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: normalizedUserText }
    ];

    for (let round = 0; round < this.settings.ui.maxToolRounds; round += 1) {
      const llmReply = await llm.complete(messages, toolSpecs);
      this.output.appendLine(`[LLM] round=${round + 1} tool_calls=${llmReply.tool_calls?.length ?? 0}`);

      messages.push({
        role: 'assistant',
        content: llmReply.content ?? '',
        tool_calls: llmReply.tool_calls
      });

      if (!llmReply.tool_calls || llmReply.tool_calls.length === 0) {
        steps.push({
          type: 'info',
          title: 'Final answer',
          detail: this.redactSensitiveText(llmReply.content ?? '(empty response)')
        });
        return {
          finalText: this.redactSensitiveText(llmReply.content ?? '(empty response)'),
          steps
        };
      }

      for (const toolCall of llmReply.tool_calls) {
        const toolName = toolCall.function.name;
        const rawArgs = toolCall.function.arguments || '{}';
        let parsedArgs: Record<string, unknown>;

        try {
          parsedArgs = JSON.parse(rawArgs);
        } catch {
          parsedArgs = { raw: rawArgs };
        }

        const resolvedArgs = this.resolveToolArgs(toolName, parsedArgs, {
          oemBaseUrl: this.settings.oem.baseUrl,
          oemUsername: this.settings.oem.username,
          oemPassword
        });

        steps.push({
          type: 'tool-call',
          title: `Tool call: ${toolName}`,
          detail: this.redactSensitiveText(JSON.stringify(resolvedArgs, null, 2))
        });

        const toolResult = await this.mcp.callTool(toolName, resolvedArgs);
        steps.push({
          type: 'tool-result',
          title: `Tool result: ${toolName}`,
          detail: this.redactSensitiveText(toolResult)
        });

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolName,
          content: this.redactSensitiveText(toolResult)
        });
      }
    }

    const overflowMessage = 'Tool round limit reached. Please refine the question or reduce tool chaining.';
    steps.push({
      type: 'error',
      title: 'Stopped',
      detail: overflowMessage
    });

    return {
      finalText: overflowMessage,
      steps
    };
  }

  private shouldForceOemLoginFirst(userText: string, toolNames: string[]): boolean {
    const normalized = userText.toLowerCase();
    const isLoginIntent =
      normalized.includes('登录oem') ||
      normalized.includes('登陆oem') ||
      normalized.includes('login oem') ||
      normalized.includes('oem login');

    if (!isLoginIntent) {
      return false;
    }

    return toolNames.some(name => /oem.*login|login.*oem/i.test(name));
  }

  private resolveToolArgs(
    toolName: string,
    args: Record<string, unknown>,
    creds: { oemBaseUrl: string; oemUsername: string; oemPassword: string | undefined }
  ): Record<string, unknown> {
    if (!/oem.*login|login.*oem/i.test(toolName)) {
      return args;
    }

    const updated = { ...args };
    if (creds.oemBaseUrl) {
      updated.oem_base_url = creds.oemBaseUrl;
      updated.base_url = creds.oemBaseUrl;
      updated.baseUrl = creds.oemBaseUrl;
    }
    if (creds.oemUsername) {
      updated.username = creds.oemUsername;
      updated.user = creds.oemUsername;
      updated.account = creds.oemUsername;
    }
    if (creds.oemPassword) {
      updated.password = creds.oemPassword;
      updated.pass = creds.oemPassword;
      updated.pwd = creds.oemPassword;
    }

    return updated;
  }

  private redactSensitiveText(input: string): string {
    return input
      .replace(/(password\s*[=:]\s*)([^\s,\n]+)/gi, '$1***')
      .replace(/(密码\s*[：:=]\s*)([^\s,\n]+)/g, '$1***')
      .replace(/(username\s*[=:]\s*)([^\s,\n]+)/gi, '$1***')
      .replace(/(用户名\s*[：:=]\s*)([^\s,\n]+)/g, '$1***')
      .replace(/(https?:\/\/[^\s]*\/em\/api)/gi, '[OEM_API_REDACTED]');
  }
}
