import * as vscode from 'vscode';
import { SecretStorageService } from '../services/secretStorageService';

export async function promptAndStoreLlmApiKey(secrets: SecretStorageService): Promise<void> {
  const value = await vscode.window.showInputBox({
    prompt: 'Enter your LLM API key',
    password: true,
    ignoreFocusOut: true
  });

  if (!value) {
    return;
  }

  await secrets.setLlmApiKey(value);
  vscode.window.showInformationMessage('LLM API key saved securely.');
}

export async function promptAndStoreMcpToken(secrets: SecretStorageService): Promise<void> {
  const value = await vscode.window.showInputBox({
    prompt: 'Enter your MCP bearer token (optional)',
    password: true,
    ignoreFocusOut: true
  });

  if (!value) {
    return;
  }

  await secrets.setMcpBearerToken(value);
  vscode.window.showInformationMessage('MCP bearer token saved securely.');
}
