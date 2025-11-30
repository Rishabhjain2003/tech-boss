import * as vscode from 'vscode';
import * as path from 'path';
import { GeminiClient } from '../services/geminiClient';

interface SelectedFile {
    path: string;
    content: string;
}

interface GeneratedChange {
    filePath: string;
    originalContent: string;
    newContent: string;
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'techBoss.chatView';
    private _view?: vscode.WebviewView;
    private selectedFiles: SelectedFile[] = [];
    private geminiClient: GeminiClient;
    private pendingChanges: GeneratedChange[] = [];

    constructor(
        private readonly _extensionUri: vscode.Uri,
        geminiClient: GeminiClient
    ) {
        this.geminiClient = geminiClient;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Handle messages from webview
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'addFiles':
                    await this.addFilesToContext();
                    break;
                case 'removeFile':
                    this.removeFile(data.filePath);
                    break;
                case 'generateCode':
                    await this.generateCode(data.prompt);
                    break;
                case 'acceptChange':
                    await this.acceptChange(data.filePath);
                    break;
                case 'rejectChange':
                    this.rejectChange(data.filePath);
                    break;
                case 'viewDiff':
                    await this.viewDiff(data.filePath);
                    break;
            }
        });

        // Update webview with initial state
        this.updateWebview();
    }

    private async addFilesToContext() {
        const files = await vscode.window.showOpenDialog({
            canSelectMany: true,
            canSelectFiles: true,
            canSelectFolders: false,
            openLabel: 'Add to Context',
            filters: {
                'All Files': ['*']
            }
        });

        if (files && files.length > 0) {
            for (const file of files) {
                const content = await vscode.workspace.fs.readFile(file);
                const textContent = Buffer.from(content).toString('utf8');
                
                this.selectedFiles.push({
                    path: file.fsPath,
                    content: textContent
                });
            }
            this.updateWebview();
        }
    }

    private removeFile(filePath: string) {
        this.selectedFiles = this.selectedFiles.filter(f => f.path !== filePath);
        this.updateWebview();
    }

    private async generateCode(prompt: string) {
        if (!prompt || prompt.trim() === '') {
            vscode.window.showErrorMessage('Please enter a prompt');
            return;
        }

        // Show loading state
        this._view?.webview.postMessage({
            type: 'loading',
            loading: true
        });

        try {
            // Build context from selected files
            const contextPrompt = this.buildContextPrompt(prompt);

            // Generate code using Gemini
            const response = await this.geminiClient.getCompletion(contextPrompt);
            
            console.log('=== GEMINI RESPONSE ===');
            console.log(response);
            console.log('=== END RESPONSE ===');

            // Parse the response to extract file changes
            const changes = this.parseGeneratedChanges(response);

            if (changes.length === 0) {
                vscode.window.showWarningMessage('No code changes were generated. Check Debug Console for details.');
                return;
            }

            // Store pending changes
            this.pendingChanges = changes;

            // Update webview with changes
            this._view?.webview.postMessage({
                type: 'changesGenerated',
                changes: changes.map(c => ({
                    filePath: c.filePath,
                    summary: this.generateChangeSummary(c)
                }))
            });
            
            // Update the pending changes display
            this.updateWebview();
            
            vscode.window.showInformationMessage(`✓ Generated ${changes.length} change(s)`);

        } catch (error: any) {
            console.error('Error in generateCode:', error);
            vscode.window.showErrorMessage(`Error generating code: ${error.message}`);
        } finally {
            this._view?.webview.postMessage({
                type: 'loading',
                loading: false
            });
        }
    }

    private buildContextPrompt(userPrompt: string): string {
        let prompt = `You are a code modification assistant. Given the following files and a user request, generate the necessary code changes.

User Request: ${userPrompt}

Context Files:
`;

        for (const file of this.selectedFiles) {
            const fileName = path.basename(file.path);
            prompt += `\n--- File: ${fileName} ---\n`;
            prompt += file.content;
            prompt += `\n--- End of ${fileName} ---\n`;
        }

        prompt += `\n\nIMPORTANT: Format your response EXACTLY as shown below:

FILE: <filename>
OLD:
\`\`\`<language>
<complete original code from the file>
\`\`\`
NEW:
\`\`\`<language>
<complete new code to replace it>
\`\`\`

RULES:
1. Use ONLY the filename (e.g., "multiply.py"), NOT the full path
2. Include the COMPLETE file content in both OLD and NEW blocks
3. The OLD code must match the file EXACTLY (same indentation, spacing, etc.)
4. Specify the language in code blocks (python, javascript, typescript, etc.)

Example:
FILE: example.py
OLD:
\`\`\`python
def old_function():
    return 1
\`\`\`
NEW:
\`\`\`python
def new_function():
    return 2
\`\`\`

Generate the changes now:`;

        return prompt;
    }

    private parseGeneratedChanges(response: string): GeneratedChange[] {
        const changes: GeneratedChange[] = [];
        
        console.log('=== PARSING START ===');
        console.log('Response length:', response.length);
        
        // FIXED: Extract ALL code blocks from response with correct regex
        const codeBlockRegex = /```[\w]*\s*\n([\s\S]*?)```/g;
        const codeBlocks: string[] = [];
        let match;
        
        while ((match = codeBlockRegex.exec(response)) !== null) {
            const code = match[1].trim();
            if (code.length > 0) {
                codeBlocks.push(code);
                console.log(`Found code block ${codeBlocks.length}, length:`, code.length);
            }
        }
        
        console.log('Total code blocks found:', codeBlocks.length);
        
        if (codeBlocks.length === 0) {
            console.log('ERROR: No code blocks found in response');
            vscode.window.showErrorMessage('Gemini did not return any code blocks. Try rephrasing your prompt.');
            return changes;
        }
        
        if (this.selectedFiles.length === 0) {
            console.log('ERROR: No files selected');
            return changes;
        }
        
        // Strategy 1: If we have exactly 2 blocks, treat first as OLD, second as NEW
        if (codeBlocks.length === 2) {
            console.log('Strategy: 2 blocks detected - using first as OLD, second as NEW');
            changes.push({
                filePath: this.selectedFiles[0].path,
                originalContent: codeBlocks[0],
                newContent: codeBlocks[1]
            });
        }
        // Strategy 2: If we have 1 block, use entire file content as OLD, block as NEW
        else if (codeBlocks.length === 1) {
            console.log('Strategy: 1 block detected - replacing entire file');
            changes.push({
                filePath: this.selectedFiles[0].path,
                originalContent: this.selectedFiles[0].content,
                newContent: codeBlocks[0]
            });
        }
        // Strategy 3: Multiple blocks - look for OLD/NEW markers
        else {
            console.log('Strategy: Multiple blocks - looking for OLD/NEW patterns');
            
            // Try to find blocks near OLD/NEW keywords
            const lowerResponse = response.toLowerCase();
            const oldIndex = lowerResponse.indexOf('old');
            const newIndex = lowerResponse.indexOf('new');
            
            if (oldIndex >= 0 && newIndex >= 0 && oldIndex < newIndex) {
                // Find which block comes after OLD and which after NEW
                const blocks = [];
                // FIXED: Use correct regex here too
                const regex = /```[\w]*\s*\n([\s\S]*?)```/g;
                let m;
                while ((m = regex.exec(response)) !== null) {
                    blocks.push({ start: m.index, code: m[1].trim() });
                }
                
                // Find closest block after OLD
                const oldBlock = blocks.find(b => b.start > oldIndex);
                // Find closest block after NEW
                const newBlock = blocks.find(b => b.start > newIndex);
                
                if (oldBlock && newBlock) {
                    console.log('Found OLD/NEW blocks using keyword proximity');
                    changes.push({
                        filePath: this.selectedFiles[0].path,
                        originalContent: oldBlock.code,
                        newContent: newBlock.code
                    });
                }
            }
            
            // Fallback: Just use last block as complete replacement
            if (changes.length === 0) {
                console.log('Fallback: Using last block as complete replacement');
                changes.push({
                    filePath: this.selectedFiles[0].path,
                    originalContent: this.selectedFiles[0].content,
                    newContent: codeBlocks[codeBlocks.length - 1]
                });
            }
        }
        
        console.log('=== PARSING END ===');
        console.log('Changes generated:', changes.length);
        
        if (changes.length > 0) {
            console.log('Change summary:');
            console.log('  File:', changes[0].filePath);
            console.log('  OLD length:', changes[0].originalContent.length);
            console.log('  NEW length:', changes[0].newContent.length);
        }
        
        return changes;
    }

    private generateChangeSummary(change: GeneratedChange): string {
        const oldLines = change.originalContent.split('\n').length;
        const newLines = change.newContent.split('\n').length;
        const diff = newLines - oldLines;
        
        let summary = `${oldLines} → ${newLines} lines`;
        if (diff > 0) {
            summary += ` (+${diff})`;
        } else if (diff < 0) {
            summary += ` (${diff})`;
        }
        
        return summary;
    }

    private async viewDiff(filePath: string) {
        const change = this.pendingChanges.find(c => c.filePath === filePath);
        if (!change) {
            vscode.window.showErrorMessage('Change not found');
            return;
        }

        try {
            // Read current file content
            const fileUri = vscode.Uri.file(change.filePath);
            const currentContent = await vscode.workspace.fs.readFile(fileUri);
            const currentText = Buffer.from(currentContent).toString('utf8');

            // Create modified version
            let modifiedText;
            if (currentText.includes(change.originalContent)) {
                // Replace specific section
                modifiedText = currentText.replace(change.originalContent, change.newContent);
            } else {
                // Replace entire file
                modifiedText = change.newContent;
            }

            // Create temporary documents for diff view
            const originalDoc = await vscode.workspace.openTextDocument({
                content: currentText,
                language: this.getLanguageFromPath(filePath)
            });

            const modifiedDoc = await vscode.workspace.openTextDocument({
                content: modifiedText,
                language: this.getLanguageFromPath(filePath)
            });

            // Show diff
            await vscode.commands.executeCommand(
                'vscode.diff',
                originalDoc.uri,
                modifiedDoc.uri,
                `${path.basename(filePath)} - Proposed Changes`
            );
        } catch (error: any) {
            vscode.window.showErrorMessage(`Error viewing diff: ${error.message}`);
        }
    }

    private async acceptChange(filePath: string) {
        const change = this.pendingChanges.find(c => c.filePath === filePath);
        if (!change) {
            vscode.window.showErrorMessage('Change not found');
            return;
        }

        try {
            // Read current file
            const fileUri = vscode.Uri.file(change.filePath);
            const currentContent = await vscode.workspace.fs.readFile(fileUri);
            const currentText = Buffer.from(currentContent).toString('utf8');

            // Apply change
            let modifiedText;
            if (currentText.includes(change.originalContent)) {
                // Replace specific section
                modifiedText = currentText.replace(change.originalContent, change.newContent);
            } else {
                // Replace entire file
                console.log('Original content not found in file, replacing entire file');
                modifiedText = change.newContent;
            }

            // Write back to file
            await vscode.workspace.fs.writeFile(
                fileUri,
                Buffer.from(modifiedText, 'utf8')
            );

            // Remove from pending changes
            this.pendingChanges = this.pendingChanges.filter(c => c.filePath !== filePath);

            // Update webview
            this.updateWebview();

            vscode.window.showInformationMessage(`✓ Changes applied to ${path.basename(filePath)}`);

        } catch (error: any) {
            console.error('Error accepting change:', error);
            vscode.window.showErrorMessage(`Error applying changes: ${error.message}`);
        }
    }

    private rejectChange(filePath: string) {
        this.pendingChanges = this.pendingChanges.filter(c => c.filePath !== filePath);
        this.updateWebview();
        vscode.window.showInformationMessage(`✗ Changes rejected for ${path.basename(filePath)}`);
    }

    private getLanguageFromPath(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase();
        const languageMap: { [key: string]: string } = {
            '.ts': 'typescript',
            '.js': 'javascript',
            '.py': 'python',
            '.java': 'java',
            '.go': 'go',
            '.rs': 'rust',
            '.cpp': 'cpp',
            '.c': 'c',
            '.cs': 'csharp',
            '.rb': 'ruby',
            '.php': 'php',
            '.html': 'html',
            '.css': 'css',
            '.json': 'json',
            '.xml': 'xml',
            '.md': 'markdown'
        };
        return languageMap[ext] || 'plaintext';
    }

    public clearContext() {
        this.selectedFiles = [];
        this.pendingChanges = [];
        this.updateWebview();
    }

    private updateWebview() {
        if (this._view) {
            this._view.webview.postMessage({
                type: 'update',
                selectedFiles: this.selectedFiles.map(f => ({
                    path: f.path,
                    name: path.basename(f.path)
                })),
                pendingChanges: this.pendingChanges.map(c => ({
                    filePath: c.filePath,
                    fileName: path.basename(c.filePath),
                    summary: this.generateChangeSummary(c)
                }))
            });
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Tech Boss Chat</title>
    <style>
        * {
            box-sizing: border-box;
        }

        body {
            padding: 16px;
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: var(--vscode-sideBar-background);
            margin: 0;
        }

        .section {
            margin-bottom: 24px;
        }

        .section-title {
            font-weight: 600;
            font-size: 13px;
            margin-bottom: 12px;
            color: var(--vscode-foreground);
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .file-list {
            margin-bottom: 12px;
        }

        .file-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 12px;
            margin-bottom: 6px;
            background: var(--vscode-list-hoverBackground);
            border: 1px solid var(--vscode-widget-border);
            border-radius: 6px;
            transition: all 0.2s ease;
        }

        .file-item:hover {
            background: var(--vscode-list-activeSelectionBackground);
            border-color: var(--vscode-focusBorder);
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }

        .file-name {
            flex: 1;
            font-size: 13px;
            font-weight: 500;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            color: var(--vscode-foreground);
        }

        .remove-btn {
            background: transparent;
            color: var(--vscode-descriptionForeground);
            border: 1px solid var(--vscode-widget-border);
            padding: 4px 10px;
            cursor: pointer;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 500;
            transition: all 0.2s ease;
            margin-left: 8px;
        }

        .remove-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
            color: var(--vscode-button-secondaryForeground);
            border-color: var(--vscode-button-secondaryForeground);
        }

        .add-files-btn {
            width: 100%;
            padding: 10px 16px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            cursor: pointer;
            border-radius: 6px;
            font-weight: 600;
            font-size: 13px;
            transition: all 0.2s ease;
        }

        .add-files-btn:hover {
            background: var(--vscode-button-hoverBackground);
            transform: translateY(-1px);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
        }

        .add-files-btn:active {
            transform: translateY(0);
        }

        textarea {
            width: 100%;
            min-height: 120px;
            padding: 12px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 6px;
            font-family: var(--vscode-editor-font-family);
            font-size: 13px;
            resize: vertical;
            line-height: 1.5;
            transition: border-color 0.2s ease;
        }

        textarea:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
            box-shadow: 0 0 0 2px var(--vscode-focusBorder);
        }

        textarea::placeholder {
            color: var(--vscode-input-placeholderForeground);
        }

        .generate-btn {
            width: 100%;
            padding: 12px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            cursor: pointer;
            border-radius: 6px;
            margin-top: 12px;
            font-weight: 600;
            font-size: 14px;
            transition: all 0.2s ease;
        }

        .generate-btn:hover {
            background: var(--vscode-button-hoverBackground);
            transform: translateY(-1px);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
        }

        .generate-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
        }

        .generate-btn:active:not(:disabled) {
            transform: translateY(0);
        }

        .change-item {
            padding: 14px;
            margin-bottom: 10px;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            transition: all 0.2s ease;
        }

        .change-item:hover {
            border-color: var(--vscode-focusBorder);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }

        .change-header {
            font-weight: 600;
            font-size: 13px;
            margin-bottom: 8px;
            color: var(--vscode-foreground);
        }

        .change-summary {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 12px;
            padding: 6px 10px;
            background: var(--vscode-textCodeBlock-background);
            border-radius: 4px;
            font-family: var(--vscode-editor-font-family);
        }

        .change-actions {
            display: flex;
            gap: 8px;
        }

        .action-btn {
            flex: 1;
            padding: 8px 12px;
            border: none;
            cursor: pointer;
            border-radius: 5px;
            font-size: 12px;
            font-weight: 600;
            transition: all 0.2s ease;
            text-align: center;
        }

        .action-btn:hover {
            transform: translateY(-1px);
            box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
        }

        .action-btn:active {
            transform: translateY(0);
        }

        .view-btn {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .view-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .accept-btn {
            background: #28a745;
            color: white;
        }

        .accept-btn:hover {
            background: #218838;
        }

        .reject-btn {
            background: #dc3545;
            color: white;
        }

        .reject-btn:hover {
            background: #c82333;
        }

        .loading {
            text-align: center;
            padding: 32px 20px;
            color: var(--vscode-descriptionForeground);
            font-size: 13px;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 12px;
        }

        .loading::before {
            content: "";
            display: block;
            width: 40px;
            height: 40px;
            border: 3px solid var(--vscode-progressBar-background);
            border-top-color: var(--vscode-button-background);
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        .empty-state {
            text-align: center;
            padding: 24px 20px;
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
            background: var(--vscode-textCodeBlock-background);
            border-radius: 6px;
            border: 1px dashed var(--vscode-widget-border);
        }

        .empty-state::before {
            content: "📁";
            display: block;
            font-size: 32px;
            margin-bottom: 8px;
            opacity: 0.5;
        }

        /* Scrollbar styling */
        ::-webkit-scrollbar {
            width: 10px;
        }

        ::-webkit-scrollbar-track {
            background: var(--vscode-scrollbarSlider-background);
        }

        ::-webkit-scrollbar-thumb {
            background: var(--vscode-scrollbarSlider-hoverBackground);
            border-radius: 5px;
        }

        ::-webkit-scrollbar-thumb:hover {
            background: var(--vscode-scrollbarSlider-activeBackground);
        }
    </style>
    </head>
    <body>
    <div class="section">
        <div class="section-title">Context Files</div>
        <div id="fileList" class="file-list"></div>
        <button class="add-files-btn" onclick="addFiles()">+ Add Files to Context</button>
    </div>

    <div class="section">
        <div class="section-title">Prompt</div>
        <textarea id="prompt" placeholder="Describe what code changes you want..."></textarea>
        <button class="generate-btn" id="generateBtn" onclick="generateCode()">Generate Code</button>
    </div>

    <div class="section">
        <div class="section-title">Pending Changes</div>
        <div id="changesList"></div>
    </div>

    <div id="loadingIndicator" class="loading" style="display: none;">
        Generating code...
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let state = {
            selectedFiles: [],
            pendingChanges: []
        };

        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.type) {
                case 'update':
                    state.selectedFiles = message.selectedFiles || [];
                    state.pendingChanges = message.pendingChanges || [];
                    renderUI();
                    break;
                case 'loading':
                    document.getElementById('loadingIndicator').style.display = 
                        message.loading ? 'block' : 'none';
                    document.getElementById('generateBtn').disabled = message.loading;
                    break;
                case 'changesGenerated':
                    break;
            }
        });

        function renderUI() {
            renderFileList();
            renderChangesList();
        }

        function renderFileList() {
            const fileList = document.getElementById('fileList');
            
            if (state.selectedFiles.length === 0) {
                fileList.innerHTML = '<div class="empty-state">No files selected</div>';
                return;
            }
            
            fileList.innerHTML = state.selectedFiles.map(file => \`
                <div class="file-item">
                    <span class="file-name" title="\${file.path}">\${file.name}</span>
                    <button class="remove-btn" onclick="removeFile('\${file.path}')">✕</button>
                </div>
            \`).join('');
        }

        function renderChangesList() {
            const changesList = document.getElementById('changesList');
            
            if (state.pendingChanges.length === 0) {
                changesList.innerHTML = '<div class="empty-state">No pending changes</div>';
                return;
            }
            
            changesList.innerHTML = state.pendingChanges.map(change => \`
                <div class="change-item">
                    <div class="change-header">\${change.fileName}</div>
                    <div class="change-summary">\${change.summary}</div>
                    <div class="change-actions">
                        <button class="action-btn view-btn" onclick="viewDiff('\${change.filePath}')">
                            View Diff
                        </button>
                        <button class="action-btn accept-btn" onclick="acceptChange('\${change.filePath}')">
                            Accept
                        </button>
                        <button class="action-btn reject-btn" onclick="rejectChange('\${change.filePath}')">
                            Reject
                        </button>
                    </div>
                </div>
            \`).join('');
        }

        function addFiles() {
            vscode.postMessage({ type: 'addFiles' });
        }

        function removeFile(filePath) {
            vscode.postMessage({ type: 'removeFile', filePath });
        }

        function generateCode() {
            const prompt = document.getElementById('prompt').value;
            vscode.postMessage({ type: 'generateCode', prompt });
        }

        function viewDiff(filePath) {
            vscode.postMessage({ type: 'viewDiff', filePath });
        }

        function acceptChange(filePath) {
            vscode.postMessage({ type: 'acceptChange', filePath });
        }

        function rejectChange(filePath) {
            vscode.postMessage({ type: 'rejectChange', filePath });
        }

        renderUI();
    </script>
</body>
</html>`;
    }
}
