// Plan 7 Task 2: the whole-trade purge (owner 2026-10-29, R36). Review Focus 1-3 as database tests
// on a fixed clock: a dispute is never stripped of evidence, deleted means deleted (no row anywhere
// still names the trade), and nothing deletes a trade early, the app role included.
import { randomBytes } from 'node:crypto';
import { DISPUTE_KEEP_DAYS, TRADE_KEEP_DAYS, type Trade } from '@x2f/trade';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { startRetention, type RetentionLog } from '../src/retention.js';
import { TRADE_CHILD_TABLES, purgeTrades, purgeTradesJob, tradeDeleteDate } from '../src/retention/tradePurge.js';
import { COMPLETED_TRADES_SQL, tradeCap } from '../src/traders/stage.js';
import { applyEvent } from '../src/trades/store.js';
import { driveTo, seedTrade } from './helpers/trades.js';
import { tradeApp } from './helpers/tradeApp.js';

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let trader: Awaited<ReturnType<typeof tradeApp>>['trader'];

const START = new Date('2026-10-17T12:00:00Z');
const DAY = 86_400_000;
const at = (days: number, ms = 0) => new Date(START.getTime() + days * DAY + ms);
const tx = () => randomBytes(32).toString('hex');

beforeAll(async () => {
  ({ app, deps, trader, setNow } = await tradeApp());
});
afterAll(async () => {
  await app.close();
});

async function tradeIn(state: Parameters<typeof driveTo>[2]) {
  setNow(START);
  const seller = await trader();
  const buyer = await trader();
  const { trade } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
  const t = await driveTo(deps, trade, state);
  return { seller, buyer, t };
}

/** The moderation rows a trade gathers (111): identities, attestation, refusal, work row. */
async function addTradeRecords(code: string) {
  for (const role of ['buyer', 'seller']) {
    await deps.db.query('insert into trade_identities (code, role, sign_public, box_public, proof) values ($1, $2, $3, $3, $3)', [code, role, 'ab'.repeat(32)]);
  }
  await deps.db.query(`insert into trade_attestations (code, attestation, sig) values ($1, '{}', 'x')`, [code]);
  await deps.db.query(`insert into trade_refusals (code, reason) values ($1, 'bad-proof')`, [code]);
  await deps.db.query('insert into trade_work_served (code, served_at) values ($1, $2)', [code, START]);
}

/** The buyer opens a dispute at `when`, as the dispute route does (the row with the trade). */
async function openDispute(code: string, when: Date, afterRefund = false): Promise<Trade> {
  return applyEvent({ ...deps, clock: () => when }, code, { type: 'open-dispute' }, 'buyer', async (c, _p, _n, now) => {
    await c.query(
      `insert into disputes (code, seq, opened_by, reason, note, opened_at, after_refund)
       values ($1, (select coalesce(max(seq), 0) + 1 from disputes where code = $1), 'buyer', 'paid', 'my note', $2, $3)`,
      [code, now, afterRefund],
    );
  });
}

/** What Plan 4 writes: a final ruling, the trade settled at `when`, the dispute closed. */
async function settleDispute(code: string, when: Date, outcome: 'release-to-buyer' | 'refund-to-seller') {
  await deps.db.query(
    `insert into dispute_rulings (code, seq, round, outcome, reason, moderator_name, ruled_at, appeal_until)
     values ($1, (select max(seq) from disputes where code = $1), 2, $2, 'Shown in the chat.', 'sarah.v', $3, null)`,
    [code, outcome, when],
  );
  await deps.db.query(`insert into dispute_appeals (code, seq, by, why, at) values ($1, (select max(seq) from disputes where code = $1), 'seller', 'I was never paid at all.', $2)`, [code, when]);
  const kind = outcome === 'release-to-buyer' ? 'release' : 'mutual-cancel';
  await applyEvent({ ...deps, clock: () => when }, code, { type: 'settled', kind, txHash: tx() }, 'system');
  await deps.db.query(`update disputes set status = 'closed', closed_at = $2 where code = $1`, [code, when]);
}

const exists = async (code: string) => (await deps.db.query('select 1 from trades where code = $1', [code])).rows.length === 1;

/** Every row of every table in the schema, as text, searched for the trade code: nothing may still name it. */
async function rowsNaming(code: string): Promise<string[]> {
  const { rows: tables } = await deps.db.query<{ t: string }>(
    `select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'r' and n.nspname = current_schema() order by 1`,
  );
  const hits: string[] = [];
  for (const { t } of tables) {
    const { rows } = await deps.db.query(`select 1 from "${t}" x where x::text like $1 limit 1`, [`%${code}%`]);
    if (rows.length > 0) hits.push(t);
  }
  return hits;
}

const completed = async (id: string) =>
  Number((await deps.db.query<{ n: string }>(`select ${COMPLETED_TRADES_SQL} as n from accounts a where a.id = $1`, [id])).rows[0]!.n);

describe('purgeTrades (Plan 7 Task 2)', () => {
  it('deletes a released trade whole at close + 30 days, not 1 ms before, and the counts stay', async () => {
    const { seller, buyer, t } = await tradeIn('released');
    await addTradeRecords(t.code);
    const closed = t.closedAt!;
    const before = { s: await completed(seller.id), b: await completed(buyer.id), cap: await tradeCap(deps.db, buyer.id, at(40)) };
    expect(before.s).toBeGreaterThan(0);
    expect(await tradeDeleteDate(deps.db, t.code, START)).toEqual(new Date(closed.getTime() + TRADE_KEEP_DAYS * DAY));

    await purgeTrades(deps.db, new Date(closed.getTime() + TRADE_KEEP_DAYS * DAY - 1));
    expect(await exists(t.code)).toBe(true);

    await purgeTrades(deps.db, new Date(closed.getTime() + TRADE_KEEP_DAYS * DAY));
    expect(await exists(t.code)).toBe(false);
    expect(await rowsNaming(t.code)).toEqual([]);
    expect(await completed(seller.id)).toBe(before.s);
    expect(await completed(buyer.id)).toBe(before.b);
    expect(await tradeCap(deps.db, buyer.id, at(40))).toEqual(before.cap);

    // The trade is gone for its traders too.
    setNow(at(31));
    await buyer.browser.post('/t/login', { accountId: buyer.id });
    expect((await buyer.browser.get(`/v1/trades/${t.code}`)).statusCode).toBe(404);
  });

  it('never deletes an open trade, however old', async () => {
    const { t } = await tradeIn('secured');
    expect(await tradeDeleteDate(deps.db, t.code, START)).toBeNull();
    await purgeTrades(deps.db, at(5_000));
    expect(await exists(t.code)).toBe(true);
  });

  it('a dispute opened at day 29 keeps everything until 90 days after the button, and nothing while it is open', async () => {
    const { t } = await tradeIn('secured');
    const refunded = await applyEvent(deps, t.code, { type: 'settled', kind: 'mutual-cancel', txHash: tx() }, 'system');
    expect(refunded.state).toBe('refunded');
    await addTradeRecords(t.code);
    await openDispute(t.code, at(29), true);
    // Open: never, even long after 90 days.
    await purgeTrades(deps.db, at(29 + DISPUTE_KEEP_DAYS + 50));
    expect(await exists(t.code)).toBe(true);
    // Ruled and closed at day 40.
    await settleDispute(t.code, at(40), 'refund-to-seller');
    expect(await tradeDeleteDate(deps.db, t.code, at(41))).toEqual(at(29 + DISPUTE_KEEP_DAYS));
    await purgeTrades(deps.db, at(70)); // 30 days after the ruling: still kept
    expect(await exists(t.code)).toBe(true);
    await purgeTrades(deps.db, at(29 + DISPUTE_KEEP_DAYS, -1));
    expect(await exists(t.code)).toBe(true);
    expect((await deps.db.query('select 1 from disputes where code = $1', [t.code])).rows).toHaveLength(1);
    await purgeTrades(deps.db, at(29 + DISPUTE_KEEP_DAYS));
    expect(await exists(t.code)).toBe(false);
    expect(await rowsNaming(t.code)).toEqual([]);
  });

  it('keeps a ruled dispute while its appeal window is open, and a closed one opened long ago goes at once', async () => {
    const { t } = await tradeIn('secured');
    await openDispute(t.code, at(1));
    await deps.db.query(
      `insert into dispute_rulings (code, seq, round, outcome, reason, moderator_name, ruled_at, appeal_until)
       values ($1, 1, 1, 'release-to-buyer', 'Shown in the chat.', 'sarah.v', $2, $3)`,
      [t.code, at(100), at(102)],
    );
    await deps.db.query(`update disputes set status = 'ruled' where code = $1`, [t.code]);
    await applyEvent({ ...deps, clock: () => at(100) }, t.code, { type: 'settled', kind: 'release', txHash: tx() }, 'system');
    // Past the 90 days from the button, but the appeal is still possible: kept.
    await purgeTrades(deps.db, at(101));
    expect(await exists(t.code)).toBe(true);
    // The window lapsed with no appeal: due at once (90 days from the button are long past).
    await purgeTrades(deps.db, at(102, 1));
    expect(await exists(t.code)).toBe(false);
  });

  it('keeps a refunded trade through the buyer\'s dispute-after-refund window', async () => {
    const { t } = await tradeIn('secured');
    const refunded = await applyEvent(deps, t.code, { type: 'settled', kind: 'auto-refund', txHash: tx() }, 'system');
    const deleteAt = (await tradeDeleteDate(deps.db, t.code, START))!;
    expect(deleteAt.getTime()).toBeGreaterThanOrEqual(refunded.closedAt!.getTime() + TRADE_KEEP_DAYS * DAY);
    await purgeTrades(deps.db, new Date(deleteAt.getTime() - 1));
    expect(await exists(t.code)).toBe(true);
    await purgeTrades(deps.db, deleteAt);
    expect(await exists(t.code)).toBe(false);
  });

  it('a dispute opened while the purge waits for the trade\'s lock keeps the trade (no race)', async () => {
    const { t } = await tradeIn('released');
    const due = at(TRADE_KEEP_DAYS + 1);
    let entered!: () => void;
    const inside = new Promise<void>((r) => (entered = r));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    // Late funds after the end: the system escalates, holding the trade's lock until the gate opens.
    const escalating = applyEvent({ ...deps, clock: () => due }, t.code, { type: 'escalate' }, 'system', async () => {
      entered();
      await gate;
    });
    await inside;
    const purging = purgeTrades(deps.db, due);
    await new Promise((r) => setTimeout(r, 200));
    release();
    expect((await escalating).state).toBe('disputed');
    expect(await purging).toBe(0);
    expect(await exists(t.code)).toBe(true);
  });

  it('is idempotent, logs no trade code, and is the last retention job', async () => {
    const { t } = await tradeIn('released');
    const due = at(TRADE_KEEP_DAYS + 1);
    const lines: RetentionLog[] = [];
    const stop = startRetention({ db: deps.db, clock: () => due }, [purgeTradesJob], 20, (e) => void lines.push(e));
    await new Promise((r) => setTimeout(r, 300));
    await stop();
    expect(await exists(t.code)).toBe(false);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((l) => l.job === 'purgeTrades' && !('failed' in l))).toBe(true);
    expect(JSON.stringify(lines)).not.toContain(t.code);
    expect(await purgeTrades(deps.db, due)).toBe(0);
  });

  it('the app role can delete no trade and no dispute record; truncate is refused', async () => {
    const { t } = await tradeIn('secured');
    await openDispute(t.code, at(1));
    await deps.db.query(
      `insert into dispute_rulings (code, seq, round, outcome, reason, moderator_name, ruled_at, appeal_until)
       values ($1, 1, 1, 'release-to-buyer', 'Shown in the chat.', 'sarah.v', $2, $3)`,
      [t.code, at(2), at(4)],
    );
    await deps.db.query(`insert into dispute_appeals (code, seq, by, why, at) values ($1, 1, 'seller', 'I was never paid at all.', $2)`, [t.code, at(3)]);
    for (const table of ['dispute_appeals', 'dispute_rulings', 'disputes', 'trades']) {
      await expect(deps.db.query(`delete from ${table} where code = $1`, [t.code])).rejects.toMatchObject({ code: '42501' });
      await expect(deps.db.query(`truncate ${table} cascade`)).rejects.toMatchObject({ code: '42501' });
    }
    expect(await exists(t.code)).toBe(true);
  });

  it('every foreign key to a trade (or to a row hanging from one) is in the delete order or cascades', async () => {
    const { rows } = await deps.db.query<{ child: string; parent: string; action: string }>(
      `select conrelid::regclass::text as child, confrelid::regclass::text as parent, confdeltype as action
         from pg_constraint where contype = 'f'`,
    );
    const order: string[] = [...TRADE_CHILD_TABLES, 'trades'];
    const doomed = new Set(order);
    // Tables reachable from trades by foreign keys.
    for (let grew = true; grew; ) {
      grew = false;
      for (const r of rows) if (doomed.has(r.parent) && !doomed.has(r.child) && r.action === 'c') (doomed.add(r.child), (grew = true));
    }
    for (const r of rows.filter((x) => doomed.has(x.parent))) {
      if (r.action === 'c') continue;
      expect(order, `${r.child} references ${r.parent} without cascade: add it to TRADE_CHILD_TABLES`).toContain(r.child);
      if (r.child !== r.parent) expect(order.indexOf(r.child), `${r.child} must be deleted before ${r.parent}`).toBeLessThan(order.indexOf(r.parent));
    }
  });
});
