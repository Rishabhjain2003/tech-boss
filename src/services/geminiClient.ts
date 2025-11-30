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
    private model: string = 'gemini-2.0-flash-exp';  // ← Updated default

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

    async getCompletion(prompt: string, signal?: AbortSignal): Promise<string> {
        this.loadConfiguration(); // Reload config for each request

        if (!this.apiKey || this.apiKey.trim() === '') {
            throw new Error('API key not configured');
        }

        const config = vscode.workspace.getConfiguration('techBoss');
        const temperature = config.get<number>('temperature', 0.2);
        const maxTokens = config.get<number>('maxTokens', 256);

        const requestBody: GeminiRequest = {
            contents: [
                {
                    parts: [
                        {
                            text: prompt
                        }
                    ]
                }
            ],
            generationConfig: {
                temperature: temperature,
                maxOutputTokens: maxTokens,
                topP: 0.95,
                topK: 40
            }
        };

        try {
            const response = await axios.post(
                `${this.baseURL}/models/${this.model}:generateContent?key=${this.apiKey}`,
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
                    signal: signal
                }
            );

            // ✅ Better validation
            if (!response.data) {
                console.error('No response data from Gemini');
                throw new Error('Empty response from Gemini API');
            }

            if (!response.data.candidates || response.data.candidates.length === 0) {
                console.error('Response data:', JSON.stringify(response.data, null, 2));
                
                // Check for specific error conditions
                if (response.data.error) {
                    throw new Error(`Gemini API Error: ${response.data.error.message}`);
                }
                
                throw new Error('No candidates in response. The model may have blocked the content.');
            }

            const candidate = response.data.candidates[0];
            
            // ✅ Check for safety/content blocks
            if (candidate.finishReason === 'SAFETY') {
                throw new Error('Content was blocked by safety filters');
            }
            
            if (candidate.finishReason === 'RECITATION') {
                throw new Error('Content blocked due to recitation concerns');
            }

            if (!candidate.content) {
                console.error('Candidate:', JSON.stringify(candidate, null, 2));
                throw new Error('No content in candidate. Finish reason: ' + (candidate.finishReason || 'unknown'));
            }

            if (!candidate.content.parts || candidate.content.parts.length === 0) {
                console.error('Content:', JSON.stringify(candidate.content, null, 2));
                throw new Error('No parts in content');
            }

            const text = candidate.content.parts[0].text;
            
            if (!text || text.trim().length === 0) {
                throw new Error('Empty text in response');
            }

            return text;

        } catch (error: any) {
            if (axios.isAxiosError(error)) {
                const axiosError = error as AxiosError;
                
                if (axiosError.code === 'ECONNABORTED' || signal?.aborted) {
                    throw new Error('Request aborted');
                }

                if (axiosError.response) {
                    const status = axiosError.response.status;
                    const data: any = axiosError.response.data;

                    if (status === 400) {
                        // Include detailed error message for debugging
                        throw new Error(`Invalid request: ${data?.error?.message || 'Unknown error'}`);
                    } else if (status === 401 || status === 403) {
                        throw new Error('API key is invalid or unauthorized');
                    } else if (status === 404) {
                        throw new Error(`Model not found: ${this.model}. Try updating to a newer model.`);
                    } else if (status === 429) {
                        throw new Error('Rate limit exceeded. Please try again later.');
                    } else if (status >= 500) {
                        throw new Error('Gemini API server error. Please try again later.');
                    }

                    throw new Error(data?.error?.message || 'Gemini API error');
                }

                throw new Error('Network error: Unable to reach Gemini API');
            }

            throw error;
        }
    }
}
