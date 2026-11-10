// @vitest-environment happy-dom
import { act, useEffect } from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TradeView } from '../src/api/trade.js';
import { publicName } from '../src/api/trade.js';
import { setEscrowClient, type EscrowClient } from '../src/escrow/useEscrow.js';
import { resetCourtesy, turnCourtesyOff } from '../src/screens/quote/courtesy.js';
import type { ConfirmedTrade } from '../src/screens/quote/confirmed.js';
import { focusChatPane, focusComposerWhenReady, registerTradeScreen, screenFor, TradeRoom, type TradeScreen } from '../src/screens/trade/TradeRoom.js';
import { sellerView } from '../e2e/refundViews.js';
import { fire, render } from './render.js';

const A: TradeScreen = () => null;
const B: TradeScreen = () => null;
const C: TradeScreen = () => null;

const view = (over: Partial<TradeView> = {}): TradeView =>
  ({ role: 'seller', state: 'secured', payBy: '2026-10-25T12:00:00.000Z', ...over }) as TradeView;

const undo: (() => void)[] = [];
const reg = (...a: Parameters<typeof registerTradeScreen>) => undo.push(registerTradeScreen(...a));
afterEach(() => {
  for (const u of undo.splice(0)) u();
});

describe('trade-room slots', () => {
  it('picks the screen by role and state', () => {
    reg({ owner: 'x', role: 'seller', states: ['secured'], screen: A });
    reg({ owner: 'y', role: 'buyer', states: ['secured', 'securing'], screen: B });
    expect(screenFor(view(), 0)).toBe(A);
    expect(screenFor(view({ role: 'buyer', state: 'securing' }), 0)).toBe(B);
    expect(screenFor(view({ state: 'paid' }), 0)).toBeNull();
  });

  it('a guarded slot wins while its guard holds (e.g. past payBy by the server clock)', () => {
    reg({ owner: 'x', role: 'seller', states: ['secured'], screen: A });
    reg({ owner: 'y', role: 'seller', states: ['secured'], when: (v, now) => now >= Date.parse(v.payBy!), screen: B });
    const payBy = Date.parse('2026-10-25T12:00:00.000Z');
    expect(screenFor(view(), payBy - 1)).toBe(A);
    expect(screenFor(view(), payBy)).toBe(B);
  });

  it("'any' matches both roles", () => {
    reg({ owner: 'x', role: 'any', states: ['disputed'], screen: C });
    expect(screenFor(view({ state: 'disputed' }), 0)).toBe(C);
    expect(screenFor(view({ role: 'buyer', state: 'disputed' }), 0)).toBe(C);
  });

  it('two unguarded slots for the same role and state are refused, naming the owner', () => {
    reg({ owner: 'Task 23', role: 'seller', states: ['secured'], screen: A });
    expect(() => registerTradeScreen({ owner: 'Task 25', role: 'seller', states: ['secured'], screen: B })).toThrow(/Task 23/);
    expect(() => registerTradeScreen({ owner: 'Task 27', role: 'any', states: ['secured'], screen: B })).toThrow(/Task 23/);
  });

  it('refuses unknown or missing states', () => {
    expect(() => registerTradeScreen({ owner: 'x', role: 'buyer', states: [], screen: A })).toThrow();
    expect(() => registerTradeScreen({ owner: 'x', role: 'buyer', states: ['nope' as 'paid'], screen: A })).toThrow(/unknown/);
  });

  it('unregistering frees the slot', () => {
    const off = registerTradeScreen({ owner: 'x', role: 'buyer', states: ['paid'], screen: A });
    off();
    reg({ owner: 'y', role: 'buyer', states: ['paid'], screen: B });
    expect(screenFor(view({ role: 'buyer', state: 'paid' }), 0)).toBe(B);
  });
});

describe('publicName', () => {
  it('reads the display name only (FU-A)', () => {
    expect(publicName({ displayName: 'Mira.K_' })).toBe('Mira.K_');
  });
});

describe('focusComposerWhenReady (Task 20 round-2 review m3)', () => {
  const settle = () => new Promise((r) => setTimeout(r, 0));
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('focuses the pane composer once the chat renders it, not before', async () => {
    const pane = document.createElement('div');
    pane.dataset.pane = 'side';
    document.body.append(pane);
    const stop = focusComposerWhenReady("[data-pane='side']");
    const status = document.createElement('p');
    pane.append(status);
    await settle();
    const box = document.createElement('textarea');
    pane.append(box);
    await settle();
    expect(document.activeElement).toBe(box);
    stop();
  });

  it('never takes the focus from something the user moved it to meanwhile, and stops on cleanup', async () => {
    const pane = document.createElement('div');
    pane.dataset.pane = 'side';
    const other = document.createElement('input');
    document.body.append(pane, other);
    const stop = focusComposerWhenReady("[data-pane='side']");
    other.focus();
    pane.append(document.createElement('textarea'));
    await settle();
    expect(document.activeElement).toBe(other);
    stop();
    const later = focusComposerWhenReady("[data-pane='nowhere']");
    later();
    document.body.append(document.createElement('textarea'));
    await settle();
    expect(document.activeElement).toBe(other);
  });

  it("skips the payee's payment-detail boxes (J-08): the chat's composer gets the focus, now and once it renders", async () => {
    const pane = document.createElement('div');
    pane.dataset.pane = 'side';
    const boxes = document.createElement('form');
    boxes.dataset.payBoxes = '';
    const email = document.createElement('input');
    boxes.append(email);
    pane.append(boxes);
    document.body.append(pane);
    const stop = focusComposerWhenReady("[data-pane='side']");
    await settle();
    expect(document.activeElement).not.toBe(email);
    const composer = document.createElement('textarea');
    pane.append(composer);
    await settle();
    expect(document.activeElement).toBe(composer);
    stop();
    email.focus();
    focusChatPane();
    expect(document.activeElement).toBe(composer);
  });
});


// Build spec j31a section 2 (owner p9-3, T-039) and the design final call (10 Nov 2026): "Trading with
// more than one person?" shows OVER the trade room the first time the room opens for the taker's new
// trade, not on the quote before it (so the browser's Back cannot lose the step into the room, review
// L2). Posters never see it (T-038); "Don't show this again" is kept on this device (quote/courtesy.ts).
describe('the courtesy sheet over the trade room (j31a section 2, design 10 Nov)', () => {
  const CODE = 'K7M2-9QXA-4FTR-8WPN';
  const OTHER = 'Z3H8-6RNB-2DWC-5JTE';
  const deal = { poster: 'buyer' as const, takeAmountAtomic: 1_250_000_000_000n, currency: 'USD', centsPerXmr: 33_000n, maxFiatCents: 50_000n };
  /** What the taker confirmed on the quote (the seller of a buy ad here). */
  const TAKEN: ConfirmedTrade = { role: 'seller', ownAddress: '4' + 'A'.repeat(94), deal };
  const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const sheet = () => document.body.querySelector<HTMLElement>('[data-sheet="courtesy"]');
  const gotIt = () => [...(sheet()?.querySelectorAll('button') ?? [])].find((b) => b.textContent === 'Got it')!;

  /** Navigates to the room the way the take does (memory history cannot take bigints in initialEntries). */
  function Go({ code, state }: { code: string; state: unknown }) {
    const navigate = useNavigate();
    useEffect(() => void navigate(`/trade/${code}`, state === undefined ? {} : { state }), [navigate, code, state]);
    return null;
  }

  async function openRoom(code: string, state?: unknown) {
    const r = render(
      <MemoryRouter initialEntries={['/go']}>
        <Routes>
          <Route path="/go" element={<Go code={code} state={state} />} />
          <Route path="/trade/:code" element={<TradeRoom />} />
        </Routes>
      </MemoryRouter>,
    );
    for (let i = 0; i < 6; i++) await act(async () => await Promise.resolve());
    return r;
  }

  /** The taker's view: the seller of mira.k's buy ad (sellerView: role seller, poster buyer). */
  const taker = (code: string, over: Partial<TradeView> = {}) => ({ ...sellerView(), code, ...over });

  beforeEach(() => {
    sessionStorage.clear();
    resetCourtesy();
    const client: EscrowClient = { start: vi.fn(), act: vi.fn(async () => {}), retry: vi.fn(), subscribe: () => () => undefined };
    setEscrowClient(client);
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(taker(CODE))));
  });

  afterEach(() => {
    resetCourtesy();
    vi.unstubAllGlobals();
    setEscrowClient(null);
  });

  it('arriving from the take, the taker sees the sheet over the room; Got it closes it and the room stays', async () => {
    const r = await openRoom(CODE, { confirmed: TAKEN });
    expect(r.host.querySelector('[data-screen="trade"]')?.getAttribute('data-trade-state')).toBe('secured');
    expect(sheet()).not.toBeNull();
    const dialog = sheet()!.closest('[role="dialog"]')!;
    expect(dialog.querySelector('h2')?.textContent).toBe('Trading with more than one person?');
    expect(sheet()!.textContent).toContain(
      "If you opened trades with several people to see who answers first, close the others once you've picked one. That way nobody is left waiting on you.",
    );
    expect([...sheet()!.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Got it']);
    fire(gotIt(), new MouseEvent('click', { bubbles: true }));
    expect(sheet()).toBeNull();
    expect(r.host.querySelector('[data-screen="trade"]')?.getAttribute('data-trade-state')).toBe('secured');
  });

  it('only the first time this room opens: opened again (a reload, Back then Forward, the same history state) it stays away', async () => {
    const first = await openRoom(CODE, { confirmed: TAKEN });
    expect(sheet()).not.toBeNull();
    fire(gotIt(), new MouseEvent('click', { bubbles: true }));
    first.unmount();
    const again = await openRoom(CODE, { confirmed: TAKEN });
    expect(sheet()).toBeNull();
    again.unmount();
    // Another new trade of the taker's shows it again, until "Don't show this again".
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(taker(OTHER))));
    await openRoom(OTHER, { confirmed: TAKEN });
    expect(sheet()).not.toBeNull();
  });

  it('"Don\'t show this again" is kept on this device: the next new trade\'s room shows none', async () => {
    const first = await openRoom(CODE, { confirmed: TAKEN });
    fire(sheet()!.querySelector('input[type="checkbox"]')!, new MouseEvent('click', { bubbles: true }));
    fire(gotIt(), new MouseEvent('click', { bubbles: true }));
    expect(sheet()).toBeNull();
    first.unmount();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(taker(OTHER))));
    await openRoom(OTHER, { confirmed: TAKEN });
    expect(sheet()).toBeNull();
  });

  it('ticked off earlier on this device, it never shows', async () => {
    turnCourtesyOff();
    await openRoom(CODE, { confirmed: TAKEN });
    expect(sheet()).toBeNull();
  });

  it('a poster never sees it, even arriving from the accept sheet with the confirmed state (T-038)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(taker(CODE, { role: 'buyer', poster: 'buyer' }))));
    const r = await openRoom(CODE, { confirmed: { ...TAKEN, role: 'buyer' } });
    expect(r.host.querySelector('[data-screen="trade"]')?.getAttribute('data-role')).toBe('buyer');
    expect(sheet()).toBeNull();
  });

  it('a room opened without the take\'s history state (a new tab, a push notification, My trades) shows none', async () => {
    await openRoom(CODE);
    expect(sheet()).toBeNull();
  });
});
