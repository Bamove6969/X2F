// @vitest-environment happy-dom
// Task 18: BuyQuote and the seller quote, rendered against a stubbed API (the Task 3/4/5 shapes in
// src/screens/quote/api.ts, all on the line now).
import { act } from 'react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fiatCents } from '@x2f/trade';
import { BuyQuote } from '../src/screens/quote/BuyQuote.js';
import { SellQuote } from '../src/screens/quote/SellQuote.js';
import { readConfirmed } from '../src/screens/quote/confirmed.js';
import { PENDING_TAKE_KEY, PENDING_TAKE_MS, rememberTake } from '../src/screens/quote/pendingTake.js';
import { quotePath } from '../src/screens/quote/quoteModel.js';
import { forgetQuotes } from '../src/screens/quote/quoteKept.js';
import { resetCourtesy, turnCourtesyOff } from '../src/screens/quote/courtesy.js';
import { OffersRoute } from '../src/screens/browse/OffersRoute.js';
import { BUY_COPY } from '../src/screens/browse/BuyCopy.js';
import { fire, render } from './render.js';

const session = vi.hoisted(() => ({ status: 'signed-in' as 'signed-in' | 'signed-out' | 'loading' }));
vi.mock('../src/session/useSession.js', () => ({
  useSession: () => (session.status === 'signed-in' ? { status: 'signed-in', me: {} } : { status: session.status }),
}));

const poster = (displayName: string) => ({
  displayName,
  completedTrades: 212,
  online: true,
  lastSeenAt: '2026-10-24T00:00:00.000Z',
  typicalMinutes: 6,
  positivePct: 99,
  badges: [],
  stage: 'graduated',
});

const GHOST = { id: 'offer-ghost', poster: poster('satoshi_ghost'), rate: '33000', pricing: { mode: 'market', marginBps: 0 }, minFiatCents: '5000', maxFiatCents: '150000', minTrades: 0 };
const FIXED = { ...GHOST, id: 'offer-fixed', pricing: { mode: 'fixed', centsPerXmr: '34000' }, rate: '34000' };
const MIRA = { ...GHOST, id: 'offer-mira', poster: poster('mira.k') };

const WALLETS = [
  { id: 'w-cake', app: 'cake', label: 'Cake Wallet', address: '4AAAAk3Fz0a', addressEnd: 'DECOY1', usableFrom: '2026-10-01T00:00:00.000Z', usable: true },
  { id: 'w-ledger', app: 'ledger-trezor', label: 'Ledger (via Feather)', address: '4BBBB9QbP0b', addressEnd: 'DECOY2', usableFrom: '2026-10-01T00:00:00.000Z', usable: true },
  { id: 'w-edge', app: 'edge', label: 'Edge', address: '4CCCC7HcW0c', addressEnd: 'DECOY3', usableFrom: '2026-10-25T00:00:00.000Z', usable: false },
];

/** The take body as Task 5 reads it (Revision 2026-10-27): the amount, the wallet and the quoted rate and total. */
interface TakeBody {
  amountAtomic: string;
  walletId: string;
  centsPerXmr: string;
  fiatCents: string;
}

interface Api {
  offers: unknown[];
  price: 'ok' | 'down';
  /** The market rate /v1/price answers now (the board's $330.00 by default). */
  rate: string;
  wallets: unknown[];
  take: (body: TakeBody) => { status: number; json: unknown };
  takes: TakeBody[];
  /** When set, a take's answer waits for it (a take still in flight). */
  gate?: Promise<void>;
}

let stub: Api;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  sessionStorage.clear();
  // The take tests below are about the take and the room it opens; the courtesy sheet between them
  // (T-039) has its own block at the end, which turns it back on.
  turnCourtesyOff();
  arrivedState = null;
  session.status = 'signed-in';
  stub = {
    offers: [GHOST, FIXED, MIRA],
    price: 'ok',
    rate: '33000',
    wallets: WALLETS,
    takes: [],
    take: (body) => ({ status: 200, json: { code: 'K7M2-9QXA-4FTR-8WPN', centsPerXmr: body.centsPerXmr, fiatCents: body.fiatCents } }),
  };
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://x2f.test');
    if (url.pathname === '/v1/offers') return json(200, stub.offers);
    if (url.pathname === '/v1/methods') return json(200, { live: [{ id: 'ZELLE', name: 'Zelle', group: 'Payment apps', giftCard: false, offers: 1, bestRate: '33000' }], all: [] });
    if (url.pathname === '/v1/price') {
      const currency = url.searchParams.get('currency');
      return stub.price === 'ok' ? json(200, { currency, centsPerXmr: stub.rate, exponent: 2, at: '2026-10-24T00:00:00.000Z', usdCentsPerXmr: stub.rate }) : json(503, { error: 'price-unavailable' });
    }
    if (url.pathname === '/v1/wallets') return session.status === 'signed-in' ? json(200, stub.wallets) : json(401, { error: 'not-authenticated' });
    const take = /^\/v1\/offers\/([^/]+)\/take$/.exec(url.pathname);
    if (take && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as TakeBody;
      stub.takes.push(body);
      if (stub.gate) await stub.gate;
      const r = stub.take(body);
      return json(r.status, r.json);
    }
    return json(404, { error: 'not-found' });
  }) as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
  forgetQuotes();
});

/** Where the router went, and the navigation state it carried (read by `arrived`). */
let arrivedState: unknown = null;
function Where() {
  const l = useLocation();
  arrivedState = l.state;
  return <output data-where={l.pathname + l.search} />;
}

/** The browser's Back button, for the panes' history (lead review 2026-11-06 m1). */
function BrowserBack() {
  const navigate = useNavigate();
  return (
    <button type="button" data-browser-back="" onClick={() => void navigate(-1)}>
      browser back
    </button>
  );
}

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function open(url: string) {
  const r = render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/buy/:methodId/:offerId" element={<BuyQuote />} />
        <Route path="/sell/:methodId/:offerId" element={<SellQuote />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  await settle();
  return r;
}

const where = (host: HTMLElement) => host.querySelector('[data-where]')?.getAttribute('data-where') ?? null;
const primary = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('[data-primary]')!;

function type(host: HTMLElement, value: string): void {
  const input = host.querySelector<HTMLInputElement>('#quote-amount')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function pick(host: HTMLElement, walletId: string): void {
  fire(host.querySelector(`input[value="${walletId}"]`)!, new MouseEvent('click', { bubbles: true }));
}

const BUY = quotePath('sell', 'ZELLE', 'offer-ghost', 'USD');

describe('BuyQuote', () => {
  it('design v2 (offers batch 3): the title is the kit screen title, the footnote the kit info Notice', async () => {
    const { host } = await open(`${BUY}&amount=412.50`);
    expect(host.querySelector('.x2f-screen-title')?.textContent).toBe('Buying from satoshi_ghost');
    const note = host.querySelector('.x2f-outcome[data-tone="info"]');
    expect(note?.textContent).toContain('Nothing changes after you tap Trade.');
    expect(note?.getAttribute('role')).toBeNull();
    expect(host.querySelector('.x2f-quote__figure .x2f-section-title')?.textContent).toBe('You receive');
  });

  it('shows the board: title, range help, wallets, You receive, Rate, total and the footnote', async () => {
    const { host } = await open(`${BUY}&amount=412.50`);
    const text = host.textContent ?? '';
    expect(text).toContain('Buying from satoshi_ghost');
    expect(text).toContain('Zelle · USD · $330.00 / XMR');
    expect(text).toContain('satoshi_ghost sells $50 to $1,500 per trade.');
    expect(text).toContain('Which wallet gets paid?');
    expect(text).toContain('1.250000 XMR');
    expect(text).toContain('$412.50 USD');
    expect(text).toContain('You send via Zelle');
    expect(text).toContain("Nothing changes after you tap Trade. satoshi_ghost then has 30 minutes to lock the XMR in escrow. You only pay once it's locked.");
    expect(host.querySelector('[data-username]')?.textContent).toBe('satoshi_ghost');
  });

  it("the header's Chat stays off until the trade starts: aria-disabled, described by its hint, and a tap opens no chat (Task 20 review I1)", async () => {
    const { host } = await open(`${BUY}&amount=412.50`);
    const chat = host.querySelector<HTMLButtonElement>('.x2f-quote__chat')!;
    expect(chat.textContent).toBe('Chat');
    expect(chat.getAttribute('aria-disabled')).toBe('true');
    const hint = host.querySelector(`#${chat.getAttribute('aria-describedby')}`);
    expect(hint?.textContent).toBe('Chat opens once the trade starts.');
    expect(hint?.classList.contains('x2f-quote__chat-hint--shown')).toBe(false);
    fire(chat, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(hint?.classList.contains('x2f-quote__chat-hint--shown')).toBe(true);
    expect(host.querySelector('.x2f-chat')).toBeNull();
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => new URL(String(c[0]), 'http://x2f.test').pathname);
    expect(calls).not.toContain('/v1/chats');
  });

  it('has no X2F fee line, no "1%" and no Deposit row; the network fee row uses the OD-4 copy', async () => {
    const { host } = await open(`${BUY}&amount=412.50`);
    pick(host, 'w-cake');
    const rows = host.querySelector('section[aria-label="What you get"]')!.textContent ?? '';
    expect(rows).not.toContain('X2F');
    expect(host.textContent).not.toContain('1%');
    expect(host.textContent).not.toMatch(/deposit/i);
    expect(rows).toContain('Network feeabout 0.0001 XMR, taken from the payout');
    // The only fee words on the page are the board's footer reassurance.
    expect((host.textContent ?? '').match(/X2F fee/g)).toEqual(['X2F fee']);
    expect(host.textContent).toContain('Taking an offer is free. No X2F fee is added.');
  });

  it('Trade waits for a usable wallet to be picked; waiting wallets are never offered', async () => {
    const { host } = await open(`${BUY}&amount=412.50`);
    expect(primary(host).textContent).toBe('Trade');
    expect(primary(host).disabled).toBe(true);
    expect(host.querySelector('input[value="w-edge"]')).toBeNull();
    expect(host.textContent).toContain('1 more wallet is still waiting');
    pick(host, 'w-ledger');
    expect(primary(host).disabled).toBe(false);
    expect(host.textContent).toContain('In Ledger (via Feather), address ending …9QbP0b');
    // Re-review gap 2: every ending shown is cut from the full address, never the API's addressEnd.
    expect(host.textContent).not.toContain('DECOY');
  });

  it('Trade takes with the quoted amount and the picked wallet, then opens the trade room; the stored total is the quoted one (OD-5)', async () => {
    const { host } = await open(`${BUY}&amount=412.50`);
    pick(host, 'w-cake');
    fire(primary(host), new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(stub.takes).toHaveLength(1);
    const sent = stub.takes[0]!;
    expect(sent.walletId).toBe('w-cake');
    expect(fiatCents(BigInt(sent.amountAtomic), { currency: 'USD', centsPerXmr: 33_000n })).toBe(41_250n);
    // The rate the person saw is the rate that locks: the take carries the quoted rate and total
    // (Task 5 Revision 2026-10-27), so the server locks exactly these or refuses price-changed.
    expect(sent.centsPerXmr).toBe('33000');
    expect(sent.fiatCents).toBe('41250');
    expect(where(host)).toBe('/trade/K7M2-9QXA-4FTR-8WPN');
  });

  it('a price-changed refusal re-quotes at the price now and asks for a fresh tap; nothing is taken until then', async () => {
    const { host } = await open(`${BUY}&amount=412.50`);
    pick(host, 'w-cake');
    expect(host.textContent).toContain('$330.00 / XMR');
    // The feed moved after the quote's last poll: the server refuses the stale rate.
    stub.rate = '34000';
    stub.take = (body) => (body.centsPerXmr === stub.rate ? { status: 200, json: { code: 'K7M2-9QXA-4FTR-8WPN', centsPerXmr: body.centsPerXmr, fiatCents: body.fiatCents } } : { status: 409, json: { error: 'price-changed' } });
    fire(primary(host), new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(stub.takes).toHaveLength(1);
    expect(stub.takes[0]!.centsPerXmr).toBe('33000');
    expect(where(host)).toBeNull();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('The price moved. Check the new total and tap Trade again.');
    // Re-quoted at the price now, with the same typed amount: $412.50 now buys less XMR.
    expect(host.textContent).toContain('$340.00 / XMR');
    expect(host.textContent).not.toContain('$330.00 / XMR');
    expect(host.textContent).toContain('$412.50 USD');
    expect(primary(host).disabled).toBe(false);
    fire(primary(host), new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(stub.takes).toHaveLength(2);
    expect(stub.takes[1]).toMatchObject({ centsPerXmr: '34000', fiatCents: '41250' });
    expect(where(host)).toBe('/trade/K7M2-9QXA-4FTR-8WPN');
  });

  it("the take hands the trade room the device's own record of what was confirmed, in the navigation state and in this tab's storage", async () => {
    const { host } = await open(`${BUY}&amount=412.50`);
    pick(host, 'w-cake');
    fire(primary(host), new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(where(host)).toBe('/trade/K7M2-9QXA-4FTR-8WPN');
    // Task 12's ConfirmedTrade: the taker's role, the full address of the wallet picked (the screen
    // shows only its end) and the deal as shown: who posted, the XMR amount, the currency, the rate
    // and the offer's ceiling. Never built from the API's trade.
    const confirmed = {
      role: 'buyer',
      ownAddress: '4AAAAk3Fz0a',
      deal: { poster: 'seller', takeAmountAtomic: 1_250_000_000_000n, currency: 'USD', centsPerXmr: 33_000n, maxFiatCents: 150_000n },
    };
    expect(arrivedState).toEqual({ confirmed });
    // Stored before navigating, so a reload of the room (or a tab opened on it) can read it back.
    expect(readConfirmed('K7M2-9QXA-4FTR-8WPN')).toEqual(confirmed);
    expect(host.textContent).not.toContain('4AAAAk3Fz0a');
  });

  it("records the deal at the rate the server locked (within 0.5% of the quote), not the quoted one", async () => {
    // The server locks its own rate now (lead decision 2026-10-29): here 0.3% above the quote.
    stub.take = () => ({ status: 200, json: { code: 'K7M2-9QXA-4FTR-8WPN', centsPerXmr: '33099', fiatCents: '41373' } });
    const { host } = await open(`${BUY}&amount=412.50`);
    pick(host, 'w-cake');
    fire(primary(host), new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(where(host)).toBe('/trade/K7M2-9QXA-4FTR-8WPN');
    expect(readConfirmed('K7M2-9QXA-4FTR-8WPN')?.deal.centsPerXmr).toBe(33_099n);
    expect((arrivedState as { confirmed: { deal: { centsPerXmr: bigint } } }).confirmed.deal.centsPerXmr).toBe(33_099n);
  });

  it("an XMR-set market offer: the feed ticks between quote and take, and the deal's fiat maximum is the server's, at the locked rate (review 2, I1)", async () => {
    const XMR_OFFER = { ...GHOST, id: 'offer-xmr', rate: '1500033', amountUnit: 'xmr', minAtomic: '100000000000', maxAtomic: '1000000000000', minFiatCents: null, maxFiatCents: null };
    stub.offers = [XMR_OFFER];
    stub.rate = '1500033';
    // The server locks 1 minor unit above the quote, well inside the 0.5% tolerance.
    stub.take = (body) => ({ status: 200, json: { code: 'K7M2-9QXA-4FTR-8WPN', centsPerXmr: '1500034', fiatCents: String(fiatCents(BigInt(body.amountAtomic), { currency: 'USD', centsPerXmr: 1_500_034n })) } });
    const { host } = await open(`${quotePath('sell', 'ZELLE', 'offer-xmr', 'USD')}&amount=0.5&unit=xmr`);
    pick(host, 'w-cake');
    fire(primary(host), new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(where(host)).toBe('/trade/K7M2-9QXA-4FTR-8WPN');
    expect(stub.takes[0]).toMatchObject({ amountAtomic: '500000000000', centsPerXmr: '1500033' });
    // The server records tradeFiatLimits(range, locked rate): fiatCents(1 XMR, 1,500,034) = 1,500,034.
    // The escrow runtime requires the device's figure to equal it exactly, or the room fails deal-mismatch.
    const deal = readConfirmed('K7M2-9QXA-4FTR-8WPN')?.deal;
    expect(deal).toMatchObject({ centsPerXmr: 1_500_034n, maxFiatCents: 1_500_034n });
    expect((arrivedState as { confirmed: { deal: unknown } }).confirmed.deal).toEqual(deal);
  });

  it('a locked rate farther than 0.5% from the quote is not recorded: no trade room, the generic refusal', async () => {
    stub.take = () => ({ status: 200, json: { code: 'K7M2-9QXA-4FTR-8WPN', centsPerXmr: '33200', fiatCents: '41500' } });
    const { host } = await open(`${BUY}&amount=412.50`);
    pick(host, 'w-cake');
    fire(primary(host), new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(where(host)).not.toBe('/trade/K7M2-9QXA-4FTR-8WPN');
    expect(readConfirmed('K7M2-9QXA-4FTR-8WPN')).toBeNull();
    expect(host.textContent).toContain('The trade could not start. Try again.');
  });

  it('a market offer with the feed down is disabled with "Price unavailable right now"; a fixed-price offer still quotes', async () => {
    stub.price = 'down';
    const market = await open(`${BUY}&amount=412.50`);
    pick(market.host, 'w-cake');
    expect(primary(market.host).disabled).toBe(true);
    expect(market.host.textContent).toContain('Price unavailable right now');
    market.unmount();

    const fixed = await open(`${quotePath('sell', 'ZELLE', 'offer-fixed', 'USD')}&amount=340`);
    pick(fixed.host, 'w-cake');
    expect(fixed.host.textContent).toContain('$340.00 / XMR');
    expect(fixed.host.textContent).toContain('1.000000 XMR');
    expect(primary(fixed.host).disabled).toBe(false);
  });

  it('out of range: the board\'s help, and Trade stays off', async () => {
    const { host } = await open(`${BUY}&amount=20`);
    pick(host, 'w-cake');
    expect(host.textContent).toContain('Too low: the smallest trade is $50.');
    expect(primary(host).disabled).toBe(true);
    type(host, '2000');
    expect(host.textContent).toContain('Too high: the largest trade is $1,500.');
    type(host, 'abc');
    expect(host.textContent).toContain('Enter an amount between $50 and $1,500.');
  });

  it('with no usable wallet the primary is "Add a wallet": it records a pending take and comes back with its nonce', async () => {
    stub.wallets = [WALLETS[2]];
    const { host } = await open(`${BUY}&amount=412.50`);
    expect(primary(host).textContent).toBe('Add a wallet');
    fire(primary(host), new MouseEvent('click', { bubbles: true }));
    const to = new URL(where(host)!, 'http://x2f.test');
    expect(to.pathname).toBe('/wallets');
    expect(to.searchParams.get('add')).toBe('1');
    const back = new URL(to.searchParams.get('returnTo')!, 'http://x2f.test');
    expect(back.pathname).toBe('/buy/ZELLE/offer-ghost');
    expect(back.searchParams.get('amount')).toBe('412.50');
    const nonce = back.searchParams.get('resume')!;
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);
    const stored = JSON.parse(sessionStorage.getItem(PENDING_TAKE_KEY)!) as Record<string, unknown>;
    expect(stored).toMatchObject({ offerId: 'offer-ghost', unit: 'fiat', text: '412.50', nonce });
  });

  /** A marker as Trade or Add a wallet leaves it, for `offerId` and `text`. */
  const mark = (offerId = 'offer-ghost', text = '412.50') => rememberTake({ offerId, unit: 'fiat', text })!;

  it('back with a matching marker and one usable wallet: the quote is shown again at the price now, the wallet picked, and nothing is taken until a tap', async () => {
    stub.wallets = [WALLETS[0]];
    const nonce = mark();
    // The feed moved while the person was away (up to 30 minutes): the quote must show the rate now.
    stub.rate = '34000';
    const { host } = await open(`${BUY}&amount=412.50&unit=fiat&resume=${nonce}`);
    await settle();
    expect(stub.takes).toHaveLength(0);
    expect(where(host)).toBeNull();
    expect(sessionStorage.getItem(PENDING_TAKE_KEY)).toBeNull();
    expect(host.querySelector('input[value="w-cake"]')).toHaveProperty('checked', true);
    expect(host.textContent).toContain('$340.00 / XMR');
    expect(host.querySelector('[role="status"]')?.textContent).toBe("You're back. Check the total, then tap Trade.");
    expect(primary(host).disabled).toBe(false);
    fire(primary(host), new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(stub.takes).toHaveLength(1);
    expect(stub.takes[0]).toMatchObject({ walletId: 'w-cake', centsPerXmr: '34000', fiatCents: '41250' });
    expect(where(host)).toBe('/trade/K7M2-9QXA-4FTR-8WPN');
  });

  it('a crafted link with resume= but no marker in this tab takes nothing: the quote waits, filled in, for a tap', async () => {
    stub.wallets = [WALLETS[0]];
    for (const resume of ['1', 'a'.repeat(32)]) {
      const { host, unmount } = await open(`${BUY}&amount=412.50&unit=fiat&resume=${resume}`);
      await settle();
      expect(stub.takes).toHaveLength(0);
      expect(where(host)).toBeNull();
      expect(host.querySelector<HTMLInputElement>('#quote-amount')!.value).toBe('412.50');
      expect(host.querySelector('[role="status"]')).toBeNull();
      expect(host.querySelector('input[value="w-cake"]')).toHaveProperty('checked', false);
      unmount();
    }
  });

  it('a marker for another offer, another amount or another nonce takes nothing, and is used up', async () => {
    stub.wallets = [WALLETS[0]];
    const cases = [
      { nonce: mark('offer-fixed'), url: `${BUY}&amount=412.50&unit=fiat` },
      { nonce: mark('offer-ghost', '1000'), url: `${BUY}&amount=412.50&unit=fiat` },
      { nonce: (mark(), 'b'.repeat(32)), url: `${BUY}&amount=412.50&unit=fiat` },
    ];
    for (const c of cases) {
      const { host, unmount } = await open(`${c.url}&resume=${c.nonce}`);
      await settle();
      expect(stub.takes).toHaveLength(0);
      expect(sessionStorage.getItem(PENDING_TAKE_KEY)).toBeNull();
      expect(host.querySelector('[role="status"]')).toBeNull();
      unmount();
    }
  });

  it('a marker works exactly once: the same link again is a plain quote (no wallet picked, no welcome back)', async () => {
    stub.wallets = [WALLETS[0]];
    const url = `${BUY}&amount=412.50&unit=fiat&resume=${mark()}`;
    const first = await open(url);
    await settle();
    expect(first.host.querySelector('[role="status"]')).not.toBeNull();
    first.unmount();
    // Opening it again is a later visit, not a fold in the same commit (quoteKept.ts).
    await settle();
    const again = await open(url);
    await settle();
    expect(again.host.querySelector('[role="status"]')).toBeNull();
    expect(again.host.querySelector('input[value="w-cake"]')).toHaveProperty('checked', false);
    expect(stub.takes).toHaveLength(0);
  });

  it('an expired marker is a plain quote', async () => {
    stub.wallets = [WALLETS[0]];
    const nonce = rememberTake({ offerId: 'offer-ghost', unit: 'fiat', text: '412.50' }, Date.now() - PENDING_TAKE_MS - 1)!;
    const { host } = await open(`${BUY}&amount=412.50&unit=fiat&resume=${nonce}`);
    await settle();
    expect(stub.takes).toHaveLength(0);
    expect(host.querySelector('[role="status"]')).toBeNull();
  });

  it('back with a marker and several wallets: no wallet is picked for the person (OD-11), nothing is taken', async () => {
    const { host } = await open(`${BUY}&amount=412.50&unit=fiat&resume=${mark()}`);
    await settle();
    expect(stub.takes).toHaveLength(0);
    expect(host.querySelector('[role="status"]')).not.toBeNull();
    expect(host.querySelectorAll('input[name="wallet"]:checked')).toHaveLength(0);
    expect(primary(host).disabled).toBe(true);
  });

  it('logged out, Trade goes to setup with returnTo = this quote with a pending-take nonce', async () => {
    session.status = 'signed-out';
    const { host } = await open(`${BUY}&amount=412.50`);
    expect(host.querySelector('fieldset')).toBeNull();
    expect(primary(host).disabled).toBe(false);
    fire(primary(host), new MouseEvent('click', { bubbles: true }));
    const to = new URL(where(host)!, 'http://x2f.test');
    expect(to.pathname).toBe('/setup');
    const back = new URL(to.searchParams.get('returnTo')!, 'http://x2f.test');
    expect(back.pathname).toBe('/buy/ZELLE/offer-ghost');
    expect(back.searchParams.get('amount')).toBe('412.50');
    const nonce = back.searchParams.get('resume')!;
    expect(JSON.parse(sessionStorage.getItem(PENDING_TAKE_KEY)!)).toMatchObject({ offerId: 'offer-ghost', nonce });
    expect(stub.takes).toHaveLength(0);
  });

  it('a starter-limit refusal names only the caller\'s own stage', async () => {
    stub.take = () => ({ status: 409, json: { error: 'starter-limit', stage: 'starter', capUsdCents: '20000' } });
    const { host } = await open(`${BUY}&amount=412.50`);
    pick(host, 'w-cake');
    fire(primary(host), new MouseEvent('click', { bubbles: true }));
    await settle();
    // A rule refused it: the reason opens in CantDoThat (a portal on the body), with its feedback link.
    const alert = document.querySelector('[role="dialog"] [data-part="cant-do-message"]')!.textContent ?? '';
    expect(alert).toBe('Your account is on Starter limits up to $200 per trade. Try a smaller amount.');
    expect(document.querySelector('[data-part="feedback-line"] a')?.getAttribute('href')).toBe('/feedback?from=starter-limit');
    expect(where(host)).toBeNull();
  });

  it('an offer the API marks opensAt is greyed with "Opens at Building"', async () => {
    stub.offers = [{ ...GHOST, opensAt: 'building' }];
    const { host } = await open(`${BUY}&amount=412.50`);
    pick(host, 'w-cake');
    expect(host.textContent).toContain('Opens at Building.');
    expect(primary(host).disabled).toBe(true);
  });

  it('a non-USD trade also shows its US-dollar value (spec 11.6)', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://x2f.test');
      if (url.pathname === '/v1/offers') return json(200, [GHOST]);
      if (url.pathname === '/v1/methods') return json(200, { live: [], all: [{ id: 'ZELLE', name: 'Zelle', group: 'x', giftCard: false, offers: 0, bestRate: null }] });
      if (url.pathname === '/v1/price') return json(200, { currency: 'EUR', centsPerXmr: '30000', exponent: 2, at: '2026-10-24T00:00:00.000Z', usdCentsPerXmr: '33000' });
      if (url.pathname === '/v1/wallets') return json(200, WALLETS);
      return json(404, { error: 'not-found' });
    }) as typeof fetch;
    const { host } = await open(`${quotePath('sell', 'ZELLE', 'offer-ghost', 'EUR')}&amount=300`);
    expect(host.textContent).toContain('€300.00 EUR');
    expect(host.textContent).toContain('$330.00 / XMR');
    expect(host.textContent).toContain('About $330.00 USD');
  });
});

describe('a 0-decimal currency', () => {
  it('a JPY offer is quoted and shown in whole yen from the price route\'s exponent', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://x2f.test');
      if (url.pathname === '/v1/offers') return json(200, [{ ...GHOST, minFiatCents: '5000', maxFiatCents: '150000' }]);
      if (url.pathname === '/v1/methods') return json(200, { live: [], all: [{ id: 'ZELLE', name: 'Zelle', group: 'x', giftCard: false, offers: 0, bestRate: null }] });
      if (url.pathname === '/v1/price') return json(200, { currency: 'JPY', centsPerXmr: '33000', exponent: 0, at: '2026-10-24T00:00:00.000Z', usdCentsPerXmr: '22000' });
      if (url.pathname === '/v1/wallets') return json(200, WALLETS);
      const take = /^\/v1\/offers\/([^/]+)\/take$/.exec(url.pathname);
      if (take && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as TakeBody;
        stub.takes.push(body);
        return json(200, { code: 'K7M2-9QXA-4FTR-8WPN', centsPerXmr: body.centsPerXmr, fiatCents: body.fiatCents });
      }
      return json(404, { error: 'not-found' });
    }) as typeof fetch;
    const { host } = await open(`${quotePath('sell', 'ZELLE', 'offer-ghost', 'JPY')}&amount=41250`);
    pick(host, 'w-cake');
    const text = host.textContent ?? '';
    expect(text).toContain('Zelle · JPY · ¥33,000 / XMR');
    expect(text).toContain('satoshi_ghost sells ¥5,000 to ¥150,000 per trade.');
    expect(text).toContain('1.250000 XMR');
    expect(text).toContain('¥41,250 JPY');
    expect(text).not.toMatch(/¥[\d,]+\.\d/);
    // The dollar figures stay in cents: ¥33,000 / XMR is $220.00 / XMR.
    expect(text).toContain('$220.00 / XMR');
    expect(text).toContain('About $275.00 USD');
    // A decimal is not an amount in yen.
    type(host, '412.50');
    expect(host.textContent).toContain('Enter an amount between ¥5,000 and ¥150,000.');
    expect(primary(host).disabled).toBe(true);
    type(host, '41250');
    fire(primary(host), new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(stub.takes[0]).toMatchObject({ amountAtomic: '1250000000000', centsPerXmr: '33000', fiatCents: '41250' });
  });
});

describe('SellQuote', () => {
  const SELL = quotePath('buy', 'ZELLE', 'offer-mira', 'USD');

  it('the XMR figure shows exactly what is sent: 1.0000009 typed is 1.0000009 XMR locked, not 1.000000', async () => {
    const { host } = await open(SELL);
    pick(host, 'w-cake');
    type(host, '1.0000009');
    const rows = host.querySelector('section[aria-label="What you get"]')!.textContent ?? '';
    expect(rows).toContain('1.0000009 XMR');
    expect(rows).not.toContain('1.000000 XMR');
    // Switching the unit and back keeps the exact amount: nothing is silently re-rounded.
    fire([...host.querySelectorAll('button')].find((b) => b.textContent === 'Enter USD')!, new MouseEvent('click', { bubbles: true }));
    expect(host.querySelector<HTMLInputElement>('#quote-amount')!.value).toBe('330.00');
    fire([...host.querySelectorAll('button')].find((b) => b.textContent === 'Enter XMR')!, new MouseEvent('click', { bubbles: true }));
    expect(host.querySelector<HTMLInputElement>('#quote-amount')!.value).toBe('1.000000');
    type(host, '1.0000009');
    fire(primary(host), new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(stub.takes[0]!.amountAtomic).toBe('1000000900000');
  });

  it('amount or Max, the funding and refund wallet, the same rows and no fee line', async () => {
    const { host } = await open(SELL);
    const text = host.textContent ?? '';
    expect(text).toContain('Selling to mira.k');
    expect(text).toContain('mira.k buys $50 to $1,500 per trade.');
    expect(text).toContain('Which wallet sends the XMR?');
    fire([...host.querySelectorAll('button')].find((b) => b.textContent === 'Max')!, new MouseEvent('click', { bubbles: true }));
    pick(host, 'w-cake');
    const rows = host.querySelector('section[aria-label="What you get"]')!.textContent ?? '';
    // Max: $1,500 at $330.00, as 6-decimal XMR (4.545454); the seller locks exactly that (the
    // poster's 1% comes out of the poster's own payout), and it is still within the offer's maximum.
    expect(host.querySelector<HTMLInputElement>('#quote-amount')!.value).toBe('4.545454');
    expect(rows).toContain('4.545454 XMR');
    expect(rows).toContain('$1,500.00 USD');
    expect(rows).toContain('From Cake Wallet, address ending …k3Fz0a. Refunds go back to it.');
    expect(rows).not.toContain('X2F');
    expect(host.textContent).not.toContain('1%');
    expect(host.textContent).not.toMatch(/deposit/i);
    fire(primary(host), new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(stub.takes[0]!.amountAtomic).toBe('4545454000000');
    expect(where(host)).toBe('/trade/K7M2-9QXA-4FTR-8WPN');
    // The seller's record: role seller, the buy ad's poster is the buyer, the funding wallet's full address.
    const confirmed = {
      role: 'seller',
      ownAddress: '4AAAAk3Fz0a',
      deal: { poster: 'buyer', takeAmountAtomic: 4_545_454_000_000n, currency: 'USD', centsPerXmr: 33_000n, maxFiatCents: 150_000n },
    };
    expect(arrivedState).toEqual({ confirmed });
    expect(readConfirmed('K7M2-9QXA-4FTR-8WPN')).toEqual(confirmed);
  });
});

// Review 2026-11-01 M1-M3: a fold or unfold moves the quote between the phone screen and the pane
// beside the offers, which mounts a new QuoteScreen. What the person typed and picked, and the
// take's state (in flight, refused, "You're back", the blocked poster), stay with the offer.
describe('the quote across a fold (review M1, M2, M3)', () => {
  let panes = false;
  beforeEach(() => {
    panes = false;
    window.matchMedia = ((query: string) => ({
      matches: panes && query === '(min-width: 600px)',
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
  });

  async function openRoute(url: string) {
    const r = render(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/buy/:methodId" element={<OffersRoute side="buy" copy={BUY_COPY} />} />
          <Route path="/buy/:methodId/:offerId" element={<OffersRoute side="buy" copy={BUY_COPY} />} />
          <Route path="*" element={<Where />} />
        </Routes>
        {/* The URL the panes leave behind (m2), read with `where`; the browser's Back (lead m1). */}
        <Where />
        <BrowserBack />
      </MemoryRouter>,
    );
    await settle();
    return r;
  }

  async function layout(two: boolean) {
    panes = two;
    await act(async () => {
      window.dispatchEvent(new Event('resize'));
    });
    await settle();
  }

  const quotes = (host: HTMLElement) => host.querySelectorAll('[data-screen="quote"]');
  const amount = (host: HTMLElement) => host.querySelector<HTMLInputElement>('#quote-amount')!;
  const unitShown = (host: HTMLElement) => host.querySelector('.x2f-quote__unit')?.textContent;
  const picked = (host: HTMLElement) => host.querySelector<HTMLInputElement>('input[name][type="radio"]:checked')?.value ?? null;
  const MIRA_QUOTE = quotePath('sell', 'ZELLE', 'offer-mira', 'USD');

  it('unfold and fold back keep the amount, its unit, the wallet and the picked offer, with one quote mounted', async () => {
    const { host } = await openRoute(MIRA_QUOTE);
    type(host, '1.5');
    fire(host.querySelector('.x2f-quote__switch')!, new MouseEvent('click', { bubbles: true }));
    expect(unitShown(host)).toBe('XMR');
    const typed = amount(host).value;
    pick(host, 'w-ledger');

    await layout(true);
    expect(quotes(host)).toHaveLength(1);
    expect(host.querySelector('[data-pane="side"] [data-screen="quote"]')).not.toBeNull();
    expect(amount(host).value).toBe(typed);
    expect(unitShown(host)).toBe('XMR');
    expect(picked(host)).toBe('w-ledger');
    const pressed = host.querySelector('[data-pane="main"] button[aria-pressed="true"]');
    expect(pressed?.textContent).toContain('mira.k');

    await layout(false);
    expect(quotes(host)).toHaveLength(1);
    expect(host.querySelector('[data-pane="side"]')).toBeNull();
    expect(host.textContent).toContain('mira.k');
    expect(amount(host).value).toBe(typed);
    expect(unitShown(host)).toBe('XMR');
    expect(picked(host)).toBe('w-ledger');

    await layout(true);
    expect(quotes(host)).toHaveLength(1);
    expect(amount(host).value).toBe(typed);
    expect(picked(host)).toBe('w-ledger');
  });

  it('a take in flight stays in flight across an unfold: Trade is off, and a tap takes nothing twice (M1)', async () => {
    let answer: () => void = () => undefined;
    stub.gate = new Promise<void>((r) => (answer = r));
    stub.take = () => ({ status: 409, json: { error: 'price-changed' } });
    const { host } = await openRoute(`${MIRA_QUOTE}&amount=412.50`);
    pick(host, 'w-cake');
    fire(primary(host), new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(stub.takes).toHaveLength(1);

    await layout(true);
    expect(quotes(host)).toHaveLength(1);
    expect(primary(host).disabled).toBe(true);
    fire(primary(host), new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(stub.takes).toHaveLength(1);

    answer();
    await settle();
    // The refusal reaches the quote now on screen, and stays across a fold back.
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('The price moved. Check the new total and tap Trade again.');
    await layout(false);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('The price moved. Check the new total and tap Trade again.');
  });

  // Review 2026-11-06 m2: before an offer is picked, the pane shows the first offer's quote on the
  // list's URL. The first input there picks it (writes it to the URL), so a fold keeps that quote.
  const LIST = '/buy/ZELLE?currency=USD';
  it('with nothing picked, an amount typed in the pane quote stays across a fold (m2)', async () => {
    panes = true;
    const { host } = await openRoute(LIST);
    expect(host.querySelector('[data-pane="side"] [data-screen="quote"]')).not.toBeNull();
    // The pane shows the first offer, but the URL is still the list's.
    expect(new URL(where(host)!, 'http://x2f.test').pathname).toBe('/buy/ZELLE');
    type(host, '100');
    await settle();
    // The first input picks the shown offer: it is now in the URL, with the amount.
    const url = new URL(where(host)!, 'http://x2f.test');
    expect(url.pathname).toBe('/buy/ZELLE/offer-ghost');
    expect(url.searchParams.get('amount')).toBe('100');
    expect(host.querySelector('[data-pane="main"] button[aria-pressed="true"]')?.textContent).toContain('satoshi_ghost');
    expect(amount(host).value).toBe('100');

    await layout(false);
    expect(quotes(host)).toHaveLength(1);
    expect(host.textContent).toContain('Buying from satoshi_ghost');
    expect(amount(host).value).toBe('100');
  });

  // Lead review 2026-11-06 m1: Back to the list undoes the pick, so the pane's quote starts afresh
  // (it is on the list's URL again) and the next first input picks it again.
  it('Back to the list after the first input: the pane quote starts afresh, and the next input picks it again (lead m1)', async () => {
    panes = true;
    const { host } = await openRoute(LIST);
    type(host, '100');
    await settle();
    expect(new URL(where(host)!, 'http://x2f.test').pathname).toBe('/buy/ZELLE/offer-ghost');
    fire(host.querySelector<HTMLElement>('[data-browser-back]')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(new URL(where(host)!, 'http://x2f.test').pathname).toBe('/buy/ZELLE');
    expect(amount(host).value).toBe('');
    type(host, '50');
    await settle();
    expect(new URL(where(host)!, 'http://x2f.test').pathname).toBe('/buy/ZELLE/offer-ghost');
    await layout(false);
    expect(quotes(host)).toHaveLength(1);
    expect(amount(host).value).toBe('50');
  });

  it('with nothing picked, a refusal that answers after a fold is shown on the phone quote (m2)', async () => {
    panes = true;
    let answer: () => void = () => undefined;
    stub.gate = new Promise<void>((r) => (answer = r));
    stub.take = () => ({ status: 409, json: { error: 'price-changed' } });
    // The amount sits in the list's URL (it came from the method list), so the first input is the tap.
    const { host } = await openRoute(`${LIST}&amount=412.50`);
    expect(amount(host).value).toBe('412.50');
    pick(host, 'w-cake');
    fire(primary(host), new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(stub.takes).toHaveLength(1);
    expect(new URL(where(host)!, 'http://x2f.test').pathname).toBe('/buy/ZELLE/offer-ghost');

    await layout(false);
    expect(quotes(host)).toHaveLength(1);
    expect(primary(host).disabled).toBe(true);
    answer();
    await settle();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('The price moved. Check the new total and tap Trade again.');
    expect(stub.takes).toHaveLength(1);
  });

  it('"You\'re back" stays across an unfold (M1)', async () => {
    stub.wallets = [WALLETS[0]];
    const nonce = rememberTake({ offerId: 'offer-mira', unit: 'fiat', text: '412.50' })!;
    const { host } = await openRoute(`${MIRA_QUOTE}&amount=412.50&unit=fiat&resume=${nonce}`);
    await settle();
    expect(host.querySelector('[role="status"]')?.textContent).toBe("You're back. Check the total, then tap Trade.");
    await layout(true);
    expect(host.textContent).toContain("You're back. Check the total, then tap Trade.");
    expect(stub.takes).toHaveLength(0);
  });

  it('on a phone a typed amount stays with its offer: another offer, or the same one opened again, starts empty (M2)', async () => {
    const { host } = await openRoute(quotePath('sell', 'ZELLE', 'offer-ghost', 'USD'));
    type(host, '412');
    fire(host.querySelector('a[aria-label^="Back"]')!, new MouseEvent('click', { bubbles: true, button: 0 }));
    await settle();
    expect(quotes(host)).toHaveLength(0);
    const trades = [...host.querySelectorAll<HTMLAnchorElement | HTMLButtonElement>('[data-primary], a, button')].filter((e) => e.textContent === 'Trade');
    expect(trades.length).toBeGreaterThan(0);
    fire(trades[0]!, new MouseEvent('click', { bubbles: true, button: 0 }));
    await settle();
    expect(quotes(host)).toHaveLength(1);
    expect(amount(host).value).toBe('');
  });
});

// Build spec j31a section 1 (T-034, T-080): the taker's own "What applies to you" list.
describe('What applies to you on the quote (j31a section 1)', () => {
  const card = () => document.querySelector<HTMLElement>('[data-part="what-applies"]')!;
  const shown = () => [...card().querySelectorAll('li')].map((l) => l.textContent);

  it('BuyQuote shows the buyer-taker list: subtitle, three groups with counts, the first line of each and "Show all"', async () => {
    await open(`${BUY}&amount=412.50`);
    expect(card().querySelector('h2')?.textContent).toBe('What applies to you');
    expect(card().textContent).toContain("You're buying from a sell ad · information only");
    const heads = [...card().querySelectorAll('h3')].map((h) => [h.textContent, h.nextElementSibling?.textContent]);
    // The board's 13 "What affects you" lines less the lead's placeholder (p9-8), never shipped.
    expect(heads).toEqual([
      ['Your responsibilities', '7'],
      ['What affects you', '12'],
      ['Your options', '5'],
    ]);
    expect(shown()).toEqual([
      'Pay only when "Pay now" shows; it never shows before the escrow is secured.',
      "Amounts can be shown with or without the vendor's markup.",
      "Opened trades with several people to see who answers first? Close the others once you've picked one, so they aren't left waiting.",
    ]);
    const toggle = [...card().querySelectorAll('button')].find((b) => b.textContent === 'Show all 24')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fire(toggle, new MouseEvent('click', { bubbles: true }));
    expect(toggle.textContent).toBe('Show less');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(shown()).toHaveLength(24);
    expect(shown()).toContain('Seller gone quiet? Nudge them: it often brings them back and saves starting over. Optional, at most once every 15 minutes.');
    expect(card().textContent).not.toContain('[lead writes the wording]');
    // A taker sees no X2F fee line.
    expect(card().textContent).not.toMatch(/X2F fee|1%/);
    // Numbers in the mono face.
    expect([...card().querySelectorAll('.x2f-wa__mono')].map((m) => m.textContent)).toContain('15');
  });

  it('SellQuote shows the seller-taker list, with the buyer nudge and no fee line', async () => {
    await open(quotePath('buy', 'ZELLE', 'offer-mira', 'USD'));
    expect(card().textContent).toContain("You're selling to a buy ad · information only");
    fire([...card().querySelectorAll('button')].find((b) => b.textContent === 'Show all 21')!, new MouseEvent('click', { bubbles: true }));
    expect(shown()).toContain('Buyer gone quiet? Nudge them: it often brings them back and saves starting over. Optional, at most once every 15 minutes.');
    expect(shown()).toContain('Fund the escrow in full.');
    expect(card().textContent).not.toMatch(/X2F fee|1%/);
  });
});

// Build spec j31a section 2 (owner p9-3, T-039): the courtesy sheet between the take and the room.
describe('the courtesy sheet after Trade (j31a section 2)', () => {
  beforeEach(() => resetCourtesy());
  afterEach(() => resetCourtesy());

  const sheet = () => document.querySelector<HTMLElement>('[data-sheet="courtesy"]');
  const gotIt = () => [...sheet()!.querySelectorAll('button')].find((b) => b.textContent === 'Got it')!;

  async function takeIt(host: HTMLElement) {
    pick(host, 'w-cake');
    fire(primary(host), new MouseEvent('click', { bubbles: true }));
    await settle();
  }

  it('the take goes through, then the sheet shows before the trade room; Got it opens the room', async () => {
    const { host } = await open(`${BUY}&amount=412.50`);
    await takeIt(host);
    expect(stub.takes).toHaveLength(1);
    expect(where(host)).toBeNull();
    const dialog = sheet()!.closest('[role="dialog"]')!;
    expect(dialog.querySelector('h2')?.textContent).toBe('Trading with more than one person?');
    expect(sheet()!.textContent).toContain(
      "If you opened trades with several people to see who answers first, close the others once you've picked one. That way nobody is left waiting on you.",
    );
    const tick = sheet()!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(tick.checked).toBe(false);
    expect(tick.closest('label')?.textContent).toBe("Don't show this again");
    // "Got it" is the only action.
    expect([...sheet()!.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Got it']);
    fire(gotIt(), new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(where(host)).toBe('/trade/K7M2-9QXA-4FTR-8WPN');
    expect(arrivedState).toMatchObject({ confirmed: { role: 'buyer' } });
  });

  it('it shows on every trade until "Don\'t show this again" is ticked', async () => {
    const first = await open(`${BUY}&amount=412.50`);
    await takeIt(first.host);
    fire(gotIt(), new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(where(first.host)).toBe('/trade/K7M2-9QXA-4FTR-8WPN');
    first.unmount();
    forgetQuotes();

    const second = await open(`${BUY}&amount=412.50`);
    await takeIt(second.host);
    expect(where(second.host)).toBeNull();
    fire(sheet()!.querySelector('input[type="checkbox"]')!, new MouseEvent('click', { bubbles: true }));
    fire(gotIt(), new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(where(second.host)).toBe('/trade/K7M2-9QXA-4FTR-8WPN');
    second.unmount();
    forgetQuotes();

    const third = await open(`${BUY}&amount=412.50`);
    await takeIt(third.host);
    expect(sheet()).toBeNull();
    expect(where(third.host)).toBe('/trade/K7M2-9QXA-4FTR-8WPN');
  });

  it('SellQuote: the same sheet, then the trade room', async () => {
    const { host } = await open(quotePath('buy', 'ZELLE', 'offer-mira', 'USD') + '&amount=1&unit=xmr');
    await takeIt(host);
    expect(where(host)).toBeNull();
    expect(sheet()).not.toBeNull();
    fire(gotIt(), new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(where(host)).toBe('/trade/K7M2-9QXA-4FTR-8WPN');
  });

  it('a refused take shows no sheet', async () => {
    stub.take = () => ({ status: 409, json: { error: 'price-changed' } });
    const { host } = await open(`${BUY}&amount=412.50`);
    await takeIt(host);
    expect(sheet()).toBeNull();
  });
});
