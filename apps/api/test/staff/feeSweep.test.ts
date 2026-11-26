// B-006 / Plan 4 Task 9, reworked by the owner 26 Nov 2026: the payroll wallet (wallet 2) stays hot;
// when its balance reaches the owner's cap, the excess moves to X2F's fee wallet (X2F_FEE_WALLET,
// wallet 1), leaving the float for staff pay, and the owner is notified. Ships unset (sweep off).
// Settings are owner-only and tapped, and the destination is the fee wallet only. Real Postgres.
import type { KeyTapIntent } from '@x2f/staff';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../../src/app.js';
import { planFeeSweep, runFeeSweep, type FeeSweepConfig } from '../../src/staff/feeSweep.js';
import { StaffBrowser, errorOf, insertSession, logEntries, seedStaff, seedTap, staffApps } from '../helpers/staffApp.js';
import { fakeAddress, XMR } from '../helpers/trades.js';

const T0 = new Date('2026-11-09T12:00:00Z');
const COLD = fakeAddress();
const OTHER = fakeAddress();
const BAD = fakeAddress();

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let close: () => Promise<void>;
let owner: StaffBrowser;
let ownerId: string;

beforeAll(async () => {
  ({ app, deps, setNow, close } = await staffApps({ addresses: { check: async (a) => (a === BAD ? 'invalid' : 'ok') } }, {}, { config: { feeWallet: COLD } }));
  // COLD stands in for X2F's fee wallet: the only address the sweep may send to.
  setNow(T0);
  ownerId = (await seedStaff(deps, { role: 'owner' })).id;
  owner = new StaffBrowser(app).withSession((await insertSession(deps, ownerId, 'staff')).token);
});
afterAll(async () => close());

const on = (threshold: bigint, float: bigint): FeeSweepConfig => ({ thresholdAtomic: threshold, floatAtomic: float, coldAddress: COLD });

describe('the threshold maths (planFeeSweep)', () => {
  it('off while the threshold is unset, whatever the balance', () => {
    expect(planFeeSweep({ thresholdAtomic: null, floatAtomic: null, coldAddress: null }, 1000n * XMR)).toEqual({ due: false, reason: 'off' });
    expect(planFeeSweep({ thresholdAtomic: null, floatAtomic: XMR, coldAddress: COLD }, 1000n * XMR)).toEqual({ due: false, reason: 'off' });
  });

  it('below the threshold nothing moves; at or above it the balance less the float moves and the float stays', () => {
    const cfg = on(10n * XMR, 3n * XMR);
    expect(planFeeSweep(cfg, 10n * XMR - 1n)).toEqual({ due: false, reason: 'below-threshold' });
    expect(planFeeSweep(cfg, 0n)).toEqual({ due: false, reason: 'below-threshold' });
    expect(planFeeSweep(cfg, 10n * XMR)).toEqual({ due: true, balanceAtomic: 10n * XMR, amountAtomic: 7n * XMR, keepAtomic: 3n * XMR });
    expect(planFeeSweep(cfg, 25n * XMR + 7n)).toEqual({ due: true, balanceAtomic: 25n * XMR + 7n, amountAtomic: 22n * XMR + 7n, keepAtomic: 3n * XMR });
    // A zero float sweeps everything.
    expect(planFeeSweep(on(5n, 0n), 9n)).toEqual({ due: true, balanceAtomic: 9n, amountAtomic: 9n, keepAtomic: 0n });
  });

  it('a due sweep always moves something and never leaves less than the float', () => {
    const cfg = on(4n * XMR, 4n * XMR - 1n);
    for (const bal of [4n * XMR, 4n * XMR + 1n, 100n * XMR]) {
      const p = planFeeSweep(cfg, bal);
      expect(p.due).toBe(true);
      if (p.due) {
        expect(p.amountAtomic > 0n).toBe(true);
        expect(bal - p.amountAtomic).toBe(cfg.floatAtomic);
      }
    }
  });

  it('refuses a threshold not above the float, and a negative balance', () => {
    expect(() => planFeeSweep(on(3n, 3n), 10n)).toThrow(RangeError);
    expect(() => planFeeSweep(on(3n, 4n), 10n)).toThrow(RangeError);
    expect(() => planFeeSweep(on(5n, 1n), -1n)).toThrow(RangeError);
  });
});

const sweepTap = (i: Omit<Extract<KeyTapIntent, { kind: 'fee-sweep' }>, 'kind'>): Promise<string> => seedTap(deps, ownerId, { kind: 'fee-sweep', ...i });
const put = (body: unknown) => owner.send('PUT', '/staff/v1/fee-sweep', body);
const OFF = { thresholdAtomic: null, floatAtomic: null, coldAddress: null };
const resetSweep = async () => {
  await deps.db.query('update settings set fee_sweep_threshold_atomic = null, fee_sweep_float_atomic = null, fee_sweep_cold_address = null, fee_sweep_tap_id = null, fee_sweep_set_at = null');
};

describe('GET and PUT /staff/v1/fee-sweep (owner, tapped)', () => {
  beforeEach(resetSweep);

  it('ships off: no threshold, no float, no address, the wallet not wired, no sweep yet', async () => {
    const res = await owner.get('/staff/v1/fee-sweep');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ...OFF, on: false, walletWired: false, lastSweep: null });
  });

  it('turns on with a tap bound to the exact values; logs the amounts but never the address; the tap works once', async () => {
    const values = { thresholdAtomic: (10n * XMR).toString(), floatAtomic: (2n * XMR).toString(), coldAddress: COLD };
    expect(errorOf(await put({ ...values, tapId: '00000000-0000-4000-8000-000000000000' }))).toBe('tap-invalid');
    // A tap for other values (another address) does not authorise these.
    const wrong = await sweepTap({ ...values, coldAddress: OTHER });
    expect(errorOf(await put({ ...values, tapId: wrong }))).toBe('tap-invalid');
    expect((await owner.get('/staff/v1/fee-sweep')).json()).toMatchObject({ on: false });

    const before = (await logEntries(deps, 'settings.changed')).length;
    const tapId = await sweepTap(values);
    const res = await put({ ...values, tapId });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ ...values, on: true, walletWired: false, lastSweep: null });
    const logged = (await logEntries(deps, 'settings.changed')).slice(before).map((r) => JSON.parse(r.detail) as Record<string, unknown>);
    expect(logged).toEqual([
      { field: 'feeSweepThresholdAtomic', from: null, to: values.thresholdAtomic },
      { field: 'feeSweepFloatAtomic', from: null, to: values.floatAtomic },
      { field: 'feeSweepColdAddress' },
    ]);
    expect(JSON.stringify(logged)).not.toContain(COLD);
    expect(errorOf(await put({ ...values, thresholdAtomic: (11n * XMR).toString(), tapId }))).toBe('tap-invalid');

    // Off again, also tapped.
    const offTap = await sweepTap({ ...OFF });
    const off = await put({ ...OFF, tapId: offTap });
    expect(off.statusCode, off.body).toBe(200);
    expect(off.json()).toMatchObject({ on: false, coldAddress: null });
  });

  it('refuses a threshold not above the float, a threshold without a float or an address, bad amounts and a bad address', async () => {
    const tapId = '00000000-0000-4000-8000-000000000000';
    const cases: Array<[Record<string, unknown>, string, string]> = [
      [{ thresholdAtomic: '5', floatAtomic: '5', coldAddress: COLD }, 'bad-request', 'thresholdAtomic'],
      [{ thresholdAtomic: '5', floatAtomic: '6', coldAddress: COLD }, 'bad-request', 'thresholdAtomic'],
      [{ thresholdAtomic: '0', floatAtomic: '0', coldAddress: COLD }, 'bad-request', 'thresholdAtomic'],
      [{ thresholdAtomic: '5', floatAtomic: null, coldAddress: COLD }, 'bad-request', 'floatAtomic'],
      [{ thresholdAtomic: '5', floatAtomic: '1', coldAddress: null }, 'bad-request', 'coldAddress'],
      [{ thresholdAtomic: 5, floatAtomic: '1', coldAddress: COLD }, 'bad-request', 'thresholdAtomic'],
      [{ thresholdAtomic: '-5', floatAtomic: '1', coldAddress: COLD }, 'bad-request', 'thresholdAtomic'],
      [{ thresholdAtomic: '5', floatAtomic: '1.5', coldAddress: COLD }, 'bad-request', 'floatAtomic'],
      [{ thresholdAtomic: '5', floatAtomic: '1', coldAddress: 'not-an-address' }, 'bad-request', 'coldAddress'],
    ];
    for (const [body, error, field] of cases) {
      const res = await put({ ...body, tapId });
      expect({ body, status: res.statusCode, error: errorOf(res), field: (res.json() as { field?: string }).field }).toEqual({ body, status: 400, error, field });
    }
    expect(errorOf(await put({ thresholdAtomic: '5', floatAtomic: '1', coldAddress: COLD }))).toBe('bad-request');
    expect(errorOf(await put({ thresholdAtomic: '5', floatAtomic: '1', coldAddress: COLD, tapId, extra: 1 }))).toBe('bad-request');
    const bad = await put({ thresholdAtomic: '5', floatAtomic: '1', coldAddress: BAD, tapId });
    expect({ status: bad.statusCode, error: errorOf(bad) }).toEqual({ status: 400, error: 'address-invalid' });
  });

  it('refuses any destination but X2F\'s fee wallet, even with a tap for it', async () => {
    const values = { thresholdAtomic: (10n * XMR).toString(), floatAtomic: (2n * XMR).toString(), coldAddress: OTHER };
    const res = await put({ ...values, tapId: await sweepTap(values) });
    expect({ status: res.statusCode, error: errorOf(res) }).toEqual({ status: 400, error: 'not-fee-wallet' });
    expect((await owner.get('/staff/v1/fee-sweep')).json()).toMatchObject({ on: false, coldAddress: null });
  });

  it('a senior moderator gets forbidden', async () => {
    const id = (await seedStaff(deps, { role: 'senior' })).id;
    const res = await new StaffBrowser(app).withSession((await insertSession(deps, id, 'staff')).token).get('/staff/v1/fee-sweep');
    expect({ status: res.statusCode, error: errorOf(res) }).toEqual({ status: 403, error: 'forbidden' });
  });
});

describe('the sweep pass (runFeeSweep)', () => {
  let balance = 0n;
  const pushed: string[] = [];
  const base = () => ({ db: deps.db, clock: deps.clock, feeWallet: COLD as string | null, wallet: { unlockedAtomic: async () => balance }, push: { send: async (id: string) => (pushed.push(id), true) } });
  const ownerAlerts = async (kind: string) =>
    (await deps.db.query<{ detail: Record<string, unknown> }>('select detail from alerts where account_id = $1 and kind = $2 order by created_at', [ownerId, kind])).rows.map((r) => r.detail);
  const sweeps = async () => (await deps.db.query('select outcome, amount_atomic::text, keep_atomic::text, tx_hash from fee_sweeps order by id')).rows;
  const setSweep = async (threshold: bigint, float: bigint, at: Date) => {
    await deps.db.query('update settings set fee_sweep_threshold_atomic = $1, fee_sweep_float_atomic = $2, fee_sweep_cold_address = $3, fee_sweep_set_at = $4',
      [threshold.toString(), float.toString(), COLD, at]);
  };

  beforeAll(resetSweep);

  it('off: nothing is read as due, recorded or alerted', async () => {
    balance = 1000n * XMR;
    expect(await runFeeSweep(base())).toEqual({ outcome: 'off' });
    expect(await sweeps()).toEqual([]);
    expect(await ownerAlerts('fee-sweep-due')).toEqual([]);
  });

  it('below the threshold: nothing', async () => {
    await setSweep(10n * XMR, 2n * XMR, T0);
    balance = 10n * XMR - 1n;
    expect(await runFeeSweep(base())).toEqual({ outcome: 'below-threshold' });
    expect(await sweeps()).toEqual([]);
  });

  it('due with the unwired wallet: the owner is alerted (in-app and push), nothing moves, the failure is recorded once and not retried', async () => {
    setNow(new Date(T0.getTime() + 60_000));
    balance = 12n * XMR;
    expect(await runFeeSweep(base())).toEqual({ outcome: 'failed', amountAtomic: 10n * XMR, keepAtomic: 2n * XMR, reason: 'not-wired' });
    expect(await sweeps()).toEqual([{ outcome: 'failed', amount_atomic: (10n * XMR).toString(), keep_atomic: (2n * XMR).toString(), tx_hash: null }]);
    expect(await ownerAlerts('fee-sweep-due')).toMatchObject([{ balanceAtomic: (12n * XMR).toString(), amountAtomic: (10n * XMR).toString(), keepAtomic: (2n * XMR).toString() }]);
    expect(await ownerAlerts('fee-sweep-failed')).toMatchObject([{ reason: 'not-wired' }]);
    expect(pushed).toEqual([ownerId, ownerId]);
    expect((await logEntries(deps, 'treasury.sweep-failed')).map((r) => JSON.parse(r.detail) as unknown)).toEqual([{ amountAtomic: (10n * XMR).toString(), reason: 'not-wired' }]);
    // The next pass neither alerts nor tries again.
    setNow(new Date(T0.getTime() + 120_000));
    expect(await runFeeSweep(base())).toEqual({ outcome: 'held-after-failure' });
    expect(await ownerAlerts('fee-sweep-due')).toHaveLength(1);
    expect(await sweeps()).toHaveLength(1);
  });

  it('after the owner saves the settings again, a working send moves the balance less the float to the cold address', async () => {
    const now = new Date(T0.getTime() + 180_000);
    setNow(now);
    await setSweep(10n * XMR, 3n * XMR, now);
    balance = 15n * XMR;
    const sent: Array<{ coldAddress: string; amountAtomic: bigint }> = [];
    const txHash = 'ab'.repeat(32);
    // The send runs with no transaction open: the attempt is already committed as pending.
    const seenDuringSend: unknown[] = [];
    const res = await runFeeSweep({
      ...base(),
      send: async (a) => {
        sent.push(a);
        seenDuringSend.push(...(await deps.db.query('select outcome from fee_sweeps order by id desc limit 1')).rows);
        return { txHash };
      },
    });
    expect(seenDuringSend).toEqual([{ outcome: 'pending' }]);
    expect(res).toEqual({ outcome: 'sent', amountAtomic: 12n * XMR, keepAtomic: 3n * XMR, txHash });
    expect(sent).toEqual([{ coldAddress: COLD, amountAtomic: 12n * XMR }]);
    expect((await sweeps()).at(-1)).toEqual({ outcome: 'sent', amount_atomic: (12n * XMR).toString(), keep_atomic: (3n * XMR).toString(), tx_hash: txHash });
    expect((await logEntries(deps, 'treasury.swept')).map((r) => JSON.parse(r.detail) as unknown)).toEqual([{ amountAtomic: (12n * XMR).toString(), txHash }]);
    expect(await ownerAlerts('fee-sweep-due')).toHaveLength(2);
    expect(await ownerAlerts('fee-sweep-failed')).toHaveLength(1);
    const view = (await owner.get('/staff/v1/fee-sweep')).json() as { lastSweep: unknown };
    expect(view.lastSweep).toEqual({ at: now.toISOString(), amountAtomic: (12n * XMR).toString(), keepAtomic: (3n * XMR).toString(), outcome: 'sent', txHash });
  });

  it('a send that returns no proper tx hash counts as failed', async () => {
    const now = new Date(T0.getTime() + 240_000);
    setNow(now);
    await setSweep(10n * XMR, 3n * XMR, now);
    balance = 11n * XMR;
    expect(await runFeeSweep({ ...base(), send: async () => ({ txHash: 'nope' }) })).toMatchObject({ outcome: 'failed', reason: 'send-error' });
  });

  it('an attempt left pending (the process died mid-send) is never sent again until the owner saves the settings', async () => {
    const now = new Date(T0.getTime() + 300_000);
    setNow(now);
    await setSweep(10n * XMR, 3n * XMR, now);
    await deps.db.query(`insert into fee_sweeps (at, balance_atomic, amount_atomic, keep_atomic, outcome) values ($1, $2, $3, $4, 'pending')`, [
      new Date(now.getTime() + 1_000), (12n * XMR).toString(), (9n * XMR).toString(), (3n * XMR).toString(),
    ]);
    setNow(new Date(now.getTime() + 60_000));
    balance = 12n * XMR;
    const sent: unknown[] = [];
    const alertsBefore = (await ownerAlerts('fee-sweep-due')).length;
    expect(await runFeeSweep({ ...base(), send: async (a) => (sent.push(a), { txHash: 'cd'.repeat(32) }) })).toEqual({ outcome: 'held-unfinished' });
    expect(sent).toEqual([]);
    expect(await ownerAlerts('fee-sweep-due')).toHaveLength(alertsBefore);
    expect((await owner.get('/staff/v1/fee-sweep')).json()).toMatchObject({ lastSweep: { outcome: 'pending', txHash: null } });
    // The owner saves the settings again (after checking the wallet): the next pass runs.
    const later = new Date(now.getTime() + 120_000);
    setNow(later);
    await setSweep(10n * XMR, 3n * XMR, later);
    expect(await runFeeSweep({ ...base(), send: async (a) => (sent.push(a), { txHash: 'cd'.repeat(32) }) })).toMatchObject({ outcome: 'sent', amountAtomic: 9n * XMR });
    expect(sent).toHaveLength(1);
  });

  it('a second pass while one is running is busy and sends nothing', async () => {
    const now = new Date(T0.getTime() + 600_000);
    setNow(now);
    await setSweep(10n * XMR, 3n * XMR, now);
    balance = 20n * XMR;
    let inner: unknown;
    const res = await runFeeSweep({
      ...base(),
      send: async () => {
        inner = await runFeeSweep({ ...base(), send: async () => { throw new Error('the second pass must not send'); } });
        return { txHash: 'ef'.repeat(32) };
      },
    });
    expect(res).toMatchObject({ outcome: 'sent' });
    expect(inner).toEqual({ outcome: 'busy' });
  });

  // Review F2: the send uses the settings as they are just before it, not as step 1 read them.
  it('the owner changes the cold address mid-pass: nothing is sent, the attempt is failed (settings-changed); an address that is not the fee wallet is never sent to', async () => {
    const now = new Date(T0.getTime() + 700_000);
    setNow(now);
    await setSweep(10n * XMR, 3n * XMR, now);
    balance = 13n * XMR;
    const sent: Array<{ coldAddress: string; amountAtomic: bigint }> = [];
    const changedAt = new Date(now.getTime() + 5_000);
    const res = await runFeeSweep({
      ...base(),
      // The push runs after step 1 committed and before the send: the owner saves a new address then.
      push: { send: async () => {
        await deps.db.query('update settings set fee_sweep_cold_address = $1, fee_sweep_set_at = $2', [OTHER, changedAt]);
        return true;
      } },
      send: async (a) => (sent.push(a), { txHash: '12'.repeat(32) }),
    });
    expect(res).toEqual({ outcome: 'failed', amountAtomic: 10n * XMR, keepAtomic: 3n * XMR, reason: 'settings-changed' });
    expect(sent).toEqual([]);
    expect((await sweeps()).at(-1)).toMatchObject({ outcome: 'failed', tx_hash: null });
    expect((await ownerAlerts('fee-sweep-failed')).at(-1)).toMatchObject({ reason: 'settings-changed' });
    expect((await logEntries(deps, 'treasury.sweep-failed')).map((r) => JSON.parse(r.detail) as unknown).at(-1)).toEqual({ amountAtomic: (10n * XMR).toString(), reason: 'settings-changed' });
    // The change came after the attempt, so it lifts the hold, but the new address is not the fee
    // wallet: the next pass sends nothing (not-fee-wallet).
    setNow(new Date(now.getTime() + 60_000));
    expect(await runFeeSweep({ ...base(), send: async (a) => (sent.push(a), { txHash: '12'.repeat(32) }) })).toMatchObject({ outcome: 'failed', reason: 'not-fee-wallet' });
    expect(sent).toEqual([]);
    await setSweep(10n * XMR, 3n * XMR, new Date(now.getTime() + 61_000));
  });

  it('the owner turns the sweep off mid-pass: nothing is sent, the attempt is failed (settings-changed)', async () => {
    const now = new Date(T0.getTime() + 800_000);
    setNow(now);
    await setSweep(10n * XMR, 3n * XMR, now);
    balance = 13n * XMR;
    const sent: unknown[] = [];
    const res = await runFeeSweep({
      ...base(),
      push: { send: async () => {
        await deps.db.query('update settings set fee_sweep_threshold_atomic = null, fee_sweep_float_atomic = null, fee_sweep_cold_address = null, fee_sweep_set_at = $1', [new Date(now.getTime() + 5_000)]);
        return true;
      } },
      send: async (a) => (sent.push(a), { txHash: '34'.repeat(32) }),
    });
    expect(res).toMatchObject({ outcome: 'failed', reason: 'settings-changed' });
    expect(sent).toEqual([]);
    expect((await sweeps()).at(-1)).toMatchObject({ outcome: 'failed' });
  });

  // Review R2: any settings save after step 1 stops the send (`fee_sweep_set_at` moved), not only an
  // address change or a switch-off: a sweep sized from the old float would leave the hot wallet short.
  it('the owner raises the float mid-pass: nothing is sent at the old size, the attempt is failed (settings-changed), the next pass uses the new float', async () => {
    const now = new Date(T0.getTime() + 850_000);
    setNow(now);
    await setSweep(10n * XMR, 3n * XMR, now);
    balance = 13n * XMR;
    const sent: unknown[] = [];
    const res = await runFeeSweep({
      ...base(),
      push: { send: async () => {
        await deps.db.query('update settings set fee_sweep_float_atomic = $1, fee_sweep_set_at = $2', [(4n * XMR).toString(), new Date(now.getTime() + 5_000)]);
        return true;
      } },
      send: async (a) => (sent.push(a), { txHash: '56'.repeat(32) }),
    });
    expect(res).toEqual({ outcome: 'failed', amountAtomic: 10n * XMR, keepAtomic: 3n * XMR, reason: 'settings-changed' });
    expect(sent).toEqual([]);
    expect((await sweeps()).at(-1)).toMatchObject({ outcome: 'failed', tx_hash: null });
    expect((await ownerAlerts('fee-sweep-failed')).at(-1)).toMatchObject({ reason: 'settings-changed' });
    // The save came after the attempt, so it lifts the hold: the next pass is sized from the new float.
    setNow(new Date(now.getTime() + 30_000));
    expect(await runFeeSweep({ ...base(), send: async (a) => (sent.push(a), { txHash: '56'.repeat(32) }) })).toMatchObject({ outcome: 'sent', amountAtomic: 9n * XMR, keepAtomic: 4n * XMR });
    expect(sent).toEqual([{ coldAddress: COLD, amountAtomic: 9n * XMR }]);
  });

  // A concurrent owner's save, tried from a second connection with a short lock timeout: null when
  // it went through at once, the 55P03 error when it had to wait on the pass's share lock.
  const trySettingsWrite = async (at: Date): Promise<unknown> => {
    const c = await deps.db.connect();
    try {
      await c.query('begin');
      await c.query("set local lock_timeout = '200ms'");
      const outcome = await c.query('update settings set fee_sweep_set_at = $1', [at]).then(() => null, (e: unknown) => e);
      await c.query('rollback');
      return outcome;
    } finally {
      c.release();
    }
  };

  // Review R3: the wallet RPC runs before step 1's transaction, so a slow or hung wallet never holds
  // the settings share lock and never blocks the owner's saves.
  it('the wallet balance is read outside step 1: a settings write during the wallet RPC does not wait', async () => {
    const now = new Date(T0.getTime() + 900_000);
    setNow(now);
    await setSweep(10n * XMR, 3n * XMR, now);
    let writeError: unknown = 'not tried';
    const res = await runFeeSweep({
      ...base(),
      wallet: {
        unlockedAtomic: async () => {
          writeError = await trySettingsWrite(now);
          return 1n;
        },
      },
    });
    expect(res).toEqual({ outcome: 'below-threshold' });
    expect(writeError).toBeNull();
  });

  it('step 1 holds the settings share lock from its read to its commit: a concurrent settings write waits for it', async () => {
    const now = new Date(T0.getTime() + 950_000);
    setNow(now);
    await setSweep(10n * XMR, 3n * XMR, now);
    balance = 13n * XMR;
    let writeError: unknown = 'not tried';
    // The pass's own connection, with the held-attempt check (the first query after the `for share`
    // read, inside step 1's transaction) hooked once to try the concurrent write. Everything but
    // `connect` runs on the real pool (`pool.query` calls `this.connect` with a callback).
    const db = new Proxy(deps.db, {
      get(target, prop) {
        if (prop !== 'connect') {
          const v = Reflect.get(target, prop) as unknown;
          return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
        }
        return async () => {
          const c = await target.connect();
          const query = c.query.bind(c) as (...a: unknown[]) => Promise<unknown>;
          const release = c.release.bind(c);
          const hooked = (...a: unknown[]) =>
            writeError === 'not tried' && typeof a[0] === 'string' && a[0].includes('select outcome, at from fee_sweeps')
              ? trySettingsWrite(now).then((e) => ((writeError = e), query(...a)))
              : query(...a);
          // The hook leaves with the connection: the pooled client is handed back as it was.
          return Object.assign(c, { query: hooked, release: (err?: Error | boolean) => (delete (c as { query?: unknown }).query, release(err)) });
        };
      },
    });
    expect(await runFeeSweep({ ...base(), db, send: async () => ({ txHash: '78'.repeat(32) }) })).toMatchObject({ outcome: 'sent' });
    expect(writeError).toMatchObject({ code: '55P03' });
  });

  // Review F3: the phone push is best-effort; a push failure never leaves the attempt pending.
  it('a failing phone push neither stops the pass nor leaves the attempt pending', async () => {
    const now = new Date(T0.getTime() + 1_000_000);
    setNow(now);
    await setSweep(10n * XMR, 3n * XMR, now);
    balance = 14n * XMR;
    const failingPush = { send: async (): Promise<boolean> => { throw new Error('push service down'); } };
    expect(await runFeeSweep({ ...base(), push: failingPush })).toMatchObject({ outcome: 'failed', reason: 'not-wired' });
    expect((await sweeps()).at(-1)).toMatchObject({ outcome: 'failed' });
    const later = new Date(now.getTime() + 60_000);
    setNow(later);
    await setSweep(10n * XMR, 3n * XMR, later);
    const txHash = '56'.repeat(32);
    expect(await runFeeSweep({ ...base(), push: failingPush, send: async () => ({ txHash }) })).toMatchObject({ outcome: 'sent', txHash });
    expect((await sweeps()).at(-1)).toMatchObject({ outcome: 'sent', tx_hash: txHash });
  });

  // Review F4: a connection whose advisory unlock failed still holds the lock; it is destroyed, never pooled.
  it('if releasing the pass lock fails, the connection is destroyed instead of returned to the pool', async () => {
    const now = new Date(T0.getTime() + 1_100_000);
    setNow(now);
    await setSweep(10n * XMR, 3n * XMR, now);
    balance = 1n;
    const releases: unknown[] = [];
    const db = new Proxy(deps.db, {
      get(target, prop, receiver) {
        if (prop !== 'connect') return Reflect.get(target, prop, receiver) as unknown;
        return async () => {
          const c = await target.connect();
          const query = c.query.bind(c) as (...a: unknown[]) => Promise<unknown>;
          const release = c.release.bind(c);
          return Object.assign(c, {
            query: (...a: unknown[]) => (typeof a[0] === 'string' && a[0].includes('pg_advisory_unlock') ? Promise.reject(new Error('connection lost')) : query(...a)),
            release: (err?: Error | boolean) => (releases.push(err), release(err)),
          });
        };
      },
    });
    expect(await runFeeSweep({ ...base(), db })).toEqual({ outcome: 'below-threshold' });
    expect(releases).toHaveLength(1);
    expect(releases[0]).toBeInstanceOf(Error);
    // The lock went with the destroyed connection: a later pass is not busy.
    let next: unknown;
    for (let i = 0; i < 20; i++) {
      next = await runFeeSweep(base());
      if ((next as { outcome: string }).outcome !== 'busy') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(next).toEqual({ outcome: 'below-threshold' });
  });

  it('the default send is the payroll wallet\'s transfer to the fee wallet, the network fee off the amount; the fee is recorded', async () => {
    const now = new Date(T0.getTime() + 1_200_000);
    setNow(now);
    await setSweep(10n * XMR, 3n * XMR, now);
    balance = 13n * XMR;
    const transfers: unknown[] = [];
    const txHash = '9a'.repeat(32);
    const wallet = { unlockedAtomic: async () => balance, transfer: async (a: { address: string; amountAtomic: bigint; feeFromAmount: boolean }) => (transfers.push(a), { txHash, feeAtomic: 30_000_000n }) };
    expect(await runFeeSweep({ ...base(), wallet })).toMatchObject({ outcome: 'sent', txHash, amountAtomic: 10n * XMR });
    expect(transfers).toEqual([{ address: COLD, amountAtomic: 10n * XMR, feeFromAmount: true }]);
    expect((await deps.db.query('select network_fee_atomic::text as fee from fee_sweeps order by id desc limit 1')).rows).toEqual([{ fee: '30000000' }]);
  });

  it('no fee wallet configured: a due sweep sends nothing (not-fee-wallet)', async () => {
    const now = new Date(T0.getTime() + 1_300_000);
    setNow(now);
    await setSweep(10n * XMR, 3n * XMR, now);
    balance = 13n * XMR;
    const sent: unknown[] = [];
    expect(await runFeeSweep({ ...base(), feeWallet: null, send: async (a) => (sent.push(a), { txHash: 'bc'.repeat(32) }) })).toMatchObject({ outcome: 'failed', reason: 'not-fee-wallet' });
    expect(sent).toEqual([]);
  });

  it('the attempts table refuses a sent row without a tx hash and a pending row with a settled time', async () => {
    const row = [T0, '5', '4', '1'];
    await expect(deps.db.query(`insert into fee_sweeps (at, balance_atomic, amount_atomic, keep_atomic, outcome) values ($1, $2, $3, $4, 'sent')`, row)).rejects.toThrow(/check/);
    await expect(deps.db.query(`insert into fee_sweeps (at, balance_atomic, amount_atomic, keep_atomic, outcome, settled_at) values ($1, $2, $3, $4, 'pending', $1)`, row)).rejects.toThrow(/check/);
    await expect(deps.db.query(`insert into fee_sweeps (at, balance_atomic, amount_atomic, keep_atomic, outcome) values ($1, $2, $3, $4, 'failed')`, row)).rejects.toThrow(/check/);
  });
});
