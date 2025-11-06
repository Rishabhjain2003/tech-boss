"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResponseParser = void 0;
class ResponseParser {
    parseCompletion(rawCompletion, context) {
        if (!rawCompletion) {
            return '';
        }
        let completion = rawCompletion;
        // Remove markdown code fences if present
        completion = this.removeCodeFences(completion);
        // Remove explanations and comments that might be added
        completion = this.cleanExplanations(completion);
        // Trim whitespace
        completion = completion.trim();
        // If completion is too long, truncate intelligently
        completion = this.truncateCompletion(completion, context);
        // Ensure proper indentation matches context
        completion = this.adjustIndentation(completion, context);
        return completion;
    }
    removeCodeFences(text) {
        // Remove markdown code fences like ``````
        const fencePattern = /^``````$/;
        const match = text.match(fencePattern);
        if (match) {
            return match[1];
        }
        // Also try to remove inline code markers
        text = text.replace(/^`+|`+$/g, '');
        return text;
    }
    cleanExplanations(text) {
        // Remove lines that look like explanations
        const lines = text.split('\n');
        const codeLike = lines.filter(line => {
            const trimmed = line.trim();
            // Skip empty lines at start/end (will be trimmed anyway)
            if (trimmed === '') {
                return true;
            }
            // Skip lines that start with common explanation phrases
            const explanationPhrases = [
                'this code',
                'this will',
                'this function',
                'the above',
                'explanation:',
                'note:',
                'here',
                'this is'
            ];
            const lowerLine = trimmed.toLowerCase();
            const isExplanation = explanationPhrases.some(phrase => lowerLine.startsWith(phrase));
            if (isExplanation) {
                return false;
            }
            return true;
        });
        return codeLike.join('\n');
    }
    truncateCompletion(completion, context) {
        const lines = completion.split('\n');
        // Limit to reasonable number of lines (prefer 1-3, max 5)
        const maxLines = 5;
        if (lines.length > maxLines) {
            // Try to find a natural stopping point (closing brace, semicolon, etc.)
            for (let i = 1; i <= maxLines; i++) {
                const line = lines[i - 1].trim();
                if (this.isNaturalStoppingPoint(line, context.language)) {
                    return lines.slice(0, i).join('\n');
                }
            }
            // If no natural stopping point, just take first few lines
            return lines.slice(0, maxLines).join('\n');
        }
        return completion;
    }
    isNaturalStoppingPoint(line, language) {
        // Check if line ends with typical statement terminators
        const terminators = [';', '{', '}', ':', ','];
        const endsWithTerminator = terminators.some(term => line.endsWith(term));
        // For Python, check for complete statements
        if (language === 'python') {
            return !line.endsWith('\\') && !line.endsWith(',');
        }
        return endsWithTerminator;
    }
    adjustIndentation(completion, context) {
        // Get the indentation of the current line
        const currentLine = context.currentLine;
        const currentIndent = this.getIndentation(currentLine);
        // Split completion into lines
        const lines = completion.split('\n');
        if (lines.length === 0) {
            return completion;
        }
        // First line should match current line's indentation
        // (or continue from cursor position)
        const cursorColumn = context.cursorPosition.character;
        const lineBeforeCursor = currentLine.slice(0, cursorColumn);
        // If cursor is at end of line or after whitespace, use current indent
        if (cursorColumn === currentLine.length || lineBeforeCursor.trim() === '') {
            return lines.map((line, index) => {
                if (index === 0) {
                    return line; // First line continues from cursor
                }
                // Subsequent lines maintain relative indentation
                return currentIndent + line;
            }).join('\n');
        }
        return completion;
    }
    getIndentation(line) {
        const match = line.match(/^(\s*)/);
        return match ? match[1] : '';
    }
}
exports.ResponseParser = ResponseParser;
//# sourceMappingURL=responseParser.js.map