// Spec 6.6 "Settings" / 2.3 (owner 2026-10-24): the owner changes the starter limits on the staff
// API (perm settings.write). Every number is sent with a `starter-limits` tap bound to all of them;
// each changed number writes one `settings.changed` entry with from and to; the trade and offer
// routes read the new numbers (loadStarterSettings).
import { STARTER_DEFAULTS, type KeyTapIntent, type StarterSettings } from '@x2f/staff';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../../src/app.js';
import { loadStarterSettings } from '../../src/traders/stage.js';
import { StaffBrowser, errorOf, insertSession, logEntries, seedStaff, seedTap, staffApps } from '../helpers/staffApp.js';

const T0 = new Date('2026-11-02T12:00:00Z');

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let close: () => Promise<void>;
let owner: StaffBrowser;
let ownerId: string;

const DEFAULTS: StarterSettings = { ...STARTER_DEFAULTS };
const KEYS = ['starter_cap_usd', 'building_cap_usd', 'building_min_trades', 'building_min_days', 'graduated_min_trades', 'graduated_min_days', 'starter_max_open_trades'];

beforeAll(async () => {
  ({ app, deps, setNow, close } = await staffApps());
  setNow(T0);
  ownerId = (await seedStaff(deps, { role: 'owner' })).id;
  owner = new StaffBrowser(app).withSession((await insertSession(deps, ownerId, 'staff')).token);
});
afterAll(async () => close());
beforeEach(async () => {
  setNow(T0);
  await deps.db.query('delete from owner_settings where key = any($1)', [KEYS]);
});

const tapOf = (s: StarterSettings): KeyTapIntent => ({ kind: 'starter-limits', ...s });
const put = (body: unknown) => owner.send('PUT', '/staff/v1/starter-limits', body);
const changes = async () => (await logEntries(deps, 'settings.changed')).map((r) => JSON.parse(r.detail) as Record<string, unknown>);

describe('GET /staff/v1/starter-limits', () => {
  it('answers the spec 2.3 defaults with no saved change yet', async () => {
    const res = await owner.get('/staff/v1/starter-limits');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ...DEFAULTS, updatedAt: null });
  });
});

describe('PUT /staff/v1/starter-limits', () => {
  it('saves with a tap bound to every number, logs each change from and to, and the trade rules read it', async () => {
    const next = { ...DEFAULTS, starterCapUsd: 150, graduatedMinDays: 45 };
    const before = (await changes()).length;
    const tapId = await seedTap(deps, ownerId, tapOf(next));
    const res = await put({ ...next, tapId });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ ...next, updatedAt: T0.toISOString() });
    expect(await loadStarterSettings(deps.db)).toEqual(next);
    expect((await changes()).slice(before)).toEqual([
      { field: 'starterCapUsd', from: 200, to: 150 },
      { field: 'graduatedMinDays', from: 30, to: 45 },
    ]);
    expect((await logEntries(deps, 'settings.changed')).at(-1)!.actor_kind).toBe('staff');
    // The tap is used: another change with it is refused.
    expect(errorOf(await put({ ...next, starterCapUsd: 100, tapId }))).toBe('tap-invalid');
  });

  it('refuses a change without a valid tap (none, for other numbers, another kind, another person): nothing changes or is logged', async () => {
    const next = { ...DEFAULTS, buildingCapUsd: 5000 };
    const other = await seedStaff(deps, { role: 'senior' });
    const taps = [
      '00000000-0000-4000-8000-000000000000',
      await seedTap(deps, ownerId, tapOf({ ...next, buildingCapUsd: 5001 })),
      await seedTap(deps, ownerId, { kind: 'emergency-stop' }),
      await seedTap(deps, other.id, tapOf(next)),
    ];
    const before = await changes();
    for (const tapId of taps) {
      const res = await put({ ...next, tapId });
      expect([res.statusCode, errorOf(res)], tapId).toEqual([403, 'tap-invalid']);
    }
    expect(await loadStarterSettings(deps.db)).toEqual(DEFAULTS);
    expect(await changes()).toEqual(before);
  });

  it('the same numbers again need no tap and log nothing', async () => {
    const before = await changes();
    const res = await put({ ...DEFAULTS, tapId: 'not-a-tap' });
    expect(res.statusCode, res.body).toBe(200);
    expect(await changes()).toEqual(before);
  });

  it('validates every number: whole, in bounds, every field present and nothing else, the stages in order', async () => {
    const tapId = await seedTap(deps, ownerId, tapOf(DEFAULTS));
    const bad: Array<[Record<string, unknown>, string | undefined]> = [
      [{ ...DEFAULTS, starterCapUsd: 0 }, 'starterCapUsd'],
      [{ ...DEFAULTS, starterCapUsd: 12.5 }, 'starterCapUsd'],
      [{ ...DEFAULTS, starterCapUsd: '200' }, 'starterCapUsd'],
      [{ ...DEFAULTS, starterMaxOpenTrades: 0 }, 'starterMaxOpenTrades'],
      [{ ...DEFAULTS, buildingMinDays: 3651 }, 'buildingMinDays'],
      [{ ...DEFAULTS, buildingMinTrades: -1 }, 'buildingMinTrades'],
      // Building's cap below Starter's; Graduated before Building.
      [{ ...DEFAULTS, buildingCapUsd: 100 }, 'buildingCapUsd'],
      [{ ...DEFAULTS, graduatedMinTrades: 4 }, 'graduatedMinTrades'],
      [{ ...DEFAULTS, graduatedMinDays: 6 }, 'graduatedMinDays'],
      [{ ...DEFAULTS, starterCapUsd: undefined }, undefined],
      [{ ...DEFAULTS, extra: 1 }, undefined],
    ];
    for (const [body, field] of bad) {
      const res = await put({ ...body, tapId });
      expect([res.statusCode, errorOf(res), (res.json() as { field?: string }).field], JSON.stringify(body)).toEqual([400, 'bad-request', field]);
    }
    expect(errorOf(await put([]))).toBe('bad-request');
    expect(await loadStarterSettings(deps.db)).toEqual(DEFAULTS);
  });

  it('is the owner\'s only: a senior moderator and a moderator are forbidden', async () => {
    for (const role of ['senior', 'mod'] as const) {
      const s = await seedStaff(deps, { role });
      const b = new StaffBrowser(app).withSession((await insertSession(deps, s.id, 'staff')).token);
      expect(errorOf(await b.get('/staff/v1/starter-limits')), role).toBe('forbidden');
      const tapId = await seedTap(deps, s.id, tapOf({ ...DEFAULTS, starterCapUsd: 5000, buildingCapUsd: 5000 }));
      const res = await b.send('PUT', '/staff/v1/starter-limits', { ...DEFAULTS, starterCapUsd: 5000, buildingCapUsd: 5000, tapId });
      expect([res.statusCode, errorOf(res)], role).toEqual([403, 'forbidden']);
    }
    expect(await loadStarterSettings(deps.db)).toEqual(DEFAULTS);
  });
});
