import * as vscode from 'vscode';
import { GeminiClient } from './geminiClient';
import { getToolDefinitions, executeTool } from './tools';
import { ChatMessage, ChatEntry, AgentConfig } from '../types';

/**
 * The agentic loop: sends messages to Gemini, executes tool calls,
 * and loops until the model produces a final text response.
 */
export class AgentLoop {
    private geminiClient: GeminiClient;
    private conversationHistory: ChatMessage[] = [];
    private abortController: AbortController | null = null;
    private isRunning = false;

    // Callback to push UI updates
    private onUpdate: (entry: ChatEntry) => void;

    constructor(geminiClient: GeminiClient, onUpdate: (entry: ChatEntry) => void) {
        this.geminiClient = geminiClient;
        this.onUpdate = onUpdate;
    }

    /**
     * Send a user message and run the agent loop until completion.
     */
    async run(userMessage: string): Promise<void> {
        if (this.isRunning) {
            throw new Error('Agent is already running.');
        }

        this.isRunning = true;
        this.abortController = new AbortController();

        // Clear any stale rate limit so user-initiated messages always go through
        this.geminiClient.clearCooldown();

        // Add user message to history
        this.conversationHistory.push({
            role: 'user',
            parts: [{ text: userMessage }]
        });

        const tools = getToolDefinitions();
        const maxIterations = 15;
        let iteration = 0;

        try {
            while (iteration < maxIterations) {
                iteration++;

                // Throttle between iterations to avoid rate limits (free tier = 15 RPM)
                if (iteration > 1) {
                    await new Promise(resolve => setTimeout(resolve, 4000));
                }

                // Check if aborted
                if (this.abortController.signal.aborted) {
                    this.emitEntry('error', '🛑 Agent stopped by user.');
                    break;
                }

                // Show thinking indicator
                const thinkingId = this.emitEntry('thinking', 'Thinking...');

                // Call Gemini
                const response = await this.geminiClient.chat(
                    this.conversationHistory,
                    tools,
                    this.abortController.signal
                );

                // Remove thinking indicator
                this.emitEntry('thinking', '', thinkingId);

                // Process response parts
                const parts = response.parts;
                let hasFunctionCall = false;
                let textContent = '';
                const functionCalls: { name: string; args: Record<string, any> }[] = [];

                for (const part of parts) {
                    if (part.text) {
                        textContent += part.text;
                    }
                    if (part.functionCall) {
                        hasFunctionCall = true;
                        functionCalls.push({
                            name: part.functionCall.name,
                            args: part.functionCall.args || {}
                        });
                    }
                }

                // If there's text content, emit it
                if (textContent) {
                    this.emitEntry('agent', textContent);
                }

                // If no function calls, we're done
                if (!hasFunctionCall) {
                    // Add model response to history
                    this.conversationHistory.push({
                        role: 'model',
                        parts: parts.map((p: any) => {
                            if (p.text) { return { text: p.text }; }
                            if (p.functionCall) { return { functionCall: p.functionCall }; }
                            return { text: '' };
                        })
                    });
                    break;
                }

                // Add model response (with function calls) to history
                this.conversationHistory.push({
                    role: 'model',
                    parts: parts.map((p: any) => {
                        if (p.text) { return { text: p.text }; }
                        if (p.functionCall) { return { functionCall: p.functionCall }; }
                        return { text: '' };
                    })
                });

                // Execute each function call
                for (const fc of functionCalls) {
                    if (this.abortController.signal.aborted) { break; }

                    // Emit tool call indicator
                    this.emitEntry('tool_call', this.formatToolCallDisplay(fc.name, fc.args), undefined, fc.name, fc.args);

                    // Execute the tool
                    const result = await executeTool(fc.name, fc.args);

                    // Emit tool result
                    const resultContent = result.success
                        ? result.content
                        : `❌ Error: ${result.error}\n${result.content || ''}`;
                    this.emitEntry('tool_result', resultContent, undefined, fc.name);

                    // Add function response to history
                    this.conversationHistory.push({
                        role: 'function',
                        parts: [{
                            functionResponse: {
                                name: fc.name,
                                response: {
                                    content: resultContent
                                }
                            }
                        }]
                    });
                }
            }

            if (iteration >= maxIterations) {
                this.emitEntry('error', '⚠️ Agent reached maximum iterations (15). Stopping to prevent runaway execution.');
            }

        } catch (err: any) {
            if (err.message === 'Request aborted') {
                this.emitEntry('error', '🛑 Agent stopped.');
            } else {
                this.emitEntry('error', `❌ Error: ${err.message}`);
            }
        } finally {
            this.isRunning = false;
            this.abortController = null;
        }
    }

    /**
     * Stop the currently running agent loop.
     */
    stop(): void {
        if (this.abortController) {
            this.abortController.abort();
        }
    }

    /**
     * Reset the conversation history.
     */
    reset(): void {
        this.stop();
        this.conversationHistory = [];
    }

    /**
     * Check if the agent is currently running.
     */
    getIsRunning(): boolean {
        return this.isRunning;
    }

    /**
     * Emit a chat entry to the UI.
     */
    private emitEntry(
        type: ChatEntry['type'],
        content: string,
        id?: string,
        toolName?: string,
        toolArgs?: Record<string, any>
    ): string {
        const entryId = id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        this.onUpdate({
            id: entryId,
            type,
            content,
            toolName,
            toolArgs,
            timestamp: Date.now()
        });
        return entryId;
    }

    /**
     * Format a tool call for display.
     */
    private formatToolCallDisplay(name: string, args: Record<string, any>): string {
        const icons: Record<string, string> = {
            'read_file': '📖',
            'write_file': '📝',
            'edit_file': '✏️',
            'list_directory': '📂',
            'search_workspace': '🔍',
            'run_terminal': '💻',
            'get_diagnostics': '🔬',
            'open_file': '📄'
        };

        const icon = icons[name] || '🔧';

        switch (name) {
            case 'read_file':
                return `${icon} Reading: ${args.path}`;
            case 'write_file':
                return `${icon} Writing: ${args.path}`;
            case 'edit_file':
                return `${icon} Editing: ${args.path}`;
            case 'list_directory':
                return `${icon} Listing: ${args.path}`;
            case 'search_workspace':
                return `${icon} Searching: "${args.query}"`;
            case 'run_terminal':
                return `${icon} Running: ${args.command}`;
            case 'get_diagnostics':
                return `${icon} Checking diagnostics${args.path ? ': ' + args.path : ''}`;
            case 'open_file':
                return `${icon} Opening: ${args.path}`;
            default:
                return `${icon} ${name}(${JSON.stringify(args)})`;
        }
    }
}
