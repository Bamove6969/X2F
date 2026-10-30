import type { Outcome, PartyHandle, Payout, Transport } from '@x2f/escrow';
import { ReplayGuard, type Envelope, type ReplayGuardJSON } from '@x2f/protocol';
import { channelFor, payoutsFor, settleKindFor, type ChainFacts, type ModPartyArgs, type SettleKind, type Trade, type TradeEvent, type WatchReport } from '@x2f/trade';
import type pg from 'pg';
import { autoRefundStep } from './autoRefund.js';
import { buyerCancelStep } from './buyerCancel.js';
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
 *   arrives before the shadow's own payBy is retried each pass.
 * - Each watcher pass (`step`), after its reports were accepted: buyer cancel first (a valid
 *   `trade.cancel` from the buyer's identity that the shadow took, never after a `trade.paid`,
 *   buyerCancel.ts), else the auto-refund guard (autoRefund.ts), which also runs while a cancel
 *   waits, so its escalation fallback is never blocked (review M3). A refund
 *   once armed is kept; its payouts are derived again from the balance this party reads, and
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
  /** The refund this service decided to co-sign alone; kept for good. */
  armed: { kind: 'auto-refund' | 'buyer-cancel'; at: Date } | null;
  /** The escalation report the API accepted (then nothing more is decided here). */
  escalated: string | null;
  /** When this service first saw the API show `refund_requested`; restarts while the API trade is paused (review M7). */
  apiRefundSince: Date | null;
}

export interface DeskStep {
  handle: PartyHandle;
  /**
   * The API's watch-list item: its state and settlement kind, its own pause-shifted final alert
   * and the receipt for it, and maintenance (`paused`).
   */
  api: { state: string; finalAlertSeenAt: Date | null; finalAlertAt?: Date | null; settleKind?: string | null; paused?: boolean };
  escrowAddress: string | null;
  /** The watcher reports this pass posted (all accepted). */
  reports: readonly WatchReport[];
  /** The watcher's latest chain facts for the open trade (its state after this pass), for the catch-up (review M2). */
  chain?: ChainFacts | null;
  /** The sweep this service's own watcher showed (and proved), or null. */
  settledTx?: string | null;
  /** The escrow as this pass read it from the party. */
  funds: { balance: bigint; unlocked: bigint };
}

export interface Desk {
  step(s: DeskStep): Promise<void>;
  /** Waits for the frame or step in progress, then stops the signals channel. */
  stop(): Promise<void>;
  /** A copy of the current record (tests). */
  record(): DeskRecord;
}

export interface DeskOptions {
  db: pg.Pool;
  args: ModPartyArgs;
  feeWallet: string;
  transport: Transport;
  link: Link;
  now: () => Date;
  log: (e: { reason: string }) => void;
}

const ROUTE: Record<'auto-refund' | 'buyer-cancel', { builder: 'seller' | 'buyer' }> = {
  'auto-refund': { builder: 'seller' },
  'buyer-cancel': { builder: 'buyer' },
};

const CLOSED: readonly string[] = ['released', 'refunded', 'cancelled'];

const accepted = (r: { status: number; error: string | null }): boolean => r.status === 201 || r.status === 200 || (r.status === 409 && r.error === 'wrong-state');

const outcomeKey = (o: Outcome): string => JSON.stringify([o.builder, o.cosigner, o.to.map((p) => [p.address, p.amountAtomic.toString()])]);

async function loadRecord(db: pg.Pool, trade: string): Promise<DeskRecord | null> {
  const { rows } = await db.query<{ record: unknown }>('select record from mod_trade_desk where trade = $1', [trade]);
  if (!rows[0]) return null;
  const r = fromJson(rows[0].record) as DeskRecord;
  return { ...r, paidSeenAt: r.paidSeenAt ?? null };
}

export async function openDesk(o: DeskOptions): Promise<Desk> {
  const code = o.args.trade;
  const terms = o.args.terms;
  const channel = await channelFor(code, 'signals');
  let rec = await loadRecord(o.db, code);
  if (rec === null) {
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
    rec = {
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
    rec = (await loadRecord(o.db, code))!;
  }
  let record: DeskRecord = rec;

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
      await client.query('update mod_trade_desk set record = $2, updated_at = now() where trade = $1', [code, JSON.stringify(toJson(r))]);
      await client.query('commit');
    } catch (e) {
      await client.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
    record = r;
  };

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
    r = { ...r, apiRefundSince: s.api.state === 'refund_requested' ? (s.api.paused === true ? now : (r.apiRefundSince ?? now)) : null };

    // 3. The refunds the moderator may sign alone. Never once the trade is over (review M4).
    const over =
      CLOSED.includes(s.api.state) ||
      (r.shadow !== null && CLOSED.includes(r.shadow.state)) ||
      Boolean(s.settledTx) ||
      s.reports.some((x) => x.kind === 'settled');
    if (over) {
      if (r.armed !== null || r.cancelSeen) logOnce('over', 'desk-trade-over');
    } else if (r.armed !== null) {
      const kind = r.armed.kind;
      const { balance, unlocked } = s.funds;
      if (balance > 0n && balance === unlocked) {
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
      if (bc.action === 'sign') {
        r = { ...r, armed: { kind: 'buyer-cancel', at: now } };
        await save(r); // armed before the party is asked
        settle(s.handle, 'buyer-cancel', bc.proposed);
        return;
      }
      if (bc.action === 'refuse') logOnce('buyer-cancel', `buyer-cancel-${bc.reason}`);
      // A cancel that waits or is refused never blocks the auto-refund's escalations (review M3).
      if (r.escalated === null) {
        const ar = autoRefundStep({
          now,
          shadow: r.shadow,
          api: s.api,
          apiRefundSince: r.apiRefundSince,
          paidSeen: r.paidSeen,
          paidSeenAt: r.paidSeenAt,
          recordedRefundAddress: r.sellerRefund,
          funds: s.funds,
          refundFor: refundFor(r, 'auto-refund'),
        });
        if (ar.action === 'sign') {
          r = { ...r, armed: { kind: 'auto-refund', at: now } };
          await save(r);
          settle(s.handle, 'auto-refund', ar.proposed);
          return;
        }
        if (ar.action === 'escalate') {
          const res = await o.link.report({ kind: ar.report, trade: code });
          if (accepted(res)) {
            r = { ...r, escalated: ar.report };
            o.log({ reason: `escalated-${ar.report}` });
          } else {
            logOnce('escalate', `escalate-refused-${res.status}`);
          }
        } else if (ar.action === 'refuse') {
          logOnce('auto-refund', `auto-refund-${ar.reason}`);
        }
      }
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
  };
}
