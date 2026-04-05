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

interface AskOptions {
  preferredTools?: string[];
}

export class AssistantOrchestrator {
  constructor(
    private readonly settings: ExtensionSettings,
    private readonly secrets: SecretStorageService,
    private readonly mcp: McpClientService,
    private readonly output: vscode.OutputChannel
  ) {}

  async ask(userText: string, conversationContext: ChatTurn[] = [], options: AskOptions = {}): Promise<AssistantResult> {
    if (!this.mcp.isConnected()) {
      throw new Error('MCP server is not connected. Please connect first.');
    }

    if (this.settings.llm.provider === 'copilot') {
      throw new Error('Copilot mode is reserved for a later version. Use openai-compatible for the MVP.');
    }

    const allTools = this.mcp.getCachedTools();
    const allToolNames = allTools.map(tool => tool.name);
    const preferredToolNames = this.normalizePreferredTools(options.preferredTools, allToolNames);
    const activeTools = preferredToolNames.length > 0
      ? allTools.filter(tool => preferredToolNames.includes(tool.name))
      : allTools;

    const oemPassword = await this.secrets.getOemPassword();

    const directLoginResult = await this.tryHandleDirectOemLogin(userText, allToolNames, {
      oemBaseUrl: this.settings.oem.baseUrl,
      oemUsername: this.settings.oem.username,
      oemPassword
    });

    if (directLoginResult) {
      return directLoginResult;
    }

    const apiKey = await this.secrets.getLlmApiKey();
    if (!apiKey) {
      throw new Error('LLM API key is not configured. Run: OEM Assistant: Set LLM API Key');
    }

    const llm = new OpenAiCompatibleLlmService(
      this.settings.llm.baseUrl,
      apiKey,
      this.settings.llm.model,
      this.settings.llm.temperature
    );

    const toolSpecs: OpenAiCompatibleTool[] = activeTools.map(tool => ({
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

    const hasOemCredentials = Boolean(this.settings.oem.baseUrl && this.settings.oem.username && oemPassword);
    const forceAskOps = this.shouldForceAskOps(userText, allToolNames);
    const askOpsExists = allToolNames.includes('ask_ops');

    const systemPrompt = [
      'You are a focused alert operations assistant.',
      'Use MCP tools when you need live alert data or operational actions.',
      'For destructive or risky actions, explain intent clearly before taking action.',
      'Never expose secrets, passwords, tokens, usernames, or private endpoints in your final response.',
      hasOemCredentials
        ? 'OEM credentials are already configured in extension settings. For OEM login requests, call login tool directly without asking credentials again.'
        : 'OEM credentials are incomplete. If login is requested, ask user to complete OEM settings first.',
      preferredToolNames.length > 0
        ? `User explicitly selected tools: ${preferredToolNames.join(', ')}. Only use these tools unless absolutely impossible.`
        : '',
      forceAskOps && askOpsExists
        ? 'This request is an alert diagnosis request. You MUST call ask_ops before providing any conclusion.'
        : '',
      askOpsExists
        ? 'If ask_ops result says SOP is not found (or equivalent), do not generate your own diagnosis. Reply that SOP is missing and ask user to完善知识库/SOP.'
        : '',
      this.mcp.getInstructions()
    ].filter(Boolean).join('\n\n');

    const shouldForceOemLogin = this.shouldForceOemLoginFirst(userText, allToolNames);
    const normalizedUserText = shouldForceOemLogin
      ? `${userText}\n\n请先调用 OEM 登录工具完成会话建立，然后再继续后续任务，不要重复要求用户输入 OEM 账号密码。`
      : userText;

    const steps: ExecutionStep[] = [];
    const messages: ChatTurn[] = [
      { role: 'system', content: systemPrompt },
      ...conversationContext,
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
        if (forceAskOps && askOpsExists && !this.hasAskOpsExecution(steps)) {
          const detail = '该问题属于告警诊断，必须先调用 ask_ops 工具。请在提问中显式使用 @ask_ops 后重试。';
          steps.push({ type: 'error', title: 'Missing required tool call', detail });
          return { finalText: detail, steps };
        }

        const reply = this.redactSensitiveText(llmReply.content ?? '(empty response)');
        steps.push({
          type: 'info',
          title: 'Final answer',
          detail: reply
        });
        return {
          finalText: reply,
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
        const redactedToolResult = this.redactSensitiveText(toolResult);
        steps.push({
          type: 'tool-result',
          title: `Tool result: ${toolName}`,
          detail: redactedToolResult
        });

        if (toolName === 'ask_ops' && this.indicatesNoSop(toolResult)) {
          const noSopMessage = '未找到匹配的 SOP，已停止自动解答。请先补充/更新 SOP 后再重试。';
          steps.push({
            type: 'info',
            title: 'SOP not found',
            detail: noSopMessage
          });
          return {
            finalText: noSopMessage,
            steps
          };
        }

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolName,
          content: redactedToolResult
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

  private normalizePreferredTools(preferredTools: string[] | undefined, allTools: string[]): string[] {
    if (!preferredTools?.length) {
      return [];
    }
    const allowed = new Set(allTools);
    return preferredTools
      .map(name => name.trim())
      .filter(Boolean)
      .filter(name => allowed.has(name));
  }

  private shouldForceAskOps(userText: string, toolNames: string[]): boolean {
    if (!toolNames.includes('ask_ops')) {
      return false;
    }
    const normalized = userText.toLowerCase();
    const hasAlertIntent =
      normalized.includes('告警') ||
      normalized.includes('alert') ||
      normalized.includes('cpu') ||
      normalized.includes('主机') ||
      normalized.includes('诊断');

    return hasAlertIntent;
  }

  private hasAskOpsExecution(steps: ExecutionStep[]): boolean {
    return steps.some(step => step.type === 'tool-call' && step.title.includes('ask_ops'));
  }

  private indicatesNoSop(toolResult: string): boolean {
    const normalized = toolResult.toLowerCase();
    return normalized.includes('no sop')
      || normalized.includes('sop not found')
      || normalized.includes('未找到sop')
      || normalized.includes('没有sop')
      || normalized.includes('未匹配到sop');
  }

  private shouldForceOemLoginFirst(userText: string, toolNames: string[]): boolean {
    const normalized = userText.toLowerCase();
    const isLoginIntent =
      normalized.includes('登录oem') ||
      normalized.includes('登陆oem') ||
      normalized.includes('login oem') ||
      normalized.includes('oem login') ||
      normalized === '登录';

    if (!isLoginIntent) {
      return false;
    }

    return toolNames.some(name => /oem.*login|login.*oem/i.test(name));
  }

  private async tryHandleDirectOemLogin(
    userText: string,
    toolNames: string[],
    creds: { oemBaseUrl: string; oemUsername: string; oemPassword: string | undefined }
  ): Promise<AssistantResult | undefined> {
    const normalized = userText.trim().toLowerCase();
    const isDirectLoginRequest =
      normalized === '登录' ||
      normalized === '登录oem' ||
      normalized === '登陆oem' ||
      normalized === 'login oem' ||
      normalized === 'oem login';

    if (!isDirectLoginRequest) {
      return undefined;
    }

    const loginToolName = toolNames.find(name => /oem.*login|login.*oem/i.test(name));
    if (!loginToolName) {
      return {
        finalText: '未发现可用的 OEM 登录工具（如 oem_login），请先确认 MCP Server 是否已暴露登录工具。',
        steps: []
      };
    }

    if (!creds.oemBaseUrl || !creds.oemUsername || !creds.oemPassword) {
      return {
        finalText: 'OEM 凭据未配置完整。请在 OEM Assistant Settings 中填写 OEM 地址、账号和密码后重试。',
        steps: []
      };
    }

    const args = this.resolveToolArgs(loginToolName, {}, creds);
    const toolResult = await this.mcp.callTool(loginToolName, args);

    return {
      finalText: this.redactSensitiveText(`已使用 Settings 中保存的 OEM 凭据执行登录。${toolResult}`),
      steps: [
        {
          type: 'tool-call',
          title: `Tool call: ${loginToolName}`,
          detail: this.redactSensitiveText(JSON.stringify(args, null, 2))
        },
        {
          type: 'tool-result',
          title: `Tool result: ${loginToolName}`,
          detail: this.redactSensitiveText(toolResult)
        }
      ]
    };
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
