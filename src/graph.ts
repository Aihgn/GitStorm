import * as vscode from 'vscode';
import * as path from 'path';
import { Git } from './git';
import { repoChanged } from './events';
import { timeAgo } from './format';
import * as actions from './actions';

interface Message {
    type: 'ready' | 'loadMore' | 'select' | 'action' | 'openFile' | 'fileAction' | 'scope';
    hash?: string;
    hashes?: string[];
    action?: string;
    path?: string;
    oldPath?: string;
    status?: string;
    scope?: string;
}

/**
 * Everything the commit graph does, against a plain `vscode.Webview`, so the
 * same code backs the bottom panel view and the full editor tab.
 */
export class GraphController {
    private scope: string | undefined;
    /** Commits handed to the webview so far, i.e. the next page's --skip. */
    private loaded = 0;

    constructor(
        private readonly extensionPath: string,
        private readonly webview: vscode.Webview,
        private readonly resolveGit: () => Promise<Git | undefined>
    ) {}

    private mediaUri(file: string): vscode.Uri {
        return this.webview.asWebviewUri(vscode.Uri.file(path.join(this.extensionPath, 'media', file)));
    }

    html(): string {
        const csp = this.webview.cspSource;
        return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${csp}; script-src ${csp};">
<link rel="stylesheet" href="${this.mediaUri('graph.css')}">
</head>
<body>
<div id="toolbar">
    <button data-action="refresh" title="Reload the graph">Refresh</button>
    <span class="sepbar"></span>
    <button data-action="fetch" title="Fetch from remotes">Fetch</button>
    <button data-action="pull" title="Pull into the current branch">Pull</button>
    <button data-action="push" title="Push the current branch">Push</button>
    <span class="sepbar"></span>
    <button data-action="newBranch" title="Create a branch at the selected commit">Branch…</button>
    <button data-action="stashPush" title="Stash working tree changes">Stash…</button>
    <span class="sepbar"></span>
    <input id="filter" type="text" placeholder="Filter by message, author, hash…">
    <select id="scope" title="Limit the graph to one ref"><option value="">All branches</option></select>
    <span class="spacer"></span>
    <span id="branch"></span>
    <span class="sepbar"></span>
    <span id="count"></span>
</div>
<div id="main">
    <div id="graph"><div id="more"></div></div>
    <div id="splitter"></div>
    <div id="detail">
        <div id="dmeta" class="meta"><div class="placeholder">Select a commit.</div></div>
        <div id="dsplitter"></div>
        <div id="dfiles" class="files"></div>
    </div>
</div>
<div id="ctxmenu"></div>
<script src="${this.mediaUri('graph.js')}"></script>
</body>
</html>`;
    }

    setScope(scope: string | undefined): void {
        this.scope = scope;
        void this.reload();
    }

    private get pageSize(): number {
        const size = vscode.workspace.getConfiguration('gitstorm').get('graphPageSize', 500);
        return Math.max(50, size);
    }

    async reload(): Promise<void> {
        const git = await this.resolveGit();
        if (!git) {
            this.webview.postMessage({ type: 'error', message: 'No git repository' });
            return;
        }
        this.loaded = 0;
        try {
            const size = this.pageSize;
            const [commits, refs, branch] = await Promise.all([
                git.log(size, this.scope),
                git.refs(),
                git.currentBranch()
            ]);
            this.loaded = commits.length;
            this.webview.postMessage({
                type: 'refs',
                refs: refs.map(r => r.name),
                branch,
                scope: this.scope ?? ''
            });
            this.webview.postMessage({
                type: 'commits',
                commits: commits.map(c => ({ ...c, ago: timeAgo(c.date) })),
                hasMore: commits.length === size
            });
        } catch (e) {
            const message = (e as Error).message.split('\n')[0];
            this.webview.postMessage({ type: 'error', message });
            vscode.window.showErrorMessage(`Git Storm: ${message}`);
        }
    }

    /** Next page, appended in the webview rather than replacing what is there. */
    private async loadMore(): Promise<void> {
        const git = await this.resolveGit();
        if (!git) { return; }
        try {
            const size = this.pageSize;
            const commits = await git.log(size, this.scope, this.loaded);
            this.loaded += commits.length;
            this.webview.postMessage({
                type: 'commitsAppend',
                commits: commits.map(c => ({ ...c, ago: timeAgo(c.date) })),
                hasMore: commits.length === size
            });
        } catch (e) {
            const message = (e as Error).message.split('\n')[0];
            this.webview.postMessage({ type: 'commitsAppend', commits: [], hasMore: false });
            vscode.window.showErrorMessage(`Git Storm: ${message}`);
        }
    }

    private async sendDetail(hash: string): Promise<void> {
        const git = await this.resolveGit();
        if (!git) { return; }
        try {
            const d = await git.commitDetail(hash);
            this.webview.postMessage({
                type: 'detail',
                detail: { ...d, ago: timeAgo(d.date), dateText: new Date(d.date * 1000).toLocaleString() }
            });
        } catch {
            // Commit vanished (e.g. reset while selected); the next reload fixes it.
        }
    }

    async handle(msg: Message): Promise<void> {
        if (msg.type === 'ready') { return this.reload(); }
        if (msg.type === 'loadMore') { return this.loadMore(); }
        if (msg.type === 'select' && msg.hash) { return this.sendDetail(msg.hash); }
        if (msg.type === 'scope') {
            this.scope = msg.scope || undefined;
            return this.reload();
        }
        const git = await this.resolveGit();
        if (!git) { return; }
        if ((msg.type === 'openFile' || msg.type === 'fileAction') && msg.hash && msg.path) {
            const file = {
                status: msg.status ?? 'M',
                path: msg.path,
                oldPath: msg.oldPath
            };
            switch (msg.type === 'openFile' ? 'openDiff' : msg.action) {
                case 'openDiff': return actions.openFileDiff(git, msg.hash, file);
                case 'openWorking': return actions.openWorkingFile(git, msg.hash, file);
                case 'openAtCommit': return actions.openFileAtCommit(git, msg.hash, file);
                case 'fileHistory': return actions.showFileHistory(git, file);
                case 'copyPath': return actions.copyPath(git, file);
            }
            return;
        }
        if (msg.type === 'action') { return this.onAction(git, msg.action!, msg.hash, msg.hashes ?? []); }
    }

    /** Select a commit from elsewhere in the extension (a blame annotation). */
    reveal(hash: string): void {
        this.webview.postMessage({ type: 'reveal', hash });
    }

    private async onAction(git: Git, action: string, hash?: string, hashes: string[] = []): Promise<void> {
        // Network operations go through the built-in git extension so its
        // credential and remote handling is reused rather than reimplemented.
        const delegated: Record<string, string> = {
            fetch: 'git.fetch',
            pull: 'git.pull',
            push: 'git.push'
        };
        if (delegated[action]) {
            try {
                await vscode.commands.executeCommand(delegated[action]);
            } catch (e) {
                vscode.window.showErrorMessage(`Git Storm: ${(e as Error).message}`);
            }
            repoChanged.fire();
            return;
        }

        if (action === 'refresh') { return this.reload(); }
        if (action === 'stashPush') { return actions.stashPush(git); }
        if (action === 'squash') { return actions.squash(git, hashes); }
        // Single-select posts a one-entry `hashes`, so drop needs no special case.
        if (action === 'drop') { return actions.drop(git, hashes); }
        if (action === 'copyHashes') { return actions.copyHashes(hashes); }

        if (!hash) {
            vscode.window.showInformationMessage('Select a commit first.');
            return;
        }
        switch (action) {
            case 'checkout': await actions.checkoutCommit(git, hash); return;
            case 'newBranch':
            case 'branch': await actions.branchFrom(git, hash); return;
            case 'tag': await actions.tagAt(git, hash); return;
            case 'reword': await actions.reword(git, hash); return;
            case 'cherryPick': await actions.cherryPick(git, hash); return;
            case 'revert': await actions.revert(git, hash); return;
            case 'resetSoft': await actions.reset(git, hash, 'soft'); return;
            case 'resetMixed': await actions.reset(git, hash, 'mixed'); return;
            case 'resetHard': await actions.reset(git, hash, 'hard'); return;
            case 'showChanges': await actions.openCommitChanges(git, hash); return;
            case 'compare': await actions.compareWithWorkingTree(git, hash); return;
            case 'copyHash': await actions.copyHash(hash); return;
            case 'copyMessage': await actions.copyMessage(git, hash); return;
        }
    }
}

/** The commit graph as a view in the bottom panel — the primary UI. */
export class GraphViewProvider implements vscode.WebviewViewProvider {
    static readonly viewId = 'gitstorm.graphView';
    private controller: GraphController | undefined;
    private view: vscode.WebviewView | undefined;
    private pendingScope: string | undefined;

    constructor(
        private readonly extensionPath: string,
        private readonly resolveGit: () => Promise<Git | undefined>
    ) {}

    /** False before the view is first created, and whenever the panel is hidden. */
    get visible(): boolean {
        return this.view?.visible ?? false;
    }

    resolveWebviewView(view: vscode.WebviewView): void {
        this.view = view;
        view.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.file(path.join(this.extensionPath, 'media'))]
        };
        const controller = new GraphController(this.extensionPath, view.webview, this.resolveGit);
        this.controller = controller;
        view.webview.html = controller.html();
        view.webview.onDidReceiveMessage(msg => controller.handle(msg));

        const sub = repoChanged.event(() => {
            if (view.visible) { void controller.reload(); }
        });
        view.onDidDispose(() => {
            sub.dispose();
            if (this.view === view) { this.view = undefined; }
            if (this.controller === controller) { this.controller = undefined; }
        });

        if (this.pendingScope !== undefined) {
            controller.setScope(this.pendingScope);
            this.pendingScope = undefined;
        }
    }

    /** Scope the graph to a ref, even if the view has not been created yet. */
    setScope(scope: string | undefined): void {
        if (this.controller) {
            this.controller.setScope(scope);
        } else {
            this.pendingScope = scope;
        }
    }

    /**
     * Focus the panel and select `hash`. A view created by this call needs its
     * first load to finish before it can select anything, hence the retry.
     */
    async reveal(hash: string): Promise<void> {
        const existed = this.controller !== undefined;
        await vscode.commands.executeCommand(`${GraphViewProvider.viewId}.focus`);
        if (!existed) {
            await new Promise(resolve => setTimeout(resolve, 400));
        }
        this.controller?.reveal(hash);
    }
}

/** The same graph as a full editor tab, for browsing large histories. */
export class GraphPanel {
    private static current: GraphPanel | undefined;

    static show(
        extensionPath: string,
        resolveGit: () => Promise<Git | undefined>,
        scope?: string
    ): void {
        if (GraphPanel.current) {
            GraphPanel.current.panel.reveal();
            GraphPanel.current.controller.setScope(scope);
            return;
        }
        GraphPanel.current = new GraphPanel(extensionPath, resolveGit, scope);
    }

    private panel: vscode.WebviewPanel;
    private controller: GraphController;

    private constructor(
        extensionPath: string,
        resolveGit: () => Promise<Git | undefined>,
        scope?: string
    ) {
        this.panel = vscode.window.createWebviewPanel(
            'gitstorm.graph',
            'Commit Graph',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.file(path.join(extensionPath, 'media'))]
            }
        );
        this.panel.iconPath = new vscode.ThemeIcon('git-branch');
        this.controller = new GraphController(extensionPath, this.panel.webview, resolveGit);
        this.panel.webview.html = this.controller.html();
        if (scope !== undefined) { this.controller.setScope(scope); }

        const subs = [
            this.panel.webview.onDidReceiveMessage(msg => this.controller.handle(msg)),
            repoChanged.event(() => this.controller.reload())
        ];
        this.panel.onDidDispose(() => {
            subs.forEach(s => s.dispose());
            GraphPanel.current = undefined;
        });
    }
}
