// Tests for PR #45 (owner 26 Nov 2026, 5:43 and 5:51 PM): "Collect now" with a share the moderator
// sets (1..100%, in basis points), or 7 days to pay the agreed way. The bounds of the share and the
// edges of the 7-day window, pure (apps/api/src/disputes/lienGrace.ts enforces them).
import { describe, expect, it } from 'vitest';
import { LIEN_FULL_RATE_BPS, LIEN_GRACE_DAYS, graceUntilOf, lienCollecting, parseCollectRate, parseLienPlan } from '../src/index.js';

const DAY = 86_400_000;

describe('the collecting share (rateBps, 100% = 10000)', () => {
  it('100% needs no reason and is the default', () => {
    expect(LIEN_FULL_RATE_BPS).toBe(10_000);
    expect(parseCollectRate({})).toEqual({ mode: 'collect', rateBps: 10_000, rateReason: null });
    expect(parseCollectRate({ rateBps: 10_000 })).toEqual({ mode: 'collect', rateBps: 10_000, rateReason: null });
    expect(parseCollectRate({ rateBps: 10_000, rateReason: null })).toEqual({ mode: 'collect', rateBps: 10_000, rateReason: null });
  });

  it('0% is refused (0 bps), with or without a reason', () => {
    expect(parseCollectRate({ rateBps: 0 })).toBeNull();
    expect(parseCollectRate({ rateBps: 0, rateReason: 'Cannot afford anything' })).toBeNull();
    expect(parseLienPlan({ mode: 'collect', rateBps: 0, rateReason: 'Cannot afford anything' })).toBeNull();
  });

  it('the lowest share (1 bps = 0.01%) and the highest under 100% (9999 bps) are accepted with a reason', () => {
    expect(parseCollectRate({ rateBps: 1, rateReason: 'x' })).toEqual({ mode: 'collect', rateBps: 1, rateReason: 'x' });
    expect(parseCollectRate({ rateBps: 9_999, rateReason: 'x' })).toEqual({ mode: 'collect', rateBps: 9_999, rateReason: 'x' });
    expect(parseCollectRate({ rateBps: 100, rateReason: '1% is all they can afford' })).toEqual({ mode: 'collect', rateBps: 100, rateReason: '1% is all they can afford' });
  });

  it('above 100%, negative, fractional, non-numeric or unsafe shares are refused', () => {
    for (const rateBps of [10_001, 20_000, -1, -10_000, 0.5, 2_500.25, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, '5000', '100%', null, true, {}]) {
      expect(parseCollectRate({ rateBps, rateReason: 'reason' })).toBeNull();
    }
  });

  it('under 100% the reason is required (1..500 characters after trimming, no control characters); at 100% one is refused', () => {
    expect(parseCollectRate({ rateBps: 5_000 })).toBeNull();
    expect(parseCollectRate({ rateBps: 5_000, rateReason: null })).toBeNull();
    expect(parseCollectRate({ rateBps: 5_000, rateReason: '' })).toBeNull();
    expect(parseCollectRate({ rateBps: 5_000, rateReason: '   ' })).toBeNull();
    expect(parseCollectRate({ rateBps: 5_000, rateReason: 'x'.repeat(500) })).not.toBeNull();
    expect(parseCollectRate({ rateBps: 5_000, rateReason: 'x'.repeat(501) })).toBeNull();
    expect(parseCollectRate({ rateBps: 5_000, rateReason: `  ${'x'.repeat(500)}  ` })).not.toBeNull();
    expect(parseCollectRate({ rateBps: 5_000, rateReason: 'a\u0007b' })).toBeNull();
    expect(parseCollectRate({ rateBps: 5_000, rateReason: 'line one\nline two' })).not.toBeNull();
    expect(parseCollectRate({ rateBps: 5_000, rateReason: 42 })).toBeNull();
    expect(parseCollectRate({ rateBps: 10_000, rateReason: 'not needed' })).toBeNull();
  });
});

describe('the 7-day window', () => {
  const placed = new Date('2026-11-26T17:43:00.000Z');

  it('ends exactly 7 × 24 hours after the ruling, to the millisecond', () => {
    expect(LIEN_GRACE_DAYS).toBe(7);
    expect(graceUntilOf(placed).getTime() - placed.getTime()).toBe(7 * DAY);
    // A ruling 1 ms before midnight still gets the full 7 days (no rounding to a calendar day).
    const late = new Date('2026-11-30T23:59:59.999Z');
    expect(graceUntilOf(late).toISOString()).toBe('2026-12-07T23:59:59.999Z');
  });

  it('nothing collects during the window or after it until the switch, then collects; paid off the platform never collects', () => {
    const until = graceUntilOf(placed);
    // Whether the window has passed does not decide it: only the switch does (LIEN_LAPSE_STARTS_COLLECTING false).
    expect(lienCollecting({ graceUntil: until, collectStartedAt: null, repaidOffPlatformAt: null })).toBe(false);
    expect(lienCollecting({ graceUntil: until.toISOString(), collectStartedAt: null, repaidOffPlatformAt: null })).toBe(false);
    expect(lienCollecting({ graceUntil: until, collectStartedAt: new Date(until.getTime() + 1), repaidOffPlatformAt: null })).toBe(true);
    // Paid in time (the creditor's sign-off a millisecond before the end): never collects, even after a later switch.
    expect(lienCollecting({ graceUntil: until, collectStartedAt: null, repaidOffPlatformAt: new Date(until.getTime() - 1) })).toBe(false);
    expect(lienCollecting({ graceUntil: until, collectStartedAt: until, repaidOffPlatformAt: new Date(until.getTime() - 1) })).toBe(false);
  });
});
