import type { Outgoing, PartyHandle } from '@x2f/escrow';
import {
  channelFor,
  modPartyPlan,
  newWatchState,
  watchStep,
  type EscrowFunds,
  type ModPartyArgs,
  type SpendEvidence,
  type TradeState,
  type WatchReport,
  type WatchState,
} from '@x2f/trade';
import type pg from 'pg';
import type { Link } from './link.js';

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
}

export interface Watcher {
  /** Registers and starts the party for a freshly attested trade (once per process). */
  runParty(a: ModPartyArgs): Promise<void>;
  /** One watcher pass. */
  tick(): Promise<void>;
  /** Stops every running party. */
  stop(): Promise<void>;
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
function escrowFacts(f: Awaited<ReturnType<PartyHandle['funds']>>): { funds: EscrowFunds; outgoing: Outgoing[]; claimed: boolean } | null {
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

/**
 * The spend evidence `watchStep` may use. It is ONLY a tx this mod's own wallet records as spending
 * the escrow (Outgoing): one it co-signed, or one it found by its own key images after importing a
 * party's post-release multisig info (lead decision A, 2026-10-29: a buyer or seller whose release
 * is done sends `spend.info` on the escrow channel until the mod's party acks; the party syncs and
 * imports it, packages/escrow party.ts). A tx hash seen in a block or reported by a party or the API
 * never counts (coordination.md, Task 9 I/O notes): the info only completes key images for this
 * wallet's own outputs, and the wallet then finds those key images among the inputs of txs in blocks,
 * so a forged or wrong info cannot show a spend that did not happen (at worst it shows nothing, and
 * the 6 h `spend-unshown` fallback in watchStep escalates). Picks the oldest sweep not yet counted,
 * a block before the pool.
 */
export function spendEvidence(outgoing: readonly Outgoing[], state: WatchState): SpendEvidence | null {
  const fresh = outgoing
    .filter((o) => !state.sweepTxs.includes(o.txHash))
    .sort((a, b) => (a.height ?? Number.MAX_SAFE_INTEGER) - (b.height ?? Number.MAX_SAFE_INTEGER));
  const o = fresh[0];
  return o ? { txHash: o.txHash, height: o.height, sweptAtomic: o.spentAtomic } : null;
}

const reportBody = (trade: string, r: WatchReport): Record<string, unknown> => {
  if (r.kind === 'chain') {
    return { kind: 'chain', trade, receivedAtomic: r.receivedAtomic.toString(), unlockedAtomic: r.unlockedAtomic.toString(), confirmations: r.confirmations };
  }
  if (r.kind === 'settled') return { kind: 'settled', trade, txHash: r.txHash };
  if (r.kind === 'spend-unshown') return { kind: 'spend-unshown', trade };
  if (r.kind === 'release-claimed') return { kind: 'release-claimed', trade };
  return { kind: 'late-funds', trade };
};

const accepted = (r: { status: number; error: string | null }): boolean => r.status === 201 || r.status === 200 || (r.status === 409 && r.error === 'wrong-state');

export function createWatcher(o: WatcherOptions): Watcher {
  const running = new Map<string, PartyHandle>();
  const starting = new Map<string, Promise<void>>();
  /** settle-kind-unknown back-off per trade (in memory: a restart retries at once, then backs off again). */
  const backoff = new Map<string, { until: number; delayMs: number }>();
  let stopped = false;

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
    await h?.stop().catch(() => undefined);
  };

  /** Posts the reports in order; true only when every one was accepted. */
  const post = async (code: string, reports: WatchReport[]): Promise<boolean> => {
    for (const r of reports) {
      const res = await o.link.report(reportBody(code, r));
      if (accepted(res)) continue;
      if (res.error === 'settle-kind-unknown') {
        // The trade alone does not name the settlement's kind (a timed-out signing window); the
        // API cannot decide it yet. Back off instead of asking every pass.
        const prev = backoff.get(code);
        const delayMs = prev ? Math.min(prev.delayMs * 2, SETTLE_BACKOFF_MAX_MS) : SETTLE_BACKOFF_MS;
        backoff.set(code, { until: o.now().getTime() + delayMs, delayMs });
        o.log({ reason: 'settle-kind-unknown' });
      } else {
        o.log({ reason: `watch-report-refused-${res.status}` });
      }
      return false;
    }
    return true;
  };

  const watchOne = async (row: Row, apiState: TradeState, handle: PartyHandle): Promise<boolean> => {
    const b = backoff.get(row.trade);
    if (b && o.now().getTime() < b.until) return true;
    const facts = escrowFacts(await handle.funds());
    if (facts === null) {
      o.log({ reason: 'escrow-facts-incomplete' });
      return true;
    }
    const state = reviveWatchState(row.state);
    const step = watchStep({ trade: { state: apiState }, funds: facts.funds, spend: spendEvidence(facts.outgoing, state), state, now: o.now(), claimed: facts.claimed });
    if (!(await post(row.trade, step.reports))) return true;
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
    await o.db.query('update mod_watch set state = $2, watching = $3, updated_at = now() where trade = $1', [
      row.trade, JSON.stringify(dumpWatchState(step.state)), step.watching,
    ]);
    return step.watching;
  };

  return {
    async runParty(a) {
      await o.db.query('insert into mod_watch (trade, state) values ($1, $2) on conflict (trade) do nothing', [
        a.trade, JSON.stringify(dumpWatchState(newWatchState())),
      ]);
      await start(a);
    },

    async tick() {
      let api: Map<string, string>;
      try {
        api = await o.link.pullWatch();
      } catch {
        o.log({ reason: 'watch-unavailable' });
        return;
      }
      // Every trade whose attestation was posted has a watch row, even if the process stopped
      // between posting it and registering the party (the trade is no longer work after that).
      await o.db.query(
        `insert into mod_watch (trade, state) select trade, $1 from signed_terms where posted_at is not null on conflict (trade) do nothing`,
        [JSON.stringify(dumpWatchState(newWatchState()))],
      );
      const { rows } = await o.db.query<Row>('select trade, escrow_address, setup_done_at, state, watching from mod_watch where watching order by trade');
      for (const row of rows) {
        if (stopped) return;
        const apiState = api.get(row.trade) as TradeState | undefined;
        if (apiState === undefined) continue; // not listed (yet, or any more): nothing to decide
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
            await stopParty(row.trade);
            await o.db.query('update mod_watch set watching = false, updated_at = now() where trade = $1', [row.trade]);
            o.log({ reason: 'party-stopped' });
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
          watching = await watchOne(row, apiState, handle);
          if (!watching) {
            await stopParty(row.trade);
            o.log({ reason: 'watch-ended' });
          }
        } catch {
          o.log({ reason: 'watch-failed' });
        }
      }
    },

    async stop() {
      stopped = true;
      await Promise.all([...starting.values()]);
      await Promise.all([...running.keys()].map((c) => stopParty(c)));
    },
  };
}
