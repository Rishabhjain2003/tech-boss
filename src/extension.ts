import * as dotenv from 'dotenv';
dotenv.config();

import * as vscode from 'vscode';
import { GeminiCompletionProvider } from './providers/completionProvider';
import { ChatViewProvider } from './providers/chatViewProvider';
import { GeminiClient } from './services/geminiClient';

let completionProvider: vscode.Disposable | undefined;
let statusBarItem: vscode.StatusBarItem;
let chatViewProvider: ChatViewProvider;

export function activate(context: vscode.ExtensionContext) {
    console.log('Tech Boss Agent is now active');

    // Create shared Gemini client
    const geminiClient = new GeminiClient();

    // Status bar item
    statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );
    statusBarItem.text = "$(sparkle) Tech Boss";
    statusBarItem.tooltip = "Tech Boss Agent is active";
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Register inline completion provider (unchanged)
    const provider = new GeminiCompletionProvider();
    completionProvider = vscode.languages.registerInlineCompletionItemProvider(
        { pattern: '**' },
        provider
    );
    context.subscriptions.push(completionProvider);

    // Register chat view provider (now an agent)
    chatViewProvider = new ChatViewProvider(context.extensionUri, geminiClient);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            ChatViewProvider.viewType,
            chatViewProvider
        )
    );

    // ===== Commands =====

    // Trigger inline completion
    const triggerCommand = vscode.commands.registerCommand(
        'techBoss.triggerCompletion',
        async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { return; }
            await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
        }
    );
    context.subscriptions.push(triggerCommand);

    // Configure API key
    const configureCommand = vscode.commands.registerCommand(
        'techBoss.configure',
        async () => {
            const apiKey = await vscode.window.showInputBox({
                prompt: 'Enter your Google Gemini API Key',
                password: true,
                placeHolder: 'Get your key from https://aistudio.google.com/apikey',
                ignoreFocusOut: true
            });

            if (apiKey) {
                await vscode.workspace.getConfiguration('techBoss')
                    .update('apiKey', apiKey, vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage(
                    'Gemini API key configured successfully!'
                );
                statusBarItem.text = "$(sparkle) Tech Boss (Ready)";
            }
        }
    );
    context.subscriptions.push(configureCommand);

    // Open chat panel
    const openChatCommand = vscode.commands.registerCommand(
        'techBoss.openChat',
        () => {
            vscode.commands.executeCommand('workbench.view.extension.tech-boss');
        }
    );
    context.subscriptions.push(openChatCommand);

    // New chat (reset conversation)
    const newChatCommand = vscode.commands.registerCommand(
        'techBoss.newChat',
        () => {
            chatViewProvider.resetChat();
            vscode.window.showInformationMessage('Started a new chat');
        }
    );
    context.subscriptions.push(newChatCommand);

    // Check API key on startup
    checkApiKeyConfiguration();

    // React to config changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('techBoss')) {
                checkApiKeyConfiguration();
            }
        })
    );
}

function checkApiKeyConfiguration() {
    const config = vscode.workspace.getConfiguration('techBoss');
    const apiKey = config.get<string>('apiKey');
    const enabled = config.get<boolean>('enabled');

    if (!apiKey || apiKey.trim() === '') {
        // Also check environment variable
        if (!process.env.GEMINI_API_KEY) {
            statusBarItem.text = "$(warning) Tech Boss (No API Key)";
            statusBarItem.tooltip = "Click to configure Gemini API key";
            statusBarItem.command = 'techBoss.configure';
        } else {
            statusBarItem.text = "$(sparkle) Tech Boss";
            statusBarItem.tooltip = "Tech Boss Agent is active (using env key)";
            statusBarItem.command = undefined;
        }
    } else if (!enabled) {
        statusBarItem.text = "$(circle-slash) Tech Boss (Disabled)";
        statusBarItem.tooltip = "Tech Boss is disabled";
    } else {
        statusBarItem.text = "$(sparkle) Tech Boss";
        statusBarItem.tooltip = "Tech Boss Agent is active";
        statusBarItem.command = undefined;
    }
}

export function deactivate() {
    if (completionProvider) {
        completionProvider.dispose();
    }
    if (statusBarItem) {
        statusBarItem.dispose();
    }
    console.log('Tech Boss Agent is now deactivated');
}
