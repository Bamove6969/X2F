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

describe('involvedIn (R37: any log entry by a person on that dispute)', () => {
  const log: InvolvementEntry[] = [
    { tradeCode: CODE, actorKind: 'staff', actorId: 'mod-1', action: 'chat.read' },
    { tradeCode: CODE, actorKind: 'staff', actorId: 'senior-1', action: 'chat.message-sent' },
    { tradeCode: CODE, actorKind: 'trader', actorId: null, action: 'appeal.opened' },
    { tradeCode: CODE, actorKind: 'system', actorId: null, action: 'ruling.executed' },
    { tradeCode: 'AAAA-BBBB-CCCC-DDDD', actorKind: 'staff', actorId: 'senior-2', action: 'case.opened' },
    { tradeCode: null, actorKind: 'staff', actorId: 'owner-1', action: 'settings.changed' },
  ];
  test('staff with any entry on the trade, matched on the normalised code', () => {
    expect([...involvedIn(log, 'k7m29qxa4ftr8wpn')].sort()).toEqual(['mod-1', 'senior-1']);
  });
  test('an invalid code matches nothing', () => {
    expect(involvedIn(log, 'nope').size).toBe(0);
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
