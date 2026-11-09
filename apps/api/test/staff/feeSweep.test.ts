// B-006 / Plan 4 Task 9 (owner, 2026-10-29 lead calls q7): the fee wallet stays hot; when its
// balance reaches the owner's threshold, the excess moves to his cold wallet, leaving one day plus
// one night of staff pay, and the owner is notified. Ships unset (sweep off). The send itself is
// Plan 6's (tripwire NEEDS_PLAN_6_FEE_WALLET): until then a due sweep alerts the owner and moves
// nothing. Settings are owner-only and tapped. Real Postgres.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { KeyTapIntent } from '@x2f/staff';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../../src/app.js';
import { FeeWalletNotWiredError, NEEDS_PLAN_6_FEE_WALLET, planFeeSweep, runFeeSweep, sendFeeSweepToColdWallet, type FeeSweepConfig } from '../../src/staff/feeSweep.js';
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
  ({ app, deps, setNow, close } = await staffApps({ addresses: { check: async (a) => (a === BAD ? 'invalid' : 'ok') } }));
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

describe('TRIPWIRE NEEDS_PLAN_6_FEE_WALLET', () => {
  it('the send moves nothing until Plan 6 wires the fee wallet, and nothing starts the sweep', async () => {
    // When Plan 6 lands: wire sendFeeSweepToColdWallet to the fee wallet (see its comment), start
    // runFeeSweep from main.ts with the wallet's balance, and delete this test.
    const err = await sendFeeSweepToColdWallet({ coldAddress: COLD, amountAtomic: XMR }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FeeWalletNotWiredError);
    expect((err as FeeWalletNotWiredError).code).toBe(NEEDS_PLAN_6_FEE_WALLET);
    const main = readFileSync(fileURLToPath(new URL('../../src/main.ts', import.meta.url)), 'utf8');
    expect(main.includes('runFeeSweep') || main.includes('feeSweep'), 'main.ts starts the fee sweep: Plan 6 landed? see this test').toBe(false);
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

  it('a senior moderator gets forbidden', async () => {
    const id = (await seedStaff(deps, { role: 'senior' })).id;
    const res = await new StaffBrowser(app).withSession((await insertSession(deps, id, 'staff')).token).get('/staff/v1/fee-sweep');
    expect({ status: res.statusCode, error: errorOf(res) }).toEqual({ status: 403, error: 'forbidden' });
  });
});

describe('the sweep pass (runFeeSweep)', () => {
  let balance = 0n;
  const pushed: string[] = [];
  const base = () => ({ db: deps.db, clock: deps.clock, wallet: { unlockedAtomic: async () => balance }, push: { send: async (id: string) => (pushed.push(id), true) } });
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
  it('the owner changes the cold address mid-pass: nothing is sent, the attempt is failed (settings-changed), the next pass uses the new address', async () => {
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
    // The owner's change came after the attempt, so it lifts the hold: the next pass sends to the new address.
    setNow(new Date(now.getTime() + 60_000));
    expect(await runFeeSweep({ ...base(), send: async (a) => (sent.push(a), { txHash: '12'.repeat(32) }) })).toMatchObject({ outcome: 'sent' });
    expect(sent).toEqual([{ coldAddress: OTHER, amountAtomic: 10n * XMR }]);
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

  it('step 1 reads the settings under a share lock: a concurrent settings write waits for it', async () => {
    const now = new Date(T0.getTime() + 900_000);
    setNow(now);
    await setSweep(10n * XMR, 3n * XMR, now);
    let writeError: unknown = 'not tried';
    const res = await runFeeSweep({
      ...base(),
      wallet: {
        unlockedAtomic: async () => {
          // Step 1's transaction is open here, after it read the settings.
          const c = await deps.db.connect();
          try {
            await c.query('begin');
            await c.query("set local lock_timeout = '200ms'");
            writeError = await c.query('update settings set fee_sweep_set_at = $1', [now]).then(() => null, (e: unknown) => e);
            await c.query('rollback');
          } finally {
            c.release();
          }
          return 1n;
        },
      },
    });
    expect(res).toEqual({ outcome: 'below-threshold' });
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

  it('the attempts table refuses a sent row without a tx hash and a pending row with a settled time', async () => {
    const row = [T0, '5', '4', '1'];
    await expect(deps.db.query(`insert into fee_sweeps (at, balance_atomic, amount_atomic, keep_atomic, outcome) values ($1, $2, $3, $4, 'sent')`, row)).rejects.toThrow(/check/);
    await expect(deps.db.query(`insert into fee_sweeps (at, balance_atomic, amount_atomic, keep_atomic, outcome, settled_at) values ($1, $2, $3, $4, 'pending', $1)`, row)).rejects.toThrow(/check/);
    await expect(deps.db.query(`insert into fee_sweeps (at, balance_atomic, amount_atomic, keep_atomic, outcome) values ($1, $2, $3, $4, 'failed')`, row)).rejects.toThrow(/check/);
  });
});
