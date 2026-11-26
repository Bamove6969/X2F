// @vitest-environment happy-dom
// Plan 2 Task 18 review round 2, n3: a team member's trade room offers the steps a Trades member
// may take that need no escrow on the member's device (owner question 13(d), team/perms.ts): the
// seller's Propose cancel / Withdraw and Confirm cancel, and the dispute. Never I've paid, the
// buyer's cancel or accepting a cancel (the escrow device's steps), and the escrow never starts.
import { act } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setEscrowClient, type EscrowClient } from '../src/escrow/useEscrow.js';
import type { TradeView } from '../src/api/trade.js';
import { MEMBER_TRADE_COPY } from '../src/screens/settings/teamCopy.js';
import '../src/screens/trade/screens.js';
import { SellerWaitingMember } from '../src/screens/trade/BuyerPay.js';
import { SellerCancelConfirm } from '../src/screens/trade/SellerCancelConfirm.js';
import { memberScreenFor, TradeRoom } from '../src/screens/trade/TradeRoom.js';
import { refreshSession } from '../src/session/useSession.js';
import { SERVER_NOW, sellerView } from '../e2e/refundViews.js';
import { render } from './render.js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const MIN = 60_000;
const iso = (offsetMin: number) => new Date(Date.parse(SERVER_NOW) + offsetMin * MIN).toISOString();
const MEMBER_ME = { kind: 'trader', level: 'full', tradeTag: 'Calcium', member: { name: 'Aurora', roles: ['trades'] } };

/** The seller's view while the buyer still has time to pay (SellerWaiting's slot). */
const waiting = (over: Partial<TradeView> = {}): TradeView => sellerView({ payBy: iso(25), nextDeadline: iso(25), ...over }) as TradeView;
/** The buyer's view in `secured`, before paying. */
const buyerSecured = (over: Partial<TradeView> = {}): TradeView =>
  ({ ...sellerView({ payBy: iso(25), nextDeadline: iso(25) }), role: 'buyer', ...over }) as TradeView;

let tradeView: TradeView;
let calls: string[];
let start: ReturnType<typeof vi.fn<EscrowClient['start']>>;

beforeEach(() => {
  calls = [];
  start = vi.fn<EscrowClient['start']>();
  setEscrowClient({ start, act: vi.fn(async () => {}), retry: vi.fn(), subscribe: () => () => undefined });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method !== 'GET') calls.push(`${method} ${url}${init?.body ? ' ' + String(init.body) : ''}`);
      if (url === '/v1/account/me') return json(MEMBER_ME);
      if (String(url).endsWith('/confirmations')) return json({ confirmations: 10, target: 10 });
      if (method === 'POST' && String(url).endsWith('/events')) {
        const type = (JSON.parse(String(init!.body)) as { type: string }).type;
        if (type === 'propose-cancel') tradeView = { ...tradeView, cancelProposedBy: 'seller' };
        if (type === 'withdraw-cancel') tradeView = { ...tradeView, cancelProposedBy: null };
        if (type === 'confirm-cancel') tradeView = { ...tradeView, cancelConfirmedAt: SERVER_NOW };
        return json(tradeView);
      }
      return json(tradeView);
    }),
  );
  refreshSession();
});
afterEach(() => {
  vi.unstubAllGlobals();
  setEscrowClient(null);
  refreshSession();
});

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
  });
};

async function room(v: TradeView) {
  tradeView = v;
  const r = render(
    <MemoryRouter initialEntries={[`/trade/${v.code}`]}>
      <Routes>
        <Route path="/trade/:code" element={<TradeRoom />} />
      </Routes>
    </MemoryRouter>,
  );
  await flush();
  return r;
}

const button = (host: HTMLElement, name: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === name) as HTMLButtonElement | undefined;
const click = async (b: HTMLElement) => {
  await act(async () => b.click());
  await flush();
};

describe("a team member's trade room (review round 2, n3)", () => {
  it('only escrow-free slots have a member screen', () => {
    const now = Date.parse(SERVER_NOW);
    expect(memberScreenFor(waiting(), now)).toBe(SellerWaitingMember);
    expect(memberScreenFor(waiting({ state: 'refunded', settling: 'buyer-cancel', txHash: 'cd'.repeat(32), closedAt: SERVER_NOW }), now)).toBe(SellerCancelConfirm);
    // Past payBy (SellerRefund), the buyer's BuyerPay, funding and release: the plain status card.
    expect(memberScreenFor(waiting({ payBy: iso(-5) }), now)).toBeNull();
    expect(memberScreenFor(buyerSecured(), now)).toBeNull();
    expect(memberScreenFor(waiting({ state: 'funding' }), now)).toBeNull();
    expect(memberScreenFor(waiting({ state: 'paid', paidAt: iso(-10), confirmBy: iso(20) }), now)).toBeNull();
  });

  it("the seller's member waits with no Propose cancel (design proto review P2), and can withdraw one that stands; the escrow never starts", async () => {
    const { host } = await room(waiting());
    expect(host.querySelector('[data-member] [data-member-screen]')).not.toBeNull();
    expect(host.textContent).toContain(MEMBER_TRADE_COPY.roomWaiting);
    expect(button(host, 'Propose cancel')).toBeUndefined();
    const standing = await room(waiting({ cancelProposedBy: 'seller' }));
    expect(standing.host.textContent).toContain('You proposed cancelling.');
    await click(button(standing.host, 'Withdraw')!);
    expect(calls).toEqual([`POST /v1/trades/${tradeView.code}/events {"type":"withdraw-cancel"}`]);
    // Open dispute is there too (secured: either side may dispute).
    expect([...host.querySelectorAll('a')].some((a) => a.textContent === 'Open dispute')).toBe(true);
    expect(start).not.toHaveBeenCalled();
  });

  it("the seller's member confirms a buyer's cancel once the return is confirmed", async () => {
    const { host } = await room(waiting({ state: 'refunded', settling: 'buyer-cancel', txHash: 'cd'.repeat(32), closedAt: SERVER_NOW }));
    const confirm = button(host, 'Confirm cancel')!;
    expect(confirm.disabled).toBe(false);
    await click(confirm);
    expect(calls).toEqual([`POST /v1/trades/${tradeView.code}/events {"type":"confirm-cancel"}`]);
    expect(host.textContent).toContain('Trade cancelled');
    expect(start).not.toHaveBeenCalled();
  });

  it("the buyer's member gets the status and the notice, no I've paid and no cancel; Open dispute only after I've paid and the wait (proto review P1)", async () => {
    const before = await room(buyerSecured());
    expect(before.host.querySelector('[data-part="member-waiting"]')?.textContent).toBe(MEMBER_TRADE_COPY.roomWaiting);
    expect([...before.host.querySelectorAll('button, a')].map((b) => b.textContent)).toEqual([]);
    before.unmount();
    const { host } = await room(buyerSecured({ state: 'paid', paidAt: iso(-100), confirmBy: iso(-10) }));
    const names = [...host.querySelectorAll('button, a')].map((b) => b.textContent);
    expect(names).toEqual(['Open dispute']);
    expect(host.querySelector('a')!.getAttribute('href')).toBe(`/trade/${encodeURIComponent(tradeView.code)}/dispute`);
    expect(start).not.toHaveBeenCalled();
  });

  it('a disputed trade links to the dispute; a released one offers nothing', async () => {
    const disputed = await room(buyerSecured({ state: 'disputed', dispute: { by: 'buyer', at: iso(-30) } }));
    expect([...disputed.host.querySelectorAll('a')].map((a) => a.textContent)).toEqual(['Go to the dispute']);
    disputed.unmount();
    const released = await room(waiting({ state: 'released', closedAt: iso(-1) }));
    expect(released.host.querySelectorAll('button, a')).toHaveLength(0);
    expect(calls).toEqual([]);
  });
});
