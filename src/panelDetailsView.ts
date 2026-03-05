import * as vscode from 'vscode';
import { PanelProperty, PanelScript } from './panelModel';
import { PanelTreeItem } from './panelTreeProvider';

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export class PanelDetailsView implements vscode.WebviewViewProvider {
    public static readonly viewType = 'winccoaPanelDetails';

    private view?: vscode.WebviewView;
    private selectedItem?: PanelTreeItem;

    public resolveWebviewView(webviewView: vscode.WebviewView): void {
        this.view = webviewView;

        webviewView.webview.options = {
            enableScripts: false,
        };

        this.render();
    }

    public setSelection(item?: PanelTreeItem): void {
        this.selectedItem = item;
        this.render();
    }

    private render(): void {
        if (!this.view) return;

        const title = 'Details';
        const body = this.renderBody(this.selectedItem);

        this.view.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    body {
      padding: 10px 12px;
      color: var(--vscode-foreground);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      line-height: 1.4;
    }
    h2 {
      margin: 0 0 10px 0;
      font-size: 13px;
      font-weight: 600;
      color: var(--vscode-foreground);
    }
    .muted {
      color: var(--vscode-descriptionForeground);
    }
    .section {
      margin-top: 12px;
    }
    .row {
      margin: 6px 0;
    }
    .key {
      display: inline-block;
      min-width: 80px;
      color: var(--vscode-descriptionForeground);
    }
    code, pre {
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
    }
    pre {
      padding: 10px;
      background: var(--vscode-textCodeBlock-background);
      border: 1px solid var(--vscode-editorWidget-border);
      border-radius: 4px;
      overflow: auto;
      white-space: pre;
      tab-size: 4;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin-top: 6px;
    }
    td {
      padding: 4px 6px;
      border-bottom: 1px solid var(--vscode-editorWidget-border);
      vertical-align: top;
    }
    td:first-child {
      width: 40%;
      color: var(--vscode-descriptionForeground);
    }
  </style>
</head>
<body>
  <h2>${title}</h2>
  ${body}
</body>
</html>`;
    }

    private renderBody(item?: PanelTreeItem): string {
        if (!item) {
            return `<div class="muted">Select a property or script in the tree to see details.</div>`;
        }

        if (item.itemType === 'property' && item.data) {
            const prop = item.data as PanelProperty;
            const type = prop.type ? escapeHtml(prop.type) : '';
            const value = escapeHtml(prop.value ?? '');

            const children = prop.children && prop.children.length > 0
                ? `<div class="section">
                     <div class="row"><span class="key">Children</span><span class="muted">(${prop.children.length})</span></div>
                     <table>
                       ${prop.children
                           .map((c) => {
                               const childName = escapeHtml(c.name);
                               const childValue = escapeHtml(c.value ?? '');
                               return `<tr><td>${childName}</td><td>${childValue}</td></tr>`;
                           })
                           .join('')}
                     </table>
                   </div>`
                : '';

            return `
<div class="row"><span class="key">Name</span>${escapeHtml(prop.name)}</div>
${type ? `<div class="row"><span class="key">Type</span>${type}</div>` : ''}
<div class="section">
  <div class="row"><span class="key">Value</span></div>
  <pre>${value}</pre>
</div>
${children}
`;
        }

        if (item.itemType === 'script' && item.data) {
            const script = item.data as PanelScript;
            const event = escapeHtml(script.event);
          const code = escapeHtml(script.code ?? '');

            return `
<div class="row"><span class="key">Event</span>${event}</div>
<div class="section">
  <div class="row"><span class="key">Code</span></div>
  <pre>${code}</pre>
</div>
`;
        }

        return `<div class="muted">No details available for this item.</div>`;
    }
}
