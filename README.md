# Tech Boss — AI Coding Agent for VS Code

Tech Boss is a VS Code extension that operates as a **fully autonomous AI coding agent** powered by Google Gemini. It can read, write, and edit files, run terminal commands, search your workspace, and debug errors — all through a natural language chat interface.

## Features

- **Autonomous Agent** — Reasons, plans, and executes multi-step tasks without manual intervention
- **Git-Style Workspace Tree** — Content-addressed file indexing for 80-95% token savings
- **10 Built-in Tools** — File I/O, terminal, search, diagnostics, and more
- **Conversational Chat UI** — Tool call cards, markdown rendering, cancel/reset controls
- **Inline Completions** — Fast Gemini-powered code suggestions as you type

## Architecture

```
+-------------------------------------------------------------------+
|                      VS Code Extension Host                        |
|                                                                    |
|  extension.ts                                                      |
|       |                                                            |
|       +---> CompletionProvider ------> GeminiClient.getCompletion  |
|       |     (inline suggestions)            |                      |
|       |                                     | @google/generative-  |
|       +---> ChatViewProvider                |  ai SDK              |
|                  |                          |                      |
|                  +--- AgentLoop ------------+                      |
|                  |       |                                         |
|                  |       +--- Tool System (10 tools)               |
|                  |       |       +-- read_file / write_file        |
|                  |       |       +-- edit_file / list_directory    |
|                  |       |       +-- run_terminal                  |
|                  |       |       +-- search_workspace              |
|                  |       |       +-- get_diagnostics               |
|                  |       |       +-- open_file                     |
|                  |       |       +-- get_blob (token-saving)       |
|                  |       |       +-- get_tree_manifest             |
|                  |       |                                         |
|                  |       +--- SnapshotManager                      |
|                  |               +-- WorkspaceTree                 |
|                  |                                                 |
|                  +--- ContextPacker                                |
|                          +-- WorkspaceTree                         |
+-------------------------------------------------------------------+
```

### How the Agent Loop Works

```
User sends message
     |
     v
ContextPacker builds initial context
     |
     v
+----------------------------------------------------+
|                   AGENT LOOP                        |
|                                                     |
|  History -------> Gemini API -------> Response      |
|                                          |          |
|                                +---------+------+   |
|                                |                |   |
|                           functionCall?       text?  |
|                                |                |   |
|                                v                v   |
|                          Execute tool        DONE   |
|                          Add result to       Send   |
|                          history             text   |
|                                |                    |
|                                +--- loop back ------+
|                                                     |
|              (repeats up to 15 iterations)          |
+-----------------------------------------------------+
```

### Token Savings via Workspace Tree

```
TRADITIONAL:                        TECH BOSS:
--------------                      ----------

Turn 1: all 50 files (15k tok)      Turn 1: manifest (500 tok)
Turn 2: all 50 files (15k tok)              + 3 blobs (600 tok)
Turn 3: all 50 files (15k tok)      Turn 2: 1 new blob (200 tok)
------------------------------      Turn 3: 0 tokens (cached)
Total: 45,000 tokens                ----------------------------
                                    Total: 1,300 tokens (97% less)
```

Instead of pasting all file contents every turn, we send a **manifest** of file paths mapped to 8-char SHA-256 hashes. The agent fetches only the files it needs via `get_blob(hash)`, and skips unchanged files (same hash = same content).

## Prerequisites

- Visual Studio Code 1.85.0 or higher
- Node.js 18.x or higher
- Google Gemini API key ([Get one here](https://makersuite.google.com/app/apikey))

## Installation

### From Source

1. Clone the repository:
```bash
git clone https://github.com/Rishabhjain2003/tech-boss.git
cd tech-boss
```

2. Install dependencies:
```bash
npm install
```

3. Compile the extension:
```bash
npm run compile
```

4. Press `F5` to open a new VS Code window with the extension loaded

## Configuration

1. Open VS Code Settings (`Ctrl+,` or `Cmd+,`)
2. Search for "Tech Boss"
3. Configure:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `techBoss.apiKey` | string | `""` | Google Gemini API key |
| `techBoss.model` | string | `"gemini-2.5-flash"` | Gemini model to use |
| `techBoss.maxTokens` | number | `2048` | Max tokens for inline completions |
| `techBoss.temperature` | number | `0.2` | Creativity level (0.0-1.0) |
| `techBoss.enabled` | boolean | `true` | Enable/disable the extension |

Or run **Tech Boss: Configure API Key** from the Command Palette.

### Getting Your API Key

1. Visit [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Sign in with your Google account
3. Click "Create API Key"
4. Copy the key and paste it into VS Code settings

## Usage

### Open the Agent Chat

- Click the **Tech Boss** icon in the Activity Bar (left sidebar)
- Or use Command Palette: `Tech Boss: Open Chat Panel`

### Example Prompts

```
"What files are in this project?"
"Read package.json and explain the dependencies"
"Add error handling to the login function in auth.ts"
"Run npm run build and fix any errors"
"Search the codebase for TODO comments"
"Refactor utils.ts to use async/await"
```

### How a Typical Session Looks

```
You:  "Add input validation to the signup form"

  [tool] get_tree_manifest                                  [expand]
  [tool] get_blob (hash: a3f8c2d1)                         [expand]
  [tool] get_blob (hash: b7e9f3a0)                         [expand]
  [tool] edit_file (path: src/components/SignupForm.tsx)    [expand]
  [tool] get_diagnostics                                    [expand]
  Assistant: I've added input validation to the signup form.
  Here's what I did:
  - Added email format validation with regex
  - Added password strength check (min 8 chars)
  - Added real-time error messages below each field
  - All changes compile with zero TypeScript errors.
```

### Controls

| Control | Action |
|---------|--------|
| **Send** (or Enter) | Send your message to the agent |
| **Shift+Enter** | Insert a newline in the input |
| **+ New Chat** | Reset conversation and start fresh |
| **Stop** | Cancel the currently running agent |

## Available Tools

The agent has access to 10 tools:

| Tool | Description |
|------|-------------|
| `read_file` | Read file contents, optionally a line range |
| `write_file` | Create or overwrite a file |
| `edit_file` | Surgical find-and-replace in a file |
| `list_directory` | List directory contents (optionally recursive) |
| `run_terminal` | Run a shell command (30s timeout) |
| `search_workspace` | Regex search across all workspace files |
| `get_diagnostics` | Get VS Code errors and warnings |
| `open_file` | Open a file in the editor |
| `get_blob` | Fetch file content by short hash (token-efficient) |
| `get_tree_manifest` | Get workspace file tree with hashes |

## Project Structure

```
tech-boss/
|-- src/
|   |-- extension.ts               # Extension entry point
|   |-- types/
|   |   +-- index.ts               # Shared type definitions
|   |-- services/
|   |   |-- geminiClient.ts        # Gemini SDK client (completion + chat)
|   |   |-- agentLoop.ts           # Autonomous multi-turn agent loop
|   |   |-- workspaceTree.ts       # Git-style content-addressed file tree
|   |   |-- snapshotManager.ts     # Auto-snapshot before/after mutations
|   |   |-- contextPacker.ts       # System prompt + manifest builder
|   |   |-- tools.ts               # 10-tool system with Gemini declarations
|   |   |-- completionProvider.ts  # Inline completion logic
|   |   |-- contextExtractor.ts    # Code context extraction
|   |   |-- promptBuilder.ts       # Completion prompt templates
|   |   +-- responseParser.ts      # Completion response parsing
|   |-- providers/
|   |   |-- chatViewProvider.ts    # Agent chat webview UI
|   |   +-- completionProvider.ts  # Inline completion provider
|   +-- utils/
|       +-- debounce.ts            # Debounce utility
|-- package.json                    # Extension manifest + dependencies
|-- tsconfig.json                   # TypeScript config
+-- out/                            # Compiled JavaScript output
```

## Development

### Build Commands

```bash
# Compile TypeScript
npm run compile

# Watch mode for development
npm run watch

# Run tests
npm test

# Package extension
vsce package
```

### Debugging

1. Press `F5` to launch Extension Development Host
2. Set breakpoints in TypeScript files
3. Use Debug Console for logging
4. Check Output panel for extension logs

## Commands

| Command | Description |
|---------|-------------|
| `Tech Boss: Open Chat Panel` | Open the agent chat sidebar |
| `Tech Boss: New Chat` | Reset conversation history |
| `Tech Boss: Configure API Key` | Set your Gemini API key |
| `Tech Boss: Trigger Completion` | Trigger inline code completion |

## Troubleshooting

### "Gemini API key not configured"
Verify your API key in settings or run `Tech Boss: Configure API Key` from the Command Palette.

### Agent seems stuck
Click **Stop** to cancel, then try rephrasing your request or click **+ New Chat** to reset.

### Rate limit errors
The free Gemini API tier has rate limits. The extension will auto-retry after a 90-second cooldown. Consider using a paid API key for heavy usage.

### Inline completions not working
Ensure `techBoss.enabled` is `true` in settings and you have a valid API key configured.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - feel free to use this extension in your projects!

## Acknowledgments

- Built with the [Google Gemini API](https://ai.google.dev/) and the official [@google/generative-ai](https://www.npmjs.com/package/@google/generative-ai) SDK
- Workspace tree inspired by Git's content-addressed storage model
- VS Code Extension API

---

**Made with love by Rishabh**
