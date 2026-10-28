// Task 23 in Task 22's trade room: the slots are registered at import (screens.ts), the copied
// types are gone (payTypes.ts re-exports Task 22's), and the room picks Task 23's screens.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { TradeView } from '../src/api/trade.js';
import { BuyerPay, SellerWaiting } from '../src/screens/trade/BuyerPay.js';
import { screenFor } from '../src/screens/trade/TradeRoom.js';
import '../src/screens/trade/screens.js';

const SRC = fileURLToPath(new URL('../src/screens/trade/', import.meta.url));
const NOW = Date.parse('2026-10-25T12:00:00.000Z');
const view = (over: Partial<TradeView>): TradeView => ({ role: 'buyer', state: 'secured', payBy: new Date(NOW + 60 * 60_000).toISOString(), paidAt: null, pausedAt: null, settling: null, ...over }) as TradeView;

describe("Task 23 in Task 22's trade room", () => {
  it('screens.ts imports BuyerPay.js on Task 23’s line, and payTypes/paySeams copy nothing of Task 22', () => {
    expect(readFileSync(`${SRC}screens.ts`, 'utf8')).toMatch(/^import '\.\/BuyerPay\.js';/m);
    expect(readFileSync(`${SRC}payTypes.ts`, 'utf8')).not.toMatch(/^export (interface|type) \w+ =?/m);
    expect(readFileSync(`${SRC}paySeams.ts`, 'utf8')).not.toMatch(/^export function (postTradeEvent|methodOf)\b/m);
  });

  it('the room picks BuyerPay for the buyer in securing, secured and paid, and SellerWaiting for the seller in secured before payBy', () => {
    for (const state of ['securing', 'secured', 'paid'] as const) expect(screenFor(view({ state }), NOW)).toBe(BuyerPay);
    expect(screenFor(view({ role: 'seller' }), NOW)).toBe(SellerWaiting);
  });
});
