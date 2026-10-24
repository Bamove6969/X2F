/**
 * The moderation service's chain watcher decisions (Task 9), pure. The I/O loop (apps/moderation,
 * after Task 8) calls `watchStep` every WATCH_INTERVAL_MS per watched escrow with the party's
 * `funds()` (read inside the party's own work queue), any tx it has established sweeps this escrow
 * (`spend`, with `inBlock` from `txSeen`), the trade's state from the API work list, and the state
 * returned last time. It then posts the reports IN ORDER, sends the signed relay close for both
 * channels when `closeChannels` is set, and persists the returned `state` only once all of that
 * was accepted (every report is safe to repeat: a repeated `chain` changes nothing, and a repeated
 * `settled` or `late-funds` is refused by the state machine as `wrong-state`).
 *
 * Rules (plan Task 9, P3-I4, P3-I6, OD-2, spec 11.1):
 * - `chain { receivedAtomic: balance, unlockedAtomic: unlocked, confirmations: lowest among incoming }`,
 *   reported only when a fact changed.
 * - While the escrow is being spent (a named sweep not yet in a block, or a balance below what came
 *   in), no `chain` is reported: a pool sweep must not read as "the escrow is empty".
 * - `settled { txHash }` only for a sweep in a block (`txSeen`); a pool-only tx is not settled.
 * - On `released`/`refunded` (our own `settled`) or `cancelled` (from the API): close both relay
 *   channels once. Closed escrows stay watched for 30 days.
 * - Late funds are judged by incoming transactions, never by the balance (a multisig wallet that
 *   did not take part in the sweep may not see it spent) and never by the API's state: every
 *   incoming tx not swept is late. Swept is decided only from the sweep itself, failing closed: an
 *   incoming tx counts as swept only when it was confirmed at least UNLOCK_CONFIRMATIONS blocks
 *   before the sweep's block (`incoming.confirmations - spend.confirmations >= 10`), because the
 *   builder sweeps only coins its wallet sees unlocked (R25), so nothing younger can be in it. Both
 *   counts must be read at the same chain height. A close known only from the API (no sweep tx
 *   known) sweeps nothing: every coin is unaccounted until the sweep is known. Late coins are
 *   reported as `chain` facts of the late coins alone, then `late-funds` once, which the API turns
 *   into `escalate`.
 */
import type { Incoming } from '@x2f/escrow';
import type { TradeState } from './machine.js';
import type { SettleKind } from './payouts.js';
import { UNLOCK_CONFIRMATIONS } from './timers.js';

export const WATCH_INTERVAL_MS = 15_000;
export const WATCH_CLOSED_DAYS = 30;

export interface EscrowFunds {
  balance: bigint;
  unlocked: bigint;
  incoming: Incoming[];
}

/**
 * A tx the watcher has established sweeps this escrow; `inBlock` = `txSeen` (in a block, not the
 * pool). `confirmations` is the tx's own count (0 in the pool), read at the same chain height as
 * the incoming list.
 */
export interface SpendEvidence {
  txHash: string;
  inBlock: boolean;
  confirmations: number;
}

export interface ChainFacts {
  receivedAtomic: bigint;
  unlockedAtomic: bigint;
  confirmations: number;
}

export type WatchReport = ({ kind: 'chain' } & ChainFacts) | { kind: 'settled'; txHash: string } | { kind: 'late-funds' };

/** Persisted per escrow by the watcher (moderation database). */
export interface WatchState {
  lastChain: ChainFacts | null;
  /** When this watcher saw the trade close (its own `settled`, or the API's `cancelled`). */
  closedAt: Date | null;
  /** The settling tx this watcher reported, if any. */
  settledTx: string | null;
  /** Incoming txs the settlement took; set when the trade closes ([] until the sweep is known). */
  swept: string[] | null;
  lateFundsReported: boolean;
  channelsClosed: boolean;
}

export interface WatchStepResult {
  reports: WatchReport[];
  closeChannels: boolean;
  state: WatchState;
  /** False once a closed escrow has been watched for 30 days: stop its party and drop it. */
  watching: boolean;
}

const TX_HASH = /^[0-9a-f]{64}$/;
const CLOSED: readonly TradeState[] = ['released', 'refunded', 'cancelled'];
const DAY_MS = 24 * 60 * 60_000;

export function newWatchState(): WatchState {
  return { lastChain: null, closedAt: null, settledTx: null, swept: null, lateFundsReported: false, channelsClosed: false };
}

function checkFunds(f: EscrowFunds): void {
  const bad = (): never => {
    throw new RangeError('bad escrow facts');
  };
  if (typeof f.balance !== 'bigint' || typeof f.unlocked !== 'bigint' || !Array.isArray(f.incoming)) bad();
  if (f.balance < 0n || f.unlocked < 0n || f.unlocked > f.balance) bad();
  const seen = new Set<string>();
  for (const i of f.incoming) {
    if (typeof i.txHash !== 'string' || i.txHash === '' || seen.has(i.txHash)) bad();
    seen.add(i.txHash);
    if (typeof i.amountAtomic !== 'bigint' || i.amountAtomic < 0n) bad();
    if (!Number.isSafeInteger(i.confirmations) || i.confirmations < 0 || typeof i.unlocked !== 'boolean') bad();
  }
}

function checkSpend(sp: SpendEvidence | null): void {
  if (sp === null) return;
  if (typeof sp.inBlock !== 'boolean' || !Number.isSafeInteger(sp.confirmations) || sp.confirmations < 0) throw new RangeError('bad spend facts');
  if (sp.inBlock && sp.confirmations < 1) throw new RangeError('bad spend facts');
}

/** A sweep in a block with a well-formed hash, or null. */
const sweepOf = (sp: SpendEvidence | null): SpendEvidence | null =>
  sp !== null && sp.inBlock && typeof sp.txHash === 'string' && TX_HASH.test(sp.txHash) ? sp : null;

/** The incoming txs old enough to have been spent by `sweep` (see the module comment). */
const sweptBy = (incoming: readonly Incoming[], sweep: SpendEvidence): string[] =>
  incoming.filter((i) => i.confirmations - sweep.confirmations >= UNLOCK_CONFIRMATIONS).map((i) => i.txHash);

const lowest = (incoming: readonly Incoming[]): number =>
  incoming.length === 0 ? 0 : Math.min(...incoming.map((i) => i.confirmations));
const sum = (incoming: readonly Incoming[]): bigint => incoming.reduce((s, i) => s + i.amountAtomic, 0n);
const same = (a: ChainFacts | null, b: ChainFacts): boolean =>
  a !== null && a.receivedAtomic === b.receivedAtomic && a.unlockedAtomic === b.unlockedAtomic && a.confirmations === b.confirmations;

export function watchStep(a: {
  trade: { state: TradeState };
  funds: EscrowFunds;
  spend: SpendEvidence | null;
  state: WatchState;
  now: Date;
}): WatchStepResult {
  if (!(a.now instanceof Date) || Number.isNaN(a.now.getTime())) throw new RangeError('bad clock');
  checkFunds(a.funds);
  checkSpend(a.spend);
  const { funds, spend } = a;
  let s: WatchState = { ...a.state };
  const reports: WatchReport[] = [];

  if (s.closedAt !== null && a.now.getTime() > s.closedAt.getTime() + WATCH_CLOSED_DAYS * DAY_MS) {
    return { reports, closeChannels: false, state: s, watching: false };
  }

  const sweep = sweepOf(spend);
  if (s.closedAt === null) {
    if (sweep !== null) {
      reports.push({ kind: 'settled', txHash: sweep.txHash });
      s = { ...s, closedAt: a.now, settledTx: sweep.txHash, swept: sweptBy(funds.incoming, sweep) };
    } else if (CLOSED.includes(a.trade.state)) {
      // Closed by the API alone: nothing is known to be swept, so every coin is unaccounted.
      s = { ...s, closedAt: a.now, swept: [] };
    } else {
      const spending = spend !== null || funds.balance < sum(funds.incoming);
      const facts: ChainFacts = { receivedAtomic: funds.balance, unlockedAtomic: funds.unlocked, confirmations: lowest(funds.incoming) };
      if (!spending && !same(s.lastChain, facts)) {
        reports.push({ kind: 'chain', ...facts });
        s = { ...s, lastChain: facts };
      }
      return { reports, closeChannels: false, state: s, watching: true };
    }
  }

  // Closed by the API before the sweep was known: once it is, count only the coins it did not take.
  if (s.settledTx === null && sweep !== null) s = { ...s, settledTx: sweep.txHash, swept: sweptBy(funds.incoming, sweep) };
  // Closed: close the channels once, and watch for coins the settlement did not take.
  const closeChannels = !s.channelsClosed;
  s = { ...s, channelsClosed: true };
  const swept = new Set(s.swept ?? []);
  const late = funds.incoming.filter((i) => !swept.has(i.txHash));
  if (late.length > 0) {
    const facts: ChainFacts = {
      receivedAtomic: sum(late),
      unlockedAtomic: sum(late.filter((i) => i.unlocked)),
      confirmations: lowest(late),
    };
    if (!same(s.lastChain, facts)) {
      reports.push({ kind: 'chain', ...facts });
      s = { ...s, lastChain: facts };
    }
    if (!s.lateFundsReported) {
      reports.push({ kind: 'late-funds' });
      s = { ...s, lateFundsReported: true };
    }
  }
  return { reports, closeChannels, state: s, watching: true };
}

/**
 * The kind for the `settled` event the API applies on a watcher's `settled` report, when the trade
 * alone names it. Null otherwise (e.g. a release that completed after its signing window returned
 * the trade to `secured`/`paid`, or a dispute ruling): then the kind must come from the tx's
 * payouts, which this pure layer does not see.
 */
export function settleKindFor(t: { state: TradeState; settling: SettleKind | null }): SettleKind | null {
  if (t.state === 'settling') return t.settling;
  if (t.state === 'lapsed') return 'lapse-refund';
  if (t.state === 'refund_requested') return 'auto-refund';
  return null;
}
