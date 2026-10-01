import * as vscode from 'vscode';
import { ConnectionManager } from './connection/connectionManager';
import { CopilotProvider } from './copilot/copilotProvider';
import { getCopilotApiKeyLabel, setCopilotApiKeyLabel } from './copilot/copilotConfig';
import { errorMessage } from './dashboard/errors';
import { maskKey } from './dashboard/http';
import { ApiKeysSync } from './sync/apiKeysSync';
import { TokenSaverSync } from './sync/tokenSaverSync';

const EXTENSION_ID = 'whitefall.9router-extension';
const DEFAULT_COPILOT_KEY_NAME = 'vscode-copilot';

export interface CommandDeps {
  connection: ConnectionManager;
  apiKeys: ApiKeysSync;
  tokenSaver: TokenSaverSync;
  copilot: CopilotProvider;
  output: vscode.OutputChannel;
}

export function registerCommands(context: vscode.ExtensionContext, deps: CommandDeps): void {
  const { connection, apiKeys, tokenSaver, copilot, output } = deps;

  const run = (fn: () => Promise<unknown>) => async () => {
    try {
      await fn();
    } catch (error) {
      connection.reportError(error);
      void vscode.window.showErrorMessage(`9Router: ${errorMessage(error)}`);
    }
  };

  const requireConnected = async (): Promise<boolean> =>
    connection.isConnected() || connection.signInInteractive();

  const openSettings = (query: string) =>
    vscode.commands.executeCommand('workbench.action.openSettings', query);

  const createKeyFlow = async (): Promise<string | undefined> => {
    if (!(await requireConnected())) {
      return undefined;
    }
    const name = await vscode.window.showInputBox({
      title: '9Router: Create API Key',
      prompt: 'Key name',
      value: DEFAULT_COPILOT_KEY_NAME,
      validateInput: (v) => (v.trim() ? undefined : 'Name is required'),
    });
    if (!name) {
      return undefined;
    }
    const key = await apiKeys.create(name.trim());
    void vscode.window.showInformationMessage(`9Router: created API key "${key.name}" (${maskKey(key.key)}).`);
    return apiKeys.labelOf(key.id);
  };

  const useForCopilot = async (label: string): Promise<void> => {
    await setCopilotApiKeyLabel(label);
    const key = apiKeys.getLabeledKeys().get(label);
    if (key && !key.isActive) {
      const choice = await vscode.window.showWarningMessage(
        `9Router: key "${label}" is disabled on the server. Enable it?`,
        'Enable'
      );
      if (choice === 'Enable') {
        await apiKeys.setActive(key.id, true);
      }
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('9router.signIn', run(() => connection.signInInteractive())),
    vscode.commands.registerCommand('9router.signOut', run(() => connection.signOut())),
    vscode.commands.registerCommand('9router.testConnection', run(() => connection.testConnection())),
    vscode.commands.registerCommand('9router.showOutput', () => output.show()),
    vscode.commands.registerCommand('9router.openSettings', () => openSettings(`@ext:${EXTENSION_ID}`)),
    vscode.commands.registerCommand('9router.openApiKeySettings', () => openSettings('9router.apiKeys')),
    vscode.commands.registerCommand(
      '9router.syncTokenSaver',
      run(async () => {
        await apiKeys.refresh();
        await tokenSaver.pull({ notify: true });
      })
    ),
    vscode.commands.registerCommand('9router.refreshApiKeys', run(() => apiKeys.refresh({ notify: true }))),
    vscode.commands.registerCommand('9router.createApiKey', run(() => createKeyFlow())),
    vscode.commands.registerCommand('9router.refreshCopilotModels', () => {
      copilot.refreshModels();
      void vscode.window.showInformationMessage('9Router: Copilot model list refreshed.');
    }),

    vscode.commands.registerCommand(
      '9router.copyApiKey',
      run(async () => {
        if (!(await requireConnected())) {
          return;
        }
        await apiKeys.refresh();
        const items = [...apiKeys.getLabeledKeys()].map(([label, k]) => ({
          label,
          description: `${maskKey(k.key)}${k.isActive ? '' : ' · disabled'}`,
          value: k.key,
        }));
        if (items.length === 0) {
          void vscode.window.showInformationMessage('9Router: no API keys on the server yet.');
          return;
        }
        const picked = await vscode.window.showQuickPick(items, { title: '9Router: Copy API Key' });
        if (picked) {
          await vscode.env.clipboard.writeText(picked.value);
          void vscode.window.showInformationMessage(`9Router: copied key "${picked.label}".`);
        }
      })
    ),

    vscode.commands.registerCommand(
      '9router.pickCopilotApiKey',
      run(async () => {
        if (!(await requireConnected())) {
          return;
        }
        await apiKeys.refresh();
        const current = getCopilotApiKeyLabel();
        type Pick = vscode.QuickPickItem & { value?: string; action?: 'create' };
        const items: Pick[] = [...apiKeys.getLabeledKeys()].map(([label, k]) => ({
          label: `${label === current ? '$(check) ' : ''}${label}`,
          description: maskKey(k.key),
          detail: k.isActive ? undefined : '$(circle-slash) disabled on server',
          value: label,
        }));
        items.push(
          { label: '', kind: vscode.QuickPickItemKind.Separator },
          { label: '$(add) Create new API key…', action: 'create' }
        );
        const picked = await vscode.window.showQuickPick(items, {
          title: '9Router: API key for Copilot',
          placeHolder: 'Select the 9Router API key Copilot should use',
        });
        if (!picked) {
          return;
        }
        const label = picked.action === 'create' ? await createKeyFlow() : picked.value;
        if (label) {
          await useForCopilot(label);
        }
      })
    ),

    vscode.commands.registerCommand('9router.showMenu', async () => {
      type Item = vscode.QuickPickItem & { command: string };
      const items: Item[] = connection.isConnected()
        ? [
            { label: '$(pulse) Show Quota Tracker', command: '9router.openQuotaTracker' },
            { label: '$(key) API Keys Settings', command: '9router.openApiKeySettings' },
            { label: '$(copilot) Pick API Key for Copilot', command: '9router.pickCopilotApiKey' },
            { label: '$(copy) Copy API Key', command: '9router.copyApiKey' },
            { label: '$(sync) Sync From Server', command: '9router.syncTokenSaver' },
            { label: '$(refresh) Refresh Copilot Models', command: '9router.refreshCopilotModels' },
            { label: '$(plug) Test Connection', command: '9router.testConnection' },
            { label: '$(gear) Open Settings', command: '9router.openSettings' },
            { label: '$(output) Show Output Log', command: '9router.showOutput' },
            { label: '$(sign-out) Sign Out', command: '9router.signOut' },
          ]
        : [
            { label: '$(sign-in) Sign In', command: '9router.signIn' },
            { label: '$(plug) Test Connection', command: '9router.testConnection' },
            { label: '$(gear) Open Settings', command: '9router.openSettings' },
            { label: '$(output) Show Output Log', command: '9router.showOutput' },
          ];
      const picked = await vscode.window.showQuickPick(items, { title: '9Router' });
      if (picked) {
        await vscode.commands.executeCommand(picked.command);
      }
    })
  );
}
