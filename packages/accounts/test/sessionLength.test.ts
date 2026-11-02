import { describe, expect, test } from 'vitest';
import { SESSION_PROMPT_MS, UNCHOSEN_SESSION_HOURS, describeAction, isSessionHours, sessionHoursFor } from '@x2f/accounts';

describe('session length choices (owner, 2 Nov 2026)', () => {
  test('traders choose 2, 4, 6 or 12 hours; vendors 2, 6, 12 or 24', () => {
    expect(sessionHoursFor('trader')).toEqual([2, 4, 6, 12]);
    expect(sessionHoursFor('vendor')).toEqual([2, 6, 12, 24]);
  });

  test('isSessionHours accepts only the choices of that account type', () => {
    for (const h of [2, 4, 6, 12]) expect(isSessionHours('trader', h)).toBe(true);
    for (const h of [2, 6, 12, 24]) expect(isSessionHours('vendor', h)).toBe(true);
    expect(isSessionHours('trader', 24)).toBe(false);
    expect(isSessionHours('vendor', 4)).toBe(false);
    for (const v of [0, 1, 3, 8, 10, 13, 2.5, -2, Number.NaN, '6', null, undefined, true, [6]]) {
      expect(isSessionHours('trader', v)).toBe(false);
      expect(isSessionHours('vendor', v)).toBe(false);
    }
  });

  test('a session whose length was never chosen lasts the shortest choice of every account type', () => {
    expect(UNCHOSEN_SESSION_HOURS).toBe(2);
    expect(Math.min(...sessionHoursFor('trader'), ...sessionHoursFor('vendor'))).toBe(UNCHOSEN_SESSION_HOURS);
  });

  test('the "Stay logged in?" prompt waits 2 minutes (draft; an open owner question)', () => {
    expect(SESSION_PROMPT_MS).toBe(2 * 60_000);
  });

  test('extending is its own confirm action', () => {
    expect(describeAction({ kind: 'extend-session' })).toBe('stay logged in');
  });
});
