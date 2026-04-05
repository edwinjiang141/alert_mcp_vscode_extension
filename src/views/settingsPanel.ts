import * as vscode from 'vscode';
import { SecretStorageService } from '../services/secretStorageService';
import { SettingsService } from '../services/settingsService';

interface SettingsViewState {
  mcpServerUrl: string;
  mcpConnectionMode: 'auto' | 'legacy-sse' | 'streamable-http';
  llmProvider: 'openai-compatible' | 'copilot';
  llmBaseUrl: string;
  llmModel: string;
  llmTemperature: number;
  oemBaseUrl: string;
  oemUsername: string;
  hasLlmApiKey: boolean;
  hasMcpToken: boolean;
  hasOemPassword: boolean;
}

export class SettingsPanel {
  private static current: SettingsPanel | undefined;
  private readonly panel: vscode.WebviewPanel;

  static async createOrShow(
    context: vscode.ExtensionContext,
    settingsService: SettingsService,
    secrets: SecretStorageService
  ): Promise<SettingsPanel> {
    if (SettingsPanel.current) {
      SettingsPanel.current.panel.reveal(vscode.ViewColumn.One);
      await SettingsPanel.current.refresh(settingsService, secrets);
      return SettingsPanel.current;
    }

    const panel = vscode.window.createWebviewPanel(
      'alertMcpSettings',
      'OEM Assistant Settings',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    SettingsPanel.current = new SettingsPanel(panel, context, settingsService, secrets);
    await SettingsPanel.current.refresh(settingsService, secrets);
    return SettingsPanel.current;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    _context: vscode.ExtensionContext,
    settingsService: SettingsService,
    secrets: SecretStorageService
  ) {
    this.panel = panel;
    this.panel.webview.html = this.renderHtml();

    this.panel.onDidDispose(() => {
      SettingsPanel.current = undefined;
    });

    this.panel.webview.onDidReceiveMessage(async message => {
      if (message.type === 'save') {
        await this.handleSave(message.payload, settingsService, secrets);
      }
    });
  }

  async refresh(settingsService: SettingsService, secrets: SecretStorageService): Promise<void> {
    const settings = settingsService.get();
    const state: SettingsViewState = {
      mcpServerUrl: settings.mcp.serverUrl,
      mcpConnectionMode: settings.mcp.connectionMode,
      llmProvider: settings.llm.provider,
      llmBaseUrl: settings.llm.baseUrl,
      llmModel: settings.llm.model,
      llmTemperature: settings.llm.temperature,
      oemBaseUrl: settings.oem.baseUrl,
      oemUsername: settings.oem.username,
      hasLlmApiKey: Boolean(await secrets.getLlmApiKey()),
      hasMcpToken: Boolean(await secrets.getMcpBearerToken()),
      hasOemPassword: Boolean(await secrets.getOemPassword())
    };

    this.panel.webview.postMessage({ type: 'state', payload: state });
  }

  private async handleSave(
    payload: Record<string, string | number>,
    settingsService: SettingsService,
    secrets: SecretStorageService
  ): Promise<void> {
    const config = vscode.workspace.getConfiguration('alertMcp');

    await Promise.all([
      config.update('mcp.serverUrl', String(payload.mcpServerUrl ?? ''), vscode.ConfigurationTarget.Global),
      config.update(
        'mcp.connectionMode',
        String(payload.mcpConnectionMode ?? 'auto'),
        vscode.ConfigurationTarget.Global
      ),
      config.update('llm.provider', String(payload.llmProvider ?? 'openai-compatible'), vscode.ConfigurationTarget.Global),
      config.update('llm.baseUrl', String(payload.llmBaseUrl ?? ''), vscode.ConfigurationTarget.Global),
      config.update('llm.model', String(payload.llmModel ?? ''), vscode.ConfigurationTarget.Global),
      config.update(
        'llm.temperature',
        Number(payload.llmTemperature ?? 0.1),
        vscode.ConfigurationTarget.Global
      ),
      config.update('oem.baseUrl', String(payload.oemBaseUrl ?? ''), vscode.ConfigurationTarget.Global),
      config.update('oem.username', String(payload.oemUsername ?? ''), vscode.ConfigurationTarget.Global)
    ]);

    const llmApiKey = String(payload.llmApiKey ?? '').trim();
    if (llmApiKey) {
      await secrets.setLlmApiKey(llmApiKey);
    }

    const mcpToken = String(payload.mcpBearerToken ?? '').trim();
    if (mcpToken) {
      await secrets.setMcpBearerToken(mcpToken);
    }

    const oemPassword = String(payload.oemPassword ?? '').trim();
    if (oemPassword) {
      await secrets.setOemPassword(oemPassword);
    }

    await this.refresh(settingsService, secrets);
    vscode.window.showInformationMessage('OEM Assistant settings saved.');
  }

  private renderHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>OEM Assistant Settings</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-editor-foreground); padding: 16px; }
    h2 { margin-bottom: 12px; }
    .grid { display: grid; gap: 10px; grid-template-columns: 1fr 1fr; }
    .field { display: flex; flex-direction: column; gap: 4px; }
    .field.full { grid-column: 1 / -1; }
    input, select { width: 100%; box-sizing: border-box; padding: 8px; }
    button { margin-top: 14px; padding: 8px 14px; }
    .hint { font-size: 12px; opacity: 0.8; }
  </style>
</head>
<body>
  <h2>OEM Assistant MVP Settings</h2>
  <div class="grid">
    <label class="field full">MCP SSE 地址
      <input id="mcpServerUrl" placeholder="http://127.0.0.1:3000/sse" />
    </label>
    <label class="field">MCP 连接模式
      <select id="mcpConnectionMode">
        <option value="auto">auto</option>
        <option value="legacy-sse">legacy-sse</option>
        <option value="streamable-http">streamable-http</option>
      </select>
    </label>

    <label class="field">LLM Provider
      <select id="llmProvider">
        <option value="openai-compatible">openai-compatible</option>
        <option value="copilot">copilot</option>
      </select>
    </label>
    <label class="field full">LLM Base URL
      <input id="llmBaseUrl" placeholder="https://api.deepseek.com" />
    </label>
    <label class="field">LLM Model
      <input id="llmModel" placeholder="deepseek-chat" />
    </label>
    <label class="field">LLM Temperature
      <input id="llmTemperature" type="number" min="0" max="2" step="0.1" />
    </label>
    <label class="field full">LLM API Key（留空表示不修改）
      <input id="llmApiKey" type="password" placeholder="sk-..." />
    </label>

    <label class="field full">OEM 地址
      <input id="oemBaseUrl" placeholder="https://oem.example.com" />
    </label>
    <label class="field">OEM 账号
      <input id="oemUsername" placeholder="username" />
    </label>
    <label class="field">OEM 密码（留空表示不修改）
      <input id="oemPassword" type="password" />
    </label>

    <label class="field full">MCP Bearer Token（留空表示不修改）
      <input id="mcpBearerToken" type="password" />
    </label>
  </div>

  <div class="hint" id="secretHint"></div>
  <button id="saveBtn">保存设置</button>

  <script>
    const vscode = acquireVsCodeApi();

    const fields = [
      'mcpServerUrl', 'mcpConnectionMode', 'llmProvider', 'llmBaseUrl', 'llmModel', 'llmTemperature',
      'llmApiKey', 'oemBaseUrl', 'oemUsername', 'oemPassword', 'mcpBearerToken'
    ];

    document.getElementById('saveBtn').addEventListener('click', () => {
      const payload = {};
      for (const id of fields) {
        payload[id] = document.getElementById(id).value;
      }
      vscode.postMessage({ type: 'save', payload });
    });

    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type !== 'state') {
        return;
      }

      const state = message.payload;
      document.getElementById('mcpServerUrl').value = state.mcpServerUrl;
      document.getElementById('mcpConnectionMode').value = state.mcpConnectionMode;
      document.getElementById('llmProvider').value = state.llmProvider;
      document.getElementById('llmBaseUrl').value = state.llmBaseUrl;
      document.getElementById('llmModel').value = state.llmModel;
      document.getElementById('llmTemperature').value = state.llmTemperature;
      document.getElementById('oemBaseUrl').value = state.oemBaseUrl;
      document.getElementById('oemUsername').value = state.oemUsername;

      document.getElementById('llmApiKey').value = '';
      document.getElementById('oemPassword').value = '';
      document.getElementById('mcpBearerToken').value = '';

      const hints = [];
      if (state.hasLlmApiKey) hints.push('LLM Key已保存');
      if (state.hasMcpToken) hints.push('MCP Token已保存');
      if (state.hasOemPassword) hints.push('OEM密码已保存');
      document.getElementById('secretHint').textContent = hints.join(' | ');
    });
  </script>
</body>
</html>`;
  }
}
