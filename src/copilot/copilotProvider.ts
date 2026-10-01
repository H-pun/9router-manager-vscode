/**
 * Exposes 9Router models to GitHub Copilot Chat via
 * `vscode.lm.registerLanguageModelChatProvider`. Credentials come from the
 * dashboard connection: base URL = `<serverUrl>/v1`, bearer = the 9Router API
 * key named in `9router.copilot.apiKey`.
 *
 * The request pipeline (message conversion, token budgeting, streaming, tool
 * calls, inline completions) is ported from 9router-for-github-copilot (MIT).
 */
import * as vscode from 'vscode';
import { GatewayClient } from './api/client';
import { GatewayConfig } from './config/gatewayConfig';
import { ModelDiscovery } from './discovery/types';
import { estimateTextTokens } from './chat/tokenBudget';
import { diagnoseModelFetchError } from './chat/errorDiagnostics';
import { InlineCompletionBackend } from './completions/inlineCompletionProvider';
import { ModelCatalog } from './provider/modelCatalog';
import { ChatRequestHandler } from './provider/chatRequestHandler';
import { InlineCompletionService } from './provider/inlineCompletionService';
import { countMessageTokens } from './provider/vscodeParts';
import {
  COPILOT_SECTION,
  MODEL_AFFECTING_KEYS,
  isCopilotEnabled,
  loadGatewayConfig,
} from './copilotConfig';

export const COPILOT_VENDOR = '9router-extension';

/** 9Router is not Ollama; skip native model discovery entirely. */
const noDiscovery: ModelDiscovery = {
  reset: () => undefined,
  enrichModel: async () => undefined,
};

export interface CopilotCredentials {
  /** `<serverUrl>/v1`, or undefined when not configured. */
  baseUrl: string | undefined;
  /** Bearer API key, or undefined when none selected. */
  apiKey: string | undefined;
}

export class CopilotProvider implements vscode.LanguageModelChatProvider, InlineCompletionBackend {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeLanguageModelChatInformation = this._onDidChange.event;

  private config: GatewayConfig;
  private credentials: CopilotCredentials = { baseUrl: undefined, apiKey: undefined };
  private readonly client: GatewayClient;
  private readonly catalog: ModelCatalog;
  private readonly chatHandler: ChatRequestHandler;
  private readonly inline: InlineCompletionService;
  private lastErrorShown?: string;

  constructor(private readonly log: (message: string) => void, private readonly showOutput: () => void) {
    this.config = loadGatewayConfig(undefined, undefined, log);
    const prefixed = (msg: string) => log(`[copilot] ${msg}`);
    this.client = new GatewayClient(this.config, prefixed);
    this.catalog = new ModelCatalog({
      client: this.client,
      discovery: noDiscovery,
      getConfig: () => this.config,
      log: prefixed,
      onStatusChanged: () => undefined,
    });
    this.chatHandler = new ChatRequestHandler({
      client: this.client,
      catalog: this.catalog,
      getConfig: () => this.config,
      log: prefixed,
      onRequestState: () => undefined,
      onCompleted: () => undefined,
      showOutput: () => this.showOutput(),
    });
    this.inline = new InlineCompletionService({
      client: this.client,
      getConfig: () => this.config,
      getDefaultModelId: () => this.catalog.getCachedModels()[0]?.id,
      log: prefixed,
    });
  }

  /** React to `9router.copilot.*` changes. */
  public onConfigurationChanged(e: vscode.ConfigurationChangeEvent): void {
    if (!e.affectsConfiguration(COPILOT_SECTION)) {
      return;
    }
    this.reloadConfig();
    if (MODEL_AFFECTING_KEYS.some((key) => e.affectsConfiguration(key))) {
      this.refreshModels();
    }
  }

  /** Update base URL / API key (from the dashboard connection). */
  public setCredentials(next: CopilotCredentials): void {
    if (next.baseUrl === this.credentials.baseUrl && next.apiKey === this.credentials.apiKey) {
      return;
    }
    this.credentials = next;
    this.reloadConfig();
    this.catalog.clearLearnedContexts();
    this.refreshModels();
  }

  public refreshModels(): void {
    this.catalog.invalidateCache();
    this.lastErrorShown = undefined;
    this._onDidChange.fire();
  }

  public getCachedModelIds(): string[] {
    return this.catalog.getCachedModels().map((m) => m.id);
  }

  public hasCredentials(): boolean {
    return !!this.credentials.baseUrl && !!this.credentials.apiKey;
  }

  private reloadConfig(): void {
    this.config = loadGatewayConfig(this.credentials.baseUrl, this.credentials.apiKey, this.log);
    this.client.updateConfig(this.config);
    this.inline.resetSuffixProbe();
  }

  async provideLanguageModelChatInformation(
    options: { silent: boolean },
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelChatInformation[]> {
    if (!isCopilotEnabled() || !this.hasCredentials()) {
      if (!options.silent && isCopilotEnabled()) {
        void this.promptSetup();
      }
      return [];
    }
    const outcome = await this.catalog.getOrFetchModels(token);
    if (outcome.error) {
      this.log(`[copilot] Model fetch failed: ${outcome.error}`);
      if (!options.silent && this.lastErrorShown !== outcome.error) {
        this.lastErrorShown = outcome.error;
        void vscode.window
          .showErrorMessage(
            `9Router: Failed to load models. ${diagnoseModelFetchError(outcome.error)}`,
            'Pick API Key',
            'Show Log'
          )
          .then((choice) => {
            if (choice === 'Pick API Key') {
              void vscode.commands.executeCommand('9router.pickCopilotApiKey');
            } else if (choice === 'Show Log') {
              this.showOutput();
            }
          });
      }
    }
    return outcome.models.map((m) => ({ ...m, detail: '9Router' }));
  }

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    if (!this.hasCredentials()) {
      throw new Error('9Router: not connected. Sign in and pick an API key for Copilot.');
    }
    return this.chatHandler.handle(model, messages, options, progress, token);
  }

  async provideTokenCount(
    _model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatMessage,
    _token: vscode.CancellationToken
  ): Promise<number> {
    return typeof text === 'string' ? estimateTextTokens(text) : countMessageTokens(text);
  }

  // ── InlineCompletionBackend ──────────────────────────────────────────────

  public isInlineCompletionEnabled(): boolean {
    return isCopilotEnabled() && this.config.enableInlineCompletion && this.hasCredentials();
  }

  public getInlineCompletionDebounceMs(): number {
    return this.config.inlineCompletionDebounce;
  }

  public provideInlineCompletion(
    textBefore: string,
    textAfter: string,
    token: vscode.CancellationToken
  ): Promise<string | undefined> {
    return this.inline.provideCompletion(textBefore, textAfter, token);
  }

  private async promptSetup(): Promise<void> {
    const choice = await vscode.window.showInformationMessage(
      '9Router: sign in to the dashboard and pick an API key to use 9Router models in Copilot.',
      'Pick API Key',
      'Sign In'
    );
    if (choice === 'Pick API Key') {
      await vscode.commands.executeCommand('9router.pickCopilotApiKey');
    } else if (choice === 'Sign In') {
      await vscode.commands.executeCommand('9router.signIn');
    }
  }

  public dispose(): void {
    this._onDidChange.dispose();
  }
}
