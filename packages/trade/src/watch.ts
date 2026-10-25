/**
 * The moderation service's chain watcher decisions (Task 9), pure. The I/O loop (apps/moderation,
 * after Task 8) calls `watchStep` every WATCH_INTERVAL_MS per watched escrow with the party's
 * escrow facts (read inside the party's own work queue, as absolute block heights), any sweep it
 * has SHOWN spends this escrow (`spend`, see SpendEvidence), the trade's state from the API work
 * list, and the state returned last time. It then posts the reports IN ORDER, sends the signed relay
 * close for both channels when `closeChannels` is set, and persists the returned `state` only once
 * all of that was accepted (every report is safe to repeat: a repeated `chain` changes nothing, and
 * a repeated `settled` or `late-funds` is refused by the state machine as `wrong-state`).
 *
 * Rules (plan Task 9, P3-I4, P3-I6, OD-2, spec 11.1):
 * - `chain { receivedAtomic: balance, unlockedAtomic: unlocked, confirmations: lowest among incoming }`,
 *   reported only when a fact changed. Confirmations are `chainHeight - height` (0 in the pool).
 * - While the escrow is being spent (a sweep not yet in a block, or a balance below what came in
 *   in blocks), no `chain` is reported: a pool sweep must not read as "the escrow is empty".
 *   wallet2's balance leaves pool deposits out, so they never count as spending.
 * - `settled { txHash }` only for a sweep in a block; a pool-only tx is not settled.
 * - On `released`/`refunded` (our own `settled`) or `cancelled` (from the API): close both relay
 *   channels once. A closed escrow is dropped after 30 days, but only while the API trade is still
 *   closed: a trade that late funds escalated (`disputed`) keeps its watcher.
 * - Late funds are judged by incoming transactions, never by the balance (a multisig wallet that
 *   did not take part in the sweep may not see it spent) and never by the API's state: every
 *   incoming tx not swept is late. Swept is decided only from the sweep itself, failing closed:
 *   the sweep spends every coin its builder's wallet saw unlocked (R25), which is the oldest coins
 *   by height, and each at least UNLOCK_CONFIRMATIONS blocks older than the sweep's block. So swept =
 *   the oldest-first prefix of the in-block incoming txs, whole heights only, every one at
 *   `height <= sweep.height - 10`, that sums EXACTLY to `sweep.sweptAtomic`. No such prefix → nothing
 *   is swept and every coin is late (escalation). A close known only from the API (no sweep shown)
 *   sweeps nothing until the sweep is shown. Late coins are reported as `chain` facts of the late
 *   coins alone, then `late-funds` once, which the API turns into `escalate`.
 */
import type { TradeState } from './machine.js';
import type { SettleKind } from './payouts.js';
import { UNLOCK_CONFIRMATIONS } from './timers.js';

export const WATCH_INTERVAL_MS = 15_000;
export const WATCH_CLOSED_DAYS = 30;

/**
 * One transaction paying the escrow, by absolute block height (null while in the pool). The I/O
 * layer reads it from the wallet (monero-ts `tx.getHeight()`), in the same read as `chainHeight`.
 */
export interface WatchIncoming {
  txHash: string;
  amountAtomic: bigint;
  height: number | null;
  unlocked: boolean;
}

export interface EscrowFunds {
  balance: bigint;
  unlocked: bigint;
  /** The daemon height (number of blocks) the facts were read at; a tx in block h has chainHeight - h confirmations. */
  chainHeight: number;
  incoming: WatchIncoming[];
}

/**
 * A sweep of this escrow.
 *
 * RULE: the I/O layer passes a tx here only once it is SHOWN to spend this escrow's outputs, by
 * the mod wallet's own `spentBy` after a multisig info import, or by checking the tx's key images
 * against the escrow's outputs. A tx hash seen in a block (or reported by a party or the API) is
 * never enough.
 *
 * `height` is the block it is in (null while in the pool). `sweptAtomic` is everything the sweep
 * spent: the sum of the outcome's payouts PLUS the network fee (the fee comes off payout 0, so the
 * payouts alone are short by it). A sweep whose amount matches no exact prefix of the escrow's
 * coins counts as sweeping nothing.
 */
export interface SpendEvidence {
  txHash: string;
  height: number | null;
  sweptAtomic: bigint;
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
  /** When this watcher saw the trade close (its own `settled`, or the API's `cancelled`/close). */
  closedAt: Date | null;
  /** The sweep tx this watcher has been shown, if any. */
  settledTx: string | null;
  /** Incoming txs the sweep took; set when the trade closes ([] until a sweep is shown). */
  swept: string[] | null;
  lateFundsReported: boolean;
  channelsClosed: boolean;
}

export interface WatchStepResult {
  reports: WatchReport[];
  closeChannels: boolean;
  state: WatchState;
  /** False once a closed escrow has been watched for 30 days and the trade is still closed: stop its party and drop it. */
  watching: boolean;
}

const TX_HASH = /^[0-9a-f]{64}$/;
const CLOSED: readonly TradeState[] = ['released', 'refunded', 'cancelled'];
const DAY_MS = 24 * 60 * 60_000;

export function newWatchState(): WatchState {
  return { lastChain: null, closedAt: null, settledTx: null, swept: null, lateFundsReported: false, channelsClosed: false };
}

const isHeight = (h: unknown, chainHeight: number): h is number => Number.isSafeInteger(h) && (h as number) >= 0 && (h as number) < chainHeight;

function checkFunds(f: EscrowFunds): void {
  const bad = (): never => {
    throw new RangeError('bad escrow facts');
  };
  if (typeof f.balance !== 'bigint' || typeof f.unlocked !== 'bigint' || !Array.isArray(f.incoming)) bad();
  if (f.balance < 0n || f.unlocked < 0n || f.unlocked > f.balance) bad();
  if (!Number.isSafeInteger(f.chainHeight) || f.chainHeight < 0) bad();
  const seen = new Set<string>();
  for (const i of f.incoming) {
    if (typeof i.txHash !== 'string' || i.txHash === '' || seen.has(i.txHash)) bad();
    seen.add(i.txHash);
    if (typeof i.amountAtomic !== 'bigint' || i.amountAtomic < 0n || typeof i.unlocked !== 'boolean') bad();
    if (i.height !== null && !isHeight(i.height, f.chainHeight)) bad();
  }
}

function checkSpend(sp: SpendEvidence | null, chainHeight: number): void {
  if (sp === null) return;
  if (typeof sp.sweptAtomic !== 'bigint' || sp.sweptAtomic <= 0n) throw new RangeError('bad spend facts');
  if (sp.height !== null && !isHeight(sp.height, chainHeight)) throw new RangeError('bad spend facts');
}

type InBlock<T> = T & { height: number };

/** A sweep in a block with a well-formed hash, or null. */
const sweepOf = (sp: SpendEvidence | null): InBlock<SpendEvidence> | null =>
  sp !== null && sp.height !== null && typeof sp.txHash === 'string' && TX_HASH.test(sp.txHash) ? (sp as InBlock<SpendEvidence>) : null;

/** The incoming txs `sweep` spent: the exact oldest-first, whole-height prefix (see the module comment), else none. */
function sweptBy(incoming: readonly WatchIncoming[], sweep: InBlock<SpendEvidence>): string[] {
  const inBlock = incoming.filter((i): i is InBlock<WatchIncoming> => i.height !== null);
  const heights = [...new Set(inBlock.map((i) => i.height))].sort((x, y) => x - y);
  const taken: string[] = [];
  let total = 0n;
  for (const h of heights) {
    if (h > sweep.height - UNLOCK_CONFIRMATIONS) break;
    for (const i of inBlock) {
      if (i.height !== h) continue;
      taken.push(i.txHash);
      total += i.amountAtomic;
    }
    if (total === sweep.sweptAtomic) return taken;
    if (total > sweep.sweptAtomic) break;
  }
  return [];
}

const confirmationsOf = (i: WatchIncoming, chainHeight: number): number => (i.height === null ? 0 : chainHeight - i.height);
const lowest = (incoming: readonly WatchIncoming[], chainHeight: number): number =>
  incoming.length === 0 ? 0 : Math.min(...incoming.map((i) => confirmationsOf(i, chainHeight)));
const sum = (incoming: readonly WatchIncoming[]): bigint => incoming.reduce((s, i) => s + i.amountAtomic, 0n);
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
  checkSpend(a.spend, a.funds.chainHeight);
  const { funds, spend } = a;
  const chainHeight = funds.chainHeight;
  let s: WatchState = { ...a.state };
  const reports: WatchReport[] = [];

  // A closed escrow is dropped after 30 days, but never while the trade is open again (escalated).
  if (s.closedAt !== null && CLOSED.includes(a.trade.state) && a.now.getTime() > s.closedAt.getTime() + WATCH_CLOSED_DAYS * DAY_MS) {
    return { reports, closeChannels: false, state: s, watching: false };
  }

  const sweep = sweepOf(spend);
  if (s.closedAt === null) {
    if (sweep !== null) {
      reports.push({ kind: 'settled', txHash: sweep.txHash });
      s = { ...s, closedAt: a.now, settledTx: sweep.txHash, swept: sweptBy(funds.incoming, sweep) };
    } else if (CLOSED.includes(a.trade.state)) {
      // Closed by the API alone: nothing is shown to be swept, so every coin is unaccounted.
      s = { ...s, closedAt: a.now, swept: [] };
    } else {
      // wallet2's balance leaves pool deposits out: compare with what came in in blocks.
      const spending = spend !== null || funds.balance < sum(funds.incoming.filter((i) => i.height !== null));
      const facts: ChainFacts = { receivedAtomic: funds.balance, unlockedAtomic: funds.unlocked, confirmations: lowest(funds.incoming, chainHeight) };
      if (!spending && !same(s.lastChain, facts)) {
        reports.push({ kind: 'chain', ...facts });
        s = { ...s, lastChain: facts };
      }
      return { reports, closeChannels: false, state: s, watching: true };
    }
  }

  // Closed by the API before a sweep was shown: once it is, count only the coins it did not take.
  if (s.settledTx === null && sweep !== null) s = { ...s, settledTx: sweep.txHash, swept: sweptBy(funds.incoming, sweep) };
  // Closed: close the channels once, and watch for coins the sweep did not take.
  const closeChannels = !s.channelsClosed;
  s = { ...s, channelsClosed: true };
  const swept = new Set(s.swept ?? []);
  const late = funds.incoming.filter((i) => !swept.has(i.txHash));
  if (late.length > 0) {
    const facts: ChainFacts = {
      receivedAtomic: sum(late),
      unlockedAtomic: sum(late.filter((i) => i.unlocked)),
      confirmations: lowest(late, chainHeight),
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
 * alone names it. Null otherwise: then the kind must come from the tx's payouts, which this pure
 * layer does not see. That includes `funding`/`securing`/`secured`/`paid`: a signing window that
 * timed out (`settleBy`) returns the trade to `settleFrom` and clears `settling`, so a sweep seen
 * there can be any kind that was being signed (a release, a mutual cancel, a buyer cancel), and
 * guessing from the state would mis-attribute it. Also null for a dispute ruling.
 */
export function settleKindFor(t: { state: TradeState; settling: SettleKind | null }): SettleKind | null {
  if (t.state === 'settling') return t.settling;
  if (t.state === 'lapsed') return 'lapse-refund';
  if (t.state === 'refund_requested') return 'auto-refund';
  return null;
}
