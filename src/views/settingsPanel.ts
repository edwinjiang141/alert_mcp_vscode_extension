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
    :root {
      --card-border: color-mix(in srgb, var(--vscode-panel-border) 75%, transparent);
      --soft-bg: color-mix(in srgb, var(--vscode-editorWidget-background) 75%, transparent);
      --muted-fg: color-mix(in srgb, var(--vscode-foreground) 70%, transparent);
      --accent: var(--vscode-button-background);
      --accent-fg: var(--vscode-button-foreground);
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      padding: 20px;
      font-family: var(--vscode-font-family);
      color: var(--vscode-editor-foreground);
      background: linear-gradient(
        180deg,
        color-mix(in srgb, var(--vscode-editor-background) 92%, #111 8%) 0%,
        var(--vscode-editor-background) 100%
      );
    }

    .container {
      max-width: 1080px;
      margin: 0 auto;
      display: grid;
      gap: 14px;
    }

    .header {
      padding: 16px 18px;
      border: 1px solid var(--card-border);
      border-radius: 12px;
      background: var(--soft-bg);
    }

    .title {
      margin: 0;
      font-size: 24px;
      font-weight: 700;
      letter-spacing: 0.2px;
    }

    .subtitle {
      margin: 8px 0 0;
      font-size: 12px;
      color: var(--muted-fg);
    }

    .card {
      border: 1px solid var(--card-border);
      border-radius: 12px;
      background: color-mix(in srgb, var(--vscode-editorWidget-background) 65%, transparent);
      padding: 14px;
    }

    .section-title {
      margin: 2px 0 10px;
      font-size: 13px;
      font-weight: 600;
      color: var(--muted-fg);
      text-transform: uppercase;
      letter-spacing: 0.6px;
    }

    .grid {
      display: grid;
      gap: 10px;
      grid-template-columns: 1fr 1fr;
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .field.full {
      grid-column: 1 / -1;
    }

    label {
      font-size: 12px;
      font-weight: 500;
      color: color-mix(in srgb, var(--vscode-foreground) 88%, transparent);
    }

    input, select {
      width: 100%;
      border: 1px solid color-mix(in srgb, var(--vscode-input-border) 75%, transparent);
      border-radius: 8px;
      padding: 10px 11px;
      min-height: 38px;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      outline: none;
      transition: border-color 0.18s ease, box-shadow 0.18s ease;
    }

    input:focus,
    select:focus {
      border-color: color-mix(in srgb, var(--accent) 82%, white 18%);
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 28%, transparent);
    }

    .footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      padding-top: 2px;
    }

    .hint {
      font-size: 12px;
      color: var(--muted-fg);
      min-height: 18px;
    }

    button {
      border: 1px solid color-mix(in srgb, var(--accent) 75%, transparent);
      background: var(--accent);
      color: var(--accent-fg);
      border-radius: 8px;
      padding: 9px 16px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }

    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2 class="title">OEM Assistant Settings</h2>
      <p class="subtitle">维护 MCP / LLM / OEM 连接信息（密码与密钥使用 SecretStorage）。</p>
    </div>

    <div class="card">
      <div class="section-title">MCP</div>
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
      </div>
    </div>

    <div class="card">
      <div class="section-title">LLM</div>
      <div class="grid">
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
      </div>
    </div>

    <div class="card">
      <div class="section-title">OEM</div>
      <div class="grid">
        <label class="field full">OEM 地址
          <input id="oemBaseUrl" placeholder="https://oem.example.com" />
        </label>
        <label class="field">OEM 账号
          <input id="oemUsername" placeholder="username" />
        </label>
        <label class="field">OEM 密码（留空表示不修改）
          <input id="oemPassword" type="password" />
        </label>
      </div>
    </div>

    <div class="card">
      <div class="section-title">Security</div>
      <div class="grid">
        <label class="field full">MCP Bearer Token（留空表示不修改）
          <input id="mcpBearerToken" type="password" />
        </label>
      </div>
      <div class="footer">
        <div class="hint" id="secretHint"></div>
        <button id="saveBtn">保存设置</button>
      </div>
    </div>
  </div>

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
