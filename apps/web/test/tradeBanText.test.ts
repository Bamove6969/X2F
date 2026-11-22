// Plan 4 Task 27, lead call (Q4): a 409 trade-ban carries { reasonCode, until }; the take and post
// popups say the general reason and the end. COPY-UNSIGNED.
import { describe, expect, it } from 'vitest';
import { BAN_REASON_TEXT, TRADE_BAN_TEXT, postCantDoText, takeCantDoText, tradeBanOf } from '../src/ui/cantDoCodes.js';

const TAKE = { stageName: null, capText: null, maxOpen: null, minTrades: 0 };

describe('the trade-ban popup (Task 27, Q4)', () => {
  it('reads the reason and the end from the refusal, and nothing else', () => {
    expect(tradeBanOf({ reasonCode: 'abuse', until: '2026-11-19T12:00:00.000Z' })).toEqual({ reasonCode: 'abuse', until: '2026-11-19T12:00:00.000Z' });
    expect(tradeBanOf({ reasonCode: 'terms', until: null })).toEqual({ reasonCode: 'terms', until: null });
    for (const bad of [undefined, {}, { reasonCode: 'nope', until: null }, { reasonCode: 'abuse', until: 'soon' }, { reasonCode: 'abuse' }]) {
      expect(tradeBanOf(bad as Record<string, unknown> | undefined), JSON.stringify(bad)).toBeNull();
    }
  });

  it('take and post say the reason and the exact end, or that it is permanent', () => {
    const timed = tradeBanOf({ reasonCode: 'trade-problems', until: '2026-11-19T12:00:00.000Z' });
    const timedText = `Your account is banned from trading until 19 Nov 2026, 12:00 UTC. Reason: ${BAN_REASON_TEXT['trade-problems']}. Trades you already started carry on.`;
    expect(takeCantDoText('trade-ban', { ...TAKE, ban: timed })).toBe(timedText);
    expect(postCantDoText('trade-ban', null, timed)).toBe(timedText);
    const life = tradeBanOf({ reasonCode: 'abuse', until: null });
    expect(postCantDoText('trade-ban', null, life)).toBe(`Your account is permanently banned from trading. Reason: ${BAN_REASON_TEXT.abuse}. Trades you already started carry on.`);
    // Without the fields (an older API), the general words.
    expect(takeCantDoText('trade-ban', TAKE)).toBe(TRADE_BAN_TEXT);
    expect(postCantDoText('trade-ban')).toBe(TRADE_BAN_TEXT);
  });
});
