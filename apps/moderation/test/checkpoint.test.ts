// Plan 4 Task 14: log checkpoints. The moderation process records the activity log's head (its id
// and hash) in its own sealed gate store every 10 minutes and reports it (the API logs
// `log.checkpoint`); once a day it verifies the chain from the oldest checkpoint and that every
// stored checkpoint's row still has its hash. A mismatch (a row edited or removed with the triggers
// off, by whoever holds the API's database) is reported as the log alarm and written to stderr.
// Real API schema; the moderation side reads only through the read-only role (x2f_mod_reader).
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chainHash } from '@x2f/logchain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startCheckpoints } from '../src/checkpoint.js';
import { openGateStore, type GateStore } from '../src/gate/index.js';
import { apiSchemaDb, type ApiSchema } from './apiSchema.js';

let schema: ApiSchema;
const dirs: string[] = [];
beforeAll(async () => {
  schema = await apiSchemaDb('x2f_mod_cp');
});
afterAll(async () => {
  await schema?.end();
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

/** Appends one entry as the API's appendLog does (the chain trigger checks the hash). */
async function append(action = 'site.stopped', detail = '{}'): Promise<{ id: string; hash: string }> {
  const db = schema.owner;
  const head = (await db.query<{ hash: Buffer }>('select hash from activity_log order by id desc limit 1')).rows[0]?.hash ?? null;
  const id = (await db.query<{ id: string }>("select nextval(pg_get_serial_sequence('activity_log', 'id'))::text as id")).rows[0]!.id;
  const at = new Date(Math.floor(Date.now() / 1000) * 1000);
  const fields = { id, at, actorKind: 'system' as const, actorId: null, actorRole: null, tradeCode: null, action, detail };
  const hash = chainHash(head, fields);
  await db.query(
    `insert into activity_log (id, at, actor_kind, actor_id, actor_role, trade_code, action, detail, prev_hash, hash)
     values ($1, $2, 'system', null, null, null, $3, $6, $4, $5)`,
    [id, at, action, head, hash, detail],
  );
  return { id, hash: hash.toString('hex') };
}

/** Edits a row with the triggers off, as whoever holds the API's database could; returns the undo. */
async function forge(id: string): Promise<() => Promise<void>> {
  const set = async (detail: string) => {
    const c = await schema.owner.connect();
    try {
      await c.query('begin');
      await c.query("set local session_replication_role = 'replica'");
      await c.query('update activity_log set detail = $2 where id = $1', [id, detail]);
      await c.query('commit');
    } finally {
      c.release();
    }
  };
  const was = (await schema.owner.query<{ detail: string }>('select detail from activity_log where id = $1', [id])).rows[0]!.detail;
  await set('{"forged":true}');
  return () => set(was);
}

/**
 * The API's answer to `log-checkpoint` (as apps/api internal/routes.ts does): 201 and its own
 * `log.checkpoint {id, hash}` appended. `answer` replaces it for a test.
 */
type Answer = (r: { kind: string; id?: string; hash?: string }) => Promise<{ status: number; error: string | null }>;
const apiAnswer: Answer = async (r) => {
  if (r.kind === 'log-checkpoint') await append('log.checkpoint', JSON.stringify({ id: r.id, hash: r.hash }));
  return { status: 201, error: null };
};

async function setup(now: { t: Date }, o: { answer?: Answer; reader?: ApiSchema['reader']; verifyEveryMs?: number } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'x2f-cp-'));
  dirs.push(dir);
  const store: GateStore = await openGateStore(dir, new Uint8Array(randomBytes(32)));
  const reports: unknown[] = [];
  const logs: string[] = [];
  const alarms: string[] = [];
  const answer = o.answer ?? apiAnswer;
  const c = startCheckpoints({
    store,
    reader: o.reader ?? schema.reader,
    link: { report: async (r) => (reports.push(r), answer(r as { kind: string })) },
    now: () => now.t,
    log: (e) => logs.push(e.reason),
    alarm: (line) => alarms.push(line),
    intervalMs: 0,
    ...(o.verifyEveryMs !== undefined ? { verifyEveryMs: o.verifyEveryMs } : {}),
  });
  return { store, reports, logs, alarms, c };
}
const alarmed = (s: { reports: unknown[] }) => s.reports.filter((r) => (r as { kind: string }).kind === 'log-alarm').length;

describe('log checkpoints (Plan 4 Task 14)', () => {
  it('records the head in the sealed gate store and reports it, once per new head', async () => {
    await append();
    const now = { t: new Date('2026-11-12T12:00:00Z') };
    const s = await setup(now);
    const h1 = await append();
    await s.c.pass();
    expect(s.store.state.checkpoints.map((x) => ({ id: x.id, hash: x.hash }))).toEqual([h1]);
    expect(s.reports).toEqual([{ kind: 'log-checkpoint', id: h1.id, hash: h1.hash }]);
    await s.c.pass();
    expect(s.store.state.checkpoints).toHaveLength(1);
    const h2 = await append();
    now.t = new Date(now.t.getTime() + 10 * 60_000);
    await s.c.pass();
    expect(s.store.state.checkpoints.map((x) => x.id)).toEqual([h1.id, h2.id]);
    expect(s.reports).toHaveLength(2);
    await s.c.stop();
  });

  it('a daily verification passes on an intact log and raises the alarm once a checkpointed row is edited', async () => {
    const now = { t: new Date('2026-11-13T12:00:00Z') };
    const s = await setup(now);
    await append();
    const h = await append();
    await s.c.pass();
    await append();
    expect(await s.c.verify()).toBe(true);
    expect(s.reports.filter((r) => (r as { kind: string }).kind === 'log-alarm')).toEqual([]);
    // Whoever holds the API's database edits the checkpointed row with the triggers off.
    const c = await schema.owner.connect();
    try {
      await c.query('begin');
      await c.query("set local session_replication_role = 'replica'");
      await c.query(`update activity_log set detail = '{"forged":true}' where id = $1`, [h.id]);
      await c.query('commit');
    } finally {
      c.release();
    }
    expect(await s.c.verify()).toBe(false);
    expect(s.reports).toContainEqual({ kind: 'log-alarm' });
    expect(s.logs).toContain('log-alarm');
    await s.c.stop();
    // Put the row back: the later tests verify the whole log from its first row (review M2).
    const back = await schema.owner.connect();
    try {
      await back.query('begin');
      await back.query("set local session_replication_role = 'replica'");
      await back.query(`update activity_log set detail = '{}' where id = $1`, [h.id]);
      await back.query('commit');
    } finally {
      back.release();
    }
  });

  it('verifies on its own once a day has passed since the last verification', async () => {
    const now = { t: new Date('2026-11-14T12:00:00Z') };
    const s = await setup(now);
    await append();
    await s.c.pass();
    const verified = () => s.logs.filter((x) => x === 'log-verified').length;
    const first = verified();
    now.t = new Date(now.t.getTime() + 60 * 60_000);
    await s.c.pass();
    expect(verified()).toBe(first);
    now.t = new Date(now.t.getTime() + 24 * 60 * 60_000);
    await s.c.pass();
    expect(verified()).toBe(first + 1);
    await s.c.stop();
  });

  it('review M2: the daily verify reads the log from its first row, so a row before the oldest checkpoint is covered too', async () => {
    const now = { t: new Date('2026-11-15T12:00:00Z') };
    const early = await append();
    await append();
    const s = await setup(now);
    await s.c.pass();
    // The checkpoint is a later row: `early` lies before the oldest checkpoint.
    expect(s.store.state.checkpoints[0]!.id).not.toBe(early.id);
    expect(s.store.state.checkpoints.length).toBe(1);
    expect(await s.c.verify()).toBe(true);
    const undo = await forge(early.id);
    try {
      expect(await s.c.verify()).toBe(false);
      expect(alarmed(s)).toBeGreaterThan(0);
      expect(s.alarms.length).toBeGreaterThan(0);
    } finally {
      await undo();
    }
    expect(await s.c.verify()).toBe(true);
    await s.c.stop();
  });

  it("review I2: the API's own log.checkpoint row is not a new head: an idle log is checkpointed once", async () => {
    const now = { t: new Date('2026-11-16T12:00:00Z') };
    const s = await setup(now);
    await append();
    for (let i = 0; i < 4; i++) {
      await s.c.pass();
      now.t = new Date(now.t.getTime() + 10 * 60_000);
    }
    expect(s.store.state.checkpoints).toHaveLength(1);
    expect(s.reports.filter((r) => (r as { kind: string }).kind === 'log-checkpoint')).toHaveLength(1);
    expect(alarmed(s)).toBe(0);
    // A real entry after it is a new head again.
    await append();
    await s.c.pass();
    expect(s.store.state.checkpoints).toHaveLength(2);
    await s.c.stop();
  });

  it('review M3: a 409 checkpoint-mismatch raises the alarm (the API and the reader see different logs)', async () => {
    const now = { t: new Date('2026-11-17T12:00:00Z') };
    const s = await setup(now, { answer: async (r) => (r.kind === 'log-checkpoint' ? { status: 409, error: 'checkpoint-mismatch' } : { status: 201, error: null }) });
    await append();
    await s.c.pass();
    expect(alarmed(s)).toBe(1);
    expect(s.logs).toContain('log-alarm');
    expect(s.alarms.join('\n')).toMatch(/checkpoint/);
    await s.c.stop();
  });

  it('review M3: a head that does not move after an accepted checkpoint raises the alarm (a frozen view of the log)', async () => {
    const now = { t: new Date('2026-11-18T12:00:00Z') };
    // 201, but no log.checkpoint row ever shows to the reader.
    const s = await setup(now, { answer: async () => ({ status: 201, error: null }) });
    await append();
    await s.c.pass();
    expect(alarmed(s)).toBe(0);
    now.t = new Date(now.t.getTime() + 10 * 60_000);
    await s.c.pass();
    expect(alarmed(s)).toBe(1);
    expect(s.alarms.join('\n')).toMatch(/did not (move|advance)/);
    await s.c.stop();
  });

  it('review M3: a verification overdue (the reader failing, revoked or locked) raises the alarm, once', async () => {
    const now = { t: new Date('2026-11-19T12:00:00Z') };
    const broken = { query: async () => Promise.reject(new Error('permission denied for table activity_log')) } as unknown as ApiSchema['reader'];
    const s = await setup(now, { reader: broken, verifyEveryMs: 60 * 60_000 });
    await s.c.pass().catch(() => undefined);
    expect(alarmed(s)).toBe(0);
    now.t = new Date(now.t.getTime() + 30 * 60_000);
    await s.c.pass().catch(() => undefined);
    expect(alarmed(s)).toBe(0);
    // Past a verification period and its margin with no successful verification.
    now.t = new Date(now.t.getTime() + 3 * 60 * 60_000);
    await s.c.pass().catch(() => undefined);
    expect(alarmed(s)).toBe(1);
    expect(s.alarms.join('\n')).toMatch(/overdue/);
    now.t = new Date(now.t.getTime() + 10 * 60_000);
    await s.c.pass().catch(() => undefined);
    expect(alarmed(s)).toBe(1);
    await s.c.stop();
  });

  it('the moderation process can read the whole log through its role, and write none of it', async () => {
    await append();
    const { rows } = await schema.reader.query('select id, at, actor_kind, actor_id, actor_role, trade_code, action, detail, prev_hash, hash from activity_log order by id desc limit 1');
    expect(rows).toHaveLength(1);
    await expect(schema.reader.query("update activity_log set detail = '{}'")).rejects.toThrow();
    await expect(schema.reader.query('update site_flags set log_alarm = now()')).rejects.toThrow();
  });
});
