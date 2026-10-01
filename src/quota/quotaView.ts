/**
 * Sidebar webview view hosting the React Quota Tracker (webview-ui/dist).
 * Design follows the earlier 9router-vscode monitor: provider → account →
 * quota rows tree with toggle switches, per-account refresh/test buttons,
 * and a filter submenu in the view title.
 */
import * as vscode from 'vscode';
import { renderWebviewHtml } from '../webviewHtml';
import { HostToWebview, QuotaViewState, WebviewToHost } from './protocol';
import { QuotaService } from './quotaService';

export class QuotaViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewId = '9router.quota';

  private view: vscode.WebviewView | undefined;
  private viewDisposables: vscode.Disposable[] = [];
  private watch: vscode.Disposable | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly service: QuotaService
  ) {
    this.disposables.push(service.onDidChange(() => this.onServiceChange()));
    this.onServiceChange();
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.disposeView();
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'webview-ui', 'dist'),
        vscode.Uri.joinPath(this.extensionUri, 'media'),
      ],
    };
    view.webview.html = renderWebviewHtml(view.webview, this.extensionUri, 'quota', 'Quota Tracker');

    this.viewDisposables.push(
      view.webview.onDidReceiveMessage((msg: WebviewToHost) => this.onMessage(msg)),
      view.onDidChangeVisibility(() => this.updateWatch()),
      view.onDidDispose(() => this.disposeView())
    );
    this.updateWatch();
  }

  public refresh(): void {
    void this.service.refreshAll(true);
  }

  private onServiceChange(): void {
    const state = this.service.getState();
    void vscode.commands.executeCommand('setContext', '9router.quota.refreshing', state.loadingList);
    void vscode.commands.executeCommand('setContext', '9router.quota.filter', state.filter);
    this.postState(state);
  }

  private updateWatch(): void {
    if (this.view?.visible) {
      this.watch ??= this.service.watch();
      this.postState(this.service.getState());
    } else {
      this.watch?.dispose();
      this.watch = undefined;
    }
  }

  private onMessage(msg: WebviewToHost): void {
    switch (msg.type) {
      case 'ready':
        this.postState(this.service.getState());
        break;
      case 'refreshAll':
        void this.service.refreshAll(true);
        break;
      case 'refreshAccount':
        void this.service.refreshAccount(msg.id);
        break;
      case 'toggleAccount':
        void this.service.setAccountActive(msg.id, msg.active);
        break;
      case 'toggleProvider':
        void this.service.setProviderActive(msg.provider, msg.active);
        break;
      case 'testAccount':
        void this.service.testAccount(msg.id);
        break;
      case 'hideQuota':
        void this.service.setQuotaHidden(msg.provider, msg.key, true);
        break;
      case 'showQuota':
        void this.service.setQuotaHidden(msg.provider, msg.key, false);
        break;
      case 'signIn':
        void vscode.commands.executeCommand('9router.signIn');
        break;
      case 'openSettings':
        void vscode.commands.executeCommand('9router.openSettings');
        break;
      case 'openDashboard':
        void vscode.commands.executeCommand('9router.openDashboard');
        break;
      default:
        break;
    }
  }

  private postState(state: QuotaViewState): void {
    const view = this.view;
    if (!view) {
      return;
    }
    const withIcons: QuotaViewState = {
      ...state,
      groups: state.groups.map((g) => ({ ...g, iconUri: this.iconUri(view.webview, g.provider) })),
    };
    const message: HostToWebview = { type: 'state', state: withIcons };
    void view.webview.postMessage(message);
  }

  private iconUri(webview: vscode.Webview, provider: string): string {
    // Logos are copied from 9router's public/providers; <img onError> falls back.
    const key = provider.toLowerCase();
    return webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'providers', `${key}.png`)).toString();
  }

  private disposeView(): void {
    this.watch?.dispose();
    this.watch = undefined;
    for (const d of this.viewDisposables.splice(0)) {
      d.dispose();
    }
    this.view = undefined;
  }

  public dispose(): void {
    this.disposeView();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
