import { describe, expect, it } from 'vitest';
import { deriveLimits } from '../src/limits.js';

describe('deriveLimits', () => {
  it('derives exact counts from the default 1 GiB budget', () => {
    const l = deriveLimits();
    // peer 512 KiB, per connection 320 KiB, queues 256 MiB, unauth reserve 64 × 320 KiB
    // (0.7 GiB − 256 MiB − 20 MiB) / (3 × 512 KiB + 3 × 320 KiB) = 180 trades
    expect(l.maxPeerBufferedBytes).toBe(524_288);
    expect(l.totalQueueBytes).toBe(268_435_456);
    expect(l.perTradeQueueBytes).toBe(1_048_576);
    expect(l.maxTrades).toBe(180);
    expect(l.maxConnections).toBe(604);
    expect(l.maxPeerBufferedBytes).toBeGreaterThanOrEqual(l.maxEnvelopeBytes);
    expect(l.maxConnections).toBeGreaterThanOrEqual(3 * l.maxTrades);
  });

  it('caps trades by the queue share on a large budget', () => {
    const l = deriveLimits({ memoryBudgetBytes: 2 ** 31 - 1, maxEnvelopeBytes: 4096 });
    expect(l.maxTrades).toBe(Math.floor(l.totalQueueBytes / l.perTradeQueueBytes));
  });

  it('rejects bad values', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 31, 1.5]) {
      expect(() => deriveLimits({ maxEnvelopeBytes: bad })).toThrow(RangeError);
    }
    expect(() => deriveLimits({ rateRefillPerSec: Number.NaN })).toThrow(RangeError);
    expect(() => deriveLimits({ rateRefillPerSec: 0.5 })).not.toThrow();
  });

  it('rejects a budget too small for one trade', () => {
    expect(() => deriveLimits({ memoryBudgetBytes: 8 * 1024 * 1024 })).toThrow(/too small/);
  });
});
