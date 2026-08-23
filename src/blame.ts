import * as vscode from 'vscode';
import { Git } from './git';
import { timeAgo } from './format';

/** The part of BlameAnnotations this needs, kept narrow to avoid a cycle. */
export interface AnnotationState {
    isAnnotated(document: vscode.TextDocument): boolean;
    onDidToggle: vscode.Event<vscode.TextDocument>;
}

export class InlineBlame implements vscode.Disposable {
    private decoration = vscode.window.createTextEditorDecorationType({
        after: {
            color: new vscode.ThemeColor('editorCodeLens.foreground'),
            margin: '0 0 0 3em',
            fontStyle: 'italic'
        }
    });
    private disposables: vscode.Disposable[] = [];
    private timer: NodeJS.Timeout | undefined;
    private enabled: boolean;

    constructor(private readonly annotations: AnnotationState) {
        this.enabled = vscode.workspace.getConfiguration('gitstorm').get('inlineBlame', true);
        this.disposables.push(
            vscode.window.onDidChangeTextEditorSelection(e => this.schedule(e.textEditor)),
            vscode.window.onDidChangeActiveTextEditor(e => e && this.schedule(e)),
            vscode.workspace.onDidChangeTextDocument(e => {
                const ed = vscode.window.activeTextEditor;
                if (ed && e.document === ed.document) { this.schedule(ed); }
            }),
            // Annotating a file already puts this line's commit on screen, so
            // clear the end-of-line copy rather than saying it twice — and stack
            // two hover cards on the same line.
            annotations.onDidToggle(doc => {
                for (const editor of vscode.window.visibleTextEditors) {
                    if (editor.document === doc) {
                        editor.setDecorations(this.decoration, []);
                        this.schedule(editor);
                    }
                }
            })
        );
        if (vscode.window.activeTextEditor) {
            this.schedule(vscode.window.activeTextEditor);
        }
    }

    toggle(): void {
        this.enabled = !this.enabled;
        const ed = vscode.window.activeTextEditor;
        if (!this.enabled && ed) {
            ed.setDecorations(this.decoration, []);
        } else if (ed) {
            this.schedule(ed);
        }
        vscode.workspace.getConfiguration('gitstorm').update('inlineBlame', this.enabled, true);
    }

    private schedule(editor: vscode.TextEditor): void {
        if (this.timer) { clearTimeout(this.timer); }
        this.timer = setTimeout(() => this.update(editor), 300);
    }

    private async update(editor: vscode.TextEditor): Promise<void> {
        if (!this.enabled || editor.document.uri.scheme !== 'file') { return; }
        if (this.annotations.isAnnotated(editor.document)) { return; }
        const line = editor.selection.active.line;
        const root = await Git.repoRootFor(editor.document.uri.fsPath);
        if (!root) { return; }
        try {
            const git = new Git(root);
            const content = editor.document.isDirty ? editor.document.getText() : undefined;
            const blame = await git.blameLine(editor.document.uri.fsPath, line + 1, content);
            if (!blame) { return; }
            // selection may have moved while git ran
            if (vscode.window.activeTextEditor !== editor || editor.selection.active.line !== line) { return; }
            const text = blame.isUncommitted
                ? 'You • Uncommitted changes'
                : `${blame.author}, ${timeAgo(blame.date)} • ${blame.summary}`;
            const range = editor.document.lineAt(line).range;
            editor.setDecorations(this.decoration, [
                {
                    range,
                    renderOptions: { after: { contentText: text } },
                    hoverMessage: blame.isUncommitted
                        ? undefined
                        : new vscode.MarkdownString(`**${blame.author}** — ${blame.summary}\n\n\`${blame.hash.substring(0, 8)}\``)
                }
            ]);
        } catch {
            editor.setDecorations(this.decoration, []); // untracked file etc.
        }
    }

    dispose(): void {
        if (this.timer) { clearTimeout(this.timer); }
        this.decoration.dispose();
        this.disposables.forEach(d => d.dispose());
    }
}
