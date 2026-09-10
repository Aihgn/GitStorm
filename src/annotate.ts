import * as vscode from 'vscode';
import { BlameInfo, Git } from './git';
import { annotationText, blameHeat } from './format';

/**
 * Whole-file blame shown in a column before each line, Storm's "Annotate".
 * Toggled per file; the commit id in each row links back to the graph.
 */
export class BlameAnnotations implements vscode.Disposable {
    private decoration = vscode.window.createTextEditorDecorationType({
        before: {
            color: new vscode.ThemeColor('editorCodeLens.foreground'),
            margin: '0 1.2em 0 0',
            // The only way to reach the rendered span's CSS from the API. No
            // blanket opacity here: heatColors carries its own alpha per line, and
            // the two would multiply into an unreadable column.
            textDecoration: 'none; font-family: var(--vscode-editor-font-family); font-size: 0.85em; white-space: pre'
        }
    });
    /** Documents currently annotated, by URI string. */
    private on = new Set<string>();
    private disposables: vscode.Disposable[] = [];

    private _onDidToggle = new vscode.EventEmitter<vscode.TextDocument>();
    /** Fires for a document whenever its annotations go on or off. */
    readonly onDidToggle = this._onDidToggle.event;

    isAnnotated(document: vscode.TextDocument): boolean {
        return this.on.has(document.uri.toString());
    }

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
            this._onDidToggle.fire(editor.document);
            return;
        }
        this.on.add(key);
        this._onDidToggle.fire(editor.document);
        await this.apply(editor);
    }

    private async apply(editor: vscode.TextEditor): Promise<void> {
        // Giving up has to be announced too, or inline blame stays suppressed
        // for a file that ended up with no annotations.
        const giveUp = (message: string) => {
            this.on.delete(editor.document.uri.toString());
            editor.setDecorations(this.decoration, []);
            this._onDidToggle.fire(editor.document);
            vscode.window.showWarningMessage(message);
        };

        const root = await Git.repoRootFor(editor.document.uri.fsPath);
        if (!root) {
            giveUp('Git Storm: this file is not in a git repository.');
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
            giveUp(`Git Storm: cannot annotate this file — ${(e as Error).message.split('\n')[0]}`);
            return;
        }

        // Uncommitted work is newer than any commit, so it sits outside the age
        // ramp: no band, and the theme's own "modified" colour for its text.
        const uncommitted = new vscode.ThemeColor('gitDecoration.modifiedResourceForeground');
        const band = blameHeat(blame);

        const decorations: vscode.DecorationOptions[] = [];
        for (let line = 0; line < editor.document.lineCount; line++) {
            const info = blame[line];
            if (!info) { continue; }
            decorations.push({
                range: new vscode.Range(line, 0, line, 0),
                renderOptions: {
                    before: {
                        contentText: annotationText(info),
                        // The band carries recency, so the text keeps the theme
                        // colour set on the decoration type and stays readable.
                        color: info.isUncommitted ? uncommitted : undefined,
                        backgroundColor: band[line]
                    }
                },
                hoverMessage: hover(info)
            });
        }
        editor.setDecorations(this.decoration, decorations);
    }

    dispose(): void {
        this.decoration.dispose();
        this._onDidToggle.dispose();
        this.disposables.forEach(d => d.dispose());
    }
}

function hover(info: BlameInfo): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;          // needed for the command link below
    md.supportThemeIcons = true;  // without this "$(git-commit)" prints literally
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
