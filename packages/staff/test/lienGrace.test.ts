// Owner decision 26 Nov 2026 (5:43 PM): a lien ruled with 7 days to pay the agreed way.
import { describe, expect, it } from 'vitest';
import {
  KEY_TAP_KINDS,
  LIEN_GRACE_DAYS,
  LIEN_GRACE_METHOD_MAX,
  LIEN_LAPSE_STARTS_COLLECTING,
  graceUntilOf,
  lienCollecting,
  parseLienPlan,
  rulingMayPlaceLien,
  tapChallenge,
  type Round1,
} from '../src/index.js';

const r1 = (outcome: Round1['outcome']) => ({ outcome });

describe('lien grace (owner 26 Nov 2026)', () => {
  it('is 7 days from the ruling, and a lapse alone does not start collecting (lead reading)', () => {
    expect(LIEN_GRACE_DAYS).toBe(7);
    expect(LIEN_LAPSE_STARTS_COLLECTING).toBe(false);
    expect(graceUntilOf(new Date('2026-11-26T12:00:00Z')).toISOString()).toBe('2026-12-03T12:00:00.000Z');
  });

  it('collects when never in grace or switched to collecting, never once paid off the platform', () => {
    const t = '2026-12-03T12:00:00Z';
    expect(lienCollecting({ graceUntil: null, collectStartedAt: null, repaidOffPlatformAt: null })).toBe(true);
    expect(lienCollecting({ graceUntil: t, collectStartedAt: null, repaidOffPlatformAt: null })).toBe(false);
    expect(lienCollecting({ graceUntil: t, collectStartedAt: t, repaidOffPlatformAt: null })).toBe(true);
    expect(lienCollecting({ graceUntil: t, collectStartedAt: null, repaidOffPlatformAt: t })).toBe(false);
    expect(lienCollecting({ graceUntil: null, collectStartedAt: null, repaidOffPlatformAt: t })).toBe(false);
  });

  it('parses the plan strictly: collect, or grace with a 1..500 character method (trimmed)', () => {
    expect(parseLienPlan({ mode: 'collect' })).toEqual({ mode: 'collect', rateBps: 10_000, rateReason: null });
    // Owner 26 Nov 5:51 PM: a share under 100% carries its reason.
    expect(parseLienPlan({ mode: 'collect', rateBps: 2500, rateReason: ' Can afford a quarter ' })).toEqual({ mode: 'collect', rateBps: 2500, rateReason: 'Can afford a quarter' });
    expect(parseLienPlan({ mode: 'collect', rateBps: 10_000 })).toEqual({ mode: 'collect', rateBps: 10_000, rateReason: null });
    for (const bad of [{ mode: 'collect', rateBps: 2500 }, { mode: 'collect', rateBps: 0, rateReason: 'x' }, { mode: 'collect', rateBps: 10_001, rateReason: 'x' },
      { mode: 'collect', rateBps: 25.5, rateReason: 'x' }, { mode: 'collect', rateBps: 2500, rateReason: ' ' }, { mode: 'collect', rateBps: 10_000, rateReason: 'x' }]) {
      expect(parseLienPlan(bad)).toBeNull();
    }
    expect(parseLienPlan({ mode: 'grace', method: '  New PayPal payment of $120 ' })).toEqual({ mode: 'grace', method: 'New PayPal payment of $120' });
    expect(parseLienPlan({ mode: 'grace', method: 'x'.repeat(LIEN_GRACE_METHOD_MAX) })).not.toBeNull();
    for (const bad of [
      null, 'collect', [], {}, { mode: 'collect', method: 'x' }, { mode: 'grace' }, { mode: 'grace', method: '   ' },
      { mode: 'grace', method: 'x'.repeat(LIEN_GRACE_METHOD_MAX + 1) }, { mode: 'grace', method: 'a\u0000b' }, { mode: 'grace', method: 3 },
      { mode: 'grace', method: 'ok', extra: 1 }, { mode: 'later' },
    ]) expect(parseLienPlan(bad)).toBeNull();
  });

  it('asks for the plan only on a ruling that may place a lien', () => {
    expect(rulingMayPlaceLien({ round: 1, afterRefund: true, round1: null }, 'seller-sends-xmr')).toBe(true);
    expect(rulingMayPlaceLien({ round: 1, afterRefund: true, round1: null }, 'no-action')).toBe(false);
    expect(rulingMayPlaceLien({ round: 1, afterRefund: false, round1: null }, 'release-to-buyer')).toBe(false);
    // Round 2: an overturn of an escrow ruling, or of a paid order, or a new order to send the XMR.
    expect(rulingMayPlaceLien({ round: 2, afterRefund: false, round1: r1('release-to-buyer') }, 'refund-to-seller')).toBe(true);
    expect(rulingMayPlaceLien({ round: 2, afterRefund: false, round1: r1('release-to-buyer') }, 'release-to-buyer')).toBe(false);
    expect(rulingMayPlaceLien({ round: 2, afterRefund: true, round1: r1('seller-sends-xmr') }, 'no-action')).toBe(true);
    expect(rulingMayPlaceLien({ round: 2, afterRefund: true, round1: r1('no-action') }, 'seller-sends-xmr')).toBe(true);
    expect(rulingMayPlaceLien({ round: 2, afterRefund: true, round1: r1('seller-returns-fiat') }, 'no-action')).toBe(false);
  });

  it('the lien-collect tap is a known kind bound to its lien', () => {
    expect(KEY_TAP_KINDS).toContain('lien-collect');
    const nonce = new Uint8Array(16);
    const a = tapChallenge({ kind: 'lien-collect', lienId: '0d1f6c4e-3a5b-4c2d-9e8f-0a1b2c3d4e5f', rateBps: 10_000 }, nonce);
    const b = tapChallenge({ kind: 'lien-collect', lienId: '0d1f6c4e-3a5b-4c2d-9e8f-0a1b2c3d4e5f', rateBps: 5000 }, nonce);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });
});
