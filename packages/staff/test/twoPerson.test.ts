// Review p4t22 M1 (security review of the dispute system, 23 Nov): the API's two-person rule must
// never be laxer than the moderation ruling gate's, or a published ruling is refused for good
// (`needs-second`) and the escrow coins are stranded. One rule, one value, one rounding; and a
// rescue for a ruling already published on one tap.
import { describe, expect, test } from 'vitest';
import {
  DisputeRuleError,
  applyDispute,
  gateUsdCents,
  limitUsdCentsOf,
  needsSecond,
  newDispute,
  twoPersonRule,
  type Actor,
  type Dispute,
  type GateValue,
} from '@x2f/staff';

const H = 3_600_000;
const T0 = new Date('2027-02-01T10:00:00.000Z');
const at = (h: number) => new Date(T0.getTime() + h * H);
const S = { appealWindowH: 48, firstResponseH: 4 };
const NONE = { kind: 'none' } as const;
const mod: Actor = { kind: 'staff', id: 'mod-1', role: 'mod' };
const mod2: Actor = { kind: 'staff', id: 'mod-2', role: 'mod' };
const senior: Actor = { kind: 'staff', id: 'senior-1', role: 'senior' };
const senior2: Actor = { kind: 'staff', id: 'senior-2', role: 'senior' };
const owner: Actor = { kind: 'staff', id: 'owner-1', role: 'owner' };
const system: Actor = { kind: 'system' };
const LIMIT = 100_000n;
const UNDER: GateValue = { usdCents: 41_250n, limitUsdCents: LIMIT };
const EUR: GateValue = { usdCents: null, limitUsdCents: LIMIT };

function rule(code: DisputeRuleError['code'], f: () => unknown) {
  try {
    f();
  } catch (e) {
    expect(e).toBeInstanceOf(DisputeRuleError);
    expect((e as DisputeRuleError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
}

const base = (usdCents = 41_250n): Dispute =>
  newDispute({ code: 'K7M2-9QXA-4FTR-8WPN', openedBy: 'buyer', afterRefund: false, usdCents, limitUsdCents: LIMIT, firstResponseH: 4, now: T0 });

function proposed(gate: GateValue, d = base()): Dispute {
  d = applyDispute(d, { type: 'assign', staffId: 'mod-1', role: 'mod' }, mod, at(1), S);
  return applyDispute(d, { type: 'propose', gate, ruling: { id: 'r1', outcome: 'release-to-buyer', accountAction: NONE, proposer: 'mod-1' } }, mod, at(2), S);
}

describe("the gate's value of a trade", () => {
  test('a USD deal: XMR times the locked rate, rounded up; any other currency has none', () => {
    // 3,030,281,818,181 atomic at $330.00: 99,999.299999973 cents. Half-up gives 99,999 (one person);
    // the gate rounds up to 100,000 (two). Both sides now use the gate's figure.
    expect(gateUsdCents({ currency: 'USD', amountAtomic: 3_030_281_818_181n, centsPerXmr: 33_000n })).toBe(100_000n);
    expect(gateUsdCents({ currency: 'USD', amountAtomic: 1_250_000_000_000n, centsPerXmr: 33_000n })).toBe(41_250n);
    expect(gateUsdCents({ currency: 'EUR', amountAtomic: 1_250_000_000_000n, centsPerXmr: 30_000n })).toBeNull();
  });
  test('the limit in cents, the same way on both sides', () => {
    expect(limitUsdCentsOf(1000)).toBe(100_000n);
    expect(limitUsdCentsOf(999.995)).toBe(100_000n);
    expect(() => limitUsdCentsOf(Number.NaN)).toThrow(RangeError);
  });
  test('twoPersonRule: no value of its own, at or above the limit, or any account action', () => {
    expect(twoPersonRule(EUR, NONE)).toBe(true);
    expect(twoPersonRule({ usdCents: LIMIT, limitUsdCents: LIMIT }, NONE)).toBe(true);
    expect(twoPersonRule({ usdCents: LIMIT - 1n, limitUsdCents: LIMIT }, NONE)).toBe(false);
    expect(twoPersonRule(UNDER, { kind: 'trade-ban', until: null, reasonCode: 'terms' })).toBe(true);
  });
});

describe('needsSecond follows the gate (lead default, owner question OQ1)', () => {
  test('a non-USD trade under the limit needs a second person', () => {
    // The probe: EUR 50 valued at the market quote is far under the snapshot limit.
    expect(needsSecond(base(5_500n), 'release-to-buyer', NONE, EUR)).toBe(true);
  });
  test('a limit lowered after the dispute opened applies (the gate applies its current limit)', () => {
    expect(needsSecond(base(), 'release-to-buyer', NONE, { usdCents: 41_250n, limitUsdCents: 40_000n })).toBe(true);
  });
  test('a limit raised after opening does not lift the snapshot rule', () => {
    expect(needsSecond(base(150_000n), 'release-to-buyer', NONE, { usdCents: 150_000n, limitUsdCents: 200_000n })).toBe(true);
  });
  test('a USD trade under both limits needs one person', () => {
    expect(needsSecond(base(), 'release-to-buyer', NONE, UNDER)).toBe(false);
  });
  test('propose: a EUR trade under the limit waits for approval instead of publishing', () => {
    const d = proposed(EUR, base(5_500n));
    expect(d.status).toBe('awaiting-approval');
    expect(d.ruling?.needsSecond).toBe(true);
  });
  test('propose without the gate inputs fails closed (throws, writes nothing)', () => {
    let d = base();
    d = applyDispute(d, { type: 'assign', staffId: 'mod-1', role: 'mod' }, mod, at(1), S);
    const e = { type: 'propose', ruling: { id: 'r1', outcome: 'release-to-buyer', accountAction: NONE, proposer: 'mod-1' } } as never;
    expect(() => applyDispute(d, e, mod, at(2), S)).toThrow(TypeError);
  });
});

describe('the rescue: a second approval on a ruling published on one tap (M1 e)', () => {
  test('a senior adds it to a published round 1; nothing else changes', () => {
    const d = proposed(UNDER);
    expect(d.status).toBe('published');
    const next = applyDispute(d, { type: 'second-approve' }, senior, at(3), S);
    expect(next.ruling).toEqual({ ...d.ruling, approver: 'senior-1', needsSecond: true });
    expect(next.status).toBe('published');
    expect(next.appealEndsAt).toEqual(d.appealEndsAt);
    expect(next.publishedAt).toEqual(d.publishedAt);
    expect(next.seen).toContain('senior-1');
  });
  test('also once final, until the payout ran', () => {
    let d = proposed(UNDER);
    d = applyDispute(d, { type: 'window-closed' }, system, at(51), S);
    expect(d.status).toBe('final');
    expect(applyDispute(d, { type: 'second-approve' }, owner, at(52), S).ruling?.approver).toBe('owner-1');
    const paid = applyDispute(d, { type: 'executed', round: 1 }, system, at(52), S);
    rule('wrong-state', () => applyDispute(paid, { type: 'second-approve' }, owner, at(53), S));
  });
  test('never the proposer, never a moderator, never twice, never before publishing', () => {
    const d = proposed(UNDER);
    rule('wrong-party', () => applyDispute(d, { type: 'second-approve' }, mod2, at(3), S));
    let bySenior = applyDispute(base(), { type: 'assign', staffId: 'senior-1', role: 'senior' }, senior, at(1), S);
    bySenior = applyDispute(bySenior, { type: 'propose', gate: UNDER, ruling: { id: 'r1', outcome: 'release-to-buyer', accountAction: NONE, proposer: 'senior-1' } }, senior, at(2), S);
    rule('same-person', () => applyDispute(bySenior, { type: 'second-approve' }, senior, at(3), S));
    const once = applyDispute(d, { type: 'second-approve' }, senior, at(3), S);
    rule('wrong-state', () => applyDispute(once, { type: 'second-approve' }, senior2, at(4), S));
    const waiting = proposed(EUR, base(5_500n));
    rule('wrong-state', () => applyDispute(waiting, { type: 'second-approve' }, senior, at(3), S));
  });
  test("during an appeal: round 1's approver joins round 1's signers and stays out of the appeal", () => {
    let d = proposed(UNDER);
    d = applyDispute(d, { type: 'appeal', involved: ['mod-1'] }, { kind: 'trader', side: 'seller' }, at(3), S);
    d = applyDispute(d, { type: 'assign', staffId: 'senior-2', role: 'senior' }, senior2, at(4), S);
    rule('not-eligible', () => applyDispute(d, { type: 'second-approve' }, senior2, at(5), S));
    const next = applyDispute(d, { type: 'second-approve' }, senior, at(5), S);
    expect(next.round1?.approver).toBe('senior-1');
    expect(next.round1?.involved).toContain('senior-1');
    expect(next.ruling).toBeNull();
    expect(next.status).toBe('appealed');
    // The approver of round 1 can no longer take any part in the appeal.
    rule('not-eligible', () => applyDispute(next, { type: 'reply' }, senior, at(6), S));
  });
  test('an after-refund seller-sends-xmr ruling, final and complying, can get it too (its statement needs the gate)', () => {
    let d = newDispute({ code: 'K7M2-9QXA-4FTR-8WPN', openedBy: 'buyer', afterRefund: true, usdCents: 41_250n, limitUsdCents: LIMIT, firstResponseH: 4, now: T0 });
    d = applyDispute(d, { type: 'assign', staffId: 'mod-1', role: 'mod' }, mod, at(1), S);
    d = applyDispute(d, { type: 'propose', gate: UNDER, ruling: { id: 'r1', outcome: 'seller-sends-xmr', accountAction: NONE, proposer: 'mod-1' } }, mod, at(2), S);
    d = applyDispute(d, { type: 'window-closed' }, system, at(51), S);
    expect(d.status).toBe('complying');
    expect(applyDispute(d, { type: 'second-approve' }, senior, at(52), S).ruling?.approver).toBe('senior-1');
  });
});
