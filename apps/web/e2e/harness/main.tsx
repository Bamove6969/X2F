/**
 * The e2e screen harness: mounts one trade-room screen the way Task 22's TradeRoom will, before
 * TradeRoom is on the main line (TRIPWIRE NEEDS_TASK_22 in test/refund-tripwires.test.ts; once it
 * lands, refund.spec.ts drives /trade/:code and this harness goes).
 *
 * `/?screen=seller-refund|final-alert&code=<trade code>`: reads GET /v1/trades/:code (stubbed by
 * the spec with page.route), re-reads it on `refresh()`, and passes the server clock from
 * `serverNow`. The escrow is a recorder: each call is pushed to `window.__escrowCalls`, and
 * `&escrow=fail` makes every call fail. FinalAlert's paid sheet is a labelled stand-in dialog.
 * Built from this folder only (vite.config.ts), never part of the app's `dist`.
 */
import { StrictMode, useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import '../../src/theme/fonts.css';
import '../../src/theme/tokens.css';
import '../../src/theme/base.css';
import { api, serverClock } from '../../src/api/client.js';
import { FinalAlert, setFinalAlertPaidSheet } from '../../src/screens/trade/FinalAlert.js';
import type { RefundEscrow, RefundView } from '../../src/screens/trade/refundSlot.js';
import { SellerRefund } from '../../src/screens/trade/SellerRefund.js';

declare global {
  interface Window {
    __escrowCalls?: string[];
  }
}

const q = new URLSearchParams(window.location.search);
const screen = q.get('screen');
const code = q.get('code') ?? '';
const failing = q.get('escrow') === 'fail';

window.__escrowCalls = [];
const record = async (call: string): Promise<void> => {
  window.__escrowCalls?.push(call);
  if (failing) throw new Error('escrow refused');
};
const escrow: RefundEscrow = {
  signal: (s) => record(`signal:${s}`),
  buildRefund: () => record('build-refund'),
};

setFinalAlertPaidSheet(({ open, onClose }) =>
  open ? (
    <div role="dialog" aria-label="Paid sheet stand-in">
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  ) : null,
);

function Harness() {
  const [view, setView] = useState<RefundView | null>(null);
  const refresh = useCallback(async () => {
    setView(await api<RefundView>(`/v1/trades/${encodeURIComponent(code)}`));
  }, []);
  useEffect(() => void refresh(), [refresh]);
  const clock = useMemo(() => (view ? serverClock(view.serverNow) : () => new Date()), [view?.serverNow]);
  if (!view) return <main data-screen="trade" aria-busy="true" />;
  const props = { view, escrow, refresh, serverClock: clock, wide: window.matchMedia('(min-width: 1024px)').matches };
  return <main data-screen="trade">{screen === 'final-alert' ? <FinalAlert {...props} /> : <SellerRefund {...props} />}</main>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Harness />
    </BrowserRouter>
  </StrictMode>,
);
