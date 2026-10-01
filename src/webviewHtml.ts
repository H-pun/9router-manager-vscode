import * as vscode from 'vscode';

/**
 * HTML shell for the webview-ui bundle. A single Vite build serves every
 * view; `data-view` on <body> selects which React app to mount.
 */
export function renderWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  viewName: 'quota' | 'usage',
  title: string
): string {
  const distRoot = vscode.Uri.joinPath(extensionUri, 'webview-ui', 'dist');
  const script = webview.asWebviewUri(vscode.Uri.joinPath(distRoot, 'assets', 'index.js'));
  const style = webview.asWebviewUri(vscode.Uri.joinPath(distRoot, 'assets', 'index.css'));
  const codicons = webview.asWebviewUri(vscode.Uri.joinPath(distRoot, 'codicons', 'codicon.css'));
  const nonce = createNonce();
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource}`,
    `img-src ${webview.cspSource} data:`,
    // cspSource: lazily imported chunks (React Flow/Recharts) load from the extension.
    `script-src 'nonce-${nonce}' ${webview.cspSource}`,
  ].join('; ');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${codicons}" id="vscode-codicon-stylesheet" />
  <link rel="stylesheet" href="${style}" />
  <title>${title}</title>
</head>
<body data-view="${viewName}">
  <div id="root"></div>
  <script type="module" nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
}

function createNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}
