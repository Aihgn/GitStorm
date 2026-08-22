import * as vscode from 'vscode';
import { BlameInfo, Git } from './git';
import { annotationText } from './format';

/**
 * Whole-file blame shown in a column before each line, Storm's "Annotate".
 * Toggled per file; the commit id in each row links back to the graph.
 */
export class BlameAnnotations implements vscode.Disposable {
    private decoration = vscode.window.createTextEditorDecorationType({
        before: {
            color: new vscode.ThemeColor('editorCodeLens.foreground'),
            margin: '0 1.2em 0 0',
            // The only way to reach the rendered span's CSS from the API.
            textDecoration: 'none; font-family: var(--vscode-editor-font-family); font-size: 0.85em; opacity: 0.75; white-space: pre'
        }
    });
    /** Documents currently annotated, by URI string. */
    private on = new Set<string>();
    private disposables: vscode.Disposable[] = [];

    constructor() {
        this.disposables.push(
            // Re-blame after a save; between saves VS Code shifts the existing
            // decorations along with the edits, which is close enough.
            vscode.workspace.onDidSaveTextDocument(doc => {
                const editor = vscode.window.visibleTextEditors.find(e => e.document === doc);
                if (editor && this.on.has(doc.uri.toString())) { void this.apply(editor); }
            }),
            vscode.window.onDidChangeVisibleTextEditors(editors => {
                for (const editor of editors) {
                    if (this.on.has(editor.document.uri.toString())) { void this.apply(editor); }
                }
            }),
            vscode.workspace.onDidCloseTextDocument(doc => this.on.delete(doc.uri.toString()))
        );
    }

    async toggle(editor: vscode.TextEditor | undefined): Promise<void> {
        if (!editor || editor.document.uri.scheme !== 'file') {
            vscode.window.showWarningMessage('Git Storm: open a file to annotate it.');
            return;
        }
        const key = editor.document.uri.toString();
        if (this.on.has(key)) {
            this.on.delete(key);
            editor.setDecorations(this.decoration, []);
            return;
        }
        this.on.add(key);
        await this.apply(editor);
    }

    private async apply(editor: vscode.TextEditor): Promise<void> {
        const root = await Git.repoRootFor(editor.document.uri.fsPath);
        if (!root) {
            this.on.delete(editor.document.uri.toString());
            vscode.window.showWarningMessage('Git Storm: this file is not in a git repository.');
            return;
        }
        let blame: BlameInfo[];
        try {
            const git = new Git(root);
            blame = await git.blameFile(
                editor.document.uri.fsPath,
                editor.document.isDirty ? editor.document.getText() : undefined
            );
        } catch (e) {
            this.on.delete(editor.document.uri.toString());
            editor.setDecorations(this.decoration, []);
            vscode.window.showWarningMessage(
                `Git Storm: cannot annotate this file — ${(e as Error).message.split('\n')[0]}`
            );
            return;
        }

        const decorations: vscode.DecorationOptions[] = [];
        for (let line = 0; line < editor.document.lineCount; line++) {
            const info = blame[line];
            if (!info) { continue; }
            decorations.push({
                range: new vscode.Range(line, 0, line, 0),
                renderOptions: { before: { contentText: annotationText(info) } },
                hoverMessage: hover(info)
            });
        }
        editor.setDecorations(this.decoration, decorations);
    }

    dispose(): void {
        this.decoration.dispose();
        this.disposables.forEach(d => d.dispose());
    }
}

function hover(info: BlameInfo): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.isTrusted = true; // needed for the command link below
    if (info.isUncommitted) {
        md.appendMarkdown('**Uncommitted changes**\n\nThis line has not been committed yet.');
        return md;
    }
    const args = encodeURIComponent(JSON.stringify([info.hash]));
    md.appendMarkdown(
        `**${info.summary}**\n\n` +
        `**Author:** ${info.author}\n\n` +
        `**Date:** ${new Date(info.date * 1000).toLocaleString()}\n\n` +
        `**Commit:** \`${info.hash.substring(0, 8)}\`\n\n` +
        `---\n\n` +
        `[$(git-commit) Show in Commit Graph](command:gitstorm.revealCommit?${args})`
    );
    return md;
}
