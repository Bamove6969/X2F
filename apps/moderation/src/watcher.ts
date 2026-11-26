import type { Funds, Outgoing, PartyHandle } from '@x2f/escrow';
import {
  CLOSED_STATES,
  channelFor,
  modPartyPlan,
  newWatchState,
  sweepMinimums,
  watchStep,
  type AttestedTerms,
  type SettleKind,
  type EscrowFunds,
  type ModPartyArgs,
  type RulingKind,
  type SpendEvidence,
  type Trade,
  type TradeState,
  type WatchReport,
  type WatchState,
} from '@x2f/trade';
import type pg from 'pg';
import { NO_DESK_FACTS, sweepKindAgrees, WATCH_FRESH_MS, type Desk } from './desk.js';
import type { DeskArmed } from './execute.js';
import { sweepTag } from './keystore.js';
import type { Link, WatchItem } from './link.js';
import { freeLienRecoveries, unfreeLienRecoveries } from './lienRecovery.js';

/**
 * The moderation service's chain watcher (Plan 3 Task 9), the I/O around `@x2f/trade`'s pure
 * `modPartyPlan` and `watchStep`. Each pass:
 * 1. reads the API's state for every attested trade (`GET /internal/v1/watch`);
 * 2. per trade this service started a party for (`mod_watch`): starts it again after a restart
 *    (from the moderation database only: `argsFor`), reports `setup-done { escrowAddress }` with the
 *    address ready() resolved with, or stops it once its watch ended;
 * 3. per running party with an escrow: reads `funds()`, runs `watchStep`, posts the reports in
 *    order, sends the signed relay close for both channels when asked, and persists the new
 *    WatchState only once all of that was accepted (every report is safe to repeat).
 * A report the API refuses with `wrong-state` counts as done (it was applied before).
 */
export interface WatcherOptions {
  db: pg.Pool;
  /** MOD_KEYSTORE_KEY: the shredded trades' sweep tags (claimSweep, review lead-mod-purge M2). */
  keystoreKey: Uint8Array;
  link: Link;
  /** Starts one moderator party (the real one is `startModParty` with the production I/O). */
  startParty: (a: ModPartyArgs) => Promise<PartyHandle>;
  /**
   * The ModPartyArgs for a trade, built from this service's own records only (`mod_party_state`,
   * `mod_wallet_secrets`, `signed_terms`): never from an API read. Null when it has none.
   */
  argsFor: (trade: string) => Promise<ModPartyArgs | null>;
  now: () => Date;
  log: (e: { reason: string }) => void;
  /**
   * Opens the trade's moderator desk (Task 10: signals, shadow trade, guarded refunds) once its
   * party runs. Absent: no desk (Task 9's tests).
   */
  openDesk?: (a: ModPartyArgs) => Promise<Desk>;
  /**
   * Plan 4 Task 14 (R-M2): the kind of the ruling payout the executor recorded for this trade, or
   * null. Non-null also means a payout is recorded: the desk then hands nothing (review M5).
   */
  rulingKind?: (code: string) => RulingKind | null;
  /**
   * Plan 4 Task 14: the ruling executor's pass for this trade, after the desk's, with the same
   * accepted facts (the trade's party, the API item read for this pass, the funds the party read),
   * this service's own args, the desk's shadow trade and its armed refund (review M5). Absent: no
   * rulings are executed.
   */
  executeRuling?: (s: { code: string; handle: PartyHandle; api: WatchItem; funds: { balance: bigint; unlocked: bigint }; args: ModPartyArgs; shadow: Trade | null; deskArmed: DeskArmed; escrowAddress: string | null }) => Promise<unknown>;
}

export interface Watcher {
  /** Registers and starts the party for a freshly attested trade (once per process). */
  runParty(a: ModPartyArgs): Promise<void>;
  /** One watcher pass. */
  tick(): Promise<void>;
  /** Stops every running party. */
  stop(): Promise<void>;
  /**
   * Runs `fn` between two watcher passes, never during one (the trade shred, Plan 7 Task 2 follow-up:
   * a pass never reads or writes a trade's rows while they are being deleted).
   */
  between<T>(fn: () => Promise<T>): Promise<T>;
  /** Whether this process runs, or is starting, the trade's moderator party. */
  active(code: string): boolean;
}

/** The first back-off after the API answered `settle-kind-unknown`; doubles up to SETTLE_BACKOFF_MAX_MS. */
export const SETTLE_BACKOFF_MS = 60_000;
export const SETTLE_BACKOFF_MAX_MS = 60 * 60_000;

interface Row {
  trade: string;
  escrow_address: string | null;
  setup_done_at: Date | null;
  state: unknown;
  watching: boolean;
  /** Bumped by every state save; a save over another version is dropped (security review 7 Nov, finding 2). */
  version: string;
}

/** The settle kinds whose payout pays a signed lien recovery (`payoutsFor`): a completed trade. */
const PAYS_RECOVERY: ReadonlySet<string> = new Set(['release', 'dispute-buyer']);

/** No coin ever reached the escrow, as this watcher saw it (and no sweep was counted). */
function neverFunded(s: WatchState): boolean {
  return (s.lastChain === null || s.lastChain.receivedAtomic === 0n) && s.sweepTxs.length === 0;
}

/** WatchState as JSON: bigints as decimal strings, closedAt as an ISO string. */
export function dumpWatchState(s: WatchState): unknown {
  return {
    ...s,
    lastChain: s.lastChain && { ...s.lastChain, receivedAtomic: s.lastChain.receivedAtomic.toString(), unlockedAtomic: s.lastChain.unlockedAtomic.toString() },
    closedAt: s.closedAt ? s.closedAt.toISOString() : null,
    settlingSince: s.settlingSince ? s.settlingSince.toISOString() : null,
    spendUnshownReported: s.spendUnshownReported === true,
    claimReported: s.claimReported === true,
    claimedAt: s.claimedAt ? s.claimedAt.toISOString() : null,
  };
}

const strings = (x: unknown): x is string[] => Array.isArray(x) && x.every((v) => typeof v === 'string');
const ATOMIC = /^(0|[1-9]\d{0,30})$/;

/** The inverse of dumpWatchState; anything else is RangeError('bad watch state'). */
export function reviveWatchState(j: unknown): WatchState {
  const bad = (): never => {
    throw new RangeError('bad watch state');
  };
  if (typeof j !== 'object' || j === null) return bad();
  const o = j as Record<string, unknown>;
  let lastChain: WatchState['lastChain'] = null;
  if (o.lastChain !== null) {
    const c = o.lastChain as Record<string, unknown> | undefined;
    if (!c || typeof c.receivedAtomic !== 'string' || typeof c.unlockedAtomic !== 'string' || !ATOMIC.test(c.receivedAtomic) || !ATOMIC.test(c.unlockedAtomic)) bad();
    if (!Number.isSafeInteger(c!.confirmations)) bad();
    lastChain = { receivedAtomic: BigInt(c!.receivedAtomic as string), unlockedAtomic: BigInt(c!.unlockedAtomic as string), confirmations: c!.confirmations as number };
  }
  let closedAt: Date | null = null;
  if (o.closedAt !== null) {
    if (typeof o.closedAt !== 'string') bad();
    closedAt = new Date(o.closedAt as string);
    if (Number.isNaN(closedAt.getTime())) bad();
  }
  // Absent in a state persisted before the Task 9 fallback: never seen settling.
  let settlingSince: Date | null = null;
  if (o.settlingSince !== undefined && o.settlingSince !== null) {
    if (typeof o.settlingSince !== 'string') bad();
    settlingSince = new Date(o.settlingSince as string);
    if (Number.isNaN(settlingSince.getTime())) bad();
  }
  if (o.spendUnshownReported !== undefined && typeof o.spendUnshownReported !== 'boolean') bad();
  // Absent in a state persisted before lead decision (b): no claim reported.
  let claimedAt: Date | null = null;
  if (o.claimedAt !== undefined && o.claimedAt !== null) {
    if (typeof o.claimedAt !== 'string') bad();
    claimedAt = new Date(o.claimedAt as string);
    if (Number.isNaN(claimedAt.getTime())) bad();
  }
  if (o.claimReported !== undefined && typeof o.claimReported !== 'boolean') bad();
  if (o.settledTx !== null && typeof o.settledTx !== 'string') bad();
  if (!strings(o.sweepTxs) || !strings(o.lateReported) || (o.swept !== null && !strings(o.swept))) bad();
  for (const k of ['reopened', 'escalationPending', 'channelsClosed'] as const) if (typeof o[k] !== 'boolean') bad();
  return {
    lastChain,
    closedAt,
    settledTx: o.settledTx as string | null,
    sweepTxs: o.sweepTxs as string[],
    swept: o.swept as string[] | null,
    lateReported: o.lateReported as string[],
    reopened: o.reopened as boolean,
    escalationPending: o.escalationPending as boolean,
    channelsClosed: o.channelsClosed as boolean,
    settlingSince,
    spendUnshownReported: o.spendUnshownReported === true,
    claimReported: o.claimReported === true,
    claimedAt,
  };
}

/** The escrow facts `watchStep` takes, or null when the engine gave no heights (never guessed). */
function escrowFacts(f: Funds): { funds: EscrowFunds; outgoing: Outgoing[]; claimed: boolean } | null {
  if (typeof f.chainHeight !== 'number' || !Array.isArray(f.outgoing)) return null;
  if (f.incoming.some((i) => i.height === undefined)) return null;
  return {
    funds: {
      balance: f.balance,
      unlocked: f.unlocked,
      chainHeight: f.chainHeight,
      incoming: f.incoming.map((i) => ({ txHash: i.txHash, amountAtomic: i.amountAtomic, height: i.height ?? null, unlocked: i.unlocked })),
    },
    outgoing: f.outgoing,
    // A trade party's sealed post-release info reached the party (lead decision b): only the
    // party's own record of opened, signed messages from the buyer or seller.
    claimed: Array.isArray(f.spendClaims) && f.spendClaims.some((r) => r === 'buyer' || r === 'seller'),
  };
}

/** What spendEvidence needs besides the wallet facts: the API's kind, this service's OWN terms, and the party's proof check. */
export interface SweepContext {
  /** settleKindFor(trade) from the API's watch list; null when the trade alone does not name it. */
  settleKind: SettleKind | null;
  /** The terms this service signed (signed_terms), never an API read. */
  terms: AttestedTerms;
  feeWallet: string;
  /** PartyHandle.proveSweep (absent: nothing shown only through an import is ever proven). */
  prove?: PartyHandle['proveSweep'];
  /**
   * Review round 2 (R2-I1 b): records the sweep tx for this trade (mod_sweeps, durable) and answers
   * whether it is this trade's: false when it was already counted for another trade. Absent: no record (tests of the pure parts).
   */
  claim?: (txHash: string) => Promise<boolean>;
  log: (e: { reason: string }) => void;
}

/**
 * The spend evidence `watchStep` may use. It is ONLY a tx this mod's own wallet records as spending
 * the escrow (Outgoing), and then only when either
 * - the mod's own party signed it (`ownTxs`: a release it co-signed, or built and saw done), or
 * - (review I1, 2026-10-29) it was shown only after importing a buyer's or seller's post-release
 *   multisig info (lead decision A: `spend.info`, packages/escrow party.ts) AND the tx key that party
 *   sent with it proves, through the mod's own wallet (`proveSweep`, monero check_tx_key), that the tx
 *   is in a block and pays at least `sweepMinimums` for the API's `settleKind`, computed from this
 *   service's OWN signed terms and fee wallet (never an API read).
 * Why the import alone is not proof: wallet2 builds the escrow's composite key image by adding the
 * peer's partial key images without checking them, and a trade party already holds every partial
 * but the mod's (it received the other signer's in the release's export round). It could therefore
 * send partials that make the mod's wallet attribute ANY in-block tx to the escrow. With the proof,
 * such a "forged" sweep is harmless: that tx really paid the right parties what they are owed.
 * Review round 2 (R2-I1): the proof is bound to THIS escrow (proveSweep is true only for a tx with
 * an input that spends one of this escrow's outputs: its key image as this wallet holds it, that
 * output in the ring), and a counted in-block tx is recorded for this trade (`claim`, mod_sweeps): a
 * tx already counted for another trade never counts here (`sweep-counted-elsewhere`).
 * Review round 3 (R3-I1): the binding alone is not enough, because the builder of ANOTHER trade's
 * release chooses its ring decoys (it can put this escrow's output in a ring and forge this mod's
 * partials to match). So an import-only sweep counts only when BOTH trade parties' sealed spend.info
 * name that tx hash (and one of their keys proves the minimums). This also closes R2-M1: neither
 * party alone (nor a compromised API naming the kind) can get a tx the other did not sign counted.
 * A tx hash seen in a block or reported by a party or the API never counts. Picks the oldest sweep
 * not yet counted, a block before the pool; one that cannot be proven is logged (`sweep-unproven`)
 * and skipped, so it never settles anything (the 6 h `spend-unshown` fallback escalates instead).
 */
export async function spendEvidence(f: Funds, state: WatchState, ctx: SweepContext): Promise<SpendEvidence | null> {
  const fresh = (f.outgoing ?? [])
    .filter((o) => !state.sweepTxs.includes(o.txHash))
    .sort((a, b) => (a.height ?? Number.MAX_SAFE_INTEGER) - (b.height ?? Number.MAX_SAFE_INTEGER));
  for (const o of fresh) {
    const evidence = { txHash: o.txHash, height: o.height, sweptAtomic: o.spentAtomic };
    const own = (f.ownTxs ?? []).includes(o.txHash);
    if (!own && !(o.height !== null && (await proven(o, f, ctx)))) {
      ctx.log({ reason: 'sweep-unproven' });
      continue;
    }
    // Round 2 (R2-I1 b): one tx counts for one trade only, whoever showed it (own txs too: a forged
    // attribution of trade A's mod-signed release to escrow B must not count for B).
    if (o.height !== null && ctx.claim && !(await ctx.claim(o.txHash))) {
      ctx.log({ reason: 'sweep-counted-elsewhere' });
      continue;
    }
    return evidence;
  }
  return null;
}

/**
 * mod_sweeps (migration 005): records `txHash` for `trade` unless another trade has it; true when it
 * is this trade's. A tx a shredded trade had counted (its tag in mod_sweeps_spent, 022) is never
 * this trade's (review lead-mod-purge M2: the rule outlives the shred).
 */
export async function claimSweep(db: pg.Pool, trade: string, txHash: string, keystoreKey: Uint8Array): Promise<boolean> {
  if ((await db.query('select 1 from mod_sweeps_spent where tag = $1', [sweepTag(keystoreKey, txHash)])).rows.length > 0) return false;
  await db.query('insert into mod_sweeps (tx_hash, trade) values ($1, $2) on conflict (tx_hash) do nothing', [txHash, trade]);
  const { rows } = await db.query<{ trade: string }>('select trade from mod_sweeps where tx_hash = $1', [txHash]);
  return rows[0]?.trade === trade;
}

async function proven(o: Outgoing, f: Funds, ctx: SweepContext): Promise<boolean> {
  if (ctx.settleKind === null || !ctx.prove || o.spentAtomic <= 0n) return false;
  let minimums;
  try {
    minimums = sweepMinimums({ kind: ctx.settleKind, terms: ctx.terms, feeWallet: ctx.feeWallet, sweptAtomic: o.spentAtomic });
  } catch {
    return false;
  }
  if (minimums === null) return false;
  // Round 3 (R3-I1, also R2-M1): BOTH trade parties' sealed spend.info must name this tx. A seller
  // who builds another trade's release picks its ring decoys, so it can put this escrow's output in
  // a ring and forge this mod's partial key images: the binding and the payout proof then pass for a
  // tx that paid another trade. A seller-buyer settlement is signed by both, and each sends its
  // spend.info with the hash; a forger cannot produce the other party's sealed statement.
  const naming = (f.spendProofs ?? []).filter((p) => p.txHash === o.txHash && (p.from === 'buyer' || p.from === 'seller'));
  if (!naming.some((p) => p.from === 'buyer') || !naming.some((p) => p.from === 'seller')) return false;
  // Either party's key may prove the minimums (one of them may have sent no key: '').
  for (const p of naming) {
    if (p.txKey === '') continue;
    if (await ctx.prove(o.txHash, p.txKey, minimums)) return true;
  }
  return false;
}

/**
 * The kind of a sweep this service's own party signed, by who built it (re-verify R2: the builder
 * names it): the buyer-built cancel, the seller-built auto-refund, or (Plan 4 Task 14, R-M2) a
 * mod-built ruling payout, whose kind only the ruling executor's record gives (`rulingKind`); null
 * when nothing names it (the API then refuses `settle-kind-unknown` and the watcher backs off).
 */
export function ownSweepKind(builder: string | null, rulingKind: RulingKind | null): SettleKind | RulingKind | null {
  if (builder === 'buyer') return 'buyer-cancel';
  if (builder === 'seller') return 'auto-refund';
  if (builder === 'mod') return rulingKind;
  return null;
}

/** `settledKind`: the kind a `settled` report counted the sweep for (security review 7 Nov, finding 3). */
const reportBody = (trade: string, r: WatchReport, settledKind: SettleKind | RulingKind | null): Record<string, unknown> => {
  if (r.kind === 'chain') {
    return { kind: 'chain', trade, receivedAtomic: r.receivedAtomic.toString(), unlockedAtomic: r.unlockedAtomic.toString(), confirmations: r.confirmations };
  }
  if (r.kind === 'settled') return { kind: 'settled', trade, txHash: r.txHash, settleKind: settledKind };
  if (r.kind === 'spend-unshown') return { kind: 'spend-unshown', trade };
  if (r.kind === 'release-claimed') return { kind: 'release-claimed', trade };
  return { kind: 'late-funds', trade };
};

const accepted = (r: { status: number; error: string | null }): boolean => r.status === 201 || r.status === 200 || (r.status === 409 && r.error === 'wrong-state');

export function createWatcher(o: WatcherOptions): Watcher {
  const running = new Map<string, PartyHandle>();
  const desks = new Map<string, Desk>();
  /** The ModPartyArgs each running party was started with (this service's own records: terms, fee wallet). */
  const argsOf = new Map<string, ModPartyArgs>();
  /** When this watcher started: the 6 h fallback waits WATCH_RESTART_GRACE_MS after it (review M3). */
  const upSince = o.now();
  const starting = new Map<string, Promise<void>>();
  /** settle-kind-unknown back-off per trade (in memory: a restart retries at once, then backs off again). */
  const backoff = new Map<string, { until: number; delayMs: number }>();
  let stopped = false;
  /** The pass's watch list and when it was read (security review 7 Nov, finding 1). */
  let snapshot: { items: Map<string, WatchItem>; at: Date } = { items: new Map(), at: new Date(0) };

  /**
   * The trade's watch item as the API shows it now (finding 1): the pass's list while it is at most
   * WATCH_FRESH_MS old, else the list read again (once, for every trade after it in this pass).
   * `unlisted` stands in for a trade the API no longer lists (closed here, review M6). Null when the
   * API cannot be read: then nothing is decided for the trade this pass.
   */
  const freshItem = async (code: string, unlisted: WatchItem | null): Promise<{ item: WatchItem; at: Date } | null> => {
    if (o.now().getTime() - snapshot.at.getTime() > WATCH_FRESH_MS) {
      const at = o.now();
      try {
        snapshot = { items: await o.link.pullWatch(), at };
      } catch {
        return null;
      }
    }
    const item = snapshot.items.get(code) ?? unlisted;
    return item === null ? null : { item, at: snapshot.at };
  };

  /** Opens the trade's desk (Task 10) if it is not open; a failure is retried on the next pass (review M2). */
  const ensureDesk = async (a: ModPartyArgs): Promise<void> => {
    if (!o.openDesk || desks.has(a.trade)) return;
    try {
      desks.set(a.trade, await o.openDesk(a));
    } catch {
      o.log({ reason: 'desk-open-failed' });
    }
  };

  const start = (a: ModPartyArgs): Promise<void> => {
    const code = a.trade;
    if (running.has(code)) return Promise.resolve();
    const inFlight = starting.get(code);
    if (inFlight) return inFlight;
    const p = (async () => {
      try {
        const handle = await o.startParty(a);
        if (stopped) {
          await handle.stop().catch(() => undefined);
          return;
        }
        running.set(code, handle);
        argsOf.set(code, a);
        await ensureDesk(a);
        handle.ready().then(
          async (address) => {
            await o.db.query('update mod_watch set escrow_address = coalesce(escrow_address, $2), updated_at = now() where trade = $1', [code, address]);
          },
          () => o.log({ reason: 'party-not-ready' }),
        ).catch(() => o.log({ reason: 'party-address-not-saved' }));
      } catch {
        o.log({ reason: 'party-start-failed' });
      } finally {
        starting.delete(code);
      }
    })();
    starting.set(code, p);
    return p;
  };

  const stopParty = async (code: string): Promise<void> => {
    const h = running.get(code);
    running.delete(code);
    const d = desks.get(code);
    desks.delete(code);
    await d?.stop().catch(() => undefined);
    argsOf.delete(code);
    await h?.stop().catch(() => undefined);
  };

  /** Posts the reports in order; true only when every one was accepted. */
  const post = async (code: string, reports: WatchReport[], settledKind: SettleKind | RulingKind | null): Promise<boolean> => {
    for (const r of reports) {
      const res = await o.link.report(reportBody(code, r, settledKind));
      if (accepted(res)) continue;
      if (res.error === 'settle-kind-unknown' || res.error === 'settle-kind-changed') {
        // The trade alone does not name the settlement's kind (a timed-out signing window), or no
        // longer names the kind this pass counted (re-verify R2): back off instead of asking every
        // pass; a later pass proves the sweep again against the kind then named.
        const prev = backoff.get(code);
        const delayMs = prev ? Math.min(prev.delayMs * 2, SETTLE_BACKOFF_MAX_MS) : SETTLE_BACKOFF_MS;
        backoff.set(code, { until: o.now().getTime() + delayMs, delayMs });
        o.log({ reason: res.error });
      } else {
        o.log({ reason: `watch-report-refused-${res.status}` });
      }
      return false;
    }
    return true;
  };

  const watchOne = async (row: Row, pulled: WatchItem, unlisted: WatchItem | null, handle: PartyHandle): Promise<boolean> => {
    const b = backoff.get(row.trade);
    if (b && o.now().getTime() < b.until) return true;
    const args = argsOf.get(row.trade);
    if (!args) return true; // unreachable: a running party always has its args
    const f = await handle.funds();
    const facts = escrowFacts(f);
    if (facts === null) {
      o.log({ reason: 'escrow-facts-incomplete' });
      return true;
    }
    const state = reviveWatchState(row.state);
    // Defence in depth (Task 10 review round 2, R2-M1 note): a refund kind the API names is proven
    // against only when this trade's desk saw its cause (`sweepKindAgrees`); otherwise no proof counts.
    // With desks configured, a desk that failed to open again counts as one that saw nothing (fail safe:
    // a refund kind is not proven without it; `release`/`mutual-cancel` are unaffected).
    await ensureDesk(args);
    const deskNow = desks.get(row.trade);
    const settleKind =
      deskNow ? deskNow.sweepKind(pulled.settleKind)
      : o.openDesk ? (sweepKindAgrees(NO_DESK_FACTS, pulled.settleKind) ? pulled.settleKind : null)
      : pulled.settleKind;
    if (settleKind !== pulled.settleKind && (f.outgoing ?? []).some((x) => !state.sweepTxs.includes(x.txHash))) o.log({ reason: 'sweep-kind-vetoed' });
    const spend = await spendEvidence(f, state, {
      settleKind,
      terms: args.terms,
      feeWallet: args.feeWallet,
      ...(handle.proveSweep ? { prove: (h, k, m) => handle.proveSweep!(h, k, m) } : {}),
      claim: (txHash) => claimSweep(o.db, row.trade, txHash, o.keystoreKey),
      log: o.log,
    });
    // The wallet sync and the proof above can take long (finding 1): the trade's state and pause
    // that decide the reports and the desk are read again when the list is no longer fresh.
    const fresh = await freshItem(row.trade, unlisted);
    if (fresh === null) {
      o.log({ reason: 'watch-list-stale' });
      return true;
    }
    const item = fresh.item;
    const step = watchStep({
      trade: { state: item.state as TradeState, paused: item.paused },
      funds: facts.funds,
      spend,
      state,
      now: o.now(),
      claimed: facts.claimed,
      upSince,
    });
    // Finding 3: `settled` names the kind this pass counted the sweep for: the kind it was proven
    // against, or for the mod's own tx the outcome its party actually committed to (re-verify R2:
    // the desk only hands the seller-built auto-refund and the buyer-built cancel, so the builder
    // names it; the armed kind can differ, R4-M2), else this desk's armed refund, else the API's
    // kind as just read. The API refuses it (409 settle-kind-changed) when the trade no longer names that kind.
    const own = spend !== null && (f.ownTxs ?? []).includes(spend.txHash);
    // Review I3 (late-funds step 1): the tx's own release's builder (an older release of this escrow
    // may be named while a later one is committed), else the committed one (a party without builderOf).
    const builder = own ? (handle.builderOf ? handle.builderOf(spend.txHash) : (handle.committedBuilder?.() ?? null)) : null;
    // Plan 4 Task 14 (R-M2): a mod-built sweep is a ruling's payout, named by the executor's own record.
    const signedKind = ownSweepKind(builder, builder === 'mod' ? (o.rulingKind?.(row.trade) ?? null) : null);
    // Review M4: a mod-built sweep is named by the executor's record or by nothing (the API then
    // refuses settle-kind-unknown and the watcher backs off), never by the desk or the API.
    const settledKind = own ? (builder === 'mod' ? signedKind : (signedKind ?? deskNow?.record().armed?.kind ?? item.settleKind)) : settleKind;
    if (!(await post(row.trade, step.reports, settledKind))) return true;
    // Review B1, M2: a lien recovery signed for this trade stops counting once it can no longer be
    // paid: a sweep counted here for a kind that never pays it (a refund), or a watch that ends with
    // no coin ever received. A release, a ruling for the buyer, or a kind nothing names keeps it.
    if (step.reports.some((r) => r.kind === 'settled') && settledKind !== null) {
      if (!PAYS_RECOVERY.has(settledKind)) await freeLienRecoveries(o.db, row.trade);
      // M2: late coins on a refunded trade, then paid out for the buyer: the recovery was paid after all.
      else await unfreeLienRecoveries(o.db, row.trade);
    }
    if (!step.watching && neverFunded(step.state)) await freeLienRecoveries(o.db, row.trade);
    // Task 10: the desk sees the same accepted facts, then decides the refunds the moderator signs alone.
    await ensureDesk(args);
    const desk = desks.get(row.trade);
    if (desk) {
      await desk
        .step({
          handle,
          api: item,
          escrowAddress: row.escrow_address,
          reports: step.reports,
          chain: step.state.closedAt === null ? step.state.lastChain : null,
          settledTx: step.state.settledTx,
          funds: { balance: facts.funds.balance, unlocked: facts.funds.unlocked },
          apiAt: fresh.at,
          refresh: () => freshItem(row.trade, unlisted),
          rulingRecorded: (o.rulingKind?.(row.trade) ?? null) !== null,
        })
        .catch(() => o.log({ reason: 'desk-step-failed' }));
    }
    if (o.executeRuling) {
      await o
        .executeRuling({
          code: row.trade,
          handle,
          api: item,
          funds: { balance: facts.funds.balance, unlocked: facts.funds.unlocked },
          args,
          shadow: desks.get(row.trade)?.record().shadow ?? null,
          deskArmed: desks.get(row.trade)?.record().armed ?? null,
          escrowAddress: row.escrow_address,
        })
        .catch(() => o.log({ reason: 'ruling-step-failed' }));
    }
    if (step.closeChannels) {
      for (const kind of ['escrow', 'signals'] as const) {
        const status = await o.link.closeChannel(await channelFor(row.trade, kind));
        if (status !== 200) {
          o.log({ reason: `relay-close-failed-${status}` });
          return true;
        }
      }
    }
    if (b) backoff.delete(row.trade);
    // Only over the version this pass read (security review 7 Nov, finding 2): a stale process drops
    // its state instead of rolling back a newer process's (every report above is safe to repeat).
    const saved = await o.db.query('update mod_watch set state = $2, watching = $3, version = version + 1, updated_at = now() where trade = $1 and version = $4', [
      row.trade, JSON.stringify(dumpWatchState(step.state)), step.watching, row.version,
    ]);
    if (saved.rowCount === 0) {
      o.log({ reason: 'watch-state-stale' });
      return true;
    }
    return step.watching;
  };

  /** One watcher pass (run one at a time through `tick`). */
  const pass = async (): Promise<void> => {
    let api: Map<string, WatchItem>;
    const pulledAt = o.now(); // before the read: the list is never taken as newer than it is
    try {
      api = await o.link.pullWatch();
    } catch {
      o.log({ reason: 'watch-unavailable' });
      return;
    }
    snapshot = { items: api, at: pulledAt };
    // Every trade whose attestation was posted has a watch row, even if the process stopped
    // between posting it and registering the party (the trade is no longer work after that).
    await o.db.query(
      `insert into mod_watch (trade, state) select trade, $1 from signed_terms where posted_at is not null on conflict (trade) do nothing`,
      [JSON.stringify(dumpWatchState(newWatchState()))],
    );
    const { rows } = await o.db.query<Row>('select trade, escrow_address, setup_done_at, state, watching, version from mod_watch where watching order by trade');
    for (const row of rows) {
      if (stopped) return;
      let item = api.get(row.trade);
      let unlisted: WatchItem | null = null;
      if (item === undefined) {
        // Not listed. Not yet (a race with a fresh attestation): nothing to decide. Any more (review
        // M6): the API lists every open attested trade, so an unlisted one this watcher saw close is
        // closed, and its watch still runs out its own 30 days (late coins in that gap are still
        // reported). watchStep treats every closed state alike.
        let closedHere = false;
        try {
          closedHere = reviveWatchState(row.state).closedAt !== null;
        } catch {
          closedHere = false;
        }
        if (!closedHere) continue;
        item = { state: 'cancelled', chat: null, settleKind: null, paused: false };
        unlisted = item;
      }
      const apiState = item.state as TradeState;
      try {
        let watching = row.watching;
        const plan = modPartyPlan({
          attested: true,
          running: running.has(row.trade),
          escrowAddress: row.escrow_address,
          setupDoneReported: row.setup_done_at !== null,
          apiState,
          watching,
        });
        if (plan.stop) {
          let coinless = true;
          try {
            coinless = neverFunded(reviveWatchState(row.state));
          } catch {
            coinless = false;
          }
          if (coinless) await freeLienRecoveries(o.db, row.trade);
          await stopParty(row.trade);
          await o.db.query('update mod_watch set watching = false, updated_at = now() where trade = $1', [row.trade]);
          o.log({ reason: 'party-stopped' });
          continue;
        }
        // Review lead-mod-purge M1: a trade the API shows closed before any escrow address existed
        // here has nothing to watch. modPartyPlan stops only a running party, so after a restart such
        // a row would watch for good; it stops watching the same way.
        if (!plan.start && !running.has(row.trade) && !starting.has(row.trade) && row.escrow_address === null && CLOSED_STATES.includes(apiState as (typeof CLOSED_STATES)[number])) {
          await o.db.query('update mod_watch set watching = false, updated_at = now() where trade = $1', [row.trade]);
          o.log({ reason: 'watch-ended-no-escrow' });
          continue;
        }
        if (plan.start) {
          const args = await o.argsFor(row.trade);
          if (args === null) {
            o.log({ reason: 'party-state-missing' });
            continue;
          }
          await start(args);
        }
        if (plan.reportSetupDone !== null) {
          const res = await o.link.report({ kind: 'setup-done', trade: row.trade, escrowAddress: plan.reportSetupDone });
          if (accepted(res)) {
            await o.db.query('update mod_watch set setup_done_at = now(), updated_at = now() where trade = $1', [row.trade]);
          } else {
            o.log({ reason: `setup-done-refused-${res.status}` });
          }
          continue;
        }
        const handle = running.get(row.trade);
        if (!handle || row.escrow_address === null) continue;
        if (row.setup_done_at === null) {
          // Still in setup: setup-done has not been accepted yet. Past setup: the API took it
          // (we may have stopped before recording that), so record it and watch.
          if (apiState === 'setup') continue;
          await o.db.query('update mod_watch set setup_done_at = now(), updated_at = now() where trade = $1', [row.trade]);
        }
        watching = await watchOne(row, item, unlisted, handle);
        if (!watching) {
          await stopParty(row.trade);
          o.log({ reason: 'watch-ended' });
        }
      } catch {
        o.log({ reason: 'watch-failed' });
      }
    }
  };
  let ticking: Promise<void> = Promise.resolve();

  return {
    async runParty(a) {
      await o.db.query('insert into mod_watch (trade, state) values ($1, $2) on conflict (trade) do nothing', [
        a.trade, JSON.stringify(dumpWatchState(newWatchState())),
      ]);
      await start(a);
    },

    tick() {
      // One pass at a time, whoever asks (the loop or the test-only watch(); finding 2).
      const next = ticking.then(() => pass());
      ticking = next.catch(() => undefined);
      return next;
    },

    between(fn) {
      const next = ticking.then(fn);
      ticking = next.then(() => undefined, () => undefined);
      return next;
    },

    active(code) {
      return running.has(code) || starting.has(code);
    },

    async stop() {
      stopped = true;
      await ticking;
      await Promise.all([...starting.values()]);
      await Promise.all([...running.keys()].map((c) => stopParty(c)));
    },
  };
}
