import * as vscode from 'vscode';
import axios, { AxiosError } from 'axios';

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
    private apiKey: string = '';
    private model: string = 'gemini-2.0-flash-exp';
    private rateLimitedUntil: number = 0;  // ✅ NEW: Track cooldown

    constructor() {
        this.loadConfiguration();
    }

    private loadConfiguration() {
        const config = vscode.workspace.getConfiguration('techBoss');
        
        // Try to get API key from VS Code settings first
        this.apiKey = config.get<string>('apiKey', '');
        
        // Fallback to environment variable if not set in settings (for development)
        if (!this.apiKey || this.apiKey.trim() === '') {
            this.apiKey = process.env.GEMINI_API_KEY || '';
        }
        
        // Get model with new default
        this.model = config.get<string>('model', 'gemini-2.0-flash-exp');
    }

    async getCompletion(prompt: string, retryCount = 0, signal?: AbortSignal): Promise<string> {
        // ✅ NEW: Check if we're in cooldown period
        const now = Date.now();
        if (now < this.rateLimitedUntil) {
            const waitSeconds = Math.ceil((this.rateLimitedUntil - now) / 1000);
            throw new Error(`⏳ Rate limited. Please wait ${waitSeconds} more seconds.`);
        }

        const config = vscode.workspace.getConfiguration('techBoss');
        const apiKey = config.get<string>('apiKey');
        const model = config.get<string>('model', 'gemini-2.0-flash-exp');
        const temperature = config.get<number>('temperature', 0.7);
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
                    signal: signal  // ✅ NEW: Support abort
                }
            );

            // ✅ Better validation
            if (!response.data.candidates || response.data.candidates.length === 0) {
                throw new Error('No response generated from Gemini');
            }

            const candidate = response.data.candidates[0];
            
            // ✅ Check for safety blocks
            if (candidate.finishReason === 'SAFETY') {
                throw new Error('Content was blocked by safety filters');
            }

            if (!candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
                throw new Error('Empty response from Gemini');
            }

            return candidate.content.parts[0].text;

        } catch (error: any) {
            // ✅ Check if request was cancelled
            if (signal?.aborted || error.code === 'ERR_CANCELED') {
                throw new Error('Request cancelled');
            }

            // ✅ IMPROVED: Handle rate limiting
            if (error.response?.status === 429) {
                // Set cooldown for 90 seconds
                this.rateLimitedUntil = Date.now() + 90000;
                
                console.log('⚠️ Rate limit hit. Cooldown set for 90 seconds.');
                
                // Only retry ONCE after waiting full 90 seconds
                if (retryCount === 0) {
                    vscode.window.showWarningMessage(
                        `⚠️ Rate limit exceeded. Waiting 90 seconds before retry...`,
                        'Cancel'
                    );
                    
                    await new Promise(resolve => setTimeout(resolve, 90000));
                    
                    // Clear cooldown and retry
                    this.rateLimitedUntil = 0;
                    console.log('Retrying after 90 second cooldown...');
                    
                    return this.getCompletion(prompt, retryCount + 1, signal);
                }
                
                // If still rate limited after retry, give up
                throw new Error('⚠️ Still rate limited. Please wait 2-3 minutes and try again.');
            }

            // ✅ Better error handling for other statuses
            if (error.response) {
                const status = error.response.status;
                const errorData = error.response.data;

                switch (status) {
                    case 400:
                        throw new Error('Invalid request. Please check your prompt.');
                    case 401:
                        throw new Error('🔑 Invalid API key. Please reconfigure.');
                    case 403:
                        throw new Error('API access forbidden. Check your API key permissions.');
                    case 500:
                    case 503:
                        throw new Error('Gemini service temporarily unavailable. Try again later.');
                    default:
                        throw new Error(`API error (${status}): ${errorData?.error?.message || 'Unknown error'}`);
                }
            }

            // Network errors
            if (error.code === 'ECONNABORTED') {
                throw new Error('Request timed out. Please try again.');
            }

            if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
                throw new Error('Network error. Check your internet connection.');
            }

            throw new Error(`Failed to get completion: ${error.message}`);
        }
    }

    // ✅ NEW: Public method to check cooldown status
    public getRateLimitCooldown(): number {
        const now = Date.now();
        if (now < this.rateLimitedUntil) {
            return Math.ceil((this.rateLimitedUntil - now) / 1000);
        }
        return 0;
    }

    // ✅ NEW: Public method to clear cooldown (useful for testing)
    public clearCooldown(): void {
        this.rateLimitedUntil = 0;
        console.log('Cooldown cleared manually');
    }
}
