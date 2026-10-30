import { describe, expect, test } from 'vitest';
import {
  APPEAL_GOAL_H,
  COMPLY_H,
  DisputeRuleError,
  RULING_DEADLINE_H,
  RULING_GOAL_H,
  applyDispute,
  markSeen,
  needsSecond,
  newDispute,
  shiftDeadlines,
  type Actor,
  type Dispute,
  type DisputeEvent,
  type RulingDraft,
} from '@x2f/staff';

const H = 3_600_000;
const T0 = new Date('2027-02-01T10:00:00.000Z');
const at = (h: number, ms = 0) => new Date(T0.getTime() + h * H + ms);
const S = { appealWindowH: 48 };

const owner: Actor = { kind: 'staff', id: 'owner-1', role: 'owner' };
const senior: Actor = { kind: 'staff', id: 'senior-1', role: 'senior' };
const senior2: Actor = { kind: 'staff', id: 'senior-2', role: 'senior' };
const mod: Actor = { kind: 'staff', id: 'mod-1', role: 'mod' };
const mod2: Actor = { kind: 'staff', id: 'mod-2', role: 'mod' };
const helper: Actor = { kind: 'staff', id: 'helper-1', role: 'helper' };
const buyer: Actor = { kind: 'trader', side: 'buyer' };
const seller: Actor = { kind: 'trader', side: 'seller' };
const system: Actor = { kind: 'system' };

function base(o: Partial<Parameters<typeof newDispute>[0]> = {}): Dispute {
  return newDispute({
    code: 'K7M2-9QXA-4FTR-8WPN',
    openedBy: 'buyer',
    afterRefund: false,
    usdCents: 41_250n,
    limitUsdCents: 100_000n,
    firstResponseH: 4,
    now: T0,
    ...o,
  });
}

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

const draft = (proposer: string, o: Partial<Omit<RulingDraft, 'approver' | 'needsSecond'>> = {}) => ({
  id: 'r1',
  outcome: 'release-to-buyer' as const,
  accountAction: { kind: 'none' as const },
  proposer,
  ...o,
});

function run(d: Dispute, steps: [DisputeEvent, Actor, Date][]): Dispute {
  for (const [e, by, now] of steps) d = applyDispute(d, e, by, now, S);
  return d;
}

/** Assigned to mod-1 and published at hour 2 (below the limit). */
function published(o: Partial<Parameters<typeof newDispute>[0]> = {}, outcome: RulingDraft['outcome'] = 'release-to-buyer') {
  return run(base(o), [
    [{ type: 'assign', staffId: 'mod-1' }, mod, at(1)],
    [{ type: 'propose', ruling: draft('mod-1', { outcome }) }, mod, at(2)],
  ]);
}

describe('constants (Revision 2026-10-29: 48 h, goal 24; appeals aim for 48 h)', () => {
  test('values', () => {
    expect(RULING_DEADLINE_H).toBe(48);
    expect(RULING_GOAL_H).toBe(24);
    expect(APPEAL_GOAL_H).toBe(48);
    expect(COMPLY_H).toBe(24);
  });
});

describe('newDispute', () => {
  test('deadlines and the limit snapshot', () => {
    const d = base();
    expect(d.status).toBe('open');
    expect(d.round).toBe(1);
    expect(d.openedAt).toEqual(T0);
    expect(d.replyDueAt).toEqual(at(4));
    expect(d.rulingDueAt).toEqual(at(48));
    expect(d.limitUsdCents).toBe(100_000n);
    expect(d.assignee).toBeNull();
    expect(d.seen).toEqual([]);
  });
  test('refuses a bad first-response setting', () => {
    expect(() => base({ firstResponseH: 0 })).toThrow(RangeError);
  });
});

describe('needsSecond', () => {
  test('at the limit exactly, and one cent less', () => {
    expect(needsSecond(base({ usdCents: 100_000n }), 'release-to-buyer', { kind: 'none' })).toBe(true);
    expect(needsSecond(base({ usdCents: 99_999n }), 'release-to-buyer', { kind: 'none' })).toBe(false);
  });
  test('a freeze or any ban needs a second approver', () => {
    const d = base({ usdCents: 1_000n });
    expect(needsSecond(d, 'release-to-buyer', { kind: 'freeze' })).toBe(true);
    expect(needsSecond(d, 'release-to-buyer', { kind: 'trade-ban', until: null, reasonCode: 'terms' })).toBe(true);
    expect(needsSecond(d, 'release-to-buyer', { kind: 'site-ban', until: '2027-03-01T00:00:00.000Z', reasonCode: 'abuse' })).toBe(true);
  });
});

describe('assign', () => {
  test('by staff with disputes.handle, only when unassigned', () => {
    const d = applyDispute(base(), { type: 'assign', staffId: 'mod-1' }, mod, at(1), S);
    expect(d.assignee).toBe('mod-1');
    expect(d.seen).toEqual(['mod-1']);
    rule('wrong-state', () => applyDispute(d, { type: 'assign', staffId: 'mod-2' }, mod2, at(1), S));
  });
  test('a senior or the owner may take over', () => {
    const d = applyDispute(base(), { type: 'assign', staffId: 'mod-1' }, mod, at(1), S);
    expect(applyDispute(d, { type: 'assign', staffId: 'senior-1' }, senior, at(1), S).assignee).toBe('senior-1');
    expect(applyDispute(d, { type: 'assign', staffId: 'owner-1' }, owner, at(1), S).assignee).toBe('owner-1');
  });
  test('a mod can only take a case for themselves; a senior can hand it to a mod', () => {
    rule('wrong-party', () => applyDispute(base(), { type: 'assign', staffId: 'mod-2', role: 'mod' }, mod, at(1), S));
    expect(applyDispute(base(), { type: 'assign', staffId: 'mod-2', role: 'mod' }, senior, at(1), S).assignee).toBe('mod-2');
    expect(applyDispute(base(), { type: 'assign', staffId: 'mod-2', role: 'mod' }, senior, at(1), S).seen).toEqual(['senior-1', 'mod-2']);
    // Handing a case to someone else needs their role, and they must handle disputes.
    rule('wrong-party', () => applyDispute(base(), { type: 'assign', staffId: 'mod-2' }, senior, at(1), S));
    rule('wrong-party', () => applyDispute(base(), { type: 'assign', staffId: 'helper-1', role: 'helper' }, senior, at(1), S));
  });
  test('a trader, the system or a helper gets wrong-party', () => {
    rule('wrong-party', () => applyDispute(base(), { type: 'assign', staffId: 'x' }, system, at(1), S));
    rule('wrong-party', () => applyDispute(base(), { type: 'assign', staffId: 'helper-1' }, helper, at(1), S));
  });
});

describe('reply', () => {
  test('sets firstReplyAt the first time only', () => {
    let d = applyDispute(base(), { type: 'assign', staffId: 'mod-1' }, mod, at(1), S);
    d = applyDispute(d, { type: 'reply' }, mod, at(2), S);
    expect(d.firstReplyAt).toEqual(at(2));
    d = applyDispute(d, { type: 'reply' }, mod, at(3), S);
    expect(d.firstReplyAt).toEqual(at(2));
  });
  test('only the assignee, a senior or the owner', () => {
    const d = applyDispute(base(), { type: 'assign', staffId: 'mod-1' }, mod, at(1), S);
    rule('wrong-party', () => applyDispute(d, { type: 'reply' }, mod2, at(2), S));
    expect(applyDispute(d, { type: 'reply' }, senior, at(2), S).seen).toEqual(['mod-1', 'senior-1']);
  });
});

describe('propose', () => {
  test('below the limit: published at once, appeal window 48 h from publish', () => {
    const d = published();
    expect(d.status).toBe('published');
    expect(d.publishedAt).toEqual(at(2));
    expect(d.appealEndsAt).toEqual(at(50));
    expect(d.ruling).toMatchObject({ id: 'r1', proposer: 'mod-1', approver: null, needsSecond: false });
  });
  test('the assignee only', () => {
    const d = applyDispute(base(), { type: 'assign', staffId: 'mod-1' }, mod, at(1), S);
    rule('wrong-party', () => applyDispute(d, { type: 'propose', ruling: draft('mod-2') }, mod2, at(2), S));
    rule('wrong-party', () => applyDispute(d, { type: 'propose', ruling: draft('senior-1') }, senior, at(2), S));
    // The draft names the actor, never someone else.
    rule('wrong-party', () => applyDispute(d, { type: 'propose', ruling: draft('mod-2') }, mod, at(2), S));
  });
  test('at the limit: awaiting approval', () => {
    const d = published({ usdCents: 100_000n });
    expect(d.status).toBe('awaiting-approval');
    expect(d.appealEndsAt).toBeNull();
    expect(d.ruling?.needsSecond).toBe(true);
  });
  test('outcome and case type must match', () => {
    const d = applyDispute(base(), { type: 'assign', staffId: 'mod-1' }, mod, at(1), S);
    rule('wrong-state', () =>
      applyDispute(d, { type: 'propose', ruling: draft('mod-1', { outcome: 'seller-sends-xmr' }) }, mod, at(2), S),
    );
    const r = applyDispute(base({ afterRefund: true }), { type: 'assign', staffId: 'mod-1' }, mod, at(1), S);
    rule('wrong-state', () => applyDispute(r, { type: 'propose', ruling: draft('mod-1') }, mod, at(2), S));
    rule('wrong-state', () =>
      applyDispute(r, { type: 'propose', ruling: draft('mod-1', { outcome: 'bogus' as never }) }, mod, at(2), S),
    );
  });
  test('a second proposal while one is pending is wrong-state', () => {
    const d = published({ usdCents: 100_000n });
    rule('wrong-state', () => applyDispute(d, { type: 'propose', ruling: draft('mod-1') }, mod, at(3), S));
  });
});

describe('approve and send back', () => {
  const pending = () => published({ usdCents: 100_000n });
  test('a senior or the owner approves; publishes with the window from approval', () => {
    const d = applyDispute(pending(), { type: 'approve' }, owner, at(5), S);
    expect(d.status).toBe('published');
    expect(d.ruling?.approver).toBe('owner-1');
    expect(d.appealEndsAt).toEqual(at(53));
    expect(applyDispute(pending(), { type: 'approve' }, senior, at(5), S).status).toBe('published');
  });
  test('a mod cannot approve', () => {
    rule('wrong-party', () => applyDispute(pending(), { type: 'approve' }, mod2, at(5), S));
  });
  test('approving your own proposal is same-person', () => {
    const d = run(base({ usdCents: 100_000n }), [
      [{ type: 'assign', staffId: 'senior-1' }, senior, at(1)],
      [{ type: 'propose', ruling: draft('senior-1') }, senior, at(2)],
    ]);
    rule('same-person', () => applyDispute(d, { type: 'approve' }, senior, at(3), S));
  });
  test('only in awaiting-approval', () => {
    rule('wrong-state', () => applyDispute(published(), { type: 'approve' }, owner, at(3), S));
  });
  test('send-back returns the case to open and clears the ruling', () => {
    const d = applyDispute(pending(), { type: 'send-back' }, senior, at(5), S);
    expect(d.status).toBe('open');
    expect(d.ruling).toBeNull();
    rule('wrong-party', () => applyDispute(pending(), { type: 'send-back' }, mod2, at(5), S));
  });
});

describe('appeal (48 h window)', () => {
  test('a trader appeals before appealEndsAt; 1 ms before is accepted', () => {
    const d = applyDispute(published(), { type: 'appeal' }, seller, at(50, -1), S);
    expect(d.status).toBe('appealed');
    expect(d.round).toBe(2);
    expect(d.appealBy).toBe('seller');
    expect(d.appealedAt).toEqual(at(50, -1));
    expect(d.assignee).toBeNull();
    expect(d.ruling).toBeNull();
    expect(d.round1).toEqual({ proposer: 'mod-1', approver: null, outcome: 'release-to-buyer', involved: ['mod-1'] });
    expect(d.rulingDueAt).toEqual(at(50 + APPEAL_GOAL_H, -1));
  });
  test('at appealEndsAt exactly: too-late', () => {
    rule('too-late', () => applyDispute(published(), { type: 'appeal' }, buyer, at(50), S));
  });
  test('a second appeal is wrong-state', () => {
    const d = applyDispute(published(), { type: 'appeal' }, seller, at(10), S);
    rule('wrong-state', () => applyDispute(d, { type: 'appeal' }, buyer, at(10), S));
  });
  test('an appeal is allowed after the coins moved (A1 dropped: it fixes the record)', () => {
    const d = run(published(), [
      [{ type: 'executed' }, system, at(3)],
      [{ type: 'appeal' }, seller, at(20)],
    ]);
    expect(d.status).toBe('appealed');
    expect(d.executedAt).toEqual(at(3));
  });
  test('staff and the system cannot appeal', () => {
    rule('wrong-party', () => applyDispute(published(), { type: 'appeal' }, owner, at(10), S));
    rule('wrong-party', () => applyDispute(published(), { type: 'appeal' }, system, at(10), S));
  });
  test('only from published', () => {
    rule('wrong-state', () => applyDispute(base(), { type: 'appeal' }, buyer, at(1), S));
  });
});

describe('a trader may send only appeal', () => {
  const events: DisputeEvent[] = [
    { type: 'assign', staffId: 'x' },
    { type: 'reply' },
    { type: 'propose', ruling: draft('x') },
    { type: 'approve' },
    { type: 'send-back' },
    { type: 'window-closed' },
    { type: 'executed' },
    { type: 'complied' },
    { type: 'close' },
  ];
  for (const e of events) {
    test(e.type, () => {
      rule('wrong-party', () => applyDispute(published(), e, buyer, at(3), S));
      rule('wrong-party', () => applyDispute(base(), e, seller, at(3), S));
    });
  }
});

describe('execution at once (A1 dropped) and the window closing', () => {
  test('executed from published (system only, once)', () => {
    const d = applyDispute(published(), { type: 'executed' }, system, at(2, 1), S);
    expect(d.status).toBe('published');
    expect(d.executedAt).toEqual(at(2, 1));
    rule('wrong-state', () => applyDispute(d, { type: 'executed' }, system, at(3), S));
    rule('wrong-party', () => applyDispute(published(), { type: 'executed' }, owner, at(3), S));
  });
  test('window-closed after execution closes the case', () => {
    const d = run(published(), [
      [{ type: 'executed' }, system, at(3)],
      [{ type: 'window-closed' }, system, at(50)],
    ]);
    expect(d.status).toBe('closed');
  });
  test('window-closed before execution makes it final; executed then closes', () => {
    let d = applyDispute(published(), { type: 'window-closed' }, system, at(50), S);
    expect(d.status).toBe('final');
    d = applyDispute(d, { type: 'executed' }, system, at(51), S);
    expect(d.status).toBe('closed');
  });
  test('window-closed only from the system, at or after appealEndsAt, in published', () => {
    rule('wrong-state', () => applyDispute(published(), { type: 'window-closed' }, system, at(50, -1), S));
    rule('wrong-party', () => applyDispute(published(), { type: 'window-closed' }, senior, at(50), S));
    rule('wrong-state', () => applyDispute(base(), { type: 'window-closed' }, system, at(50), S));
  });
  test('an after-refund ruling is never executed', () => {
    const d = published({ afterRefund: true }, 'no-action');
    rule('wrong-state', () => applyDispute(d, { type: 'executed' }, system, at(3), S));
  });
  test('close by the system ends a final case', () => {
    const d = applyDispute(published(), { type: 'window-closed' }, system, at(50), S);
    expect(applyDispute(d, { type: 'close' }, system, at(51), S).status).toBe('closed');
    rule('wrong-state', () => applyDispute(base(), { type: 'close' }, system, at(1), S));
    rule('wrong-party', () => applyDispute(d, { type: 'close' }, owner, at(51), S));
  });
});

describe('after-refund compliance', () => {
  test('seller-sends-xmr starts its comply time at publish (coins and liens act at the ruling)', () => {
    const d = published({ afterRefund: true }, 'seller-sends-xmr');
    expect(d.status).toBe('published');
    expect(d.complyBy).toEqual(at(2 + COMPLY_H));
  });
  test('complied, then the window closes: closed', () => {
    const d = run(published({ afterRefund: true }, 'seller-sends-xmr'), [
      [{ type: 'complied' }, system, at(10)],
      [{ type: 'window-closed' }, system, at(50)],
    ]);
    expect(d.status).toBe('closed');
    expect(d.compliedAt).toEqual(at(10));
  });
  test('not complied when the window closes: complying, then complied → closed', () => {
    let d = applyDispute(published({ afterRefund: true }, 'seller-sends-xmr'), { type: 'window-closed' }, system, at(50), S);
    expect(d.status).toBe('complying');
    d = applyDispute(d, { type: 'complied' }, system, at(51), S);
    expect(d.status).toBe('closed');
  });
  test('the other after-refund outcomes close when the window closes', () => {
    for (const o of ['seller-returns-fiat', 'no-action'] as const) {
      const d = applyDispute(published({ afterRefund: true }, o), { type: 'window-closed' }, system, at(50), S);
      expect(d.status).toBe('closed');
      expect(d.complyBy).toBeNull();
    }
  });
  test('complied only for seller-sends-xmr, from the system', () => {
    rule('wrong-state', () =>
      applyDispute(published({ afterRefund: true }, 'no-action'), { type: 'complied' }, system, at(3), S),
    );
    rule('wrong-party', () =>
      applyDispute(published({ afterRefund: true }, 'seller-sends-xmr'), { type: 'complied' }, senior, at(3), S),
    );
  });
});

describe('appeal review (R37: nobody involved, no fallback)', () => {
  // Round 1: mod-1 assigned and proposed, senior-1 read the case (seen), the owner approved.
  function appealed() {
    let d = run(base({ usdCents: 100_000n }), [
      [{ type: 'assign', staffId: 'mod-1' }, mod, at(1)],
      [{ type: 'propose', ruling: draft('mod-1') }, mod, at(2)],
      [{ type: 'approve' }, owner, at(3)],
    ]);
    d = markSeen(d, 'senior-1');
    return applyDispute(d, { type: 'appeal' }, seller, at(10), S);
  }

  test('round 1 involvement is frozen at the appeal', () => {
    expect(appealed().round1?.involved.sort()).toEqual(['mod-1', 'owner-1', 'senior-1']);
  });
  test('only an uninvolved senior or the owner can take the appeal', () => {
    const d = appealed();
    rule('not-eligible', () => applyDispute(d, { type: 'assign', staffId: 'mod-2' }, mod2, at(11), S));
    rule('not-eligible', () => applyDispute(d, { type: 'assign', staffId: 'senior-1' }, senior, at(11), S));
    rule('not-eligible', () => applyDispute(d, { type: 'assign', staffId: 'owner-1' }, owner, at(11), S));
    // The owner (involved) may still hand it to an uninvolved senior.
    expect(applyDispute(d, { type: 'assign', staffId: 'senior-2', role: 'senior' }, owner, at(11), S).assignee).toBe('senior-2');
    rule('not-eligible', () => applyDispute(d, { type: 'assign', staffId: 'mod-2', role: 'mod' }, owner, at(11), S));
    rule('not-eligible', () => applyDispute(d, { type: 'assign', staffId: 'senior-1', role: 'senior' }, owner, at(11), S));
  });
  test('round 2 by an uninvolved senior; overturned is recorded at final', () => {
    const d = run(appealed(), [
      [{ type: 'assign', staffId: 'senior-2' }, senior2, at(11)],
      [{ type: 'propose', ruling: draft('senior-2', { id: 'r2', outcome: 'refund-to-seller' }) }, senior2, at(12)],
    ]);
    // Still at the limit: a second approver, who must not be involved either.
    expect(d.status).toBe('awaiting-approval');
    rule('not-eligible', () => applyDispute(d, { type: 'approve' }, owner, at(13), S));
    rule('not-eligible', () => applyDispute(d, { type: 'approve' }, senior, at(13), S));
  });
  test('round 2 final below the limit: decision overruled', () => {
    let d = run(published(), [[{ type: 'appeal' }, buyer, at(10)]]);
    d = run(d, [
      [{ type: 'assign', staffId: 'senior-2' }, senior2, at(11)],
      [{ type: 'propose', ruling: draft('senior-2', { id: 'r2', outcome: 'refund-to-seller' }) }, senior2, at(12)],
    ]);
    // Round 1's coins moved (or move) under round 1; the case waits for that, then closes.
    expect(d.status).toBe('final');
    expect(d.overturned).toBe(true);
    expect(applyDispute(d, { type: 'executed' }, system, at(13), S).status).toBe('closed');
  });
  test('round 2 final after execution: decision stands → closed', () => {
    let d = run(published(), [
      [{ type: 'executed' }, system, at(3)],
      [{ type: 'appeal' }, buyer, at(10)],
      [{ type: 'assign', staffId: 'owner-1' }, owner, at(11)],
      [{ type: 'propose', ruling: draft('owner-1', { id: 'r2' }) }, owner, at(12)],
    ]);
    expect(d.status).toBe('closed');
    expect(d.overturned).toBe(false);
    // No second appeal.
    rule('wrong-state', () => applyDispute(d, { type: 'appeal' }, seller, at(13), S));
  });
  test('an after-refund appeal that keeps seller-sends-xmr restarts the comply time', () => {
    const d = run(published({ afterRefund: true }, 'seller-sends-xmr'), [
      [{ type: 'appeal' }, seller, at(10)],
      [{ type: 'assign', staffId: 'senior-2' }, senior2, at(11)],
      [{ type: 'propose', ruling: draft('senior-2', { id: 'r2', outcome: 'seller-sends-xmr' }) }, senior2, at(12)],
    ]);
    expect(d.status).toBe('complying');
    expect(d.complyBy).toEqual(at(12 + COMPLY_H));
  });
  test('send-back in round 2 returns to appealed', () => {
    let d = run(appealed(), [
      [{ type: 'assign', staffId: 'senior-2' }, senior2, at(11)],
      [{ type: 'propose', ruling: draft('senior-2', { id: 'r2' }) }, senior2, at(12)],
    ]);
    const fresh: Actor = { kind: 'staff', id: 'senior-3', role: 'senior' };
    d = applyDispute(d, { type: 'send-back' }, fresh, at(13), S);
    expect(d.status).toBe('appealed');
    expect(d.ruling).toBeNull();
  });
});

describe('purity', () => {
  test('applyDispute never changes its input', () => {
    const d = base();
    const snapshot = structuredClone(d);
    applyDispute(d, { type: 'assign', staffId: 'mod-1' }, mod, at(1), S);
    expect(d).toEqual(snapshot);
  });
  test('an invalid clock or window setting is refused', () => {
    expect(() => applyDispute(base(), { type: 'reply' }, owner, new Date(Number.NaN), S)).toThrow(RangeError);
    expect(() => applyDispute(base(), { type: 'reply' }, owner, at(1), { appealWindowH: 0 })).toThrow(RangeError);
  });
});

describe('shiftDeadlines (A7: maintenance)', () => {
  test('moves every running deadline by the time spent in maintenance', () => {
    const d = shiftDeadlines(published({ afterRefund: true }, 'seller-sends-xmr'), 2 * H);
    expect(d.replyDueAt).toEqual(at(6));
    expect(d.rulingDueAt).toEqual(at(50));
    expect(d.appealEndsAt).toEqual(at(52));
    expect(d.complyBy).toEqual(at(2 + COMPLY_H + 2));
  });
});
