/**
 * The e2e screen harness: mounts one trade-room screen the way Task 22's TradeRoom will, before
 * TradeRoom is on the main line (TRIPWIRE NEEDS_TASK_22 in test/refund-tripwires.test.ts; once it
 * lands, refund.spec.ts drives /trade/:code and this harness goes).
 *
 * `/?screen=seller-refund|final-alert&code=<trade code>`: reads GET /v1/trades/:code (stubbed by
 * the spec with page.route), re-reads it on `refresh()`, and passes the server clock from
 * `serverNow`. The escrow is Task 12's real `useEscrow(code)` over a recorder `EscrowClient`
 * (`setEscrowClient`, as the hook's tests do) instead of the worker: each action is pushed to
 * `window.__escrowCalls` by the runtime's action names (`signal:<type>`, `build-refund`), and
 * `&escrow=fail` makes every action fail until the spec sets `window.__escrowFail = false` (the
 * relay is back). FinalAlert's paid sheet is a labelled stand-in dialog.
 * Built from this folder only (vite.config.ts), never part of the app's `dist`.
 */
import { StrictMode, useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import '../../src/theme/fonts.css';
import '../../src/theme/tokens.css';
import '../../src/theme/base.css';
import { api, serverClock } from '../../src/api/client.js';
import type { EscrowStatus } from '../../src/escrow/runtime.js';
import { setEscrowClient, useEscrow } from '../../src/escrow/useEscrow.js';
import { FinalAlert, setFinalAlertPaidSheet } from '../../src/screens/trade/FinalAlert.js';
import type { RefundView } from '../../src/screens/trade/refundSlot.js';
import { SellerRefund } from '../../src/screens/trade/SellerRefund.js';
import { sellerView } from './refundViews.js';

declare global {
  interface Window {
    __escrowCalls?: string[];
    __escrowFail?: boolean;
  }
}

const q = new URLSearchParams(window.location.search);
const screen = q.get('screen');
const code = q.get('code') ?? '';

window.__escrowCalls = [];
window.__escrowFail = q.get('escrow') === 'fail';
// The device's status for the board's trade: ready, with the board's amount as the accepted one.
const board = sellerView();
const READY: EscrowStatus = {
  phase: 'ready',
  error: null,
  retryable: false,
  refusal: null,
  checkWords: null,
  keepOpen: true,
  role: screen === 'final-alert' ? 'buyer' : 'seller',
  amountAtomic: BigInt(board.amountAtomic),
  fiatCents: BigInt(board.fiatCents),
  escrowAddress: null,
  deal: null,
  receivedAtomic: null,
  confirmedAtomic: null,
};
const subscribers = new Set<(s: EscrowStatus) => void>();
setEscrowClient({
  start: () => {
    for (const cb of subscribers) cb(READY);
  },
  act: async (_code, a) => {
    window.__escrowCalls?.push(a.type === 'signal' ? `signal:${a.signal}` : a.type);
    if (window.__escrowFail) throw new Error('escrow action refused');
  },
  retry: () => undefined,
  subscribe: (_code, cb) => {
    subscribers.add(cb);
    cb(READY);
    return () => subscribers.delete(cb);
  },
});

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
  const escrow = useEscrow(code);
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
