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

    const systemPrompt = [
      'You are a focused alert operations assistant.',
      'Use MCP tools when you need live alert data or operational actions.',
      'For destructive or risky actions, explain intent clearly before taking action.',
      'Keep answers concise, factual, and operationally useful.',
      this.mcp.getInstructions()
    ].filter(Boolean).join('\n\n');

    const steps: ExecutionStep[] = [];
    const messages: ChatTurn[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userText }
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
          detail: llmReply.content ?? '(empty response)'
        });
        return {
          finalText: llmReply.content ?? '(empty response)',
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

        steps.push({
          type: 'tool-call',
          title: `Tool call: ${toolName}`,
          detail: JSON.stringify(parsedArgs, null, 2)
        });

        const toolResult = await this.mcp.callTool(toolName, parsedArgs);
        steps.push({
          type: 'tool-result',
          title: `Tool result: ${toolName}`,
          detail: toolResult
        });

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolName,
          content: toolResult
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
}
