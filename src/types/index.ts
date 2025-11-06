export interface GeminiConfig {
    apiKey: string;
    model: string;
    temperature: number;
    maxTokens: number;
    enabled: boolean;
}

export interface CompletionRequest {
    context: string;
    language: string;
    fileName: string;
}

export interface CompletionResponse {
    text: string;
    confidence?: number;
}

export interface CacheEntry {
    prompt: string;
    completion: string;
    timestamp: number;
}
