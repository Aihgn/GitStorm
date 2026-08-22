import * as vscode from 'vscode';
import { Git, Ref, Stash } from './git';
import { repoChanged } from './events';
import { timeAgo } from './format';

type Group = 'branches' | 'remotes' | 'tags' | 'stashes';

export class Node extends vscode.TreeItem {
    constructor(
        label: string,
        state: vscode.TreeItemCollapsibleState,
        public readonly group?: Group,
        public readonly ref?: Ref,
        public readonly stash?: Stash
    ) {
        super(label, state);
    }
}

const GROUPS: { id: Group; label: string; icon: string }[] = [
    { id: 'branches', label: 'Branches', icon: 'git-branch' },
    { id: 'remotes', label: 'Remotes', icon: 'cloud' },
    { id: 'tags', label: 'Tags', icon: 'tag' },
    { id: 'stashes', label: 'Stashes', icon: 'archive' }
];

export class RepoProvider implements vscode.TreeDataProvider<Node> {
    private _onDidChange = new vscode.EventEmitter<Node | undefined>();
    readonly onDidChangeTreeData = this._onDidChange.event;

    constructor(private resolveGit: () => Promise<Git | undefined>) {
        repoChanged.event(() => this._onDidChange.fire(undefined));
    }

    refresh(): void {
        this._onDidChange.fire(undefined);
    }

    getTreeItem(node: Node): vscode.TreeItem {
        return node;
    }

    async getChildren(node?: Node): Promise<Node[]> {
        const git = await this.resolveGit();
        if (!git) { return []; }

        if (!node) {
            return GROUPS.map(g => {
                const n = new Node(g.label, vscode.TreeItemCollapsibleState.Expanded, g.id);
                n.iconPath = new vscode.ThemeIcon(g.icon);
                n.contextValue = `group.${g.id}`;
                return n;
            });
        }

        try {
            if (node.group === 'stashes') {
                return (await git.stashes()).map(s => this.stashNode(s));
            }
            const refs = await git.refs();
            const wanted =
                node.group === 'branches' ? 'head' : node.group === 'remotes' ? 'remote' : 'tag';
            return refs.filter(r => r.type === wanted).map(r => this.refNode(r));
        } catch {
            return [];
        }
    }

    private refNode(ref: Ref): Node {
        const n = new Node(ref.name, vscode.TreeItemCollapsibleState.None, undefined, ref);
        n.contextValue = `ref.${ref.type}${ref.current ? '.current' : ''}`;
        n.iconPath = new vscode.ThemeIcon(
            ref.type === 'tag' ? 'tag' : ref.current ? 'check' : 'git-branch'
        );
        const bits: string[] = [];
        if (ref.ahead) { bits.push(`↑${ref.ahead}`); }
        if (ref.behind) { bits.push(`↓${ref.behind}`); }
        if (ref.upstream) { bits.push(ref.upstream); }
        n.description = bits.join(' ');
        n.tooltip = `${ref.fullName}\n${ref.hash}`;
        n.command = {
            command: 'gitstorm.showGraph',
            title: 'Show in graph',
            arguments: [ref.name]
        };
        return n;
    }

    private stashNode(stash: Stash): Node {
        const n = new Node(stash.subject, vscode.TreeItemCollapsibleState.None, undefined, undefined, stash);
        n.contextValue = 'stash';
        n.iconPath = new vscode.ThemeIcon('archive');
        n.description = `${stash.branch} · ${timeAgo(stash.date)}`;
        n.tooltip = `${stash.name} on ${stash.branch}`;
        n.command = {
            command: 'gitstorm.stashShow',
            title: 'Show stash',
            arguments: [stash.name]
        };
        return n;
    }
}
