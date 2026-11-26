// Owner 26 Nov 2026: the hot payroll wallet pays staff automatically at clock-out. Each recorded
// `waiting-send` payout is sent once: the attempt is committed `pending` before the wallet is asked,
// then settled `sent`, `refused` (retried later), `unknown` (never retried) or `blocked` (the
// address no longer matches its key tap). Real Postgres; the wallet is a stub.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../../src/app.js';
import { PayrollWalletRefused, type PayrollWallet } from '../../src/staff/payrollWallet.js';
import { addressStillApproved, runPayrollPayouts } from '../../src/staff/payrollSend.js';
import { logEntries, seedStaff, seedTap, staffApps } from '../helpers/staffApp.js';
import { fakeAddress, XMR } from '../helpers/trades.js';

const T0 = new Date('2026-11-26T10:00:00Z');

let deps: Deps;
let setNow: (d: Date) => void;
let close: () => Promise<void>;
let ownerId: string;

beforeAll(async () => {
  ({ deps, setNow, close } = await staffApps());
  setNow(T0);
  ownerId = (await seedStaff(deps, { role: 'owner' })).id;
});
afterAll(async () => close());

beforeEach(async () => {
  // Every earlier payout settled, so each test sees only its own.
  await deps.db.query(`update staff_payouts set status = 'failed', settled_at = $1 where status = 'waiting-send'`, [T0]);
});

/** A member's approved payout address (its tap used, for exactly it) and one `waiting-send` payout to it. */
async function payout(o: { amount?: bigint; tapFor?: 'self' | 'other'; tapAddress?: string; at?: Date } = {}): Promise<{ id: string; staffId: string; address: string; addressId: string }> {
  const staffId = (await seedStaff(deps, { role: 'mod' })).id;
  const address = fakeAddress();
  const tapAccount = o.tapFor === 'other' ? (await seedStaff(deps, { role: 'mod' })).id : staffId;
  const tapId = await seedTap(deps, tapAccount, { kind: 'payout-address', address: o.tapAddress ?? address });
  await deps.db.query('update key_taps set used_at = $2 where id = $1', [tapId, T0]);
  const a = await deps.db.query<{ id: string }>(
    'insert into staff_payout_addresses (staff_id, address, added_at, tap_id) values ($1, $2, $3, $4) returning id::text', [staffId, address, T0, tapId],
  );
  const amount = o.amount ?? XMR / 10n;
  const p = await deps.db.query<{ id: string }>(
    `insert into staff_payouts (staff_id, at, address_id, usd_cents, atomic, amount_atomic) values ($1, $2, $3, 0, $4, $4) returning id::text`,
    [staffId, o.at ?? T0, a.rows[0]!.id, amount.toString()],
  );
  return { id: p.rows[0]!.id, staffId, address, addressId: a.rows[0]!.id };
}

type Transfer = Parameters<PayrollWallet['transfer']>[0];
function wallet(answer: (a: Transfer, n: number) => Promise<{ txHash: string; feeAtomic: bigint | null }>): PayrollWallet & { calls: Transfer[] } {
  const calls: Transfer[] = [];
  return {
    calls,
    unlockedAtomic: async () => 0n,
    primaryAddress: async () => '',
    transfer: async (a) => (calls.push(a), answer(a, calls.length)),
  };
}
const hash = (n: number) => n.toString(16).padStart(2, '0').repeat(32);
const status = async (id: string) => (await deps.db.query<{ status: string; tx_hash: string | null }>('select status, tx_hash from staff_payouts where id = $1', [id])).rows[0];
const attempts = async (id: string) =>
  (await deps.db.query<{ outcome: string; tx_hash: string | null; fee: string | null }>('select outcome, tx_hash, network_fee_atomic::text as fee from staff_payout_sends where payout_id = $1 order by id', [id])).rows;
const ownerAlerts = async (kind: string) =>
  (await deps.db.query<{ detail: Record<string, unknown> }>('select detail from alerts where account_id = $1 and kind = $2 order by created_at', [ownerId, kind])).rows.map((r) => r.detail);

describe('addressStillApproved (security review 12 Nov M2)', () => {
  const ok = { staff_id: 's', address: 'A', removed_at: null, tap_account: 's', tap_used: true, tap_intent: JSON.stringify({ kind: 'payout-address', address: 'A' }) };
  it('only a live address whose used tap was the member\'s own, for exactly it', () => {
    expect(addressStillApproved(ok)).toBe(true);
    expect(addressStillApproved({ ...ok, removed_at: T0 })).toBe(false);
    expect(addressStillApproved({ ...ok, tap_account: 'x' })).toBe(false);
    expect(addressStillApproved({ ...ok, tap_account: null })).toBe(false);
    expect(addressStillApproved({ ...ok, tap_used: false })).toBe(false);
    expect(addressStillApproved({ ...ok, tap_intent: JSON.stringify({ kind: 'payout-address', address: 'B' }) })).toBe(false);
    expect(addressStillApproved({ ...ok, tap_intent: JSON.stringify({ kind: 'fee-sweep', address: 'A' }) })).toBe(false);
    expect(addressStillApproved({ ...ok, tap_intent: 'not json' })).toBe(false);
    expect(addressStillApproved({ ...ok, tap_intent: JSON.stringify(['A']) })).toBe(false);
  });
});

describe('runPayrollPayouts', () => {
  it('sends exactly the recorded amount to the approved address, the fee on top; the attempt is pending during the send', async () => {
    const p = await payout({ amount: 123_456_789n });
    const seen: unknown[] = [];
    const w = wallet(async () => {
      seen.push(...(await attempts(p.id)).map((r) => r.outcome));
      return { txHash: hash(1), feeAtomic: 40_000_000n };
    });
    expect(await runPayrollPayouts({ db: deps.db, clock: deps.clock, wallet: w })).toEqual({ outcome: 'done', sends: [{ payoutId: p.id, outcome: 'sent' }] });
    expect(w.calls).toEqual([{ address: p.address, amountAtomic: 123_456_789n, feeFromAmount: false }]);
    expect(seen).toEqual(['pending']);
    expect(await status(p.id)).toEqual({ status: 'sent', tx_hash: hash(1) });
    expect(await attempts(p.id)).toEqual([{ outcome: 'sent', tx_hash: hash(1), fee: '40000000' }]);
    expect((await logEntries(deps, 'pay.sent')).map((r) => JSON.parse(r.detail) as unknown).at(-1)).toEqual({ ref: p.id, atomic: '123456789', txHash: hash(1) });
    // Never sent twice.
    expect(await runPayrollPayouts({ db: deps.db, clock: deps.clock, wallet: w })).toEqual({ outcome: 'done', sends: [] });
    expect(w.calls).toHaveLength(1);
  });

  it('a refusal leaves the payout waiting, alerts the owner once, stops the pass; a later pass sends it', async () => {
    const a = await payout({ at: new Date(T0.getTime() - 2_000) });
    const b = await payout({ at: new Date(T0.getTime() - 1_000) });
    const before = (await ownerAlerts('payroll-send-refused')).length;
    const pushed: string[] = [];
    const push = { send: async (id: string) => (pushed.push(id), true) };
    const refusing = wallet(async () => { throw new PayrollWalletRefused(-38, 'not enough unlocked money'); });
    expect(await runPayrollPayouts({ db: deps.db, clock: deps.clock, wallet: refusing, push })).toEqual({ outcome: 'done', sends: [{ payoutId: a.id, outcome: 'refused' }] });
    expect(refusing.calls).toHaveLength(1);
    expect(await status(a.id)).toEqual({ status: 'waiting-send', tx_hash: null });
    expect(await ownerAlerts('payroll-send-refused')).toHaveLength(before + 1);
    expect(pushed).toEqual([ownerId]);
    // Refused again: no second alert for the same payout.
    await runPayrollPayouts({ db: deps.db, clock: deps.clock, wallet: refusing, push });
    expect(await ownerAlerts('payroll-send-refused')).toHaveLength(before + 1);
    expect(pushed).toEqual([ownerId]);
    const paying = wallet(async (_a, n) => ({ txHash: hash(10 + n), feeAtomic: null }));
    expect((await runPayrollPayouts({ db: deps.db, clock: deps.clock, wallet: paying })).sends).toEqual([{ payoutId: a.id, outcome: 'sent' }, { payoutId: b.id, outcome: 'sent' }]);
    expect(await attempts(a.id)).toEqual([{ outcome: 'refused', tx_hash: null, fee: null }, { outcome: 'refused', tx_hash: null, fee: null }, { outcome: 'sent', tx_hash: hash(11), fee: null }]);
  });

  it('no answer (or no proper tx hash): unknown, the owner is alerted, the payout is never sent again by itself', async () => {
    const p = await payout();
    const before = (await ownerAlerts('payroll-send-unknown')).length;
    const timeout = wallet(async () => { throw new Error('The operation was aborted due to timeout'); });
    expect((await runPayrollPayouts({ db: deps.db, clock: deps.clock, wallet: timeout })).sends).toEqual([{ payoutId: p.id, outcome: 'unknown' }]);
    expect(await ownerAlerts('payroll-send-unknown')).toHaveLength(before + 1);
    const paying = wallet(async () => ({ txHash: hash(2), feeAtomic: null }));
    expect((await runPayrollPayouts({ db: deps.db, clock: deps.clock, wallet: paying })).sends).toEqual([]);
    expect(paying.calls).toEqual([]);
    expect(await status(p.id)).toEqual({ status: 'waiting-send', tx_hash: null });

    const q = await payout();
    const junk = wallet(async () => ({ txHash: 'nope', feeAtomic: null }));
    expect((await runPayrollPayouts({ db: deps.db, clock: deps.clock, wallet: junk })).sends).toEqual([{ payoutId: q.id, outcome: 'unknown' }]);
  });

  it('an address that no longer matches its tap, or was removed, is blocked: nothing is sent, the payout fails', async () => {
    const otherTap = await payout({ tapFor: 'other', at: new Date(T0.getTime() - 3_000) });
    const wrongAddress = await payout({ tapAddress: fakeAddress(), at: new Date(T0.getTime() - 2_000) });
    const removed = await payout({ at: new Date(T0.getTime() - 1_000) });
    await deps.db.query('update staff_payout_addresses set removed_at = $2 where id = $1', [removed.addressId, T0]);
    const w = wallet(async () => ({ txHash: hash(3), feeAtomic: null }));
    expect((await runPayrollPayouts({ db: deps.db, clock: deps.clock, wallet: w })).sends).toEqual([
      { payoutId: otherTap.id, outcome: 'blocked' },
      { payoutId: wrongAddress.id, outcome: 'blocked' },
      { payoutId: removed.id, outcome: 'blocked' },
    ]);
    expect(w.calls).toEqual([]);
    for (const p of [otherTap, wrongAddress, removed]) {
      expect(await status(p.id)).toEqual({ status: 'failed', tx_hash: null });
      expect(await attempts(p.id)).toEqual([{ outcome: 'blocked', tx_hash: null, fee: null }]);
    }
    expect((await ownerAlerts('payroll-send-blocked')).length).toBeGreaterThanOrEqual(3);
  });

  it('an attempt left pending by a process that died mid-send is settled unknown and never sent', async () => {
    const p = await payout();
    await deps.db.query(`insert into staff_payout_sends (payout_id, started_at, outcome) values ($1, $2, 'pending')`, [p.id, T0]);
    const before = (await ownerAlerts('payroll-send-unknown')).length;
    const w = wallet(async () => ({ txHash: hash(4), feeAtomic: null }));
    expect(await runPayrollPayouts({ db: deps.db, clock: deps.clock, wallet: w })).toEqual({ outcome: 'done', sends: [] });
    expect(w.calls).toEqual([]);
    expect(await attempts(p.id)).toEqual([{ outcome: 'unknown', tx_hash: null, fee: null }]);
    expect(await ownerAlerts('payroll-send-unknown')).toHaveLength(before + 1);
  });

  it('a second pass while one runs is busy and sends nothing', async () => {
    await payout();
    let inner: unknown;
    const w = wallet(async () => {
      inner = await runPayrollPayouts({ db: deps.db, clock: deps.clock, wallet: wallet(async () => { throw new Error('the second pass must not send'); }) });
      return { txHash: hash(5), feeAtomic: null };
    });
    expect((await runPayrollPayouts({ db: deps.db, clock: deps.clock, wallet: w })).outcome).toBe('done');
    expect(inner).toEqual({ outcome: 'busy', sends: [] });
  });

  it('the attempts table allows one live attempt per payout, settles once and is never deleted', async () => {
    const p = await payout();
    await deps.db.query(`insert into staff_payout_sends (payout_id, started_at, outcome) values ($1, $2, 'pending')`, [p.id, T0]);
    await expect(deps.db.query(`insert into staff_payout_sends (payout_id, started_at, outcome) values ($1, $2, 'pending')`, [p.id, T0])).rejects.toThrow(/staff_payout_sends_once/);
    await deps.db.query(`update staff_payout_sends set outcome = 'unknown', settled_at = $2 where payout_id = $1`, [p.id, T0]);
    await expect(deps.db.query(`update staff_payout_sends set outcome = 'refused' where payout_id = $1`, [p.id])).rejects.toThrow(/settles once/);
    await expect(deps.db.query(`delete from staff_payout_sends where payout_id = $1`, [p.id])).rejects.toThrow(/settles once/);
  });
});
