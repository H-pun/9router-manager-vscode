import * as vscode from 'vscode';
import { registerCommands } from './commands';
import { ConnectionManager } from './connection/connectionManager';
import { GatewayInlineCompletionProvider } from './copilot/completions/inlineCompletionProvider';
import { COPILOT_VENDOR, CopilotProvider } from './copilot/copilotProvider';
import { openAiBaseUrl } from './dashboard/http';
import { QuotaViewProvider } from './quota/quotaView';
import { QuotaService } from './quota/quotaService';
import { StatusBar } from './statusBar';
import { UsageStreamService } from './usage/usageStreamService';
import { UsageViewProvider } from './usage/usageView';
import { ApiKeysSync } from './sync/apiKeysSync';
import { TokenSaverSync } from './sync/tokenSaverSync';

const LEGACY_EXTENSION_ID = 'hotrungnhan.9router-for-github-copilot';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('9Router', { log: true });
  const log = (message: string): void => output.info(message);
  context.subscriptions.push(output);

  const connection = new ConnectionManager(context.secrets, log);
  const apiKeys = new ApiKeysSync(connection, log);
  const tokenSaver = new TokenSaverSync(connection, log);
  const copilot = new CopilotProvider(log, () => output.show());
  context.subscriptions.push(connection, apiKeys, tokenSaver, copilot, new StatusBar(connection));

  // Copilot credentials follow the dashboard connection + selected key.
  const updateCopilotCredentials = async (): Promise<void> => {
    const serverUrl = connection.getServerUrl();
    copilot.setCredentials({
      baseUrl: serverUrl ? openAiBaseUrl(serverUrl) : undefined,
      apiKey: await apiKeys.resolveCopilotKey(),
    });
  };

  context.subscriptions.push(
    vscode.lm.registerLanguageModelChatProvider(COPILOT_VENDOR, copilot),
    vscode.languages.registerInlineCompletionItemProvider(
      { pattern: '**' },
      new GatewayInlineCompletionProvider(copilot)
    ),
    vscode.workspace.onDidChangeConfiguration((e) => {
      copilot.onConfigurationChanged(e);
      if (e.affectsConfiguration('9router.copilot.apiKey') || e.affectsConfiguration('9router.connection.serverUrl')) {
        void updateCopilotCredentials();
      }
    }),
    apiKeys.onDidChange(() => void updateCopilotCredentials()),
    connection.onDidChangeState(() => void updateCopilotCredentials())
  );

  const quota = new QuotaService(connection, log);
  const quotaView = new QuotaViewProvider(context.extensionUri, quota);
  context.subscriptions.push(
    quota,
    quotaView,
    vscode.window.registerWebviewViewProvider(QuotaViewProvider.viewId, quotaView, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('9router.openQuotaTracker', () =>
      vscode.commands.executeCommand(`${QuotaViewProvider.viewId}.focus`)
    ),
    vscode.commands.registerCommand('9router.refreshQuota', () => quotaView.refresh()),
    // Spinner twin shown while refreshing (no-op click).
    vscode.commands.registerCommand('9router.refreshQuotaLoading', () => undefined),
    vscode.commands.registerCommand('9router.quota.filterActive', () => quota.setFilter('active')),
    vscode.commands.registerCommand('9router.quota.filterAll', () => quota.setFilter('all')),
    vscode.commands.registerCommand('9router.quota.filterInactive', () => quota.setFilter('inactive')),
    vscode.commands.registerCommand('9router.openDashboard', () => {
      const serverUrl = connection.getServerUrl();
      if (serverUrl) {
        void vscode.env.openExternal(vscode.Uri.parse(`${serverUrl}/dashboard`));
      }
    })
  );

  const usageStream = new UsageStreamService(connection, log);
  const usageView = new UsageViewProvider(context.extensionUri, connection, usageStream, log);
  context.subscriptions.push(
    usageStream,
    usageView,
    vscode.window.registerWebviewViewProvider(UsageViewProvider.viewId, usageView, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('9router.openUsage', () =>
      vscode.commands.executeCommand(`${UsageViewProvider.viewId}.focus`)
    ),
    vscode.commands.registerCommand('9router.refreshUsage', () => usageView.refresh())
  );

  setupPeriodicSync(context, connection, apiKeys, tokenSaver);
  registerCommands(context, { connection, apiKeys, tokenSaver, copilot, output });
  warnIfLegacyExtensionInstalled();

  void vscode.commands.executeCommand('setContext', '9router.connected', false);
  await updateCopilotCredentials();
  void connection.initialize();
}

/** Pull server state on window focus and every `syncInterval` seconds. */
function setupPeriodicSync(
  context: vscode.ExtensionContext,
  connection: ConnectionManager,
  apiKeys: ApiKeysSync,
  tokenSaver: TokenSaverSync
): void {
  let timer: ReturnType<typeof setInterval> | undefined;
  let lastSyncAt = 0;
  const MIN_FOCUS_GAP_MS = 10_000;

  const sync = (): void => {
    if (!connection.isConnected()) {
      return;
    }
    lastSyncAt = Date.now();
    void tokenSaver.pull();
    void apiKeys.refresh();
  };

  const schedule = (): void => {
    if (timer) {
      clearInterval(timer);
      timer = undefined;
    }
    const seconds = vscode.workspace.getConfiguration('9router.connection').get<number>('syncInterval', 60);
    if (seconds > 0) {
      timer = setInterval(() => {
        if (vscode.window.state.focused) {
          sync();
        }
      }, seconds * 1000);
    }
  };

  schedule();
  context.subscriptions.push(
    { dispose: () => timer && clearInterval(timer) },
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('9router.connection.syncInterval')) {
        schedule();
      }
    }),
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused && Date.now() - lastSyncAt > MIN_FOCUS_GAP_MS) {
        sync();
      }
    })
  );
}

function warnIfLegacyExtensionInstalled(): void {
  if (!vscode.extensions.getExtension(LEGACY_EXTENSION_ID)) {
    return;
  }
  void vscode.window
    .showWarningMessage(
      '9Router: "9Router for GitHub Copilot" is also installed, so 9Router models may appear twice in Copilot Chat. Consider disabling it.',
      'Show Extension'
    )
    .then((choice) => {
      if (choice === 'Show Extension') {
        void vscode.commands.executeCommand('extension.open', LEGACY_EXTENSION_ID);
      }
    });
}

export function deactivate(): void {
  // Disposables registered on the context are cleaned up by VS Code.
}
