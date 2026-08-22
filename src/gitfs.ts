import * as vscode from 'vscode';
import { Git } from './git';

/**
 * Read-only virtual documents for file content at a given commit.
 * URI: gitstorm:/<relPath>?<json {repo, hash, path}>
 */
export const SCHEME = 'gitstorm';

export function toGitUri(repo: string, hash: string, relPath: string): vscode.Uri {
    return vscode.Uri.from({
        scheme: SCHEME,
        path: '/' + relPath,
        query: JSON.stringify({ repo, hash, path: relPath })
    });
}

export class GitContentProvider implements vscode.TextDocumentContentProvider {
    provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        const { repo, hash, path } = JSON.parse(uri.query);
        return new Git(repo).show(hash, path);
    }
}
