// Owner decision (Jess, 26 Nov 2026), "Pool first, auto-assign if untaken": the timer's assignment
// follows the machine's own `assign` rules, read as the person taking the case themselves.
import { describe, expect, test } from 'vitest';
import { DisputeRuleError, applyDispute, autoAssignDispute, mayAutoAssign, newDispute, type Actor, type Dispute } from '@x2f/staff';

const H = 3_600_000;
const T0 = new Date('2027-02-01T10:00:00.000Z');
const at = (h: number) => new Date(T0.getTime() + h * H);
const S = { appealWindowH: 48, firstResponseH: 4 };
const G = { usdCents: 41_250n, limitUsdCents: 100_000n };

const mod = { id: 'mod-1', role: 'mod' as const };
const mod2 = { id: 'mod-2', role: 'mod' as const };
const senior = { id: 'senior-1', role: 'senior' as const };
const senior2 = { id: 'senior-2', role: 'senior' as const };
const owner = { id: 'owner-1', role: 'owner' as const };
const helper = { id: 'helper-1', role: 'helper' as const };
const staff = (p: { id: string; role: 'mod' | 'senior' | 'owner' }): Actor => ({ kind: 'staff', ...p });

const open = (): Dispute => newDispute({ code: 'C1', openedBy: 'buyer', afterRefund: false, usdCents: 41_250n, limitUsdCents: 100_000n, firstResponseH: 4, now: T0 });

/** Round 1 taken and published by `mod`, then appealed by the seller. */
function appealed(): Dispute {
  let d = applyDispute(open(), { type: 'assign', staffId: mod.id, role: 'mod' }, staff(mod), at(1), S);
  d = applyDispute(d, { type: 'propose', ruling: { id: 'r1', outcome: 'release-to-buyer', accountAction: { kind: 'none' }, proposer: mod.id }, gate: G }, staff(mod), at(2), S);
  return applyDispute(d, { type: 'appeal', involved: [mod.id] }, { kind: 'trader', side: 'seller' }, at(3), S);
}

describe('autoAssignDispute', () => {
  test('assigns an open, unassigned case to a moderator, senior or the owner, and marks them seen', () => {
    for (const p of [mod, senior, owner]) {
      const d = autoAssignDispute(open(), p, at(1), S);
      expect(d.assignee).toBe(p.id);
      expect(d.seen).toEqual([p.id]);
    }
  });

  test('never a role that may not handle disputes (a helper)', () => {
    expect(() => autoAssignDispute(open(), helper, at(1), S)).toThrow(DisputeRuleError);
    expect(mayAutoAssign(open(), helper, at(1), S)).toBe(false);
  });

  test('never a case already assigned, even to a senior or the owner (the timer never reassigns)', () => {
    const taken = applyDispute(open(), { type: 'assign', staffId: mod.id, role: 'mod' }, staff(mod), at(1), S);
    for (const p of [mod2, senior, owner]) {
      expect(() => autoAssignDispute(taken, p, at(2), S)).toThrowError(expect.objectContaining({ code: 'wrong-state' }));
    }
  });

  test('never a case past waiting for a moderator (awaiting approval, published, closed)', () => {
    let d = autoAssignDispute(open(), mod, at(1), S);
    d = applyDispute(d, { type: 'propose', ruling: { id: 'r1', outcome: 'release-to-buyer', accountAction: { kind: 'none' }, proposer: mod.id }, gate: G }, staff(mod), at(2), S);
    expect(d.status).toBe('published');
    expect(mayAutoAssign({ ...d, assignee: null }, senior, at(3), S)).toBe(false);
  });

  test('an appeal: only a senior or the owner who had no part in round 1', () => {
    const d = appealed();
    expect(d.assignee).toBeNull();
    expect(mayAutoAssign(d, mod2, at(4), S)).toBe(false);
    expect(mayAutoAssign(d, mod, at(4), S)).toBe(false);
    expect(autoAssignDispute(d, senior, at(4), S).assignee).toBe(senior.id);
    // Involved in round 1 (any log entry): refused.
    const involved = { ...d, round1: { ...d.round1!, involved: [...d.round1!.involved, senior.id] } };
    expect(() => autoAssignDispute(involved, senior, at(4), S)).toThrowError(expect.objectContaining({ code: 'not-eligible' }));
    expect(autoAssignDispute(involved, senior2, at(4), S).assignee).toBe(senior2.id);
  });

  test("an appeal: round 1's proposer and approver are refused by name, even if missing from `involved`", () => {
    const d = appealed();
    const odd = { ...d, round1: { ...d.round1!, proposer: senior.id, approver: owner.id, involved: [] } };
    expect(() => autoAssignDispute(odd, senior, at(4), S)).toThrowError(expect.objectContaining({ code: 'not-eligible' }));
    expect(() => autoAssignDispute(odd, owner, at(4), S)).toThrowError(expect.objectContaining({ code: 'not-eligible' }));
    expect(mayAutoAssign(odd, senior2, at(4), S)).toBe(true);
  });

  test('does not change its input', () => {
    const d = open();
    autoAssignDispute(d, mod, at(1), S);
    expect(d.assignee).toBeNull();
    expect(d.seen).toEqual([]);
  });
});
