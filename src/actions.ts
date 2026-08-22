import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ChangedFile, Git, Ref, Stash } from './git';
import { toGitUri } from './gitfs';
import { run } from './events';

/** Modal yes/no. Returns true only on an explicit confirmation. */
async function confirm(message: string, detail: string, confirmLabel: string): Promise<boolean> {
    const pick = await vscode.window.showWarningMessage(
        message,
        { modal: true, detail },
        confirmLabel
    );
    return pick === confirmLabel;
}

function askName(prompt: string, value?: string): Thenable<string | undefined> {
    return vscode.window.showInputBox({
        prompt,
        value,
        validateInput: v => {
            const name = v.trim();
            if (!name) { return 'Name is required.'; }
            // Mirrors the parts of git check-ref-format worth catching early.
            if (/[\s~^:?*\[\\]/.test(name)) { return 'Cannot contain whitespace or ~ ^ : ? * [ \\'; }
            if (name.startsWith('-') || name.endsWith('.') || name.endsWith('.lock')) {
                return 'Cannot start with "-" or end with "." or ".lock".';
            }
            if (name.includes('..') || name.includes('@{')) { return 'Cannot contain ".." or "@{".'; }
            return undefined;
        }
    });
}

// -------------------------------------------------------------------- diffing

/** Multi-file diff of everything a commit changed, in one editor tab. */
export async function openCommitChanges(git: Git, hash: string): Promise<void> {
    const files = await git.changedFiles(hash);
    if (files.length === 0) {
        vscode.window.showInformationMessage(`${hash.substring(0, 8)} changes no files.`);
        return;
    }
    const changes = files.map(f => [
        vscode.Uri.file(path.join(git.repoRoot, f.path)),
        toGitUri(git.repoRoot, `${hash}^`, f.oldPath ?? f.path),
        toGitUri(git.repoRoot, hash, f.path)
    ]);
    await vscode.commands.executeCommand('vscode.changes', `Commit ${hash.substring(0, 8)}`, changes);
}

/** Multi-file diff of a commit against the files on disk right now. */
export async function compareWithWorkingTree(git: Git, hash: string): Promise<void> {
    const out = await git.exec(['diff', '--name-status', '-M', hash]);
    const files = out.trim().split('\n').filter(Boolean).map(line => {
        const parts = line.split('\t');
        return parts[0].startsWith('R') && parts.length === 3
            ? { status: 'R', oldPath: parts[1], path: parts[2] }
            : { status: parts[0][0], path: parts[1] };
    });
    if (files.length === 0) {
        vscode.window.showInformationMessage(`Working tree matches ${hash.substring(0, 8)}.`);
        return;
    }
    const changes = files.map(f => [
        vscode.Uri.file(path.join(git.repoRoot, f.path)),
        toGitUri(git.repoRoot, hash, f.oldPath ?? f.path),
        vscode.Uri.file(path.join(git.repoRoot, f.path))
    ]);
    await vscode.commands.executeCommand(
        'vscode.changes', `${hash.substring(0, 8)} ↔ working tree`, changes
    );
}

/** Two-file diff for one entry of a commit. */
export async function openFileDiff(git: Git, hash: string, file: ChangedFile): Promise<void> {
    const left = toGitUri(git.repoRoot, `${hash}^`, file.oldPath ?? file.path);
    const right = toGitUri(git.repoRoot, hash, file.path);
    await vscode.commands.executeCommand(
        'vscode.diff', left, right, `${path.basename(file.path)} (${hash.substring(0, 8)})`
    );
}

/**
 * Open the file as it is on disk now. A commit's file may have been deleted or
 * renamed since, so fall back to its content at that commit rather than failing.
 */
export async function openWorkingFile(git: Git, hash: string, file: ChangedFile): Promise<void> {
    const onDisk = path.join(git.repoRoot, file.path);
    if (fs.existsSync(onDisk)) {
        await vscode.window.showTextDocument(vscode.Uri.file(onDisk), { preview: false });
        return;
    }
    vscode.window.showInformationMessage(
        `${file.path} no longer exists in the working tree. Showing it as of ${hash.substring(0, 8)}.`
    );
    await openFileAtCommit(git, hash, file);
}

/** Open the file's content at that commit, read-only. */
export async function openFileAtCommit(git: Git, hash: string, file: ChangedFile): Promise<void> {
    // A deleted file has no content at this commit; its parent still does.
    const rev = file.status === 'D' ? `${hash}^` : hash;
    const doc = await vscode.workspace.openTextDocument(
        toGitUri(git.repoRoot, rev, file.oldPath ?? file.path)
    );
    await vscode.window.showTextDocument(doc, { preview: false });
}

export async function copyPath(git: Git, file: ChangedFile): Promise<void> {
    await vscode.env.clipboard.writeText(path.join(git.repoRoot, file.path));
    vscode.window.setStatusBarMessage('Copied path', 2000);
}

export async function showFileHistory(git: Git, file: ChangedFile): Promise<void> {
    await vscode.commands.executeCommand(
        'gitstorm.fileHistory',
        vscode.Uri.file(path.join(git.repoRoot, file.path))
    );
}

// ------------------------------------------------------------------- commits

export function checkoutCommit(git: Git, hash: string): Promise<boolean> {
    return run(`Checkout ${hash.substring(0, 8)}`, () => git.checkoutDetached(hash));
}

export async function branchFrom(git: Git, startPoint: string): Promise<void> {
    const name = await askName(`New branch from ${startPoint.substring(0, 8)}`);
    if (!name) { return; }
    const pick = await vscode.window.showQuickPick(
        [
            { label: 'Create and checkout', checkout: true },
            { label: 'Create only', checkout: false }
        ],
        { placeHolder: `Create branch "${name.trim()}"` }
    );
    if (!pick) { return; }
    await run(`Create branch ${name.trim()}`, () =>
        git.createBranch(name.trim(), startPoint, pick.checkout));
}

export async function tagAt(git: Git, hash: string): Promise<void> {
    const name = await askName(`New tag at ${hash.substring(0, 8)}`);
    if (!name) { return; }
    const message = await vscode.window.showInputBox({
        prompt: 'Tag message (leave empty for a lightweight tag)'
    });
    if (message === undefined) { return; }
    await run(`Create tag ${name.trim()}`, () => git.createTag(name.trim(), hash, message || undefined));
}

export function cherryPick(git: Git, hash: string): Promise<boolean> {
    return run(`Cherry-pick ${hash.substring(0, 8)}`, () => git.cherryPick(hash));
}

export function revert(git: Git, hash: string): Promise<boolean> {
    return run(`Revert ${hash.substring(0, 8)}`, () => git.revert(hash));
}

export async function reset(git: Git, hash: string, mode: 'soft' | 'mixed' | 'hard'): Promise<void> {
    if (mode === 'hard') {
        const ok = await confirm(
            `Reset --hard to ${hash.substring(0, 8)}?`,
            'This permanently discards all uncommitted changes in your working tree and index. It cannot be undone.',
            'Reset --hard'
        );
        if (!ok) { return; }
    }
    await run(`Reset --${mode} to ${hash.substring(0, 8)}`, () => git.reset(hash, mode));
}

export async function copyHash(hash: string): Promise<void> {
    await vscode.env.clipboard.writeText(hash);
    vscode.window.setStatusBarMessage(`Copied ${hash.substring(0, 8)}`, 2000);
}

export async function copyHashes(hashes: string[]): Promise<void> {
    await vscode.env.clipboard.writeText(hashes.join('\n'));
    vscode.window.setStatusBarMessage(`Copied ${hashes.length} hashes`, 2000);
}

// ------------------------------------------------------------ rewriting history

/**
 * Shared preconditions for rewriting: a branch is checked out, the commits are
 * on it, and nothing uncommitted would be dragged into the rebase. Returns the
 * branch name, or undefined after telling the user what is in the way.
 */
async function readyToRewrite(git: Git, hashes: string[]): Promise<string | undefined> {
    const branch = await git.currentBranch();
    if (!branch) {
        vscode.window.showWarningMessage('HEAD is detached. Check out a branch before rewriting history.');
        return undefined;
    }
    for (const hash of hashes) {
        if (!(await git.isAncestor(hash, 'HEAD'))) {
            vscode.window.showWarningMessage(
                `${hash.substring(0, 8)} is not on "${branch}". Check out the branch that contains it first.`
            );
            return undefined;
        }
    }
    if (!(await git.isClean())) {
        vscode.window.showWarningMessage(
            'You have uncommitted changes. Commit or stash them before rewriting history.'
        );
        return undefined;
    }
    return branch;
}

export async function reword(git: Git, hash: string): Promise<void> {
    const branch = await readyToRewrite(git, [hash]);
    if (!branch) { return; }

    const detail = await git.commitDetail(hash);

    // ponytail: subject only, existing body preserved. A full multi-line edit
    // needs a temp document; add it if people ask to rewrite bodies.
    const subject = await vscode.window.showInputBox({
        prompt: detail.body ? 'New subject line (the existing body is kept)' : 'New commit message',
        value: detail.subject,
        validateInput: v => (v.trim() ? undefined : 'The message cannot be empty.')
    });
    if (subject === undefined || subject.trim() === detail.subject) { return; }

    // Warn only once there is an edit to warn about: the tip is amended in
    // place, anything older renumbers every commit after it.
    const head = (await git.exec(['rev-parse', 'HEAD'])).trim();
    if (head !== hash) {
        const ok = await confirm(
            `Edit the message of ${hash.substring(0, 8)}?`,
            `This rewrites that commit and every commit after it on "${branch}", so their hashes change. Anything already pushed would need a force-push.`,
            'Edit message'
        );
        if (!ok) { return; }
    }

    const message = detail.body ? `${subject.trim()}\n\n${detail.body}` : subject.trim();
    await run(`Edit message of ${hash.substring(0, 8)}`, () => git.rewordCommit(hash, message));
}

/** `hashes` come from the graph newest first. */
export async function squash(git: Git, hashes: string[]): Promise<void> {
    const problem = await git.squashProblem(hashes);
    if (problem) {
        vscode.window.showWarningMessage(problem);
        return;
    }
    const branch = await readyToRewrite(git, hashes);
    if (!branch) { return; }

    const details = await Promise.all(hashes.map(h => git.commitDetail(h)));
    const oldest = details[details.length - 1];

    const subject = await vscode.window.showInputBox({
        prompt: `Message for the ${hashes.length} squashed commits`,
        value: oldest.subject,
        validateInput: v => (v.trim() ? undefined : 'The message cannot be empty.')
    });
    if (subject === undefined) { return; }

    // Warn after the message is written, matching reword: no point warning about
    // an edit the user then abandons at the input box.
    const ok = await confirm(
        `Squash ${hashes.length} commits into one?`,
        `${details.map(d => `• ${d.subject}`).join('\n')}\n\nThis rewrites them and every commit after them on "${branch}", so their hashes change. Anything already pushed would need a force-push.`,
        `Squash ${hashes.length} commits`
    );
    if (!ok) { return; }

    // Body lists what went in, oldest first, the way `merge --squash` does.
    const body = details.map(d => d.subject).reverse().map(s => `* ${s}`).join('\n');
    const message = `${subject.trim()}\n\n${body}`;
    await run(`Squash ${hashes.length} commits`, () => git.squashCommits(hashes, message));
}

export async function copyMessage(git: Git, hash: string): Promise<void> {
    const detail = await git.commitDetail(hash);
    const text = detail.body ? `${detail.subject}\n\n${detail.body}` : detail.subject;
    await vscode.env.clipboard.writeText(text);
    vscode.window.setStatusBarMessage('Copied commit message', 2000);
}

// ---------------------------------------------------------------------- refs

export function checkoutRef(git: Git, ref: Ref): Promise<boolean> {
    // Checking out a remote branch by its short name creates the matching local
    // branch tracking it, which is what "checkout origin/foo" is nearly always for.
    const target = ref.type === 'remote' ? ref.name.replace(/^[^/]+\//, '') : ref.name;
    return run(`Checkout ${target}`, () => git.checkout(target));
}

export async function deleteRef(git: Git, ref: Ref): Promise<void> {
    if (ref.type === 'tag') {
        const ok = await confirm(`Delete tag "${ref.name}"?`, 'The tag is removed locally only.', 'Delete');
        if (ok) { await run(`Delete tag ${ref.name}`, () => git.deleteTag(ref.name)); }
        return;
    }
    if (ref.current) {
        vscode.window.showWarningMessage('Cannot delete the branch you are on. Check out another branch first.');
        return;
    }
    // Try the safe delete; only offer force once git says it would lose commits.
    const ok = await run(`Delete branch ${ref.name}`, () => git.deleteBranch(ref.name, false));
    if (ok) { return; }
    const force = await confirm(
        `"${ref.name}" is not fully merged. Delete anyway?`,
        'Commits only reachable from this branch will become unreferenced and may be garbage-collected.',
        'Force delete'
    );
    if (force) { await run(`Force-delete branch ${ref.name}`, () => git.deleteBranch(ref.name, true)); }
}

export async function renameRef(git: Git, ref: Ref): Promise<void> {
    const name = await askName(`Rename "${ref.name}" to`, ref.name);
    if (!name || name.trim() === ref.name) { return; }
    await run(`Rename ${ref.name}`, () => git.renameBranch(ref.name, name.trim()));
}

export async function mergeRef(git: Git, ref: Ref): Promise<void> {
    const current = await git.currentBranch();
    const pick = await vscode.window.showQuickPick(
        [
            { label: 'Merge', detail: 'Fast-forward when possible', noFF: false },
            { label: 'Merge (no fast-forward)', detail: 'Always create a merge commit', noFF: true }
        ],
        { placeHolder: `Merge "${ref.name}" into "${current ?? 'HEAD'}"` }
    );
    if (!pick) { return; }
    await run(`Merge ${ref.name}`, () => git.merge(ref.name, pick.noFF));
}

export async function rebaseOnto(git: Git, ref: Ref): Promise<void> {
    const current = await git.currentBranch();
    const ok = await confirm(
        `Rebase "${current ?? 'HEAD'}" onto "${ref.name}"?`,
        'This rewrites the commits on your current branch. Rebasing commits you have already pushed will require a force-push.',
        'Rebase'
    );
    if (ok) { await run(`Rebase onto ${ref.name}`, () => git.rebase(ref.name)); }
}

// -------------------------------------------------------------------- stashes

export async function stashPush(git: Git): Promise<void> {
    const message = await vscode.window.showInputBox({ prompt: 'Stash message (optional)' });
    if (message === undefined) { return; }
    const pick = await vscode.window.showQuickPick(
        [
            { label: 'Stash tracked changes', untracked: false },
            { label: 'Stash tracked and untracked changes', untracked: true }
        ],
        { placeHolder: 'What to stash' }
    );
    if (!pick) { return; }
    await run('Stash changes', () => git.stashPush(message || undefined, pick.untracked));
}

export async function stashApply(git: Git, stash: Stash, pop: boolean): Promise<void> {
    await run(`${pop ? 'Pop' : 'Apply'} ${stash.name}`, () => git.stashApply(stash.name, pop));
}

export async function stashDrop(git: Git, stash: Stash): Promise<void> {
    const ok = await confirm(
        `Drop ${stash.name}?`,
        `"${stash.subject}" will be deleted. Dropped stashes are not easily recoverable.`,
        'Drop'
    );
    if (ok) { await run(`Drop ${stash.name}`, () => git.stashDrop(stash.name)); }
}

export async function stashShow(git: Git, name: string): Promise<void> {
    const files = await git.stashFiles(name);
    if (files.length === 0) {
        vscode.window.showInformationMessage(`${name} has no file changes.`);
        return;
    }
    const changes = files.map(f => [
        vscode.Uri.file(path.join(git.repoRoot, f.path)),
        toGitUri(git.repoRoot, `${name}^`, f.oldPath ?? f.path),
        toGitUri(git.repoRoot, name, f.path)
    ]);
    await vscode.commands.executeCommand('vscode.changes', `Stash ${name}`, changes);
}
