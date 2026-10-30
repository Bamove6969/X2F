// @vitest-environment happy-dom
// Task 20 round-3 review n1: in the wide layout the room's `#chat` re-checks whether the screen on
// show draws its own chat aside whenever the chosen screen changes, not only on a state or role
// change. A seller in `secured` goes from SellerWaiting (its own aside) to SellerRefund (no aside,
// a Chat link to `#chat`) by time alone; with the URL already at `#chat`, that Chat link must still
// open the chat sheet.
import { act } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setEscrowClient, type EscrowClient } from '../src/escrow/useEscrow.js';
import { sellerView } from '../e2e/refundViews.js';
import { setTradeChat } from '../src/screens/trade/paySeams.js';
import { TradeRoom } from '../src/screens/trade/TradeRoom.js';
import '../src/screens/trade/screens.js';
import { render } from './render.js';

const CODE = 'K7M2-9QXA-4FTR-8WPN';
const T0 = Date.parse('2026-10-25T13:40:00.000Z');
/** The payment window ends one minute after the room opens. */
const PAY_BY = new Date(T0 + 60_000).toISOString();

const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

function StubChat({ name }: { code: string; name: string }) {
  return (
    <div data-stub-chat="">
      <p>Chat with {name}</p>
      <textarea aria-label="Message" />
    </div>
  );
}

/** Every width query matches (a 1280 px window, no segments, no posture): the wide layout. */
function setWide(): void {
  window.matchMedia = ((query: string) => ({
    matches: query.startsWith('(min-width'),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const flush = async () => {
  for (let i = 0; i < 6; i++) await act(async () => await Promise.resolve());
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(T0);
  setWide();
  setTradeChat(StubChat);
  const client: EscrowClient = { start: vi.fn(), act: vi.fn(async () => {}), retry: vi.fn(), subscribe: () => () => undefined };
  setEscrowClient(client);
  // The server's clock follows the (fake) wall clock; the next deadline is the end of the payment window.
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(sellerView({ code: CODE, payBy: PAY_BY, nextDeadline: PAY_BY, serverNow: new Date(Date.now()).toISOString() }))));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setTradeChat(null);
  setEscrowClient(null);
});

describe("wide #chat follows the screen chosen by time (Task 20 round-3 review n1)", () => {
  it('SellerWaiting → SellerRefund past payBy, URL already at #chat: the Chat link opens the chat sheet', async () => {
    const r = render(
      <MemoryRouter initialEntries={[`/trade/${CODE}#chat`]}>
        <Routes>
          <Route path="/trade/:code" element={<TradeRoom />} />
        </Routes>
      </MemoryRouter>,
    );
    await flush();
    const sheet = () => document.querySelector('.x2f-sheet');
    // SellerWaiting draws its own chat aside: no second chat in a sheet.
    expect(r.host.querySelector("[data-pane='main'] .x2f-room__chat-panel [data-stub-chat]")).not.toBeNull();
    expect(sheet()).toBeNull();

    // The payment window ends; the room's deadline re-read switches the screen within `secured`.
    await act(async () => {
      vi.advanceTimersByTime(62_000);
    });
    await flush();
    expect(r.host.querySelector('[data-trade-state=secured]')).not.toBeNull();
    expect(r.host.querySelector("[data-pane='main'] .x2f-room__chat-panel")).toBeNull();
    const link = r.host.querySelector<HTMLAnchorElement>('a[data-chat-link]');
    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toBe(`/trade/${CODE}#chat`);

    await act(async () => link!.click());
    await flush();
    expect(sheet()).not.toBeNull();
    expect(sheet()!.querySelector('[data-stub-chat]')).not.toBeNull();
  });
});
