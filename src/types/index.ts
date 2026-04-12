// ===== Existing types (kept for completion provider) =====

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

// ===== Agent types =====

/** A single part of a message — can be text, a function call, or a function response */
export interface MessagePart {
    text?: string;
    functionCall?: {
        name: string;
        args: Record<string, any>;
    };
    functionResponse?: {
        name: string;
        response: {
            content: string;
        };
    };
}

/** A message in the conversation */
export interface ChatMessage {
    role: 'user' | 'model' | 'function';
    parts: MessagePart[];
}

/** Definition of a tool parameter */
export interface ToolParameter {
    type: string;
    description: string;
    enum?: string[];
}

/** A function declaration for Gemini's function calling */
export interface FunctionDeclaration {
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: Record<string, ToolParameter>;
        required: string[];
    };
}

/** Tool definition wrapping function declarations */
export interface ToolDefinition {
    functionDeclarations: FunctionDeclaration[];
}

/** Result from executing a tool */
export interface ToolResult {
    success: boolean;
    content: string;
    error?: string;
}

/** Configuration for the agent loop */
export interface AgentConfig {
    maxIterations: number;
    temperature: number;
    maxTokens: number;
}

/** A UI-friendly representation of a chat entry for the webview */
export interface ChatEntry {
    id: string;
    type: 'user' | 'agent' | 'tool_call' | 'tool_result' | 'error' | 'thinking';
    content: string;
    toolName?: string;
    toolArgs?: Record<string, any>;
    timestamp: number;
    isCollapsed?: boolean;
}
