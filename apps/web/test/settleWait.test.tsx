// @vitest-environment happy-dom
// While a trade is settling, the room says what it waits for (Task 9 I/O, open edge 2): once a
// trader's side of the settlement was claimed done (`releaseClaimedAt`), the network's sweep, with
// no countdown and no time's-up look, even past `settleBy`; before that, the signing window.
import { describe, expect, it } from 'vitest';
import type { TradeView } from '../src/api/trade.js';
import { SettleWait, settleWaitOf } from '../src/screens/trade/settleWait.js';
import { StatusCard } from '../src/screens/trade/TradeRoom.js';
import { sellerView } from '../e2e/refundViews.js';
import { render } from './render.js';

const NOW = '2026-10-25T12:00:00.000Z';
const at = (min: number) => new Date(Date.parse(NOW) + min * 60_000).toISOString();
const clock = () => new Date(NOW);
const settling = (over: Partial<TradeView> = {}): TradeView =>
  sellerView({ state: 'settling', settling: 'release', settleBy: at(10), nextDeadline: at(10), serverNow: NOW, ...over });
const claimed = (over: Partial<TradeView> = {}) => settling({ releaseClaimedAt: at(-2), nextDeadline: null, ...over });

describe('settleWaitOf', () => {
  it('claimed while settling, else the window while settling, else nothing', () => {
    expect(settleWaitOf(claimed())).toBe('claimed');
    expect(settleWaitOf(claimed({ settleBy: at(-30) }))).toBe('claimed');
    expect(settleWaitOf(settling())).toBe('window');
    expect(settleWaitOf(settling({ settleBy: null }))).toBeNull();
    expect(settleWaitOf(sellerView({ state: 'paid', releaseClaimedAt: null }))).toBeNull();
    // A stale claim on a trade that left settling says nothing.
    expect(settleWaitOf(sellerView({ state: 'released', releaseClaimedAt: at(-5) }))).toBeNull();
  });
});

describe('SettleWait', () => {
  it('a claimed release waits for the network: no countdown, even long past settleBy', () => {
    for (const settleBy of [at(10), at(-1), at(-300)]) {
      const { host } = render(<SettleWait view={claimed({ settleBy })} serverClock={clock} />);
      expect(host.textContent).toBe('Release sent, waiting for the network');
      expect(host.querySelector('[role="timer"]')).toBeNull();
      expect(host.querySelector('[data-settle-wait="claimed"]')).not.toBeNull();
    }
  });

  it('a claimed refund names the refund', () => {
    for (const kind of ['mutual-cancel', 'buyer-cancel', 'auto-refund', 'lapse-refund'] as const) {
      const { host } = render(<SettleWait view={claimed({ settling: kind })} serverClock={clock} />);
      expect(host.textContent).toBe('Refund sent, waiting for the network');
    }
  });

  it('an unclaimed settlement counts down the signing window on the server clock', () => {
    const { host } = render(<SettleWait view={settling()} serverClock={clock} />);
    expect(host.querySelector('[data-settle-wait="window"] [role="timer"]')?.textContent).toBe('10 min');
    expect(host.textContent).toBe('10 min left to sign');
    expect(host.textContent).not.toMatch(/waiting for the network/);
  });

  it('shows nothing outside settling', () => {
    const { host } = render(<SettleWait view={sellerView()} serverClock={clock} />);
    expect(host.textContent).toBe('');
  });
});

describe('StatusCard while settling (no Task 24 screen on this line)', () => {
  it('claimed: the wait line, no timer; unclaimed: the window; dispute access untouched (settleBy still in the view)', () => {
    const c = render(<StatusCard view={claimed({ settleBy: at(-20) })} serverClock={clock} />);
    expect(c.host.textContent).toContain('Release sent, waiting for the network');
    expect(c.host.querySelector('[role="timer"]')).toBeNull();
    const u = render(<StatusCard view={settling()} serverClock={clock} />);
    expect(u.host.textContent).toContain('10 min left to sign');
    expect(u.host.textContent).not.toContain('waiting for the network');
  });
});
