import { describe, expect, test } from 'vitest';
import { HoursError, inWindow, validateHours, windowEndsAt, type LoginHours } from '@x2f/staff';

const at = (iso: string) => new Date(iso);

// Fri 22:00–02:00 New York. 2027-11-05 is a Friday in EDT (UTC−4); the clocks go back on 2027-11-07.
const friNight: LoginHours = { days: ['Fri'], start: '22:00', end: '02:00', tz: 'America/New_York' };
// Mon–Fri 09:00–17:00 Berlin; 2027-03-28 (a Sunday) is the spring change to CEST (UTC+2).
const berlinWeek: LoginHours = {
  days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  start: '09:00',
  end: '17:00',
  tz: 'Europe/Berlin',
};

describe('inWindow', () => {
  test('overnight window across midnight', () => {
    expect(inWindow(friNight, at('2027-11-06T01:59:00Z'))).toBe(false); // Fri 21:59
    expect(inWindow(friNight, at('2027-11-06T02:00:00Z'))).toBe(true); // Fri 22:00
    expect(inWindow(friNight, at('2027-11-06T05:59:00Z'))).toBe(true); // Sat 01:59
    expect(inWindow(friNight, at('2027-11-06T06:00:00Z'))).toBe(false); // Sat 02:00
    expect(inWindow(friNight, at('2027-11-07T02:30:00Z'))).toBe(false); // Sat 22:30
  });

  test('same-day window right after the spring change in Berlin', () => {
    expect(inWindow(berlinWeek, at('2027-03-29T07:00:00Z'))).toBe(true); // Mon 09:00 CEST
    expect(inWindow(berlinWeek, at('2027-03-29T06:59:00Z'))).toBe(false); // Mon 08:59 CEST
    expect(inWindow(berlinWeek, at('2027-03-29T14:59:00Z'))).toBe(true); // 16:59
    expect(inWindow(berlinWeek, at('2027-03-29T15:00:00Z'))).toBe(false); // 17:00
    expect(inWindow(berlinWeek, at('2027-03-28T08:00:00Z'))).toBe(false); // Sunday
  });

  test('the Berlin window across the autumn change', () => {
    // 2027-10-31 is the change back to CET (UTC+1); Monday 2027-11-01 09:00 CET = 08:00Z.
    expect(inWindow(berlinWeek, at('2027-11-01T07:59:00Z'))).toBe(false);
    expect(inWindow(berlinWeek, at('2027-11-01T08:00:00Z'))).toBe(true);
  });

  test('a UTC window', () => {
    const h: LoginHours = { days: ['Wed'], start: '00:00', end: '23:59', tz: 'UTC' };
    expect(inWindow(h, at('2027-01-06T00:00:00Z'))).toBe(true);
    expect(inWindow(h, at('2027-01-06T23:58:59Z'))).toBe(true);
    expect(inWindow(h, at('2027-01-06T23:59:00Z'))).toBe(false);
    expect(inWindow(h, at('2027-01-07T00:00:00Z'))).toBe(false);
  });

  test("'any' is always true", () => {
    expect(inWindow('any', at('2027-11-06T06:00:00Z'))).toBe(true);
    expect(inWindow('any', at('1999-12-31T23:59:59Z'))).toBe(true);
  });

  test('an invalid date is never in the window', () => {
    expect(inWindow(friNight, new Date(Number.NaN))).toBe(false);
  });
});

describe('windowEndsAt', () => {
  test('overnight window ends the next local morning', () => {
    // Fri 23:00 EDT on 2027-11-05 → Sat 02:00 EDT = 06:00Z.
    expect(windowEndsAt(friNight, at('2027-11-06T03:00:00Z'))?.toISOString()).toBe('2027-11-06T06:00:00.000Z');
    // Sat 01:00 EDT, still in Friday's window.
    expect(windowEndsAt(friNight, at('2027-11-06T05:00:00Z'))?.toISOString()).toBe('2027-11-06T06:00:00.000Z');
  });

  test('an end time skipped by the spring change ends at the first instant local time reaches it', () => {
    // 2027-03-14: New York jumps from 02:00 EST to 03:00 EDT, so 02:00 never happens.
    const satNight: LoginHours = { days: ['Sat'], start: '22:00', end: '02:00', tz: 'America/New_York' };
    // Sat 2027-03-13 23:00 EST = 2027-03-14T04:00Z.
    expect(windowEndsAt(satNight, at('2027-03-14T04:00:00Z'))?.toISOString()).toBe('2027-03-14T07:00:00.000Z');
    expect(inWindow(satNight, at('2027-03-14T06:59:00Z'))).toBe(true); // 01:59 EST
    expect(inWindow(satNight, at('2027-03-14T07:00:00Z'))).toBe(false); // 03:00 EDT
  });

  test('an end time that happens twice in the autumn ends at its first occurrence', () => {
    // 2027-11-07: 01:30 happens at 05:30Z (EDT) and again at 06:30Z (EST).
    const h: LoginHours = { days: ['Sat'], start: '22:00', end: '01:30', tz: 'America/New_York' };
    expect(windowEndsAt(h, at('2027-11-07T03:00:00Z'))?.toISOString()).toBe('2027-11-07T05:30:00.000Z');
  });

  test('a same-day window ends today', () => {
    expect(windowEndsAt(berlinWeek, at('2027-03-29T08:00:00Z'))?.toISOString()).toBe('2027-03-29T15:00:00.000Z');
  });

  test("'any' never ends", () => {
    expect(windowEndsAt('any', at('2027-03-29T08:00:00Z'))).toBeNull();
  });

  test('outside the window it has already ended (now)', () => {
    const now = at('2027-03-29T16:00:00Z');
    expect(windowEndsAt(berlinWeek, now)?.toISOString()).toBe(now.toISOString());
  });
});

describe('validateHours', () => {
  const refuses = (h: unknown) => {
    expect(() => validateHours(h)).toThrow(HoursError);
    try {
      validateHours(h);
    } catch (e) {
      expect((e as HoursError).code).toBe('hours-invalid');
    }
  };

  test('accepts the two kinds', () => {
    expect(validateHours('any')).toBe('any');
    expect(validateHours(friNight)).toEqual(friNight);
    expect(validateHours({ ...friNight, tz: 'UTC' })).toEqual({ ...friNight, tz: 'UTC' });
  });

  test('returns a copy, not the input', () => {
    const input = { days: ['Mon'], start: '09:00', end: '17:00', tz: 'UTC' };
    const out = validateHours(input);
    input.days.push('Tue');
    expect(out).toEqual({ days: ['Mon'], start: '09:00', end: '17:00', tz: 'UTC' });
  });

  test('refuses start === end, an unknown time zone and empty days', () => {
    refuses({ ...friNight, end: '22:00' });
    refuses({ ...friNight, tz: 'Mars/Olympus' });
    refuses({ ...friNight, days: [] });
  });

  test('refuses malformed input', () => {
    refuses(null);
    refuses('sometimes');
    refuses({ ...friNight, start: '24:00' });
    refuses({ ...friNight, start: '9:00' });
    refuses({ ...friNight, end: '02:60' });
    refuses({ ...friNight, days: ['Fri', 'Fri'] });
    refuses({ ...friNight, days: ['Friday'] });
    refuses({ ...friNight, days: 'Fri' });
    refuses({ ...friNight, extra: 1 });
    refuses({ days: ['Fri'], start: '22:00', end: '02:00' });
    refuses({ ...friNight, tz: 7 });
  });
});
