import { randomUUID } from 'node:crypto';
import type { Actor } from '@x2f/staff';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { LogDetailError, assertDetail } from '../src/log/actions.js';
import { appendLog, chainHash } from '../src/log/append.js';
import { queryLog } from '../src/log/query.js';
import { verifyLogChain } from '../src/log/verify.js';
import { applyEvent } from '../src/trades/store.js';
import { seedAccount } from './helpers/accounts.js';
import { testConfig } from './helpers/app.js';
import { testDb } from './helpers/db.js';
import { driveTo, fakeAddress, seedTrade } from './helpers/trades.js';

let deps: Pick<Deps, 'db' | 'clock' | 'config'>;
const now = new Date('2027-02-01T10:00:00.123Z');
let n = 0;

beforeAll(async () => {
  deps = { db: await testDb({ max: 12 }), clock: () => now, config: testConfig() };
});
afterAll(async () => {
  await deps.db.end();
});

const owner: Actor = { kind: 'staff', id: randomUUID(), role: 'owner' };
const mod: Actor = { kind: 'staff', id: randomUUID(), role: 'mod' };

async function tx<T>(db: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await db.connect();
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

const append = (db: pg.Pool, e: Partial<Parameters<typeof appendLog>[1]> = {}) =>
  tx(db, (c) => appendLog(c, { at: now, actor: owner, tradeCode: null, action: 'site.stopped', detail: {}, ...e }));

async function trade() {
  const seller = await seedAccount(deps, { loginName: `logseller${++n}` });
  const buyer = await seedAccount(deps, { loginName: `logbuyer${n}` });
  return seedTrade(deps, { sellerId: seller, buyerId: buyer, poster: 'seller' });
}

describe('appendLog and the chain', () => {
  it('50 concurrent appends give one unbroken chain', async () => {
    await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        append(deps.db, { action: 'settings.changed', detail: { field: 'first_response_h', from: i, to: i + 1 } }),
      ),
    );
    const v = await verifyLogChain(deps.db);
    expect(v.ok).toBe(true);
    const { rows } = await deps.db.query<{ n: string }>('select count(*)::text as n from activity_log');
    expect(Number(rows[0]!.n)).toBeGreaterThanOrEqual(50);
  });

  it('returns the id and hash it stored, and verify from a checkpoint works', async () => {
    const a = await append(deps.db);
    const b = await append(deps.db, { action: 'site.resumed' });
    const { rows } = await deps.db.query<{ hash: Buffer; prev_hash: Buffer }>(
      'select hash, prev_hash from activity_log where id = $1', [b.id],
    );
    expect(rows[0]!.hash.toString('hex')).toBe(b.hash);
    expect(rows[0]!.prev_hash.toString('hex')).toBe(a.hash);
    const v = await verifyLogChain(deps.db, a);
    expect(v).toEqual({ ok: true, head: { id: expect.any(String), hash: expect.any(String) } });
    expect(await verifyLogChain(deps.db, { id: a.id, hash: b.hash })).toEqual({ ok: false, brokenAt: a.id });
  });

  it('UPDATE, DELETE and TRUNCATE each raise', async () => {
    await append(deps.db);
    await expect(deps.db.query("update activity_log set detail = '{}'")).rejects.toThrow(/append-only/);
    await expect(deps.db.query('delete from activity_log')).rejects.toThrow(/append-only/);
    await expect(deps.db.query('truncate activity_log')).rejects.toThrow(/append-only/);
  });

  it('an insert with a stale prev_hash (a fork) raises', async () => {
    const old = await append(deps.db);
    await append(deps.db);
    const id = (await deps.db.query<{ id: string }>("select nextval(pg_get_serial_sequence('activity_log','id'))::text as id")).rows[0]!.id;
    const fields = { id, at: now, actorKind: 'system' as const, actorId: null, actorRole: null, tradeCode: null, action: 'site.stopped', detail: '{}' };
    const hash = chainHash(Buffer.from(old.hash, 'hex'), fields);
    await expect(
      deps.db.query(
        `insert into activity_log (id, at, actor_kind, action, detail, prev_hash, hash) values ($1, $2, 'system', 'site.stopped', '{}', $3, $4)`,
        [id, now, Buffer.from(old.hash, 'hex'), hash],
      ),
    ).rejects.toThrow(/fork/);
  });

  it('an insert whose hash does not match its row raises', async () => {
    await expect(
      tx(deps.db, async (c) => {
        const head = (await c.query<{ hash: Buffer }>('select hash from activity_log order by id desc limit 1')).rows[0]!.hash;
        await c.query(
          `insert into activity_log (at, actor_kind, action, detail, prev_hash, hash) values ($1, 'system', 'site.stopped', '{}', $2, $3)`,
          [now, head, Buffer.alloc(32)],
        );
      }),
    ).rejects.toThrow(/hash does not match/);
  });

  it('the first row may not carry a prev_hash', async () => {
    const db = await testDb();
    try {
      await expect(
        db.query(`insert into activity_log (at, actor_kind, action, detail, prev_hash, hash) values ($1, 'system', 'site.stopped', '{}', $2, $2)`, [
          now, Buffer.alloc(32),
        ]),
      ).rejects.toThrow(/first row/);
    } finally {
      await db.end();
    }
  });

  it('tamper: a changed detail is found at that id', async () => {
    const db = await testDb();
    try {
      await append(db);
      const mid = await append(db, { action: 'settings.changed', detail: { field: 'appeal_window_h', from: 48, to: 72 } });
      await append(db);
      expect((await verifyLogChain(db)).ok).toBe(true);
      // As the superuser, with the triggers off.
      await db.query('alter table activity_log disable trigger user');
      await db.query(`update activity_log set detail = '{"field":"appeal_window_h","from":48,"to":12}' where id = $1`, [mid.id]);
      await db.query('alter table activity_log enable trigger user');
      expect(await verifyLogChain(db)).toEqual({ ok: false, brokenAt: mid.id });
    } finally {
      await db.end();
    }
  });

  it('a removed row breaks the chain at the next one', async () => {
    const db = await testDb();
    try {
      await append(db);
      const mid = await append(db);
      const last = await append(db);
      await db.query('alter table activity_log disable trigger user');
      await db.query('delete from activity_log where id = $1', [mid.id]);
      await db.query('alter table activity_log enable trigger user');
      expect(await verifyLogChain(db)).toEqual({ ok: false, brokenAt: last.id });
    } finally {
      await db.end();
    }
  });
});

describe('details', () => {
  it('refuses unknown keys, long strings and nested values', () => {
    expect(() => assertDetail('chat.read', { text: 'hi' })).toThrow(LogDetailError);
    expect(() => assertDetail('dispute.assigned', { staffId: 'x'.repeat(65) })).toThrow(LogDetailError);
    expect(() => assertDetail('dispute.assigned', { staffId: { a: 1 } })).toThrow(LogDetailError);
    expect(() => assertDetail('dispute.assigned', { staffId: 'two words' })).toThrow(LogDetailError);
    expect(() => assertDetail('ruling.proposed', { amountAtomic: '-1' })).toThrow(LogDetailError);
    expect(() => assertDetail('nope' as never, {})).toThrow(LogDetailError);
    expect(() => assertDetail('ruling.proposed', { rulingId: randomUUID(), round: 1, outcome: 'release-to-buyer', amountAtomic: '125' })).not.toThrow();
  });

  it('appendLog refuses a bad detail and writes nothing', async () => {
    const before = (await deps.db.query<{ n: string }>('select count(*)::text as n from activity_log')).rows[0]!.n;
    await expect(append(deps.db, { action: 'chat.read', detail: { text: 'hi' } })).rejects.toThrow(LogDetailError);
    await expect(append(deps.db, { tradeCode: 'not a code' })).rejects.toThrow(TypeError);
    await expect(append(deps.db, { actor: { kind: 'staff', id: 'mod-1', role: 'mod' } })).rejects.toThrow(TypeError);
    const after = (await deps.db.query<{ n: string }>('select count(*)::text as n from activity_log')).rows[0]!.n;
    expect(after).toBe(before);
  });
});

describe('trade events', () => {
  it('each applied trade event writes exactly one trade.<type> entry, without addresses', async () => {
    const t = await trade();
    await driveTo(deps, t.trade, 'released');
    const events = await deps.db.query<{ event: { type: string } }>('select event from trade_events where code = $1 order by id', [t.code]);
    const log = await deps.db.query<{ action: string; actor_kind: string; actor_role: string | null; detail: string }>(
      'select action, actor_kind, actor_role, detail from activity_log where trade_code = $1 order by id', [t.code],
    );
    expect(log.rows.map((r) => r.action)).toEqual(events.rows.map((r) => `trade.${r.event.type}`));
    expect(log.rows.map((r) => r.action)).toEqual([
      'trade.setup-done', 'trade.chain', 'trade.chain', 'trade.mark-paid', 'trade.release-started', 'trade.settled',
    ]);
    expect(log.rows[0]!.detail).toBe('{}');
    expect(log.rows[3]).toMatchObject({ actor_kind: 'trader', actor_role: 'buyer' });
    expect(log.rows[5]).toMatchObject({ actor_kind: 'system', actor_role: null });
    for (const r of log.rows) expect(r.detail).not.toMatch(/address|End"/i);
    expect((await verifyLogChain(deps.db)).ok).toBe(true);
  });

  it('a rolled-back applyEvent writes no entry', async () => {
    const t = await trade();
    await expect(
      applyEvent(deps, t.code, { type: 'setup-done', escrowAddress: fakeAddress() }, 'system', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const { rows } = await deps.db.query('select 1 from activity_log where trade_code = $1', [t.code]);
    expect(rows).toEqual([]);
  });
});

describe('queryLog', () => {
  it("returns only that trade's entries, newest first, with the code typed any way", async () => {
    const a = await trade();
    const b = await trade();
    await driveTo(deps, a.trade, 'secured');
    await driveTo(deps, b.trade, 'funding');
    const typed = a.code.replaceAll('-', '').toLowerCase();
    const got = await queryLog(deps.db, { tradeCode: typed, scope: 'all', limit: 50 });
    expect(got.map((e) => e.action)).toEqual(['trade.chain', 'trade.chain', 'trade.setup-done']);
    expect(got.every((e) => e.tradeCode === a.code)).toBe(true);
    const ids = got.map((e) => BigInt(e.id));
    expect([...ids].sort((x, y) => (x > y ? -1 : 1))).toEqual(ids);
    const page = await queryLog(deps.db, { tradeCode: a.code, scope: 'all', before: got[0]!.id, limit: 1 });
    expect(page.map((e) => e.id)).toEqual([got[1]!.id]);
    expect(await queryLog(deps.db, { tradeCode: 'nope', scope: 'all', limit: 5 })).toEqual([]);
  });

  it('the staff scope shows disputed trades only and never settings, staff, owner or site entries', async () => {
    const disputed = await trade();
    const other = await trade();
    await driveTo(deps, disputed.trade, 'funding');
    await driveTo(deps, other.trade, 'funding');
    await deps.db.query(
      "insert into disputes (code, seq, opened_by, reason, opened_at) values ($1, 1, 'buyer', 'paid', $2)",
      [disputed.code, now],
    );
    await append(deps.db, { actor: mod, tradeCode: disputed.code, action: 'case.opened' });
    await append(deps.db, { tradeCode: disputed.code, action: 'settings.changed', detail: { field: 'x', from: 1, to: 2 } });
    await append(deps.db, { tradeCode: disputed.code, action: 'staff.switched-off', detail: { staffId: mod.kind === 'staff' ? mod.id : '' } });
    await append(deps.db, { action: 'settings.changed', detail: { field: 'y', from: null, to: '1.5' } });
    const staff = await queryLog(deps.db, { scope: { staffId: mod.kind === 'staff' ? mod.id : '' }, limit: 200 });
    expect(staff.length).toBeGreaterThan(0);
    expect(staff.every((e) => e.tradeCode === disputed.code)).toBe(true);
    expect(staff.map((e) => e.action)).toEqual(['case.opened', 'trade.setup-done']);
    const all = await queryLog(deps.db, { tradeCode: disputed.code, scope: 'all', limit: 200 });
    expect(all.map((e) => e.action)).toContain('settings.changed');
    expect(all.map((e) => e.action)).toContain('staff.switched-off');
  });
});
