import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { FunctionDeclaration, ToolDefinition, ToolResult } from '../types';

/**
 * All tool function declarations for Gemini function calling.
 */
export function getToolDefinitions(): ToolDefinition {
    return {
        functionDeclarations: [
            {
                name: 'read_file',
                description: 'Read the contents of a file. Returns the full file text or a line range.',
                parameters: {
                    type: 'object',
                    properties: {
                        path: {
                            type: 'string',
                            description: 'Absolute or workspace-relative path to the file.'
                        },
                        startLine: {
                            type: 'number',
                            description: 'Optional 1-indexed start line. Omit to read the full file.'
                        },
                        endLine: {
                            type: 'number',
                            description: 'Optional 1-indexed end line (inclusive). Omit to read to end.'
                        }
                    },
                    required: ['path']
                }
            },
            {
                name: 'write_file',
                description: 'Create or overwrite a file with the given content. Creates parent directories if needed.',
                parameters: {
                    type: 'object',
                    properties: {
                        path: {
                            type: 'string',
                            description: 'Absolute or workspace-relative path to the file.'
                        },
                        content: {
                            type: 'string',
                            description: 'The full content to write to the file.'
                        }
                    },
                    required: ['path', 'content']
                }
            },
            {
                name: 'edit_file',
                description: 'Replace a specific string/block in a file with new content. Use this for surgical edits rather than rewriting the whole file.',
                parameters: {
                    type: 'object',
                    properties: {
                        path: {
                            type: 'string',
                            description: 'Absolute or workspace-relative path to the file.'
                        },
                        old_text: {
                            type: 'string',
                            description: 'The exact text to find and replace. Must match exactly including whitespace.'
                        },
                        new_text: {
                            type: 'string',
                            description: 'The replacement text.'
                        }
                    },
                    required: ['path', 'old_text', 'new_text']
                }
            },
            {
                name: 'list_directory',
                description: 'List files and subdirectories at the given path. Returns names with type indicators (📁 for dirs, 📄 for files).',
                parameters: {
                    type: 'object',
                    properties: {
                        path: {
                            type: 'string',
                            description: 'Absolute or workspace-relative path to the directory.'
                        },
                        recursive: {
                            type: 'boolean',
                            description: 'If true, list recursively (max 3 levels deep). Default false.'
                        }
                    },
                    required: ['path']
                }
            },
            {
                name: 'search_workspace',
                description: 'Search for a text pattern across workspace files. Returns matching file paths and line numbers.',
                parameters: {
                    type: 'object',
                    properties: {
                        query: {
                            type: 'string',
                            description: 'The search string or pattern.'
                        },
                        include: {
                            type: 'string',
                            description: 'Glob pattern to include (e.g. "**/*.ts"). Default: all files.'
                        },
                        maxResults: {
                            type: 'number',
                            description: 'Maximum number of results. Default 20.'
                        }
                    },
                    required: ['query']
                }
            },
            {
                name: 'run_terminal',
                description: 'Execute a shell command in the workspace root and return its stdout/stderr. Use for build commands, tests, git, etc.',
                parameters: {
                    type: 'object',
                    properties: {
                        command: {
                            type: 'string',
                            description: 'The shell command to execute.'
                        },
                        cwd: {
                            type: 'string',
                            description: 'Working directory. Defaults to workspace root.'
                        }
                    },
                    required: ['command']
                }
            },
            {
                name: 'get_diagnostics',
                description: 'Get VS Code diagnostics (errors, warnings) for a specific file or the entire workspace.',
                parameters: {
                    type: 'object',
                    properties: {
                        path: {
                            type: 'string',
                            description: 'Optional file path. If omitted, returns diagnostics for all files with issues.'
                        }
                    },
                    required: []
                }
            },
            {
                name: 'open_file',
                description: 'Open a file in the VS Code editor for the user to see.',
                parameters: {
                    type: 'object',
                    properties: {
                        path: {
                            type: 'string',
                            description: 'Absolute or workspace-relative path to the file.'
                        },
                        line: {
                            type: 'number',
                            description: 'Optional line number to scroll to.'
                        }
                    },
                    required: ['path']
                }
            }
        ]
    };
}

/**
 * Resolve a path that may be workspace-relative to an absolute path.
 */
function resolvePath(inputPath: string): string {
    if (path.isAbsolute(inputPath)) {
        return inputPath;
    }
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
        return path.join(workspaceFolders[0].uri.fsPath, inputPath);
    }
    return inputPath;
}

/**
 * Execute a tool by name with the given arguments.
 */
export async function executeTool(name: string, args: Record<string, any>): Promise<ToolResult> {
    try {
        switch (name) {
            case 'read_file':
                return await toolReadFile(args);
            case 'write_file':
                return await toolWriteFile(args);
            case 'edit_file':
                return await toolEditFile(args);
            case 'list_directory':
                return await toolListDirectory(args);
            case 'search_workspace':
                return await toolSearchWorkspace(args);
            case 'run_terminal':
                return await toolRunTerminal(args);
            case 'get_diagnostics':
                return await toolGetDiagnostics(args);
            case 'open_file':
                return await toolOpenFile(args);
            default:
                return { success: false, content: '', error: `Unknown tool: ${name}` };
        }
    } catch (err: any) {
        return { success: false, content: '', error: err.message || String(err) };
    }
}

// ============================
// Tool Implementations
// ============================

async function toolReadFile(args: Record<string, any>): Promise<ToolResult> {
    const filePath = resolvePath(args.path);
    const uri = vscode.Uri.file(filePath);

    const rawBytes = await vscode.workspace.fs.readFile(uri);
    let text = Buffer.from(rawBytes).toString('utf8');

    // Apply line range if specified
    if (args.startLine || args.endLine) {
        const lines = text.split('\n');
        const start = Math.max(1, args.startLine || 1) - 1;
        const end = args.endLine ? Math.min(lines.length, args.endLine) : lines.length;
        text = lines.slice(start, end).map((line, i) => `${start + i + 1}: ${line}`).join('\n');
    }

    // Truncate if extremely long
    if (text.length > 50000) {
        text = text.slice(0, 50000) + '\n\n... [truncated, file too large. Use startLine/endLine to read sections]';
    }

    return { success: true, content: text };
}

async function toolWriteFile(args: Record<string, any>): Promise<ToolResult> {
    const filePath = resolvePath(args.path);
    const uri = vscode.Uri.file(filePath);

    // Ensure parent directory exists
    const dir = path.dirname(filePath);
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(dir));

    await vscode.workspace.fs.writeFile(uri, Buffer.from(args.content, 'utf8'));

    return { success: true, content: `✅ File written: ${path.basename(filePath)} (${args.content.split('\n').length} lines)` };
}

async function toolEditFile(args: Record<string, any>): Promise<ToolResult> {
    const filePath = resolvePath(args.path);
    const uri = vscode.Uri.file(filePath);

    const rawBytes = await vscode.workspace.fs.readFile(uri);
    const currentText = Buffer.from(rawBytes).toString('utf8');

    if (!currentText.includes(args.old_text)) {
        return {
            success: false,
            content: '',
            error: `Could not find the specified text to replace in ${path.basename(filePath)}. Make sure old_text matches exactly.`
        };
    }

    const newText = currentText.replace(args.old_text, args.new_text);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(newText, 'utf8'));

    const oldLines = args.old_text.split('\n').length;
    const newLines = args.new_text.split('\n').length;
    const diff = newLines - oldLines;
    const diffStr = diff > 0 ? `+${diff}` : diff < 0 ? `${diff}` : '±0';

    return {
        success: true,
        content: `✅ Edited ${path.basename(filePath)}: replaced ${oldLines} lines → ${newLines} lines (${diffStr})`
    };
}

async function toolListDirectory(args: Record<string, any>): Promise<ToolResult> {
    const dirPath = resolvePath(args.path);
    const uri = vscode.Uri.file(dirPath);
    const recursive = args.recursive || false;

    const entries = await listDir(uri, recursive, 0, 3);
    return { success: true, content: entries.join('\n') };
}

async function listDir(uri: vscode.Uri, recursive: boolean, depth: number, maxDepth: number): Promise<string[]> {
    const results: string[] = [];
    const entries = await vscode.workspace.fs.readDirectory(uri);
    const indent = '  '.repeat(depth);

    // Sort: directories first, then files
    entries.sort((a, b) => {
        if (a[1] === b[1]) { return a[0].localeCompare(b[0]); }
        return a[1] === vscode.FileType.Directory ? -1 : 1;
    });

    for (const [name, type] of entries) {
        if (name.startsWith('.') && name !== '.env') { continue; } // Skip hidden except .env
        if (name === 'node_modules' || name === 'out' || name === '.git') { continue; }

        if (type === vscode.FileType.Directory) {
            results.push(`${indent}📁 ${name}/`);
            if (recursive && depth < maxDepth) {
                const subUri = vscode.Uri.joinPath(uri, name);
                const subResults = await listDir(subUri, true, depth + 1, maxDepth);
                results.push(...subResults);
            }
        } else {
            results.push(`${indent}📄 ${name}`);
        }
    }

    return results;
}

async function toolSearchWorkspace(args: Record<string, any>): Promise<ToolResult> {
    const query = args.query;
    const include = args.include || '**/*';
    const maxResults = args.maxResults || 20;

    // Use VS Code's findTextInFiles API (available in newer VS Code)
    // Fallback: use ripgrep-style search via workspace.findFiles + manual scan
    const results: string[] = [];

    try {
        const files = await vscode.workspace.findFiles(include, '**/node_modules/**', 100);

        for (const file of files) {
            if (results.length >= maxResults) { break; }

            try {
                const rawBytes = await vscode.workspace.fs.readFile(file);
                const text = Buffer.from(rawBytes).toString('utf8');
                const lines = text.split('\n');

                for (let i = 0; i < lines.length; i++) {
                    if (results.length >= maxResults) { break; }
                    if (lines[i].includes(query)) {
                        const relativePath = vscode.workspace.asRelativePath(file);
                        results.push(`${relativePath}:${i + 1}: ${lines[i].trim()}`);
                    }
                }
            } catch {
                // Skip files that can't be read (binary, etc.)
            }
        }
    } catch (err: any) {
        return { success: false, content: '', error: `Search failed: ${err.message}` };
    }

    if (results.length === 0) {
        return { success: true, content: `No results found for "${query}"` };
    }

    return { success: true, content: `Found ${results.length} match(es):\n\n${results.join('\n')}` };
}

async function toolRunTerminal(args: Record<string, any>): Promise<ToolResult> {
    const command = args.command;
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const cwd = args.cwd
        ? resolvePath(args.cwd)
        : workspaceFolders?.[0]?.uri.fsPath || process.cwd();

    return new Promise((resolve) => {
        const { exec } = require('child_process');
        const childProcess = exec(command, {
            cwd,
            timeout: 30000,  // 30s timeout
            maxBuffer: 1024 * 1024  // 1MB output buffer
        }, (error: any, stdout: string, stderr: string) => {
            let output = '';
            if (stdout && stdout.trim()) {
                output += stdout.trim();
            }
            if (stderr && stderr.trim()) {
                output += (output ? '\n\nSTDERR:\n' : '') + stderr.trim();
            }

            // Truncate very long output
            if (output.length > 10000) {
                output = output.slice(0, 10000) + '\n\n... [output truncated]';
            }

            if (error && error.killed) {
                resolve({ success: false, content: output, error: 'Command timed out (30s limit)' });
            } else if (error) {
                resolve({
                    success: false,
                    content: output || error.message,
                    error: `Exit code: ${error.code}`
                });
            } else {
                resolve({ success: true, content: output || '(no output)' });
            }
        });
    });
}

async function toolGetDiagnostics(args: Record<string, any>): Promise<ToolResult> {
    let diagnostics: [vscode.Uri, readonly vscode.Diagnostic[]][];

    if (args.path) {
        const filePath = resolvePath(args.path);
        const uri = vscode.Uri.file(filePath);
        const fileDiags = vscode.languages.getDiagnostics(uri);
        diagnostics = [[uri, fileDiags]];
    } else {
        diagnostics = vscode.languages.getDiagnostics();
    }

    const results: string[] = [];
    for (const [uri, diags] of diagnostics) {
        if (diags.length === 0) { continue; }
        const relativePath = vscode.workspace.asRelativePath(uri);
        for (const d of diags) {
            const severity = ['Error', 'Warning', 'Info', 'Hint'][d.severity] || 'Unknown';
            results.push(`${relativePath}:${d.range.start.line + 1}: [${severity}] ${d.message}`);
        }
    }

    if (results.length === 0) {
        return { success: true, content: '✅ No diagnostics (errors/warnings) found.' };
    }

    return { success: true, content: `Found ${results.length} diagnostic(s):\n\n${results.join('\n')}` };
}

async function toolOpenFile(args: Record<string, any>): Promise<ToolResult> {
    const filePath = resolvePath(args.path);
    const uri = vscode.Uri.file(filePath);

    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });

    if (args.line && typeof args.line === 'number') {
        const line = Math.max(0, args.line - 1);
        const range = new vscode.Range(line, 0, line, 0);
        editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
        editor.selection = new vscode.Selection(line, 0, line, 0);
    }

    return { success: true, content: `✅ Opened ${path.basename(filePath)} in editor` };
}
