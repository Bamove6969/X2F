// Security review 2026-11-12, re-verify of M3: the reviewer's three ways a compromised API or
// database could keep the log alarm silent (m3-bypass-poc), each flipped to expect the alarm:
// A. the reader's view frozen at the API's own log.checkpoint row (an idle-looking log): the idle
//    skip is bounded, so a checkpoint is reported at least every CHECKPOINT_IDLE_MAX_MS and the
//    head must then move past it;
// B. every log-checkpoint report refused (any status): the alarm after CHECKPOINT_REFUSALS_MAX;
// C. the reader revoked and the process restarted before the overdue alarm: the last successful
//    verification is sealed in gate.bin, so "overdue" survives restarts.
// D (review of ruling-payout a42dad1b, N1): the reader sees an empty log from the first start (no
//    checkpoint ever taken): an empty log never counts as verified (a live site always holds
//    owner.setup-completed), so the alarm is raised.
// Its own database (row-level security is switched on and off on its activity_log).
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chainHash } from '@x2f/logchain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startCheckpoints } from '../src/checkpoint.js';
import { openGateStore } from '../src/gate/index.js';
import { newGate } from './gateWorld.js';
import { apiSchemaDb, type ApiSchema } from './apiSchema.js';

let schema: ApiSchema;
const dirs: string[] = [];
beforeAll(async () => {
  schema = await apiSchemaDb('x2f_mod_cp_bypass');
});
afterAll(async () => {
  await schema?.end();
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});
const tmp = async (p: string) => {
  const d = await mkdtemp(join(tmpdir(), p));
  dirs.push(d);
  return d;
};
/** A gate made by init-gate in a fresh directory, then opened (re-verify P6: a missing gate.bin never opens). */
const freshStore = async (p: string, key = new Uint8Array(randomBytes(32))) => {
  const d = await tmp(p);
  await newGate(d, key);
  return openGateStore(d, key);
};

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

const H = 60 * 60_000;

describe('the log alarm cannot be kept silent (security review 2026-11-12, M3 re-verify)', () => {
  it('A: the reader view frozen at the API own log.checkpoint row (RLS) while later rows are written: the alarm is raised', async () => {
    const store = await freshStore('cp-a-');
    const reports: Array<{ kind: string }> = [];
    const alarms: string[] = [];
    const now = { t: new Date('2026-11-20T00:00:00Z') };
    let frozen: string | null = null;
    const c = startCheckpoints({
      store,
      reader: schema.reader,
      link: {
        report: async (r) => {
          const x = r as { kind: string; id?: string; hash?: string };
          reports.push(x);
          if (x.kind === 'log-checkpoint') {
            const row = await append('log.checkpoint', JSON.stringify({ id: x.id, hash: x.hash }));
            if (frozen === null) {
              frozen = row.id;
              // The attacker's database freezes what the moderation role sees, at the API's own row.
              await schema.owner.query('alter table activity_log enable row level security');
              await schema.owner.query(`create policy poc_freeze on activity_log as restrictive for select to x2f_mod_reader using (id <= ${row.id})`);
              await schema.owner.query('create policy poc_all on activity_log for all to public using (true) with check (true)');
            }
          }
          return { status: 201, error: null };
        },
      },
      now: () => now.t,
      log: () => {},
      alarm: (l) => alarms.push(l),
      intervalMs: 0,
    });
    await append();
    await c.pass();
    // Real activity continues (and could be rewritten at will): the moderation role never sees it.
    for (let i = 0; i < 6 * 24 * 3; i++) {
      if (i % 6 === 0) await append('site.resumed');
      now.t = new Date(now.t.getTime() + 10 * 60_000);
      await c.pass();
    }
    const real = (await schema.owner.query<{ n: string }>('select count(*)::text as n from activity_log')).rows[0]!.n;
    expect(Number(real)).toBeGreaterThan(10);
    // The idle skip is bounded: a checkpoint is reported again, and the head never moves past it.
    expect(alarms.length).toBeGreaterThan(0);
    expect(alarms.join('\n')).toMatch(/did not move/);
    expect(reports.filter((r) => r.kind === 'log-alarm').length).toBeGreaterThan(0);
    await c.stop();
    await schema.owner.query('drop policy poc_freeze on activity_log');
    await schema.owner.query('drop policy poc_all on activity_log');
    await schema.owner.query('alter table activity_log disable row level security');
  });

  it('B: the API answers log-checkpoint with 503 (not 201, not 409) while the view is frozen: the alarm after a few refusals', async () => {
    const store = await freshStore('cp-b-');
    const alarms: string[] = [];
    const now = { t: new Date('2026-11-21T00:00:00Z') };
    const c = startCheckpoints({
      store,
      reader: schema.reader,
      link: { report: async () => ({ status: 503, error: null }) },
      now: () => now.t,
      log: () => {},
      alarm: (l) => alarms.push(l),
      intervalMs: 0,
    });
    await append();
    const start = now.t.getTime();
    let firstAt: number | null = null;
    for (let i = 0; i < 6 * 24 * 3; i++) {
      await c.pass();
      if (firstAt === null && alarms.length > 0) firstAt = now.t.getTime();
      now.t = new Date(now.t.getTime() + 10 * 60_000);
    }
    expect(alarms.length).toBeGreaterThan(0);
    expect(alarms.join('\n')).toMatch(/refused/);
    // Within a few passes, not a day.
    expect(firstAt! - start).toBeLessThanOrEqual(30 * 60_000);
    await c.stop();
    // Every status counts, a 409 with another code too.
    for (const answer of [{ status: 500, error: null }, { status: 400, error: 'bad-body' }, { status: 409, error: 'wrong-state' }, { status: 0, error: null }]) {
      const s2 = await freshStore('cp-b2-');
      const got: string[] = [];
      const c2 = startCheckpoints({ store: s2, reader: schema.reader, link: { report: async () => answer }, now: () => now.t, log: () => {}, alarm: (l) => got.push(l), intervalMs: 0 });
      for (let i = 0; i < 4; i++) {
        await c2.pass();
        now.t = new Date(now.t.getTime() + 10 * 60_000);
      }
      expect(got.length, JSON.stringify(answer)).toBeGreaterThan(0);
      await c2.stop();
    }
  });

  it('C: reader revoked, and the process restarted every 20 h (e.g. the database ends its lock session): the overdue alarm still fires, once', async () => {
    const dir = await tmp('cp-c-');
    const key = new Uint8Array(randomBytes(32));
    await newGate(dir, key);
    const broken = { query: async () => Promise.reject(new Error('permission denied for table activity_log')) };
    const alarms: string[] = [];
    const now = { t: new Date('2026-11-22T00:00:00Z') };
    for (let restart = 0; restart < 5; restart++) {
      // A restarted process opens gate.bin from disk.
      const store = await openGateStore(dir, key);
      const c = startCheckpoints({ store, reader: broken, link: { report: async () => ({ status: 201, error: null }) }, now: () => now.t, log: () => {}, alarm: (l) => alarms.push(l), intervalMs: 0 });
      for (let i = 0; i < 6 * 20; i++) {
        await c.pass().catch(() => undefined);
        now.t = new Date(now.t.getTime() + 10 * 60_000);
      }
      await c.stop();
    }
    // 100 hours without a verification: overdue after 25 h, raised once across the restarts.
    expect(alarms.filter((l) => /overdue/.test(l))).toHaveLength(1);
  });

  it('D (N1): the reader sees an empty log from the first start (RLS using false): an empty log is never verified, the alarm is raised', async () => {
    await schema.owner.query('alter table activity_log enable row level security');
    await schema.owner.query('create policy pocd_all on activity_log for all to public using (true) with check (true)');
    await schema.owner.query('create policy pocd_hide on activity_log as restrictive for select to x2f_mod_reader using (false)');
    try {
      const store = await freshStore('cp-d-');
      const alarms: string[] = [];
      const now = { t: new Date('2026-12-01T00:00:00Z') };
      for (let restart = 0; restart < 3; restart++) {
        const c = startCheckpoints({ store, reader: schema.reader, link: { report: async () => ({ status: 201, error: null }) }, now: () => now.t, log: () => {}, alarm: (l) => alarms.push(l), intervalMs: 0 });
        for (let i = 0; i < 6 * 24; i++) {
          if (i % 6 === 0) await append('site.resumed');
          await c.pass().catch(() => undefined);
          now.t = new Date(now.t.getTime() + 10 * 60_000);
        }
        await c.stop();
      }
      expect(Number((await schema.owner.query<{ n: string }>('select count(*)::text as n from activity_log')).rows[0]!.n)).toBeGreaterThan(50);
      expect(store.state.checkpoints).toHaveLength(0);
      expect(alarms.some((l) => /empty/.test(l))).toBe(true);
      // Never verified: the overdue clock still runs from the first start.
      expect(store.state.logVerifiedAt).toBe('2026-12-01T00:00:00.000Z');
    } finally {
      await schema.owner.query('drop policy pocd_hide on activity_log');
      await schema.owner.query('drop policy pocd_all on activity_log');
      await schema.owner.query('alter table activity_log disable row level security');
    }
  });
});
