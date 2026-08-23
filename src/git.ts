import * as cp from 'child_process';
import * as path from 'path';

export interface Commit {
    hash: string;
    parents: string[];
    author: string;
    email: string;
    date: number; // unix seconds
    refs: string[];
    subject: string;
}

export interface BlameInfo {
    hash: string;
    author: string;
    date: number;
    summary: string;
    isUncommitted: boolean;
}

export interface ChangedFile {
    status: string; // A M D R...
    path: string;
    oldPath?: string; // for renames
}

export type RefType = 'head' | 'remote' | 'tag';

export interface Ref {
    type: RefType;
    /** Short name: "main", "origin/main", "v1.0.0" */
    name: string;
    /** Full ref: "refs/heads/main" */
    fullName: string;
    hash: string;
    /** Local branches only */
    upstream?: string;
    ahead: number;
    behind: number;
    current: boolean;
}

export interface Stash {
    index: number;
    /** "stash@{0}" */
    name: string;
    branch: string;
    subject: string;
    date: number;
}

export interface CommitDetail extends Commit {
    body: string;
    committer: string;
    committerDate: number;
    files: ChangedFile[];
}

const FIELD = '\x1f';
const RECORD = '\x1e';

export class Git {
    constructor(public readonly repoRoot: string) {}

    exec(args: string[]): Promise<string> {
        return new Promise((resolve, reject) => {
            cp.execFile(
                'git',
                args,
                { cwd: this.repoRoot, maxBuffer: 100 * 1024 * 1024 },
                (err, stdout, stderr) => (err ? reject(new Error(stderr.trim() || err.message)) : resolve(stdout))
            );
        });
    }

    static repoRootFor(fsPath: string): Promise<string | undefined> {
        const dir = path.extname(fsPath) ? path.dirname(fsPath) : fsPath;
        return new Promise(resolve => {
            cp.execFile('git', ['rev-parse', '--show-toplevel'], { cwd: dir }, (err, stdout) =>
                resolve(err ? undefined : stdout.trim())
            );
        });
    }

    relative(fsPath: string): string {
        return path.relative(this.repoRoot, fsPath).replace(/\\/g, '/');
    }

    private parseLog(raw: string): Commit[] {
        return raw
            .split(RECORD)
            .map(r => r.replace(/^\n/, ''))
            .filter(r => r.trim().length > 0)
            .map(r => {
                const [hash, parents, author, email, date, refs, subject] = r.split(FIELD);
                return {
                    hash,
                    parents: parents ? parents.split(' ').filter(Boolean) : [],
                    author,
                    email,
                    date: parseInt(date, 10),
                    refs: refs
                        ? refs.split(', ').map(s => s.replace('HEAD -> ', '')).filter(Boolean)
                        : [],
                    subject
                };
            });
    }

    private static LOG_FORMAT = `%H${FIELD}%P${FIELD}%an${FIELD}%ae${FIELD}%at${FIELD}%D${FIELD}%s${RECORD}`;

    /**
     * One page of the graph. `scope` is a ref name to limit it to; omit for
     * every branch. `skip` walks past commits already loaded — the topological
     * order is deterministic, so paging this way cannot repeat or drop a commit.
     */
    log(maxCount: number, scope?: string, skip = 0): Promise<Commit[]> {
        const args = ['log'];
        if (scope) {
            args.push(scope);
        } else {
            // refs/stash lives under refs/, so a bare --all drags every stash
            // and its index/untracked parents into the graph as ordinary rows.
            // --exclude only applies to the --all that follows it.
            args.push('--exclude=refs/stash', '--all');
        }
        args.push('--topo-order', `--max-count=${maxCount}`, `--format=${Git.LOG_FORMAT}`);
        if (skip > 0) { args.push(`--skip=${skip}`); }
        return this.exec(args).then(out => this.parseLog(out));
    }

    fileLog(fsPath: string, maxCount = 500): Promise<Commit[]> {
        return this.exec([
            'log', '--follow', `--max-count=${maxCount}`, `--format=${Git.LOG_FORMAT}`, '--', this.relative(fsPath)
        ]).then(out => this.parseLog(out));
    }

    /** Content of file at commit. Empty string if file did not exist. */
    async show(hash: string, relPath: string): Promise<string> {
        try {
            return await this.exec(['show', `${hash}:${relPath}`]);
        } catch {
            return '';
        }
    }

    /**
     * Path the file had at `hash`, following renames back from its path today.
     * Walks the whole --follow log because git can only follow renames backwards
     * from a path that exists at the tip, not forwards from an old commit.
     */
    async pathAt(hash: string, fsPath: string): Promise<string> {
        const rel = this.relative(fsPath);
        try {
            const out = await this.exec([
                'log', '--follow', `--format=${RECORD}%H`, '--name-only', '--', rel
            ]);
            for (const block of out.split(RECORD)) {
                const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
                if (lines[0] === hash) {
                    return lines[1] ?? rel;
                }
            }
            return rel;
        } catch {
            return rel;
        }
    }

    async changedFiles(hash: string): Promise<ChangedFile[]> {
        const base = ['diff-tree', '--no-commit-id', '--name-status', '-r', '-M'];
        // Diff against the first parent explicitly: plain `diff-tree <merge>`
        // prints nothing, and `-m` prints one diff per parent run together.
        let out: string;
        try {
            out = await this.exec([...base, `${hash}^`, hash]);
        } catch {
            out = await this.exec([...base, '--root', hash]); // root commit has no parent
        }
        return out
            .trim()
            .split('\n')
            .filter(Boolean)
            .map(line => {
                const parts = line.split('\t');
                const status = parts[0];
                if (status.startsWith('R') && parts.length === 3) {
                    return { status: 'R', oldPath: parts[1], path: parts[2] };
                }
                return { status: status[0], path: parts[1] };
            });
    }

    async blameLine(fsPath: string, line: number, content?: string): Promise<BlameInfo | undefined> {
        const rel = this.relative(fsPath);
        const args = ['blame', '--porcelain', '-L', `${line},${line}`];
        if (content !== undefined) {
            args.push('--contents', '-');
        }
        args.push('--', rel);
        const out = await new Promise<string>((resolve, reject) => {
            const child = cp.execFile(
                'git',
                args,
                { cwd: this.repoRoot, maxBuffer: 10 * 1024 * 1024 },
                (err, stdout, stderr) => (err ? reject(new Error(stderr.trim() || err.message)) : resolve(stdout))
            );
            if (content !== undefined && child.stdin) {
                child.stdin.write(content);
                child.stdin.end();
            }
        });
        const lines = out.split('\n');
        if (!lines[0]) {
            return undefined;
        }
        const hash = lines[0].split(' ')[0];
        const get = (key: string) => {
            const l = lines.find(x => x.startsWith(key + ' '));
            return l ? l.substring(key.length + 1) : '';
        };
        const isUncommitted = /^0+$/.test(hash);
        return {
            hash,
            author: isUncommitted ? 'You' : get('author'),
            date: parseInt(get('author-time') || '0', 10),
            summary: isUncommitted ? 'Uncommitted changes' : get('summary'),
            isUncommitted
        };
    }

    /**
     * Blame for every line, indexed by line number - 1. `content` blames an
     * unsaved buffer so the result lines up with what the editor shows.
     */
    async blameFile(fsPath: string, content?: string): Promise<BlameInfo[]> {
        const args = ['blame', '--porcelain'];
        if (content !== undefined) { args.push('--contents', '-'); }
        args.push('--', this.relative(fsPath));

        const out = await new Promise<string>((resolve, reject) => {
            const child = cp.execFile(
                'git',
                args,
                { cwd: this.repoRoot, maxBuffer: 100 * 1024 * 1024 },
                (err, stdout, stderr) => (err ? reject(new Error(stderr.trim() || err.message)) : resolve(stdout))
            );
            if (content !== undefined && child.stdin) {
                child.stdin.write(content);
                child.stdin.end();
            }
        });

        // Porcelain repeats a commit's metadata only the first time it appears.
        const seen = new Map<string, { author: string; date: number; summary: string }>();
        const lines = out.split('\n');
        const result: BlameInfo[] = [];
        let i = 0;
        while (i < lines.length) {
            const header = /^([0-9a-f]{40}) \d+ (\d+)(?: \d+)?$/.exec(lines[i]);
            if (!header) { i++; continue; }
            const hash = header[1];
            const finalLine = parseInt(header[2], 10);
            i++;

            const info = seen.get(hash) ?? { author: '', date: 0, summary: '' };
            while (i < lines.length && !lines[i].startsWith('\t')) {
                const line = lines[i];
                // "author " must not swallow "author-time" / "author-mail".
                if (line.startsWith('author ')) { info.author = line.substring(7); }
                else if (line.startsWith('author-time ')) { info.date = parseInt(line.substring(12), 10); }
                else if (line.startsWith('summary ')) { info.summary = line.substring(8); }
                i++;
            }
            seen.set(hash, info);
            i++; // the tab-prefixed source line

            const isUncommitted = /^0+$/.test(hash);
            result[finalLine - 1] = {
                hash,
                author: isUncommitted ? 'You' : info.author,
                date: info.date,
                summary: isUncommitted ? 'Uncommitted changes' : info.summary,
                isUncommitted
            };
        }
        return result;
    }

    // ---------------------------------------------------------------- reading

    async commitDetail(hash: string): Promise<CommitDetail> {
        const fmt = [
            '%H', '%P', '%an', '%ae', '%at', '%D', '%s', '%cn', '%ct', '%b'
        ].join(FIELD);
        const out = await this.exec(['show', '--no-patch', `--format=${fmt}`, hash]);
        const [h, parents, author, email, date, refs, subject, committer, cdate, ...rest] =
            out.split(FIELD);
        return {
            hash: h,
            parents: parents ? parents.split(' ').filter(Boolean) : [],
            author,
            email,
            date: parseInt(date, 10),
            refs: refs ? refs.split(', ').map(s => s.replace('HEAD -> ', '')).filter(Boolean) : [],
            subject,
            committer,
            committerDate: parseInt(cdate, 10),
            // %b may itself contain the separator if a commit body does; rejoin.
            body: rest.join(FIELD).trim(),
            files: await this.changedFiles(hash)
        };
    }

    async refs(): Promise<Ref[]> {
        const fmt = [
            '%(refname)', '%(objectname)', '%(upstream:short)', '%(upstream:track)', '%(HEAD)'
        ].join(FIELD);
        const out = await this.exec([
            'for-each-ref', `--format=${fmt}`, 'refs/heads', 'refs/remotes', 'refs/tags'
        ]);
        return out
            .split('\n')
            .filter(Boolean)
            .map(line => {
                const [fullName, hash, upstream, track, head] = line.split(FIELD);
                const type: RefType = fullName.startsWith('refs/heads/')
                    ? 'head'
                    : fullName.startsWith('refs/tags/')
                        ? 'tag'
                        : 'remote';
                const prefix = { head: 'refs/heads/', remote: 'refs/remotes/', tag: 'refs/tags/' }[type];
                return {
                    type,
                    name: fullName.substring(prefix.length),
                    fullName,
                    hash,
                    upstream: upstream || undefined,
                    ahead: parseInt(/ahead (\d+)/.exec(track ?? '')?.[1] ?? '0', 10),
                    behind: parseInt(/behind (\d+)/.exec(track ?? '')?.[1] ?? '0', 10),
                    current: head === '*'
                };
            })
            // HEAD~ order is arbitrary from for-each-ref; current branch first, then name.
            .sort((a, b) => Number(b.current) - Number(a.current) || a.name.localeCompare(b.name));
    }

    /** Branch name, or undefined when HEAD is detached. */
    async currentBranch(): Promise<string | undefined> {
        const name = (await this.exec(['branch', '--show-current'])).trim();
        return name || undefined;
    }

    async stashes(): Promise<Stash[]> {
        const out = await this.exec([
            'stash', 'list', `--format=%gd${FIELD}%gs${FIELD}%at${RECORD}`
        ]);
        return out
            .split(RECORD)
            .map(r => r.trim())
            .filter(Boolean)
            .map((r, index) => {
                const [name, gs, date] = r.split(FIELD);
                // %gs looks like "WIP on main: 1a2b3c subject" or "On main: message"
                const m = /^(?:WIP on|On) ([^:]+): (.*)$/s.exec(gs ?? '');
                return {
                    index,
                    name,
                    branch: m?.[1] ?? '',
                    subject: m?.[2] ?? gs ?? '',
                    date: parseInt(date, 10)
                };
            });
    }

    /** Files changed by a stash entry, as a diff against the commit it was made on. */
    stashFiles(name: string): Promise<ChangedFile[]> {
        return this.changedFiles(name);
    }

    // ---------------------------------------------------------------- writing
    // All local-only. Network operations are delegated to the built-in git
    // extension so its credential handling is reused instead of reimplemented.

    checkout(ref: string): Promise<string> {
        return this.exec(['checkout', ref]);
    }

    checkoutDetached(hash: string): Promise<string> {
        return this.exec(['checkout', '--detach', hash]);
    }

    createBranch(name: string, startPoint: string, checkout: boolean): Promise<string> {
        return checkout
            ? this.exec(['checkout', '-b', name, startPoint])
            : this.exec(['branch', name, startPoint]);
    }

    deleteBranch(name: string, force: boolean): Promise<string> {
        return this.exec(['branch', force ? '-D' : '-d', name]);
    }

    renameBranch(from: string, to: string): Promise<string> {
        return this.exec(['branch', '-m', from, to]);
    }

    createTag(name: string, hash: string, message?: string): Promise<string> {
        return message
            ? this.exec(['tag', '-a', name, hash, '-m', message])
            : this.exec(['tag', name, hash]);
    }

    deleteTag(name: string): Promise<string> {
        return this.exec(['tag', '-d', name]);
    }

    merge(ref: string, noFastForward: boolean): Promise<string> {
        return this.exec(noFastForward ? ['merge', '--no-ff', ref] : ['merge', ref]);
    }

    rebase(onto: string): Promise<string> {
        return this.exec(['rebase', onto]);
    }

    cherryPick(hash: string): Promise<string> {
        return this.exec(['cherry-pick', hash]);
    }

    revert(hash: string): Promise<string> {
        // -m 1 is required for merge commits and rejected for ordinary ones,
        // so pick based on the actual parent count.
        return this.commitDetail(hash).then(d =>
            this.exec(d.parents.length > 1 ? ['revert', '--no-edit', '-m', '1', hash] : ['revert', '--no-edit', hash])
        );
    }

    // ------------------------------------------------------- history rewriting

    /** Nothing staged or modified. Untracked files do not block a rebase. */
    async isClean(): Promise<boolean> {
        return (await this.exec(['status', '--porcelain', '--untracked-files=no'])).trim() === '';
    }

    async isAncestor(ancestor: string, descendant: string): Promise<boolean> {
        try {
            await this.exec(['merge-base', '--is-ancestor', ancestor, descendant]);
            return true;
        } catch {
            return false;
        }
    }

    async parentsOf(hash: string): Promise<string[]> {
        const out = await this.exec(['rev-list', '--parents', '-n', '1', hash]);
        return out.trim().split(' ').slice(1);
    }

    /**
     * Why `hashes` cannot be squashed, or undefined when they can. Expects them
     * newest first: they must form an unbroken first-parent chain, contain no
     * merge commit, and not reach the repository's first commit.
     */
    async squashProblem(hashes: string[]): Promise<string | undefined> {
        if (hashes.length < 2) {
            return 'Select at least two commits to squash.';
        }
        const parents = await Promise.all(hashes.map(h => this.parentsOf(h)));
        for (let i = 0; i < hashes.length; i++) {
            const short = hashes[i].substring(0, 8);
            if (parents[i].length > 1) {
                return `${short} is a merge commit, which cannot be squashed.`;
            }
            if (parents[i].length === 0) {
                return `${short} is the first commit of the repository, which cannot be squashed.`;
            }
            if (i + 1 < hashes.length && parents[i][0] !== hashes[i + 1]) {
                return 'Selected commits must be consecutive in history, with no other commit between them.';
            }
        }
        return undefined;
    }

    /**
     * Move `branch` to `rewritten` by replaying everything after `replaced` onto
     * it. The replayed commits keep their trees, so this cannot conflict — but if
     * git stops anyway, unwind rather than leaving a detached or half-rebased HEAD.
     */
    private async replayOnto(rewritten: string, replaced: string, branch: string): Promise<void> {
        try {
            await this.exec(['rebase', '--onto', rewritten, replaced, branch]);
        } catch (e) {
            await this.exec(['rebase', '--abort']).catch(() => undefined);
            await this.exec(['checkout', branch]).catch(() => undefined);
            throw e;
        }
    }

    /** Replace a commit's message, rewriting every commit after it. */
    async rewordCommit(hash: string, message: string): Promise<void> {
        const branch = await this.currentBranch();
        if (!branch) {
            throw new Error('HEAD is detached. Check out a branch first.');
        }
        const head = (await this.exec(['rev-parse', 'HEAD'])).trim();
        if (head === hash) {
            await this.exec(['commit', '--amend', '-m', message]);
            return;
        }
        await this.exec(['checkout', '--detach', hash]);
        try {
            await this.exec(['commit', '--amend', '-m', message]);
        } catch (e) {
            await this.exec(['checkout', branch]).catch(() => undefined);
            throw e;
        }
        const rewritten = (await this.exec(['rev-parse', 'HEAD'])).trim();
        await this.replayOnto(rewritten, hash, branch);
    }

    /** Why `hashes` cannot be dropped, or undefined when they can. */
    async dropProblem(hashes: string[]): Promise<string | undefined> {
        if (hashes.length === 0) {
            return 'Select at least one commit to drop.';
        }
        const parents = await Promise.all(hashes.map(h => this.parentsOf(h)));
        for (let i = 0; i < hashes.length; i++) {
            const short = hashes[i].substring(0, 8);
            if (parents[i].length > 1) {
                return `${short} is a merge commit. Dropping it would flatten the branch it merged in; revert it instead.`;
            }
            if (parents[i].length === 0) {
                return `${short} is the first commit of the repository, which cannot be dropped.`;
            }
        }
        return undefined;
    }

    /**
     * Remove commits from the branch entirely. Newest first, so every hash still
     * waiting to be dropped keeps its identity while the commits after it are
     * replayed — which is also why the selection need not be consecutive.
     *
     * Unlike a reword or squash this replays commits onto a *different* tree, so
     * it genuinely can conflict. `replayOnto` aborts on failure; the error then
     * says how far the run got rather than leaving a half-dropped branch.
     */
    async dropCommits(hashes: string[]): Promise<void> {
        const branch = await this.currentBranch();
        if (!branch) {
            throw new Error('HEAD is detached. Check out a branch first.');
        }
        for (let i = 0; i < hashes.length; i++) {
            try {
                await this.replayOnto(`${hashes[i]}^`, hashes[i], branch);
            } catch (e) {
                const progress = i === 0
                    ? 'Nothing was dropped.'
                    : `The ${i} newer commit${i === 1 ? '' : 's'} were dropped; the rest were left alone.`;
                throw new Error(
                    `${hashes[i].substring(0, 8)} cannot be dropped — a later commit builds on it. ` +
                    `${progress}\n\n${(e as Error).message}`
                );
            }
        }
    }

    /**
     * Combine `hashes` (newest first, consecutive) into one commit. Validate with
     * `squashProblem` first; this assumes the selection is already sound.
     */
    async squashCommits(hashes: string[], message: string): Promise<void> {
        const branch = await this.currentBranch();
        if (!branch) {
            throw new Error('HEAD is detached. Check out a branch first.');
        }
        const newest = hashes[0];
        const oldest = hashes[hashes.length - 1];

        await this.exec(['checkout', '--detach', newest]);
        let squashed: string;
        try {
            // Soft reset keeps the newest commit's tree in the index, so one
            // commit on top of the oldest one's parent carries all the changes.
            await this.exec(['reset', '--soft', `${oldest}^`]);
            await this.exec(['commit', '-m', message]);
            squashed = (await this.exec(['rev-parse', 'HEAD'])).trim();
        } catch (e) {
            await this.exec(['checkout', '--force', branch]).catch(() => undefined);
            throw e;
        }
        await this.replayOnto(squashed, newest, branch);
    }

    reset(hash: string, mode: 'soft' | 'mixed' | 'hard'): Promise<string> {
        return this.exec(['reset', `--${mode}`, hash]);
    }

    stashPush(message: string | undefined, includeUntracked: boolean): Promise<string> {
        const args = ['stash', 'push'];
        if (includeUntracked) { args.push('--include-untracked'); }
        if (message) { args.push('-m', message); }
        return this.exec(args);
    }

    stashApply(name: string, pop: boolean): Promise<string> {
        return this.exec(['stash', pop ? 'pop' : 'apply', name]);
    }

    stashDrop(name: string): Promise<string> {
        return this.exec(['stash', 'drop', name]);
    }
}
