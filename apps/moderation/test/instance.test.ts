// Security review 7 Nov 2026, finding 2: one moderation process at a time. The instance lock is a
// Postgres advisory lock held for the life of the process; a desk record or watch state written by
// another (newer) process is never overwritten by a stale one; the test-only watch() never runs a
// pass alongside another.
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GATE_FILE, openGateStore } from '../src/gate/index.js';
import type { ModerationDeps } from '../src/main.js';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { instanceLockHeld, MOD_INSTANCE_LOCK } from '../src/main.js';
import { fromJson } from '../src/shadow.js';
import type { DeskRecord } from '../src/desk.js';
import { fakeNetwork, inFunding, makeCtx, moderation, secured, type Ctx, stopAll } from './harness.js';
import { newGate } from './gateWorld.js';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await makeCtx();
});
afterEach(stopAll);
afterAll(async () => {
  await ctx.db.end();
});

const desk = async (code: string): Promise<{ record: DeskRecord; version: number }> => {
  const { rows } = await ctx.db.query<{ record: unknown; version: string }>('select record, version from mod_trade_desk where trade = $1', [code]);
  return { record: fromJson(rows[0]!.record) as DeskRecord, version: Number(rows[0]!.version) };
};
const watchVersion = async (code: string): Promise<number> =>
  Number((await ctx.db.query<{ version: string }>('select version from mod_watch where trade = $1', [code])).rows[0]!.version);

describe('one moderation process (security review 7 Nov, finding 2)', () => {
  it('a second process on the same database refuses to start, with a clear reason; it starts once the first stopped', async () => {
    const { fetch } = fakeNetwork(ctx);
    const first = await moderation(ctx, fetch);
    const logs: string[] = [];
    await expect(moderation(ctx, fetch, { logs })).rejects.toThrow(/another moderation process/);
    expect(logs).toEqual(['moderation-instance-locked']);
    await first.handle.stop();
    const next = await moderation(ctx, fetch);
    await next.handle.stop();
  });

  it('review M1: the gate (its store, its sync, the executor) starts only once this process holds the instance lock; a refused second process never writes gate.bin', async () => {
    const { fetch } = fakeNetwork(ctx);
    const dir = await mkdtemp(join(tmpdir(), 'x2f-gate-m1-'));
    try {
      const key = new Uint8Array(randomBytes(32));
      await newGate(dir, key);
      const seeded = await openGateStore(dir, key);
      await seeded.save();
      const file = join(dir, GATE_FILE);
      const before = await readFile(file);
      let started = 0;
      let stopped = 0;
      // As the process entry's gate: opening the store and its first sync pass save gate.bin.
      const gate: NonNullable<ModerationDeps['gate']> = async () => {
        started++;
        const store = await openGateStore(dir, key);
        await store.save();
        return { stop: async () => void stopped++ };
      };
      const first = await moderation(ctx, fetch, { gate });
      expect(started).toBe(1);
      const afterFirst = await readFile(file);
      const logs: string[] = [];
      await expect(moderation(ctx, fetch, { logs, gate })).rejects.toThrow(/another moderation process/);
      expect(started).toBe(1);
      expect(Buffer.compare(await readFile(file), afterFirst)).toBe(0);
      expect(before.length).toBeGreaterThan(0);
      await first.handle.stop();
      expect(stopped).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('review M1: the process entry hands the gate to startModeration as a factory, never opening or syncing it first; the gate reader has a statement_timeout (review M3)', () => {
    const main = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');
    const entry = main.slice(main.indexOf('// `tsx apps/moderation/src/main.ts`'));
    const start = entry.indexOf('startModeration(');
    expect(start).toBeGreaterThan(-1);
    expect(entry).toMatch(/gate: async/);
    // Nothing of the gate runs before the start: its store, sync, executor and reader are all made in the factory.
    const top = entry.slice(0, start);
    for (const call of ['openGateStore(', 'startGateSync(', 'rulingExecutor(', 'gateConfig.apiReaderUrl']) expect(top, call).not.toContain(call);
    expect(entry).toMatch(/connectionString: gateConfig\.apiReaderUrl[^}]*statement_timeout: \d+/);
    // Re-verify, M1 residual: the entry's gate store holds MOD_STATE_DIR's lock file for its life, and its stop closes it.
    expect(entry).toMatch(/openGateStore\(gateConfig\.stateDir, envBytes\([^)]*\), \{ lock: true \}\)/);
    expect(entry).toMatch(/stop: async \(\) => \{[^}]*sync\.stop\(\)[^}]*store\.close\(\)/);
  });

  it('the process entry exits non-zero when the start is refused', () => {
    const main = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');
    const entry = main.slice(main.indexOf('// `tsx apps/moderation/src/main.ts`'));
    expect(entry).toMatch(/catch \(e\)[\s\S]*process\.exit\(1\)/);
  });

  it('a desk record a newer process wrote is not overwritten: the stale desk logs it and reloads', async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    await secured(ctx, l);
    // Another process opened the buyer's trade.paid and saved it.
    await ctx.db.query(`update mod_trade_desk set record = jsonb_set(record, '{paidSeen}', 'true'), version = version + 1 where trade = $1`, [l.code]);
    const before = await desk(l.code);
    await m.handle.watch();
    expect(m.logs).toContain('desk-record-stale');
    const after = await desk(l.code);
    expect(after.record.paidSeen).toBe(true);
    expect(after.version).toBe(before.version);
    // Reloaded: the next pass saves on top of the newer record.
    await m.handle.watch();
    const again = await desk(l.code);
    expect(again.record.paidSeen).toBe(true);
    expect(again.version).toBeGreaterThan(before.version);
    expect(m.logs.filter((x) => x === 'desk-record-stale')).toHaveLength(1);
    await m.handle.stop();
  });

  it('a watch state a newer process wrote is not overwritten: the pass logs it and drops its own', async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    await m.handle.watch();
    // Another process saves the trade's watch state while this pass runs (after it read the row).
    l.party.onFunds = async () => {
      l.party.onFunds = null;
      await ctx.db.query('update mod_watch set version = version + 1 where trade = $1', [l.code]);
    };
    const v = (await watchVersion(l.code)) + 1;
    await m.handle.watch();
    expect(m.logs).toContain('watch-state-stale');
    expect(await watchVersion(l.code)).toBe(v);
    await m.handle.watch();
    expect(await watchVersion(l.code)).toBe(v + 1);
    await m.handle.stop();
  });

  it('watch() never runs a pass alongside another', async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    const plain = l.party.handle.funds;
    let active = 0;
    let most = 0;
    l.party.handle.funds = async () => {
      active++;
      most = Math.max(most, active);
      await new Promise((r) => setTimeout(r, 20));
      try {
        return await plain();
      } finally {
        active--;
      }
    };
    await Promise.all([m.handle.watch(), m.handle.watch(), m.handle.watch()]);
    expect(most).toBe(1);
    await m.handle.stop();
  });

  // Re-verify R3 (8 Nov): a lost instance lock ends the process, a half-open lock connection is
  // caught by the per-pass check, and starts and stops leave no listener behind.
  it('the lock connection is killed: the service logs it, stops, and its lockLost resolves (the entry then exits 1)', async () => {
    const { fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    await ctx.db.query(`select pg_terminate_backend(pid) from pg_locks where locktype = 'advisory' and classid = 0 and objid = $1 and objsubid = 1 and database = (select oid from pg_database where datname = current_database())`, [MOD_INSTANCE_LOCK]); // pg_locks is cluster-wide: only this file's database
    await expect(Promise.race([m.handle.lockLost.then(() => 'lost'), new Promise((r) => setTimeout(() => r('still running'), 5_000))])).resolves.toBe('lost');
    expect(m.logs).toContain('moderation-instance-lock-lost');
    // The lock is free again: a new process starts.
    const next = await moderation(ctx, fetch);
    await next.handle.stop();
  });

  it('instanceLockHeld: true on the holding connection; false on one without the lock and on a half-open one that never answers', async () => {
    const holder = await ctx.db.connect();
    const other = await ctx.db.connect();
    try {
      expect((await holder.query<{ ok: boolean }>('select pg_try_advisory_lock($1) as ok', [MOD_INSTANCE_LOCK])).rows[0]!.ok).toBe(true);
      expect(await instanceLockHeld(holder, 1_000)).toBe(true);
      expect(await instanceLockHeld(other, 1_000)).toBe(false);
      await holder.query('select pg_advisory_unlock($1)', [MOD_INSTANCE_LOCK]);
      expect(await instanceLockHeld(holder, 1_000)).toBe(false);
    } finally {
      holder.release();
      other.release();
    }
    const halfOpen = { query: () => new Promise<never>(() => {}) };
    expect(await instanceLockHeld(halfOpen, 50)).toBe(false);
  });

  it('the watch loop checks the lock every pass: a lock no longer held stops the service', async () => {
    const { fetch } = fakeNetwork(ctx);
    let held = true;
    const logs: string[] = [];
    const m = await moderation(ctx, fetch, { logs, watchIntervalMs: 5, lockHeld: async () => held });
    held = false;
    await expect(Promise.race([m.handle.lockLost.then(() => 'lost'), new Promise((r) => setTimeout(() => r('still running'), 5_000))])).resolves.toBe('lost');
    expect(logs).toContain('moderation-instance-lock-lost');
  });

  it('twelve starts and stops leave no error listener on the pooled lock connection (no MaxListenersExceededWarning)', async () => {
    const { fetch } = fakeNetwork(ctx);
    const warnings: string[] = [];
    const onWarning = (w: Error) => void warnings.push(w.name);
    process.on('warning', onWarning);
    try {
      for (let i = 0; i < 12; i++) await (await moderation(ctx, fetch)).handle.stop();
      await new Promise((r) => setTimeout(r, 50));
      expect(warnings.filter((w) => w === 'MaxListenersExceededWarning')).toEqual([]);
    } finally {
      process.off('warning', onWarning);
    }
  });

  it('the entry exits 1 once the lock is lost and keeps the database connections alive (TCP keepalive)', () => {
    const main = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');
    const entry = main.slice(main.indexOf('// `tsx apps/moderation/src/main.ts`'));
    expect(entry).toMatch(/lockLost\.then\([\s\S]*process\.exit\(1\)/);
    expect(entry).toMatch(/keepAlive: true/);
  });
});
