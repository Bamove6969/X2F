// Security review 7 Nov 2026, finding 2: one moderation process at a time. The instance lock is a
// Postgres advisory lock held for the life of the process; a desk record or watch state written by
// another (newer) process is never overwritten by a stale one; the test-only watch() never runs a
// pass alongside another.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fromJson } from '../src/shadow.js';
import type { DeskRecord } from '../src/desk.js';
import { fakeNetwork, inFunding, makeCtx, moderation, secured, type Ctx, stopAll } from './harness.js';

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
});
