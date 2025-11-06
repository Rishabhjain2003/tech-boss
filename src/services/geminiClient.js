"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GeminiClient = void 0;
const vscode = __importStar(require("vscode"));
const axios_1 = __importDefault(require("axios"));
class GeminiClient {
    baseURL = 'https://generativelanguage.googleapis.com/v1beta';
    apiKey = '';
    model = 'gemini-pro';
    constructor() {
        this.loadConfiguration();
    }
    loadConfiguration() {
        const config = vscode.workspace.getConfiguration('geminiCopilot');
        // Try to get API key from VS Code settings first
        this.apiKey = config.get('apiKey', '');
        // Fallback to environment variable if not set in settings (for development)
        if (!this.apiKey || this.apiKey.trim() === '') {
            this.apiKey = process.env.GEMINI_API_KEY || '';
        }
        this.model = config.get('model', 'gemini-pro');
    }
    async getCompletion(prompt, signal) {
        this.loadConfiguration(); // Reload config for each request
        if (!this.apiKey || this.apiKey.trim() === '') {
            throw new Error('API key not configured');
        }
        const config = vscode.workspace.getConfiguration('geminiCopilot');
        const temperature = config.get('temperature', 0.2);
        const maxTokens = config.get('maxTokens', 256);
        const requestBody = {
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
            const response = await axios_1.default.post(`${this.baseURL}/models/${this.model}:generateContent?key=${this.apiKey}`, requestBody, {
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: 10000, // 10 second timeout
                signal: signal
            });
            if (!response.data.candidates || response.data.candidates.length === 0) {
                throw new Error('No completion generated');
            }
            const candidate = response.data.candidates[0];
            if (!candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
                throw new Error('Invalid response format');
            }
            return candidate.content.parts[0].text;
        }
        catch (error) {
            if (axios_1.default.isAxiosError(error)) {
                const axiosError = error;
                if (axiosError.code === 'ECONNABORTED' || signal?.aborted) {
                    throw new Error('Request aborted');
                }
                if (axiosError.response) {
                    const status = axiosError.response.status;
                    const data = axiosError.response.data;
                    if (status === 400) {
                        throw new Error('Invalid request to Gemini API');
                    }
                    else if (status === 401 || status === 403) {
                        throw new Error('API key is invalid or unauthorized');
                    }
                    else if (status === 429) {
                        throw new Error('Rate limit exceeded. Please try again later.');
                    }
                    else if (status >= 500) {
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
exports.GeminiClient = GeminiClient;
//# sourceMappingURL=geminiClient.js.map