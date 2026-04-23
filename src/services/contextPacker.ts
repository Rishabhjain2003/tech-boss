import { WorkspaceTree } from './workspaceTree';

/**
 * Builds the system prompt and initial context for the Gemini API call
 * using the workspace tree to minimize token usage.
 */
export class ContextPacker {
    constructor(private tree: WorkspaceTree) {}

    /** Build the system instruction for Gemini */
    buildSystemPrompt(): string {
        const indexed = this.tree.getLatestSnapshot()?.rootTreeHash ? 'indexed' : 'not yet indexed — call get_tree_manifest first';
        return `You are Tech Boss, an expert AI coding agent inside VS Code.
You have access to tools to read/write files, run terminal commands, search the workspace, and get VS Code diagnostics.

WORKSPACE TREE STRATEGY (important for efficiency):
- Call get_tree_manifest first to see all files and their short hashes.
- Use get_blob(hash) to fetch a file's content WITHOUT repeating the full path on every turn. This saves tokens.
- Only call read_file when you need a specific line range or the hash is unavailable.
- Files with the SAME short hash as last turn are UNCHANGED — skip them.

TOOL USAGE RULES:
- You may call multiple tools in sequence within a single turn.
- For file edits, use edit_file with exact old_str / new_str for surgical changes.
- Use write_file only for creating new files or full rewrites.
- Always verify your changes compiled/worked by using get_diagnostics or run_terminal.

You autonomously decide what actions to take. Show your reasoning briefly before each tool call. After completing a task, summarize what you did.

Current workspace: ${indexed}`;
    }

    /** Build the initial context message including the manifest and changed blobs */
    buildInitialContext(): string {
        const snap = this.tree.getLatestSnapshot();
        if (!snap) { return 'Workspace not yet indexed.'; }

        const manifest = this.tree.getTreeManifest();
        const changed = this.tree.getChangedBlobContents();

        let ctx = `WORKSPACE MANIFEST (path → short hash):\n${JSON.stringify(manifest, null, 2)}\n`;

        if (changed.length > 0) {
            ctx += `\nRECENTLY CHANGED FILES (full content):\n`;
            for (const f of changed) {
                ctx += `\n--- ${f.path} (${f.hash.slice(0, 8)}) ---\n${f.content}\n`;
            }
        }

        return ctx;
    }
}
