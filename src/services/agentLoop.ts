import { Content, Tool } from '@google/generative-ai';
import { GeminiClient } from './geminiClient';
import { ContextPacker } from './contextPacker';
import { ToolDefinition, ToolContext } from './tools';
import { AgentMessage } from '../types';

const MAX_ITERATIONS = 15;

/**
 * Autonomous agent loop that orchestrates multi-turn conversations
 * between Gemini and the tool system.
 */
export class AgentLoop {
    private history: Content[] = [];
    private cancelled = false;

    constructor(
        private gemini: GeminiClient,
        private tools: Record<string, ToolDefinition>,
        private toolContext: ToolContext,
        private contextPacker: ContextPacker,
        private onMessage: (msg: AgentMessage) => void,
        private onDone: () => void,
    ) {}

    /** Cancel the current agent run */
    cancel(): void {
        this.cancelled = true;
    }

    /** Reset conversation history and state */
    reset(): void {
        this.history = [];
        this.cancelled = false;
    }

    /**
     * Run the agent loop for a given user message.
     * The loop continues until Gemini returns a text response (no more tool calls)
     * or MAX_ITERATIONS is reached.
     */
    async run(userMessage: string): Promise<void> {
        this.cancelled = false;

        // Add workspace context to the first message if history is empty
        const messageContent = this.history.length === 0
            ? `${this.contextPacker.buildInitialContext()}\n\nUser request: ${userMessage}`
            : userMessage;

        this.history.push({ role: 'user', parts: [{ text: messageContent }] });

        const toolDeclarations = Object.values(this.tools).map(t => t.declaration);
        const geminiTools: Tool[] = [{ functionDeclarations: toolDeclarations as any }];
        const systemPrompt = this.contextPacker.buildSystemPrompt();

        for (let i = 0; i < MAX_ITERATIONS; i++) {
            if (this.cancelled) {
                this.onMessage({
                    type: 'error',
                    content: 'Agent was cancelled by user.',
                });
                this.onDone();
                return;
            }

            try {
                const { text, functionCall } = await this.gemini.chat(
                    this.history,
                    geminiTools,
                    systemPrompt,
                );

                if (functionCall) {
                    // Emit tool call event to UI
                    this.onMessage({
                        type: 'tool_call',
                        content: `Calling ${functionCall.name}`,
                        toolName: functionCall.name,
                        toolParams: functionCall.args,
                    });

                    // Add assistant's function call to history
                    this.history.push({
                        role: 'model',
                        parts: [{
                            functionCall: {
                                name: functionCall.name,
                                args: functionCall.args,
                            },
                        }],
                    });

                    // Execute tool
                    let toolResult: string;
                    try {
                        const tool = this.tools[functionCall.name];
                        if (!tool) {
                            throw new Error(`Unknown tool: ${functionCall.name}`);
                        }
                        toolResult = await tool.execute(functionCall.args, this.toolContext);
                    } catch (err: any) {
                        toolResult = `Error: ${err.message}`;
                    }

                    // Emit tool result to UI
                    this.onMessage({
                        type: 'tool_result',
                        content: toolResult,
                        toolName: functionCall.name,
                    });

                    // Add tool result to history as a function response
                    this.history.push({
                        role: 'function' as any,
                        parts: [{
                            functionResponse: {
                                name: functionCall.name,
                                response: { result: toolResult },
                            },
                        }],
                    });

                } else if (text) {
                    // Final text response — agent is done
                    this.history.push({ role: 'model', parts: [{ text }] });
                    this.onMessage({ type: 'assistant', content: text });
                    this.onDone();
                    return;
                } else {
                    // No text and no function call — unexpected
                    break;
                }
            } catch (err: any) {
                this.onMessage({
                    type: 'error',
                    content: `Agent error: ${err.message}`,
                });
                this.onDone();
                return;
            }
        }

        this.onMessage({
            type: 'error',
            content: 'Agent reached maximum iterations without completing. You can send another message to continue.',
        });
        this.onDone();
    }
}
