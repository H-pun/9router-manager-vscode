import * as vscode from 'vscode';
import { ConnectionManager } from './connection/connectionManager';
import { ConnectionState } from './dashboard/types';

export class StatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly sub: vscode.Disposable;

  constructor(private readonly connection: ConnectionManager) {
    this.item = vscode.window.createStatusBarItem('9router.status', vscode.StatusBarAlignment.Right, 100);
    this.item.name = '9Router';
    this.item.command = '9router.showMenu';
    this.sub = connection.onDidChangeState((s) => this.render(s));
    this.render(connection.getState());
    this.item.show();
  }

  private render(state: ConnectionState): void {
    const host = this.connection.getServerUrl() ?? this.connection.getRawServerUrl();
    this.item.backgroundColor = undefined;
    switch (state.kind) {
      case 'connected':
        this.item.text = '$(server-process) 9Router';
        this.item.tooltip = `9Router: connected to ${state.serverUrl}${state.version ? ` (v${state.version})` : ''}`;
        break;
      case 'connecting':
        this.item.text = '$(loading~spin) 9Router';
        this.item.tooltip = `9Router: connecting to ${host}…`;
        break;
      case 'error':
        this.item.text = '$(error) 9Router';
        this.item.tooltip = `9Router: ${state.message}`;
        this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        break;
      default:
        this.item.text = '$(debug-disconnect) 9Router';
        this.item.tooltip = `9Router: signed out (${host}). Click to sign in.`;
        break;
    }
  }

  public dispose(): void {
    this.sub.dispose();
    this.item.dispose();
  }
}
