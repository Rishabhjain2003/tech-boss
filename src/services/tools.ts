import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { WorkspaceTree } from './workspaceTree';
import { SnapshotManager } from './snapshotManager';

// ─── Interfaces ────────────────────────────────────────────────────────────────

export interface ToolContext {
    workspaceRoot: string;
    workspaceTree: WorkspaceTree;
    snapshotManager: SnapshotManager;
}

export interface ToolDefinition {
    declaration: {
        name: string;
        description: string;
        parameters: {
            type: 'object';
            properties: Record<string, any>;
            required?: string[];
        };
    };
    execute: (params: any, context: ToolContext) => Promise<string>;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Resolve a relative or absolute path against the workspace root */
function resolvePath(p: string, root: string): string {
    if (path.isAbsolute(p)) { return p; }
    return path.join(root, p);
}

/** Truncate a string to a max length */
function truncate(s: string, max: number): string {
    if (s.length <= max) { return s; }
    return s.slice(0, max) + `\n...(truncated, ${s.length - max} more chars)`;
}

// ─── Tool Definitions ──────────────────────────────────────────────────────────

const readFile: ToolDefinition = {
    declaration: {
        name: 'read_file',
        description: 'Read the contents of a file from disk. Optionally specify a line range.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'File path (relative to workspace or absolute)' },
                start_line: { type: 'number', description: 'Optional 1-based start line' },
                end_line: { type: 'number', description: 'Optional 1-based end line' },
            },
            required: ['path'],
        },
    },
    execute: async (params, ctx) => {
        const filePath = resolvePath(params.path, ctx.workspaceRoot);
        try {
            const uri = vscode.Uri.file(filePath);
            const bytes = await vscode.workspace.fs.readFile(uri);
            let content = Buffer.from(bytes).toString('utf8');

            if (params.start_line || params.end_line) {
                const lines = content.split('\n');
                const start = Math.max(1, params.start_line || 1) - 1;
                const end = Math.min(lines.length, params.end_line || lines.length);
                content = lines.slice(start, end).join('\n');
            }

            return truncate(content, 30000);
        } catch (err: any) {
            return `Error reading file: ${err.message}`;
        }
    },
};

const writeFile: ToolDefinition = {
    declaration: {
        name: 'write_file',
        description: 'Write content to a file. Creates the file if it does not exist.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'File path (relative to workspace or absolute)' },
                content: { type: 'string', description: 'File content to write' },
            },
            required: ['path', 'content'],
        },
    },
    execute: async (params, ctx) => {
        const filePath = resolvePath(params.path, ctx.workspaceRoot);
        try {
            await ctx.snapshotManager.before('write_file', { path: params.path });
            const uri = vscode.Uri.file(filePath);
            // Ensure parent directory exists
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            await vscode.workspace.fs.writeFile(uri, Buffer.from(params.content, 'utf8'));
            await ctx.snapshotManager.after('write_file');
            return `Successfully wrote ${Buffer.byteLength(params.content, 'utf8')} bytes to ${params.path}`;
        } catch (err: any) {
            return `Error writing file: ${err.message}`;
        }
    },
};

const editFile: ToolDefinition = {
    declaration: {
        name: 'edit_file',
        description: 'Perform a surgical string replacement in a file. Replaces the first occurrence of old_str with new_str.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'File path (relative to workspace or absolute)' },
                old_str: { type: 'string', description: 'Exact string to find and replace' },
                new_str: { type: 'string', description: 'Replacement string' },
            },
            required: ['path', 'old_str', 'new_str'],
        },
    },
    execute: async (params, ctx) => {
        const filePath = resolvePath(params.path, ctx.workspaceRoot);
        try {
            const uri = vscode.Uri.file(filePath);
            const bytes = await vscode.workspace.fs.readFile(uri);
            const content = Buffer.from(bytes).toString('utf8');

            if (!content.includes(params.old_str)) {
                return `Error: old_str not found in ${params.path}. Make sure the string matches exactly (including whitespace and newlines).`;
            }

            await ctx.snapshotManager.before('edit_file', { path: params.path });
            const newContent = content.replace(params.old_str, params.new_str);
            await vscode.workspace.fs.writeFile(uri, Buffer.from(newContent, 'utf8'));
            await ctx.snapshotManager.after('edit_file');

            return `Successfully edited ${params.path}. Replaced ${params.old_str.length} chars with ${params.new_str.length} chars.`;
        } catch (err: any) {
            return `Error editing file: ${err.message}`;
        }
    },
};

const listDirectory: ToolDefinition = {
    declaration: {
        name: 'list_directory',
        description: 'List the contents of a directory.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Directory path (relative to workspace or absolute)' },
                recursive: { type: 'boolean', description: 'List recursively (default false)' },
            },
            required: ['path'],
        },
    },
    execute: async (params, ctx) => {
        const dirPath = resolvePath(params.path, ctx.workspaceRoot);
        try {
            const listDir = (dir: string, prefix: string, depth: number): string[] => {
                const items = fs.readdirSync(dir);
                const results: string[] = [];
                for (const item of items.sort()) {
                    if (['node_modules', '.git', 'dist', 'out'].includes(item)) { continue; }
                    const fullPath = path.join(dir, item);
                    let stat: fs.Stats;
                    try { stat = fs.statSync(fullPath); } catch { continue; }
                    const rel = prefix ? `${prefix}/${item}` : item;
                    if (stat.isDirectory()) {
                        results.push(`📁 ${rel}/`);
                        if (params.recursive && depth < 5) {
                            results.push(...listDir(fullPath, rel, depth + 1));
                        }
                    } else {
                        results.push(`📄 ${rel} (${stat.size} bytes)`);
                    }
                }
                return results;
            };

            const entries = listDir(dirPath, '', 0);
            return entries.length > 0
                ? entries.join('\n')
                : 'Directory is empty.';
        } catch (err: any) {
            return `Error listing directory: ${err.message}`;
        }
    },
};

const runTerminal: ToolDefinition = {
    declaration: {
        name: 'run_terminal',
        description: 'Run a shell command and return stdout and stderr. 30-second timeout.',
        parameters: {
            type: 'object',
            properties: {
                command: { type: 'string', description: 'Shell command to execute' },
                cwd: { type: 'string', description: 'Optional working directory (defaults to workspace root)' },
            },
            required: ['command'],
        },
    },
    execute: async (params, ctx) => {
        const cwd = params.cwd ? resolvePath(params.cwd, ctx.workspaceRoot) : ctx.workspaceRoot;
        return new Promise((resolve) => {
            exec(
                params.command,
                { cwd, timeout: 30000, maxBuffer: 1024 * 1024 },
                (error, stdout, stderr) => {
                    let result = '';
                    if (stdout) { result += `STDOUT:\n${truncate(stdout, 15000)}\n`; }
                    if (stderr) { result += `STDERR:\n${truncate(stderr, 5000)}\n`; }
                    if (error) { result += `EXIT CODE: ${error.code ?? 1}\n`; }
                    else { result += 'EXIT CODE: 0\n'; }
                    resolve(result || 'Command completed with no output.');
                },
            );
        });
    },
};

const searchWorkspace: ToolDefinition = {
    declaration: {
        name: 'search_workspace',
        description: 'Search for a regex pattern across the workspace files.',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Regex pattern to search for' },
                include_pattern: { type: 'string', description: 'Glob pattern to filter files (e.g. "**/*.ts")' },
                max_results: { type: 'number', description: 'Maximum results to return (default 20)' },
            },
            required: ['query'],
        },
    },
    execute: async (params, ctx) => {
        const maxResults = params.max_results || 20;
        const includePattern = params.include_pattern || '**/*';

        try {
            const files = await vscode.workspace.findFiles(includePattern, '**/node_modules/**', 100);
            const regex = new RegExp(params.query, 'gi');
            const results: string[] = [];

            for (const file of files) {
                if (results.length >= maxResults) { break; }
                try {
                    const doc = await vscode.workspace.openTextDocument(file);
                    const text = doc.getText();
                    const lines = text.split('\n');
                    for (let i = 0; i < lines.length; i++) {
                        if (results.length >= maxResults) { break; }
                        if (regex.test(lines[i])) {
                            const relativePath = vscode.workspace.asRelativePath(file);
                            results.push(`${relativePath}:${i + 1}: ${lines[i].trim()}`);
                        }
                        regex.lastIndex = 0; // reset for next line
                    }
                } catch { continue; }
            }

            return results.length > 0
                ? results.join('\n')
                : `No matches found for "${params.query}".`;
        } catch (err: any) {
            return `Error searching workspace: ${err.message}`;
        }
    },
};

const getDiagnostics: ToolDefinition = {
    declaration: {
        name: 'get_diagnostics',
        description: 'Get VS Code diagnostics (errors, warnings) for a file or the entire workspace.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Optional file path. Omit for all diagnostics.' },
            },
        },
    },
    execute: async (params, ctx) => {
        let diagnostics: [vscode.Uri, readonly vscode.Diagnostic[]][];

        if (params.path) {
            const filePath = resolvePath(params.path, ctx.workspaceRoot);
            const uri = vscode.Uri.file(filePath);
            const diags = vscode.languages.getDiagnostics(uri);
            diagnostics = [[uri, diags]];
        } else {
            diagnostics = vscode.languages.getDiagnostics() as [vscode.Uri, readonly vscode.Diagnostic[]][];
        }

        const results: string[] = [];
        for (const [uri, diags] of diagnostics) {
            for (const d of diags) {
                if (d.severity !== undefined && d.severity <= vscode.DiagnosticSeverity.Warning) {
                    const relativePath = vscode.workspace.asRelativePath(uri);
                    const severity = d.severity === vscode.DiagnosticSeverity.Error ? '❌' : '⚠️';
                    results.push(`${severity} ${relativePath}:${d.range.start.line + 1}: ${d.message}`);
                }
            }
        }

        return results.length > 0
            ? results.join('\n')
            : 'No errors or warnings found.';
    },
};

const openFile: ToolDefinition = {
    declaration: {
        name: 'open_file',
        description: 'Open a file in the VS Code editor.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'File path (relative to workspace or absolute)' },
                line: { type: 'number', description: 'Optional line number to jump to' },
            },
            required: ['path'],
        },
    },
    execute: async (params, ctx) => {
        const filePath = resolvePath(params.path, ctx.workspaceRoot);
        try {
            const uri = vscode.Uri.file(filePath);
            const doc = await vscode.workspace.openTextDocument(uri);
            const options: vscode.TextDocumentShowOptions = {};
            if (params.line) {
                const pos = new vscode.Position(Math.max(0, params.line - 1), 0);
                options.selection = new vscode.Range(pos, pos);
            }
            await vscode.window.showTextDocument(doc, options);
            return `Opened ${params.path}${params.line ? ` at line ${params.line}` : ''}`;
        } catch (err: any) {
            return `Error opening file: ${err.message}`;
        }
    },
};

const getBlob: ToolDefinition = {
    declaration: {
        name: 'get_blob',
        description: 'Fetch file content by its short hash (first 8 characters) from the workspace tree. Use this instead of read_file when you already have the manifest — it saves tokens.',
        parameters: {
            type: 'object',
            properties: {
                hash: { type: 'string', description: '8-character short hash from the workspace manifest' },
            },
            required: ['hash'],
        },
    },
    execute: async (params, ctx) => {
        const fullHash = ctx.workspaceTree.resolveShortHash(params.hash);
        if (!fullHash) {
            return `Error: No blob found with short hash "${params.hash}". Try calling get_tree_manifest to get current hashes.`;
        }
        const content = ctx.workspaceTree.getBlob(fullHash);
        if (!content) {
            return `Error: Blob content not found for hash "${params.hash}".`;
        }
        return truncate(content, 30000);
    },
};

const getTreeManifest: ToolDefinition = {
    declaration: {
        name: 'get_tree_manifest',
        description: 'Returns the current workspace tree manifest showing all file paths mapped to their short hashes. Call this first to understand the workspace structure, then use get_blob to fetch specific files.',
        parameters: {
            type: 'object',
            properties: {},
        },
    },
    execute: async (_params, ctx) => {
        // Take a fresh snapshot to ensure manifest is current
        ctx.workspaceTree.takeSnapshot('manifest_request');
        const manifest = ctx.workspaceTree.getTreeManifest();
        return JSON.stringify(manifest, null, 2);
    },
};

// ─── Exports ───────────────────────────────────────────────────────────────────

export const allTools: ToolDefinition[] = [
    readFile,
    writeFile,
    editFile,
    listDirectory,
    runTerminal,
    searchWorkspace,
    getDiagnostics,
    openFile,
    getBlob,
    getTreeManifest,
];

/** Map of tool name → tool definition for the executor */
export function buildToolMap(): Record<string, ToolDefinition> {
    const map: Record<string, ToolDefinition> = {};
    for (const tool of allTools) {
        map[tool.declaration.name] = tool;
    }
    return map;
}

/** Get all tool declarations for the Gemini API */
export function getToolDeclarations(): Array<{ name: string; description: string; parameters: any }> {
    return allTools.map(t => t.declaration);
}
