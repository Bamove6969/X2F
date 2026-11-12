// Plan 4 Task 33 / J-12 (D-041..D-045): staff pay at a correct clock-out, the senior moderators'
// large-trade share and clawback option A. The owner's words (owner answers 2026-10-28 13:07 and
// 13:24, 2026-10-29 lead calls q5/q6):
// - clock-in is the staff login; AT A CORRECT CLOCK-OUT the system pays every dispute completed
//   since the previous paid clock-out (forgetting for days loses nothing), shows the total and asks
//   for a pre-approved address; adding an address needs the strong login;
// - closing the app is no clock-out; an automatic logout is recorded as information only;
// - per completed dispute only (no hourly) for every moderator; seniors also get a % of the revenue
//   of large trades (threshold and % are the owner's numbers: settings with no default);
// - clawback A: pay goes out at clock-out; an overruled decision reduces future pay (owed if they leave).
// MONEY. Real Postgres.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { applyDispute, type Actor, type KeyTapIntent, type RulingOutcome, type StaffRole } from '@x2f/staff';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../../src/app.js';
import { withTx } from '../../src/auth/hold.js';
import { DISPUTE_DEFAULTS } from '../../src/disputes/settings.js';
import { startDispute, withDispute } from '../../src/disputes/store.js';
import type { MarketPrices } from '../../src/price/market.js';
import { parseKeyTapIntent, tapPermOf } from '../../src/staff/keyTap.js';
import { NEEDS_PLAN_6_PAYROLL_WALLET, PayrollWalletNotWiredError, sendStaffPayout } from '../../src/staff/pay.js';
import { endSessionForHours } from '../../src/staff/sweeper.js';
import { seedAccount } from '../helpers/accounts.js';
import { appealDirect } from '../helpers/disputes.js';
import { StaffBrowser, errorOf, insertSession, logEntries, seedStaff, seedTap, staffApps, uniqueName } from '../helpers/staffApp.js';
import { driveTo, fakeAddress, seedTrade, XMR } from '../helpers/trades.js';

const T0 = new Date('2026-11-12T10:00:00Z');
const H = 3_600_000;
/** XMR at $330.00 (US cents per XMR) for the payout's conversion. */
const USD_PER_XMR = 33_000n;
const BAD = fakeAddress();
const INTEGRATED = fakeAddress();

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let now = T0;
let close: () => Promise<void>;
let owner: StaffBrowser;
let ownerId: string;
let priceOn = true;

const prices = {
  current: () => null,
  quote: (c: string) => (priceOn && c === 'USD' ? { price: { currency: 'USD', centsPerXmr: USD_PER_XMR }, usdCentsPerXmr: USD_PER_XMR, fx: null } : null),
  health: () => ({ xmr: [], fx: [] }),
  poll: async () => undefined,
  start: () => undefined,
  stop: async () => undefined,
} as unknown as MarketPrices;

beforeAll(async () => {
  ({ app, deps, setNow, close } = await staffApps({
    prices,
    addresses: { check: async (a) => (a === BAD ? 'invalid' : a === INTEGRATED ? 'integrated' : 'ok') },
  }));
  at(T0);
  ownerId = (await seedStaff(deps, { role: 'owner' })).id;
  owner = new StaffBrowser(app).withSession((await insertSession(deps, ownerId, 'staff')).token);
});
afterAll(async () => close());

function at(d: Date): void {
  now = d;
  setNow(d);
}
const later = (ms: number) => at(new Date(now.getTime() + ms));

interface Member {
  id: string;
  role: StaffRole;
  b: StaffBrowser;
  sessionId: string;
  /** A fresh session (a new login: a new shift). */
  login(): Promise<void>;
}

async function member(role: StaffRole): Promise<Member> {
  const s = await seedStaff(deps, { role });
  const m: Member = {
    id: s.id, role, b: new StaffBrowser(app), sessionId: '',
    async login() {
      const x = await insertSession(deps, s.id, 'staff');
      m.b = new StaffBrowser(app).withSession(x.token);
      m.sessionId = x.sessionId;
    },
  };
  await m.login();
  return m;
}

const S = { appealWindowH: DISPUTE_DEFAULTS.appealWindowH, firstResponseH: DISPUTE_DEFAULTS.firstResponseH };

/** A USD trade of $412.50 (fee 0.0125 XMR) in dispute, opened by the buyer. */
async function disputed(): Promise<string> {
  const seller = await seedAccount(deps, { loginName: uniqueName('s') });
  const buyer = await seedAccount(deps, { loginName: uniqueName('b') });
  const { trade } = await seedTrade(deps, { sellerId: seller, buyerId: buyer, poster: 'seller' });
  const t = await driveTo(deps, trade, 'paid');
  await withTx(deps.db, async (c) => {
    await c.query("update trades set state = 'disputed' where code = $1", [t.code]);
    await startDispute(c, t, { openedBy: 'buyer', reason: 'paid', note: '', afterRefund: false, now: deps.clock(), prices: null });
  });
  return t.code;
}
const FEE = 12_500_000_000n;

/** Round 1: `by` takes the case and rules (published at once under the large-trade limit with no account action). */
async function rule(code: string, by: { id: string; role: StaffRole }, outcome: RulingOutcome = 'release-to-buyer') {
  return withDispute(deps, { code }, async (d) => {
    const actor: Actor = { kind: 'staff', id: by.id, role: by.role };
    let x = applyDispute(d, { type: 'assign', staffId: by.id, role: by.role }, actor, deps.clock(), S);
    x = applyDispute(x, { type: 'propose', ruling: { id: randomUUID(), outcome, accountAction: { kind: 'none' }, proposer: by.id } }, actor, deps.clock(), S);
    return x;
  });
}

/** Round 2 after an appeal: an uninvolved senior decides (final at once). */
async function decideAppeal(code: string, reviewer: { id: string }, outcome: RulingOutcome) {
  await appealDirect(deps, code, 'seller');
  return withDispute(deps, { code }, async (d) => {
    const actor: Actor = { kind: 'staff', id: reviewer.id, role: 'senior' };
    let x = applyDispute(d, { type: 'assign', staffId: reviewer.id, role: 'senior' }, actor, deps.clock(), S);
    x = applyDispute(x, { type: 'propose', ruling: { id: randomUUID(), outcome, accountAction: { kind: 'none' }, proposer: reviewer.id } }, actor, deps.clock(), S);
    return x;
  });
}

interface PaySettingsBody {
  modDisputeUsdCents: number | null;
  seniorDisputeUsdCents: number | null;
  seniorLargeTradeBp: number | null;
  largeTradeThresholdUsd: number | null;
}
const UNSET: PaySettingsBody = { modDisputeUsdCents: null, seniorDisputeUsdCents: null, seniorLargeTradeBp: null, largeTradeThresholdUsd: null };

/** The owner signs in again (a staff session lasts 2 hours idle; these tests move the clock by days). */
async function ownerLogin(): Promise<void> {
  owner = new StaffBrowser(app).withSession((await insertSession(deps, ownerId, 'staff')).token);
}

async function setPay(v: PaySettingsBody): Promise<void> {
  await ownerLogin();
  const tapId = await seedTap(deps, ownerId, { kind: 'pay-settings', ...v });
  const res = await owner.send('PUT', '/staff/v1/pay/settings', { ...v, tapId });
  expect(res.statusCode, res.body).toBe(200);
}

async function addAddress(m: Member, address = fakeAddress()): Promise<string> {
  const tapId = await seedTap(deps, m.id, { kind: 'payout-address', address });
  const res = await m.b.post('/staff/v1/pay/addresses', { address, tapId });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { id: string }).id;
}

interface PayView {
  unpaid: { items: Array<{ kind: string; code: string | null; seq: number | null; usdCents: string | null; atomic: string | null }>; usdCents: string; atomic: string };
  payouts: Array<{ id: string; amountAtomic: string; usdCents: string; atomic: string; usdCentsPerXmr: string | null; status: string; addressId: string }>;
  shifts: Array<{ clockedInAt: string; endedAt: string | null; ended: string | null }>;
  addresses: Array<{ id: string; address: string; addedAt: string }>;
}
const myPay = async (m: Member): Promise<PayView> => {
  const res = await m.b.get('/staff/v1/pay');
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as PayView;
};

const clockOut = (m: Member, addressId?: string) => m.b.post('/staff/v1/pay/clock-out', addressId === undefined ? {} : { addressId });

describe('the owner pay settings (D-042, D-043: owner numbers, no default)', () => {
  it('ship unset; only the owner reads or changes them; a change needs a tap bound to the exact values and is logged', async () => {
    const res = await owner.get('/staff/v1/pay/settings');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual(UNSET);

    const mod = await member('mod');
    const senior = await member('senior');
    for (const b of [mod.b, senior.b]) {
      expect((await b.get('/staff/v1/pay/settings')).statusCode).toBe(403);
      expect((await b.send('PUT', '/staff/v1/pay/settings', { ...UNSET, tapId: randomUUID() })).statusCode).toBe(403);
    }

    const values = { modDisputeUsdCents: 500, seniorDisputeUsdCents: 800, seniorLargeTradeBp: 1000, largeTradeThresholdUsd: 400 };
    expect(errorOf(await owner.send('PUT', '/staff/v1/pay/settings', { ...values, tapId: randomUUID() }))).toBe('tap-invalid');
    const wrong = await seedTap(deps, ownerId, { kind: 'pay-settings', ...values, modDisputeUsdCents: 501 });
    expect(errorOf(await owner.send('PUT', '/staff/v1/pay/settings', { ...values, tapId: wrong }))).toBe('tap-invalid');

    const before = (await logEntries(deps, 'settings.changed')).length;
    await setPay(values);
    expect((await owner.get('/staff/v1/pay/settings')).json()).toEqual(values);
    const logged = (await logEntries(deps, 'settings.changed')).slice(before).map((r) => JSON.parse(r.detail) as Record<string, unknown>);
    expect(logged).toEqual([
      { field: 'payModDisputeUsdCents', from: null, to: 500 },
      { field: 'paySeniorDisputeUsdCents', from: null, to: 800 },
      { field: 'seniorLargeTradeBp', from: null, to: 1000 },
      { field: 'largeTradeBonusThresholdUsd', from: null, to: 400 },
    ]);
    await setPay(UNSET);
  });

  it('refuses out-of-range and malformed values', async () => {
    const tapId = randomUUID();
    for (const bad of [
      { ...UNSET, modDisputeUsdCents: -1 },
      { ...UNSET, modDisputeUsdCents: 1.5 },
      { ...UNSET, modDisputeUsdCents: 10_000_001 },
      { ...UNSET, seniorLargeTradeBp: 10_001 },
      { ...UNSET, largeTradeThresholdUsd: 0 },
      { ...UNSET, largeTradeThresholdUsd: '400' },
      { modDisputeUsdCents: null },
      { ...UNSET, extra: 1 },
    ]) {
      expect(errorOf(await owner.send('PUT', '/staff/v1/pay/settings', { ...bad, tapId })), JSON.stringify(bad)).toBe('bad-request');
    }
  });
});

describe('payout addresses (D-041: pre-approved; adding one needs the strong login)', () => {
  it('adding needs a tap bound to that address; a bad, integrated or repeated address is refused; removed ones cannot be used', async () => {
    const mod = await member('mod');
    const address = fakeAddress();
    expect(errorOf(await mod.b.post('/staff/v1/pay/addresses', { address, tapId: randomUUID() }))).toBe('tap-invalid');
    const other = await seedTap(deps, mod.id, { kind: 'payout-address', address: fakeAddress() });
    expect(errorOf(await mod.b.post('/staff/v1/pay/addresses', { address, tapId: other }))).toBe('tap-invalid');
    // Someone else's tap for the same address does not count.
    const senior = await member('senior');
    const theirs = await seedTap(deps, senior.id, { kind: 'payout-address', address });
    expect(errorOf(await mod.b.post('/staff/v1/pay/addresses', { address, tapId: theirs }))).toBe('tap-invalid');

    expect(errorOf(await mod.b.post('/staff/v1/pay/addresses', { address: BAD, tapId: await seedTap(deps, mod.id, { kind: 'payout-address', address: BAD }) }))).toBe('address-invalid');
    expect(errorOf(await mod.b.post('/staff/v1/pay/addresses', { address: INTEGRATED, tapId: await seedTap(deps, mod.id, { kind: 'payout-address', address: INTEGRATED }) }))).toBe('address-invalid');
    expect(errorOf(await mod.b.post('/staff/v1/pay/addresses', { address: 'short', tapId: randomUUID() }))).toBe('bad-request');

    const before = (await logEntries(deps, 'pay.address-added')).length;
    const id = await addAddress(mod, address);
    const added = (await logEntries(deps, 'pay.address-added')).slice(before);
    expect(added).toHaveLength(1);
    expect(added[0]!.detail).not.toContain(address);
    expect(errorOf(await mod.b.post('/staff/v1/pay/addresses', { address, tapId: await seedTap(deps, mod.id, { kind: 'payout-address', address }) }))).toBe('address-exists');
    expect((await myPay(mod)).addresses.map((a) => a.address)).toEqual([address]);
    // Nobody sees another member's addresses.
    expect((await myPay(senior)).addresses).toEqual([]);
    expect((await senior.b.send('DELETE', `/staff/v1/pay/addresses/${id}`)).statusCode).toBe(404);

    expect((await mod.b.send('DELETE', `/staff/v1/pay/addresses/${id}`)).statusCode).toBe(200);
    expect((await myPay(mod)).addresses).toEqual([]);
    expect((await logEntries(deps, 'pay.address-removed')).length).toBeGreaterThan(0);
  });
});

describe('earning: per completed dispute (D-041, D-042) and the senior large-trade share (D-043)', () => {
  it('a moderator earns the moderator amount once for a round-1 ruling they published; later saves add nothing', async () => {
    await setPay({ modDisputeUsdCents: 500, seniorDisputeUsdCents: 800, seniorLargeTradeBp: 1000, largeTradeThresholdUsd: 400 });
    const mod = await member('mod');
    const code = await disputed();
    await rule(code, mod);
    // The appeal window closes (another save of the same dispute).
    later(49 * H);
    await withDispute(deps, { code }, async (d) => applyDispute(d, { type: 'window-closed' }, { kind: 'system' }, deps.clock(), S));
    await mod.login();
    const v = await myPay(mod);
    expect(v.unpaid.items).toEqual([{ kind: 'dispute', code, seq: 1, usdCents: '500', atomic: null, earnedAt: expect.any(String) }]);
    // A moderator gets no large-trade share, even at the threshold.
    expect(v.unpaid).toMatchObject({ usdCents: '500', atomic: '0' });
    await setPay(UNSET);
  });

  it('a senior earns the senior amount plus the share of the fee at or above the threshold; none below it or on a full reversal', async () => {
    const senior = await member('senior');
    // $412.50 trade, threshold $400: large. 10% of the 0.0125 XMR fee.
    await setPay({ modDisputeUsdCents: 500, seniorDisputeUsdCents: 800, seniorLargeTradeBp: 1000, largeTradeThresholdUsd: 412 });
    const large = await disputed();
    await rule(large, senior);
    await setPay({ modDisputeUsdCents: 500, seniorDisputeUsdCents: 800, seniorLargeTradeBp: 1000, largeTradeThresholdUsd: 413 });
    const small = await disputed();
    await rule(small, senior);
    await setPay({ modDisputeUsdCents: 500, seniorDisputeUsdCents: 800, seniorLargeTradeBp: 1000, largeTradeThresholdUsd: 400 });
    const reversed = await disputed();
    await rule(reversed, senior, 'refund-to-seller');
    const items = (await myPay(senior)).unpaid.items.map((i) => [i.kind, i.code, i.usdCents, i.atomic]);
    expect(items).toEqual(expect.arrayContaining([
      ['dispute', large, '800', null],
      ['large-trade', large, null, (FEE / 10n).toString()],
      ['dispute', small, '800', null],
      ['dispute', reversed, '800', null],
    ]));
    expect(items).toHaveLength(4);
    await setPay(UNSET);
  });

  it('amounts not set: the dispute is recorded with no amount; the owner deciding earns nothing', async () => {
    const mod = await member('mod');
    const code = await disputed();
    await rule(code, mod);
    expect((await myPay(mod)).unpaid).toEqual({ items: [expect.objectContaining({ kind: 'dispute', code, usdCents: null })], usdCents: '0', atomic: '0' });
    const byOwner = await disputed();
    await rule(byOwner, { id: ownerId, role: 'owner' });
    const { rows } = await deps.db.query('select 1 from staff_pay_items where trade_code = $1', [byOwner]);
    expect(rows).toHaveLength(0);
  });
});

describe('clock-out (D-041, D-045)', () => {
  it('shows the total, pays it to a chosen pre-approved address, ends the session and the shift; the next clock-out has nothing left', async () => {
    await setPay({ modDisputeUsdCents: 3300, seniorDisputeUsdCents: 800, seniorLargeTradeBp: null, largeTradeThresholdUsd: null });
    const mod = await member('mod');
    const a1 = await addAddress(mod);
    const a2 = await addAddress(mod);
    for (let i = 0; i < 2; i++) await rule(await disputed(), mod);
    await setPay(UNSET);

    const preview = await mod.b.get('/staff/v1/pay/clock-out');
    expect(preview.statusCode, preview.body).toBe(200);
    // 2 x $33.00 at $330.00 = 0.2 XMR.
    expect(preview.json()).toMatchObject({
      due: 'pay', disputes: 2, clawbacks: 0, usdCents: '6600', atomic: '0', usdCentsPerXmr: USD_PER_XMR.toString(),
      amountAtomic: (XMR / 5n).toString(),
    });
    // Added in the same instant: in either order.
    expect((preview.json() as { addresses: Array<{ id: string }> }).addresses.map((a) => a.id).sort()).toEqual([a1, a2].sort());

    expect(errorOf(await clockOut(mod))).toBe('address-required');
    const senior = await member('senior');
    const theirs = await addAddress(senior);
    expect(errorOf(await clockOut(mod, theirs))).toBe('address-unknown');
    expect(errorOf(await clockOut(mod, 'nope'))).toBe('bad-request');

    const before = (await logEntries(deps, 'pay.paid')).length;
    const res = await clockOut(mod, a2);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ due: 'pay', payout: { amountAtomic: (XMR / 5n).toString(), addressId: a2, status: 'waiting-send' } });
    expect((await logEntries(deps, 'pay.paid')).length).toBe(before + 1);
    // The session is over: a clock-out logs out.
    expect((await mod.b.get('/staff/v1/me')).statusCode).toBe(401);

    await mod.login();
    const v = await myPay(mod);
    expect(v.unpaid.items).toEqual([]);
    expect(v.payouts).toEqual([expect.objectContaining({ amountAtomic: (XMR / 5n).toString(), usdCents: '6600', atomic: '0', status: 'waiting-send', addressId: a2 })]);
    expect(v.shifts[1]).toMatchObject({ ended: 'clock-out' });
    expect(v.shifts[0]).toMatchObject({ ended: null, endedAt: null });

    const again = await clockOut(mod, a2);
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json()).toEqual({ due: 'nothing-due', payout: null });
  });

  it('closing the app or logging out is no clock-out: nothing is paid, and the next correct clock-out pays everything since the last paid one', async () => {
    await setPay({ modDisputeUsdCents: 1000, seniorDisputeUsdCents: null, seniorLargeTradeBp: null, largeTradeThresholdUsd: null });
    const mod = await member('mod');
    const addr = await addAddress(mod);
    await rule(await disputed(), mod);
    // Day 1: logs out without clocking out.
    expect((await mod.b.post('/staff/v1/logout')).statusCode).toBe(200);
    // Day 2: another login, another dispute; the session runs out (closing the app).
    later(24 * H);
    await mod.login();
    await rule(await disputed(), mod);
    later(3 * H);
    // Day 3: logs in and clocks out correctly.
    later(21 * H);
    await mod.login();
    expect((await deps.db.query('select 1 from staff_payouts where staff_id = $1', [mod.id])).rows).toHaveLength(0);
    const res = await clockOut(mod, addr);
    expect(res.json()).toMatchObject({ due: 'pay', payout: { amountAtomic: ((2000n * XMR) / USD_PER_XMR).toString() } });
    await mod.login();
    const shifts = (await myPay(mod)).shifts;
    expect(shifts.map((s) => s.ended)).toEqual([null, 'clock-out', 'auto-logout', 'ended']);
    // The automatic logout is recorded at the session's end (2 hours idle).
    expect(shifts[2]!.endedAt).not.toBeNull();
    await setPay(UNSET);
  });

  it('an automatic logout at the end of the login hours is recorded as information and pays nothing', async () => {
    const mod = await member('mod');
    const before = (await logEntries(deps, 'shift.abandoned')).length;
    expect(await endSessionForHours({ db: deps.db, clock: deps.clock, events: app.events }, mod.sessionId, mod.id)).toBe(true);
    const { rows } = await deps.db.query<{ ended: string }>('select ended from staff_shifts where session_id = $1', [mod.sessionId]);
    expect(rows).toEqual([{ ended: 'auto-logout' }]);
    expect((await logEntries(deps, 'shift.abandoned')).slice(before).map((r) => JSON.parse(r.detail) as unknown)).toEqual([
      expect.objectContaining({ ended: 'auto-logout' }),
    ]);
  });

  it('with no price to convert, the clock-out still ends the shift; the pay waits for the next clock-out', async () => {
    await setPay({ modDisputeUsdCents: 1000, seniorDisputeUsdCents: null, seniorLargeTradeBp: null, largeTradeThresholdUsd: null });
    const mod = await member('mod');
    const addr = await addAddress(mod);
    await rule(await disputed(), mod);
    priceOn = false;
    try {
      expect((await mod.b.get('/staff/v1/pay/clock-out')).json()).toMatchObject({ due: 'no-price', amountAtomic: null });
      const res = await clockOut(mod, addr);
      expect(res.json()).toEqual({ due: 'no-price', payout: null });
      expect((await mod.b.get('/staff/v1/me')).statusCode).toBe(401);
    } finally {
      priceOn = true;
    }
    await mod.login();
    expect((await myPay(mod)).unpaid.usdCents).toBe('1000');
    await setPay(UNSET);
  });
});

describe('clawback option A (D-044)', () => {
  it('an overruled decision claws back the dispute pay and the share from future pay; a larger debt carries over; "Decision stands" changes nothing', async () => {
    await setPay({ modDisputeUsdCents: 1000, seniorDisputeUsdCents: 3300, seniorLargeTradeBp: 1000, largeTradeThresholdUsd: 400 });
    const senior = await member('senior');
    const reviewer = await member('senior');
    const addr = await addAddress(senior);
    const overruled = await disputed();
    await rule(overruled, senior);
    const stands = await disputed();
    await rule(stands, senior);
    // Paid at clock-out, never held for the appeal window.
    const first = await clockOut(senior, addr);
    // 2 x $33.00 = 0.2 XMR plus 2 shares of 0.00125 XMR.
    expect(first.json()).toMatchObject({ due: 'pay', payout: { amountAtomic: (XMR / 5n + FEE / 5n).toString() } });

    const before = (await logEntries(deps, 'pay.clawback')).length;
    await decideAppeal(overruled, reviewer, 'refund-to-seller');
    await decideAppeal(stands, reviewer, 'release-to-buyer');
    expect((await logEntries(deps, 'pay.clawback')).length - before).toBe(2);
    await senior.login();
    const v = await myPay(senior);
    expect(v.unpaid.items.map((i) => [i.kind, i.code, i.usdCents, i.atomic])).toEqual(expect.arrayContaining([
      ['clawback', overruled, '-3300', null],
      ['clawback', overruled, null, (-(FEE / 10n)).toString()],
    ]));
    expect(v.unpaid.items).toHaveLength(2);
    // The appeal reviewer earns nothing for round 2 (owner question).
    expect((await myPay(reviewer)).unpaid.items).toEqual([]);

    // The debt is bigger than nothing earned since: owed, no payout, carried over.
    expect((await senior.b.get('/staff/v1/pay/clock-out')).json()).toMatchObject({ due: 'owed', clawbacks: 2 });
    expect((await clockOut(senior, addr)).json()).toEqual({ due: 'owed', payout: null });
    await senior.login();
    // One more dispute ($33.00) is taken net of the clawback ($33.00 + 0.00125 XMR): still owed.
    await setPay({ modDisputeUsdCents: 1000, seniorDisputeUsdCents: 3300, seniorLargeTradeBp: 1000, largeTradeThresholdUsd: 1000 });
    await rule(await disputed(), senior);
    expect((await senior.b.get('/staff/v1/pay/clock-out')).json()).toMatchObject({ due: 'owed', amountAtomic: (-(FEE / 10n)).toString() });
    // A second one pays the rest: 0.1 XMR - 0.00125 XMR.
    await rule(await disputed(), senior);
    const paid = await clockOut(senior, addr);
    expect(paid.json()).toMatchObject({ due: 'pay', payout: { amountAtomic: (XMR / 10n - FEE / 10n).toString() } });
    await setPay(UNSET);
  });

  it('what a member owes stays recorded when they leave, and the owner sees it', async () => {
    await setPay({ modDisputeUsdCents: 2000, seniorDisputeUsdCents: null, seniorLargeTradeBp: null, largeTradeThresholdUsd: null });
    const mod = await member('mod');
    const reviewer = await member('senior');
    const addr = await addAddress(mod);
    const code = await disputed();
    await rule(code, mod);
    await clockOut(mod, addr);
    await decideAppeal(code, reviewer, 'refund-to-seller');
    await deps.db.query('update staff_members set switched_off_at = $2 where account_id = $1', [mod.id, deps.clock()]);
    await ownerLogin();
    const res = await owner.get('/staff/v1/pay/staff');
    expect(res.statusCode, res.body).toBe(200);
    const row = (res.json() as { members: Array<{ staffId: string; owed: boolean; unpaidUsdCents: string; switchedOff: boolean }> }).members.find((x) => x.staffId === mod.id);
    expect(row).toEqual(expect.objectContaining({ owed: true, unpaidUsdCents: '-2000', switchedOff: true }));
    // Only the owner reads it.
    expect((await reviewer.b.get('/staff/v1/pay/staff')).statusCode).toBe(403);
    await setPay(UNSET);
  });
});

describe('the pay ledger is settle-only', () => {
  it('an item can be settled once but never changed or deleted', async () => {
    await setPay({ modDisputeUsdCents: 700, seniorDisputeUsdCents: null, seniorLargeTradeBp: null, largeTradeThresholdUsd: null });
    const mod = await member('mod');
    const code = await disputed();
    await rule(code, mod);
    await setPay(UNSET);
    await expect(deps.db.query('update staff_pay_items set usd_cents = 1 where trade_code = $1', [code])).rejects.toThrow(/settled/);
    await expect(deps.db.query('delete from staff_pay_items where trade_code = $1', [code])).rejects.toThrow(/settled/);
  });
});

describe('the two new tap intents', () => {
  it('payout-address is one\'s own (self) and names exactly one address; pay-settings is the owner\'s (settings.write) with whole numbers or null', () => {
    const address = fakeAddress();
    expect(parseKeyTapIntent({ kind: 'payout-address', address })).toEqual({ kind: 'payout-address', address });
    expect(tapPermOf({ kind: 'payout-address', address })).toBe('self');
    for (const bad of [{ kind: 'payout-address' }, { kind: 'payout-address', address: 'short' }, { kind: 'payout-address', address, extra: 1 }]) {
      expect(() => parseKeyTapIntent(bad), JSON.stringify(bad)).toThrow();
    }
    const v = { kind: 'pay-settings', modDisputeUsdCents: 500, seniorDisputeUsdCents: null, seniorLargeTradeBp: 1000, largeTradeThresholdUsd: null } as const;
    expect(parseKeyTapIntent(v)).toEqual(v);
    expect(tapPermOf(v)).toBe('settings.write');
    for (const bad of [{ ...v, modDisputeUsdCents: 1.5 }, { ...v, modDisputeUsdCents: -1 }, { ...v, seniorLargeTradeBp: '1000' }, { kind: 'pay-settings', modDisputeUsdCents: 1 }]) {
      expect(() => parseKeyTapIntent(bad), JSON.stringify(bad)).toThrow();
    }
  });
});

describe('TRIPWIRE NEEDS_PLAN_6_PAYROLL_WALLET', () => {
  it('a recorded payout moves nothing until Plan 6 wires a payroll wallet, and nothing starts the send', async () => {
    // When Plan 6 lands: wire sendStaffPayout to the payroll wallet (see its comment), run it for
    // every `waiting-send` payout, and delete this test.
    const err = await sendStaffPayout({ address: fakeAddress(), amountAtomic: XMR }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayrollWalletNotWiredError);
    expect((err as PayrollWalletNotWiredError).code).toBe(NEEDS_PLAN_6_PAYROLL_WALLET);
    const main = readFileSync(fileURLToPath(new URL('../../src/main.ts', import.meta.url)), 'utf8');
    expect(main.includes('sendStaffPayout'), 'main.ts sends staff pay: Plan 6 landed? see this test').toBe(false);
  });
});

// Keep the type import used (the intent shapes the taps above are bound to).
export type { KeyTapIntent };
