import * as dotenv from 'dotenv';
dotenv.config();

import * as vscode from 'vscode';
import { GeminiCompletionProvider } from './providers/completionProvider';

let completionProvider: vscode.Disposable | undefined;
let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
    console.log('Gemini Copilot is now active');

    // Create status bar item
    statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );
    statusBarItem.text = "$(sparkle) Gemini";
    statusBarItem.tooltip = "Gemini Copilot is active";
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Register inline completion provider
    const provider = new GeminiCompletionProvider();
    completionProvider = vscode.languages.registerInlineCompletionItemProvider(
        { pattern: '**' },
        provider
    );
    context.subscriptions.push(completionProvider);

    // Register manual trigger command
    const triggerCommand = vscode.commands.registerCommand(
        'tech-boss.triggerCompletion',
        async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return;
            }
            
            // Trigger InlineCompletionProvider manually
            await vscode.commands.executeCommand(
                'editor.action.inlineSuggest.trigger'
            );
        }
    );
    context.subscriptions.push(triggerCommand);

    // Register configure command
    const configureCommand = vscode.commands.registerCommand(
        'tech-boss.configure',
        async () => {
            const apiKey = await vscode.window.showInputBox({
                prompt: 'Enter your Google Gemini API Key',
                password: true,
                placeHolder: 'Get your key from https://makersuite.google.com/app/apikey',
                ignoreFocusOut: true
            });

            if (apiKey) {
                await vscode.workspace.getConfiguration('geminiCopilot')
                    .update('apiKey', apiKey, vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage(
                    'Gemini API key configured successfully!'
                );
                statusBarItem.text = "$(sparkle) Gemini (Ready)";
            }
        }
    );
    context.subscriptions.push(configureCommand);

    // Check if API key is configured
    checkApiKeyConfiguration();

    // Listen for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('geminiCopilot')) {
                checkApiKeyConfiguration();
            }
        })
    );
}

function checkApiKeyConfiguration() {
    const config = vscode.workspace.getConfiguration('geminiCopilot');
    const apiKey = config.get<string>('apiKey');
    const enabled = config.get<boolean>('enabled');

    if (!apiKey || apiKey.trim() === '') {
        statusBarItem.text = "$(warning) Gemini (No API Key)";
        statusBarItem.tooltip = "Click to configure Gemini API key";
        statusBarItem.command = 'tech-boss.configure';
        
        vscode.window.showWarningMessage(
            'Gemini Copilot: API key not configured',
            'Configure'
        ).then(selection => {
            if (selection === 'Configure') {
                vscode.commands.executeCommand('tech-boss.configure');
            }
        });
    } else if (!enabled) {
        statusBarItem.text = "$(circle-slash) Gemini (Disabled)";
        statusBarItem.tooltip = "Gemini Copilot is disabled";
    } else {
        statusBarItem.text = "$(sparkle) Gemini";
        statusBarItem.tooltip = "Gemini Copilot is active";
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
    console.log('Gemini Copilot is now deactivated');
}