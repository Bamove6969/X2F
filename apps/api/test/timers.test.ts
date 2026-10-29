// Plan 3 Task 9: the API timer loop (`startTimers`) applying `timerEvents` through the trade store.
import { TIMERS, type Trade } from '@x2f/trade';
const addMin = (d: Date, min: number): Date => new Date(d.getTime() + min * 60_000);
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { loadTrade } from '../src/trades/store.js';
import { startTimers } from '../src/trades/timers.js';
import { applyEvent } from '../src/trades/store.js';
import { seedAccount } from './helpers/accounts.js';
import { testApp } from './helpers/app.js';
import { driveTo, seedTrade } from './helpers/trades.js';

let app: FastifyInstance;
let deps: Deps;
let n = 0;
let now = new Date('2026-10-28T12:00:00Z');
const clock = () => now;

async function trade(): Promise<Trade> {
  const sellerId = await seedAccount(deps, { loginName: `tm${String(++n).padStart(4, '0')}s` });
  const buyerId = await seedAccount(deps, { loginName: `tm${String(n).padStart(4, '0')}b` });
  return (await seedTrade({ db: deps.db, clock }, { sellerId, buyerId, poster: 'seller' })).trade;
}

async function events(code: string): Promise<string[]> {
  const { rows } = await deps.db.query<{ event: { type: string } }>('select event from trade_events where code = $1 order by id', [code]);
  return rows.map((r) => r.event.type);
}

beforeAll(async () => {
  ({ app, deps } = await testApp());
});

afterAll(async () => {
  await app.close();
});

describe('startTimers', () => {
  it('ticks a trade whose deadline passed (setupBy cancels a stuck setup), and leaves one not yet due alone', async () => {
    const stuck = await trade();
    const fresh = await trade();
    await deps.db.query('update trades set setup_by = $2 where code = $1', [fresh.code, addMin(now, 60 * 24)]);
    const timers = startTimers({ db: deps.db, clock, intervalMs: 0 });
    now = new Date(stuck.setupBy!.getTime() + 1);
    const pass = await timers.tick();
    expect(pass.applied).toContainEqual({ code: stuck.code, type: 'tick' });
    expect((await loadTrade(deps.db, stuck.code))!.state).toBe('cancelled');
    expect((await loadTrade(deps.db, fresh.code))!.state).toBe('setup');
    // Nothing more is due: a second pass writes nothing for it.
    const before = await events(stuck.code);
    await timers.tick();
    expect(await events(stuck.code)).toEqual(before);
    await timers.stop();
  });

  it('the signing window returns an unclaimed release to settleFrom, but never a claimed one (Task 9 I/O, lead decision b)', async () => {
    const plain = await trade();
    const claimed = await trade();
    for (const t of [plain, claimed]) await driveTo({ db: deps.db, clock }, t, 'settling');
    await applyEvent({ db: deps.db, clock }, claimed.code, { type: 'release-claimed' }, 'system');
    const settleBy = (await loadTrade(deps.db, plain.code))!.settleBy!;
    const timers = startTimers({ db: deps.db, clock, intervalMs: 0 });
    now = new Date(settleBy.getTime() + 1);
    const pass = await timers.tick();
    expect(pass.applied).toContainEqual({ code: plain.code, type: 'tick' });
    expect(pass.applied.filter((a) => a.code === claimed.code)).toEqual([]);
    expect((await loadTrade(deps.db, plain.code))!.state).toBe('paid');
    now = addMin(now, 7 * 60);
    await timers.tick();
    expect(await loadTrade(deps.db, claimed.code)).toMatchObject({ state: 'settling', settling: 'release' });
    expect(await events(claimed.code)).not.toContain('tick');
    await timers.stop();
  });

  it('maintenance on for 20 min moves payBy by 20 min, and no tick fires meanwhile', async () => {
    const t0 = new Date('2026-11-02T10:00:00Z');
    now = t0;
    const t = await driveTo({ db: deps.db, clock }, await trade(), 'secured');
    const payBy = t.payBy!;
    let maintenance: Date | null = null;
    const timers = startTimers({ db: deps.db, clock, intervalMs: 0, maintenanceSince: async () => maintenance });
    maintenance = new Date(t0.getTime() + 60_000);
    now = new Date(t0.getTime() + 2 * 60_000);
    await timers.tick();
    const paused = (await loadTrade(deps.db, t.code))!;
    // The pause is at maintenance_since, not at the loop's clock.
    expect(paused.pausedAt).toEqual(maintenance);
    // Past payBy (and every other deadline) while paused: nothing ticks.
    now = new Date(payBy.getTime() + TIMERS.payMin * 2 * 60_000);
    const during = await events(t.code);
    await timers.tick();
    expect(await events(t.code)).toEqual(during);
    // Maintenance ends 20 min after it began: payBy moves by the pause's length.
    maintenance = null;
    now = new Date(t0.getTime() + 60_000 + 20 * 60_000);
    await timers.tick();
    const resumed = (await loadTrade(deps.db, t.code))!;
    expect(resumed.pausedAt).toBeNull();
    expect(resumed.payBy!.getTime() - payBy.getTime()).toBe(20 * 60_000);
    await timers.stop();
  });

  it('a failing pass is logged and the loop keeps running; stop() ends it', async () => {
    const reasons: string[] = [];
    let calls = 0;
    const timers = startTimers({
      db: deps.db,
      clock,
      intervalMs: 5,
      maintenanceSince: async () => {
        calls++;
        throw new Error('flag store down');
      },
      log: (e) => reasons.push(e.reason),
    });
    await expect.poll(() => calls, { timeout: 5_000 }).toBeGreaterThanOrEqual(2);
    await timers.stop();
    const after = calls;
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toBe(after);
    expect(reasons).toContain('timers-pass-failed');
  });
});
