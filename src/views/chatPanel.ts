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
    body {
      font-family: var(--vscode-font-family);
      margin: 0;
      padding: 12px;
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
    }
    .chat-log {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-bottom: 12px;
      min-height: 240px;
    }
    .bubble {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 10px;
      padding: 10px;
      max-width: 92%;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .bubble.user {
      align-self: flex-end;
      background: color-mix(in srgb, var(--vscode-button-background) 15%, transparent);
    }
    .bubble.assistant {
      align-self: flex-start;
      background: color-mix(in srgb, var(--vscode-editorWidget-background) 75%, transparent);
    }
    .bubble.info {
      align-self: center;
      background: color-mix(in srgb, var(--vscode-textCodeBlock-background) 65%, transparent);
      opacity: 0.95;
      font-size: 12px;
    }
    .bubble-title {
      font-weight: 600;
      margin-bottom: 6px;
      font-size: 12px;
      opacity: 0.9;
    }
    details {
      margin-top: 8px;
      border-top: 1px dashed var(--vscode-panel-border);
      padding-top: 8px;
    }
    details summary {
      cursor: pointer;
      font-weight: 600;
      font-size: 12px;
    }
    .step {
      margin-top: 8px;
      padding: 8px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      background: color-mix(in srgb, var(--vscode-textCodeBlock-background) 55%, transparent);
    }
    .step-title {
      font-weight: 600;
      margin-bottom: 4px;
    }
    .composer {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8px;
      align-items: end;
    }
    textarea {
      width: 100%;
      min-height: 96px;
      resize: vertical;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border);
      border-radius: 8px;
      padding: 8px;
    }
    button {
      padding: 8px 14px;
      border-radius: 8px;
      border: 1px solid var(--vscode-button-border);
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      cursor: pointer;
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
  </style>
</head>
<body>
  <div id="log" class="chat-log"></div>

  <div class="composer">
    <textarea id="input" placeholder="Example: 登录OEM，然后查询最近2小时所有P1告警，并按对象分组总结。"></textarea>
    <button id="askBtn">Ask</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const input = document.getElementById('input');
    const log = document.getElementById('log');

    function redactSensitiveText(raw) {
      let text = String(raw || '');
      text = text.replace(/(password\\s*[=:]\\s*)([^\\s,\\n]+)/gi, '$1***');
      text = text.replace(/(密码\\s*[：:\=]\\s*)([^\\s,\\n]+)/g, '$1***');
      text = text.replace(/(username\\s*[=:]\\s*)([^\\s,\\n]+)/gi, '$1***');
      text = text.replace(/(用户名\\s*[：:\=]\\s*)([^\\s,\\n]+)/g, '$1***');
      text = text.replace(/(https?:\\/\\/[^\\s]*\\/em\\/api)/gi, '[OEM_API_REDACTED]');
      return text;
    }

    function appendBubble(type, title, bodyHtml) {
      const div = document.createElement('div');
      div.className = 'bubble ' + type;
      div.innerHTML = '<div class="bubble-title">' + escapeHtml(title) + '</div>' + bodyHtml;
      log.appendChild(div);
      div.scrollIntoView({ behavior: 'smooth', block: 'end' });
      return div;
    }

    function submitAsk() {
      const question = input.value.trim();
      if (!question) {
        return;
      }
      appendBubble('user', 'You', '<div>' + escapeHtml(redactSensitiveText(question)) + '</div>');
      vscode.postMessage({ type: 'ask', payload: question });
      input.value = '';
    }

    document.getElementById('askBtn').addEventListener('click', submitAsk);

    input.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        submitAsk();
      }
    });

    async function typewriterRender(targetElement, fullText) {
      const text = redactSensitiveText(fullText);
      const batchSize = 2;
      const frameDelay = 14;
      let index = 0;

      await new Promise(resolve => {
        const timer = setInterval(() => {
          const next = Math.min(index + batchSize, text.length);
          targetElement.textContent = text.slice(0, next);
          index = next;
          if (index >= text.length) {
            clearInterval(timer);
            resolve();
          }
        }, frameDelay);
      });
    }

    window.addEventListener('message', async event => {
      const message = event.data;
      if (message.type === 'info') {
        appendBubble('info', 'Info', '<div>' + escapeHtml(redactSensitiveText(message.payload)) + '</div>');
        return;
      }

      if (message.type === 'assistant-result') {
        const payload = message.payload;
        const result = payload.result;
        const wrapper = appendBubble('assistant', 'Assistant', '<div class="answer-body"></div>');
        const answerBody = wrapper.querySelector('.answer-body');
        if (!answerBody) {
          return;
        }

        await typewriterRender(answerBody, result.finalText);

        const stepsHtml = result.steps.map(step => {
          return '<div class="step">'
            + '<div class="step-title">' + escapeHtml(step.title) + '</div>'
            + '<div>' + escapeHtml(redactSensitiveText(step.detail)) + '</div>'
            + '</div>';
        }).join('');

        if (stepsHtml) {
          const details = document.createElement('details');
          details.innerHTML = '<summary>Tool Execution Trace</summary>' + stepsHtml;
          wrapper.appendChild(details);
        }

        wrapper.scrollIntoView({ behavior: 'smooth', block: 'end' });
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
