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
async function append(action = 'site.stopped'): Promise<{ id: string; hash: string }> {
  const db = schema.owner;
  const head = (await db.query<{ hash: Buffer }>('select hash from activity_log order by id desc limit 1')).rows[0]?.hash ?? null;
  const id = (await db.query<{ id: string }>("select nextval(pg_get_serial_sequence('activity_log', 'id'))::text as id")).rows[0]!.id;
  const at = new Date(Math.floor(Date.now() / 1000) * 1000);
  const fields = { id, at, actorKind: 'system' as const, actorId: null, actorRole: null, tradeCode: null, action, detail: '{}' };
  const hash = chainHash(head, fields);
  await db.query(
    `insert into activity_log (id, at, actor_kind, actor_id, actor_role, trade_code, action, detail, prev_hash, hash)
     values ($1, $2, 'system', null, null, null, $3, '{}', $4, $5)`,
    [id, at, action, head, hash],
  );
  return { id, hash: hash.toString('hex') };
}

async function setup(now: { t: Date }) {
  const dir = await mkdtemp(join(tmpdir(), 'x2f-cp-'));
  dirs.push(dir);
  const store: GateStore = await openGateStore(dir, new Uint8Array(randomBytes(32)));
  const reports: unknown[] = [];
  const logs: string[] = [];
  const c = startCheckpoints({
    store,
    reader: schema.reader,
    link: { report: async (r) => (reports.push(r), { status: 201, error: null }) },
    now: () => now.t,
    log: (e) => logs.push(e.reason),
    intervalMs: 0,
  });
  return { store, reports, logs, c };
}

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

  it('the moderation process can read the whole log through its role, and write none of it', async () => {
    await append();
    const { rows } = await schema.reader.query('select id, at, actor_kind, actor_id, actor_role, trade_code, action, detail, prev_hash, hash from activity_log order by id desc limit 1');
    expect(rows).toHaveLength(1);
    await expect(schema.reader.query("update activity_log set detail = '{}'")).rejects.toThrow();
    await expect(schema.reader.query('update site_flags set log_alarm = now()')).rejects.toThrow();
  });
});
