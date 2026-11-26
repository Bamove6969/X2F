// Review m7 and re-review m3 (mod polish): the Activity log's active-disputes list and the training
// curator's list are paged with a cursor, newest first; the log's page load no longer re-hashes the
// chain, and the owner's on-demand check is the whole check from the first row, so it still catches
// a tampered row, including one a check from a checkpoint would miss.
import { chainHash } from '@x2f/logchain';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../../src/app.js';
import { appendLog } from '../../src/log/append.js';
import { verifyLogChain } from '../../src/log/verify.js';
import { ACTIVE_PAGE } from '../../src/staff/activityLog.js';
import { REVIEW_PAGE, trainingId } from '../../src/staff/training.js';
import { seedAccount } from '../helpers/accounts.js';
import { StaffBrowser, insertSession, seedStaff, staffApps } from '../helpers/staffApp.js';
import { seedTrade, type SeededTrade } from '../helpers/trades.js';

const T0 = new Date('2026-11-20T09:00:00.000Z');
const MIN = 60_000;

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let close: () => Promise<void>;
let owner: StaffBrowser;
let mod: StaffBrowser;
let ownerId: string;
/** Five open disputes: two share an opening time, so the cursor's tie-break is tested. */
let open: SeededTrade[];
/** One trade with many closed dispute rounds (seq), for the curator's list. */
let closed: SeededTrade;
const CLOSED_ROUNDS = REVIEW_PAGE + 3;

async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await deps.db.connect();
  try {
    await c.query('begin');
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

async function dispute(code: string, seq: number, openedAt: Date, closedAt: Date | null) {
  await deps.db.query(
    `insert into disputes (code, seq, opened_by, reason, note, opened_at, reply_due_at, ruling_due_at, usd_cents, limit_usd_cents, status, closed_at)
     values ($1, $2, 'buyer', 'paid', '', $3, $3, $3, 41250, 100000, $4, $5)`,
    [code, seq, openedAt, closedAt === null ? 'open' : 'closed', closedAt],
  );
}

beforeAll(async () => {
  ({ app, deps, setNow, close } = await staffApps());
  setNow(T0);
  const o = await seedStaff(deps, { role: 'owner' });
  const m = await seedStaff(deps, { role: 'mod' });
  ownerId = o.id;
  owner = new StaffBrowser(app).withSession((await insertSession(deps, o.id, 'staff')).token);
  mod = new StaffBrowser(app).withSession((await insertSession(deps, m.id, 'staff')).token);
  const buyer = await seedAccount(deps, { loginName: 'pg_buyer_one' });
  const seller = await seedAccount(deps, { loginName: 'pg_seller_one' });
  open = [];
  for (let i = 0; i < 5; i++) open.push(await seedTrade(deps, { sellerId: seller, buyerId: buyer, poster: 'seller' }));
  // Opened at T0+1, +2, +3, +3 (a tie), +4 minutes.
  const at = [1, 2, 3, 3, 4].map((n) => new Date(T0.getTime() + n * MIN));
  for (let i = 0; i < 5; i++) await dispute(open[i]!.code, 1, at[i]!, null);
  closed = await seedTrade(deps, { sellerId: seller, buyerId: buyer, poster: 'seller' });
  // Rounds 1..N closed; rounds 1 and 2 close at the same moment (a tie broken by seq).
  for (let seq = 1; seq <= CLOSED_ROUNDS; seq++) {
    const closedAt = new Date(T0.getTime() + Math.max(2, seq) * MIN);
    await dispute(closed.code, seq, new Date(T0.getTime()), closedAt);
  }
  for (let i = 0; i < 12; i++) {
    await tx((c) => appendLog(c, { at: deps.clock(), actor: { kind: 'staff', id: ownerId, role: 'owner' }, tradeCode: null, action: 'settings.changed', detail: { field: 'large_trade_limit_usd', from: i, to: i + 1 } }));
  }
});
afterAll(async () => close());

type Active = { items: Array<{ code: string; status: string }>; next: string | null };

/** Every active dispute's code, read page by page. */
async function allActive(b: StaffBrowser, limit: number): Promise<{ codes: string[]; pages: number }> {
  const codes: string[] = [];
  let before: string | null = null;
  let pages = 0;
  do {
    const res = await b.get(`/staff/v1/log/active-disputes?limit=${limit}${before ? `&before=${before}` : ''}`);
    expect(res.statusCode, res.body).toBe(200);
    const p = res.json() as Active;
    pages++;
    expect(p.items.length).toBeLessThanOrEqual(limit);
    codes.push(...p.items.map((i) => i.code));
    before = p.next;
  } while (before !== null);
  return { codes, pages };
}

describe('the active disputes, paged newest first (review m7)', () => {
  const expected = () => {
    // Newest opened first; the two opened at +3 min in code order.
    const tie = [open[2]!.code, open[3]!.code].sort();
    return [open[4]!.code, ...tie, open[1]!.code, open[0]!.code];
  };

  it('one page holds them all by default, newest opened first, with no next', async () => {
    const p = (await mod.get('/staff/v1/log/active-disputes')).json() as Active;
    expect(p.items.map((i) => i.code)).toEqual(expected());
    expect(p.next).toBeNull();
    expect(ACTIVE_PAGE).toBe(100);
  });

  it('pages of every size read each dispute once, in order, across the tie', async () => {
    for (const limit of [1, 2, 3, 4, 5, 6]) {
      const { codes, pages } = await allActive(mod, limit);
      expect(codes, `limit ${limit}`).toEqual(expected());
      // A page that ends exactly on the last dispute has no next: never an empty page after it.
      expect(pages, `limit ${limit}`).toBe(Math.ceil(5 / limit));
    }
  });

  it('a cursor typed without dashes or in lower case is the same cursor', async () => {
    const first = (await mod.get('/staff/v1/log/active-disputes?limit=2')).json() as Active;
    const raw = first.next!.replace(/-/g, '').toLowerCase();
    const a = (await mod.get(`/staff/v1/log/active-disputes?limit=2&before=${first.next}`)).json() as Active;
    const b = (await mod.get(`/staff/v1/log/active-disputes?limit=2&before=${raw}`)).json() as Active;
    expect(b).toEqual(a);
  });

  it('a cursor whose dispute closed after its page was read still marks the place', async () => {
    const first = (await mod.get('/staff/v1/log/active-disputes?limit=2')).json() as Active;
    const cursor = first.next!;
    await deps.db.query(`update disputes set status = 'closed', closed_at = $2 where code = $1`, [cursor, deps.clock()]);
    try {
      const rest = (await mod.get(`/staff/v1/log/active-disputes?limit=10&before=${cursor}`)).json() as Active;
      expect(rest.items.map((i) => i.code)).toEqual(expected().slice(2));
    } finally {
      await deps.db.query(`update disputes set status = 'open', closed_at = null where code = $1`, [cursor]);
    }
  });

  it('openings within one millisecond: the cursor compares Postgres microseconds, so the older one is not skipped', async () => {
    // A JS Date keeps milliseconds only: a cursor time read back and sent again would drop the
    // microseconds and skip open[0], opened 300 µs before open[1] in the same millisecond.
    const base = new Date(T0.getTime() + 90 * 1000);
    await deps.db.query(`update disputes set opened_at = $2::timestamptz + interval '400 microseconds' where code = $1`, [open[1]!.code, base]);
    await deps.db.query(`update disputes set opened_at = $2::timestamptz + interval '100 microseconds' where code = $1`, [open[0]!.code, base]);
    try {
      const first = (await mod.get('/staff/v1/log/active-disputes?limit=4')).json() as Active;
      expect(first.next).toBe(open[1]!.code);
      const rest = (await mod.get(`/staff/v1/log/active-disputes?limit=4&before=${first.next}`)).json() as Active;
      expect(rest.items.map((i) => i.code)).toEqual([open[0]!.code]);
    } finally {
      for (const [i, n] of [[0, 1], [1, 2]] as const) await deps.db.query('update disputes set opened_at = $2 where code = $1', [open[i]!.code, new Date(T0.getTime() + n * MIN)]);
    }
  });

  it('an unknown cursor is a 404; a malformed cursor, limit or extra key is a 400', async () => {
    expect((await mod.get('/staff/v1/log/active-disputes?before=ZZZZ-ZZZZ-ZZZZ-ZZZZ')).statusCode).toBe(404);
    for (const qs of ['before=nope', 'before=', 'limit=0', 'limit=101', 'limit=1e2', 'limit=-1', 'page=2', 'before=A&before=B']) {
      expect((await mod.get(`/staff/v1/log/active-disputes?${qs}`)).statusCode, qs).toBe(400);
    }
  });
});

describe('the chain check: on demand only, and as strong as ever (review m7)', () => {
  type Status = { entries: number; headId: string | null; alarm: string | null };
  type Check = { checkedAt: string; chain: { ok: boolean; headId?: string; brokenAt?: string }; entries: number; alarm: string | null };

  it('the page load reads the count, the newest entry and the alarm, and no verdict', async () => {
    const res = await owner.get('/staff/v1/log/integrity');
    expect(res.statusCode, res.body).toBe(200);
    const s = res.json() as Status & Record<string, unknown>;
    const head = (await deps.db.query<{ id: string }>('select l.id::text as id from activity_log l order by l.id desc limit 1')).rows[0]!.id;
    expect(s).toEqual({ entries: 12, headId: head, alarm: null });
    expect(s).not.toHaveProperty('chain');
  });

  it('the check passes an intact chain; a moderator may run neither; a body is refused', async () => {
    const c = (await owner.post('/staff/v1/log/integrity/check', {})).json() as Check;
    expect(c.chain.ok).toBe(true);
    expect(c.entries).toBe(12);
    expect((await mod.post('/staff/v1/log/integrity/check', {})).statusCode).toBe(403);
    expect((await mod.get('/staff/v1/log/integrity')).statusCode).toBe(403);
    expect((await owner.post('/staff/v1/log/integrity/check', { from: '1' })).statusCode).toBe(400);
  });

  /** Edits rows as the superuser with the triggers off, then puts them back. */
  async function tampered(fn: () => Promise<void>, check: () => Promise<void>) {
    const saved = (await deps.db.query('select id, detail, prev_hash, hash from activity_log order by id')).rows as Array<{ id: string; detail: string; prev_hash: Buffer | null; hash: Buffer }>;
    await deps.db.query('alter table activity_log disable trigger user');
    try {
      await fn();
      await check();
    } finally {
      for (const r of saved) await deps.db.query('update activity_log set detail = $2, prev_hash = $3, hash = $4 where id = $1', [r.id, r.detail, r.prev_hash, r.hash]);
      await deps.db.query('alter table activity_log enable trigger user');
    }
    expect((await verifyLogChain(deps.db)).ok).toBe(true);
  }

  it('catches an old row whose text changed: brokenAt is that row, while the page load still reads no verdict', async () => {
    const ids = (await deps.db.query<{ id: string }>('select id::text as id from activity_log l order by l.id')).rows.map((r) => r.id);
    await tampered(
      async () => {
        await deps.db.query(`update activity_log set detail = $2 where id = $1`, [ids[1], JSON.stringify({ field: 'large_trade_limit_usd', from: 1, to: 99 })]);
      },
      async () => {
        expect((await owner.get('/staff/v1/log/integrity')).json()).not.toHaveProperty('chain');
        const c = (await owner.post('/staff/v1/log/integrity/check', {})).json() as Check;
        expect(c.chain).toEqual({ ok: false, brokenAt: ids[1] });
      },
    );
  });

  it('catches an old row rewritten and re-chained up to a checkpoint, which a check from that checkpoint would pass', async () => {
    const rows = (
      await deps.db.query<{ id: string; at: Date; actor_kind: 'staff'; actor_id: string; actor_role: string; trade_code: string | null; action: string; detail: string; hash: Buffer }>(
        'select id::text as id, at, actor_kind, actor_id::text as actor_id, actor_role, trade_code, action, detail, hash from activity_log l order by l.id',
      )
    ).rows;
    const head = rows[rows.length - 1]!;
    const checkpoint = { id: head.id, hash: head.hash.toString('hex') };
    await tampered(
      async () => {
        // Row 2 says something else; rows 2 .. head-1 are re-hashed so each links to the one before.
        let prev: Buffer = rows[0]!.hash;
        for (let i = 1; i < rows.length - 1; i++) {
          const r = rows[i]!;
          const detail = i === 1 ? JSON.stringify({ field: 'large_trade_limit_usd', from: 1, to: 99 }) : r.detail;
          const hash = chainHash(prev, { id: r.id, at: r.at, actorKind: r.actor_kind, actorId: r.actor_id, actorRole: r.actor_role, tradeCode: r.trade_code, action: r.action, detail });
          await deps.db.query('update activity_log set detail = $2, prev_hash = $3, hash = $4 where id = $1', [r.id, detail, prev, hash]);
          prev = hash;
        }
      },
      async () => {
        // What an incremental check from the newest checkpoint would say: nothing wrong.
        expect((await verifyLogChain(deps.db, checkpoint)).ok).toBe(true);
        // The owner's check re-hashes from the first row: the head no longer links to the row before it.
        const c = (await owner.post('/staff/v1/log/integrity/check', {})).json() as Check;
        expect(c.chain).toEqual({ ok: false, brokenAt: head.id });
      },
    );
  });
});

describe("the training curator's list, paged newest closed first (re-review m3)", () => {
  type Review = { items: Array<{ id: string; status: string }>; next: string | null };
  const idOf = (seq: number) => trainingId(deps.config.trainingIdKey, closed.code, seq);
  /** Newest closed first: seq N..3, then 2 and 1 (closed at the same moment) by seq, descending. */
  const expected = () => Array.from({ length: CLOSED_ROUNDS }, (_, i) => idOf(CLOSED_ROUNDS - i));

  it('the first page holds REVIEW_PAGE cases and a cursor; the next holds the rest; no case twice, none missed', async () => {
    const one = (await owner.get('/staff/v1/training/review')).json() as Review;
    expect(one.items).toHaveLength(REVIEW_PAGE);
    expect(one.next).toBe(one.items[REVIEW_PAGE - 1]!.id);
    const two = (await owner.get(`/staff/v1/training/review?before=${one.next}`)).json() as Review;
    expect(two.items).toHaveLength(CLOSED_ROUNDS - REVIEW_PAGE);
    expect(two.next).toBeNull();
    expect([...one.items, ...two.items].map((i) => i.id)).toEqual(expected());
    // The trade code is never in an answer, the cursor included.
    expect(JSON.stringify([one, two])).not.toContain(closed.code);
  });

  it('a cursor on the tie reads the tied case after it, then nothing', async () => {
    const p = (await owner.get(`/staff/v1/training/review?before=${idOf(2)}`)).json() as Review;
    expect(p).toEqual({ items: [expect.objectContaining({ id: idOf(1), status: 'unmarked' })], next: null });
    expect((await owner.get(`/staff/v1/training/review?before=${idOf(1)}`)).json()).toEqual({ items: [], next: null });
  });

  it('closings within one millisecond: the cursor compares Postgres microseconds, so the older one is not skipped', async () => {
    const base = new Date(T0.getTime() + 4 * MIN);
    await deps.db.query(`update disputes set closed_at = $2::timestamptz + interval '400 microseconds' where code = $1 and seq = 5`, [closed.code, base]);
    await deps.db.query(`update disputes set closed_at = $2::timestamptz + interval '100 microseconds' where code = $1 and seq = 4`, [closed.code, base]);
    try {
      const p = (await owner.get(`/staff/v1/training/review?before=${idOf(5)}`)).json() as Review;
      expect(p.items.map((i) => i.id)).toEqual([idOf(4), idOf(3), idOf(2), idOf(1)]);
    } finally {
      for (const seq of [4, 5]) await deps.db.query('update disputes set closed_at = $3 where code = $1 and seq = $2', [closed.code, seq, new Date(T0.getTime() + seq * MIN)]);
    }
  });

  it('an unknown cursor is a 404; a malformed one or another key is a 400; only a curator reads it', async () => {
    expect((await owner.get(`/staff/v1/training/review?before=${'0'.repeat(32)}`)).statusCode).toBe(404);
    for (const qs of ['before=xyz', `before=${'A'.repeat(32)}`, 'page=2']) expect((await owner.get(`/staff/v1/training/review?${qs}`)).statusCode, qs).toBe(400);
    expect((await mod.get(`/staff/v1/training/review?before=${idOf(2)}`)).statusCode).toBe(403);
  });
});
