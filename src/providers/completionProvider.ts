import * as vscode from 'vscode';
import { GeminiClient } from '../services/geminiClient';
import { ContextExtractor } from '../services/contextExtractor';
import { PromptBuilder } from '../services/promptBuilder';
import { ResponseParser } from '../services/responseParser';
import { debounce } from '../utils/debounce';

export class GeminiCompletionProvider implements vscode.InlineCompletionItemProvider {
    private geminiClient: GeminiClient;
    private contextExtractor: ContextExtractor;
    private promptBuilder: PromptBuilder;
    private responseParser: ResponseParser;
    private lastRequest: AbortController | null = null;

    constructor() {
        this.geminiClient = new GeminiClient();
        this.contextExtractor = new ContextExtractor();
        this.promptBuilder = new PromptBuilder();
        this.responseParser = new ResponseParser();
    }

    async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | null> {
        try {
            // Check if extension is enabled
            const config = vscode.workspace.getConfiguration('geminiCopilot');
            const enabled = config.get<boolean>('enabled', true);
            
            if (!enabled) {
                return null;
            }

            // Check if API key is configured
            const apiKey = config.get<string>('apiKey', '');
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
            const rawCompletion = await this.geminiClient.getCompletion(
                prompt,
                this.lastRequest.signal
            );

            if (!rawCompletion || token.isCancellationRequested) {
                return null;
            }

            // Parse response
            const completion = this.responseParser.parseCompletion(rawCompletion, codeContext);

            if (!completion || completion.trim().length === 0) {
                return null;
            }

            // Create inline completion item
            const completionItem = new vscode.InlineCompletionItem(
                completion,
                new vscode.Range(position, position)
            );

            return [completionItem];

        } catch (error: any) {
            // Don't show errors for aborted requests
            if (error.name === 'AbortError' || error.message?.includes('aborted')) {
                return null;
            }

            console.error('Gemini Copilot error:', error);
            
            // Show error notification for non-abort errors
            if (error.message?.includes('API key')) {
                vscode.window.showErrorMessage(
                    'Gemini Copilot: Invalid API key. Please check your configuration.'
                );
            } else if (error.message?.includes('quota') || error.message?.includes('rate limit')) {
                vscode.window.showWarningMessage(
                    'Gemini Copilot: Rate limit exceeded. Please try again later.'
                );
            }

            return null;
        }
    }
}
