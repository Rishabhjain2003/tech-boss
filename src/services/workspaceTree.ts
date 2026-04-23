import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';

export type BlobHash = string; // hex SHA-256

export interface BlobObject {
    hash: BlobHash;
    content: string;  // UTF-8 file content
    size: number;
}

export interface TreeEntry {
    name: string;       // filename or dirname
    type: 'blob' | 'tree';
    hash: BlobHash;     // blob hash or tree hash
}

export interface TreeObject {
    hash: BlobHash;     // SHA-256 of sorted entries JSON
    entries: TreeEntry[];
}

export interface Snapshot {
    id: string;           // timestamp-based ID
    rootTreeHash: BlobHash;
    message: string;
    timestamp: number;
    changedPaths: string[]; // relative paths that changed vs previous snapshot
}

const DEFAULT_IGNORE = ['node_modules', '.git', 'dist', 'out', '.env', '.DS_Store'];

export class WorkspaceTree {
    private blobStore = new Map<BlobHash, BlobObject>();
    private treeStore = new Map<BlobHash, TreeObject>();
    private snapshots: Snapshot[] = [];
    private workspaceRoot: string;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
    }

    /** Hash a string with SHA-256 */
    private hash(content: string): BlobHash {
        return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
    }

    /** Store a file as a blob; returns its hash */
    storeBlob(content: string): BlobHash {
        const h = this.hash(content);
        if (!this.blobStore.has(h)) {
            this.blobStore.set(h, { hash: h, content, size: Buffer.byteLength(content, 'utf8') });
        }
        return h;
    }

    /**
     * Build a tree object from a directory path (recursive).
     * Returns the tree hash.
     */
    buildTree(dirPath: string, ignore: string[] = DEFAULT_IGNORE): BlobHash {
        const entries: TreeEntry[] = [];
        let items: string[];
        try {
            items = fs.readdirSync(dirPath);
        } catch {
            return this.storeBlob('{}');
        }

        for (const item of items.sort()) {
            if (ignore.includes(item) || item.startsWith('.')) { continue; }
            const fullPath = path.join(dirPath, item);
            let stat: fs.Stats;
            try { stat = fs.statSync(fullPath); } catch { continue; }

            if (stat.isDirectory()) {
                const childHash = this.buildTree(fullPath, ignore);
                entries.push({ name: item, type: 'tree', hash: childHash });
            } else if (stat.isFile()) {
                // Skip binary / very large files
                if (stat.size > 512 * 1024) { continue; } // >512KB skip
                try {
                    const content = fs.readFileSync(fullPath, 'utf8');
                    const blobHash = this.storeBlob(content);
                    entries.push({ name: item, type: 'blob', hash: blobHash });
                } catch { continue; }
            }
        }

        const treeJson = JSON.stringify(entries);
        const treeHash = this.hash(treeJson);
        this.treeStore.set(treeHash, { hash: treeHash, entries });
        return treeHash;
    }

    /** Take a snapshot of the current workspace state */
    takeSnapshot(message: string): Snapshot {
        const rootTreeHash = this.buildTree(this.workspaceRoot);
        const previous = this.snapshots[this.snapshots.length - 1];
        const changedPaths = previous
            ? this.diffTrees(previous.rootTreeHash, rootTreeHash)
            : [];
        const snap: Snapshot = {
            id: Date.now().toString(),
            rootTreeHash,
            message,
            timestamp: Date.now(),
            changedPaths,
        };
        this.snapshots.push(snap);
        return snap;
    }

    /** Compute which file paths changed between two tree hashes */
    diffTrees(oldRoot: BlobHash, newRoot: BlobHash, prefix = ''): string[] {
        if (oldRoot === newRoot) { return []; }
        const oldTree = this.treeStore.get(oldRoot);
        const newTree = this.treeStore.get(newRoot);
        if (!oldTree || !newTree) { return []; }

        const changed: string[] = [];
        const oldMap = new Map(oldTree.entries.map(e => [e.name, e]));
        const newMap = new Map(newTree.entries.map(e => [e.name, e]));

        for (const [name, newEntry] of newMap) {
            const oldEntry = oldMap.get(name);
            const p = prefix ? `${prefix}/${name}` : name;
            if (!oldEntry) {
                changed.push(p); // new file/dir
            } else if (oldEntry.hash !== newEntry.hash) {
                if (newEntry.type === 'tree' && oldEntry.type === 'tree') {
                    changed.push(...this.diffTrees(oldEntry.hash, newEntry.hash, p));
                } else {
                    changed.push(p); // modified file
                }
            }
        }
        for (const [name] of oldMap) {
            if (!newMap.has(name)) {
                changed.push(prefix ? `${prefix}/${name}` : name); // deleted
            }
        }
        return changed;
    }

    /** Get blob content by hash (used by get_blob tool) */
    getBlob(hash: BlobHash): string | null {
        return this.blobStore.get(hash)?.content ?? null;
    }

    /**
     * Get the tree structure as a compact JSON for the Gemini system prompt.
     * Only returns short hashes (no content) — the agent calls get_blob to fetch content.
     */
    getTreeManifest(treeHash?: BlobHash): object {
        const root = treeHash ?? this.snapshots[this.snapshots.length - 1]?.rootTreeHash;
        if (!root) { return {}; }
        return this.buildManifest(root);
    }

    private buildManifest(treeHash: BlobHash): object {
        const tree = this.treeStore.get(treeHash);
        if (!tree) { return {}; }
        const result: Record<string, any> = {};
        for (const entry of tree.entries) {
            if (entry.type === 'blob') {
                result[entry.name] = entry.hash.slice(0, 8); // short hash
            } else {
                result[entry.name] = this.buildManifest(entry.hash);
            }
        }
        return result;
    }

    /** Get changed blobs with their full content (for the next prompt) */
    getChangedBlobContents(snapshotId?: string): Array<{ path: string; content: string; hash: string }> {
        const snap = snapshotId
            ? this.snapshots.find(s => s.id === snapshotId)
            : this.snapshots[this.snapshots.length - 1];
        if (!snap) { return []; }

        return snap.changedPaths
            .map(p => {
                const hash = this.resolvePathToHash(p, snap.rootTreeHash);
                const blob = hash ? this.blobStore.get(hash) : null;
                return blob ? { path: p, content: blob.content, hash: blob.hash } : null;
            })
            .filter((x): x is { path: string; content: string; hash: string } => x !== null);
    }

    /** Walk tree to resolve a file path to its blob hash */
    resolvePathToHash(filePath: string, rootHash: BlobHash): BlobHash | null {
        const parts = filePath.split('/');
        let currentHash = rootHash;
        for (let i = 0; i < parts.length; i++) {
            const tree = this.treeStore.get(currentHash);
            if (!tree) { return null; }
            const entry = tree.entries.find(e => e.name === parts[i]);
            if (!entry) { return null; }
            if (i === parts.length - 1) { return entry.type === 'blob' ? entry.hash : null; }
            currentHash = entry.hash;
        }
        return null;
    }

    getLatestSnapshot(): Snapshot | null {
        return this.snapshots[this.snapshots.length - 1] ?? null;
    }

    getSnapshots(): Snapshot[] {
        return [...this.snapshots];
    }

    /** Resolve a short hash (8 chars) back to the full hash */
    resolveShortHash(short: string): BlobHash | null {
        for (const [h] of this.blobStore) {
            if (h.startsWith(short)) { return h; }
        }
        return null;
    }
}
