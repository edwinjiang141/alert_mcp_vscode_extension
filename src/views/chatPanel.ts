import * as vscode from 'vscode';
import type { AssistantResult } from '../types/appTypes';

export class ChatPanel {
  private static current: ChatPanel | undefined;
  private readonly panel: vscode.WebviewPanel;

  static createOrShow(context: vscode.ExtensionContext): ChatPanel {
    if (ChatPanel.current) {
      ChatPanel.current.panel.reveal(vscode.ViewColumn.One);
      return ChatPanel.current;
    }

    const panel = vscode.window.createWebviewPanel(
      'alertMcpConsole',
      'Alert MCP Console',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    ChatPanel.current = new ChatPanel(panel, context);
    return ChatPanel.current;
  }

  private constructor(panel: vscode.WebviewPanel, _context: vscode.ExtensionContext) {
    this.panel = panel;
    this.panel.onDidDispose(() => {
      ChatPanel.current = undefined;
    });
    this.panel.webview.html = this.renderHtml();
  }

  onDidReceiveMessage(handler: (message: any) => void): vscode.Disposable {
    return this.panel.webview.onDidReceiveMessage(handler);
  }

  postAssistantResult(question: string, result: AssistantResult): void {
    this.panel.webview.postMessage({
      type: 'assistant-result',
      payload: { question, result }
    });
  }

  postInfo(text: string): void {
    this.panel.webview.postMessage({ type: 'info', payload: text });
  }

  private renderHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Alert MCP Console</title>
  <style>
    body { font-family: var(--vscode-font-family); padding: 12px; color: var(--vscode-editor-foreground); }
    .row { display: flex; gap: 8px; margin-bottom: 12px; }
    textarea { width: 100%; min-height: 90px; resize: vertical; }
    button { padding: 6px 12px; }
    .card { border: 1px solid var(--vscode-panel-border); border-radius: 8px; padding: 12px; margin-top: 12px; }
    .title { font-weight: 600; margin-bottom: 8px; }
    pre { white-space: pre-wrap; word-break: break-word; }
    .step { margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--vscode-panel-border); }
  </style>
</head>
<body>
  <div class="row">
    <button id="askBtn">Ask</button>
    <button id="connectBtn">Connect MCP</button>
  </div>
  <textarea id="input" placeholder="Example: 查询最近2小时所有P1告警，并按对象分组总结。"></textarea>
  <div id="log"></div>

  <script>
    const vscode = acquireVsCodeApi();
    const input = document.getElementById('input');
    const log = document.getElementById('log');

    document.getElementById('askBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'ask', payload: input.value });
    });

    document.getElementById('connectBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'connect' });
    });

    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'info') {
        const div = document.createElement('div');
        div.className = 'card';
        div.innerHTML = '<div class="title">Info</div><pre>' + escapeHtml(message.payload) + '</pre>';
        log.prepend(div);
        return;
      }

      if (message.type === 'assistant-result') {
        const payload = message.payload;
        const question = payload.question;
        const result = payload.result;
        const stepsHtml = result.steps.map(step => {
          return '<div class="step">'
            + '<strong>' + escapeHtml(step.title) + '</strong>'
            + '<pre>' + escapeHtml(step.detail) + '</pre>'
            + '</div>';
        }).join('');

        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = ''
          + '<div class="title">Question</div>'
          + '<pre>' + escapeHtml(question) + '</pre>'
          + '<div class="title">Answer</div>'
          + '<pre>' + escapeHtml(result.finalText) + '</pre>'
          + '<div class="title">Execution Trace</div>'
          + stepsHtml;

        log.prepend(card);
      }
    });

    function escapeHtml(str) {
      return String(str)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
    }
  </script>
</body>
</html>`;
  }
}
