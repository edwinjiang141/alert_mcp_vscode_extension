import type {
  ChatTurn,
  OpenAiCompatibleChoiceMessage,
  OpenAiCompatibleTool
} from '../../types/appTypes';

export class OpenAiCompatibleLlmService {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
    private readonly temperature: number
  ) {}

  async complete(messages: ChatTurn[], tools: OpenAiCompatibleTool[] = []): Promise<OpenAiCompatibleChoiceMessage> {
    const endpoint = this.normalizeEndpoint(this.baseUrl);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        temperature: this.temperature,
        stream: false,
        messages: messages.map(message => ({
          role: message.role,
          content: message.content,
          name: message.name,
          tool_call_id: message.tool_call_id,
          tool_calls: message.tool_calls
        })),
        ...(tools.length > 0 ? { tools } : {})
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`LLM request failed: ${response.status} ${response.statusText}\n${body}`);
    }

    const json = await response.json() as {
      choices?: Array<{
        message?: OpenAiCompatibleChoiceMessage;
      }>;
    };

    const message = json.choices?.[0]?.message;
    if (!message) {
      throw new Error('LLM response does not contain a valid assistant message.');
    }

    return message;
  }

  private normalizeEndpoint(baseUrl: string): string {
    const trimmed = baseUrl.replace(/\/$/, '');
    if (trimmed.endsWith('/chat/completions')) {
      return trimmed;
    }
    return `${trimmed}/chat/completions`;
  }
}
