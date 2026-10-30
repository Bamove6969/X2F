// @vitest-environment happy-dom
// Task 39 (owner 2026-10-29, option B with a seller confirm step): after a buyer's cancel the
// seller's room says "Cancelling" and offers Confirm cancel, greyed out until the returned XMR has
// all its confirmations; the tap posts `confirm-cancel` (the API checks the count itself).
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serverClock } from '../src/api/client.js';
import type { TradeView } from '../src/api/trade.js';
import { PENDING_ESCROW } from '../src/screens/trade/seams.js';
import { confirmCancelReady, SellerCancelConfirm } from '../src/screens/trade/SellerCancelConfirm.js';
import '../src/screens/trade/screens.js';
import { screenFor, type TradeScreenProps } from '../src/screens/trade/TradeRoom.js';
import { SERVER_NOW, sellerView } from '../e2e/refundViews.js';
import { render } from './render.js';

const TX = 'cd'.repeat(32);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let calls: string[];
let count: number | null;
let postAnswer: () => Response;
beforeEach(() => {
  calls = [];
  count = 3;
  postAnswer = () => json(view({ cancelConfirmedAt: SERVER_NOW }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}${init?.body ? ' ' + String(init.body) : ''}`);
      if (String(url).endsWith('/confirmations')) return json({ confirmations: count, target: 10 });
      return postAnswer();
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const view = (over: Partial<TradeView> = {}): TradeView =>
  sellerView({ state: 'refunded', settling: 'buyer-cancel', txHash: TX, closedAt: SERVER_NOW, ...over }) as TradeView;
const props = (v: TradeView, refresh = vi.fn(async () => undefined)): TradeScreenProps => ({
  code: v.code,
  view: v,
  escrow: PENDING_ESCROW,
  refresh,
  serverClock: serverClock(v.serverNow),
  wide: false,
});
const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
  });
};
const confirmButton = (host: HTMLElement) => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Confirm cancel') as HTMLButtonElement | undefined;

describe("the seller's Confirm cancel", () => {
  it('the room routes the seller to it while a buyer-cancel settles and once it is refunded', () => {
    const now = Date.parse(SERVER_NOW);
    expect(screenFor(view(), now)).toBe(SellerCancelConfirm);
    expect(screenFor(view({ state: 'settling', txHash: null, closedAt: null }), now)).toBe(SellerCancelConfirm);
    expect(screenFor(view({ settling: 'mutual-cancel' }), now)).toBeNull();
  });

  it('review round 2 N1: not for a cancel refund that landed after "I\'ve paid" (the buyer keeps the dispute)', () => {
    const now = Date.parse(SERVER_NOW);
    expect(screenFor(view({ paidAt: SERVER_NOW }), now)).not.toBe(SellerCancelConfirm);
  });

  it('confirmCancelReady: only refunded with all confirmations', () => {
    expect(confirmCancelReady('refunded', 10, 10)).toBe(true);
    expect(confirmCancelReady('refunded', 9, 10)).toBe(false);
    expect(confirmCancelReady('refunded', null, 10)).toBe(false);
    expect(confirmCancelReady('settling', 10, 10)).toBe(false);
  });

  it('while the refund is being sent: "Cancelling" and a greyed-out Confirm cancel', async () => {
    const { host } = render(
      <MemoryRouter>
        <SellerCancelConfirm {...props(view({ state: 'settling', txHash: null, closedAt: null }))} />
      </MemoryRouter>,
    );
    await flush();
    expect(host.textContent).toContain('Cancelling: returning the XMR to you');
    expect(host.textContent).toContain('Waiting for the refund to be sent');
    expect(confirmButton(host)!.disabled).toBe(true);
    expect(calls.filter((c) => c.startsWith('POST'))).toEqual([]);
  });

  it('greyed out at 3 of 10, enabled at 10 of 10; the tap posts confirm-cancel and re-reads', async () => {
    const refresh = vi.fn(async () => undefined);
    const first = render(
      <MemoryRouter>
        <SellerCancelConfirm {...props(view(), refresh)} />
      </MemoryRouter>,
    );
    await flush();
    expect(first.host.textContent).toContain('Confirmations 3 of 10');
    expect(confirmButton(first.host)!.disabled).toBe(true);
    first.unmount();
    count = 10;
    const { host } = render(
      <MemoryRouter>
        <SellerCancelConfirm {...props(view(), refresh)} />
      </MemoryRouter>,
    );
    await flush();
    const b = confirmButton(host)!;
    expect(b.disabled).toBe(false);
    await act(async () => b.click());
    await flush();
    expect(calls.filter((c) => c.startsWith('POST'))).toEqual([`POST /v1/trades/${encodeURIComponent(view().code)}/events {"type":"confirm-cancel"}`]);
    expect(refresh).toHaveBeenCalled();
  });

  it('a too-early refusal is said in words', async () => {
    count = 10;
    postAnswer = () => json({ error: 'too-early' }, 409);
    const { host } = render(
      <MemoryRouter>
        <SellerCancelConfirm {...props(view())} />
      </MemoryRouter>,
    );
    await flush();
    await act(async () => confirmButton(host)!.click());
    await flush();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("doesn't have all its confirmations yet");
  });

  it('once the server recorded the full count: "Your input is needed to cancel this trade." with when it closes by itself (48 h)', async () => {
    count = null; // this device's own read has not come back
    const { host } = render(
      <MemoryRouter>
        <SellerCancelConfirm {...props(view({ cancelConfirmableAt: '2026-10-25T12:00:00.000Z' }))} />
      </MemoryRouter>,
    );
    await flush();
    expect(confirmButton(host)!.disabled).toBe(false);
    // In the viewer's own time zone and locale (review M7): 48 hours after the recorded moment.
    const local = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date('2026-10-27T12:00:00.000Z'));
    expect(host.querySelector('[data-input-needed]')?.textContent).toBe(
      `Your input is needed to cancel this trade. If you don't confirm, it closes as cancelled by itself on ${local}.`,
    );
  });

  it('once confirmed: "Trade cancelled" and no button', async () => {
    const { host } = render(
      <MemoryRouter>
        <SellerCancelConfirm {...props(view({ cancelConfirmedAt: SERVER_NOW }))} />
      </MemoryRouter>,
    );
    await flush();
    expect(host.textContent).toContain('Trade cancelled');
    expect(confirmButton(host)).toBeUndefined();
  });
});
