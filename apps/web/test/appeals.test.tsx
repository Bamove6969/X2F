// @vitest-environment happy-dom
// Plan 4 Task 24 on the trader side:
// - D-005: "File appeal" on the trade page (and, once the completed-trades list is built, on its
//   row), from the trade view's `appealUntil`; it is gone at the deadline, by the server clock.
// - D-011: an appeal nobody may review waits; both traders are told it waits for an independent reviewer.
import { act } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TradeView } from '../src/api/trade.js';
import { setEscrowClient, type EscrowClient } from '../src/escrow/useEscrow.js';
import { parseDispute, type DisputeTrade, type DisputeView } from '../src/screens/dispute/api.js';
import { DisputeRuling } from '../src/screens/dispute/DisputeRuling.js';
import { FileAppeal, appealOpen } from '../src/screens/dispute/FileAppeal.js';
import '../src/screens/trade/screens.js';
import { TradeRoom } from '../src/screens/trade/TradeRoom.js';
import { refreshSession } from '../src/session/useSession.js';
import { SERVER_NOW, sellerView } from '../e2e/refundViews.js';
import { render } from './render.js';

const MIN = 60_000;
const NOW = Date.parse(SERVER_NOW);
const iso = (offsetMin: number) => new Date(NOW + offsetMin * MIN).toISOString();
const CODE = 'K7M2-9QXA-4FTR-8WPN';
const href = `/trade/${encodeURIComponent(CODE)}/dispute`;

const links = (host: HTMLElement) => [...host.querySelectorAll('a')].filter((a) => a.textContent === 'File appeal');

describe('appealOpen and FileAppeal (D-005)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is open strictly before the deadline, never without one or with a bad one', () => {
    expect(appealOpen(iso(1), NOW)).toBe(true);
    expect(appealOpen(iso(0), NOW)).toBe(false);
    expect(appealOpen(null, NOW)).toBe(false);
    expect(appealOpen(undefined, NOW)).toBe(false);
    expect(appealOpen('not a date', NOW)).toBe(false);
  });

  it('links to the appeal with the exact deadline, and is gone when the deadline passes on the server clock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    // The server clock runs 10 min ahead of this device: the deadline is the server's.
    const clock = () => new Date(Date.now() + 10 * MIN);
    const { host } = render(
      <MemoryRouter>
        <FileAppeal code={CODE} appealUntil={iso(11)} serverClock={clock} />
      </MemoryRouter>,
    );
    expect(links(host).map((a) => a.getAttribute('href'))).toEqual([href]);
    expect(host.querySelector('[data-part="file-appeal"] time')?.getAttribute('datetime')).toBe(iso(11));
    act(() => {
      vi.advanceTimersByTime(MIN - 1);
    });
    expect(links(host)).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(links(host)).toHaveLength(0);
    expect(host.querySelector('[data-part="file-appeal"]')).toBeNull();
  });

  it('shows nothing without a deadline or once it has passed', () => {
    const clock = () => new Date(NOW);
    for (const until of [null, iso(0), iso(-5)]) {
      const { host } = render(
        <MemoryRouter>
          <FileAppeal code={CODE} appealUntil={until} serverClock={clock} />
        </MemoryRouter>,
      );
      expect(host.innerHTML, String(until)).toBe('');
    }
  });
});

describe('the trade page offers File appeal while the window is open (D-005)', () => {
  let tradeView: TradeView;
  let me: unknown;
  beforeEach(() => {
    setEscrowClient({ start: vi.fn(), act: vi.fn(async () => {}), retry: vi.fn(), subscribe: () => () => undefined } as unknown as EscrowClient);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
        if (url === '/v1/account/me') return json(me);
        if (String(url).endsWith('/confirmations')) return json({ confirmations: 10, target: 10 });
        return json(tradeView);
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setEscrowClient(null);
    refreshSession();
  });

  async function room(v: TradeView) {
    tradeView = v;
    refreshSession();
    const r = render(
      <MemoryRouter initialEntries={[`/trade/${v.code}`]}>
        <Routes>
          <Route path="/trade/:code" element={<TradeRoom />} />
        </Routes>
      </MemoryRouter>,
    );
    await act(async () => {
      for (let i = 0; i < 8; i++) await new Promise((res) => setTimeout(res, 0));
    });
    return r;
  }

  const released = (over: Partial<TradeView> = {}): TradeView =>
    sellerView({
      state: 'released', settling: 'release', closedAt: iso(-60), txHash: 'cd'.repeat(32),
      dispute: { by: 'buyer', at: iso(-300) }, ...over,
    } as Partial<TradeView>) as TradeView;

  it("the account owner's room, on a trade settled by a ruling", async () => {
    me = { kind: 'trader', level: 'full', displayName: 'Calcium' };
    const open = await room(released({ appealUntil: iso(120) }));
    expect(links(open.host).map((a) => a.getAttribute('href'))).toEqual([`/trade/${encodeURIComponent(tradeView.code)}/dispute`]);
    open.unmount();
    const closed = await room(released({ appealUntil: null }));
    expect(links(closed.host)).toHaveLength(0);
  });

  it("a team member's room (the API sends the deadline only to a member with the File an appeal box)", async () => {
    me = { kind: 'trader', level: 'full', displayName: 'Calcium', member: { name: 'Aurora', roles: ['trades'] } };
    const open = await room(released({ appealUntil: iso(120) }));
    expect(open.host.querySelector('[data-member]')).not.toBeNull();
    expect(links(open.host)).toHaveLength(1);
    open.unmount();
    const none = await room(released({ appealUntil: null }));
    expect(links(none.host)).toHaveLength(0);
  });

  it('not inside a disputed trade: the ruling page has its own appeal form', async () => {
    me = { kind: 'trader', level: 'full', displayName: 'Calcium' };
    const { host } = await room(released({ state: 'disputed', settling: null, closedAt: null, txHash: null, appealUntil: iso(120) }));
    expect(links(host)).toHaveLength(0);
  });
});

describe('an appeal waiting for an independent reviewer (D-011)', () => {
  const T = (over: Partial<DisputeTrade> = {}): DisputeTrade => ({
    code: CODE, role: 'buyer', state: 'released', counterparty: 'satoshi_ghost', methodId: 'ZELLE', whatItIs: 'Zelle.',
    amountAtomic: '1250000000000', poster: 'seller', currency: 'USD', paidAt: iso(-500), confirmBy: iso(-410), confirmWindowMin: 90,
    settleBy: null, closedAt: iso(-60), dispute: { by: 'buyer', at: iso(-400) }, serverNow: SERVER_NOW, ...over,
  });
  const appealed = (waiting: boolean): DisputeView => ({
    openedBy: 'buyer', reason: 'paid', openedAt: iso(-400), afterRefund: false, dueAt: iso(2800), status: 'appealed',
    moderator: { name: 'sarah.v', joinedAt: iso(-390) },
    ruling: {
      round: 1, outcome: 'release-to-buyer', reason: 'The payment is in the seller\'s activity.', evidence: [], moderatorName: 'sarah.v',
      ruledAt: iso(-300), appealUntil: iso(2580), destination: null,
    },
    appeal: { by: 'buyer', at: iso(-10) },
    appealWaiting: waiting,
    serverNow: SERVER_NOW,
  });
  const clock = () => new Date(NOW);

  it('parses appealWaiting: absent from an older API reads as false; anything but a boolean is refused', () => {
    const base = { ...appealed(true) } as Record<string, unknown>;
    expect(parseDispute(base).appealWaiting).toBe(true);
    delete base.appealWaiting;
    expect(parseDispute(base).appealWaiting).toBe(false);
    expect(() => parseDispute({ ...base, appealWaiting: 'yes' })).toThrow(/appealWaiting/);
  });

  it('the appellant reads that their appeal waits; the other side reads that the appeal waits', () => {
    const mine = render(
      <MemoryRouter>
        <DisputeRuling trade={T()} methodName="Zelle" dispute={appealed(true)} serverClock={clock} onAppeal={async () => undefined} />
      </MemoryRouter>,
    );
    expect(mine.host.querySelector('[data-part="appeal-waiting"]')?.textContent).toBe('Your appeal is waiting for an independent reviewer.');
    const theirs = render(
      <MemoryRouter>
        <DisputeRuling trade={T({ role: 'seller', counterparty: 'mira.k' })} methodName="Zelle" dispute={appealed(true)} serverClock={clock} onAppeal={async () => undefined} />
      </MemoryRouter>,
    );
    expect(theirs.host.querySelector('[data-part="appeal-waiting"]')?.textContent).toBe('The appeal is waiting for an independent reviewer.');
    const none = render(
      <MemoryRouter>
        <DisputeRuling trade={T()} methodName="Zelle" dispute={appealed(false)} serverClock={clock} onAppeal={async () => undefined} />
      </MemoryRouter>,
    );
    expect(none.host.querySelector('[data-part="appeal-waiting"]')).toBeNull();
  });
});
