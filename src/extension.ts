import * as vscode from 'vscode';
import { Git } from './git';
import { GitContentProvider, SCHEME } from './gitfs';
import { InlineBlame } from './blame';
import { BlameAnnotations } from './annotate';
import { GraphPanel, GraphViewProvider } from './graph';
import { FileHistoryProvider, diffRevision } from './history';
import { Node, RepoProvider } from './repo';
import { repoChanged } from './events';
import * as actions from './actions';

/** Repo for the active editor, falling back to the first workspace folder. */
async function resolveGit(quiet = false): Promise<Git | undefined> {
    const active = vscode.window.activeTextEditor?.document.uri;
    const start =
        active?.scheme === 'file'
            ? active.fsPath
            : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!start) {
        if (!quiet) { vscode.window.showWarningMessage('Git Storm: no folder open.'); }
        return undefined;
    }
    const root = await Git.repoRootFor(start);
    if (!root) {
        if (!quiet) { vscode.window.showWarningMessage('Git Storm: not a git repository.'); }
        return undefined;
    }
    return new Git(root);
}

/** Refresh the views when refs change outside the extension (terminal, other tools). */
function watchRefs(context: vscode.ExtensionContext): void {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(folder, '.git/{HEAD,ORIG_HEAD,refs/**,packed-refs}')
        );
        const fire = () => repoChanged.fire();
        watcher.onDidChange(fire);
        watcher.onDidCreate(fire);
        watcher.onDidDelete(fire);
        context.subscriptions.push(watcher);
    }
}

/** One-click open/close for the GitStorm panel, next to the other status bar buttons. */
function createStatusBarToggle(): vscode.StatusBarItem {
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
    item.text = '$(gitstorm-logo)';
    item.name = 'GitStorm';
    item.tooltip = 'GitStorm — open or close the GitStorm panel';
    item.command = 'gitstorm.togglePanel';
    item.show();
    return item;
}

export function activate(context: vscode.ExtensionContext): void {
    const blame = new InlineBlame();
    const annotations = new BlameAnnotations();
    const history = new FileHistoryProvider();
    const repo = new RepoProvider(() => resolveGit(true));
    const graph = new GraphViewProvider(context.extensionPath, () => resolveGit(true));

    /**
     * Wrap a command that needs a repo. `node` is absent when the command comes
     * from a view title button or the command palette rather than a tree item.
     */
    const withGit = (fn: (git: Git, node?: Node) => unknown) => async (node?: Node) => {
        const git = await resolveGit();
        if (git) { await fn(git, node); }
    };

    context.subscriptions.push(
        blame,
        annotations,
        createStatusBarToggle(),
        vscode.workspace.registerTextDocumentContentProvider(SCHEME, new GitContentProvider()),
        vscode.window.registerTreeDataProvider('gitstorm.repo', repo),
        vscode.window.registerTreeDataProvider('gitstorm.history', history),

        // ------------------------------------------------------------- graph
        vscode.window.registerWebviewViewProvider(GraphViewProvider.viewId, graph, {
            webviewOptions: { retainContextWhenHidden: true }
        }),

        vscode.commands.registerCommand('gitstorm.showGraph', async (scope?: string) => {
            graph.setScope(typeof scope === 'string' ? scope : undefined);
            await vscode.commands.executeCommand(`${GraphViewProvider.viewId}.focus`);
        }),

        vscode.commands.registerCommand('gitstorm.openGraphInEditor', () =>
            GraphPanel.show(context.extensionPath, () => resolveGit())),

        // Close only when our own view is the one on screen; if the panel is open
        // on someone else's tab (Terminal, Problems) this brings ours forward.
        vscode.commands.registerCommand('gitstorm.togglePanel', () =>
            vscode.commands.executeCommand(
                graph.visible ? 'workbench.action.closePanel' : `${GraphViewProvider.viewId}.focus`
            )),

        vscode.commands.registerCommand('gitstorm.revealCommit', (hash: string) => graph.reveal(hash)),

        // -------------------------------------------------------- annotations
        vscode.commands.registerCommand('gitstorm.toggleBlame', () => blame.toggle()),
        vscode.commands.registerCommand('gitstorm.toggleAnnotate', (context?: { uri?: vscode.Uri } | vscode.Uri) => {
            const uri = (context && typeof context === 'object' && 'uri' in context ? context.uri : (context instanceof vscode.Uri ? context : undefined))
                ?? vscode.window.activeTextEditor?.document.uri;
            const editor = uri
                ? vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === uri.toString()) ?? vscode.window.activeTextEditor
                : vscode.window.activeTextEditor;
            return annotations.toggle(editor);
        }),

        vscode.commands.registerCommand('gitstorm.fileHistory', (uri?: vscode.Uri) => {
            const fsPath = uri?.fsPath ?? vscode.window.activeTextEditor?.document.uri.fsPath;
            if (fsPath) { history.refresh(fsPath); }
            vscode.commands.executeCommand('gitstorm.history.focus');
        }),
        vscode.commands.registerCommand('gitstorm.refreshHistory', () => history.refresh()),
        vscode.commands.registerCommand('gitstorm.diffRevision', diffRevision),

        // ---------------------------------------------------- branches & tags
        vscode.commands.registerCommand('gitstorm.refreshRepo', () => repo.refresh()),
        vscode.commands.registerCommand('gitstorm.checkout', withGit((git, n) =>
            n?.ref ? actions.checkoutRef(git, n.ref) : undefined)),
        vscode.commands.registerCommand('gitstorm.deleteRef', withGit((git, n) =>
            n?.ref ? actions.deleteRef(git, n.ref) : undefined)),
        vscode.commands.registerCommand('gitstorm.renameRef', withGit((git, n) =>
            n?.ref ? actions.renameRef(git, n.ref) : undefined)),
        vscode.commands.registerCommand('gitstorm.mergeRef', withGit((git, n) =>
            n?.ref ? actions.mergeRef(git, n.ref) : undefined)),
        vscode.commands.registerCommand('gitstorm.rebaseOnto', withGit((git, n) =>
            n?.ref ? actions.rebaseOnto(git, n.ref) : undefined)),
        vscode.commands.registerCommand('gitstorm.newBranch', withGit(async (git, n) =>
            actions.branchFrom(git, n?.ref?.name ?? 'HEAD'))),
        vscode.commands.registerCommand('gitstorm.newTag', withGit(async (git, n) =>
            actions.tagAt(git, n?.ref?.hash ?? 'HEAD'))),

        // ------------------------------------------------------------ stashes
        vscode.commands.registerCommand('gitstorm.stashPush', withGit(git => actions.stashPush(git))),
        vscode.commands.registerCommand('gitstorm.stashApply', withGit((git, n) =>
            n?.stash ? actions.stashApply(git, n.stash, false) : undefined)),
        vscode.commands.registerCommand('gitstorm.stashPop', withGit((git, n) =>
            n?.stash ? actions.stashApply(git, n.stash, true) : undefined)),
        vscode.commands.registerCommand('gitstorm.stashDrop', withGit((git, n) =>
            n?.stash ? actions.stashDrop(git, n.stash) : undefined)),
        vscode.commands.registerCommand('gitstorm.stashShow', async (name: string) => {
            const git = await resolveGit();
            if (git) { await actions.stashShow(git, name); }
        })
    );

    watchRefs(context);
}

export function deactivate(): void {}
