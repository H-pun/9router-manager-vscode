/**
 * Mapping between the `9router.apiKeys.keys` setting and server API keys.
 *
 * The setting is an object `{ [label]: boolean }` where the label is the key
 * name and the value is whether the key is active. VS Code renders it as a
 * native key/value list in the Settings editor (add / edit / remove items).
 *
 * Pure — no `vscode` imports.
 */
import { ApiKey } from '../dashboard/types';

export type ApiKeysSetting = Record<string, boolean>;

/**
 * Deterministic unique labels for server keys. Names are not unique on the
 * server, so duplicates get a short id suffix: `name [abcd1234]`.
 */
export function buildLabels(keys: readonly ApiKey[]): Map<string, ApiKey> {
  const counts = new Map<string, number>();
  for (const k of keys) {
    const name = baseName(k);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const out = new Map<string, ApiKey>();
  for (const k of keys) {
    const name = baseName(k);
    const label = (counts.get(name) ?? 0) > 1 ? `${name} [${k.id.slice(0, 8)}]` : name;
    out.set(label, k);
  }
  return out;
}

function baseName(k: ApiKey): string {
  return (k.name || '').trim() || k.id;
}

export function toSettingValue(labels: ReadonlyMap<string, ApiKey>): ApiKeysSetting {
  const out: ApiKeysSetting = {};
  for (const [label, key] of labels) {
    out[label] = key.isActive;
  }
  return out;
}

export interface ApiKeysDiff {
  /** Names to create on the server, with their desired active state. */
  create: Array<{ name: string; active: boolean }>;
  /** Server keys whose entry was removed from the setting. */
  remove: Array<{ label: string; key: ApiKey }>;
  /** Server keys whose active flag changed. */
  toggle: Array<{ label: string; key: ApiKey; active: boolean }>;
}

export function isEmptyDiff(diff: ApiKeysDiff): boolean {
  return diff.create.length === 0 && diff.remove.length === 0 && diff.toggle.length === 0;
}

/** Compare the local setting against the server state. */
export function diffApiKeys(local: ApiKeysSetting, labels: ReadonlyMap<string, ApiKey>): ApiKeysDiff {
  const diff: ApiKeysDiff = { create: [], remove: [], toggle: [] };
  for (const [rawLabel, rawValue] of Object.entries(local)) {
    const label = rawLabel.trim();
    if (!label) {
      continue;
    }
    const active = rawValue !== false;
    const existing = labels.get(label);
    if (!existing) {
      diff.create.push({ name: label, active });
    } else if (existing.isActive !== active) {
      diff.toggle.push({ label, key: existing, active });
    }
  }
  const localLabels = new Set(Object.keys(local).map((l) => l.trim()));
  for (const [label, key] of labels) {
    if (!localLabels.has(label)) {
      diff.remove.push({ label, key });
    }
  }
  return diff;
}

export function settingsEqual(a: ApiKeysSetting, b: ApiKeysSetting): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  return ak.length === bk.length && ak.every((k) => b[k] === a[k]);
}
