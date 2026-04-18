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

// --- Agent Types ---

export type BlobHash = string;

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'error';
    content: string;
    toolName?: string;
    toolParams?: any;
    timestamp: number;
    collapsed?: boolean;
}

export interface AgentConfig {
    model: string;
    maxIterations: number;
    workspaceRoot: string;
}

export interface AgentMessage {
    type: 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'error';
    content: string;
    toolName?: string;
    toolParams?: any;
}
