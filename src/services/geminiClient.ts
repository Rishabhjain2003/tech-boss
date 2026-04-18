import * as vscode from 'vscode';
import { GoogleGenerativeAI, Content, Tool, GenerationConfig } from '@google/generative-ai';

export class GeminiClient {
    private genAI: GoogleGenerativeAI | null = null;
    private rateLimitedUntil: number = 0;

    constructor() {
        this.initClient();
    }

    /** Initialize or re-initialize the GoogleGenerativeAI client */
    private initClient(): void {
        const apiKey = this.getApiKey();
        if (apiKey) {
            this.genAI = new GoogleGenerativeAI(apiKey);
        }
    }

    /** Get API key from VS Code settings or environment variable */
    private getApiKey(): string {
        const config = vscode.workspace.getConfiguration('techBoss');
        let apiKey = config.get<string>('apiKey', '');
        if (!apiKey || apiKey.trim() === '') {
            apiKey = process.env.GEMINI_API_KEY || '';
        }
        return apiKey;
    }

    /** Get model name from settings */
    private getModel(): string {
        return vscode.workspace.getConfiguration('techBoss').get<string>('model', 'gemini-2.5-flash');
    }

    /**
     * Get a simple text completion (used by completionProvider.ts for inline suggestions).
     * Preserves the same interface as the original axios-based method.
     */
    async getCompletion(prompt: string, retryCount = 0, signal?: AbortSignal): Promise<string> {
        // Check cooldown
        const now = Date.now();
        if (now < this.rateLimitedUntil) {
            const waitSeconds = Math.ceil((this.rateLimitedUntil - now) / 1000);
            throw new Error(`⏳ Rate limited. Please wait ${waitSeconds} more seconds.`);
        }

        const apiKey = this.getApiKey();
        if (!apiKey) {
            throw new Error('Gemini API key not configured. Run "Tech Boss: Configure API Key" command.');
        }

        // Re-init if key changed
        if (!this.genAI) { this.initClient(); }
        if (!this.genAI) {
            throw new Error('Failed to initialize Gemini client.');
        }

        const config = vscode.workspace.getConfiguration('techBoss');
        const temperature = config.get<number>('temperature', 0.7);
        const maxTokens = config.get<number>('maxTokens', 2048);

        try {
            const model = this.genAI.getGenerativeModel({
                model: this.getModel(),
                generationConfig: {
                    temperature,
                    maxOutputTokens: maxTokens,
                    topP: 0.95,
                    topK: 40,
                },
            });

            const result = await model.generateContent(prompt);
            const response = result.response;
            const text = response.text();

            if (!text || text.trim().length === 0) {
                throw new Error('Empty text in response');
            }

            return text;
        } catch (error: any) {
            if (signal?.aborted) {
                throw new Error('Request aborted');
            }

            // Handle rate limiting
            if (error.message?.includes('429') || error.status === 429) {
                this.rateLimitedUntil = Date.now() + 90000;
                console.log('⚠️ Rate limit hit. Cooldown set for 90 seconds.');

                if (retryCount === 0) {
                    vscode.window.showWarningMessage(
                        '⚠️ Rate limit exceeded. Waiting 90 seconds before retry...',
                        'Cancel'
                    );
                    await new Promise(resolve => setTimeout(resolve, 90000));
                    this.rateLimitedUntil = 0;
                    return this.getCompletion(prompt, retryCount + 1, signal);
                }

                throw new Error('⚠️ Still rate limited. Please wait 2-3 minutes and try again.');
            }

            // Handle other known errors
            if (error.message?.includes('401') || error.message?.includes('403')) {
                throw new Error('🔑 Invalid API key. Please reconfigure.');
            }
            if (error.message?.includes('404')) {
                throw new Error(`Model not found: ${this.getModel()}. Try updating to a newer model.`);
            }

            throw new Error(`Failed to get completion: ${error.message}`);
        }
    }

    /**
     * Multi-turn chat with function calling support.
     * Used by the AgentLoop for autonomous tool-use conversations.
     */
    async chat(
        contents: Content[],
        tools: Tool[],
        systemInstruction: string,
        config?: Partial<GenerationConfig>
    ): Promise<{
        text: string | null;
        functionCall: { name: string; args: any } | null;
    }> {
        const apiKey = this.getApiKey();
        if (!apiKey) {
            throw new Error('Gemini API key not configured.');
        }

        if (!this.genAI) { this.initClient(); }
        if (!this.genAI) {
            throw new Error('Failed to initialize Gemini client.');
        }

        const model = this.genAI.getGenerativeModel({
            model: this.getModel(),
            systemInstruction,
            tools,
            generationConfig: {
                maxOutputTokens: 8192,
                ...config,
            },
        });

        const result = await model.generateContent({ contents });
        const response = result.response;
        const candidate = response.candidates?.[0];

        // Check for function calls first
        for (const part of candidate?.content?.parts ?? []) {
            if (part.functionCall) {
                return {
                    text: null,
                    functionCall: {
                        name: part.functionCall.name,
                        args: part.functionCall.args,
                    },
                };
            }
        }

        // Otherwise return text
        return { text: response.text(), functionCall: null };
    }

    /** Check cooldown status */
    public getRateLimitCooldown(): number {
        const now = Date.now();
        if (now < this.rateLimitedUntil) {
            return Math.ceil((this.rateLimitedUntil - now) / 1000);
        }
        return 0;
    }

    /** Clear cooldown (useful for testing) */
    public clearCooldown(): void {
        this.rateLimitedUntil = 0;
        console.log('Cooldown cleared manually');
    }

    /** Re-initialize client (call when API key changes) */
    public refreshClient(): void {
        this.initClient();
    }
}
