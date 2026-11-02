import { describe, expect, test } from 'vitest';
import { appealReviewers, involvedIn, type InvolvementEntry } from '@x2f/staff';

const CODE = 'K7M2-9QXA-4FTR-8WPN';
const staff = [
  { id: 'owner-1', role: 'owner' as const },
  { id: 'senior-1', role: 'senior' as const },
  { id: 'senior-2', role: 'senior' as const },
  { id: 'mod-1', role: 'mod' as const },
  { id: 'helper-1', role: 'helper' as const },
];

describe('involvedIn (R37: any log entry by a person on that dispute, up to the appeal)', () => {
  const log: InvolvementEntry[] = [
    { id: '1', tradeCode: CODE, actorKind: 'staff', actorId: 'mod-1', action: 'chat.read' },
    { id: '2', tradeCode: CODE, actorKind: 'staff', actorId: 'senior-1', action: 'chat.message-sent' },
    { id: '3', tradeCode: 'AAAA-BBBB-CCCC-DDDD', actorKind: 'staff', actorId: 'senior-2', action: 'case.opened' },
    { id: '4', tradeCode: null, actorKind: 'staff', actorId: 'owner-1', action: 'settings.changed' },
    { id: '9', tradeCode: CODE, actorKind: 'trader', actorId: null, action: 'appeal.opened' },
    { id: '10', tradeCode: CODE, actorKind: 'system', actorId: null, action: 'ruling.executed' },
    // Round 2: the reviewer's own entries come after the appeal.
    { id: '11', tradeCode: CODE, actorKind: 'staff', actorId: 'senior-2', action: 'dispute.assigned' },
    { id: '12', tradeCode: CODE, actorKind: 'staff', actorId: 'senior-2', action: 'case.opened' },
  ];
  test('staff with an entry on the trade before the appeal, matched on the normalised code', () => {
    expect([...involvedIn(log, 'k7m29qxa4ftr8wpn', { beforeId: '9' })].sort()).toEqual(['mod-1', 'senior-1']);
  });
  test("I3: a reviewer's own round-2 entries never make them ineligible", () => {
    const involved = involvedIn(log, CODE, { beforeId: '9' });
    expect(appealReviewers(staff, involved)).toEqual(['owner-1', 'senior-2']);
  });
  test('ids compare as numbers, not text', () => {
    expect([...involvedIn(log, CODE, { beforeId: '10' })].sort()).toEqual(['mod-1', 'senior-1']);
    expect([...involvedIn(log, CODE, { beforeId: '100' })].sort()).toEqual(['mod-1', 'senior-1', 'senior-2']);
  });
  test('an invalid code or cut-off matches nothing or throws', () => {
    expect(involvedIn(log, 'nope', { beforeId: '9' }).size).toBe(0);
    expect(() => involvedIn(log, CODE, { beforeId: 'x' })).toThrow(RangeError);
  });
});

describe('appealReviewers', () => {
  test('seniors and the owner not involved', () => {
    expect(appealReviewers(staff, new Set(['senior-1']))).toEqual(['owner-1', 'senior-2']);
  });
  test('a moderator who only opened the chat is not eligible, nor any mod or helper', () => {
    expect(appealReviewers(staff, ['mod-1'])).toEqual(['owner-1', 'senior-1', 'senior-2']);
  });
  test('the owner who approved round 1 is not eligible', () => {
    expect(appealReviewers(staff, ['owner-1', 'mod-1'])).toEqual(['senior-1', 'senior-2']);
  });
  test('no fallback: everyone involved → nobody (the appeal waits)', () => {
    expect(appealReviewers(staff, ['owner-1', 'senior-1', 'senior-2'])).toEqual([]);
  });
  test('switched-off staff are left out', () => {
    expect(appealReviewers([...staff.slice(0, 2), { id: 'senior-2', role: 'senior', active: false }], [])).toEqual([
      'owner-1',
      'senior-1',
    ]);
  });
});
