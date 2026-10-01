/**
 * Sidebar "Usage" webview: React Flow provider topology (live via SSE),
 * Recharts activity chart and recent requests — ported from the earlier
 * 9router-vscode monitor, backed by the dashboard session.
 */
import * as vscode from 'vscode';
import { ConnectionManager } from '../connection/connectionManager';
import { errorMessage } from '../dashboard/errors';
import { ProviderConnection } from '../dashboard/types';
import { renderWebviewHtml } from '../webviewHtml';
import { UsageHostToWebview, UsagePeriod, UsageViewState, UsageWebviewToHost } from './protocol';
import { buildTopologyProviders } from './topology';
import { UsageStreamService } from './usageStreamService';

export class UsageViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewId = '9router.usage';

  private view: vscode.WebviewView | undefined;
  private viewDisposables: vscode.Disposable[] = [];
  private watch: vscode.Disposable | undefined;
  private connections: ProviderConnection[] = [];
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly connection: ConnectionManager,
    private readonly stream: UsageStreamService,
    private readonly log: (message: string) => void
  ) {
    this.disposables.push(
      stream.onDidUpdate(() => this.postState()),
      stream.onDidChangeLive(() => this.postState()),
      connection.onDidChangeState((s) => {
        if (s.kind === 'connected') {
          void this.loadProviders();
        } else {
          this.connections = [];
        }
        this.postState();
      })
    );
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
    view.webview.html = renderWebviewHtml(view.webview, this.extensionUri, 'usage', 'Usage');
    this.viewDisposables.push(
      view.webview.onDidReceiveMessage((msg: UsageWebviewToHost) => this.onMessage(msg)),
      view.onDidChangeVisibility(() => this.updateWatch()),
      view.onDidDispose(() => this.disposeView())
    );
    this.updateWatch();
  }

  /** View title refresh: reload providers and reconnect the stream. */
  public refresh(): void {
    void this.loadProviders();
    this.postState();
  }

  private updateWatch(): void {
    if (this.view?.visible) {
      this.watch ??= this.stream.watch();
      if (this.connections.length === 0 && this.connection.isConnected()) {
        void this.loadProviders();
      }
      this.postState();
    } else {
      this.watch?.dispose();
      this.watch = undefined;
    }
  }

  private async loadProviders(): Promise<void> {
    if (!this.connection.isConnected()) {
      return;
    }
    try {
      this.connections = await this.connection.client.listAllConnections();
      this.postState();
    } catch (error) {
      this.connection.reportError(error);
      this.log(`Usage: failed to load providers: ${errorMessage(error)}`);
    }
  }

  private onMessage(msg: UsageWebviewToHost): void {
    switch (msg.type) {
      case 'ready':
        this.postState();
        break;
      case 'fetchChart':
        void this.fetchChart(msg.period);
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

  private async fetchChart(period: UsagePeriod): Promise<void> {
    let message: UsageHostToWebview;
    try {
      const data = await this.connection.client.getUsageChart(period);
      message = { type: 'chart', period, data };
    } catch (error) {
      this.connection.reportError(error);
      message = { type: 'chart', period, data: [], error: errorMessage(error) };
    }
    void this.view?.webview.postMessage(message);
  }

  private postState(): void {
    const view = this.view;
    if (!view) {
      return;
    }
    const s = this.connection.getState();
    const stats = this.stream.getSnapshot();
    const iconUri = (id: string) =>
      view.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'providers', `${id}.png`)).toString();
    const providers = buildTopologyProviders(this.connections).map((p) => ({ ...p, iconUri: iconUri(p.provider) }));
    const recent = stats?.recentRequests ?? [];
    const iconMap: Record<string, string> = {};
    for (const r of recent) {
      const key = (r.provider || '').toLowerCase();
      if (key && !iconMap[key]) {
        iconMap[key] = iconUri(key);
      }
    }
    const state: UsageViewState = {
      connection: s.kind,
      connectionMessage: s.kind === 'error' ? s.message : undefined,
      serverUrl: this.connection.getServerUrl(),
      live: this.stream.isLive(),
      providers,
      activeRequests: stats?.activeRequests ?? [],
      recentRequests: recent,
      lastProvider: recent[0]?.provider ?? '',
      errorProvider: stats?.errorProvider ?? '',
      totals: {
        requests: stats?.totalRequests ?? 0,
        promptTokens: stats?.totalPromptTokens ?? 0,
        completionTokens: stats?.totalCompletionTokens ?? 0,
        cost: typeof stats?.totalCost === 'number' ? stats.totalCost : 0,
      },
      iconMap,
    };
    const message: UsageHostToWebview = { type: 'state', state };
    void view.webview.postMessage(message);
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
