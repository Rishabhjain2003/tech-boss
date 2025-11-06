import { CodeContext } from './contextExtractor';

export class PromptBuilder {
    buildPrompt(context: CodeContext): string {
        const languageInstructions = this.getLanguageInstructions(context.language);
        
        let prompt = `You are an expert ${context.language} code completion assistant. Complete the code naturally and concisely.

Language: ${context.language}
File: ${context.fileName}
`;

        // Add function context if available
        if (context.functionContext) {
            prompt += `Function/Class context: ${context.functionContext}\n`;
        }

        prompt += `\nCode before cursor:
\`\`\`${context.language}
${context.beforeCursor}
\`\`\`

`;

        // Add after cursor context if available
        if (context.afterCursor && context.afterCursor.trim().length > 0) {
            prompt += `Code after cursor:
\`\`\`${context.language}
${context.afterCursor.slice(0, 200)}
\`\`\`

`;
        }

        prompt += `${languageInstructions}

IMPORTANT: 
- Provide ONLY the completion code, no explanations
- Do NOT repeat the code before cursor
- Complete naturally from the cursor position
- Keep the completion concise (1-3 lines preferred)
- Match the existing code style and indentation
- Do NOT include markdown code fences in your response

Completion:`;

        return prompt;
    }

    private getLanguageInstructions(language: string): string {
        const instructions: { [key: string]: string } = {
            javascript: 'Use modern ES6+ syntax. Follow idiomatic JavaScript patterns.',
            typescript: 'Use TypeScript with proper types. Follow idiomatic TypeScript patterns.',
            python: 'Follow PEP 8 style guide. Use type hints where appropriate.',
            java: 'Follow Java conventions and best practices.',
            go: 'Follow Go idioms and conventions.',
            rust: 'Follow Rust idioms and ownership principles.',
            cpp: 'Follow modern C++ (C++17/20) standards.',
            c: 'Follow C best practices and standards.',
            csharp: 'Follow C# conventions and .NET guidelines.',
            ruby: 'Follow Ruby style guide and conventions.',
            php: 'Follow PSR standards and modern PHP practices.',
            swift: 'Follow Swift conventions and idioms.',
            kotlin: 'Follow Kotlin conventions and best practices.',
            html: 'Use semantic HTML5 elements.',
            css: 'Follow modern CSS best practices.',
            sql: 'Use proper SQL syntax and formatting.'
        };

        return instructions[language] || 'Follow language best practices and conventions.';
    }
}
