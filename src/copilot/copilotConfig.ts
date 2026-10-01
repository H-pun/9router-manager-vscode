import * as vscode from 'vscode';
import { GatewayConfig } from './config/gatewayConfig';
import { TOKEN_CONSTANTS } from './chat/tokenBudget';
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  FALLBACK_SERVER_URL,
  validateGatewayConfig,
} from './provider/configValidation';

export const COPILOT_SECTION = '9router.copilot';

/** Settings under `9router.copilot` that change the exposed model list. */
export const MODEL_AFFECTING_KEYS: readonly string[] = [
  'enabled',
  'requestTimeout',
  'defaultMaxTokens',
  'defaultMaxOutputTokens',
  'enableImageInput',
  'enableToolCalling',
  'modelContextWindows',
].map((k) => `${COPILOT_SECTION}.${k}`);

export function isCopilotEnabled(): boolean {
  return vscode.workspace.getConfiguration(COPILOT_SECTION).get<boolean>('enabled', true);
}

/** Label (name) of the 9Router API key Copilot uses, from `9router.copilot.apiKey`. */
export function getCopilotApiKeyLabel(): string {
  return vscode.workspace.getConfiguration(COPILOT_SECTION).get<string>('apiKey', '').trim();
}

export async function setCopilotApiKeyLabel(label: string): Promise<void> {
  await vscode.workspace
    .getConfiguration(COPILOT_SECTION)
    .update('apiKey', label, vscode.ConfigurationTarget.Global);
}

/**
 * Build the gateway config consumed by the ported Copilot pipeline from the
 * `9router.copilot.*` settings plus the dashboard-derived base URL and key.
 */
export function loadGatewayConfig(
  openAiBaseUrl: string | undefined,
  apiKey: string | undefined,
  log: (message: string) => void
): GatewayConfig {
  const c = vscode.workspace.getConfiguration(COPILOT_SECTION);
  const raw: GatewayConfig = {
    serverUrl: openAiBaseUrl ?? FALLBACK_SERVER_URL,
    apiKey: apiKey ?? '',
    requestTimeout: c.get<number>('requestTimeout', DEFAULT_REQUEST_TIMEOUT_MS),
    defaultMaxTokens: c.get<number>('defaultMaxTokens', TOKEN_CONSTANTS.DEFAULT_CONTEXT_TOKENS),
    defaultMaxOutputTokens: c.get<number>('defaultMaxOutputTokens', TOKEN_CONSTANTS.FALLBACK_OUTPUT_TOKENS),
    enableImageInput: c.get<boolean>('enableImageInput', true),
    enableToolCalling: c.get<boolean>('enableToolCalling', true),
    parallelToolCalling: c.get<boolean>('parallelToolCalling', true),
    agentTemperature: c.get<number>('agentTemperature', 0),
    verboseLogging: c.get<boolean>('verboseLogging', false),
    customHeaders: {},
    extraModelOptions: c.get<Record<string, unknown>>('extraModelOptions', {}) ?? {},
    perModelOptions: c.get<Record<string, unknown>>('perModelOptions', {}) ?? {},
    modelContextWindows: c.get<Record<string, number>>('modelContextWindows', {}) ?? {},
    enableInlineCompletion: c.get<boolean>('inlineCompletion.enabled', false),
    inlineCompletionModel: c.get<string>('inlineCompletion.model', ''),
    inlineCompletionMaxTokens: c.get<number>('inlineCompletion.maxTokens', 256),
    inlineCompletionDebounce: c.get<number>('inlineCompletion.debounce', 300),
    inlineCompletionTimeout: c.get<number>('inlineCompletion.timeout', 3000),
    inlineCompletionMaxPrefixChars: c.get<number>('inlineCompletion.maxPrefixChars', 4000),
    inlineCompletionMaxSuffixChars: c.get<number>('inlineCompletion.maxSuffixChars', 1000),
  };
  const { config, issues } = validateGatewayConfig(raw);
  for (const issue of issues) {
    log(`Copilot config adjusted: ${JSON.stringify(issue)}`);
  }
  return config;
}
