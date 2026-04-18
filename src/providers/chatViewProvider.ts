import * as vscode from 'vscode';
import { GeminiClient } from '../services/geminiClient';
import { WorkspaceTree } from '../services/workspaceTree';
import { SnapshotManager } from '../services/snapshotManager';
import { ContextPacker } from '../services/contextPacker';
import { AgentLoop } from '../services/agentLoop';
import { buildToolMap, ToolContext } from '../services/tools';
import { AgentMessage } from '../types';

export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'techBoss.chatView';
    private _view?: vscode.WebviewView;
    private geminiClient: GeminiClient;
    private workspaceTree: WorkspaceTree;
    private snapshotManager: SnapshotManager;
    private contextPacker: ContextPacker;
    private agentLoop: AgentLoop | null = null;
    private isRunning = false;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        geminiClient: GeminiClient,
        private readonly workspaceRoot: string,
    ) {
        this.geminiClient = geminiClient;
        this.workspaceTree = new WorkspaceTree(workspaceRoot);
        this.snapshotManager = new SnapshotManager(this.workspaceTree);
        this.contextPacker = new ContextPacker(this.workspaceTree);

        // Take initial snapshot
        this.workspaceTree.takeSnapshot('initial');
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
        };

        webviewView.webview.html = this._getHtmlForWebview();

        // Handle messages from webview
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'sendMessage':
                    await this.handleUserMessage(data.text);
                    break;
                case 'newChat':
                    this.resetChat();
                    break;
                case 'cancel':
                    this.cancelAgent();
                    break;
            }
        });
    }

    /** Handle incoming user message, start the agent loop */
    private async handleUserMessage(text: string): Promise<void> {
        if (!text || text.trim() === '' || this.isRunning) { return; }

        this.isRunning = true;
        this._view?.webview.postMessage({ type: 'agentMessage', message: { type: 'user', content: text } });
        this._view?.webview.postMessage({ type: 'status', running: true });

        // Create agent loop if not exists
        if (!this.agentLoop) {
            const toolMap = buildToolMap();
            const toolContext: ToolContext = {
                workspaceRoot: this.workspaceRoot,
                workspaceTree: this.workspaceTree,
                snapshotManager: this.snapshotManager,
            };

            this.agentLoop = new AgentLoop(
                this.geminiClient,
                toolMap,
                toolContext,
                this.contextPacker,
                (msg: AgentMessage) => {
                    this._view?.webview.postMessage({ type: 'agentMessage', message: msg });
                },
                () => {
                    this.isRunning = false;
                    this._view?.webview.postMessage({ type: 'done' });
                    this._view?.webview.postMessage({ type: 'status', running: false });
                },
            );
        }

        try {
            await this.agentLoop.run(text);
        } catch (err: any) {
            this._view?.webview.postMessage({
                type: 'agentMessage',
                message: { type: 'error', content: `Fatal error: ${err.message}` },
            });
            this.isRunning = false;
            this._view?.webview.postMessage({ type: 'status', running: false });
        }
    }

    /** Reset the chat — clears history and creates a new agent loop */
    public resetChat(): void {
        this.agentLoop?.cancel();
        this.agentLoop = null;
        this.isRunning = false;
        this._view?.webview.postMessage({ type: 'reset' });
        this._view?.webview.postMessage({ type: 'status', running: false });
    }

    /** Cancel running agent */
    private cancelAgent(): void {
        this.agentLoop?.cancel();
    }

    /** Generate the webview HTML */
    private _getHtmlForWebview(): string {
        return /*html*/ `<!DOCTYPE html>
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

        /* ─── Toolbar ─── */
        .toolbar {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 10px 14px;
            border-bottom: 1px solid var(--vscode-panel-border);
            background: var(--vscode-sideBar-background);
            flex-shrink: 0;
        }

        .toolbar-title {
            flex: 1;
            font-weight: 600;
            font-size: 13px;
            letter-spacing: 0.3px;
        }

        .toolbar-btn {
            padding: 4px 10px;
            font-size: 11px;
            font-weight: 600;
            border: 1px solid var(--vscode-button-border, var(--vscode-widget-border));
            border-radius: 4px;
            cursor: pointer;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            transition: all 0.15s ease;
        }

        .toolbar-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .toolbar-btn.stop {
            background: #c53030;
            color: white;
            border-color: #c53030;
            display: none;
        }

        .toolbar-btn.stop.visible {
            display: inline-block;
        }

        .toolbar-btn.stop:hover {
            background: #e53e3e;
        }

        /* ─── Messages ─── */
        .messages {
            flex: 1;
            overflow-y: auto;
            padding: 12px 14px;
            display: flex;
            flex-direction: column;
            gap: 10px;
        }

        .message {
            max-width: 95%;
            padding: 10px 14px;
            border-radius: 10px;
            font-size: 13px;
            line-height: 1.55;
            word-wrap: break-word;
            animation: fadeIn 0.2s ease;
        }

        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(6px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .message.user {
            align-self: flex-end;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border-bottom-right-radius: 3px;
        }

        .message.assistant {
            align-self: flex-start;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-bottom-left-radius: 3px;
        }

        .message.assistant pre {
            background: var(--vscode-textCodeBlock-background);
            padding: 8px 10px;
            border-radius: 5px;
            overflow-x: auto;
            margin: 6px 0;
            font-family: var(--vscode-editor-font-family);
            font-size: 12px;
            line-height: 1.4;
        }

        .message.assistant code {
            background: var(--vscode-textCodeBlock-background);
            padding: 1px 4px;
            border-radius: 3px;
            font-family: var(--vscode-editor-font-family);
            font-size: 12px;
        }

        .message.assistant pre code {
            background: none;
            padding: 0;
        }

        .message.error {
            align-self: flex-start;
            background: rgba(220, 53, 69, 0.12);
            border: 1px solid rgba(220, 53, 69, 0.3);
            color: var(--vscode-errorForeground, #f48771);
        }

        /* ─── Tool Cards ─── */
        .tool-card {
            align-self: flex-start;
            max-width: 95%;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            overflow: hidden;
            animation: fadeIn 0.2s ease;
        }

        .tool-header {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            cursor: pointer;
            user-select: none;
            font-size: 12px;
            font-weight: 600;
            transition: background 0.15s ease;
        }

        .tool-header:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .tool-icon {
            font-size: 14px;
            flex-shrink: 0;
        }

        .tool-name {
            flex: 1;
            color: var(--vscode-descriptionForeground);
        }

        .tool-chevron {
            font-size: 10px;
            transition: transform 0.2s ease;
            color: var(--vscode-descriptionForeground);
        }

        .tool-chevron.open {
            transform: rotate(90deg);
        }

        .tool-body {
            display: none;
            padding: 0 12px 10px;
            font-size: 12px;
        }

        .tool-body.open {
            display: block;
        }

        .tool-params, .tool-result {
            background: var(--vscode-textCodeBlock-background);
            padding: 8px 10px;
            border-radius: 5px;
            margin-top: 6px;
            font-family: var(--vscode-editor-font-family);
            font-size: 11px;
            line-height: 1.4;
            white-space: pre-wrap;
            word-break: break-all;
            max-height: 200px;
            overflow-y: auto;
        }

        .tool-label {
            font-size: 10px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--vscode-descriptionForeground);
            margin-top: 8px;
        }

        /* ─── Status ─── */
        .status {
            padding: 8px 14px;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            display: none;
            align-items: center;
            gap: 8px;
            flex-shrink: 0;
        }

        .status.visible {
            display: flex;
        }

        .spinner {
            width: 14px;
            height: 14px;
            border: 2px solid var(--vscode-progressBar-background);
            border-top-color: var(--vscode-button-background);
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        /* ─── Input Area ─── */
        .input-area {
            padding: 10px 14px;
            border-top: 1px solid var(--vscode-panel-border);
            background: var(--vscode-sideBar-background);
            flex-shrink: 0;
        }

        .input-wrapper {
            display: flex;
            gap: 8px;
            align-items: flex-end;
        }

        .input-wrapper textarea {
            flex: 1;
            padding: 8px 12px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 6px;
            font-family: var(--vscode-font-family);
            font-size: 13px;
            resize: none;
            min-height: 36px;
            max-height: 120px;
            line-height: 1.4;
            outline: none;
            transition: border-color 0.15s ease;
        }

        .input-wrapper textarea:focus {
            border-color: var(--vscode-focusBorder);
        }

        .input-wrapper textarea::placeholder {
            color: var(--vscode-input-placeholderForeground);
        }

        .send-btn {
            padding: 8px 14px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 600;
            font-size: 13px;
            transition: all 0.15s ease;
            white-space: nowrap;
        }

        .send-btn:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .send-btn:disabled {
            opacity: 0.4;
            cursor: not-allowed;
        }

        /* ─── Empty State ─── */
        .empty-state {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 32px 20px;
            color: var(--vscode-descriptionForeground);
            text-align: center;
        }

        .empty-state-icon {
            font-size: 48px;
            margin-bottom: 16px;
            opacity: 0.5;
        }

        .empty-state-title {
            font-size: 16px;
            font-weight: 600;
            color: var(--vscode-foreground);
            margin-bottom: 8px;
        }

        .empty-state-desc {
            font-size: 12px;
            line-height: 1.6;
            max-width: 260px;
        }

        /* ─── Scrollbar ─── */
        ::-webkit-scrollbar { width: 8px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb {
            background: var(--vscode-scrollbarSlider-background);
            border-radius: 4px;
        }
        ::-webkit-scrollbar-thumb:hover {
            background: var(--vscode-scrollbarSlider-hoverBackground);
        }
    </style>
</head>
<body>

    <!-- Toolbar -->
    <div class="toolbar">
        <span class="toolbar-title">⚡ Tech Boss</span>
        <button class="toolbar-btn stop" id="stopBtn" onclick="cancelAgent()">■ Stop</button>
        <button class="toolbar-btn" onclick="newChat()">+ New Chat</button>
    </div>

    <!-- Messages -->
    <div class="messages" id="messages">
        <div class="empty-state" id="emptyState">
            <div class="empty-state-icon">🤖</div>
            <div class="empty-state-title">Tech Boss Agent</div>
            <div class="empty-state-desc">
                Ask me to read, write, or edit files, run commands, search your workspace, or debug errors. I'll handle it autonomously.
            </div>
        </div>
    </div>

    <!-- Status -->
    <div class="status" id="status">
        <div class="spinner"></div>
        <span>Agent is thinking...</span>
    </div>

    <!-- Input -->
    <div class="input-area">
        <div class="input-wrapper">
            <textarea
                id="input"
                placeholder="Ask Tech Boss anything..."
                rows="1"
                onkeydown="handleKeyDown(event)"
                oninput="autoResize(this)"
            ></textarea>
            <button class="send-btn" id="sendBtn" onclick="sendMessage()">Send</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let messageCount = 0;

        const TOOL_ICONS = {
            read_file: '📄',
            write_file: '✏️',
            edit_file: '🔧',
            list_directory: '📁',
            run_terminal: '💻',
            search_workspace: '🔍',
            get_diagnostics: '⚠️',
            open_file: '📂',
            get_blob: '🗃️',
            get_tree_manifest: '🌳',
        };

        // ─── Message Handling ───

        window.addEventListener('message', event => {
            const data = event.data;
            switch (data.type) {
                case 'agentMessage':
                    addMessage(data.message);
                    break;
                case 'done':
                    // Agent loop finished
                    break;
                case 'reset':
                    resetMessages();
                    break;
                case 'status':
                    setStatus(data.running);
                    break;
            }
        });

        function addMessage(msg) {
            // Hide empty state
            const emptyState = document.getElementById('emptyState');
            if (emptyState) emptyState.style.display = 'none';

            const container = document.getElementById('messages');
            messageCount++;

            if (msg.type === 'tool_call' || msg.type === 'tool_result') {
                addToolMessage(msg, container);
            } else {
                const div = document.createElement('div');
                div.className = 'message ' + msg.type;
                div.innerHTML = msg.type === 'assistant' ? renderMarkdown(msg.content) : escapeHtml(msg.content);
                container.appendChild(div);
            }

            container.scrollTop = container.scrollHeight;
        }

        function addToolMessage(msg, container) {
            const cardId = 'tool-' + messageCount;

            if (msg.type === 'tool_call') {
                const card = document.createElement('div');
                card.className = 'tool-card';
                card.id = cardId;

                const icon = TOOL_ICONS[msg.toolName] || '🔧';
                card.innerHTML = [
                    '<div class="tool-header" onclick="toggleTool(\\'' + cardId + '\\')" >',
                    '  <span class="tool-icon">' + icon + '</span>',
                    '  <span class="tool-name">' + escapeHtml(msg.toolName || '') + '</span>',
                    '  <span class="tool-chevron" id="chevron-' + cardId + '">▶</span>',
                    '</div>',
                    '<div class="tool-body" id="body-' + cardId + '">',
                    '  <div class="tool-label">Parameters</div>',
                    '  <div class="tool-params">' + escapeHtml(JSON.stringify(msg.toolParams, null, 2)) + '</div>',
                    '</div>',
                ].join('\\n');

                container.appendChild(card);
            } else if (msg.type === 'tool_result') {
                // Find the last tool card and append result
                const cards = container.querySelectorAll('.tool-card');
                const lastCard = cards[cards.length - 1];
                if (lastCard) {
                    const body = lastCard.querySelector('.tool-body');
                    if (body) {
                        const resultHtml = [
                            '<div class="tool-label">Result</div>',
                            '<div class="tool-result">' + escapeHtml(msg.content) + '</div>',
                        ].join('\\n');
                        body.innerHTML += resultHtml;
                    }
                }
            }
        }

        function toggleTool(cardId) {
            const body = document.getElementById('body-' + cardId);
            const chevron = document.getElementById('chevron-' + cardId);
            if (body && chevron) {
                body.classList.toggle('open');
                chevron.classList.toggle('open');
            }
        }

        function resetMessages() {
            const container = document.getElementById('messages');
            container.innerHTML = [
                '<div class="empty-state" id="emptyState">',
                '  <div class="empty-state-icon">🤖</div>',
                '  <div class="empty-state-title">Tech Boss Agent</div>',
                '  <div class="empty-state-desc">',
                '    Ask me to read, write, or edit files, run commands, search your workspace, or debug errors. I\\\'ll handle it autonomously.',
                '  </div>',
                '</div>',
            ].join('\\n');
            messageCount = 0;
        }

        function setStatus(running) {
            document.getElementById('status').classList.toggle('visible', running);
            document.getElementById('stopBtn').classList.toggle('visible', running);
            document.getElementById('sendBtn').disabled = running;
            document.getElementById('input').disabled = running;
        }

        // ─── Input ───

        function handleKeyDown(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        }

        function sendMessage() {
            const input = document.getElementById('input');
            const text = input.value.trim();
            if (!text) return;

            vscode.postMessage({ type: 'sendMessage', text });
            input.value = '';
            input.style.height = '36px';
        }

        function autoResize(el) {
            el.style.height = '36px';
            el.style.height = Math.min(el.scrollHeight, 120) + 'px';
        }

        function newChat() {
            vscode.postMessage({ type: 'newChat' });
        }

        function cancelAgent() {
            vscode.postMessage({ type: 'cancel' });
        }

        // ─── Markdown Rendering (lightweight) ───

        function renderMarkdown(text) {
            if (!text) return '';
            let html = escapeHtml(text);

            // Code blocks
            html = html.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, function(m, code) {
                return '<pre><code>' + code.trim() + '</code></pre>';
            });

            // Inline code
            html = html.replace(/\`([^\`]+)\`/g, '<code>$1</code>');

            // Bold
            html = html.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');

            // Italic
            html = html.replace(/(?<!\\*)\\*([^*]+)\\*(?!\\*)/g, '<em>$1</em>');

            // Line breaks
            html = html.replace(/\\n/g, '<br>');

            return html;
        }

        function escapeHtml(text) {
            if (!text) return '';
            return text
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        }
    </script>
</body>
</html>`;
    }
}
