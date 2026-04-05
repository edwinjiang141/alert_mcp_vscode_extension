import * as vscode from 'vscode';
import type { AssistantResult } from '../types/appTypes';

interface AskPayload {
  question: string;
  preferredTools: string[];
}

interface ToolMeta {
  name: string;
  description: string;
}

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
      'OEM Assistant Console',
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

  postToolCatalog(tools: ToolMeta[]): void {
    this.panel.webview.postMessage({ type: 'tools-catalog', payload: tools });
  }

  private renderHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>OEM Assistant Console</title>
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
      position: relative;
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
      font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
    }
    .submit-btn {
      height: 38px;
      width: 38px;
      border-radius: 8px;
      border: 1px solid var(--vscode-button-border);
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      font-weight: 700;
    }
    .submit-btn:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .tool-picker {
      position: absolute;
      left: 0;
      right: 46px;
      bottom: 110px;
      max-height: 220px;
      overflow-y: auto;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      background: var(--vscode-editorWidget-background);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.28);
      z-index: 10;
      display: none;
    }
    .tool-picker.visible {
      display: block;
    }
    .tool-option {
      padding: 8px 10px;
      cursor: pointer;
      border-bottom: 1px solid color-mix(in srgb, var(--vscode-panel-border) 40%, transparent);
    }
    .tool-option:last-child {
      border-bottom: none;
    }
    .tool-option:hover,
    .tool-option.active {
      background: color-mix(in srgb, var(--vscode-list-hoverBackground) 80%, transparent);
    }
    .tool-option .name {
      font-weight: 600;
      font-size: 12px;
    }
    .tool-option .desc {
      font-size: 11px;
      opacity: 0.9;
      margin-top: 4px;
    }
    .hint {
      margin-top: 6px;
      font-size: 11px;
      opacity: 0.8;
    }
    .mention-pill {
      display: inline-flex;
      align-items: center;
      border: 1px solid var(--vscode-badge-background);
      border-radius: 999px;
      padding: 2px 7px;
      font-size: 11px;
      margin-right: 6px;
      margin-bottom: 6px;
      background: color-mix(in srgb, var(--vscode-badge-background) 22%, transparent);
    }
    .mention-wrap {
      min-height: 20px;
      margin: 4px 0;
    }
  </style>
</head>
<body>
  <div id="log" class="chat-log"></div>

  <div class="mention-wrap" id="mentions"></div>
  <div class="composer">
    <div id="toolPicker" class="tool-picker" role="listbox" aria-label="MCP tools"></div>
    <textarea id="input" placeholder="输入 @ 可快速选择 tool，例如：@ask_ops 查询xx主机CPU告警。"></textarea>
    <button id="askBtn" class="submit-btn" title="Submit">➤</button>
  </div>
  <div class="hint">提示：输入 @tool_name 可指定优先调用工具，支持模糊检索。</div>

  <script>
    const vscode = acquireVsCodeApi();
    const input = document.getElementById('input');
    const log = document.getElementById('log');
    const picker = document.getElementById('toolPicker');
    const mentions = document.getElementById('mentions');
    let toolsCatalog = [];
    let currentOptions = [];
    let activeOptionIndex = 0;

    function redrawMentions() {
      const used = extractToolMentions(input.value);
      if (!used.length) {
        mentions.innerHTML = '';
        return;
      }
      mentions.innerHTML = used.map(name => '<span class="mention-pill">@' + escapeHtml(name) + '</span>').join('');
    }

    function redactSensitiveText(raw) {
      let text = String(raw || '');
      text = text.replace(/(password\\s*[=:]\\s*)([^\\s,\\n]+)/gi, '$1***');
      text = text.replace(/(密码\\s*[：:\\=]\\s*)([^\\s,\\n]+)/g, '$1***');
      text = text.replace(/(username\\s*[=:]\\s*)([^\\s,\\n]+)/gi, '$1***');
      text = text.replace(/(用户名\\s*[：:\\=]\\s*)([^\\s,\\n]+)/g, '$1***');
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

    function extractToolMentions(text) {
      const names = new Set();
      for (const match of String(text).matchAll(/@([a-zA-Z0-9_:-]+)/g)) {
        const name = match[1];
        if (name) {
          names.add(name);
        }
      }
      return Array.from(names);
    }

    function getCurrentMentionQuery() {
      const value = input.value;
      const caret = input.selectionStart || 0;
      const beforeCaret = value.slice(0, caret);
      const match = beforeCaret.match(/(?:^|\\s)@([a-zA-Z0-9_:-]*)$/);
      if (!match) {
        return undefined;
      }
      const full = match[0];
      const atPos = beforeCaret.lastIndexOf('@');
      return {
        query: (match[1] || '').toLowerCase(),
        atPos
      };
    }

    function rankTools(query) {
      if (!query) {
        return toolsCatalog.slice(0, 20);
      }
      return toolsCatalog
        .map(tool => {
          const name = tool.name.toLowerCase();
          const desc = (tool.description || '').toLowerCase();
          let score = 0;
          if (name.startsWith(query)) score += 6;
          if (name.includes(query)) score += 4;
          if (desc.includes(query)) score += 1;
          return { tool, score };
        })
        .filter(entry => entry.score > 0)
        .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
        .slice(0, 20)
        .map(entry => entry.tool);
    }

    function renderPicker(options) {
      currentOptions = options;
      if (!options.length) {
        picker.classList.remove('visible');
        picker.innerHTML = '';
        return;
      }
      picker.classList.add('visible');
      activeOptionIndex = Math.min(activeOptionIndex, options.length - 1);
      picker.innerHTML = options.map((tool, idx) => {
        const cls = idx === activeOptionIndex ? 'tool-option active' : 'tool-option';
        return '<div class="' + cls + '" data-tool-name="' + escapeHtml(tool.name) + '">'
          + '<div class="name">' + escapeHtml(tool.name) + '</div>'
          + '<div class="desc">' + escapeHtml(tool.description || 'No description') + '</div>'
          + '</div>';
      }).join('');
    }

    function applyToolMention(toolName) {
      const mention = getCurrentMentionQuery();
      if (!mention) {
        return;
      }
      const caret = input.selectionStart || 0;
      const before = input.value.slice(0, mention.atPos);
      const after = input.value.slice(caret);
      const spaceAfter = after.startsWith(' ') ? '' : ' ';
      input.value = before + '@' + toolName + ' ' + spaceAfter + after;
      const nextPos = (before + '@' + toolName + ' ').length;
      input.focus();
      input.selectionStart = nextPos;
      input.selectionEnd = nextPos;
      picker.classList.remove('visible');
      picker.innerHTML = '';
      redrawMentions();
    }

    function maybeShowPicker() {
      const mention = getCurrentMentionQuery();
      if (!mention) {
        picker.classList.remove('visible');
        picker.innerHTML = '';
        return;
      }
      activeOptionIndex = 0;
      renderPicker(rankTools(mention.query));
    }

    function submitAsk() {
      const question = input.value.trim();
      if (!question) {
        return;
      }
      const preferredTools = extractToolMentions(question);
      appendBubble('user', 'You', '<div>' + escapeHtml(redactSensitiveText(question)) + '</div>');
      const payload = {
        question,
        preferredTools
      };
      vscode.postMessage({ type: 'ask', payload });
      input.value = '';
      mentions.innerHTML = '';
      picker.classList.remove('visible');
      picker.innerHTML = '';
    }

    document.getElementById('askBtn').addEventListener('click', submitAsk);

    input.addEventListener('input', () => {
      redrawMentions();
      maybeShowPicker();
    });

    input.addEventListener('keydown', event => {
      if (picker.classList.contains('visible') && currentOptions.length > 0) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          activeOptionIndex = (activeOptionIndex + 1) % currentOptions.length;
          renderPicker(currentOptions);
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          activeOptionIndex = (activeOptionIndex - 1 + currentOptions.length) % currentOptions.length;
          renderPicker(currentOptions);
          return;
        }
        if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
          event.preventDefault();
          applyToolMention(currentOptions[activeOptionIndex].name);
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          picker.classList.remove('visible');
          return;
        }
      }

      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        submitAsk();
      }
    });

    picker.addEventListener('mousedown', event => {
      const row = event.target.closest('[data-tool-name]');
      if (!row) {
        return;
      }
      const name = row.getAttribute('data-tool-name');
      if (name) {
        applyToolMention(name);
      }
    });

    async function typewriterRender(targetElement, fullText) {
      const text = redactSensitiveText(fullText);
      const batchSize = 3;
      const frameDelay = 12;
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
      if (message.type === 'tools-catalog') {
        toolsCatalog = Array.isArray(message.payload) ? message.payload : [];
        maybeShowPicker();
        return;
      }

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
