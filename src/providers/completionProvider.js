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
exports.GeminiCompletionProvider = void 0;
const vscode = __importStar(require("vscode"));
const geminiClient_1 = require("../services/geminiClient");
const contextExtractor_1 = require("../services/contextExtractor");
const promptBuilder_1 = require("../services/promptBuilder");
const responseParser_1 = require("../services/responseParser");
class GeminiCompletionProvider {
    geminiClient;
    contextExtractor;
    promptBuilder;
    responseParser;
    lastRequest = null;
    constructor() {
        this.geminiClient = new geminiClient_1.GeminiClient();
        this.contextExtractor = new contextExtractor_1.ContextExtractor();
        this.promptBuilder = new promptBuilder_1.PromptBuilder();
        this.responseParser = new responseParser_1.ResponseParser();
    }
    async provideInlineCompletionItems(document, position, context, token) {
        try {
            // Check if extension is enabled
            const config = vscode.workspace.getConfiguration('geminiCopilot');
            const enabled = config.get('enabled', true);
            if (!enabled) {
                return null;
            }
            // Check if API key is configured
            const apiKey = config.get('apiKey', '');
            if (!apiKey || apiKey.trim() === '') {
                return null;
            }
            // Cancel previous request if exists
            if (this.lastRequest) {
                this.lastRequest.abort();
            }
            // Create new abort controller
            this.lastRequest = new AbortController();
            // Handle cancellation from VS Code
            token.onCancellationRequested(() => {
                if (this.lastRequest) {
                    this.lastRequest.abort();
                }
            });
            // Extract context from document
            const codeContext = this.contextExtractor.extractContext(document, position);
            // Check if we have enough context
            if (!codeContext.beforeCursor || codeContext.beforeCursor.trim().length < 10) {
                return null;
            }
            // Build prompt
            const prompt = this.promptBuilder.buildPrompt(codeContext);
            // Get completion from Gemini
            const rawCompletion = await this.geminiClient.getCompletion(prompt, this.lastRequest.signal);
            if (!rawCompletion || token.isCancellationRequested) {
                return null;
            }
            // Parse response
            const completion = this.responseParser.parseCompletion(rawCompletion, codeContext);
            if (!completion || completion.trim().length === 0) {
                return null;
            }
            // Create inline completion item
            const completionItem = new vscode.InlineCompletionItem(completion, new vscode.Range(position, position));
            return [completionItem];
        }
        catch (error) {
            // Don't show errors for aborted requests
            if (error.name === 'AbortError' || error.message?.includes('aborted')) {
                return null;
            }
            console.error('Gemini Copilot error:', error);
            // Show error notification for non-abort errors
            if (error.message?.includes('API key')) {
                vscode.window.showErrorMessage('Gemini Copilot: Invalid API key. Please check your configuration.');
            }
            else if (error.message?.includes('quota') || error.message?.includes('rate limit')) {
                vscode.window.showWarningMessage('Gemini Copilot: Rate limit exceeded. Please try again later.');
            }
            return null;
        }
    }
}
exports.GeminiCompletionProvider = GeminiCompletionProvider;
//# sourceMappingURL=completionProvider.js.map