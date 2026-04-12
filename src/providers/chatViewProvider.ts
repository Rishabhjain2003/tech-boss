import * as vscode from 'vscode';
import { GeminiClient } from '../services/geminiClient';
import { AgentLoop } from '../services/agentLoop';
import { ChatEntry } from '../types';

export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'techBoss.chatView';
    private _view?: vscode.WebviewView;
    private geminiClient: GeminiClient;
    private agentLoop: AgentLoop;
    private chatEntries: ChatEntry[] = [];

    constructor(
        private readonly _extensionUri: vscode.Uri,
        geminiClient: GeminiClient
    ) {
        this.geminiClient = geminiClient;
        this.agentLoop = new AgentLoop(geminiClient, (entry) => this.handleAgentUpdate(entry));
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview();

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'sendMessage':
                    await this.handleUserMessage(data.message);
                    break;
                case 'stopAgent':
                    this.agentLoop.stop();
                    break;
                case 'newChat':
                    this.resetChat();
                    break;
            }
        });
    }

    /**
     * Reset everything for a new chat.
     */
    public resetChat() {
        this.agentLoop.reset();
        this.chatEntries = [];
        this._view?.webview.postMessage({ type: 'clearChat' });
    }

    /**
     * Handle a user message: add to UI and kick off the agent loop.
     */
    private async handleUserMessage(message: string) {
        if (!message || message.trim() === '') { return; }

        // Add user message to entries
        this.addEntry({
            id: `user-${Date.now()}`,
            type: 'user',
            content: message,
            timestamp: Date.now()
        });

        // Show running state
        this._view?.webview.postMessage({ type: 'agentRunning', running: true });

        try {
            await this.agentLoop.run(message);
        } catch (err: any) {
            this.addEntry({
                id: `error-${Date.now()}`,
                type: 'error',
                content: `❌ ${err.message}`,
                timestamp: Date.now()
            });
        } finally {
            this._view?.webview.postMessage({ type: 'agentRunning', running: false });
        }
    }

    /**
     * Handle updates from the agent loop.
     */
    private handleAgentUpdate(entry: ChatEntry) {
        // If it's a "thinking" entry with empty content, remove it
        if (entry.type === 'thinking' && entry.content === '') {
            this._view?.webview.postMessage({
                type: 'removeEntry',
                id: entry.id
            });
            return;
        }

        this.addEntry(entry);
    }

    private addEntry(entry: ChatEntry) {
        this.chatEntries.push(entry);
        this._view?.webview.postMessage({
            type: 'addEntry',
            entry
        });
    }

    private _getHtmlForWebview(): string {
        return /*html*/`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Tech Boss Agent</title>
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: var(--vscode-sideBar-background);
            height: 100vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        /* ==================== HEADER ==================== */
        .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 14px;
            border-bottom: 1px solid var(--vscode-panel-border);
            background: var(--vscode-sideBar-background);
            flex-shrink: 0;
        }

        .header-title {
            font-weight: 700;
            font-size: 13px;
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .header-title .icon {
            font-size: 16px;
        }

        .header-actions {
            display: flex;
            gap: 6px;
        }

        .header-btn {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            padding: 4px 10px;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.15s ease;
        }

        .header-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .header-btn.danger {
            background: #c53030;
            color: white;
        }

        .header-btn.danger:hover {
            background: #e53e3e;
        }

        /* ==================== CHAT AREA ==================== */
        .chat-area {
            flex: 1;
            overflow-y: auto;
            padding: 12px;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .welcome-message {
            text-align: center;
            padding: 40px 20px;
            color: var(--vscode-descriptionForeground);
        }

        .welcome-message .welcome-icon {
            font-size: 48px;
            margin-bottom: 12px;
            opacity: 0.6;
        }

        .welcome-message h3 {
            font-size: 15px;
            font-weight: 600;
            color: var(--vscode-foreground);
            margin-bottom: 8px;
        }

        .welcome-message p {
            font-size: 12px;
            line-height: 1.6;
            max-width: 280px;
            margin: 0 auto;
        }

        .welcome-message .examples {
            margin-top: 16px;
            text-align: left;
            display: inline-block;
        }

        .welcome-message .example-item {
            display: block;
            padding: 6px 12px;
            margin: 4px 0;
            background: var(--vscode-textCodeBlock-background);
            border-radius: 6px;
            font-size: 11px;
            cursor: pointer;
            transition: all 0.15s ease;
            border: 1px solid transparent;
        }

        .welcome-message .example-item:hover {
            border-color: var(--vscode-focusBorder);
            background: var(--vscode-list-hoverBackground);
        }

        /* ==================== ENTRIES ==================== */
        .entry {
            border-radius: 8px;
            padding: 10px 14px;
            font-size: 13px;
            line-height: 1.55;
            animation: fadeIn 0.2s ease;
        }

        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(4px); }
            to { opacity: 1; transform: translateY(0); }
        }

        /* User message */
        .entry.user {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            align-self: flex-end;
            max-width: 85%;
            border-radius: 12px 12px 4px 12px;
        }

        /* Agent response */
        .entry.agent {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            max-width: 95%;
        }

        .entry.agent pre {
            background: var(--vscode-textCodeBlock-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            padding: 10px 12px;
            margin: 8px 0;
            overflow-x: auto;
            font-family: var(--vscode-editor-font-family);
            font-size: 12px;
            line-height: 1.5;
        }

        .entry.agent code {
            font-family: var(--vscode-editor-font-family);
            font-size: 12px;
            background: var(--vscode-textCodeBlock-background);
            padding: 2px 5px;
            border-radius: 3px;
        }

        .entry.agent pre code {
            background: transparent;
            padding: 0;
        }

        .entry.agent p {
            margin: 6px 0;
        }

        .entry.agent p:first-child {
            margin-top: 0;
        }

        .entry.agent p:last-child {
            margin-bottom: 0;
        }

        .entry.agent ul, .entry.agent ol {
            margin: 6px 0;
            padding-left: 20px;
        }

        .entry.agent li {
            margin: 2px 0;
        }

        .entry.agent h1, .entry.agent h2, .entry.agent h3 {
            margin: 10px 0 6px 0;
            font-weight: 600;
        }

        .entry.agent h1 { font-size: 16px; }
        .entry.agent h2 { font-size: 14px; }
        .entry.agent h3 { font-size: 13px; }

        .entry.agent strong { font-weight: 600; }

        /* Tool call */
        .entry.tool_call {
            background: var(--vscode-textCodeBlock-background);
            border-left: 3px solid var(--vscode-charts-blue);
            padding: 8px 12px;
            font-size: 12px;
            font-family: var(--vscode-editor-font-family);
            color: var(--vscode-descriptionForeground);
            border-radius: 4px;
        }

        /* Tool result */
        .entry.tool_result {
            background: var(--vscode-textCodeBlock-background);
            border-left: 3px solid var(--vscode-charts-green);
            padding: 8px 12px;
            font-size: 11px;
            font-family: var(--vscode-editor-font-family);
            color: var(--vscode-descriptionForeground);
            max-height: 200px;
            overflow-y: auto;
            border-radius: 4px;
            cursor: pointer;
            transition: max-height 0.3s ease;
        }

        .entry.tool_result.expanded {
            max-height: none;
        }

        .entry.tool_result .toggle-hint {
            font-size: 10px;
            color: var(--vscode-charts-blue);
            margin-top: 4px;
            opacity: 0.7;
        }

        /* Error */
        .entry.error {
            background: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            border-radius: 6px;
            font-size: 12px;
        }

        /* Thinking */
        .entry.thinking {
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
            font-style: italic;
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 12px;
        }

        .entry.thinking::before {
            content: "";
            display: inline-block;
            width: 14px;
            height: 14px;
            border: 2px solid var(--vscode-descriptionForeground);
            border-top-color: var(--vscode-button-background);
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        /* ==================== INPUT AREA ==================== */
        .input-area {
            padding: 10px 12px;
            border-top: 1px solid var(--vscode-panel-border);
            background: var(--vscode-sideBar-background);
            flex-shrink: 0;
        }

        .input-container {
            display: flex;
            gap: 8px;
            align-items: flex-end;
        }

        .input-textarea {
            flex: 1;
            min-height: 36px;
            max-height: 150px;
            padding: 8px 12px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 8px;
            font-family: var(--vscode-font-family);
            font-size: 13px;
            resize: none;
            line-height: 1.4;
            transition: border-color 0.15s ease;
            overflow-y: auto;
        }

        .input-textarea:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }

        .input-textarea::placeholder {
            color: var(--vscode-input-placeholderForeground);
        }

        .send-btn {
            width: 36px;
            height: 36px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 8px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 16px;
            transition: all 0.15s ease;
            flex-shrink: 0;
        }

        .send-btn:hover {
            background: var(--vscode-button-hoverBackground);
            transform: scale(1.05);
        }

        .send-btn:disabled {
            opacity: 0.4;
            cursor: not-allowed;
            transform: none;
        }

        .send-btn.stop {
            background: #c53030;
        }

        .send-btn.stop:hover {
            background: #e53e3e;
        }

        /* ==================== SCROLLBAR ==================== */
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb {
            background: var(--vscode-scrollbarSlider-background);
            border-radius: 3px;
        }
        ::-webkit-scrollbar-thumb:hover {
            background: var(--vscode-scrollbarSlider-hoverBackground);
        }

        /* Whitespace rendering in tool results */
        .preserve-ws {
            white-space: pre-wrap;
            word-break: break-word;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-title">
            <span class="icon">⚡</span>
            <span>Tech Boss Agent</span>
        </div>
        <div class="header-actions">
            <button class="header-btn" onclick="newChat()">New Chat</button>
        </div>
    </div>

    <div class="chat-area" id="chatArea">
        <div class="welcome-message" id="welcome">
            <div class="welcome-icon">🤖</div>
            <h3>Tech Boss Agent</h3>
            <p>I can read & edit files, run commands, search your workspace, and more. Try:</p>
            <div class="examples">
                <span class="example-item" onclick="useExample('List the files in this project')">📂 List the files in this project</span>
                <span class="example-item" onclick="useExample('Read package.json and explain what this project does')">📖 What does this project do?</span>
                <span class="example-item" onclick="useExample('Find all TODO comments in the codebase')">🔍 Find all TODOs</span>
                <span class="example-item" onclick="useExample('Run npm run compile and fix any errors')">💻 Compile & fix errors</span>
            </div>
        </div>
    </div>

    <div class="input-area">
        <div class="input-container">
            <textarea
                class="input-textarea"
                id="messageInput"
                placeholder="Ask Tech Boss anything..."
                rows="1"
            ></textarea>
            <button class="send-btn" id="sendBtn" onclick="sendMessage()" title="Send">
                ▶
            </button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let isAgentRunning = false;

        // ===== Auto-resize textarea =====
        const messageInput = document.getElementById('messageInput');
        messageInput.addEventListener('input', () => {
            messageInput.style.height = 'auto';
            messageInput.style.height = Math.min(messageInput.scrollHeight, 150) + 'px';
        });

        // ===== Enter to send =====
        messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!isAgentRunning) {
                    sendMessage();
                }
            }
        });

        // ===== Send message =====
        function sendMessage() {
            const msg = messageInput.value.trim();
            if (!msg) return;

            if (isAgentRunning) {
                // Stop the agent
                vscode.postMessage({ type: 'stopAgent' });
                return;
            }

            // Hide welcome
            const welcome = document.getElementById('welcome');
            if (welcome) welcome.style.display = 'none';

            messageInput.value = '';
            messageInput.style.height = 'auto';

            vscode.postMessage({ type: 'sendMessage', message: msg });
        }

        // ===== Use example prompt =====
        function useExample(text) {
            messageInput.value = text;
            messageInput.style.height = 'auto';
            messageInput.style.height = Math.min(messageInput.scrollHeight, 150) + 'px';
            messageInput.focus();
        }

        // ===== New chat =====
        function newChat() {
            vscode.postMessage({ type: 'newChat' });
        }

        // ===== Handle messages from extension =====
        window.addEventListener('message', event => {
            const msg = event.data;

            switch (msg.type) {
                case 'addEntry':
                    renderEntry(msg.entry);
                    break;
                case 'removeEntry':
                    removeEntry(msg.id);
                    break;
                case 'clearChat':
                    clearChat();
                    break;
                case 'agentRunning':
                    setAgentRunning(msg.running);
                    break;
            }
        });

        // ===== Render an entry =====
        function renderEntry(entry) {
            const chatArea = document.getElementById('chatArea');
            const div = document.createElement('div');
            div.id = 'entry-' + entry.id;
            div.className = 'entry ' + entry.type;

            switch (entry.type) {
                case 'user':
                    div.textContent = entry.content;
                    break;
                case 'agent':
                    div.innerHTML = renderMarkdown(entry.content);
                    break;
                case 'tool_call':
                    div.textContent = entry.content;
                    break;
                case 'tool_result':
                    const content = entry.content;
                    const lines = content.split('\\n');
                    const isLong = lines.length > 8;

                    if (isLong) {
                        div.innerHTML = '<div class="preserve-ws">' + escapeHtml(content) + '</div>' +
                            '<div class="toggle-hint">Click to expand/collapse</div>';
                        div.style.maxHeight = '150px';
                        div.addEventListener('click', () => {
                            div.classList.toggle('expanded');
                        });
                    } else {
                        div.innerHTML = '<div class="preserve-ws">' + escapeHtml(content) + '</div>';
                    }
                    break;
                case 'error':
                    div.textContent = entry.content;
                    break;
                case 'thinking':
                    div.textContent = entry.content;
                    break;
            }

            chatArea.appendChild(div);
            chatArea.scrollTop = chatArea.scrollHeight;
        }

        // ===== Remove an entry by ID =====
        function removeEntry(id) {
            const el = document.getElementById('entry-' + id);
            if (el) el.remove();
        }

        // ===== Clear chat =====
        function clearChat() {
            const chatArea = document.getElementById('chatArea');
            chatArea.innerHTML = '';

            // Re-add welcome
            chatArea.innerHTML = \`
                <div class="welcome-message" id="welcome">
                    <div class="welcome-icon">🤖</div>
                    <h3>Tech Boss Agent</h3>
                    <p>I can read & edit files, run commands, search your workspace, and more. Try:</p>
                    <div class="examples">
                        <span class="example-item" onclick="useExample('List the files in this project')">📂 List the files in this project</span>
                        <span class="example-item" onclick="useExample('Read package.json and explain what this project does')">📖 What does this project do?</span>
                        <span class="example-item" onclick="useExample('Find all TODO comments in the codebase')">🔍 Find all TODOs</span>
                        <span class="example-item" onclick="useExample('Run npm run compile and fix any errors')">💻 Compile & fix errors</span>
                    </div>
                </div>
            \`;
        }

        // ===== Set agent running state =====
        function setAgentRunning(running) {
            isAgentRunning = running;
            const sendBtn = document.getElementById('sendBtn');
            const input = document.getElementById('messageInput');

            if (running) {
                sendBtn.innerHTML = '⏹';
                sendBtn.className = 'send-btn stop';
                sendBtn.title = 'Stop Agent';
                input.placeholder = 'Agent is working... click ⏹ to stop';
                input.disabled = true;
            } else {
                sendBtn.innerHTML = '▶';
                sendBtn.className = 'send-btn';
                sendBtn.title = 'Send';
                input.placeholder = 'Ask Tech Boss anything...';
                input.disabled = false;
                input.focus();
            }
        }

        // ===== Simple markdown renderer =====
        function renderMarkdown(text) {
            if (!text) return '';
            let html = escapeHtml(text);

            // Backtick char for regex
            var BT = String.fromCharCode(96);
            var BT3 = BT + BT + BT;

            // Code blocks (triple backtick blocks)
            var cbRegex = new RegExp(BT3 + '(\\\\w*)\\\\n([\\\\s\\\\S]*?)' + BT3, 'g');
            html = html.replace(cbRegex, function(_, lang, code) {
                return '<pre><code>' + code.trim() + '</code></pre>';
            });

            // Inline code (single backtick)
            var icRegex = new RegExp(BT + '([^' + BT + ']+)' + BT, 'g');
            html = html.replace(icRegex, '<code>$1</code>');

            // Bold
            html = html.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');

            // Italic
            html = html.replace(/\\*([^*]+)\\*/g, '<em>$1</em>');

            // Headers
            html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
            html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
            html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

            // Unordered lists
            html = html.replace(/^[\\-\\*] (.+)$/gm, '<li>$1</li>');

            // Wrap consecutive li in ul
            html = html.replace(/((?:<li>.*<\\/li>\\n?)+)/g, '<ul>$1</ul>');

            // Paragraphs: split by double newlines
            html = html.split(/\\n\\n+/).map(function(p) {
                p = p.trim();
                if (!p) return '';
                if (p.startsWith('<h') || p.startsWith('<pre') || p.startsWith('<ul') || p.startsWith('<ol')) {
                    return p;
                }
                return '<p>' + p.replace(/\\n/g, '<br>') + '</p>';
            }).join('');

            return html;
        }

        // ===== Escape HTML =====
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        // Focus input on load
        messageInput.focus();
    </script>
</body>
</html>`;
    }
}
