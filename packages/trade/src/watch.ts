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
 *   channels once. A closed escrow is dropped 30 days after its LATEST close, and only while the API
 *   trade is still closed: a trade seen open again (late funds escalated it, or a dispute after a
 *   refund) keeps its watcher, and its next close restarts the 30 days.
 * - Late funds are judged by incoming transactions, never by the balance (a multisig wallet that
 *   did not take part in the sweep may not see it spent) and never by the API's state: every
 *   incoming tx not swept is late. Swept is decided only from the sweep itself, failing closed:
 *   the sweep spends every coin its builder's wallet saw unlocked (R25), which is the oldest coins
 *   by height, and each at least UNLOCK_CONFIRMATIONS blocks older than the sweep's block. So swept =
 *   the oldest-first prefix of the in-block incoming txs, whole heights only, every one at
 *   `height <= sweep.height - 10`, that sums EXACTLY to `sweep.sweptAtomic`. No such prefix → nothing
 *   is swept and every coin is late (escalation). A close known only from the API (no sweep shown)
 *   sweeps nothing until the sweep is shown. Late coins are reported as `chain` facts of the late
 *   coins alone. `late-funds` (which the API turns into `escalate`) is reported whenever a late tx
 *   not reported before appears while the trade is closed (the API shows it closed, or this step
 *   reported our own `settled`): each late tx escalates once, so a second batch after a ruling
 *   escalates again while the first does not. A later sweep that is shown (e.g. a ruling's) takes,
 *   by the same exact-prefix rule, the oldest of the coins not yet swept. A sweep tx itself is never
 *   counted as a late coin.
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
  /** The first sweep tx this watcher has been shown, if any. */
  settledTx: string | null;
  /** Every sweep tx this watcher has been shown (the first, then e.g. a ruling's). */
  sweepTxs: string[];
  /** Incoming txs the sweeps took; set when the trade closes ([] until a sweep is shown). */
  swept: string[] | null;
  /** Late txs already reported with `late-funds`; each escalates once. */
  lateReported: string[];
  /** The API trade was seen open again after this watcher's close; its next close restarts the 30 days. */
  reopened: boolean;
  /** A `late-funds` was reported and the API has not yet been seen `disputed`: the watch never ends meanwhile. */
  escalationPending: boolean;
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
  return {
    lastChain: null,
    closedAt: null,
    settledTx: null,
    sweepTxs: [],
    swept: null,
    lateReported: [],
    reopened: false,
    escalationPending: false,
    channelsClosed: false,
  };
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
  const apiClosed = CLOSED.includes(a.trade.state);

  // Open again after our close (escalated, or disputed after a refund): note it; its next close
  // restarts the 30 days, counted from that latest close.
  if (s.closedAt !== null) {
    if (!apiClosed) s = { ...s, reopened: true };
    else if (s.reopened) s = { ...s, closedAt: a.now, reopened: false };
  }
  // Our late-funds escalation is confirmed only once the API shows the dispute.
  if (a.trade.state === 'disputed') s = { ...s, escalationPending: false };
  // A closed escrow is dropped 30 days after its latest close, never while the trade is open, never
  // while an escalation is unconfirmed, and never on a step that finds a late coin not yet
  // reported or a sweep not yet shown (both are handled first, below, and keep the watch).
  const expiredState = s;
  const expired = (st: WatchState): boolean =>
    st.closedAt !== null && apiClosed && !st.escalationPending && a.now.getTime() > st.closedAt.getTime() + WATCH_CLOSED_DAYS * DAY_MS;

  const sweep = sweepOf(spend);
  let settledNow = false;
  if (s.closedAt === null) {
    if (sweep !== null) {
      reports.push({ kind: 'settled', txHash: sweep.txHash });
      settledNow = true;
      s = { ...s, closedAt: a.now, settledTx: sweep.txHash, sweepTxs: [sweep.txHash], swept: sweptBy(funds.incoming, sweep) };
    } else if (apiClosed) {
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

  // A sweep shown after the close (the first one, if the API closed it, or e.g. a ruling's) takes
  // the oldest of the coins not yet swept, by the same exact-prefix rule.
  // A later sweep is a later close: the 30 days restart from it.
  if (sweep !== null && !s.sweepTxs.includes(sweep.txHash)) {
    const taken = new Set([...(s.swept ?? []), ...s.sweepTxs]);
    const more = sweptBy(funds.incoming.filter((i) => !taken.has(i.txHash)), sweep);
    s = {
      ...s,
      closedAt: a.now,
      reopened: false,
      settledTx: s.settledTx ?? sweep.txHash,
      sweepTxs: [...s.sweepTxs, sweep.txHash],
      swept: [...(s.swept ?? []), ...more],
    };
  }
  // Closed: close the channels once, and watch for coins no sweep took (a sweep tx itself is never a late coin).
  const closeChannels = !s.channelsClosed;
  s = { ...s, channelsClosed: true };
  const notLate = new Set([...(s.swept ?? []), ...s.sweepTxs]);
  const late = funds.incoming.filter((i) => !notLate.has(i.txHash));
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
    // Each late tx escalates once, and only while the trade is closed (an open one is already in hand).
    const fresh = late.filter((i) => !s.lateReported.includes(i.txHash)).map((i) => i.txHash);
    if (fresh.length > 0 && (apiClosed || settledNow)) {
      reports.push({ kind: 'late-funds' });
      s = { ...s, lateReported: [...s.lateReported, ...fresh], escalationPending: true };
    }
  }
  if (expired(s)) return { reports: [], closeChannels: false, state: expiredState, watching: false };
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
