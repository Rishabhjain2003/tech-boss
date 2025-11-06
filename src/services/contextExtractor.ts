import * as vscode from 'vscode';

export interface CodeContext {
    language: string;
    fileName: string;
    beforeCursor: string;
    afterCursor: string;
    currentLine: string;
    cursorPosition: vscode.Position;
    surroundingLines: string;
    functionContext?: string;
}

export class ContextExtractor {
    private readonly MAX_CONTEXT_LENGTH = 2000;
    private readonly SURROUNDING_LINES = 10;

    extractContext(
        document: vscode.TextDocument,
        position: vscode.Position
    ): CodeContext {
        const languageId = document.languageId;
        const fileName = document.fileName.split('/').pop() || '';
        
        // Get current line
        const currentLine = document.lineAt(position.line).text;
        const cursorColumn = position.character;

        // Get text before cursor
        const beforeCursor = this.getTextBeforeCursor(document, position);

        // Get text after cursor
        const afterCursor = this.getTextAfterCursor(document, position);

        // Get surrounding lines for context
        const surroundingLines = this.getSurroundingLines(document, position);

        // Try to detect function/class context
        const functionContext = this.getFunctionContext(document, position);

        return {
            language: languageId,
            fileName,
            beforeCursor,
            afterCursor,
            currentLine,
            cursorPosition: position,
            surroundingLines,
            functionContext
        };
    }

    private getTextBeforeCursor(
        document: vscode.TextDocument,
        position: vscode.Position
    ): string {
        const startPos = new vscode.Position(
            Math.max(0, position.line - 50),
            0
        );
        const range = new vscode.Range(startPos, position);
        let text = document.getText(range);

        // Limit context length
        if (text.length > this.MAX_CONTEXT_LENGTH) {
            text = text.slice(-this.MAX_CONTEXT_LENGTH);
        }

        return text;
    }

    private getTextAfterCursor(
        document: vscode.TextDocument,
        position: vscode.Position
    ): string {
        const endPos = new vscode.Position(
            Math.min(document.lineCount - 1, position.line + 10),
            0
        );
        const range = new vscode.Range(position, endPos);
        let text = document.getText(range);

        // Limit to 500 characters
        if (text.length > 500) {
            text = text.slice(0, 500);
        }

        return text;
    }

    private getSurroundingLines(
        document: vscode.TextDocument,
        position: vscode.Position
    ): string {
        const startLine = Math.max(0, position.line - this.SURROUNDING_LINES);
        const endLine = Math.min(
            document.lineCount - 1,
            position.line + this.SURROUNDING_LINES
        );

        const lines: string[] = [];
        for (let i = startLine; i <= endLine; i++) {
            lines.push(document.lineAt(i).text);
        }

        return lines.join('\n');
    }

    private getFunctionContext(
        document: vscode.TextDocument,
        position: vscode.Position
    ): string | undefined {
        // Simple heuristic: look backwards for function/method/class definitions
        const languageId = document.languageId;
        const patterns = this.getFunctionPatterns(languageId);

        for (let i = position.line; i >= Math.max(0, position.line - 50); i--) {
            const line = document.lineAt(i).text;
            
            for (const pattern of patterns) {
                if (pattern.test(line)) {
                    return line.trim();
                }
            }
        }

        return undefined;
    }

    private getFunctionPatterns(languageId: string): RegExp[] {
        const patterns: { [key: string]: RegExp[] } = {
            javascript: [
                /function\s+\w+/,
                /const\s+\w+\s*=\s*\(/,
                /\w+\s*:\s*function/,
                /class\s+\w+/
            ],
            typescript: [
                /function\s+\w+/,
                /const\s+\w+\s*=\s*\(/,
                /\w+\s*:\s*function/,
                /class\s+\w+/,
                /interface\s+\w+/,
                /type\s+\w+/
            ],
            python: [
                /def\s+\w+/,
                /class\s+\w+/,
                /async\s+def\s+\w+/
            ],
            java: [
                /public\s+\w+\s+\w+\s*\(/,
                /private\s+\w+\s+\w+\s*\(/,
                /protected\s+\w+\s+\w+\s*\(/,
                /class\s+\w+/,
                /interface\s+\w+/
            ],
            go: [
                /func\s+\w+/,
                /func\s+\(\w+\s+\*?\w+\)\s+\w+/,
                /type\s+\w+\s+struct/
            ],
            rust: [
                /fn\s+\w+/,
                /impl\s+\w+/,
                /struct\s+\w+/,
                /trait\s+\w+/
            ]
        };

        return patterns[languageId] || [
            /function\s+\w+/,
            /def\s+\w+/,
            /class\s+\w+/
        ];
    }
}
