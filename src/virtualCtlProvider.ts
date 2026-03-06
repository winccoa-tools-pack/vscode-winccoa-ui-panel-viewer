import * as vscode from 'vscode';

/**
 * Provides virtual, read-only CTL documents for panel scripts.
 *
 * Note: VS Code doesn't support hard read-only for text documents via this API,
 * but these documents are not backed by a real file and will typically require
 * "Save As" to persist.
 */
export class VirtualCtlProvider implements vscode.TextDocumentContentProvider {
    public static readonly scheme = 'winccoa-ctl';

    private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    public readonly onDidChange = this._onDidChange.event;

    private readonly contentByUri = new Map<string, string>();

    public provideTextDocumentContent(uri: vscode.Uri): string {
        return this.contentByUri.get(uri.toString()) ?? '';
    }

    public setContent(uri: vscode.Uri, content: string): void {
        this.contentByUri.set(uri.toString(), content);
        this._onDidChange.fire(uri);
    }

    public createScriptUri(panelPath: string, eventName: string): vscode.Uri {
        // Keep the visible filename as <event>.ctl, but include panel name as a folder
        // to avoid collisions when multiple panels have the same event.
        const panelBase = (panelPath.replace(/^.*[\\/]/, '') || 'panel').replace(/\.pnl$/i, '');
        const safeEvent = (eventName || 'script').replace(/[^a-zA-Z0-9._-]+/g, '_');
        const safePanel = panelBase.replace(/[^a-zA-Z0-9._-]+/g, '_');

        // Query makes the URI unique per panel path without affecting the filename.
        const query = `panel=${encodeURIComponent(panelPath)}`;
        return vscode.Uri.parse(
            `${VirtualCtlProvider.scheme}:/${encodeURIComponent(safePanel)}/${encodeURIComponent(
                safeEvent,
            )}.ctl?${query}`,
        );
    }
}
