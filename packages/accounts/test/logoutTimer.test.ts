import { describe, expect, test } from 'vitest';
import { DEFAULT_IDLE_HOURS, IDLE_HOURS, isIdleHours } from '@x2f/accounts';

describe('logout timer choices (owner, 2026-10-23)', () => {
  test('are 2, 4, 6, 8, 10 or 12 hours, default 12', () => {
    expect(IDLE_HOURS).toEqual([2, 4, 6, 8, 10, 12]);
    expect(DEFAULT_IDLE_HOURS).toBe(12);
  });

  test('isIdleHours accepts only those numbers', () => {
    for (const h of IDLE_HOURS) expect(isIdleHours(h)).toBe(true);
    for (const v of [0, 1, 3, 13, 24, 2.5, -2, Number.NaN, '6', null, undefined, true, [6]]) expect(isIdleHours(v)).toBe(false);
  });
});
