import type { AuthProvider, Tool } from '@modelcontextprotocol/client';
import {
  Client,
  SSEClientTransport,
  StreamableHTTPClientTransport
} from '@modelcontextprotocol/client';
import * as vscode from 'vscode';
import type { ExtensionSettings } from '../../types/appTypes';
import { SecretStorageService } from '../secretStorageService';

export class McpClientService {
  private client: Client | undefined;
  private transport:
    | SSEClientTransport
    | StreamableHTTPClientTransport
    | undefined;
  private connectedUrl: string | undefined;
  private toolsCache: Tool[] = [];
  private instructions = '';

  constructor(
    private readonly output: vscode.OutputChannel,
    private readonly secrets: SecretStorageService
  ) {}

  isConnected(): boolean {
    return Boolean(this.client);
  }

  getConnectedUrl(): string | undefined {
    return this.connectedUrl;
  }

  getInstructions(): string {
    return this.instructions;
  }

  getCachedTools(): Tool[] {
    return this.toolsCache;
  }

  async connect(settings: ExtensionSettings): Promise<void> {
    await this.disconnect();

    const url = new URL(settings.mcp.serverUrl);
    const token = await this.secrets.getMcpBearerToken();
    const authProvider: AuthProvider | undefined = token
      ? { token: async () => token }
      : undefined;

    this.output.appendLine(`[MCP] connecting to ${url.toString()} mode=${settings.mcp.connectionMode}`);

    const createClient = () =>
      new Client({
        name: 'alert-mcp-assistant',
        version: '0.1.0'
      });

    try {
      if (settings.mcp.connectionMode === 'streamable-http') {
        this.client = createClient();
        this.transport = new StreamableHTTPClientTransport(url, authProvider ? { authProvider } : undefined);
        await this.client.connect(this.transport);
      } else if (settings.mcp.connectionMode === 'legacy-sse') {
        this.client = createClient();
        this.transport = new SSEClientTransport(url);
        await this.client.connect(this.transport);
      } else {
        try {
          this.client = createClient();
          this.transport = new StreamableHTTPClientTransport(url, authProvider ? { authProvider } : undefined);
          await this.client.connect(this.transport);
          this.output.appendLine('[MCP] connected via Streamable HTTP');
        } catch (streamErr) {
          this.output.appendLine(`[MCP] Streamable HTTP failed, fallback to SSE: ${String(streamErr)}`);
          this.client = createClient();
          this.transport = new SSEClientTransport(url);
          await this.client.connect(this.transport);
          this.output.appendLine('[MCP] connected via legacy SSE');
        }
      }

      this.connectedUrl = url.toString();
      this.instructions = this.client.getInstructions() ?? '';
      await this.refreshTools();
    } catch (error) {
      await this.disconnect();
      throw error;
    }
  }

  async refreshTools(): Promise<Tool[]> {
    if (!this.client) {
      throw new Error('MCP client is not connected.');
    }

    const allTools: Tool[] = [];
    let cursor: string | undefined;

    do {
      const response = await this.client.listTools({ cursor });
      allTools.push(...response.tools);
      cursor = response.nextCursor;
    } while (cursor);

    this.toolsCache = allTools;
    this.output.appendLine(`[MCP] tools refreshed: ${allTools.map(t => t.name).join(', ') || '(none)'}`);
    return allTools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    if (!this.client) {
      throw new Error('MCP client is not connected.');
    }

    const response = await this.client.callTool({ name, arguments: args });

    const textParts = response.content
      .map((item: any) => {
        if (item?.type === 'text') {
          return item.text;
        }
        return JSON.stringify(item, null, 2);
      })
      .filter(Boolean);

    if (response.structuredContent) {
      textParts.push(`\n[structuredContent]\n${JSON.stringify(response.structuredContent, null, 2)}`);
    }

    const result = textParts.join('\n');
    this.output.appendLine(`[MCP] tool ${name} executed`);
    return result || '(empty tool result)';
  }

  async disconnect(): Promise<void> {
    if (this.transport && this.transport instanceof StreamableHTTPClientTransport) {
      try {
        await this.transport.terminateSession();
      } catch {
        // best effort
      }
    }

    if (this.client) {
      try {
        await this.client.close();
      } catch {
        // best effort
      }
    }

    this.client = undefined;
    this.transport = undefined;
    this.connectedUrl = undefined;
    this.instructions = '';
    this.toolsCache = [];
  }
}
