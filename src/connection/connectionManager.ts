/**
 * Owns the dashboard connection lifecycle: reads `9router.connection.*`,
 * signs in (manually or with the stored password), tracks state, and
 * re-connects when the server URL changes.
 */
import * as vscode from 'vscode';
import { DashboardClient } from '../dashboard/client';
import { DashboardError, errorMessage } from '../dashboard/errors';
import { normalizeServerUrl } from '../dashboard/http';
import { ConnectionState } from '../dashboard/types';
import { SecretCredentialStore } from './secretStore';

export const CONNECTION_SECTION = '9router.connection';
const CONNECTED_CONTEXT_KEY = '9router.connected';

export class ConnectionManager implements vscode.Disposable {
  public readonly client: DashboardClient;
  public readonly store: SecretCredentialStore;

  private state: ConnectionState = { kind: 'signedOut' };
  private readonly _onDidChangeState = new vscode.EventEmitter<ConnectionState>();
  readonly onDidChangeState = this._onDidChangeState.event;
  private readonly disposables: vscode.Disposable[] = [];
  private connectGeneration = 0;

  constructor(secrets: vscode.SecretStorage, private readonly log: (message: string) => void) {
    this.store = new SecretCredentialStore(secrets);
    this.client = new DashboardClient({
      store: this.store,
      timeoutMs: () => this.config().get<number>('requestTimeout', 15000),
      log: (m) => this.log(`[dashboard] ${m}`),
    });
    this.client.setServerUrl(this.resolveServerUrl());

    this.disposables.push(
      this._onDidChangeState,
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(`${CONNECTION_SECTION}.serverUrl`)) {
          void this.onServerUrlChanged();
        }
      })
    );
  }

  public getState(): ConnectionState {
    return this.state;
  }

  public isConnected(): boolean {
    return this.state.kind === 'connected';
  }

  public getServerUrl(): string | undefined {
    return this.client.getServerUrl();
  }

  public getRawServerUrl(): string {
    return this.config().get<string>('serverUrl', 'http://localhost:20128');
  }

  /** Startup: try the stored session / password if autoConnect is on. */
  public async initialize(): Promise<void> {
    if (!this.config().get<boolean>('autoConnect', true)) {
      return;
    }
    await this.tryResume();
  }

  /**
   * Interactive sign-in: prompts for the server URL (prefilled) and password.
   * Returns true on success.
   */
  public async signInInteractive(): Promise<boolean> {
    const current = this.getRawServerUrl();
    const urlInput = await vscode.window.showInputBox({
      title: '9Router: Sign In (1/2)',
      prompt: '9Router server URL (local or remote)',
      value: current,
      ignoreFocusOut: true,
      validateInput: (v) => (normalizeServerUrl(v) ? undefined : 'Enter a valid http(s) URL'),
    });
    if (urlInput === undefined) {
      return false;
    }
    const normalized = normalizeServerUrl(urlInput)!;
    if (normalized !== this.getServerUrl()) {
      // Suppress the config listener's auto-connect; we sign in explicitly below.
      this.client.setServerUrl(normalized);
      await this.config().update('serverUrl', normalized, vscode.ConfigurationTarget.Global);
    }

    for (;;) {
      const password = await vscode.window.showInputBox({
        title: '9Router: Sign In (2/2)',
        prompt: `Dashboard password for ${normalized}`,
        password: true,
        ignoreFocusOut: true,
      });
      if (password === undefined) {
        return false;
      }
      const result = await this.connectWith(async () => {
        await this.client.login(password);
      });
      if (result === true) {
        void vscode.window.showInformationMessage(`9Router: signed in to ${normalized}`);
        return true;
      }
      if (!(result instanceof DashboardError) || result.code !== 'invalidPassword') {
        this.showSignInError(result);
        return false;
      }
      void vscode.window.showWarningMessage(`9Router: ${result.message}`);
    }
  }

  public async signOut(): Promise<void> {
    ++this.connectGeneration;
    try {
      await this.client.logout(true);
    } finally {
      this.setState({ kind: 'signedOut' });
    }
  }

  /** Verify reachability and session validity; updates state. */
  public async testConnection(): Promise<void> {
    const serverUrl = this.getServerUrl();
    if (!serverUrl) {
      void vscode.window.showErrorMessage('9Router: server URL is not a valid URL.');
      return;
    }
    try {
      const healthy = await this.client.health();
      const version = await this.client.version();
      const status = await this.client.authStatus().catch(() => undefined);
      const parts = [
        healthy ? 'reachable' : 'health check failed',
        version ? `v${version.currentVersion}` : undefined,
        status?.authenticated ? 'signed in' : 'not signed in',
      ].filter(Boolean);
      void vscode.window.showInformationMessage(`9Router @ ${serverUrl}: ${parts.join(' · ')}`);
      if (status?.authenticated && !this.isConnected()) {
        this.setState({ kind: 'connected', serverUrl, version: version?.currentVersion });
      }
    } catch (error) {
      void vscode.window.showErrorMessage(`9Router: ${errorMessage(error)}`);
    }
  }

  /**
   * Handle an auth failure surfaced by any feature (e.g. API key refresh):
   * flip state to signed-out so the UI prompts for sign-in.
   */
  public reportError(error: unknown): void {
    if (error instanceof DashboardError && error.code === 'unauthorized') {
      this.setState({ kind: 'signedOut' });
    } else if (error instanceof DashboardError && (error.code === 'network' || error.code === 'timeout')) {
      this.setState({ kind: 'error', message: error.message });
    }
  }

  private async onServerUrlChanged(): Promise<void> {
    const next = this.resolveServerUrl();
    if (next === this.getServerUrl()) {
      // Already applied (e.g. by the interactive sign-in flow).
      return;
    }
    this.log(`Server URL changed to ${next ?? '(invalid)'}`);
    this.client.setServerUrl(next);
    this.setState({ kind: 'signedOut' });
    if (next && this.config().get<boolean>('autoConnect', true)) {
      await this.tryResume();
    }
  }

  /** Resume with the stored session, falling back to the stored password. */
  private async tryResume(): Promise<void> {
    const serverUrl = this.getServerUrl();
    if (!serverUrl) {
      return;
    }
    const hasToken = !!(await this.store.getToken(serverUrl));
    const hasPassword = await this.client.hasStoredPassword();
    if (!hasToken && !hasPassword) {
      return;
    }
    const result = await this.connectWith(async () => {
      // authStatus is public; verify the session via an authenticated call
      // (request() re-logs in with the stored password on 401).
      await this.client.getSettings();
    });
    if (result !== true) {
      this.log(`Auto-connect failed: ${errorMessage(result)}`);
    }
  }

  /** Run `action`, then mark connected. Returns true or the error. */
  private async connectWith(action: () => Promise<void>): Promise<true | unknown> {
    const generation = ++this.connectGeneration;
    this.setState({ kind: 'connecting' });
    try {
      await action();
      const version = await this.client.version().catch(() => undefined);
      if (generation !== this.connectGeneration) {
        return new Error('Superseded');
      }
      this.setState({
        kind: 'connected',
        serverUrl: this.getServerUrl()!,
        version: version?.currentVersion,
      });
      return true;
    } catch (error) {
      if (generation === this.connectGeneration) {
        if (error instanceof DashboardError && (error.code === 'unauthorized' || error.code === 'invalidPassword')) {
          this.setState({ kind: 'signedOut' });
        } else {
          this.setState({ kind: 'error', message: errorMessage(error) });
        }
      }
      return error;
    }
  }

  private showSignInError(error: unknown): void {
    if (error instanceof DashboardError) {
      switch (error.code) {
        case 'mustChangePassword':
          void vscode.window.showErrorMessage(
            '9Router: the server still uses the default password, which is blocked for remote sign-in. ' +
              'Change the password from the server machine (Dashboard → Settings) or set INITIAL_PASSWORD, then try again.'
          );
          return;
        case 'rateLimited':
          void vscode.window.showErrorMessage(
            `9Router: too many failed attempts. Try again in ${error.retryAfter ?? '?'}s.`
          );
          return;
        case 'passwordLoginDisabled':
          void vscode.window.showErrorMessage(
            `9Router: ${error.message} SSO sign-in is not supported by this extension yet.`
          );
          return;
        default:
          break;
      }
    }
    void vscode.window.showErrorMessage(`9Router: sign-in failed. ${errorMessage(error)}`);
  }

  private setState(next: ConnectionState): void {
    this.state = next;
    void vscode.commands.executeCommand('setContext', CONNECTED_CONTEXT_KEY, next.kind === 'connected');
    this._onDidChangeState.fire(next);
  }

  private resolveServerUrl(): string | undefined {
    return normalizeServerUrl(this.getRawServerUrl());
  }

  private config(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration(CONNECTION_SECTION);
  }

  public dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
