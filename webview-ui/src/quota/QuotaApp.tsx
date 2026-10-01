/**
 * Quota Tracker sidebar — React port of the 9router-vscode monitor design:
 *   provider header (logo, name, "N accounts • M active")
 *   └ account row (chevron, name, #priority, refresh, test, toggle switch)
 *     └ model rows (status icon, name, pct, (used/total) | countdown)
 */
import { useEffect, useMemo, useState } from 'react';
import type {
  HostToWebview,
  QuotaAccount,
  QuotaProviderGroup,
  QuotaRow,
  QuotaViewState,
} from '../../../src/quota/protocol';
import { formatCount, formatCountdown, statusIcon, toneFor } from '../format';
import { post } from '../vscode';

export function QuotaApp() {
  const [state, setState] = useState<QuotaViewState | undefined>();
  const [groupCollapsed, setGroupCollapsed] = useState<Record<string, boolean>>({});
  const [accountOpen, setAccountOpen] = useState<Record<string, boolean>>({});
  const now = useNow(30_000);

  useEffect(() => {
    const onMessage = (event: MessageEvent<HostToWebview>) => {
      if (event.data?.type === 'state') {
        setState(event.data.state);
      }
    };
    window.addEventListener('message', onMessage);
    post({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const groups = useMemo(() => (state ? filterGroups(state) : []), [state]);

  if (!state) {
    return <div className="empty-msg">Loading…</div>;
  }
  if (state.connection === 'signedOut') {
    return (
      <Banner
        icon="lock"
        iconTone="orange"
        title="Authentication Required"
        desc="Sign in to access 9Router quota tracker & telemetry."
        serverUrl={state.serverUrl}
        primary={{ icon: 'sign-in', label: 'Sign In to 9Router', onClick: () => post({ type: 'signIn' }) }}
        secondary={{ icon: 'settings-gear', label: 'Configure Settings', onClick: () => post({ type: 'openSettings' }) }}
      />
    );
  }
  if (state.connection === 'error') {
    return (
      <Banner
        icon="plug"
        iconTone="red"
        title="Server Unreachable"
        desc={state.connectionMessage || 'Cannot connect to 9Router server. Make sure 9Router is running or check server URL.'}
        serverUrl={state.serverUrl}
        primary={{ icon: 'sign-in', label: 'Sign In / Reconnect', onClick: () => post({ type: 'signIn' }) }}
        secondary={{ icon: 'globe', label: 'Open Web Dashboard', onClick: () => post({ type: 'openDashboard' }) }}
      />
    );
  }
  if (state.connection === 'connecting') {
    return (
      <div className="empty-msg">
        <i className="codicon codicon-loading codicon-modifier-spin" /> Connecting to 9Router…
      </div>
    );
  }

  if (state.listError) {
    return <div className="empty-msg error">{state.listError}</div>;
  }
  if (state.loadingList && state.groups.length === 0) {
    return (
      <div className="empty-msg">
        <i className="codicon codicon-loading codicon-modifier-spin" /> Loading accounts…
      </div>
    );
  }
  if (groups.length === 0) {
    return (
      <div className="empty-msg">
        {state.groups.length === 0
          ? 'No quota-capable accounts on this server.'
          : `No accounts found for selected filter (${state.filter}).`}
      </div>
    );
  }

  return (
    <div id="tree-root">
      {groups.map((group) => (
        <ProviderGroup
          key={group.provider}
          group={group}
          now={now}
          collapsed={!!groupCollapsed[group.provider]}
          onToggle={() => setGroupCollapsed((m) => ({ ...m, [group.provider]: !m[group.provider] }))}
          isAccountOpen={(a) => accountOpen[a.id] ?? a.isActive}
          onToggleAccount={(a) => setAccountOpen((m) => ({ ...m, [a.id]: !(m[a.id] ?? a.isActive) }))}
        />
      ))}
    </div>
  );
}

function ProviderGroup({
  group,
  now,
  collapsed,
  onToggle,
  isAccountOpen,
  onToggleAccount,
}: {
  group: QuotaProviderGroup;
  now: number;
  collapsed: boolean;
  onToggle: () => void;
  isAccountOpen: (a: QuotaAccount) => boolean;
  onToggleAccount: (a: QuotaAccount) => void;
}) {
  const active = group.accounts.filter((a) => a.isActive).length;
  return (
    <div className="provider-group">
      <div className="provider-header" onClick={onToggle}>
        <div className="provider-left">
          <i className={`codicon ${collapsed ? 'codicon-chevron-right' : 'codicon-chevron-down'}`} />
          {group.iconUri ? (
            <img className="provider-logo-img" src={group.iconUri} alt="" />
          ) : (
            <i className="codicon codicon-hubot" />
          )}
          <span className="provider-title">{group.displayName}</span>
        </div>
        <div className="provider-right">
          <span className="count-badge">
            {group.accounts.length} accounts{active > 0 ? ` • ${active} active` : ''}
          </span>
        </div>
      </div>
      {!collapsed && (
        <div className="accounts-container">
          {group.accounts.map((account) => (
            <AccountItem
              key={account.id}
              account={account}
              now={now}
              open={isAccountOpen(account)}
              onToggleOpen={() => onToggleAccount(account)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AccountItem({
  account,
  now,
  open,
  onToggleOpen,
}: {
  account: QuotaAccount;
  now: number;
  open: boolean;
  onToggleOpen: () => void;
}) {
  const q = account.quota;
  const refreshing = q.status === 'loading';

  return (
    <div className="account-item">
      <div className="account-row" onClick={onToggleOpen}>
        <div className="account-left">
          <i className={`codicon ${open ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} />
          <span className="account-name" title={account.name}>
            {account.name}
          </span>
        </div>
        <div className="account-right" onClick={(e) => e.stopPropagation()}>
          {q.plan && <span className="pill-tag plan" title={q.plan}>{q.plan}</span>}
          {account.priority !== undefined && <span className="pill-tag">#{account.priority}</span>}
          <div className="account-actions">
            <button
              className="icon-btn"
              disabled={refreshing}
              title={`Refresh quota for ${account.name}`}
              onClick={() => post({ type: 'refreshAccount', id: account.id })}
            >
              <i className={`codicon ${refreshing ? 'codicon-loading codicon-modifier-spin' : 'codicon-refresh'}`} />
            </button>
            <button
              className="icon-btn"
              disabled={account.testing}
              title="Test connection"
              onClick={() => post({ type: 'testAccount', id: account.id })}
            >
              <i className={`codicon ${account.testing ? 'codicon-loading codicon-modifier-spin' : 'codicon-zap'}`} />
            </button>
            <Toggle
              active={account.isActive}
              busy={!!account.toggling}
              onChange={() => post({ type: 'toggleAccount', id: account.id, active: !account.isActive })}
            />
          </div>
        </div>
      </div>
      {open && (
        <div className="models-list">
          <ModelRows account={account} now={now} />
        </div>
      )}
    </div>
  );
}

function ModelRows({ account, now }: { account: QuotaAccount; now: number }) {
  const q = account.quota;
  const [showHidden, setShowHidden] = useState(false);
  const hidden = q.hiddenRows ?? [];
  if (q.status === 'error') {
    return (
      <div className="note error" title={q.error}>
        <i className="codicon codicon-error" /> <span>{q.error}</span>
      </div>
    );
  }
  if (q.status === 'loading' && q.rows.length === 0) {
    return (
      <div className="empty-msg">
        <i className="codicon codicon-loading codicon-modifier-spin" /> Loading quota…
      </div>
    );
  }
  if (q.status === 'idle') {
    return <div className="empty-msg">{account.isActive ? 'Not loaded yet.' : 'Turned off — quota not fetched.'}</div>;
  }
  return (
    <>
      {q.message && (
        <div className="note" title={q.message}>
          <i className="codicon codicon-info" /> <span>{q.message}</span>
        </div>
      )}
      {q.rows.length === 0 && hidden.length === 0 && !q.message && (
        <div className="empty-msg">No quotas returned for this account.</div>
      )}
      {q.rows.map((row) => (
        <ModelRow
          key={row.key}
          row={row}
          now={now}
          action={{ icon: 'eye-closed', title: 'Hide this quota row', onClick: () => post({ type: 'hideQuota', provider: account.provider, key: row.key }) }}
        />
      ))}
      {hidden.length > 0 && (
        <button className="hidden-toggle" onClick={() => setShowHidden((v) => !v)}>
          <i className={`codicon ${showHidden ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} />
          {hidden.length} hidden
        </button>
      )}
      {showHidden &&
        hidden.map((row) => (
          <ModelRow
            key={row.key}
            row={row}
            now={now}
            dimmed
            action={{ icon: 'eye', title: 'Show this quota row', onClick: () => post({ type: 'showQuota', provider: account.provider, key: row.key }) }}
          />
        ))}
    </>
  );
}

function ModelRow({
  row,
  now,
  dimmed,
  action,
}: {
  row: QuotaRow;
  now: number;
  dimmed?: boolean;
  action?: { icon: string; title: string; onClick: () => void };
}) {
  const pct = row.unlimited ? 100 : Math.min(100, Math.max(0, Math.round(row.remainingPercent ?? 0)));
  const tone = toneFor(pct);
  const ratio = row.unlimited
    ? 'Unlimited'
    : row.total > 0
      ? `${formatCount(row.used)}/${formatCount(row.total)}`
      : undefined;
  return (
    <div className={`model-row ${dimmed ? 'dimmed' : ''}`}>
      <div className="model-left">
        <i className={`codicon codicon-${statusIcon(tone)} status-icon ${tone}`} />
        <span className="model-name" title={row.name}>
          {row.name}
        </span>
      </div>
      <div className="model-right">
        <span className={`model-pct ${tone}`}>{row.remainingPercent === undefined && !row.unlimited ? '—' : `${pct}%`}</span>
        {ratio && <span className="model-ratio">({ratio})</span>}
        <span className="v-divider" />
        <span className="model-time" title={row.resetAt ? new Date(row.resetAt).toLocaleString() : undefined}>
          {formatCountdown(row.resetAt, now)}
        </span>
        {action && (
          <button className="icon-btn row-action" title={action.title} onClick={action.onClick}>
            <i className={`codicon codicon-${action.icon}`} />
          </button>
        )}
      </div>
    </div>
  );
}

function Toggle({ active, busy, onChange }: { active: boolean; busy: boolean; onChange: () => void }) {
  return (
    <div
      className={`toggle-switch-box ${busy ? 'disabled' : ''}`}
      role="switch"
      aria-checked={active}
      tabIndex={0}
      title={busy ? 'Updating…' : active ? 'Active (click to turn OFF)' : 'Idle (click to turn ON)'}
      onClick={() => !busy && onChange()}
      onKeyDown={(e) => {
        if (!busy && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onChange();
        }
      }}
    >
      <div className={`toggle-track ${active ? 'active' : ''}`}>
        <div className="toggle-thumb" />
      </div>
    </div>
  );
}

function Banner(props: {
  icon: string;
  iconTone: 'orange' | 'red';
  title: string;
  desc: string;
  serverUrl?: string;
  primary: { icon: string; label: string; onClick: () => void };
  secondary: { icon: string; label: string; onClick: () => void };
}) {
  return (
    <div className="auth-banner">
      <div className="auth-title">
        <i className={`codicon codicon-${props.icon}`} style={{ color: `var(--${props.iconTone})` }} />
        <span>{props.title}</span>
      </div>
      <div className="auth-desc">{props.desc}</div>
      <div className="auth-server-tag">{props.serverUrl || 'http://localhost:20128'}</div>
      <button className="btn-primary" onClick={props.primary.onClick}>
        <i className={`codicon codicon-${props.primary.icon}`} /> {props.primary.label}
      </button>
      <button className="btn-secondary" onClick={props.secondary.onClick}>
        <i className={`codicon codicon-${props.secondary.icon}`} /> {props.secondary.label}
      </button>
    </div>
  );
}

function filterGroups(state: QuotaViewState): QuotaProviderGroup[] {
  return state.groups
    .map((g) => ({
      ...g,
      accounts: g.accounts.filter((a) => {
        if (state.filter === 'active') {
          return a.isActive || a.toggling;
        }
        if (state.filter === 'inactive') {
          return !a.isActive || a.toggling;
        }
        return true;
      }),
    }))
    .filter((g) => g.accounts.length > 0);
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
