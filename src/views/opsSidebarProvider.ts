import * as vscode from 'vscode';
import { McpClientService } from '../services/mcp/mcpClientService';
import { SettingsService } from '../services/settingsService';

class SidebarItem extends vscode.TreeItem {
  constructor(label: string, description?: string, command?: vscode.Command) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.command = command;
  }
}

export class OpsSidebarProvider implements vscode.TreeDataProvider<SidebarItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<SidebarItem | void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(
    private readonly mcp: McpClientService,
    private readonly settingsService: SettingsService
  ) {}

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  getTreeItem(element: SidebarItem): vscode.TreeItem {
    return element;
  }

  getChildren(): Thenable<SidebarItem[]> {
    const settings = this.settingsService.get();
    const tools = this.mcp.getCachedTools();

    return Promise.resolve([
      new SidebarItem(
        this.mcp.isConnected() ? 'MCP: Connected' : 'MCP: Disconnected',
        this.mcp.getConnectedUrl() ?? settings.mcp.serverUrl,
        {
          command: this.mcp.isConnected() ? 'alertMcp.disconnectMcp' : 'alertMcp.connectMcp',
          title: 'Toggle MCP Connection'
        }
      ),
      new SidebarItem('LLM Provider', settings.llm.provider),
      new SidebarItem('LLM Model', settings.llm.model),
      new SidebarItem('Available Tools', `${tools.length}`),
      new SidebarItem('Open Console', 'Chat + execution view', {
        command: 'alertMcp.openConsole',
        title: 'Open Console'
      }),
      new SidebarItem('Open Settings', 'LLM / OEM / MCP credentials', {
        command: 'alertMcp.openSettings',
        title: 'Open Settings'
      }),
      ...tools.slice(0, 15).map(tool => new SidebarItem(`tool: ${tool.name}`, tool.description ?? '', {
        command: 'alertMcp.askAssistant',
        title: 'Ask with Tool',
        arguments: [`请调用工具 ${tool.name}，并基于返回结果给出处置建议。`]
      }))
    ]);
  }
}
