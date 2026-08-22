import * as vscode from 'vscode';
import * as path from 'path';
import { Commit, Git } from './git';
import { toGitUri } from './gitfs';
import { timeAgo } from './format';

class HistoryItem extends vscode.TreeItem {
    constructor(commit: Commit, git: Git, filePath: string) {
        super(commit.subject, vscode.TreeItemCollapsibleState.None);
        this.description = `${commit.author}, ${timeAgo(commit.date)}`;
        this.tooltip = `${commit.hash}\n${commit.author} <${commit.email}>\n${new Date(commit.date * 1000).toLocaleString()}`;
        this.iconPath = new vscode.ThemeIcon('git-commit');
        this.command = {
            command: 'gitstorm.diffRevision',
            title: 'Diff',
            arguments: [git.repoRoot, commit.hash, filePath]
        };
    }
}

export class FileHistoryProvider implements vscode.TreeDataProvider<HistoryItem> {
    private _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this._onDidChange.event;
    private filePath: string | undefined;

    constructor() {
        vscode.window.onDidChangeActiveTextEditor(e => {
            if (e && e.document.uri.scheme === 'file') {
                this.filePath = e.document.uri.fsPath;
                this._onDidChange.fire();
            }
        });
        this.filePath = vscode.window.activeTextEditor?.document.uri.fsPath;
    }

    refresh(filePath?: string): void {
        if (filePath) { this.filePath = filePath; }
        this._onDidChange.fire();
    }

    getTreeItem(item: HistoryItem): vscode.TreeItem {
        return item;
    }

    async getChildren(item?: HistoryItem): Promise<HistoryItem[]> {
        if (item || !this.filePath) { return []; }
        const root = await Git.repoRootFor(this.filePath);
        if (!root) { return []; }
        const git = new Git(root);
        try {
            const commits = await git.fileLog(this.filePath);
            return commits.map(c => new HistoryItem(c, git, this.filePath!));
        } catch {
            return [];
        }
    }
}

/** Diff working file against its content at the given commit (rename-aware). */
export async function diffRevision(repoRoot: string, hash: string, filePath: string): Promise<void> {
    const git = new Git(repoRoot);
    const relAtCommit = await git.pathAt(hash, filePath);
    const left = toGitUri(repoRoot, hash, relAtCommit);
    const right = vscode.Uri.file(filePath);
    await vscode.commands.executeCommand(
        'vscode.diff', left, right,
        `${path.basename(filePath)}: ${hash.substring(0, 8)} ↔ working tree`
    );
}
