```markdown
# Tech Boss - AI-Powered Code Assistant

Tech Boss is a Visual Studio Code extension that leverages Google's Gemini AI to help you modify and generate code intelligently. Simply describe what you want, and let AI do the heavy lifting!

## Features

- 🤖 **AI-Powered Code Generation** - Use natural language to describe code changes
- 📁 **Context-Aware** - Add files to context for better AI understanding
- 👀 **Diff Preview** - Review changes before applying them
- ✅ **Accept/Reject Changes** - Full control over what gets applied to your files
- 🎨 **Clean Interface** - Intuitive sidebar panel for easy interaction

## Prerequisites

- Visual Studio Code 1.85.0 or higher
- Node.js 18.x or higher
- Google Gemini API key ([Get one here](https://makersuite.google.com/app/apikey))

## Installation

### From Source

1. Clone the repository:
```
git clone <your-repo-url>
cd tech-boss
```

2. Install dependencies:
```
npm install
```

3. Compile the extension:
```
npm run compile
```

4. Press `F5` to open a new VS Code window with the extension loaded

## Configuration

1. Open VS Code Settings (`Ctrl+,` or `Cmd+,`)
2. Search for "Tech Boss"
3. Configure the following settings:

```
{
  "techBoss.apiKey": "your-gemini-api-key-here",
  "techBoss.model": "gemini-2.0-flash-exp",
  "techBoss.maxTokens": 2048,
  "techBoss.temperature": 0.7
}
```

### Getting Your API Key

1. Visit [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Sign in with your Google account
3. Click "Create API Key"
4. Copy the key and paste it into VS Code settings

## Usage

### Basic Workflow

1. **Open Tech Boss Panel**
   - Click the Tech Boss icon in the Activity Bar (left sidebar)
   - Or use Command Palette: `Tech Boss: Open Chat`

2. **Add Files to Context**
   - Click "Add Files to Context" button
   - Select the files you want to modify
   - Files appear in the "Context Files" section

3. **Generate Code**
   - Type your request in the prompt box (e.g., "Add error handling to this function")
   - Click "Generate Code"
   - Wait for AI to analyze and generate changes

4. **Review Changes**
   - Proposed changes appear in "Pending Changes" section
   - Click "View Diff" to see exactly what will change
   - Review the side-by-side comparison

5. **Apply or Reject**
   - Click "Accept" to apply changes to your file
   - Click "Reject" to discard the changes

### Example Prompts

```
"Add TypeScript type annotations to all functions"
"Refactor this code to use async/await instead of callbacks"
"Add error handling with try-catch blocks"
"Convert this JavaScript to Python"
"Add JSDoc comments to all public methods"
"Optimize this function for better performance"
```

## Features in Detail

### Context Management
- Add multiple files for better AI understanding
- Remove files from context with one click
- Context persists during your session

### Smart Code Parsing
- Automatically detects code blocks in AI responses
- Handles multiple programming languages
- Preserves formatting and indentation

### Diff Viewer
- Side-by-side comparison of changes
- Syntax highlighting
- Clear visualization of additions and deletions

## Development

### Project Structure

```
tech-boss/
├── src/
│   ├── extension.ts          # Extension entry point
│   ├── services/
│   │   └── geminiClient.ts   # Gemini API integration
│   └── providers/
│       └── chatViewProvider.ts # Main UI and logic
├── out/                      # Compiled JavaScript
├── package.json              # Extension manifest
└── tsconfig.json             # TypeScript config
```

### Build Commands

```
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
4. Check Output → Tech Boss for extension logs

## Troubleshooting

### "No code changes were generated"

**Cause:** Gemini's response couldn't be parsed
**Solution:** 
- Check Debug Console for raw response
- Try rephrasing your prompt
- Ensure files are added to context

### "Error: Invalid API Key"

**Cause:** API key not configured or incorrect
**Solution:**
- Verify API key in settings
- Get a new key from Google AI Studio
- Restart VS Code after updating settings

### Empty/Incomplete Responses

**Cause:** Token limit too low
**Solution:**
- Increase `techBoss.maxTokens` in settings (try 2048 or 4096)
- Break large changes into smaller requests

## Configuration Options

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `techBoss.apiKey` | string | "" | Your Google Gemini API key |
| `techBoss.model` | string | "gemini-2.0-flash-exp" | Gemini model to use |
| `techBoss.maxTokens` | number | 2048 | Maximum tokens in response |
| `techBoss.temperature` | number | 0.7 | Creativity level (0.0-1.0) |

## Known Limitations

- Currently supports single file modifications
- Large files (>10k lines) may hit token limits
- Complex multi-file refactoring requires multiple operations

## Roadmap

- [ ] Multi-file editing support
- [ ] Chat history persistence
- [ ] Custom prompt templates
- [ ] Code snippet library
- [ ] Integration with GitHub Copilot style inline suggestions

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - feel free to use this extension in your projects!

## Support

- 🐛 [Report Issues](https://github.com/your-username/tech-boss/issues)
- 💡 [Feature Requests](https://github.com/your-username/tech-boss/issues/new)
- 📧 Email: your-email@example.com

## Acknowledgments

- Built with [Google Gemini API](https://ai.google.dev/)
- Inspired by GitHub Copilot and Cursor AI
- VS Code Extension API documentation

---

**Made with ❤️ by Rishabh**
```