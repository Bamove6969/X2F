import { gateUsdCents, limitUsdCentsOf, newDispute, DisputeRuleError, type Dispute, type DisputeStatus, type GateValue, type Round1, type RulingDraft } from '@x2f/staff';
import type { Trade } from '@x2f/trade';
import type pg from 'pg';
import type { Deps } from '../app.js';
import type { Queryable } from '../db/pool.js';
import type { EventBus } from '../events/bus.js';
import { appendLog } from '../log/append.js';
import { eraseReversedReviews } from '../reviews/store.js';
import { DECIDED_STATUSES } from '../traders/finalOutcome.js';
import { countTradeTotals, lockPartyTotals } from '../traders/tradedTotal.js';
import { accrueDisputePay } from '../staff/payAccrual.js';
import type { MarketPrices } from '../price/market.js';
import { usdCentsOf } from '../traders/stage.js';
import { applyLienRules } from './lien.js';
import { disputeSettings } from './settings.js';

/** The next dispute number for a trade (108: a dispute is (code, seq); the current one is the highest seq). */
export const NEXT_SEQ = `(select coalesce(max(seq), 0) + 1 from disputes where code = $1)`;

/** A stored reason: relative to whoever opened the dispute (108), or 'escalated' for the system (110). */
export type StoredReason = 'paid' | 'silent' | 'terms' | 'other' | 'escalated';

/** A dispute row: the machine's `Dispute` plus what only the trader view and the timers read. */
export interface DisputeRecord {
  dispute: Dispute;
  reason: StoredReason;
  moderatorName: string | null;
  moderatorJoinedAt: Date | null;
  /** A7: set while maintenance pauses the dispute. */
  pausedSince: Date | null;
}

interface Row {
  code: string;
  seq: number;
  opened_by: 'buyer' | 'seller' | 'system';
  reason: StoredReason;
  opened_at: Date;
  after_refund: boolean;
  status: DisputeStatus;
  moderator_name: string | null;
  moderator_joined_at: Date | null;
  round: 1 | 2;
  assignee: string | null;
  first_reply_at: Date | null;
  reply_due_at: Date;
  ruling_due_at: Date;
  usd_cents: string;
  limit_usd_cents: string;
  ruling: RulingDraft | null;
  round1: (Omit<Round1, 'firstReplyAt'> & { firstReplyAt: string | null }) | null;
  published_at: Date | null;
  appeal_ends_at: Date | null;
  comply_by: Date | null;
  executed_at: Date | null;
  executed_round: 1 | 2 | null;
  complied_at: Date | null;
  overturned: boolean | null;
  seen: string[];
  paused_since: Date | null;
  appeal_by: 'buyer' | 'seller' | null;
  appealed_at: Date | null;
}

const SELECT = `select d.code, d.seq, d.opened_by, d.reason, d.opened_at, d.after_refund, d.status, d.moderator_name,
    d.moderator_joined_at, d.round, d.assignee::text as assignee, d.first_reply_at, d.reply_due_at, d.ruling_due_at,
    d.usd_cents::text as usd_cents, d.limit_usd_cents::text as limit_usd_cents, d.ruling, d.round1, d.published_at,
    d.appeal_ends_at, d.comply_by, d.executed_at, d.executed_round, d.complied_at, d.overturned, d.seen::text[] as seen, d.paused_since,
    a.by as appeal_by, a.at as appealed_at
  from disputes d left join dispute_appeals a on a.code = d.code and a.seq = d.seq`;

function toRecord(r: Row): DisputeRecord {
  const round1: Round1 | null = r.round1 === null
    ? null
    : { ...r.round1, firstReplyAt: r.round1.firstReplyAt === null ? null : new Date(r.round1.firstReplyAt), involved: [...r.round1.involved] };
  return {
    dispute: {
      code: r.code,
      seq: r.seq,
      openedBy: r.opened_by,
      afterRefund: r.after_refund,
      openedAt: r.opened_at,
      replyDueAt: r.reply_due_at,
      rulingDueAt: r.ruling_due_at,
      assignee: r.assignee,
      firstReplyAt: r.first_reply_at,
      status: r.status,
      round: r.round,
      usdCents: BigInt(r.usd_cents),
      limitUsdCents: BigInt(r.limit_usd_cents),
      ruling: r.ruling,
      round1,
      publishedAt: r.published_at,
      appealEndsAt: r.appeal_ends_at,
      appealBy: r.appeal_by,
      appealedAt: r.appealed_at,
      complyBy: r.comply_by,
      executedAt: r.executed_at,
      executedRound: r.executed_round,
      compliedAt: r.complied_at,
      overturned: r.overturned,
      seen: r.seen,
    },
    reason: r.reason,
    moderatorName: r.moderator_name,
    moderatorJoinedAt: r.moderator_joined_at,
    pausedSince: r.paused_since,
  };
}

/** A trade's dispute: `seq`, or the current one (the highest seq). `lock` takes the row `for update`. */
export async function loadDisputeRecord(q: Queryable, code: string, o: { seq?: number; lock?: boolean } = {}): Promise<DisputeRecord | null> {
  const where = o.seq === undefined
    ? 'where d.code = $1 and d.seq = (select max(seq) from disputes where code = $1)'
    : 'where d.code = $1 and d.seq = $2';
  const { rows } = await q.query<Row>(`${SELECT} ${where}${o.lock ? ' for update of d' : ''}`, o.seq === undefined ? [code] : [code, o.seq]);
  return rows[0] ? toRecord(rows[0]) : null;
}

export async function loadDispute(q: Queryable, code: string, o: { seq?: number; lock?: boolean } = {}): Promise<Dispute | null> {
  return (await loadDisputeRecord(q, code, o))?.dispute ?? null;
}

const round1Json = (r: Round1 | null) => (r === null ? null : JSON.stringify({ ...r, firstReplyAt: r.firstReplyAt?.toISOString() ?? null }));

/**
 * Writes the machine's state back. The USD value and the limit snapshot are never rewritten, nor
 * are the appeal's side and time (`dispute_appeals`, written by the appeal route). Round 1's
 * trader-visible `appeal_until` follows `appealEndsAt` (a maintenance shift moves both).
 *
 * Auto-assign (owner 26 Nov 2026, migration 910), read from the row as it was before this write: a
 * case that goes back to the pool (its assignee cleared, or round 2 opening unassigned) records
 * when (`pooled_at`); a new assignee records when they got it (`assigned_at`); any change of
 * assignee clears `auto_assigned` (the timer's own assignment writes the assignee and the mark
 * before this runs, so it sees no change: disputes/autoAssign.ts).
 */
export async function saveDispute(client: pg.PoolClient, d: Dispute, now: Date): Promise<void> {
  await client.query(
    `update disputes set status = $3, round = $4, assignee = $5, first_reply_at = $6, reply_due_at = $7, ruling_due_at = $8,
       ruling = $9, round1 = $10, published_at = $11, appeal_ends_at = $12, comply_by = $13, executed_at = $14,
       complied_at = $15, overturned = $16, seen = $17::uuid[],
       closed_at = case when $3 = 'closed' then coalesce(closed_at, $18) end,
       executed_round = $19,
       pooled_at = case when $5::uuid is null and (assignee is not null or round is distinct from $4) then $18 else pooled_at end,
       assigned_at = case when $5::uuid is not null and assignee is distinct from $5::uuid then $18 else assigned_at end,
       auto_assigned = case when assignee is distinct from $5::uuid then false else auto_assigned end
     where code = $1 and seq = $2`,
    [d.code, d.seq, d.status, d.round, d.assignee, d.firstReplyAt, d.replyDueAt, d.rulingDueAt,
      d.ruling === null ? null : JSON.stringify(d.ruling), round1Json(d.round1), d.publishedAt, d.appealEndsAt, d.complyBy,
      d.executedAt, d.compliedAt, d.overturned, d.seen, now, d.executedRound],
  );
  // R-011 / R-012 (owner Q40, Q41; NEEDS_P4_OVERTURN_ERASES_REVIEWS): feedback and totals follow the
  // final binding outcome, in this same transaction. A trade that ends REVERSED loses its reviews and
  // skips; one that ends as a sale keeps them (and counts); while an appeal is pending they are held
  // (traders/finalOutcome.ts reviewHeldSql). Both are idempotent and decide from the rows just saved;
  // only a decided dispute can change them. Their locks (the trade row, the parties' totals rows)
  // are already held: `withDispute` takes them before `fn` appends to the log (review M1).
  if ((DECIDED_STATUSES as readonly string[]).includes(d.status)) {
    await eraseReversedReviews(client, d.code);
    await countTradeTotals(client, d.code);
  }
  // Plan 4 Task 33 (D-041..D-044): a published round 1 earns its decider's pay; an overruled one is
  // clawed back from future pay. Idempotent, in this same transaction.
  await accrueDisputePay(client, d, now);
  if (d.appealEndsAt !== null) {
    await client.query(
      'update dispute_rulings set appeal_until = $3 where code = $1 and seq = $2 and round = 1 and appeal_until is distinct from $3',
      [d.code, d.seq, d.appealEndsAt],
    );
  }
}

/**
 * The trade's USD value in cents when its dispute opens: a USD trade's value as the ruling gate
 * works it out (review p4t22 M1: `gateUsdCents`, the XMR times the locked rate rounded up, never the
 * half-up fiat total, so the two sides cannot disagree by a cent at the limit); another currency's
 * at the market quote (`usdCentsOf`, rounded up), for the staff views only, since the two-person
 * rule follows the gate for it (`gateValueOf`). Lead default, fail closed: with no quote (a paused
 * currency, or a system escalation, which runs without prices) the value is the limit itself.
 */
export function disputeUsdCents(t: Pick<Trade, 'lockedRate' | 'fiatCents' | 'amountAtomic'>, prices: MarketPrices | null, limitUsdCents: bigint): bigint {
  if (t.lockedRate.currency === 'USD') return gateUsdCents({ currency: 'USD', amountAtomic: t.amountAtomic, centsPerXmr: t.lockedRate.centsPerXmr })!;
  const q = prices?.quote(t.lockedRate.currency) ?? null;
  if (q === null) return limitUsdCents;
  return usdCentsOf(t.fiatCents, { centsPerXmr: q.price.centsPerXmr, usdCentsPerXmr: q.usdCentsPerXmr });
}

/**
 * Review p4t22 M1: the ruling gate's own inputs for this trade (`GateValue`), as the propose route
 * hands them to the dispute machine: the gate's value of the trade (null for a non-USD deal: lead
 * default, owner question OQ1, every non-USD dispute needs a second person) and the large-trade
 * limit in force now (`limitUsdCentsOf(settings)`). The gate applies its current limit, never the
 * snapshot at opening (it cannot know when a dispute opened, and it is the one that co-signs), so
 * the API judges by the same limit; the machine also keeps the snapshot's rule, so the API is never
 * laxer than either.
 */
export function gateValueOf(t: Pick<Trade, 'lockedRate' | 'amountAtomic'>, largeTradeLimitUsd: number): GateValue {
  return {
    usdCents: gateUsdCents({ currency: t.lockedRate.currency, amountAtomic: t.amountAtomic, centsPerXmr: t.lockedRate.centsPerXmr }),
    limitUsdCents: limitUsdCentsOf(largeTradeLimitUsd),
  };
}

/**
 * Opens the trade's next dispute inside the transaction that holds the trade row: the machine's
 * `newDispute` with the settings snapshot and the USD value, its row, and `dispute.opened` in the
 * activity log. The caller has checked that the trade may be disputed (Plan 3 `open-dispute` or
 * `escalate`).
 */
export async function startDispute(
  client: pg.PoolClient,
  t: Pick<Trade, 'code' | 'lockedRate' | 'fiatCents' | 'amountAtomic'>,
  a: { openedBy: 'buyer' | 'seller' | 'system'; reason: StoredReason; note: string; afterRefund: boolean; now: Date; prices: MarketPrices | null },
): Promise<Dispute> {
  const s = await disputeSettings(client);
  const limitUsdCents = limitUsdCentsOf(s.largeTradeLimitUsd);
  const { rows } = await client.query<{ seq: number }>(`select ${NEXT_SEQ} as seq`, [t.code]);
  const d = newDispute({
    code: t.code,
    seq: rows[0]!.seq,
    openedBy: a.openedBy,
    afterRefund: a.afterRefund,
    usdCents: disputeUsdCents(t, a.prices, limitUsdCents),
    limitUsdCents,
    firstResponseH: s.firstResponseH,
    now: a.now,
  });
  await client.query(
    `insert into disputes (code, seq, opened_by, reason, note, opened_at, after_refund, status, round, reply_due_at, ruling_due_at,
       usd_cents, limit_usd_cents)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [d.code, d.seq, d.openedBy, a.reason, a.note, d.openedAt, d.afterRefund, d.status, d.round, d.replyDueAt, d.rulingDueAt,
      d.usdCents.toString(), d.limitUsdCents.toString()],
  );
  await appendLog(client, {
    at: a.now,
    actor: a.openedBy === 'system' ? { kind: 'system' } : { kind: 'trader', side: a.openedBy },
    tradeCode: t.code,
    action: 'dispute.opened',
    detail: { reason: a.reason, afterRefund: d.afterRefund, seq: d.seq },
  });
  return d;
}

/**
 * The dispute row for a trade the system escalated (Task 9's timer loop: late funds after the
 * trade closed, or a lapse nobody refunded). Called by applyEvent inside the escalate's own
 * transaction, with the trade row locked, so a trade is never `disputed` without a dispute row.
 *
 * It adds a new dispute (the next seq) and never deletes or rewrites an earlier one: an earlier
 * dispute's ruling, appeal and note stay exactly as they were (who lost it counts for Plan 5's
 * lost-dispute total, never the stage, R38; and the moderator of the new dispute can read them).
 */
export async function openSystemDispute(client: pg.PoolClient, t: Trade, now: Date): Promise<void> {
  await startDispute(client, t, { openedBy: 'system', reason: 'escalated', note: '', afterRefund: false, now, prices: null });
}

export interface DisputeDeps extends Pick<Deps, 'db' | 'clock'> {
  /** Live events to the traders' own streams; omitted, nothing is published. */
  events?: Pick<EventBus, 'publish'>;
  /**
   * Owner 26 Nov: both traders are alerted when a ruling is published. A side with no open stream
   * gets the phone push `trade` (it names no trade); omitted, no push is sent.
   */
  push?: { send(accountId: string, kind: 'trade'): Promise<boolean> };
}

/**
 * Runs one change on a dispute: locks its row (`for update`; the current dispute unless `seq` is
 * given), runs `fn` on the server clock, stores what it returns and commits; then tells both
 * traders' open streams to re-read the trade (`{type:'trade'}`, as Task 19's trade events do).
 *
 * `fn` appends its own activity-log entry on `client` (only statements on this client from then
 * to the commit, `appendLog`'s rule; the appeal path appends `appeal.opened` first). The change's
 * liens and owed fees (`applyLienRules`, Task 25) are written and logged after `fn`, on the same client. It returns the
 * next state, or the very same object for "no change" (nothing is written or published). A trade
 * with no such dispute throws DisputeRuleError('wrong-state'); any throw writes nothing.
 */
export async function withDispute(
  deps: DisputeDeps,
  target: { code: string; seq?: number; lockAccount?: string },
  fn: (d: Dispute, client: pg.PoolClient, now: Date, rec: DisputeRecord) => Promise<Dispute>,
): Promise<Dispute> {
  const client = await deps.db.connect();
  let next: Dispute;
  let parties: { seller: string; buyer: string; state: string; closed: boolean } | undefined;
  let before: Dispute | undefined;
  try {
    await client.query('begin');
    try {
      // Review M1 (12 Nov): the trade row first, then the dispute row, the same order as a trade
      // event (applyEvent) and the settle path (internal/routes.ts); then the parties' running
      // totals rows. A decided save (saveDispute) erases a reversed trade's reviews and moves those
      // totals, and `fn` appends to the log before it: every lock that work needs is taken here,
      // before the site-wide log lock, so nothing after the append waits on a contended lock (N3).
      await client.query('select 1 from trades where code = $1 for update', [target.code]);
      const rec = await loadDisputeRecord(client, target.code, { ...(target.seq === undefined ? {} : { seq: target.seq }), lock: true });
      if (rec === null) throw new DisputeRuleError('wrong-state');
      await lockPartyTotals(client, target.code);
      // J-06 review L5: everything the lien rules write waits on nothing once `fn` has appended to
      // the activity log (appendLog's rule N3). So, before `fn`: both parties' account rows (the
      // liens' and owed fees' foreign keys take FOR KEY SHARE on them), in id order, then this
      // dispute's liens. Order with the reputation branch's withDispute: trade, dispute, totals,
      // accounts, liens.
      if (target.lockAccount === undefined) {
        await client.query(
          `select 1 from accounts where id in (select seller_account_id from trades where code = $1 union select buyer_account_id from trades where code = $1)
            order by id for key share`,
          [target.code],
        );
      } else {
        const { rows: acctRows } = await client.query<{ id: string }>(
          `select id::text as id from (
             select seller_account_id as id from trades where code = $1
             union select buyer_account_id as id from trades where code = $1
             union select $2::uuid as id
           ) u order by id`,
          [target.code, target.lockAccount],
        );
        for (const { id } of acctRows) {
          await client.query(
            id === target.lockAccount
              ? 'select 1 from accounts where id = $1 for no key update'
              : 'select 1 from accounts where id = $1 for key share',
            [id],
          );
        }
      }
      await client.query('select 1 from liens where from_code = $1 and dispute_seq = $2 order by id for update', [rec.dispute.code, rec.dispute.seq]);
      const now = deps.clock();
      before = rec.dispute;
      next = await fn(rec.dispute, client, now, rec);
      if (next === rec.dispute) {
        await client.query('commit');
        return next;
      }
      // Task 25 (J-06): the liens and owed fees this change brings, in the same transaction, for
      // every path that changes a dispute (rulings, the appeal, the timers).
      await applyLienRules(client, rec.dispute, next, now);
      await saveDispute(client, next, now);
      const t = await client.query<{ seller: string; buyer: string; state: string; closed: boolean }>(
        'select seller_account_id::text as seller, buyer_account_id::text as buyer, state, closed_at is not null as closed from trades where code = $1',
        [target.code],
      );
      parties = t.rows[0];
      await client.query('commit');
    } catch (err) {
      await client.query('rollback');
      throw err;
    }
  } finally {
    client.release();
  }
  // Owner 26 Nov: a ruling just published (a new one, or round 2's) alerts both traders.
  const published = next.publishedAt !== null && next.publishedAt.getTime() !== (before?.publishedAt?.getTime() ?? null);
  if (parties && (deps.events || (published && deps.push))) {
    const ev = { type: 'trade' as const, code: target.code, state: parties.state };
    for (const id of [parties.seller, parties.buyer]) {
      let streamed = 0;
      try {
        streamed = deps.events?.publish(id, ev, { closed: parties.closed }) ?? 0;
      } catch {
        // Best effort: the change is committed and apps re-read the trade.
      }
      if (published && streamed === 0 && deps.push) await deps.push.send(id, 'trade').catch(() => false);
    }
  }
  return next;
}
