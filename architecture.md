# Tech Boss — Architecture Deep Dive

## 1. High-Level System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         VS Code Extension Host                      │
│                                                                     │
│  ┌──────────────┐    ┌──────────────────────────────────────────┐   │
│  │ extension.ts │───>│          ChatViewProvider                │   │
│  │  (entry pt)  │    │  - initializes all services              │   │
│  └──────┬───────┘    │  - bridges webview <-> agent loop        │   │
│         │            └─────────────┬────────────────────────────┘   │
│         │                          │                                │
│         │         ┌────────────────┼─────────────────────┐          │
│         │         │                │                     │          │
│         v         v                v                     v          │
│  ┌────────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐     │
│  │ Completion │ │  Agent   │ │  Gemini  │ │  WorkspaceTree   │     │
│  │ Provider   │ │  Loop    │ │  Client  │ │  + SnapshotMgr   │     │
│  │ (inline)   │ │          │ │  (SDK)   │ │  + ContextPacker │     │
│  └────────────┘ └──────────┘ └──────────┘ └──────────────────┘     │
│        │              │            │               │                │
│        │              v            │               │                │
│        │        ┌──────────┐       │               │                │
│        │        │  Tools   │       │               │                │
│        │        │ (10 tools│       │               │                │
│        │        └──────────┘       │               │                │
│        │                           │               │                │
│        └───────────────────────────┘               │                │
│              both use GeminiClient                  │                │
│                                                     │                │
└─────────────────────────────────────────────────────┘                │
                                                                      │
                                      ┌───────────────────────────────┘
                                      v
                              ┌──────────────┐
                              │  File System │
                              │  (workspace) │
                              └──────────────┘
```

---

## 2. The Agent Loop — Step by Step

This is the core of the system. When a user sends a message, here's exactly what happens:

```
  USER types message
       │
       v
┌──────────────────┐
│  Webview (HTML)  │
│  sends postMsg:  │
│  {type:'send',   │
│   text:'...'}    │
└────────┬─────────┘
         │
         │  postMessage
         v
┌──────────────────┐
│ ChatViewProvider │──── creates AgentLoop on first message
│  handleUserMsg() │         │
└────────┬─────────┘         │
         │                    │
         v                    v
┌────────────────────────────────────────────────────────────────┐
│                       AGENT LOOP                               │
│                                                                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ITERATION 1                                             │   │
│  │                                                         │   │
│  │  User msg + workspace context                           │   │
│  │       │                                                 │   │
│  │       v                                                 │   │
│  │  ┌──────────┐    system prompt    ┌──────────────┐      │   │
│  │  │History   │───────────────────> │ Gemini API   │      │   │
│  │  │ [user]    │    tool decls      │ (chat call)  │      │   │
│  │  └──────────┘                     └──────┬───────┘      │   │
│  │                                          │              │   │
│  │                              ┌───────────┴──────────┐   │   │
│  │                              │                      │   │   │
│  │                         functionCall?            text?   │   │
│  │                              │                      │   │   │
│  │                              v                      v   │   │
│  │                      ┌──────────────┐        ┌────────┐ │   │
│  │                      │ Execute tool │        │ DONE!  │ │   │
│  │                      │ (e.g.        │        │ Return │ │   │
│  │                      │ get_tree_    │        │ text   │ │   │
│  │                      │ manifest)    │        └────────┘ │   │
│  │                      └──────┬───────┘                   │   │
│  │                             │                           │   │
│  │                             v                           │   │
│  │                      Tool result added                  │   │
│  │                      to history                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                 │
│                              v                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ITERATION 2                                             │   │
│  │                                                         │   │
│  │  History now has: [user, model/fnCall, fnResult]        │   │
│  │       │                                                 │   │
│  │       v                                                 │   │
│  │  Gemini sees the tool result, decides next action...    │   │
│  │  Maybe calls get_blob, read_file, edit_file, etc.       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                 │
│                              v                                 │
│                   ... repeats up to 15x ...                    │
│                              │                                 │
│                              v                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ FINAL ITERATION                                         │   │
│  │                                                         │   │
│  │  Gemini returns TEXT (no function call) ─── DONE        │   │
│  │  "I've completed the task. Here's what I did: ..."      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                 │
└──────────────────────────────┼─────────────────────────────────┘
                               │
                               v
                      ┌──────────────────┐
                      │  Webview renders  │
                      │  final response   │
                      └──────────────────┘
```

---

## 3. Message Flow Between Components

```
┌─────────────┐          ┌──────────────────┐          ┌───────────────┐
│   Webview    │          │ ChatViewProvider  │          │   AgentLoop   │
│   (HTML/JS)  │          │   (TypeScript)    │          │  (TypeScript) │
└──────┬───────┘          └────────┬─────────┘          └───────┬───────┘
       │                           │                            │
       │  {type:'sendMessage',     │                            │
       │   text:'fix the bug'}     │                            │
       │ ─────────────────────────>│                            │
       │                           │                            │
       │                           │   agentLoop.run(text)      │
       │                           │ ──────────────────────────>│
       │                           │                            │
       │                           │                            │──── calls
       │                           │                            │     Gemini
       │                           │                            │     API
       │                           │                            │<─── returns
       │                           │                            │     functionCall
       │                           │                            │
       │                           │  onMessage({type:'tool_call',
       │                           │   toolName:'get_tree_manifest'})
       │  {type:'agentMessage',    │<───────────────────────────│
       │   message:{...}}          │                            │
       │ <─────────────────────────│                            │
       │                           │                            │
       │    renders tool card      │                            │──── executes
       │    with 🌳 icon           │                            │     tool
       │                           │                            │<─── result
       │                           │                            │
       │                           │  onMessage({type:'tool_result',
       │                           │   content: '...'})         │
       │  {type:'agentMessage',    │<───────────────────────────│
       │   message:{...}}          │                            │
       │ <─────────────────────────│                            │
       │                           │                            │
       │    appends result to      │                            │──── sends result
       │    tool card              │                            │     back to Gemini
       │                           │                            │     for next step
       │                           │                            │
       │         ... (more tool call/result cycles) ...         │
       │                           │                            │
       │                           │  onMessage({type:'assistant',
       │                           │   content:'Done! I fixed..'})
       │  {type:'agentMessage',    │<───────────────────────────│
       │   message:{...}}          │                            │
       │ <─────────────────────────│                            │
       │                           │                            │
       │                           │  onDone()                  │
       │  {type:'done'}            │<───────────────────────────│
       │ <─────────────────────────│                            │
       │                           │                            │
       │  stop spinner,            │                            │
       │  re-enable input          │                            │
       v                           v                            v
```

---

## 4. Git-Style Workspace Tree — Token Savings

This is the key architectural innovation. Instead of pasting full file contents into every prompt:

```
TRADITIONAL APPROACH (wasteful):
─────────────────────────────────
  Turn 1: "Here are all 50 files... (15,000 tokens)"
  Turn 2: "Here are all 50 files again... (15,000 tokens)"   ← wasteful!
  Turn 3: "Here are all 50 files again... (15,000 tokens)"   ← wasteful!
  Total:  45,000 tokens


TECH BOSS APPROACH (efficient):
────────────────────────────────
  Turn 1: "Here's a manifest of 50 files with 8-char hashes (500 tokens)"
           Agent calls get_blob for 3 files it needs (600 tokens)
  Turn 2: "Same manifest — hashes unchanged, skip re-reading"
           Agent calls get_blob for 1 new file (200 tokens)
  Turn 3: Agent already has the files it needs in history (0 tokens)
  Total:  1,300 tokens  ← 97% savings!
```

### How the Tree Works Internally

```
  WORKSPACE (filesystem)                    BLOB STORE (in-memory)
  ──────────────────────                    ──────────────────────
  
  project/                                  ┌─────────────────────────────┐
  ├── src/                                  │ Hash: a3f8c2d1...           │
  │   ├── index.ts ─────────────────────────│ Content: "import * as..." │
  │   │                                     │ Size: 1234                  │
  │   ├── utils.ts ─────────────────────────│                             │
  │   │                          │          │ Hash: b7e9f3a0...           │
  │   └── app.ts ────────────────│──────────│ Content: "export class..."│
  │                              │          │ Size: 567                   │
  ├── package.json ──────────────│──────────│                             │
  │                              │          │ Hash: c1d2e3f4...           │
  └── tsconfig.json ─────────────│─────────│ Content: "{\"name\":..."  │
                                 │          │ Size: 890                   │
                                 │          └─────────────────────────────┘
                                 │
                                 v
                          TREE STORE (in-memory)
                          ──────────────────────
                          
                          Root Tree (hash: x9y8z7...)
                          ├── src/ ──> Tree (hash: m4n5o6...)
                          │   ├── index.ts ──> blob a3f8c2d1
                          │   ├── utils.ts  ──> blob b7e9f3a0
                          │   └── app.ts    ──> blob c1d2e3f4
                          ├── package.json  ──> blob d5e6f7a8
                          └── tsconfig.json ──> blob e9f0a1b2
```

### Manifest sent to Gemini (compact)

```json
{
  "src": {
    "index.ts":  "a3f8c2d1",       ← 8-char short hash, NOT file content
    "utils.ts":  "b7e9f3a0",
    "app.ts":    "c1d2e3f4"
  },
  "package.json":  "d5e6f7a8",
  "tsconfig.json": "e9f0a1b2"
}
```

### Snapshot Diffing

```
  SNAPSHOT 1 (before edit)              SNAPSHOT 2 (after edit)
  ────────────────────────              ────────────────────────
  
  src/index.ts  ──> a3f8c2d1            src/index.ts  ──> a3f8c2d1  (same ✓)
  src/utils.ts  ──> b7e9f3a0            src/utils.ts  ──> ff00aa11  (CHANGED ✗)
  src/app.ts    ──> c1d2e3f4            src/app.ts    ──> c1d2e3f4  (same ✓)
  package.json  ──> d5e6f7a8            package.json  ──> d5e6f7a8  (same ✓)
                                         
                     │                                │
                     └────── diffTrees() ─────────────┘
                                   │
                                   v
                          changedPaths: ["src/utils.ts"]
                                   │
                                   v
                     Only src/utils.ts content is sent
                     to Gemini in the next prompt
```

---

## 5. Tool Execution with Snapshots

```
  Agent decides: "I need to edit src/utils.ts"
       │
       v
  ┌──────────────────────────────────────────────────────────┐
  │ SnapshotManager.before('edit_file', {path, old, new})    │
  │                                                          │
  │    WorkspaceTree.takeSnapshot('before:edit_file:...')     │
  │    ── scans all files ──> stores as Snapshot #N           │
  └──────────────────────────┬───────────────────────────────┘
                             │
                             v
  ┌──────────────────────────────────────────────────────────┐
  │ edit_file.execute()                                       │
  │                                                          │
  │    1. Read file from disk                                │
  │    2. Find old_str in content                            │
  │    3. Replace with new_str                               │
  │    4. Write back to disk                                 │
  └──────────────────────────┬───────────────────────────────┘
                             │
                             v
  ┌──────────────────────────────────────────────────────────┐
  │ SnapshotManager.after('edit_file')                        │
  │                                                          │
  │    WorkspaceTree.takeSnapshot('after:edit_file')           │
  │    ── scans all files ──> stores as Snapshot #N+1         │
  │    ── diffs vs Snapshot #N ──> changedPaths: [utils.ts]   │
  └──────────────────────────────────────────────────────────┘
```

---

## 6. File Dependency Graph

```
  types/index.ts
       │
       │  exports: AgentMessage, ChatMessage, BlobHash, etc.
       │
       ├──────────────────────────────────────────────────┐
       │                                                  │
       v                                                  v
  services/workspaceTree.ts                       services/agentLoop.ts
       │                                                  │
       │  exports: WorkspaceTree, Snapshot                │  imports: GeminiClient,
       │                                                  │  ContextPacker, ToolDef
       ├─────────────┐                                    │
       │             │                                    │
       v             v                                    │
  services/      services/                                │
  snapshotMgr    contextPacker                            │
       │             │                                    │
       │             │                                    │
       └──────┬──────┘                                    │
              │                                           │
              v                                           │
       services/tools.ts                                  │
              │                                           │
              │  exports: ToolDefinition, ToolContext,     │
              │  buildToolMap, getToolDeclarations         │
              │                                           │
              └───────────────────────────────────────────┘
                                                          │
                                                          v
                                               services/geminiClient.ts
                                                          │
                                                          │  exports: GeminiClient
                                                          │  (getCompletion + chat)
                                                          │
                              ┌────────────────────────────┤
                              │                            │
                              v                            v
                    providers/                    providers/
                    completionProvider.ts          chatViewProvider.ts
                    (UNTOUCHED)                           │
                              │                            │
                              └────────────┬───────────────┘
                                           │
                                           v
                                     extension.ts
                                     (entry point)
```

---

## 7. Webview UI Anatomy

```
  ┌──────────────────────────────────────────┐
  │  ⚡ Tech Boss            [■ Stop] [+ New]│  ← Toolbar
  ├──────────────────────────────────────────┤
  │                                          │
  │                    ┌─────────────────┐   │
  │                    │ fix the bug in  │   │  ← User bubble (right)
  │                    │ utils.ts        │   │
  │                    └─────────────────┘   │
  │                                          │
  │  ┌───────────────────────────────────┐   │
  │  │ 🌳 get_tree_manifest         ▶  │   │  ← Tool card (collapsed)
  │  └───────────────────────────────────┘   │
  │                                          │
  │  ┌───────────────────────────────────┐   │
  │  │ 🗃️ get_blob                   ▼  │   │  ← Tool card (expanded)
  │  │  ┌─────────────────────────────┐  │   │
  │  │  │ PARAMETERS                  │  │   │
  │  │  │ { "hash": "b7e9f3a0" }     │  │   │
  │  │  ├─────────────────────────────┤  │   │
  │  │  │ RESULT                      │  │   │
  │  │  │ import { foo } from './bar' │  │   │
  │  │  │ export function utils() {   │  │   │
  │  │  │   ...                       │  │   │
  │  │  └─────────────────────────────┘  │   │
  │  └───────────────────────────────────┘   │
  │                                          │
  │  ┌───────────────────────────────────┐   │
  │  │ 🔧 edit_file                  ▶  │   │  ← Another tool card
  │  └───────────────────────────────────┘   │
  │                                          │
  │  ┌───────────────────────────────────┐   │
  │  │ I fixed the bug in utils.ts.     │   │  ← Assistant bubble (left)
  │  │ The issue was a missing null     │   │
  │  │ check on line 42. I added...     │   │
  │  └───────────────────────────────────┘   │
  │                                          │  ← Messages area (scrollable)
  ├──────────────────────────────────────────┤
  │  ⟳ Agent is thinking...                 │  ← Status (visible while running)
  ├──────────────────────────────────────────┤
  │  ┌──────────────────────────┐ ┌──────┐  │
  │  │ Ask Tech Boss anything...│ │ Send │  │  ← Input area
  │  └──────────────────────────┘ └──────┘  │
  └──────────────────────────────────────────┘
```
