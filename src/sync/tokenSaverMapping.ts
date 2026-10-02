/**
 * Mapping between VS Code settings under `9router.tokenSaver.*` and the
 * 9Router server settings fields (`PATCH /api/settings`). Pure — no `vscode`.
 */
import { ServerSettings } from '../dashboard/types';

export type TokenSaverValue = boolean | string;

type ServerKey = keyof ServerSettings & string;

interface SimpleField {
  /** Setting key relative to the `9router.tokenSaver` section. */
  setting: string;
  type: 'boolean' | 'string';
  /** Field name in the server settings object. */
  server: ServerKey;
  /** Server-side default when the field is missing. */
  default: TokenSaverValue;
}

/**
 * One VS Code setting (`'off'` or a level) backed by two server fields:
 * an enabled flag and a level.
 */
interface LevelField {
  setting: string;
  type: 'level';
  enabledServer: ServerKey;
  levelServer: ServerKey;
  levels: readonly string[];
  defaultLevel: string;
}

export type TokenSaverField = SimpleField | LevelField;

export const OFF = 'off';
/** Matches the web dashboard (wenyan levels are only shown for zh locales there). */
export const CAVEMAN_LEVELS = ['lite', 'full', 'ultra'] as const;
export const PONYTAIL_LEVELS = ['lite', 'full', 'ultra'] as const;

export const TOKEN_SAVER_FIELDS: readonly TokenSaverField[] = [
  { setting: 'rtk', server: 'rtkEnabled', type: 'boolean', default: true },
  {
    setting: 'caveman',
    type: 'level',
    enabledServer: 'cavemanEnabled',
    levelServer: 'cavemanLevel',
    levels: CAVEMAN_LEVELS,
    defaultLevel: 'full',
  },
  {
    setting: 'ponytail',
    type: 'level',
    enabledServer: 'ponytailEnabled',
    levelServer: 'ponytailLevel',
    levels: PONYTAIL_LEVELS,
    defaultLevel: 'full',
  },
  { setting: 'headroom', server: 'headroomEnabled', type: 'boolean', default: false },
  { setting: 'headroomUrl', server: 'headroomUrl', type: 'string', default: 'http://localhost:8787' },
  { setting: 'pxpipe', server: 'pxpipeEnabled', type: 'boolean', default: false },
];

export type TokenSaverValues = Record<string, TokenSaverValue>;

function coerceLevel(field: LevelField, value: unknown): string {
  if (value === OFF || value === false) {
    return OFF;
  }
  if (typeof value === 'string' && field.levels.includes(value)) {
    return value;
  }
  // Legacy boolean `true` or unknown level.
  return field.defaultLevel;
}

function coerce(field: TokenSaverField, value: unknown): TokenSaverValue {
  if (field.type === 'level') {
    return coerceLevel(field, value);
  }
  if (field.type === 'boolean') {
    return typeof value === 'boolean' ? value : (field.default as boolean);
  }
  return typeof value === 'string' ? value : field.default;
}

/** Server settings → values keyed by setting name. */
export function fromServer(settings: ServerSettings): TokenSaverValues {
  const out: TokenSaverValues = {};
  for (const field of TOKEN_SAVER_FIELDS) {
    if (field.type === 'level') {
      out[field.setting] =
        settings[field.enabledServer] === true ? coerceLevel(field, settings[field.levelServer]) : OFF;
    } else {
      out[field.setting] = coerce(field, settings[field.server]);
    }
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
    const current = serverValues[field.setting];
    if (normalized === current) {
      continue;
    }
    if (field.type !== 'level') {
      patch[field.server] = normalized;
    } else if (normalized === OFF) {
      // Keep the server-side level untouched when turning off.
      patch[field.enabledServer] = false;
    } else {
      if (current === OFF) {
        patch[field.enabledServer] = true;
      }
      patch[field.levelServer] = normalized;
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
