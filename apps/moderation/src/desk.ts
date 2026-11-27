import type { Outcome, PartyHandle, Payout, Transport } from '@x2f/escrow';
import { ReplayGuard, type Envelope, type ReplayGuardJSON } from '@x2f/protocol';
import { CLOSED_STATES, attestedSellerRecovery, channelFor, payoutsFor, settleKindFor, type ChainFacts, type ModPartyArgs, type SettleKind, type Trade, type TradeEvent, type WatchReport } from '@x2f/trade';
import type pg from 'pg';
import { apiShowsSellerCancel, autoRefundStep, PAID_CONFLICT_MS } from './autoRefund.js';
import { apiAllows, buyerCancelStep } from './buyerCancel.js';
import type { Link } from './link.js';
import { applyShadow, fromJson, newShadow, toJson } from './shadow.js';
import { readSignal, sealAck, signalLoop, termsMatch, type ModSignal } from './signals.js';

/**
 * One trade's moderator desk (Plan 3 Task 10): the signals channel, the shadow trade, and the only
 * two refunds the moderator signs alone (plus Plan 4's rulings, refused in this plan, rulings.ts).
 *
 * - Signals: every frame on `channelFor(code, 'signals')` is opened as `mod` with the channel's own
 *   ReplayGuard, read against the shared schema, folded into the desk record and SAVED before it is
 *   acted on or acked (the ack's seq is saved before it leaves). `trade.terms` is kept only when its
 *   address and deal equal what this service attested; the seller's is stored in
 *   `signed_terms.seller_terms` and is the only refund address ever paid (`recordedRefundAddress`).
 * - The shadow trade is fed only by the watcher's own facts (setup-done, chain, settled) and by
 *   signals opened here (`apply` on this service's clock). A seller's extend or refund request that
 *   arrives before the shadow's own payBy is retried each pass, so the moderator checks the time to
 *   pay on its own facts (owner 8 Nov: the seller's cancel then starts the refund at once).
 * - Each watcher pass (`step`), after its reports were accepted: buyer cancel first (a valid
 *   `trade.cancel` from the buyer's identity that the shadow took, never after a `trade.paid`,
 *   buyerCancel.ts), else the auto-refund guard (autoRefund.ts), which also runs while a cancel
 *   waits, so its escalation fallback is never blocked (review M3), and while an armed cancel is not
 *   being settled at the API (review round 3 R3-N1: it may then re-arm as the auto-refund). A refund
 *   once armed is kept (but for that re-arm); its payouts are derived again from the balance this party reads, and
 *   `settle` is called again only when they change (a late surplus before signing) or after a
 *   restart. The moderator never takes payouts from a tx set or the API: `settle` co-signs only a
 *   set equal to the outcome derived here (Plan 1).
 * - Once the shadow or the API shows the trade closed, or this pass showed a sweep, nothing more is
 *   signed here (late coins go to a person, P3-I6; review M4).
 * - The shadow catches up every pass from the watcher's latest chain facts and shown sweep, so a
 *   pass whose desk step failed loses nothing (review M2).
 */
export interface DeskRecord {
  v: 1;
  guard: ReplayGuardJSON;
  /** The moderator's last signals seq (saved before each ack leaves). */
  seq: number;
  /** Null only when the attested deal could not make a trade (then nothing is ever signed alone). */
  shadow: Trade | null;
  /** A valid `trade.paid` from the buyer's identity was opened (ever): no auto-refund after that. */
  paidSeen: boolean;
  /** When the first `trade.paid` was opened (this service's clock). */
  paidSeenAt: Date | null;
  /** A valid `trade.cancel` from the buyer's identity was opened and the shadow took it (review I3). */
  cancelSeen: boolean;
  /** The seller-signed refund address (equal to the attested one), or null before it arrived. */
  sellerRefund: string | null;
  /** The buyer-signed payout address (equal to the attested one), or null before it arrived. */
  buyerPayout: string | null;
  /** Seller events the shadow refused `too-early` (signal before the shadow's own deadline), retried each pass; at most one of each (review M5). */
  pending: Array<'extend' | 'request-refund'>;
  /**
   * The refund this service decided to co-sign alone; kept for good. `blocked` (an armed auto-refund
   * only, security review 7 Nov finding 1 c): why it is not handed to the party this pass, or absent.
   */
  armed: { kind: 'auto-refund' | 'buyer-cancel'; at: Date; blocked?: string | null } | null;
  /** The escalation report the API accepted (then nothing more is decided here). */
  escalated: string | null;
  /** When this service first saw the API show the seller's cancel (`settling` / `auto-refund`); restarts while the API trade is paused (review M7). */
  apiRefundSince: Date | null;
}

export interface DeskStep {
  handle: PartyHandle;
  /** The API's watch-list item: its state and settlement kind, and maintenance (`paused`). */
  api: { state: string; settleKind?: string | null; paused?: boolean };
  escrowAddress: string | null;
  /** The watcher reports this pass posted (all accepted). */
  reports: readonly WatchReport[];
  /** The watcher's latest chain facts for the open trade (its state after this pass), for the catch-up (review M2). */
  chain?: ChainFacts | null;
  /** The sweep this service's own watcher showed (and proved), or null. */
  settledTx?: string | null;
  /** The escrow as this pass read it from the party. */
  funds: { balance: bigint; unlocked: bigint };
  /**
   * When `api` was read from the API (security review 7 Nov, finding 1): every API-dependent
   * condition is judged at this time, not at the step's. Absent: the step's own time.
   */
  apiAt?: Date;
  /** Reads the trade from the API again; null when the API could not be read (or no longer lists it). */
  refresh?: () => Promise<{ item: DeskStep['api']; at: Date } | null>;
  /**
   * Security review 2026-11-12 M5: the ruling executor has recorded a payout for this trade (sealed
   * in gate.bin). The desk then arms and hands nothing for it, ever: the party would otherwise trade
   * the ruling's uncommitted payout for a refund (the executor, in turn, waits while an armed
   * refund here is not blocked).
   */
  rulingRecorded?: boolean;
}

/**
 * The oldest watch item the desk arms or escalates on (security review 7 Nov, finding 1): an older
 * one is read again first (`refresh`), and nothing is armed or escalated when that fails.
 */
export const WATCH_FRESH_MS = 10_000;

/** Blocks an armed auto-refund for good: the buyer paid, at the API or by a signal this service opened. */
const FINAL_BLOCKS: readonly string[] = ['auto-refund-buyer-paid', 'auto-refund-api-paid', 'auto-refund-api-disputed'];

/**
 * The per-pass recheck of an armed auto-refund (security review 7 Nov, finding 1 c), like the armed
 * buyer cancel's (review round 2 N2): why it must not be handed to the party now, or null. A
 * `trade.paid` opened here, or the API showing the trade paid or disputed (a buyer who paid late
 * may dispute the seller's cancel at once, owner 8 Nov p9-2), blocks it for good; a pause or any
 * API state but the seller's cancel (`settling` / `auto-refund`) blocks it while they hold. `at`
 * (when the API facts were read) is kept for the callers' freshness rule. R3-M1 still applies: an
 * outcome already handed to the party in this process is not withdrawn, but a restart then stops it.
 */
export function armedRefundBlock(r: Pick<DeskRecord, 'paidSeen' | 'armed' | 'shadow'>, api: DeskStep['api'], _at: Date): string | null {
  if (r.paidSeen) return 'auto-refund-buyer-paid';
  const was = r.armed?.blocked ?? null;
  if (was !== null && FINAL_BLOCKS.includes(was)) return was;
  if (api.state === 'paid') return 'auto-refund-api-paid';
  if (api.state === 'disputed') return 'auto-refund-api-disputed';
  if (api.paused === true || (r.shadow !== null && r.shadow.pausedAt !== null)) return 'auto-refund-paused';
  if (!apiShowsSellerCancel(api)) return 'auto-refund-api-state';
  return null;
}

export interface Desk {
  step(s: DeskStep): Promise<void>;
  /** Waits for the frame or step in progress, then stops the signals channel. */
  stop(): Promise<void>;
  /** A copy of the current record (tests). */
  record(): DeskRecord;
  /**
   * The settlement kind a shown sweep may be proven against (defence in depth for Task 9 R2-M1): the
   * API's kind when this desk's own facts agree with it, else null (the sweep stays unproven and the
   * 6 h `spend-unshown` fallback escalates). See `sweepKindAgrees`.
   */
  sweepKind(apiKind: SettleKind | null): SettleKind | null;
}

/**
 * Do this desk's own facts allow a sweep of `kind` (review round 2, R2-M1 note)? A refund kind only
 * when this service saw its cause: `auto-refund` only if this desk armed the auto-refund,
 * `buyer-cancel` only after a buyer's `trade.cancel` the shadow took and no `trade.paid`,
 * `lapse-refund` only once the shadow itself lapsed. Once this desk armed a refund, no other kind.
 * `release` and `mutual-cancel` are not checked otherwise: the shadow gets no signal for either
 * (owed under Task 9 R2-M1: a seller-signed `trade.release` and a both-signed cancel accept).
 * Known limit (review round 3 R3-M2): the shadow's `fundBy` counts from this service's own
 * setup-done, so it is later than the API's by the pass and ready delay (or a mod outage). Funds that
 * land in that gap leave the API `lapsed` while the shadow goes on to securing/secured and never
 * lapses, so the parties' honest `lapse-refund` is vetoed for good (`sweep-kind-vetoed`) and the 6 h
 * `spend-unshown` fallback sends it to a person. Fail safe and rare: no coin is lost or misdirected.
 */
export function sweepKindAgrees(r: Pick<DeskRecord, 'armed' | 'cancelSeen' | 'paidSeen' | 'shadow'>, kind: SettleKind | null): boolean {
  if (kind === null) return true;
  if (r.armed !== null && r.armed.kind !== kind) return false;
  switch (kind) {
    case 'auto-refund':
      return r.armed?.kind === 'auto-refund';
    case 'buyer-cancel':
      return r.cancelSeen && !r.paidSeen;
    case 'lapse-refund':
      return r.shadow !== null && r.shadow.lapsedAt !== null;
    default:
      return true;
  }
}

/** The facts of a desk that saw nothing (one that could not be opened): no refund kind agrees. */
export const NO_DESK_FACTS: Pick<DeskRecord, 'armed' | 'cancelSeen' | 'paidSeen' | 'shadow'> = { armed: null, cancelSeen: false, paidSeen: false, shadow: null };

export interface DeskOptions {
  db: pg.Pool;
  args: ModPartyArgs;
  feeWallet: string;
  /** X2F's payroll wallet: the other half of the 1% (owner 26 Nov). */
  payrollWallet: string;
  transport: Transport;
  link: Link;
  now: () => Date;
  log: (e: { reason: string }) => void;
}

const ROUTE: Record<'auto-refund' | 'buyer-cancel', { builder: 'seller' | 'buyer' }> = {
  'auto-refund': { builder: 'seller' },
  'buyer-cancel': { builder: 'buyer' },
};

const CLOSED: readonly string[] = CLOSED_STATES;

const accepted = (r: { status: number; error: string | null }): boolean => r.status === 201 || r.status === 200 || (r.status === 409 && r.error === 'wrong-state');

/** The fee marks are part of what the tx pays (owner 16 Nov), so they are part of the key (review B3). */
const outcomeKey = (o: Outcome): string =>
  JSON.stringify([o.builder, o.cosigner, o.to.map((p) => [p.address, p.amountAtomic.toString(), p.bearsNetworkFee === true])]);

/**
 * A shadow saved before the owner's 8 Nov reversal (no final alert) may sit in the retired
 * `refund_requested` state, or settle from it. It goes back to `secured`, as the API's migration
 * 120 moves those trades (the seller cancels again and the refund then starts at once), and the
 * retired `finalAlertAt` field is dropped. Nothing else changes.
 */
export function reviveShadow(t: Trade | null): Trade | null {
  if (t === null) return null;
  const old = t as Omit<Trade, 'state' | 'settleFrom'> & { state: string; settleFrom: string | null; finalAlertAt?: unknown };
  if (old.state !== 'refund_requested' && old.settleFrom !== 'refund_requested' && !('finalAlertAt' in old)) return t;
  const { finalAlertAt: _drop, ...rest } = old;
  return {
    ...rest,
    state: old.state === 'refund_requested' ? 'secured' : t.state,
    settleFrom: old.settleFrom === 'refund_requested' ? 'secured' : t.settleFrom,
  };
}

async function loadRecord(db: pg.Pool, trade: string): Promise<{ record: DeskRecord; version: string } | null> {
  const { rows } = await db.query<{ record: unknown; version: string }>('select record, version from mod_trade_desk where trade = $1', [trade]);
  if (!rows[0]) return null;
  const r = fromJson(rows[0].record) as DeskRecord;
  return { record: { ...r, paidSeenAt: r.paidSeenAt ?? null, shadow: reviveShadow(r.shadow) }, version: rows[0].version };
}

/** Review p4t22 M2: the trade's shadow as this desk last saved it (also once the desk is closed), or null. */
export async function deskShadow(db: pg.Pool, trade: string): Promise<Trade | null> {
  return (await loadRecord(db, trade))?.record.shadow ?? null;
}

/** A save refused because another process wrote the desk record since this one read it (finding 2). */
export class StaleDeskRecord extends Error {
  constructor() {
    super('desk record changed by another process');
    this.name = 'StaleDeskRecord';
  }
}

export async function openDesk(o: DeskOptions): Promise<Desk> {
  const code = o.args.trade;
  const terms = o.args.terms;
  const channel = await channelFor(code, 'signals');
  let loaded = await loadRecord(o.db, code);
  if (loaded === null) {
    let shadow: Trade | null = null;
    try {
      shadow = newShadow(code, terms, o.now());
    } catch {
      o.log({ reason: 'shadow-unavailable' });
    }
    const { rows } = await o.db.query<{ seller_terms: { address: string } | null; buyer_terms: { address: string } | null }>(
      'select seller_terms, buyer_terms from signed_terms where trade = $1',
      [code],
    );
    const rec: DeskRecord = {
      v: 1,
      guard: { trade: channel, seen: {} },
      seq: 0,
      shadow,
      paidSeen: false,
      paidSeenAt: null,
      cancelSeen: false,
      sellerRefund: rows[0]?.seller_terms?.address ?? null,
      buyerPayout: rows[0]?.buyer_terms?.address ?? null,
      pending: [],
      armed: null,
      escalated: null,
      apiRefundSince: null,
    };
    await o.db.query('insert into mod_trade_desk (trade, record) values ($1, $2) on conflict (trade) do nothing', [code, JSON.stringify(toJson(rec))]);
    loaded = (await loadRecord(o.db, code))!;
  }
  let record: DeskRecord = loaded.record;
  /** The row's version `record` was read at or last saved as (security review 7 Nov, finding 2). */
  let version: string = loaded.version;

  let chain: Promise<void> = Promise.resolve();
  let stopped = false;
  const run = (fn: () => Promise<void>): Promise<void> => {
    const next = chain.then(() => (stopped ? undefined : fn()));
    chain = next.catch(() => undefined);
    return next;
  };

  const save = async (r: DeskRecord, extra?: (c: pg.PoolClient) => Promise<void>): Promise<void> => {
    const client = await o.db.connect();
    try {
      await client.query('begin');
      if (extra) await extra(client);
      // Only over the version this desk read (finding 2): a stale process never overwrites a newer row.
      const { rows } = await client.query<{ version: string }>(
        'update mod_trade_desk set record = $2, version = version + 1, updated_at = now() where trade = $1 and version = $3 returning version',
        [code, JSON.stringify(toJson(r)), version],
      );
      if (!rows[0]) throw new StaleDeskRecord();
      await client.query('commit');
      version = rows[0].version;
    } catch (e) {
      await client.query('rollback').catch(() => undefined);
      if (e instanceof StaleDeskRecord) {
        // Another process wrote this record: drop this desk's state and take the newer row.
        o.log({ reason: 'desk-record-stale' });
        const fresh = await loadRecord(o.db, code).catch(() => null);
        if (fresh !== null) {
          record = fresh.record;
          version = fresh.version;
        }
      }
      throw e;
    } finally {
      client.release();
    }
    record = r;
  };

  // Nudges are optional (owner 8 Nov, p6-1): the machine's request-refund no longer reads
  // `sellerNudgedAt`, so the shadow takes the seller's signal as it is (lead decision (a)'s
  // synthetic nudge is gone). The shadow still checks payBy (the time to pay) itself.
  const feed = (t: Trade | null, e: TradeEvent, by: 'buyer' | 'seller' | 'system', now: Date): { trade: Trade | null; refused: string | null } => {
    if (t === null) return { trade: null, refused: 'no-shadow' };
    return applyShadow(t, e, by, now);
  };

  /** One signal frame: open, fold in, save, then ack. */
  const onFrame = async (raw: unknown): Promise<void> => {
    const guard = ReplayGuard.from(record.guard);
    const read = await readSignal(raw, { channel, me: o.args.me, participants: o.args.participants, guard });
    const guardNow = guard.toJSON();
    if (!read.ok) {
      if (JSON.stringify(guardNow) !== JSON.stringify(record.guard)) await save({ ...record, guard: guardNow });
      o.log({ reason: `signal-${read.reason}` });
      return;
    }
    const s: ModSignal = read.signal;
    const now = o.now();
    let next: DeskRecord = { ...record, guard: guardNow };
    let extra: ((c: pg.PoolClient) => Promise<void>) | undefined;
    switch (s.type) {
      case 'trade.terms': {
        if (!termsMatch(s, terms)) {
          await save(next);
          o.log({ reason: 'signal-terms-mismatch' });
          return; // never adopted and never acked: the sender keeps resending its terms
        }
        const column = s.from === 'seller' ? 'seller_terms' : 'buyer_terms';
        if (s.from === 'seller' && next.sellerRefund === null) next = { ...next, sellerRefund: s.address };
        if (s.from === 'buyer' && next.buyerPayout === null) next = { ...next, buyerPayout: s.address };
        const kept = { address: s.address, envelope: raw as Envelope };
        extra = async (c) => {
          await c.query(`update signed_terms set ${column} = coalesce(${column}, $2) where trade = $1`, [code, JSON.stringify(kept)]);
        };
        break;
      }
      case 'trade.paid': {
        next = { ...next, paidSeen: true, paidSeenAt: next.paidSeenAt ?? now };
        const r = feed(next.shadow, { type: 'mark-paid', fiatCents: s.fiatCents }, 'buyer', now);
        next = { ...next, shadow: r.trade };
        if (r.refused) o.log({ reason: `shadow-mark-paid-${r.refused}` });
        break;
      }
      case 'trade.cancel': {
        // Counted only when the shadow takes it (review I3): a cancel it refuses (wrong-state, no
        // shadow) is never co-signed. A cancel in setup or before any coin closes the shadow.
        const r = feed(next.shadow, { type: 'buyer-cancel' }, 'buyer', now);
        next = { ...next, shadow: r.trade };
        if (r.refused) o.log({ reason: `shadow-buyer-cancel-${r.refused}` });
        else next = { ...next, cancelSeen: true };
        break;
      }
      case 'trade.extend':
      case 'trade.refund-request': {
        const type = s.type === 'trade.extend' ? 'extend' : 'request-refund';
        const r = feed(next.shadow, { type }, 'seller', now);
        next = { ...next, shadow: r.trade };
        if (r.refused === 'too-early') next = next.pending.includes(type) ? next : { ...next, pending: [...next.pending, type] };
        else if (r.refused) o.log({ reason: `shadow-${type}-${r.refused}` });
        break;
      }
    }
    next = { ...next, seq: next.seq + 1 };
    await save(next, extra); // everything this signal changed, the guard and the ack's seq, in one write
    o.transport.send(await sealAck({ channel, me: o.args.me, participants: o.args.participants, seq: next.seq, to: s.from, of: s.type }));
  };

  const loop = signalLoop(o.transport, (raw) => run(() => onFrame(raw)), () => o.log({ reason: 'signal-failed' }));

  /** The refund in flight in this process: re-sent to the party when its payouts change. */
  let inFlight: string | null = null;
  const lastLogged = new Map<string, string>();
  const logOnce = (topic: string, reason: string): void => {
    if (lastLogged.get(topic) === reason) return;
    lastLogged.set(topic, reason);
    o.log({ reason });
  };

  const refundFor = (r: DeskRecord, kind: SettleKind) => (balance: bigint): Payout[] => {
    const t = r.shadow;
    if (t === null || r.sellerRefund === null) throw new RangeError('no refund facts');
    return payoutsFor({
      kind,
      amountAtomic: t.amountAtomic,
      feeAtomic: t.feeAtomic,
      sellerFundsAtomic: t.sellerFundsAtomic,
      poster: t.poster,
      balanceAtomic: balance,
      buyerPayout: terms.buyerPayout,
      sellerRefund: r.sellerRefund,
      feeWallet: o.feeWallet,
      payrollWallet: o.payrollWallet,
      // Owner 27 Nov 2026: a refund returns the seller's extra too; it is part of the funds (escrowPlan).
      ...(terms.sellerLienRecovery !== undefined ? { sellerLienRecovery: attestedSellerRecovery(terms)! } : {}),
    });
  };

  const settle = (handle: PartyHandle, kind: 'auto-refund' | 'buyer-cancel', proposed: Payout[]): void => {
    const outcome: Outcome = { kind: 'release', to: proposed, builder: ROUTE[kind].builder, cosigner: 'mod' };
    const key = outcomeKey(outcome);
    if (inFlight === key) return;
    inFlight = key;
    o.log({ reason: `${kind}-signing` });
    handle.settle(outcome).then(
      () => o.log({ reason: `${kind}-cosigned` }),
      () => {
        if (inFlight === key) inFlight = null; // the next pass asks again
        o.log({ reason: `${kind}-settle-failed` });
      },
    );
  };

  /**
   * The API facts to arm, escalate or hand a refund on (security review 7 Nov, finding 1): the
   * step's item while it is at most WATCH_FRESH_MS old, else the trade read again; null when that
   * read failed (then nothing is armed, escalated or handed this pass). `at` is when they were read.
   */
  const current = async (s: DeskStep): Promise<{ api: DeskStep['api']; at: Date } | null> => {
    const at = s.apiAt ?? o.now();
    if (o.now().getTime() - at.getTime() <= WATCH_FRESH_MS) return { api: s.api, at };
    const f = s.refresh ? await s.refresh().catch(() => null) : null;
    if (f === null) {
      logOnce('stale', 'watch-list-stale');
      return null;
    }
    return { api: f.item, at: f.at };
  };
  /**
   * Re-verify R1 (8 Nov): an armed auto-refund blocked for good by the buyer's `trade.paid` (a lie, or
   * a tap the API refused because the seller's cancel came first) while the API still shows the
   * seller's cancel would leave the seller's coins with no route out (the cancel does not time out).
   * Like the unarmed guard's paid conflict (review M7): once the API, fresh and unpaused, still shows
   * the cancel PAID_CONFLICT_MS after the signal, escalate `refund-unverified` (a person decides).
   */
  const paidConflict = async (r: DeskRecord, s: DeskStep, now: Date): Promise<DeskRecord> => {
    if (r.escalated !== null) return r;
    const c = await current(s);
    if (c === null || !apiShowsSellerCancel(c.api) || c.api.paused === true || (r.shadow !== null && r.shadow.pausedAt !== null)) return r;
    const since = r.paidSeenAt ?? r.armed?.at ?? now;
    if (judgedAt(now, c.at).getTime() < since.getTime() + PAID_CONFLICT_MS) return r;
    const res = await o.link.report({ kind: 'refund-unverified', trade: code });
    if (accepted(res)) {
      o.log({ reason: res.status === 409 ? 'escalate-wrong-state' : 'escalated-refund-unverified' });
      return { ...r, escalated: 'refund-unverified' };
    }
    logOnce('escalate', `escalate-refused-${res.status}`);
    return r;
  };

  /** The earlier of the step's time and the read: an API fact is never taken as newer than its read. */
  const judgedAt = (now: Date, at: Date): Date => new Date(Math.min(now.getTime(), at.getTime()));

  /**
   * The auto-refund guard for one pass (autoRefund.ts), once nothing was escalated here: on `sign` it
   * arms the auto-refund (saved before the party is asked) and hands the seller-built refund to the
   * party ('signed'); on `escalate` it reports. Returns the record to save otherwise.
   */
  const autoRefundPass = async (r: DeskRecord, s: DeskStep, now: Date): Promise<DeskRecord | 'signed'> => {
    if (r.escalated !== null) return r;
    const judge = (api: DeskStep['api'], at: Date) =>
      autoRefundStep({
        now: judgedAt(now, at),
        shadow: r.shadow,
        api,
        apiRefundSince: r.apiRefundSince,
        paidSeen: r.paidSeen,
        paidSeenAt: r.paidSeenAt,
        recordedRefundAddress: r.sellerRefund,
        funds: s.funds,
        refundFor: refundFor(r, 'auto-refund'),
      });
    let ar = judge(s.api, s.apiAt ?? now);
    if (ar.action === 'sign' || ar.action === 'escalate') {
      // Armed or escalated only on facts at most WATCH_FRESH_MS old (finding 1 a, b).
      const c = await current(s);
      if (c === null) return r;
      ar = judge(c.api, c.at);
    }
    if (ar.action === 'sign') {
      const next: DeskRecord = { ...r, armed: { kind: 'auto-refund', at: now } };
      await save(next);
      settle(s.handle, 'auto-refund', ar.proposed);
      return 'signed';
    }
    if (ar.action === 'escalate') {
      const res = await o.link.report({ kind: ar.report, trade: code });
      if (accepted(res)) {
        // A 409 wrong-state counts as done (it fails safe: nothing is signed here afterwards) but is
        // logged apart, so ops can tell it from an accepted escalation (review round 2 N4).
        o.log({ reason: res.status === 409 ? 'escalate-wrong-state' : `escalated-${ar.report}` });
        return { ...r, escalated: ar.report };
      }
      logOnce('escalate', `escalate-refused-${res.status}`);
    } else if (ar.action === 'refuse') {
      logOnce('auto-refund', `auto-refund-${ar.reason}`);
    }
    return r;
  };

  const step = async (s: DeskStep): Promise<void> => {
    const now = o.now();
    let r: DeskRecord = { ...record };
    // 1. The shadow, from this service's own watcher only.
    if (r.shadow?.state === 'setup' && s.escrowAddress) {
      const x = feed(r.shadow, { type: 'setup-done', escrowAddress: s.escrowAddress }, 'system', now);
      r = { ...r, shadow: x.trade };
    }
    for (const rep of s.reports) {
      if (rep.kind === 'chain') {
        const x = feed(r.shadow, { type: 'chain', receivedAtomic: rep.receivedAtomic, unlockedAtomic: rep.unlockedAtomic, confirmations: rep.confirmations }, 'system', now);
        r = { ...r, shadow: x.trade };
      } else if (rep.kind === 'settled' && r.shadow) {
        const kind = settleKindFor(r.shadow);
        if (kind !== null) r = { ...r, shadow: feed(r.shadow, { type: 'settled', kind, txHash: rep.txHash }, 'system', now).trade };
      }
    }
    // Catch-up (review M2): the watcher's latest facts, whether or not a report carried them this pass.
    if (r.shadow && !CLOSED.includes(r.shadow.state) && s.chain) {
      const c = s.chain;
      const t = r.shadow;
      if (t.receivedAtomic !== c.receivedAtomic || t.unlockedAtomic !== c.unlockedAtomic || t.confirmations !== c.confirmations) {
        r = { ...r, shadow: feed(t, { type: 'chain', ...c }, 'system', now).trade };
      }
    }
    if (r.shadow && !CLOSED.includes(r.shadow.state) && s.settledTx) {
      const kind = settleKindFor(r.shadow);
      if (kind !== null) r = { ...r, shadow: feed(r.shadow, { type: 'settled', kind, txHash: s.settledTx }, 'system', now).trade };
    }
    // 2. Seller events that came before the shadow's own deadline.
    if (r.pending.length > 0) {
      const keep: DeskRecord['pending'] = [];
      for (const type of r.pending) {
        const x = feed(r.shadow, { type }, 'seller', now);
        r = { ...r, shadow: x.trade };
        if (x.refused === 'too-early') keep.push(type);
        else if (x.refused) o.log({ reason: `shadow-${type}-${x.refused}` });
      }
      r = { ...r, pending: keep };
    }
    // Maintenance: the shadow pauses and resumes with the API (as seen by this service), so a resume
    // moves its deadlines and windows too; a window is never shorter here than at the API.
    if (r.shadow && s.api.paused === true && r.shadow.pausedAt === null) r = { ...r, shadow: feed(r.shadow, { type: 'pause' }, 'system', now).trade };
    if (r.shadow && s.api.paused !== true && r.shadow.pausedAt !== null) r = { ...r, shadow: feed(r.shadow, { type: 'resume' }, 'system', now).trade };
    if (r.shadow) r = { ...r, shadow: feed(r.shadow, { type: 'tick' }, 'system', now).trade };
    // The refund-unverified hour does not count a maintenance pause: it restarts while paused (review M7).
    r = { ...r, apiRefundSince: apiShowsSellerCancel(s.api) ? (s.api.paused === true ? now : (r.apiRefundSince ?? now)) : null };

    // 3. The refunds the moderator may sign alone. Never once the trade is over (review M4).
    const over =
      CLOSED.includes(s.api.state) ||
      (r.shadow !== null && CLOSED.includes(r.shadow.state)) ||
      Boolean(s.settledTx) ||
      s.reports.some((x) => x.kind === 'settled');
    if (over) {
      if (r.armed !== null || r.cancelSeen) logOnce('over', 'desk-trade-over');
    } else if (s.rulingRecorded === true) {
      logOnce('ruling', 'desk-ruling-recorded');
    } else if (r.armed !== null) {
      const kind = r.armed.kind;
      // Review round 3 R3-N1: an armed buyer cancel the buyer never builds must not switch off the
      // auto-refund and its escalations (only the buyer can build it, so the seller's later cancel
      // would be stuck with no route out). While the API is not settling the buyer's
      // cancel, the auto-refund guard runs as if nothing were armed: on `sign` the desk re-arms as
      // the seller-built auto-refund (the payouts are identical, payoutsFor: the whole balance to the
      // seller-signed address) and hands it to the party, which replaces the earlier outcome unless it
      // already committed to the buyer's tx set (then that tx is the mod's own and lands as before:
      // `ownTxs`, so the shadow's veto never applies to it); on `escalate` it reports as usual.
      if (kind === 'buyer-cancel' && !(s.api.state === 'settling' && s.api.settleKind === 'buyer-cancel')) {
        const ar = await autoRefundPass(r, s, now);
        if (ar === 'signed') return;
        r = ar;
      }
      const { balance, unlocked } = s.funds;
      // An armed buyer cancel is rechecked every pass (review round 2 N2): never handed to the party
      // again after a `trade.paid` was opened, or while the API shows a state it may not be signed in.
      // Known limit (review round 3 R3-M1): an outcome already handed to the party in this process is
      // not withdrawn when the cancel becomes blocked (`PartyHandle` has no withdraw; the party keeps
      // its `settleOutcome`, and `inFlight` here stays set). So if the buyer's tx set arrives after a
      // `trade.paid` was opened, the mod still co-signs that buyer-built cancel. Only the buyer can
      // build it and it pays the seller, so the buyer can only hurt themselves (e.g. an old client
      // after the API reverted the cancel and the buyer then paid). A restart or a payout change does
      // stop it. A withdraw (or a no-op re-settle) is left to a later task (coordination.md).
      let blocked: string | null =
        kind !== 'buyer-cancel' ? armedRefundBlock(r, s.api, judgedAt(now, s.apiAt ?? now))
        : r.paidSeen ? 'buyer-cancel-buyer-paid'
        : !apiAllows({ state: s.api.state, settleKind: s.api.settleKind ?? null }) ? 'buyer-cancel-api-state'
        : null;
      if (kind === 'auto-refund' && blocked === null) {
        // Handed again only on facts at most WATCH_FRESH_MS old (finding 1).
        const c = await current(s);
        blocked = c === null ? 'watch-list-stale' : armedRefundBlock(r, c.api, judgedAt(now, c.at));
      }
      if (kind === 'auto-refund' && r.armed !== null) {
        // The record says why (finding 1 c); a stale read is no reason to keep.
        const keep = blocked === 'watch-list-stale' ? (r.armed.blocked ?? null) : blocked;
        if ((r.armed.blocked ?? null) !== keep) r = { ...r, armed: { kind: r.armed.kind, at: r.armed.at, ...(keep !== null ? { blocked: keep } : {}) } };
      }
      if (kind === 'auto-refund' && blocked === 'auto-refund-buyer-paid') r = await paidConflict(r, s, now);
      if (blocked !== null) {
        logOnce('armed', blocked);
      } else if (balance > 0n && balance === unlocked) {
        try {
          settle(s.handle, kind, refundFor(r, kind)(balance));
        } catch {
          logOnce('armed', `${kind}-no-payout`);
        }
      }
    } else {
      const bc = buyerCancelStep({
        cancelSeen: r.cancelSeen,
        paidSeen: r.paidSeen,
        api: { state: s.api.state, settleKind: s.api.settleKind ?? null },
        recordedRefundAddress: r.sellerRefund,
        funds: s.funds,
        refundFor: refundFor(r, 'buyer-cancel'),
      });
      // Armed only on facts at most WATCH_FRESH_MS old (finding 1): the API state is one of its brakes.
      const bcFresh = bc.action === 'sign' ? await current(s) : null;
      const bcApi = bcFresh === null ? null : { state: bcFresh.api.state, settleKind: bcFresh.api.settleKind ?? null };
      if (bc.action === 'sign' && bcApi !== null && apiAllows(bcApi)) {
        r = { ...r, armed: { kind: 'buyer-cancel', at: now } };
        await save(r); // armed before the party is asked
        settle(s.handle, 'buyer-cancel', bc.proposed);
        return;
      }
      if (bc.action === 'refuse') logOnce('buyer-cancel', `buyer-cancel-${bc.reason}`);
      // A cancel that waits or is refused never blocks the auto-refund's escalations (review M3).
      const ar = await autoRefundPass(r, s, now);
      if (ar === 'signed') return;
      r = ar;
    }
    await save(r);
  };

  return {
    step: (s) => run(() => step(s)),
    async stop() {
      await run(async () => undefined).catch(() => undefined);
      stopped = true;
      loop.stop();
      await loop.done.catch(() => undefined);
    },
    record: () => structuredClone(record),
    sweepKind: (apiKind) => (sweepKindAgrees(record, apiKind) ? apiKind : null),
  };
}
