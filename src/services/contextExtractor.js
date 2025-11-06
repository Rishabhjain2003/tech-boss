"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContextExtractor = void 0;
const vscode = __importStar(require("vscode"));
class ContextExtractor {
    MAX_CONTEXT_LENGTH = 2000;
    SURROUNDING_LINES = 10;
    extractContext(document, position) {
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
    getTextBeforeCursor(document, position) {
        const startPos = new vscode.Position(Math.max(0, position.line - 50), 0);
        const range = new vscode.Range(startPos, position);
        let text = document.getText(range);
        // Limit context length
        if (text.length > this.MAX_CONTEXT_LENGTH) {
            text = text.slice(-this.MAX_CONTEXT_LENGTH);
        }
        return text;
    }
    getTextAfterCursor(document, position) {
        const endPos = new vscode.Position(Math.min(document.lineCount - 1, position.line + 10), 0);
        const range = new vscode.Range(position, endPos);
        let text = document.getText(range);
        // Limit to 500 characters
        if (text.length > 500) {
            text = text.slice(0, 500);
        }
        return text;
    }
    getSurroundingLines(document, position) {
        const startLine = Math.max(0, position.line - this.SURROUNDING_LINES);
        const endLine = Math.min(document.lineCount - 1, position.line + this.SURROUNDING_LINES);
        const lines = [];
        for (let i = startLine; i <= endLine; i++) {
            lines.push(document.lineAt(i).text);
        }
        return lines.join('\n');
    }
    getFunctionContext(document, position) {
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
    getFunctionPatterns(languageId) {
        const patterns = {
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
exports.ContextExtractor = ContextExtractor;
//# sourceMappingURL=contextExtractor.js.map