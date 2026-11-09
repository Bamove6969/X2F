// Plan 3 Task 10: the signals channel payloads, one schema for the trader apps and the moderation service.
import { describe, expect, it } from 'vitest';
import { SIGNAL_TYPES, isSignalType, parseSignalDeal, signalAddressKey, signalPayloadOk } from '../src/index.js';

const DEAL = { poster: 'seller', takeAmountAtomic: 250_000_000_000n, currency: 'USD', centsPerXmr: 16_250n, maxFiatCents: 100_000n };
const ADDR = '8'.padEnd(95, 'S');

describe('signal payloads', () => {
  it('terms carry the sender role’s address key and the deal as bigints', () => {
    expect(signalAddressKey('seller')).toBe('refundAddress');
    expect(signalAddressKey('buyer')).toBe('payoutAddress');
    expect(signalPayloadOk('trade.terms', 'seller', { refundAddress: ADDR, deal: DEAL })).toBe(true);
    expect(signalPayloadOk('trade.terms', 'buyer', { payoutAddress: ADDR, deal: DEAL })).toBe(true);
    // the wrong key for the sender, a missing or extra key, a string amount, the mod as sender
    expect(signalPayloadOk('trade.terms', 'seller', { payoutAddress: ADDR, deal: DEAL })).toBe(false);
    expect(signalPayloadOk('trade.terms', 'seller', { refundAddress: ADDR })).toBe(false);
    expect(signalPayloadOk('trade.terms', 'seller', { refundAddress: ADDR, deal: DEAL, x: 1 })).toBe(false);
    expect(signalPayloadOk('trade.terms', 'seller', { refundAddress: ADDR, deal: { ...DEAL, takeAmountAtomic: '250000000000' } })).toBe(false);
    expect(signalPayloadOk('trade.terms', 'mod', { refundAddress: ADDR, deal: DEAL })).toBe(false);
    expect(signalPayloadOk('trade.terms', 'seller', { refundAddress: 'x'.repeat(257), deal: DEAL })).toBe(false);
    expect(parseSignalDeal({ ...DEAL, currency: 'usd' })).toBeNull();
    expect(parseSignalDeal({ ...DEAL, maxFiatCents: 0n })).toBeNull();
  });

  it('trade.paid carries the fixed amount and the confirmed total; the rest are empty', () => {
    expect(signalPayloadOk('trade.paid', 'buyer', { amountAtomic: 1n, fiatCents: 1n })).toBe(true);
    expect(signalPayloadOk('trade.paid', 'buyer', {})).toBe(false);
    expect(signalPayloadOk('trade.paid', 'buyer', { amountAtomic: 1, fiatCents: 1n })).toBe(false);
    expect(signalPayloadOk('trade.paid', 'seller', { amountAtomic: 1n, fiatCents: 1n })).toBe(false);
    expect(signalPayloadOk('trade.cancel', 'buyer', {})).toBe(true);
    expect(signalPayloadOk('trade.cancel', 'seller', {})).toBe(false);
    expect(signalPayloadOk('trade.extend', 'seller', {})).toBe(true);
    expect(signalPayloadOk('trade.refund-request', 'seller', {})).toBe(true);
    expect(signalPayloadOk('trade.refund-request', 'seller', { why: 'x' })).toBe(false);
  });

  it('trade.ack names a signal type and comes only from the moderator', () => {
    expect(signalPayloadOk('trade.ack', 'mod', { of: 'trade.terms' })).toBe(true);
    expect(signalPayloadOk('trade.ack', 'mod', { of: 'trade.ack' })).toBe(false);
    expect(signalPayloadOk('trade.ack', 'mod', { of: 'other' })).toBe(false);
    expect(signalPayloadOk('trade.ack', 'buyer', { of: 'trade.terms' })).toBe(false);
    expect(SIGNAL_TYPES.every(isSignalType)).toBe(true);
    expect(isSignalType('spend.info')).toBe(false);
  });
});
