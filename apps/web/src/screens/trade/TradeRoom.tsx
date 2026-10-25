/**
 * TradeRoom: the shared trade-room shell at `/trade/:code` (Plan 3 Task 22). It loads the trade,
 * keeps it fresh, owns the trade's one escrow handle and picks the screen for the viewer's role
 * and the trade's state from the slot registry below. Tasks 22-25 (and 27) plug their screens in
 * with `registerTradeScreen`; they never fetch the trade or start the escrow themselves.
 *
 * ## The slot interface (stable; change it only through the lead)
 *
 * ```ts
 * registerTradeScreen({
 *   owner: 'Task 23',                 // who registered it (shown in conflict errors)
 *   role: 'buyer',                    // 'buyer' | 'seller' | 'any'
 *   states: ['secured'],              // one or more TradeState values
 *   when: (view, nowMs) => true,      // optional guard; see "Choosing a screen"
 *   screen: BuyerPay,                 // ComponentType<TradeScreenProps>
 * });
 * ```
 *
 * Register at module top level in your screen's file, then add ONE import line for that file to
 * `./screens.ts` (each task has its own reserved line there, so merges do not conflict).
 *
 * ### What a screen gets (`TradeScreenProps`)
 * - `view`: the latest `TradeView` (GET /v1/trades/:code). Never cache parts of it: it is
 *   re-read on every live `trade` event for this code, every `POLL_MS`, and after `refresh()`.
 * - `escrow`: the trade's one `TradeEscrow` (Task 12's `useEscrow`, behind `seams.ts`). Call its
 *   actions; never call `useEscrow` yourself (two handles would start the escrow twice).
 * - `refresh()`: re-read the view now (after posting an event, for example).
 * - `serverClock()`: the server's clock, from `view.serverNow` (Review Focus 3). Use it for every
 *   countdown and deadline test, never `Date.now()`.
 * - `wide`: true at 1024 px and wider (the Desktop board's room, Task 23).
 *
 * ### Choosing a screen
 * 1. If the escrow reports an integrity failure (`participants-mismatch`, `deal-mismatch`), the
 *    room shows SetupStatus's danger state whatever the slot: nobody funds or settles that trade.
 * 2. Otherwise, among the slots whose `role` (or 'any') and `states` match: the first one whose
 *    `when` returns true (in registration order), else the one without `when`.
 * 3. No match: a plain status card naming the state (until its task lands).
 * Two slots without `when` for the same role and state throw at registration: guard one of them
 * with `when`, or agree with the lead who owns it.
 *
 * ### Who owns which slot (lead's plan; register only your own)
 * - Task 22: buyer and seller in `setup`, `funding`; seller in `securing` (TradeFund, SetupStatus).
 * - Task 23: buyer in `securing`, `secured`; seller in `secured` (BuyerPay, the seller's waiting room).
 * - Task 24: seller in `paid`; both in `settling` (release) and `released` (SellerConfirm, Released).
 * - Task 25: seller in `secured` with `when` past `payBy` (SellerRefund); buyer in `refund_requested` (FinalAlert).
 * - Task 27: both in `disputed`.
 *
 * ### Rules for every screen
 * - Show the other trader only as `publicName(view.counterparty)` inside `data-username`; never a
 *   login name (FU-A), and no text-transform on it.
 * - Exactly one `[data-primary]` per screen (parity, Task 15); phone sizes 360×640, 390×844,
 *   430×932 must fit with no horizontal scroll.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentType } from 'react';
import { useLocation, useParams } from 'react-router';
import { ApiCallError, serverClock as makeServerClock } from '../../api/client.js';
import { getTrade, TRADE_STATES, type Party, type TradeState, type TradeView } from '../../api/trade.js';
import { integrityFailed, POLL_MS, useTradeEscrow, useTradeLive, type ConfirmedTrade, type TradeEscrow } from './seams.js';

export interface TradeScreenProps {
  view: TradeView;
  escrow: TradeEscrow;
  refresh(): Promise<void>;
  serverClock(): Date;
  wide: boolean;
}

export type TradeScreen = ComponentType<TradeScreenProps>;

export interface TradeSlot {
  owner: string;
  role: Party | 'any';
  states: readonly TradeState[];
  when?: (view: TradeView, nowMs: number) => boolean;
  screen: TradeScreen;
}

const slots: TradeSlot[] = [];

/** Adds a screen for a role × state; returns a function that removes it (for tests). */
export function registerTradeScreen(slot: TradeSlot): () => void {
  if (slot.states.length === 0) throw new Error(`${slot.owner}: a trade screen needs at least one state`);
  for (const s of slot.states) {
    if (!TRADE_STATES.includes(s)) throw new Error(`${slot.owner}: unknown trade state ${String(s)}`);
  }
  if (!slot.when) {
    for (const other of slots) {
      if (other.when) continue;
      const rolesMeet = other.role === slot.role || other.role === 'any' || slot.role === 'any';
      const shared = other.states.find((s) => slot.states.includes(s));
      if (rolesMeet && shared) {
        throw new Error(`${slot.owner}: ${slot.role} × ${shared} is already ${other.owner}'s screen (guard one with \`when\`)`);
      }
    }
  }
  const entry = { ...slot };
  slots.push(entry);
  return () => {
    const i = slots.indexOf(entry);
    if (i >= 0) slots.splice(i, 1);
  };
}

/** The registered screen for this view at `nowMs` (server time), or null; integrity failures are handled by the room. */
export function screenFor(view: TradeView, nowMs: number): TradeScreen | null {
  const fits = slots.filter((s) => (s.role === 'any' || s.role === view.role) && s.states.includes(view.state));
  const guarded = fits.find((s) => s.when?.(view, nowMs) === true);
  if (guarded) return guarded.screen;
  return fits.find((s) => !s.when)?.screen ?? null;
}

/** The screen shown on an integrity failure (SetupStatus's danger state; set by Task 22's SetupStatus). */
let integrityScreen: TradeScreen | null = null;
export function setIntegrityScreen(s: TradeScreen | null): void {
  integrityScreen = s;
}

const WIDE = '(min-width: 1024px)';
/** How long after a deadline the room re-reads the trade (the server's timers run on the minute). */
const DEADLINE_SLACK_MS = 1_000;

function useWide(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const q = window.matchMedia(WIDE);
      q.addEventListener('change', onChange);
      return () => q.removeEventListener('change', onChange);
    },
    () => window.matchMedia(WIDE).matches,
  );
}

type Load = { kind: 'loading' } | { kind: 'missing' } | { kind: 'failed' } | { kind: 'ready'; view: TradeView };

/** Reads the trade, and re-reads it on live events, every POLL_MS and on refresh(). */
function useTradeView(code: string): { load: Load; refresh: () => Promise<void> } {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const seq = useRef(0);
  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const view = await getTrade(code);
      if (mine === seq.current) setLoad({ kind: 'ready', view });
    } catch (e) {
      if (mine !== seq.current) return;
      if (e instanceof ApiCallError && e.status === 404) setLoad({ kind: 'missing' });
      // A failed re-read keeps the last good view on screen.
      else setLoad((prev) => (prev.kind === 'ready' ? prev : { kind: 'failed' }));
    }
  }, [code]);
  useEffect(() => {
    setLoad({ kind: 'loading' });
    void refresh();
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => {
      clearInterval(id);
      seq.current++;
    };
  }, [refresh]);
  useTradeLive(code, () => void refresh());
  return { load, refresh };
}

/** Shown for a state whose screen has not landed yet. */
function StatusCard({ view }: { view: TradeView }) {
  return (
    <section className="x2f-trade-status" data-trade-state={view.state}>
      <p>Trade {view.code}</p>
      <p>State: {view.state.replace('_', ' ')}</p>
    </section>
  );
}

export function TradeRoom() {
  const { code = '' } = useParams();
  const location = useLocation();
  const confirmed = (location.state as { confirmed?: ConfirmedTrade } | null)?.confirmed;
  const escrow = useTradeEscrow(code, confirmed);
  const { load, refresh } = useTradeView(code);
  const wide = useWide();
  const serverNow = load.kind === 'ready' ? load.view.serverNow : null;
  const clock = useMemo(() => (serverNow ? makeServerClock(serverNow) : () => new Date()), [serverNow]);
  // Re-read just after the next deadline, so a screen chosen by time (`when`) switches on time.
  const deadline = load.kind === 'ready' ? load.view.nextDeadline : null;
  useEffect(() => {
    if (!deadline) return;
    const wait = Date.parse(deadline) - clock().getTime();
    if (!Number.isFinite(wait) || wait < 0 || wait > 2 ** 31 - 1) return;
    const id = setTimeout(() => void refresh(), wait + DEADLINE_SLACK_MS);
    return () => clearTimeout(id);
  }, [deadline, clock, refresh]);

  if (load.kind === 'loading') return <main data-screen="trade" aria-busy="true" />;
  if (load.kind === 'missing') {
    return (
      <main data-screen="trade">
        <p role="alert">Trade not found.</p>
      </main>
    );
  }
  if (load.kind === 'failed') {
    return (
      <main data-screen="trade">
        <p role="alert">Couldn't load this trade. Check your connection and try again.</p>
      </main>
    );
  }
  const view = load.view;
  const props: TradeScreenProps = { view, escrow, refresh, serverClock: clock, wide };
  const Screen = integrityFailed(escrow) ? integrityScreen : screenFor(view, clock().getTime());
  return (
    <main data-screen="trade" data-trade-state={view.state} data-role={view.role}>
      {Screen ? <Screen {...props} /> : <StatusCard view={view} />}
    </main>
  );
}
