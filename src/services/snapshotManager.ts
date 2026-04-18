import { WorkspaceTree, Snapshot } from './workspaceTree';

/**
 * Thin wrapper around WorkspaceTree that the tool system calls
 * to automatically take snapshots before/after file-mutating operations.
 */
export class SnapshotManager {
    constructor(private tree: WorkspaceTree) {}

    /** Take a snapshot before a mutating tool executes */
    async before(toolName: string, params: any): Promise<void> {
        if (['write_file', 'edit_file'].includes(toolName)) {
            const paramSummary = JSON.stringify(params).slice(0, 60);
            this.tree.takeSnapshot(`before:${toolName}:${paramSummary}`);
        }
    }

    /** Take a snapshot after a mutating tool completes */
    async after(toolName: string): Promise<void> {
        if (['write_file', 'edit_file'].includes(toolName)) {
            this.tree.takeSnapshot(`after:${toolName}`);
        }
    }

    /** Find the last 'before:' snapshot for undo support */
    getUndoTarget(): Snapshot | null {
        const snaps = this.tree.getSnapshots();
        for (let i = snaps.length - 1; i >= 0; i--) {
            if (snaps[i].message.startsWith('before:')) { return snaps[i]; }
        }
        return null;
    }
}
