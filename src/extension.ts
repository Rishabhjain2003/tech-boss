import * as dotenv from 'dotenv';
dotenv.config();

import * as vscode from 'vscode';
import * as path from 'path';
import { GeminiCompletionProvider } from './providers/completionProvider';
import { ChatViewProvider } from './providers/chatViewProvider';
import { GeminiClient } from './services/geminiClient';

let completionProvider: vscode.Disposable | undefined;
let statusBarItem: vscode.StatusBarItem;
let chatViewProvider: ChatViewProvider;

export function activate(context: vscode.ExtensionContext) {
    console.log('Tech Boss is now active');

    // Create Gemini client (shared between completion and chat)
    const geminiClient = new GeminiClient();

    // Create status bar item
    statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );
    statusBarItem.text = "$(sparkle) Tech Boss";
    statusBarItem.tooltip = "Tech Boss is active";
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Register inline completion provider
    const provider = new GeminiCompletionProvider();
    completionProvider = vscode.languages.registerInlineCompletionItemProvider(
        { pattern: '**' },
        provider
    );
    context.subscriptions.push(completionProvider);

    // Register chat view provider
    chatViewProvider = new ChatViewProvider(context.extensionUri, geminiClient);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            ChatViewProvider.viewType,
            chatViewProvider
        )
    );

    // Register commands
    const triggerCommand = vscode.commands.registerCommand(
        'techBoss.triggerCompletion',
        async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return;
            }
            await vscode.commands.executeCommand(
                'editor.action.inlineSuggest.trigger'
            );
        }
    );
    context.subscriptions.push(triggerCommand);

    const configureCommand = vscode.commands.registerCommand(
        'techBoss.configure',
        async () => {
            const apiKey = await vscode.window.showInputBox({
                prompt: 'Enter your Google Gemini API Key',
                password: true,
                placeHolder: 'Get your key from https://makersuite.google.com/app/apikey',
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

    const openChatCommand = vscode.commands.registerCommand(
        'techBoss.openChat',
        () => {
            vscode.commands.executeCommand('workbench.view.extension.tech-boss');
        }
    );
    context.subscriptions.push(openChatCommand);

    const clearContextCommand = vscode.commands.registerCommand(
        'techBoss.clearContext',
        () => {
            chatViewProvider.clearContext();
            vscode.window.showInformationMessage('Context cleared');
        }
    );
    context.subscriptions.push(clearContextCommand);

    // Check if API key is configured
    checkApiKeyConfiguration();

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('techBoss')) {
                checkApiKeyConfiguration();
            }
        })
    );

    const addSelectionCommand = vscode.commands.registerCommand('techBoss.addSelection', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor');
            return;
        }

        const selection = editor.selection;
        if (selection.isEmpty) {
            vscode.window.showErrorMessage('No text selected');
            return;
        }

        const selectedText = editor.document.getText(selection);
        const fileName = path.basename(editor.document.fileName);
        
        // Send to chat view
        chatViewProvider.addSelectionToContext({
            path: editor.document.fileName,
            content: selectedText,
            fileName: fileName,
            isSelection: true,
            selectionRange: {
                start: editor.document.offsetAt(selection.start),
                end: editor.document.offsetAt(selection.end)
            }
        });

        vscode.window.showInformationMessage(`Added ${selectedText.split('\n').length} lines to context`);
    });

    context.subscriptions.push(addSelectionCommand);
}

function checkApiKeyConfiguration() {
    const config = vscode.workspace.getConfiguration('techBoss');
    const apiKey = config.get<string>('apiKey');
    const enabled = config.get<boolean>('enabled');

    if (!apiKey || apiKey.trim() === '') {
        statusBarItem.text = "$(warning) Tech Boss (No API Key)";
        statusBarItem.tooltip = "Click to configure Gemini API key";
        statusBarItem.command = 'techBoss.configure';
    } else if (!enabled) {
        statusBarItem.text = "$(circle-slash) Tech Boss (Disabled)";
        statusBarItem.tooltip = "Tech Boss is disabled";
    } else {
        statusBarItem.text = "$(sparkle) Tech Boss";
        statusBarItem.tooltip = "Tech Boss is active";
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
    console.log('Tech Boss is now deactivated');
}
