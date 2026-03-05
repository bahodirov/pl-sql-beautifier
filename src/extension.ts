import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { format, parseBrFile, DEFAULT_CONFIG, BeautifierConfig } from './formatter';

const SUPPORTED_LANGS = ['sql', 'plsql', 'oraclesql', 'oracle-sql'];

class PlsqlFormattingProvider
  implements vscode.DocumentFormattingEditProvider,
             vscode.DocumentRangeFormattingEditProvider
{
  provideDocumentFormattingEdits(
    document: vscode.TextDocument,
    _options: vscode.FormattingOptions
  ): vscode.TextEdit[] {
    return this.doFormat(document, null);
  }

  provideDocumentRangeFormattingEdits(
    document: vscode.TextDocument,
    range: vscode.Range,
    _options: vscode.FormattingOptions
  ): vscode.TextEdit[] {
    return this.doFormat(document, range);
  }

  private doFormat(document: vscode.TextDocument, range: vscode.Range | null): vscode.TextEdit[] {
    try {
      const cfg = loadConfig(document);
      const text = range ? document.getText(range) : document.getText();
      const formatted = format(text, cfg);
      const editRange = range ?? new vscode.Range(
        document.positionAt(0),
        document.positionAt(document.getText().length)
      );
      return [vscode.TextEdit.replace(editRange, formatted)];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`PL/SQL Beautifier error: ${msg}`);
      return [];
    }
  }
}

function loadConfig(document: vscode.TextDocument): BeautifierConfig {
  const settings = vscode.workspace.getConfiguration('plsqlBeautifier');
  const explicitPath = settings.get<string>('configFile', '');

  if (explicitPath && fs.existsSync(explicitPath)) {
    try {
      return parseBrFile(explicitPath);
    } catch {
      vscode.window.showWarningMessage(`PL/SQL Beautifier: could not parse config file "${explicitPath}", using defaults.`);
    }
  }

  if (settings.get<boolean>('searchWorkspaceForBrFile', true)) {
    const ws = vscode.workspace.getWorkspaceFolder(document.uri);
    if (ws) {
      const found = findBrFile(ws.uri.fsPath);
      if (found) {
        try {
          return parseBrFile(found);
        } catch {
          // fall through to defaults
        }
      }
    }
  }

  return DEFAULT_CONFIG;
}

function findBrFile(dir: string): string | null {
  try {
    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      if (entry.toLowerCase().endsWith('.br')) {
        return path.join(dir, entry);
      }
    }
  } catch {
    // ignore
  }
  return null;
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new PlsqlFormattingProvider();

  for (const lang of SUPPORTED_LANGS) {
    context.subscriptions.push(
      vscode.languages.registerDocumentFormattingEditProvider({ language: lang }, provider)
    );
    context.subscriptions.push(
      vscode.languages.registerDocumentRangeFormattingEditProvider({ language: lang }, provider)
    );
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('plsqlBeautifier.formatDocument', () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        vscode.commands.executeCommand('editor.action.formatDocument');
      }
    })
  );
}

export function deactivate(): void {}
