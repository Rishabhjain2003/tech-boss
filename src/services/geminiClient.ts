import * as vscode from 'vscode';
import axios, { AxiosError } from 'axios';
import { ChatMessage, ToolDefinition } from '../types';

interface GeminiRequest {
    contents: Array<{
        parts: Array<{
            text: string;
        }>;
    }>;
    generationConfig: {
        temperature: number;
        maxOutputTokens: number;
        topP?: number;
        topK?: number;
    };
}

interface GeminiResponse {
    candidates: Array<{
        content: {
            parts: Array<{
                text: string;
            }>;
        };
        finishReason: string;
    }>;
}

export class GeminiClient {
    private baseURL = 'https://generativelanguage.googleapis.com/v1beta';
    private rateLimitedUntil: number = 0;

    constructor() {}

    private getApiKey(): string {
        const config = vscode.workspace.getConfiguration('techBoss');
        let apiKey = config.get<string>('apiKey', '');
        if (!apiKey || apiKey.trim() === '') {
            apiKey = process.env.GEMINI_API_KEY || '';
        }
        return apiKey;
    }

    private getModel(): string {
        const config = vscode.workspace.getConfiguration('techBoss');
        return config.get<string>('model', 'gemini-2.5-flash');
    }

    /**
     * Multi-turn chat with function calling support.
     * Used by the agent loop.
     */
    async chat(
        contents: ChatMessage[],
        tools?: ToolDefinition,
        signal?: AbortSignal,
        retryCount: number = 0
    ): Promise<{ parts: any[]; finishReason: string }> {
        // If rate limited, wait it out automatically (up to 20s)
        const now = Date.now();
        if (now < this.rateLimitedUntil) {
            const waitMs = this.rateLimitedUntil - now;
            if (waitMs > 20000) {
                throw new Error(`⏳ Rate limited. Please wait ${Math.ceil(waitMs / 1000)} more seconds.`);
            }
            // Auto-wait for short cooldowns
            await new Promise(resolve => setTimeout(resolve, waitMs));
            this.rateLimitedUntil = 0;
        }

        const apiKey = this.getApiKey();
        const model = this.getModel();
        const config = vscode.workspace.getConfiguration('techBoss');
        const temperature = config.get<number>('temperature', 0.2);
        const maxTokens = config.get<number>('maxTokens', 8192);

        if (!apiKey || apiKey.trim() === '') {
            throw new Error('Gemini API key not configured. Run "Tech Boss: Configure API Key" command.');
        }

        // Build request body
        const body: any = {
            contents: contents.map(msg => ({
                role: msg.role === 'function' ? 'function' : msg.role,
                parts: msg.parts.map(p => {
                    if (p.text !== undefined) {
                        return { text: p.text };
                    }
                    if (p.functionCall) {
                        return { functionCall: p.functionCall };
                    }
                    if (p.functionResponse) {
                        return { functionResponse: p.functionResponse };
                    }
                    return {};
                })
            })),
            generationConfig: {
                temperature,
                maxOutputTokens: maxTokens,
                topP: 0.95,
                topK: 40
            }
        };

        // Add tools if provided
        if (tools) {
            body.tools = [tools];
        }

        // Add system instruction
        body.systemInstruction = {
            parts: [{
                text: this.getSystemPrompt()
            }]
        };

        try {
            const response = await axios.post(
                `${this.baseURL}/models/${model}:generateContent?key=${apiKey}`,
                body,
                {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 60000,
                    signal
                }
            );

            if (!response.data?.candidates?.length) {
                if (response.data?.error) {
                    throw new Error(`Gemini API Error: ${response.data.error.message}`);
                }
                throw new Error('No candidates in response.');
            }

            const candidate = response.data.candidates[0];

            if (candidate.finishReason === 'SAFETY') {
                throw new Error('Content was blocked by safety filters.');
            }

            if (!candidate.content?.parts?.length) {
                throw new Error(`No content in response. Finish reason: ${candidate.finishReason || 'unknown'}`);
            }

            return {
                parts: candidate.content.parts,
                finishReason: candidate.finishReason
            };

        } catch (error: any) {
            if (axios.isAxiosError(error)) {
                // Handle 429 with auto-retry
                if (error.response?.status === 429 && retryCount < 2) {
                    const waitSec = 15 * (retryCount + 1);
                    this.rateLimitedUntil = Date.now() + waitSec * 1000;
                    console.log(`Rate limited. Waiting ${waitSec}s before retry ${retryCount + 1}...`);
                    await new Promise(resolve => setTimeout(resolve, waitSec * 1000));
                    this.rateLimitedUntil = 0;
                    return this.chat(contents, tools, signal, retryCount + 1);
                }
                return this.handleAxiosError(error, signal);
            }
            throw error;
        }
    }

    /**
     * Simple single-shot completion (used by inline completion provider).
     */
    async getCompletion(prompt: string, retryCount = 0, signal?: AbortSignal): Promise<string> {
        const now = Date.now();
        if (now < this.rateLimitedUntil) {
            const waitSeconds = Math.ceil((this.rateLimitedUntil - now) / 1000);
            throw new Error(`⏳ Rate limited. Please wait ${waitSeconds} more seconds.`);
        }

        const apiKey = this.getApiKey();
        const model = this.getModel();
        const config = vscode.workspace.getConfiguration('techBoss');
        const temperature = config.get<number>('temperature', 0.2);
        const maxTokens = config.get<number>('maxTokens', 2048);

        if (!apiKey || apiKey.trim() === '') {
            throw new Error('Gemini API key not configured. Run "Tech Boss: Configure API Key" command.');
        }

        try {
            const response = await axios.post(
                `${this.baseURL}/models/${model}:generateContent?key=${apiKey}`,
                {
                    contents: [{
                        parts: [{ text: prompt }]
                    }],
                    generationConfig: {
                        temperature,
                        maxOutputTokens: maxTokens,
                        topP: 0.95,
                        topK: 40
                    }
                },
                {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 30000,
                    signal
                }
            );

            if (!response.data?.candidates?.length) {
                throw new Error('No candidates in response.');
            }

            const candidate = response.data.candidates[0];
            if (candidate.finishReason === 'SAFETY') {
                throw new Error('Content was blocked by safety filters');
            }
            if (!candidate.content?.parts?.[0]?.text) {
                throw new Error('Empty response from model.');
            }

            return candidate.content.parts[0].text;

        } catch (error: any) {
            if (axios.isAxiosError(error)) {
                const axiosError = error as AxiosError;
                if (axiosError.code === 'ECONNABORTED' || signal?.aborted) {
                    throw new Error('Request aborted');
                }
                if (axiosError.response?.status === 429 && retryCount === 0) {
                    this.rateLimitedUntil = Date.now() + 60000;
                    await new Promise(resolve => setTimeout(resolve, 60000));
                    this.rateLimitedUntil = 0;
                    return this.getCompletion(prompt, retryCount + 1, signal);
                }
            }
            throw new Error(`Failed to get completion: ${error.message}`);
        }
    }

    private handleAxiosError(error: AxiosError, signal?: AbortSignal): never {
        if (error.code === 'ECONNABORTED' || signal?.aborted) {
            throw new Error('Request aborted');
        }

        const status = error.response?.status;
        const data: any = error.response?.data;

        if (status === 400) {
            throw new Error(`Invalid request: ${data?.error?.message || 'Unknown error'}`);
        } else if (status === 401 || status === 403) {
            throw new Error('🔑 API key is invalid or unauthorized.');
        } else if (status === 404) {
            throw new Error(`Model not found. Try updating the model in settings.`);
        } else if (status === 429) {
            this.rateLimitedUntil = Date.now() + 30000;
            throw new Error('⚠️ Rate limit exceeded. Please wait ~30 seconds and send your message again.');
        } else if (status && status >= 500) {
            throw new Error('Gemini API server error. Please try again later.');
        }

        if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
            throw new Error('Network error. Check your internet connection.');
        }

        throw new Error(data?.error?.message || error.message || 'Unknown Gemini API error');
    }

    private getSystemPrompt(): string {
        return `You are Tech Boss, an AI coding agent embedded in VS Code. You help users with coding tasks by reading files, editing code, running commands, and more.

GUIDELINES:
- You have access to tools to interact with the user's workspace. USE THEM proactively.
- When asked to modify code, ALWAYS read the file first to understand its current state, then use edit_file for surgical changes or write_file for full rewrites.
- When asked about the project, use list_directory and read_file to explore before answering.
- When asked to run something, use run_terminal.
- Be concise and direct. Show your work by explaining what you're doing before each tool call.
- After making changes, briefly confirm what you did.
- If a tool fails, explain why and try an alternative approach.
- Format code in markdown code blocks with the appropriate language tag.
- You can make multiple tool calls in sequence to complete complex tasks.`;
    }

    public getRateLimitCooldown(): number {
        const now = Date.now();
        if (now < this.rateLimitedUntil) {
            return Math.ceil((this.rateLimitedUntil - now) / 1000);
        }
        return 0;
    }

    public clearCooldown(): void {
        this.rateLimitedUntil = 0;
    }
}
