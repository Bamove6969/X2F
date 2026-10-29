// Fixture mode: `VITE_FIXTURES=1` in a non-production build only (vite.config.ts drops it from
// production). The boards' example data is in boards.ts; each screen task answers its own API calls from it.
import { createElement, useSyncExternalStore } from 'react';
import { setFinalAlertPaidSheet } from '../screens/trade/FinalAlert.js';
import { PENDING_ESCROW, setTradeEscrowHook, type TradeEscrow } from '../screens/trade/seams.js';
import { BOARD_TRADE } from './boards.js';
import { installPayFixtures } from './payChat.js';

declare global {
  interface Window {
    /**
     * Fixture builds only: the escrow state the trade room shows in place of Task 12's runtime
     * (fixture builds have no relay, node or moderator). Playwright sets it with addInitScript;
     * see e2e/fund.spec.ts and e2e/refund.spec.ts.
     */
    __x2fFixtureEscrow?: Partial<Pick<TradeEscrow, 'phase' | 'error' | 'retryable' | 'refusal' | 'checkWords' | 'keepOpen' | 'escrowAddress'>> & {
      /** The device's deal, with the take amount as a decimal string (bigints don't cross addInitScript); currency, rate and maximum are the board trade's. */
      deal?: { poster: 'seller' | 'buyer'; takeAmountAtomic: string };
      /** What this device has seen arrive, as a decimal string; absent for no reading. */
      receivedAtomic?: string;
      /** The confirmed part of it, as a decimal string; absent for no reading. */
      confirmedAtomic?: string;
      /** The trade amount this device accepts and its fiat total, as decimal strings; absent for none. */
      amountAtomic?: string;
      fiatCents?: string;
    };
    /**
     * Fixture builds only: changes the fixture escrow's state while the page runs (a device whose
     * own figures follow a grown trade, a runtime that reports a refusal); amounts as decimal strings.
     */
    __x2fSetFixtureEscrow?: (patch: Partial<Pick<TradeEscrow, 'phase' | 'error' | 'retryable' | 'refusal' | 'keepOpen' | 'paidRecorded' | 'intentKind'>> & { amountAtomic?: string | null; fiatCents?: string | null }) => void;
    /** Fixture builds only: every escrow action the room asked for (`release`, `signal:trade.extend`, ...), in order. */
    __x2fEscrowCalls?: string[];
    /** Fixture builds only: while true, every escrow action is refused (a relay that is down). */
    __x2fEscrowFail?: boolean;
    /** Fixture builds only: FinalAlert's I've paid opens a stand-in dialog until Task 23's PaidConfirmSheet lands. */
    __x2fFixturePaidSheet?: boolean;
  }
}

const big = (v: string | undefined): bigint | null => (v === undefined ? null : BigInt(v));

export function installFixtures(): void {
  document.documentElement.dataset.fixtureMode = 'on';
  if (window.__x2fFixturePaidSheet) {
    setFinalAlertPaidSheet(({ open, onClose }) =>
      open ? createElement('div', { role: 'dialog', 'aria-label': 'Paid sheet stand-in' }, createElement('button', { type: 'button', onClick: onClose }, 'Close')) : null,
    );
  }
  installPayFixtures();
  const escrow = window.__x2fFixtureEscrow;
  if (!escrow) return;
  const { deal, receivedAtomic, confirmedAtomic, amountAtomic, fiatCents, ...rest } = escrow;
  const calls: string[] = [];
  window.__x2fEscrowCalls = calls;
  const subs = new Set<() => void>();
  const set = (patch: Partial<TradeEscrow>): void => {
    state = { ...state, ...patch };
    for (const cb of subs) cb();
  };
  const record =
    (name: string, after?: () => void) =>
    async (): Promise<void> => {
      calls.push(name);
      if (window.__x2fEscrowFail) throw new Error('escrow action refused');
      after?.();
    };
  let state: TradeEscrow = {
    ...PENDING_ESCROW,
    ...rest,
    deal: deal
      ? { poster: deal.poster, takeAmountAtomic: BigInt(deal.takeAmountAtomic), currency: BOARD_TRADE.currency, centsPerXmr: BOARD_TRADE.rateCentsPerXmr, maxFiatCents: BOARD_TRADE.fiatCents }
      : null,
    receivedAtomic: big(receivedAtomic),
    confirmedAtomic: big(confirmedAtomic),
    amountAtomic: big(amountAtomic),
    fiatCents: big(fiatCents),
    release: async () => {
      await record('release')();
      set({ phase: 'done', keepOpen: false });
    },
    buildRefund: record('build-refund'),
    // Like Task 12's runtime: a tapped settle is saved on this device (intentKind).
    buyerCancel: record('buyer-cancel', () => set({ intentKind: 'buyer-cancel' })),
    proposeCancelSign: record('propose-cancel-sign', () => set({ intentKind: 'mutual-cancel' })),
    // Like Task 12's runtime: the buyer's own tap is recorded on this device (paidRecorded).
    markPaid: async (cents) => record(`paid:${cents}`, () => set({ paidRecorded: true, refusal: null }))(),
    signal: async (type) => record(`signal:${type}`)(),
  };
  window.__x2fSetFixtureEscrow = (patch) => {
    const { amountAtomic: a, fiatCents: f, ...other } = patch;
    set({ ...other, ...(a !== undefined ? { amountAtomic: a === null ? null : BigInt(a) } : {}), ...(f !== undefined ? { fiatCents: f === null ? null : BigInt(f) } : {}) });
  };
  setTradeEscrowHook(() =>
    useSyncExternalStore(
      (cb) => {
        subs.add(cb);
        return () => subs.delete(cb);
      },
      () => state,
    ),
  );
}
