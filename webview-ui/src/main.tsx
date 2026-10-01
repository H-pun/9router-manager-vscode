import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { QuotaApp } from './quota/QuotaApp';
import './quota/quota.css';

// React Flow + Recharts are only needed by the Usage view; load lazily so
// the Quota Tracker stays light.
const UsageApp = lazy(() => import('./usage/UsageApp').then((m) => ({ default: m.UsageApp })));

const view = document.body.dataset.view ?? 'quota';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {view === 'usage' ? (
      <Suspense fallback={<div className="empty-msg">Loading…</div>}>
        <UsageApp />
      </Suspense>
    ) : (
      <QuotaApp />
    )}
  </StrictMode>
);
