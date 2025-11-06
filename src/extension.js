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
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const dotenv = __importStar(require("dotenv"));
dotenv.config();
const vscode = __importStar(require("vscode"));
const completionProvider_1 = require("./providers/completionProvider");
let completionProvider;
let statusBarItem;
function activate(context) {
    console.log('Gemini Copilot is now active');
    // Create status bar item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = "$(sparkle) Gemini";
    statusBarItem.tooltip = "Gemini Copilot is active";
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);
    // Register inline completion provider
    const provider = new completionProvider_1.GeminiCompletionProvider();
    completionProvider = vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, provider);
    context.subscriptions.push(completionProvider);
    // Register manual trigger command
    const triggerCommand = vscode.commands.registerCommand('tech-boss.triggerCompletion', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        // Trigger InlineCompletionProvider manually
        await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
    });
    context.subscriptions.push(triggerCommand);
    // Register configure command
    const configureCommand = vscode.commands.registerCommand('tech-boss.configure', async () => {
        const apiKey = await vscode.window.showInputBox({
            prompt: 'Enter your Google Gemini API Key',
            password: true,
            placeHolder: 'Get your key from https://makersuite.google.com/app/apikey',
            ignoreFocusOut: true
        });
        if (apiKey) {
            await vscode.workspace.getConfiguration('geminiCopilot')
                .update('apiKey', apiKey, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage('Gemini API key configured successfully!');
            statusBarItem.text = "$(sparkle) Gemini (Ready)";
        }
    });
    context.subscriptions.push(configureCommand);
    // Check if API key is configured
    checkApiKeyConfiguration();
    // Listen for configuration changes
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('geminiCopilot')) {
            checkApiKeyConfiguration();
        }
    }));
}
function checkApiKeyConfiguration() {
    const config = vscode.workspace.getConfiguration('geminiCopilot');
    const apiKey = config.get('apiKey');
    const enabled = config.get('enabled');
    if (!apiKey || apiKey.trim() === '') {
        statusBarItem.text = "$(warning) Gemini (No API Key)";
        statusBarItem.tooltip = "Click to configure Gemini API key";
        statusBarItem.command = 'tech-boss.configure';
        vscode.window.showWarningMessage('Gemini Copilot: API key not configured', 'Configure').then(selection => {
            if (selection === 'Configure') {
                vscode.commands.executeCommand('tech-boss.configure');
            }
        });
    }
    else if (!enabled) {
        statusBarItem.text = "$(circle-slash) Gemini (Disabled)";
        statusBarItem.tooltip = "Gemini Copilot is disabled";
    }
    else {
        statusBarItem.text = "$(sparkle) Gemini";
        statusBarItem.tooltip = "Gemini Copilot is active";
        statusBarItem.command = undefined;
    }
}
function deactivate() {
    if (completionProvider) {
        completionProvider.dispose();
    }
    if (statusBarItem) {
        statusBarItem.dispose();
    }
    console.log('Gemini Copilot is now deactivated');
}
//# sourceMappingURL=extension.js.map