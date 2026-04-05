import * as vscode from 'vscode';
import { McpClientService } from '../services/mcp/mcpClientService';
import { SettingsService } from '../services/settingsService';

class SidebarItem extends vscode.TreeItem {
  constructor(
    label: string,
    options?: {
      description?: string;
      command?: vscode.Command;
      collapsibleState?: vscode.TreeItemCollapsibleState;
      contextValue?: string;
      tooltip?: string;
    }
  ) {
    super(label, options?.collapsibleState ?? vscode.TreeItemCollapsibleState.None);
    this.description = options?.description;
    this.command = options?.command;
    this.contextValue = options?.contextValue;
    this.tooltip = options?.tooltip;
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

  getChildren(element?: SidebarItem): Thenable<SidebarItem[]> {
    const settings = this.settingsService.get();
    const tools = this.mcp.getCachedTools();

    if (element?.contextValue === 'available-tools') {
      if (tools.length === 0) {
        return Promise.resolve([
          new SidebarItem('No tools discovered yet', {
            description: 'Connect MCP and refresh to load tool metadata.'
          })
        ]);
      }

      return Promise.resolve(
        tools.slice(0, 30).map(tool => new SidebarItem(tool.name, {
          command: {
            command: 'alertMcp.showToolDescription',
            title: 'Show Tool Description',
            arguments: [tool.name, tool.description ?? 'No description from MCP server.']
          },
          tooltip: tool.description ?? 'No description from MCP server.'
        }))
      );
    }

    return Promise.resolve([
      new SidebarItem(
        this.mcp.isConnected() ? 'MCP: Connected' : 'MCP: Disconnected',
        {
          description: this.mcp.getConnectedUrl() ?? settings.mcp.serverUrl,
          command: {
            command: this.mcp.isConnected() ? 'alertMcp.disconnectMcp' : 'alertMcp.connectMcp',
            title: 'Toggle MCP Connection'
          }
        }
      ),
      new SidebarItem('LLM Provider', { description: settings.llm.provider }),
      new SidebarItem('LLM Model', { description: settings.llm.model }),
      new SidebarItem('Available Tools', {
        description: `${tools.length}`,
        collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
        contextValue: 'available-tools'
      }),
      new SidebarItem('Open Console', {
        description: 'Chat + tool execution view',
        command: {
          command: 'alertMcp.openConsole',
          title: 'Open Console'
        }
      }),
      new SidebarItem('Open Settings', {
        description: 'LLM / OEM / MCP credentials',
        command: {
          command: 'alertMcp.openSettings',
          title: 'Open Settings'
        }
      })
    ]);
  }
}
