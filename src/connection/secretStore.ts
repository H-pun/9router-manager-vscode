import * as vscode from 'vscode';
import { CredentialStore } from '../dashboard/client';

const PREFIX = '9router';

/** SecretStorage-backed credentials, namespaced by server URL. */
export class SecretCredentialStore implements CredentialStore {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  getToken(serverUrl: string): Promise<string | undefined> {
    return Promise.resolve(this.secrets.get(this.key('session', serverUrl)));
  }

  async setToken(serverUrl: string, token: string | undefined): Promise<void> {
    await this.put(this.key('session', serverUrl), token);
  }

  getPassword(serverUrl: string): Promise<string | undefined> {
    return Promise.resolve(this.secrets.get(this.key('password', serverUrl)));
  }

  async setPassword(serverUrl: string, password: string | undefined): Promise<void> {
    await this.put(this.key('password', serverUrl), password);
  }

  /** Cached value of the API key used by Copilot (so chat keeps working if the dashboard session lapses). */
  async getCopilotKey(serverUrl: string, keyId: string): Promise<string | undefined> {
    const raw = await this.secrets.get(this.key('copilotKey', serverUrl));
    if (!raw) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(raw) as { id?: string; key?: string };
      return parsed.id === keyId ? parsed.key : undefined;
    } catch {
      return undefined;
    }
  }

  async setCopilotKey(serverUrl: string, value: { id: string; key: string } | undefined): Promise<void> {
    await this.put(this.key('copilotKey', serverUrl), value ? JSON.stringify(value) : undefined);
  }

  private key(kind: string, serverUrl: string): string {
    return `${PREFIX}.${kind}:${serverUrl}`;
  }

  private async put(key: string, value: string | undefined): Promise<void> {
    if (value === undefined) {
      await this.secrets.delete(key);
    } else {
      await this.secrets.store(key, value);
    }
  }
}
