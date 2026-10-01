/**
 * Mapping between VS Code settings under `9router.tokenSaver.*` and the
 * 9Router server settings fields (`PATCH /api/settings`). Pure — no `vscode`.
 */
import { ServerSettings } from '../dashboard/types';

export type TokenSaverValue = boolean | string;

export interface TokenSaverField {
  /** Setting key relative to the `9router.tokenSaver` section. */
  setting: string;
  /** Field name in the server settings object. */
  server: keyof ServerSettings & string;
  type: 'boolean' | 'string';
  /** Server-side default when the field is missing. */
  default: TokenSaverValue;
  /** Allowed values for string fields. */
  allowed?: readonly string[];
}

export const CAVEMAN_LEVELS = ['lite', 'full', 'ultra', 'wenyan-lite', 'wenyan', 'wenyan-ultra'] as const;
export const PONYTAIL_LEVELS = ['lite', 'full', 'ultra'] as const;

export const TOKEN_SAVER_FIELDS: readonly TokenSaverField[] = [
  { setting: 'rtk', server: 'rtkEnabled', type: 'boolean', default: true },
  { setting: 'caveman', server: 'cavemanEnabled', type: 'boolean', default: false },
  { setting: 'cavemanLevel', server: 'cavemanLevel', type: 'string', default: 'full', allowed: CAVEMAN_LEVELS },
  { setting: 'ponytail', server: 'ponytailEnabled', type: 'boolean', default: false },
  { setting: 'ponytailLevel', server: 'ponytailLevel', type: 'string', default: 'full', allowed: PONYTAIL_LEVELS },
  { setting: 'headroom', server: 'headroomEnabled', type: 'boolean', default: false },
  { setting: 'headroomUrl', server: 'headroomUrl', type: 'string', default: 'http://localhost:8787' },
  { setting: 'pxpipe', server: 'pxpipeEnabled', type: 'boolean', default: false },
];

export type TokenSaverValues = Record<string, TokenSaverValue>;

function coerce(field: TokenSaverField, value: unknown): TokenSaverValue {
  if (field.type === 'boolean') {
    return typeof value === 'boolean' ? value : (field.default as boolean);
  }
  if (typeof value !== 'string') {
    return field.default;
  }
  if (field.allowed && !field.allowed.includes(value)) {
    return field.default;
  }
  return value;
}

/** Server settings → values keyed by setting name. */
export function fromServer(settings: ServerSettings): TokenSaverValues {
  const out: TokenSaverValues = {};
  for (const field of TOKEN_SAVER_FIELDS) {
    out[field.setting] = coerce(field, settings[field.server]);
  }
  return out;
}

/**
 * Build a server PATCH from local values, containing only fields whose value
 * differs from `serverValues`. Returns `undefined` when nothing differs.
 */
export function diffToServerPatch(
  local: TokenSaverValues,
  serverValues: TokenSaverValues
): Partial<ServerSettings> | undefined {
  const patch: Record<string, TokenSaverValue> = {};
  for (const field of TOKEN_SAVER_FIELDS) {
    const value = local[field.setting];
    if (value === undefined) {
      continue;
    }
    const normalized = coerce(field, value);
    if (normalized !== serverValues[field.setting]) {
      patch[field.server] = normalized;
    }
  }
  return Object.keys(patch).length > 0 ? (patch as Partial<ServerSettings>) : undefined;
}

/** Setting names whose local value differs from the server value. */
export function changedSettings(local: TokenSaverValues, serverValues: TokenSaverValues): string[] {
  return TOKEN_SAVER_FIELDS.filter((f) => local[f.setting] !== serverValues[f.setting]).map(
    (f) => f.setting
  );
}
