import * as vscode from 'vscode';
import { format, DEFAULT_CONFIG } from './formatter';

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
      const cfg = DEFAULT_CONFIG;
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
