// Lien recovery (owner rules 16 Nov 2026, docs/lien-recovery.md): partial recovery, no double
// compensation, the per-lien rate (default 50%) and its change request.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RECOVERY_RATE_BPS,
  canDecideRateRequest,
  lienRemaining,
  rateRequestRefusal,
  recoveryFor,
} from '../src/index.js';

const XMR = 1_000_000_000_000n;

describe('recoveryFor (rules 1 and 2)', () => {
  it('defaults to 50%', () => {
    expect(DEFAULT_RECOVERY_RATE_BPS).toBe(5000);
    expect(recoveryFor({ proceedsAtomic: 1n * XMR, rateBps: 5000, freeAtomic: 2n * XMR })).toBe(XMR / 2n);
  });
  it('owner example: owes 2 XMR, a trade makes 0.5 XMR available, recovers 0.5 and 1.5 carries forward', () => {
    // 1 XMR proceeds at 50% = 0.5 XMR available for recovery.
    const r = recoveryFor({ proceedsAtomic: 1n * XMR, rateBps: 5000, freeAtomic: 2n * XMR });
    expect(r).toBe(XMR / 2n);
    expect(lienRemaining(2n * XMR, [r])).toBe((3n * XMR) / 2n);
  });
  it('never more than the remainder (no double compensation)', () => {
    expect(recoveryFor({ proceedsAtomic: 10n * XMR, rateBps: 5000, freeAtomic: 3n })).toBe(3n);
    expect(recoveryFor({ proceedsAtomic: 10n * XMR, rateBps: 10000, freeAtomic: 0n })).toBe(0n);
  });
  it('rounds down, never takes more than the rate', () => {
    expect(recoveryFor({ proceedsAtomic: 3n, rateBps: 5000, freeAtomic: 100n })).toBe(1n);
  });
  it('refuses bad input', () => {
    expect(() => recoveryFor({ proceedsAtomic: -1n, rateBps: 5000, freeAtomic: 1n })).toThrow(RangeError);
    expect(() => recoveryFor({ proceedsAtomic: 1n, rateBps: 0, freeAtomic: 1n })).toThrow(RangeError);
    expect(() => recoveryFor({ proceedsAtomic: 1n, rateBps: 10001, freeAtomic: 1n })).toThrow(RangeError);
    expect(() => recoveryFor({ proceedsAtomic: 1n, rateBps: 50.5, freeAtomic: 1n })).toThrow(RangeError);
    expect(() => recoveryFor({ proceedsAtomic: 1n, rateBps: 5000, freeAtomic: -1n })).toThrow(RangeError);
  });
});

describe('lienRemaining', () => {
  it('owed minus every recovery', () => {
    expect(lienRemaining(10n, [])).toBe(10n);
    expect(lienRemaining(10n, [3n, 7n])).toBe(0n);
  });
  it('refuses recoveries above the amount owed (never negative)', () => {
    expect(() => lienRemaining(10n, [6n, 5n])).toThrow(RangeError);
    expect(() => lienRemaining(10n, [0n])).toThrow(RangeError);
  });
});

describe('rate change request (rule 3)', () => {
  it('a change from the default needs a reason', () => {
    expect(rateRequestRefusal({ rateBps: 2500, reason: '' })).toBe('reason-required');
    expect(rateRequestRefusal({ rateBps: 2500, reason: '   ' })).toBe('reason-required');
    expect(rateRequestRefusal({ rateBps: 2500, reason: 'Hardship shown in chat' })).toBeNull();
  });
  it('the rate is whole basis points from 1 to 10000; the reason is bounded', () => {
    expect(rateRequestRefusal({ rateBps: 0, reason: 'x' })).toBe('bad-rate');
    expect(rateRequestRefusal({ rateBps: 10001, reason: 'x' })).toBe('bad-rate');
    expect(rateRequestRefusal({ rateBps: 12.5, reason: 'x' })).toBe('bad-rate');
    expect(rateRequestRefusal({ rateBps: 3000, reason: 'x'.repeat(501) })).toBe('reason-too-long');
  });
  it('going back to the default still needs a reason (any change goes to a senior)', () => {
    expect(rateRequestRefusal({ rateBps: 5000, reason: '' })).toBe('reason-required');
  });
  it('only a senior or the owner holding rulings.approve, and never the proposer, decides', () => {
    expect(canDecideRateRequest({ role: 'senior', id: 's1' }, 'm1')).toBe(true);
    expect(canDecideRateRequest({ role: 'owner', id: 'o1' }, 'm1')).toBe(true);
    expect(canDecideRateRequest({ role: 'mod', id: 'm2' }, 'm1')).toBe(false);
    expect(canDecideRateRequest({ role: 'helper', id: 'h1' }, 'm1')).toBe(false);
    expect(canDecideRateRequest({ role: 'senior', id: 's1' }, 's1')).toBe(false);
  });
});
