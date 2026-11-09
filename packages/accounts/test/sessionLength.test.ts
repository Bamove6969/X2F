import { describe, expect, test } from 'vitest';
import {
  IDLE_REMINDER_MINUTES, SESSION_CHOICE_WINDOW_MS, SESSION_PROMPT_MS, UNCHOSEN_SESSION_HOURS, describeAction, isIdleReminderMinutes, isSessionHours, sessionHoursFor,
} from '@x2f/accounts';

describe('session length choices (owner, 2 Nov 2026)', () => {
  test('traders choose 2, 4, 8 or 12 hours; vendors 2, 6, 12 or 24 (owner G23)', () => {
    expect(sessionHoursFor('trader')).toEqual([2, 4, 8, 12]);
    expect(sessionHoursFor('vendor')).toEqual([2, 6, 12, 24]);
  });

  test('isSessionHours accepts only the choices of that account type', () => {
    for (const h of [2, 4, 8, 12]) expect(isSessionHours('trader', h)).toBe(true);
    for (const h of [2, 6, 12, 24]) expect(isSessionHours('vendor', h)).toBe(true);
    expect(isSessionHours('trader', 24)).toBe(false);
    expect(isSessionHours('trader', 6)).toBe(false);
    expect(isSessionHours('vendor', 4)).toBe(false);
    for (const v of [0, 1, 3, 10, 13, 2.5, -2, Number.NaN, '6', null, undefined, true, [6]]) {
      expect(isSessionHours('trader', v)).toBe(false);
      expect(isSessionHours('vendor', v)).toBe(false);
    }
  });

  test('a session whose length was never chosen lasts the shortest choice of every account type', () => {
    expect(UNCHOSEN_SESSION_HOURS).toBe(2);
    expect(Math.min(...sessionHoursFor('trader'), ...sessionHoursFor('vendor'))).toBe(UNCHOSEN_SESSION_HOURS);
  });

  test('the "Stay logged in?" warning comes 5 minutes before the end (owner, Q73, 6 Nov 2026)', () => {
    expect(SESSION_PROMPT_MS).toBe(5 * 60_000);
  });

  test('the free first choice of a length is open only right after the login (10 minutes)', () => {
    expect(SESSION_CHOICE_WINDOW_MS).toBe(10 * 60_000);
  });

  test('the idle reminder (owner, Q75): off, or one of these intervals in minutes', () => {
    expect(IDLE_REMINDER_MINUTES).toEqual([10, 15, 30, 60, 120]);
    for (const m of IDLE_REMINDER_MINUTES) expect(isIdleReminderMinutes(m)).toBe(true);
    for (const v of [0, 5, 20, 45, 90, 240, 15.5, -15, '15', null, undefined, true, [15]]) expect(isIdleReminderMinutes(v)).toBe(false);
  });

  test('extending is its own confirm action', () => {
    expect(describeAction({ kind: 'extend-session' })).toBe('stay logged in');
  });
});
