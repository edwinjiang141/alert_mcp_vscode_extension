export type ConnectionMode = 'auto' | 'legacy-sse' | 'streamable-http';
export type LlmProvider = 'openai-compatible' | 'copilot';

export interface ExtensionSettings {
  mcp: {
    serverUrl: string;
    connectionMode: ConnectionMode;
    requestTimeoutMs: number;
  };
  llm: {
    provider: LlmProvider;
    baseUrl: string;
    model: string;
    temperature: number;
  };
  ui: {
    maxToolRounds: number;
  };
}

export interface AssistantResult {
  finalText: string;
  steps: ExecutionStep[];
}

export interface ExecutionStep {
  type: 'thought' | 'tool-call' | 'tool-result' | 'info' | 'error';
  title: string;
  detail: string;
}

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: OpenAiCompatibleToolCall[];
}

export interface OpenAiCompatibleToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenAiCompatibleTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface OpenAiCompatibleChoiceMessage {
  role: 'assistant';
  content: string | null;
  tool_calls?: OpenAiCompatibleToolCall[];
}
