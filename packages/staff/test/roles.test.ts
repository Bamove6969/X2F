import { describe, expect, test } from 'vitest';
import { GRANTABLE_PERMS, NAV, PERMS, STAFF_ROLES, can, navFor, type Perm, type StaffRole } from '@x2f/staff';

// Every role × perm pair, written out so a grant change shows up in review (Plan 4 Task 1).
// Revisions: `stats.read` (owner only, Revision 2026-10-28), `reputation.review` (mods and senior
// moderators, lead default of Revision 2026-10-29b), `accounts.ban` (senior moderator and owner,
// Task 27), `tickets.handle` (granted per person by the owner, Task 30: by role only the owner),
// `feedback.read` (owner only, Plan 5 Task 4).
const GRANTS: Record<Perm, Record<StaffRole, boolean>> = {
  'staff.manage': { owner: true, senior: false, mod: false, helper: false },
  'settings.write': { owner: true, senior: false, mod: false, helper: false },
  'site.control': { owner: true, senior: false, mod: false, helper: false },
  'earnings.read': { owner: true, senior: false, mod: false, helper: false },
  'perf.read': { owner: true, senior: false, mod: false, helper: false },
  'stats.read': { owner: true, senior: false, mod: false, helper: false },
  'log.read.all': { owner: true, senior: false, mod: false, helper: false },
  'log.read.cases': { owner: true, senior: true, mod: true, helper: false },
  'disputes.handle': { owner: true, senior: true, mod: true, helper: false },
  'rulings.approve': { owner: true, senior: true, mod: false, helper: false },
  'accounts.freeze': { owner: true, senior: true, mod: false, helper: false },
  'accounts.ban': { owner: true, senior: true, mod: false, helper: false },
  'reputation.review': { owner: true, senior: true, mod: true, helper: false },
  // Owner 2026-11-02: only senior moderators and the owner enter a verified past-rep figure.
  'reputation.verify': { owner: true, senior: true, mod: false, helper: false },
  'tickets.handle': { owner: true, senior: false, mod: false, helper: false },
  // Owner Q60 (6 Nov): senior moderators always; moderators and helpers only by grant.
  'feedback.read': { owner: true, senior: true, mod: false, helper: false },
  'training.read': { owner: true, senior: true, mod: true, helper: false },
  'training.write': { owner: true, senior: false, mod: false, helper: false },
  self: { owner: true, senior: true, mod: true, helper: true },
};

describe('can', () => {
  test('the grant table lists every perm exactly once', () => {
    expect(Object.keys(GRANTS).sort()).toEqual([...PERMS].sort());
    expect(new Set(PERMS).size).toBe(PERMS.length);
  });

  for (const perm of Object.keys(GRANTS) as Perm[]) {
    for (const role of STAFF_ROLES) {
      test(`${role} × ${perm} = ${GRANTS[perm][role]}`, () => {
        expect(can(role, perm)).toBe(GRANTS[perm][role]);
      });
    }
  }

  test('the plan pins', () => {
    expect(can('mod', 'rulings.approve')).toBe(false);
    expect(can('senior', 'rulings.approve')).toBe(true);
    for (const p of PERMS) expect(can('helper', p)).toBe(p === 'self');
  });

  test('the owner has every perm', () => {
    for (const p of PERMS) expect(can('owner', p)).toBe(true);
  });

  test('a per-person grant adds only a grantable perm', () => {
    expect(GRANTABLE_PERMS).toEqual(['tickets.handle', 'feedback.read']);
    // Owner Q60: feedback for a moderator or a helper is a per-person checkbox.
    expect(can('mod', 'feedback.read')).toBe(false);
    expect(can('mod', 'feedback.read', ['feedback.read'])).toBe(true);
    expect(can('helper', 'feedback.read', ['feedback.read'])).toBe(true);
    expect(can('helper', 'tickets.handle', ['tickets.handle'])).toBe(true);
    expect(can('mod', 'tickets.handle', ['tickets.handle'])).toBe(true);
    // A grant list can never widen a role beyond the grantable perms.
    expect(can('helper', 'rulings.approve', ['rulings.approve' as Perm])).toBe(false);
    expect(can('mod', 'staff.manage', ['staff.manage' as Perm, 'tickets.handle'])).toBe(false);
  });

  test('an unknown role or perm is refused', () => {
    expect(can('admin' as StaffRole, 'self')).toBe(false);
    expect(can('owner', 'everything' as Perm)).toBe(false);
    expect(can('__proto__' as StaffRole, 'self')).toBe(false);
    expect(can('owner', 'toString' as Perm)).toBe(false);
  });
});

describe('NAV', () => {
  test('owner sees the boards\' seven, plus feedback (Plan 5 Task 4)', () => {
    expect(NAV.owner).toEqual(['overview', 'disputes', 'staff', 'performance', 'training', 'log', 'feedback', 'settings']);
  });
  test('senior and mod', () => {
    expect(NAV.mod).toEqual(['disputes', 'training', 'log']);
    expect(NAV.senior).toEqual(['disputes', 'training', 'log', 'feedback']);
  });
  test('owner Q60: a feedback grant adds Feedback to a moderator\'s or helper\'s menu, once', () => {
    expect(navFor('mod', ['feedback.read'])).toEqual(['disputes', 'training', 'log', 'feedback']);
    expect(navFor('helper', ['feedback.read'])).toEqual(['feedback']);
    expect(navFor('senior', ['feedback.read'])).toEqual(['disputes', 'training', 'log', 'feedback', 'compromised']);
  });
  test('J-14: Tickets for whoever holds tickets.handle (a grant, or the owner); Compromised accounts for accounts.freeze (senior, owner)', () => {
    expect(navFor('mod', ['tickets.handle'])).toEqual(['disputes', 'training', 'log', 'tickets']);
    expect(navFor('helper', ['tickets.handle'])).toEqual(['tickets']);
    expect(navFor('helper', ['tickets.handle', 'feedback.read'])).toEqual(['feedback', 'tickets']);
    expect(navFor('mod')).toEqual(['disputes', 'training', 'log']);
    expect(navFor('senior')).toEqual(['disputes', 'training', 'log', 'feedback', 'compromised']);
    expect(navFor('senior', ['tickets.handle'])).toEqual(['disputes', 'training', 'log', 'feedback', 'tickets', 'compromised']);
    expect(navFor('owner')).toEqual(['overview', 'disputes', 'staff', 'performance', 'training', 'log', 'feedback', 'tickets', 'compromised', 'settings']);
  });
  test('helper sees nothing', () => {
    expect(NAV.helper).toEqual([]);
  });
});
