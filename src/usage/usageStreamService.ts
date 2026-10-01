/**
 * Live usage feed from `GET /api/usage/stream` (SSE, dashboard session
 * cookie). Connects only while someone is watching and the dashboard is
 * connected; reconnects with backoff.
 */
import * as vscode from 'vscode';
import { ConnectionManager } from '../connection/connectionManager';
import { errorMessage } from '../dashboard/errors';
import { UsageStats } from '../dashboard/types';
import { SseParser } from './sseParser';

const MIN_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 30_000;

export class UsageStreamService implements vscode.Disposable {
  private snapshot: UsageStats | undefined;
  private watchers = 0;
  private abort: AbortController | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private backoff = MIN_BACKOFF_MS;
  private live = false;

  private readonly _onDidUpdate = new vscode.EventEmitter<UsageStats>();
  readonly onDidUpdate = this._onDidUpdate.event;
  private readonly _onDidChangeLive = new vscode.EventEmitter<boolean>();
  readonly onDidChangeLive = this._onDidChangeLive.event;
  private readonly disposables: vscode.Disposable[] = [this._onDidUpdate, this._onDidChangeLive];

  constructor(
    private readonly connection: ConnectionManager,
    private readonly log: (message: string) => void
  ) {
    this.disposables.push(
      connection.onDidChangeState(() => {
        this.stop();
        if (connection.isConnected()) {
          this.snapshot = undefined;
          this.ensureRunning();
        }
      })
    );
  }

  public getSnapshot(): UsageStats | undefined {
    return this.snapshot;
  }

  public isLive(): boolean {
    return this.live;
  }

  public watch(): vscode.Disposable {
    this.watchers++;
    this.ensureRunning();
    return new vscode.Disposable(() => {
      this.watchers = Math.max(0, this.watchers - 1);
      if (this.watchers === 0) {
        this.stop();
      }
    });
  }

  private ensureRunning(): void {
    if (this.watchers > 0 && this.connection.isConnected() && !this.abort && !this.reconnectTimer) {
      void this.run();
    }
  }

  private async run(): Promise<void> {
    const abort = new AbortController();
    this.abort = abort;
    try {
      const res = await this.connection.client.openUsageStream(abort.signal);
      this.setLive(true);
      this.backoff = MIN_BACKOFF_MS;
      const parser = new SseParser();
      const decoder = new TextDecoder();
      const reader = res.body!.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        for (const data of parser.push(decoder.decode(value, { stream: true }))) {
          this.onEvent(data);
        }
      }
    } catch (error) {
      if (!abort.signal.aborted) {
        this.connection.reportError(error);
        this.log(`Usage stream error: ${errorMessage(error)}`);
      }
    } finally {
      if (this.abort === abort) {
        this.abort = undefined;
      }
      this.setLive(false);
      if (!abort.signal.aborted) {
        this.scheduleReconnect();
      }
    }
  }

  private onEvent(data: string): void {
    try {
      const parsed = JSON.parse(data) as UsageStats;
      this.snapshot = parsed;
      this._onDidUpdate.fire(parsed);
    } catch {
      // ignore malformed events
    }
  }

  private scheduleReconnect(): void {
    if (this.watchers === 0 || !this.connection.isConnected() || this.reconnectTimer) {
      return;
    }
    const delay = this.backoff;
    this.backoff = Math.min(MAX_BACKOFF_MS, this.backoff * 2);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.ensureRunning();
    }, delay);
  }

  private stop(): void {
    this.abort?.abort();
    this.abort = undefined;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.setLive(false);
  }

  private setLive(live: boolean): void {
    if (this.live !== live) {
      this.live = live;
      this._onDidChangeLive.fire(live);
    }
  }

  public dispose(): void {
    this.stop();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
