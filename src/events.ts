import * as vscode from 'vscode';

/** Fired after anything changes the repository, so every view can reload. */
export const repoChanged = new vscode.EventEmitter<void>();

/**
 * Run a git write operation with a progress notification, surface failures as
 * errors instead of silently swallowing them, and refresh the views on success.
 */
export async function run(title: string, op: () => Promise<unknown>): Promise<boolean> {
    try {
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.SourceControl, title },
            op
        );
        repoChanged.fire();
        return true;
    } catch (e) {
        const message = (e as Error).message || String(e);
        vscode.window.showErrorMessage(`${title} failed: ${message.split('\n')[0]}`, 'Show details')
            .then(pick => {
                if (pick) {
                    vscode.window.showErrorMessage(message, { modal: true });
                }
            });
        repoChanged.fire(); // a failed merge/rebase still leaves the repo changed
        return false;
    }
}
