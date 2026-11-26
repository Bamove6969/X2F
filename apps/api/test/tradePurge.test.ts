// Plan 7 Task 2 and Plan 4 Task 23 (R36; owner 2026-10-29, p11-11): the whole-trade purge. A trade
// with no dispute is deleted whole 30 days after it closed; one that had a dispute 90 days after
// its last dispute closed; nothing per trade is kept. What must never go: an open trade, a trade
// with an open dispute or appeal, a lien, a trade still on the moderation watch list (the 30-day
// watch), and the revenue ledger. Runs as x2f_purge.
import { randomBytes } from 'node:crypto';
import { DISPUTE_KEEP_DAYS, TRADE_KEEP_DAYS } from '@x2f/trade';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { DISPUTE_CHILD_TABLES } from '../src/disputes/purge.js';
import { WATCH_LIST_CLOSED_DAYS } from '../src/internal/routes.js';
import { purgeTrades, purgeTradesJob, TRADE_CHILD_TABLES, tradeSelfDestruct } from '../src/retention/tradePurge.js';
import { RETENTION_JOBS } from '../src/retentionJobs.js';
import { purgeChatsJob } from '../src/chat/retention.js';
import { revenueReport } from '../src/staff/revenue.js';
import { rolesToAbilities } from '../src/team/abilities.js';
import { tradeCap } from '../src/traders/stage.js';
import { traderSummary } from '../src/traders/summary.js';
import { seedAccount } from './helpers/accounts.js';
import { testConfig } from './helpers/app.js';
import { testDb } from './helpers/db.js';
import { driveTo, seedReviews, seedTrade } from './helpers/trades.js';

const DAY = 86_400_000;
let now = new Date('2026-06-01T12:00:00Z');
let deps: Pick<Deps, 'db' | 'clock' | 'config'>;
let n = 0;

beforeAll(async () => {
  deps = { db: await testDb(), clock: () => now, config: testConfig() };
});
afterAll(async () => {
  await deps.db.end();
});

const plus = (t: Date, days: number, ms = 0): Date => new Date(t.getTime() + days * DAY + ms);
const exists = async (code: string): Promise<boolean> => (await deps.db.query('select 1 from trades where code = $1', [code])).rowCount === 1;

async function pair(): Promise<{ seller: string; buyer: string }> {
  const seller = await seedAccount(deps, { loginName: `pseller${++n}x` });
  const buyer = await seedAccount(deps, { loginName: `pbuyer${n}x` });
  return { seller, buyer };
}

/** A trade set straight into a closed state at `closedAt` (as chat.test.ts's purge fixtures do). */
async function closed(closedAt: Date, state: 'released' | 'refunded' | 'cancelled' = 'released', o: { attested?: boolean } = {}) {
  const { seller, buyer } = await pair();
  // Taken a day before it closes.
  now = new Date(closedAt.getTime() - DAY);
  const { code } = await seedTrade(deps, { sellerId: seller, buyerId: buyer, poster: 'seller' });
  await deps.db.query('update trades set state = $2, closed_at = $3 where code = $1', [code, state, closedAt]);
  if (o.attested) {
    await deps.db.query('insert into trade_attestations (code, attestation, sig) values ($1, $2, $3)', [code, JSON.stringify({ test: true }), 'ab'.repeat(64)]);
  }
  return { code, seller, buyer };
}

/** A dispute row as the dispute machine leaves it at `status` (chat.test.ts's addDispute). */
async function addDispute(code: string, seq: number, status: string, o: { openedAt: Date; closedAt?: Date }): Promise<void> {
  const published = status === 'published' || status === 'final' || status === 'complying' || status === 'closed';
  await deps.db.query(
    `insert into disputes (code, seq, opened_by, reason, opened_at, status, reply_due_at, ruling_due_at, usd_cents, limit_usd_cents,
       published_at, appeal_ends_at, closed_at)
     values ($1, $2, 'buyer', 'paid', $3, $4, $3, $3, 0, 100000, $5, $5, $6)`,
    [code, seq, o.openedAt, status, published ? o.openedAt : null, o.closedAt ?? null],
  );
  await deps.db.query(`update trades set dispute_by = 'buyer', dispute_at = $2 where code = $1`, [code, o.openedAt]);
}

async function ruling(code: string, seq: number, outcome: string, at: Date): Promise<void> {
  await deps.db.query(
    `insert into dispute_rulings (code, seq, round, outcome, reason, evidence, moderator_name, ruled_at, appeal_until)
     values ($1, $2, 1, $3, 'The payment is in the seller''s activity.', '["The trade chat"]', 'sarah.v', $4, $4)`,
    [code, seq, outcome, at],
  );
}

describe('the job', () => {
  it('runs on the one scheduler, after the chat purge', () => {
    const i = RETENTION_JOBS.indexOf(purgeTradesJob);
    expect(i).toBeGreaterThan(RETENTION_JOBS.indexOf(purgeChatsJob));
    expect(purgeTradesJob.name).toBe('purgeTrades');
  });

  it('knows every table that names a trade or a dispute by foreign key without a cascade', async () => {
    // A new table with a foreign key to trades or disputes must go in the delete order (or cascade).
    const { rows } = await deps.db.query<{ tbl: string; target: string; action: string }>(
      `select c.conrelid::regclass::text as tbl, c.confrelid::regclass::text as target, c.confdeltype as action
         from pg_constraint c where c.contype = 'f' and c.confrelid in ('trades'::regclass, 'disputes'::regclass)`,
    );
    const known = new Set<string>([...TRADE_CHILD_TABLES, ...DISPUTE_CHILD_TABLES]);
    const missing = rows.filter((r) => r.action === 'a' || r.action === 'r').map((r) => r.tbl).filter((t) => !known.has(t));
    expect(missing).toEqual([]);
  });
});

describe('an undisputed trade', () => {
  it('is kept up to 30 days after it closed and deleted whole just after', async () => {
    const t0 = new Date('2026-03-01T00:00:00Z');
    const { code } = await closed(t0);
    expect(TRADE_KEEP_DAYS).toBe(30);
    await purgeTrades(deps.db, plus(t0, 30));
    expect(await exists(code)).toBe(true);
    await purgeTrades(deps.db, plus(t0, 30, 1));
    expect(await exists(code)).toBe(false);
    for (const t of ['trade_events', 'trade_identities', 'trade_attestations', 'disputes']) {
      expect((await deps.db.query(`select 1 from ${t} where code = $1`, [code])).rowCount, t).toBe(0);
    }
  });

  it('is idempotent: a second pass deletes nothing', async () => {
    const t0 = new Date('2026-03-02T00:00:00Z');
    await closed(t0);
    await purgeTrades(deps.db, plus(t0, 31));
    expect(await purgeTrades(deps.db, plus(t0, 31))).toBe(0);
  });

  it('a released trade: the trade, its events, its chat and everything hanging off it go; reviews stay detached; counts, stage and revenue are the same', async () => {
    now = new Date('2026-04-01T12:00:00Z');
    const { seller, buyer } = await pair();
    // Two completed trades, so the profile has something left to show after one goes.
    const first = await seedTrade(deps, { sellerId: seller, buyerId: buyer, poster: 'seller' });
    await driveTo(deps, first.trade, 'released');
    await seedReviews(deps, first.code);
    const second = await seedTrade(deps, { sellerId: seller, buyerId: buyer, poster: 'seller' });
    await driveTo(deps, second.trade, 'released');
    await seedReviews(deps, second.code);
    const code = first.code;
    // A trade identity and a chat linked to the trade (the chat purge normally goes first).
    await deps.db.query(`insert into trade_identities (code, role, sign_public, box_public, proof) values ($1, 'buyer', $2, $2, $2)`, [code, 'ab'.repeat(32)]);
    const chat = `chat-${randomBytes(4).toString('hex')}`;
    const offer = (await deps.db.query<{ offer_id: string }>('select offer_id from trades where code = $1', [code])).rows[0]!.offer_id;
    await deps.db.query(
      'insert into chats (code, offer_id, buyer_account_id, seller_account_id, trade_code, created_at) values ($1, $2, $3, $4, $5, $6)',
      [chat, offer, buyer, seller, code, now],
    );
    const day = now.toISOString().slice(0, 10);
    const revenueBefore = await revenueReport(deps.db, { from: day, to: day, by: 'day' });
    const ledgerBefore = (await deps.db.query('select * from revenue_ledger order by day, currency, kind')).rows;
    const later = plus(now, 31);
    const summaryBefore = await traderSummary(deps.db, seller, later, null, 'seller');
    const capBefore = await tradeCap(deps.db, buyer, later);
    const reviewsBefore = (await deps.db.query('select count(*)::int as n from reviews where subject_id = any($1)', [[seller, buyer]])).rows[0]!.n;

    // Only the first trade is due (the second closed later the same day, so set its close later).
    await deps.db.query('update trades set closed_at = $2 where code = $1', [second.code, plus(now, 10)]);
    const removed = await purgeTrades(deps.db, later);
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await exists(code)).toBe(false);
    expect(await exists(second.code)).toBe(true);
    for (const t of ['trade_events', 'trade_identities']) {
      expect((await deps.db.query(`select 1 from ${t} where code = $1`, [code])).rowCount, t).toBe(0);
    }
    expect((await deps.db.query('select 1 from chats where code = $1', [chat])).rowCount).toBe(0);
    // The moderation service is told to shred the chat (123), as purgeChats does.
    expect((await deps.db.query('select 1 from chat_shred_orders where chat = $1', [chat])).rowCount).toBe(1);
    expect((await deps.db.query('select 1 from revenue_booked where trade_code = $1', [code])).rowCount).toBe(0);
    expect((await deps.db.query('select 1 from trade_totals_counted where trade_code = $1', [code])).rowCount).toBe(0);
    // Reviews are permanent: they stay, with no trade code and no reviewer.
    expect((await deps.db.query('select 1 from reviews where trade_code = $1', [code])).rowCount).toBe(0);
    expect((await deps.db.query('select count(*)::int as n from reviews where subject_id = any($1)', [[seller, buyer]])).rows[0]!.n).toBe(reviewsBefore);
    // The revenue ledger is untouched.
    expect((await deps.db.query('select * from revenue_ledger order by day, currency, kind')).rows).toEqual(ledgerBefore);
    expect(await revenueReport(deps.db, { from: day, to: day, by: 'day' })).toEqual(revenueBefore);
    // The profile and the starter-limit stage are the same before and after.
    expect(await traderSummary(deps.db, seller, later, null, 'seller')).toEqual(summaryBefore);
    expect(await tradeCap(deps.db, buyer, later)).toEqual(capBefore);
    expect(summaryBefore.completedTrades).toBe(2);
  });

  it('a buyer cancel the seller has not confirmed yet is kept, however old', async () => {
    const t0 = new Date('2026-03-03T00:00:00Z');
    const { code } = await closed(t0, 'refunded');
    await deps.db.query(`update trades set settling = 'buyer-cancel', cancel_confirmed_at = null, paid_at = null where code = $1`, [code]);
    await purgeTrades(deps.db, plus(t0, 400));
    expect(await exists(code)).toBe(true);
  });
});

describe('never deleted', () => {
  it('an open trade, however old', async () => {
    const { seller, buyer } = await pair();
    now = new Date('2026-01-01T00:00:00Z');
    const { trade } = await seedTrade(deps, { sellerId: seller, buyerId: buyer, poster: 'seller' });
    await driveTo(deps, trade, 'paid');
    await purgeTrades(deps.db, plus(now, 4000));
    expect(await exists(trade.code)).toBe(true);
  });

  it('a disputed trade (state disputed), however old', async () => {
    const t0 = new Date('2026-01-02T00:00:00Z');
    const { code } = await closed(t0);
    await addDispute(code, 1, 'open', { openedAt: t0 });
    await deps.db.query(`update trades set state = 'disputed', closed_at = null where code = $1`, [code]);
    await purgeTrades(deps.db, plus(t0, 4000));
    expect(await exists(code)).toBe(true);
  });

  it.each(['open', 'awaiting-approval', 'published', 'appealed', 'final', 'complying'])(
    'a trade whose dispute is %s (an appeal included), on a trade that has already closed',
    async (status) => {
      const t0 = new Date('2026-01-03T00:00:00Z');
      const { code } = await closed(t0);
      await addDispute(code, 1, status, { openedAt: t0 });
      if (status === 'appealed') {
        await deps.db.query(`insert into dispute_appeals (code, seq, by, why, at) values ($1, 1, 'seller', 'Please look again at this.', $2)`, [code, t0]);
      }
      await purgeTrades(deps.db, plus(t0, 4000));
      expect(await exists(code)).toBe(true);
    },
  );

  it('a trade still on the moderation watch list (the 30-day watch): kept until the list drops it', async () => {
    const t0 = new Date('2026-03-04T00:00:00Z');
    const { code } = await closed(t0, 'released', { attested: true });
    expect(WATCH_LIST_CLOSED_DAYS).toBeGreaterThanOrEqual(30);
    await purgeTrades(deps.db, plus(t0, 30, 1));
    expect(await exists(code)).toBe(true);
    await purgeTrades(deps.db, plus(t0, WATCH_LIST_CLOSED_DAYS));
    expect(await exists(code)).toBe(true);
    await purgeTrades(deps.db, plus(t0, WATCH_LIST_CLOSED_DAYS, 1));
    expect(await exists(code)).toBe(false);
  });

  it('a lien (owner 26 Nov 2026): kept with no delete date while unpaid; once written off, 90 days more; the lien and the owed fee stay', async () => {
    const t0 = new Date('2026-02-01T00:00:00Z');
    const { code, seller, buyer } = await closed(t0, 'refunded');
    const closedAt = plus(t0, 3);
    await addDispute(code, 1, 'closed', { openedAt: t0, closedAt });
    const lien = (await deps.db.query<{ id: string }>(
      `insert into liens (debtor_account_id, creditor_account_id, amount_atomic, from_code, dispute_seq, round, cause, status, created_at, changed_at)
       values ($1, $2, 1000, $3, 1, 1, 'restitution', 'active', $4, $4) returning id::text`,
      [seller, buyer, code, t0],
    )).rows[0]!.id;
    await deps.db.query('insert into fees_owed (account_id, amount_atomic, from_code, dispute_seq, created_at) values ($1, 10, $2, 1, $3)', [seller, code, t0]);
    const owedBefore = (await deps.db.query('select * from fees_owed where from_code = $1', [code])).rows;
    // Unpaid: no delete date, however old.
    await purgeTrades(deps.db, plus(closedAt, 3 * DISPUTE_KEEP_DAYS));
    expect(await exists(code)).toBe(true);
    expect((await tradeSelfDestruct(deps.db, code)).deleteAt).toBeNull();
    // Suspended (an appeal) holds it too.
    await deps.db.query("update liens set status = 'suspended' where id = $1", [lien]);
    await purgeTrades(deps.db, plus(closedAt, 3 * DISPUTE_KEEP_DAYS));
    expect(await exists(code)).toBe(true);
    // Written off: DISPUTE_KEEP_DAYS from then.
    const off = plus(closedAt, 200);
    await deps.db.query("update liens set status = 'uncollectible', lifted_at = $2, changed_at = $2, written_off_by = $3 where id = $1", [lien, off, buyer]);
    expect((await tradeSelfDestruct(deps.db, code)).deleteAt).toEqual(plus(off, DISPUTE_KEEP_DAYS));
    await purgeTrades(deps.db, plus(off, DISPUTE_KEEP_DAYS - 1));
    expect(await exists(code)).toBe(true);
    const liensBefore = (await deps.db.query('select * from liens where from_code = $1', [code])).rows;
    await purgeTrades(deps.db, plus(off, DISPUTE_KEEP_DAYS + 1));
    expect(await exists(code)).toBe(false);
    expect((await deps.db.query('select * from liens where from_code = $1', [code])).rows).toEqual(liensBefore);
    expect((await deps.db.query('select * from fees_owed where from_code = $1', [code])).rows).toEqual(owedBefore);
    // Over stays over.
    await expect(deps.db.query("update liens set status = 'active', lifted_at = null where id = $1", [lien])).rejects.toBeTruthy();
  });

  it('the revenue ledger: x2f_purge can neither delete nor lower it', async () => {
    const c = await deps.db.connect();
    try {
      await c.query('begin');
      await c.query('set local role x2f_purge');
      await expect(c.query('delete from revenue_ledger')).rejects.toMatchObject({ code: '42501' });
      await c.query('rollback');
      await c.query('begin');
      await c.query('set local role x2f_purge');
      await expect(c.query('delete from liens')).rejects.toMatchObject({ code: '42501' });
      await c.query('rollback');
    } finally {
      c.release();
    }
  });

  it('during site maintenance nothing is deleted; the first pass after it deletes', async () => {
    const t0 = new Date('2026-03-05T00:00:00Z');
    const { code } = await closed(t0);
    await deps.db.query(`update site_flags set maintenance_since = $1, maintenance_kind = 'unplanned'`, [t0]);
    try {
      await purgeTrades(deps.db, plus(t0, 60));
      expect(await exists(code)).toBe(true);
    } finally {
      await deps.db.query('update site_flags set maintenance_since = null, maintenance_kind = null');
    }
    await purgeTrades(deps.db, plus(t0, 60));
    expect(await exists(code)).toBe(false);
  });
});

describe('a disputed trade (Plan 4 Task 23)', () => {
  it('is kept 90 days after its dispute closed, not 89; then the dispute, its ruling and appeal go with it', async () => {
    const t0 = new Date('2026-02-01T00:00:00Z');
    const { code } = await closed(t0, 'refunded');
    const closedAt = plus(t0, 3);
    await addDispute(code, 1, 'closed', { openedAt: t0, closedAt });
    await ruling(code, 1, 'refund-to-seller', t0);
    await purgeTrades(deps.db, plus(t0, 31));
    expect(await exists(code)).toBe(true);
    await purgeTrades(deps.db, plus(closedAt, 89));
    expect(await exists(code)).toBe(true);
    await purgeTrades(deps.db, plus(closedAt, 90));
    expect(await exists(code)).toBe(true);
    await purgeTrades(deps.db, plus(closedAt, 90, 1));
    expect(await exists(code)).toBe(false);
    for (const t of ['disputes', 'dispute_rulings', 'dispute_appeals', 'ruling_drafts']) {
      expect((await deps.db.query(`select 1 from ${t} where code = $1`, [code])).rowCount, t).toBe(0);
    }
  });

  it('a later dispute on the same trade: kept while it is open, then 90 days from the last close', async () => {
    const t0 = new Date('2026-01-05T00:00:00Z');
    const { code } = await closed(t0);
    await addDispute(code, 1, 'closed', { openedAt: t0, closedAt: plus(t0, 1) });
    await addDispute(code, 2, 'open', { openedAt: plus(t0, 2) });
    await purgeTrades(deps.db, plus(t0, 500));
    expect(await exists(code)).toBe(true);
    const last = plus(t0, 501);
    await deps.db.query(`update disputes set status = 'closed', closed_at = $2 where code = $1 and seq = 2`, [code, last]);
    await purgeTrades(deps.db, plus(last, 90));
    expect(await exists(code)).toBe(true);
    await purgeTrades(deps.db, plus(last, 90, 1));
    expect(await exists(code)).toBe(false);
  });

  it('a lost dispute still counts on the profile after the trade is gone (Clean record, "N won, M lost")', async () => {
    const t0 = new Date('2026-01-07T00:00:00Z');
    const { code, seller, buyer } = await closed(t0, 'released');
    const closedAt = plus(t0, 2);
    await addDispute(code, 1, 'closed', { openedAt: t0, closedAt });
    await ruling(code, 1, 'release-to-buyer', t0);
    const when = plus(closedAt, 91);
    const sellerBefore = await traderSummary(deps.db, seller, when, null, 'seller');
    const buyerBefore = await traderSummary(deps.db, buyer, when, null, 'buyer');
    expect(sellerBefore.disputes).toEqual({ won: 0, lost: 1 });
    expect(buyerBefore.disputes).toEqual({ won: 1, lost: 0 });
    await purgeTrades(deps.db, when);
    expect(await exists(code)).toBe(false);
    expect(await traderSummary(deps.db, seller, when, null, 'seller')).toEqual(sellerBefore);
    expect(await traderSummary(deps.db, buyer, when, null, 'buyer')).toEqual(buyerBefore);
  });
});

describe('the purge role', () => {
  it('deletes the trade row as x2f_purge', async () => {
    const t0 = new Date('2026-03-06T00:00:00Z');
    const { code } = await closed(t0);
    await deps.db.query('create table if not exists purge_seen (code text, who text)');
    await deps.db.query('grant insert on purge_seen to x2f_purge');
    await deps.db.query(`create or replace function purge_seen_fn() returns trigger language plpgsql as $$
      begin insert into purge_seen values (old.code, current_user); return old; end $$`);
    await deps.db.query('drop trigger if exists purge_seen_t on trades');
    await deps.db.query('create trigger purge_seen_t after delete on trades for each row execute function purge_seen_fn()');
    try {
      await purgeTrades(deps.db, plus(t0, 31));
      expect((await deps.db.query<{ who: string }>('select who from purge_seen where code = $1', [code])).rows).toEqual([{ who: 'x2f_purge' }]);
    } finally {
      await deps.db.query('drop trigger purge_seen_t on trades');
    }
  });
});

describe('tradeSelfDestruct (TradeView.deleteAt)', () => {
  it('the date for a closed trade, null for an open dispute, the later date once it closes', async () => {
    const t0 = new Date('2026-03-07T00:00:00Z');
    const { code } = await closed(t0);
    expect((await tradeSelfDestruct(deps.db, code)).deleteAt).toEqual(plus(t0, 30));
    await addDispute(code, 1, 'open', { openedAt: plus(t0, 1) });
    expect((await tradeSelfDestruct(deps.db, code)).deleteAt).toBeNull();
    await deps.db.query(`update disputes set status = 'closed', closed_at = $2, published_at = $2, appeal_ends_at = $2 where code = $1`, [code, plus(t0, 4)]);
    expect((await tradeSelfDestruct(deps.db, code)).deleteAt).toEqual(plus(t0, 94));
  });
});

describe('review round 1', () => {
  it('I1: another trade of the same account released while the purge runs: the purged trade still counts, and so does the new one', async () => {
    const t0 = new Date('2026-03-10T00:00:00Z');
    const { seller, buyer } = await pair();
    now = new Date(t0.getTime() - DAY);
    const due = await seedTrade(deps, { sellerId: seller, buyerId: buyer, poster: 'seller' });
    const open = await seedTrade(deps, { sellerId: seller, buyerId: buyer, poster: 'seller' });
    await deps.db.query(`update trades set state = 'released', closed_at = $2 where code = $1`, [due.code, t0]);
    const when = plus(t0, 31);
    expect((await traderSummary(deps.db, seller, when, null, 'seller')).completedTrades).toBe(1);
    // Inside the purge, after it has read what the trade counts and while it deletes, the other
    // trade is released and committed (as a concurrent release looks under READ COMMITTED).
    await deps.db.query('create table if not exists purge_race (due text, other text, at timestamptz)');
    await deps.db.query('insert into purge_race values ($1, $2, $3)', [due.code, open.code, plus(t0, 30)]);
    await deps.db.query(`create or replace function purge_race_fn() returns trigger language plpgsql security definer as $$
      begin
        update trades t set state = 'released', closed_at = r.at from purge_race r where r.due = old.code and t.code = r.other;
        return old;
      end $$`);
    await deps.db.query('drop trigger if exists purge_race_t on trades');
    await deps.db.query('create trigger purge_race_t after delete on trades for each row execute function purge_race_fn()');
    try {
      await purgeTrades(deps.db, when);
    } finally {
      await deps.db.query('drop trigger purge_race_t on trades');
      await deps.db.query('delete from purge_race');
    }
    expect(await exists(due.code)).toBe(false);
    const after = await traderSummary(deps.db, seller, when, null, 'seller');
    expect(after.completedTrades).toBe(2);
    expect((await deps.db.query<{ n: number }>('select purged_completed as n from account_traded_totals where account_id = $1', [seller])).rows[0]!.n).toBe(1);
  });

  it('m1: the database refuses x2f_purge a delete of an open trade or of a dispute that is not closed', async () => {
    const { seller, buyer } = await pair();
    const { code } = await seedTrade(deps, { sellerId: seller, buyerId: buyer, poster: 'seller' });
    const asPurge = async (sql: string, args: unknown[]) => {
      const c = await deps.db.connect();
      try {
        await c.query('begin');
        await c.query('set local role x2f_purge');
        await c.query(sql, args);
      } finally {
        await c.query('rollback');
        c.release();
      }
    };
    await expect(asPurge('delete from trades where code = $1', [code])).rejects.toMatchObject({ code: '42501' });
    const t0 = new Date('2026-03-11T00:00:00Z');
    const done = await closed(t0);
    await addDispute(done.code, 1, 'published', { openedAt: t0 });
    await expect(asPurge('delete from disputes where code = $1', [done.code])).rejects.toMatchObject({ code: '42501' });
    await deps.db.query(`update trades set state = 'disputed', closed_at = null where code = $1`, [done.code]);
    await expect(asPurge('delete from trades where code = $1', [done.code])).rejects.toMatchObject({ code: '42501' });
  });

  it("m2: the team log forgets the purged trade's code (199)", async () => {
    const t0 = new Date('2026-03-12T00:00:00Z');
    const { code, buyer } = await closed(t0);
    const member = (await deps.db.query<{ id: string }>(
      `insert into team_members (account_id, display_name, display_key, abilities, invite_expires_at, created_at)
       values ($1, 'Desk', 'desk', $3, $2, $2) returning id`,
      [buyer, t0, rolesToAbilities(['trades'])],
    )).rows[0]!.id;
    await deps.db.query(`insert into team_audit (account_id, member_id, at, action, trade_code) values ($1, $2, $3, 'mark-paid', $4)`, [buyer, member, t0, code]);
    await purgeTrades(deps.db, plus(t0, 31));
    expect(await exists(code)).toBe(false);
    const { rows } = await deps.db.query<{ trade_code: string | null }>('select trade_code from team_audit where member_id = $1', [member]);
    expect(rows).toEqual([{ trade_code: null }]);
  });
});
