// @vitest-environment happy-dom
// Task 18: BuyQuote and the seller quote, rendered against a stubbed API (the Task 3/4/5 shapes in
// src/screens/quote/api.ts; see test/quote-tripwires.test.ts).
import { act } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fiatCents } from '@x2f/trade';
import { BuyQuote } from '../src/screens/quote/BuyQuote.js';
import { SellQuote } from '../src/screens/quote/SellQuote.js';
import { quotePath } from '../src/screens/quote/quoteModel.js';
import { fire, render } from './render.js';

const session = vi.hoisted(() => ({ status: 'signed-in' as 'signed-in' | 'signed-out' | 'loading' }));
vi.mock('../src/session/useSession.js', () => ({
  useSession: () => (session.status === 'signed-in' ? { status: 'signed-in', me: {} } : { status: session.status }),
}));

const poster = (username: string) => ({
  username,
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
  { id: 'w-cake', app: 'cake', label: 'Cake Wallet', address: '4AAAAk3Fz0', addressEnd: 'k3Fz0a', usableFrom: '2026-10-01T00:00:00.000Z', usable: true },
  { id: 'w-ledger', app: 'ledger-trezor', label: 'Ledger (via Feather)', address: '4BBBB9QbP0', addressEnd: '9QbP0b', usableFrom: '2026-10-01T00:00:00.000Z', usable: true },
  { id: 'w-edge', app: 'edge', label: 'Edge', address: '4CCCC7HcW0', addressEnd: '7HcW0c', usableFrom: '2026-10-25T00:00:00.000Z', usable: false },
];

interface Api {
  offers: unknown[];
  price: 'ok' | 'down';
  wallets: unknown[];
  take: (body: { amountAtomic: string; walletId: string }) => { status: number; json: unknown };
  takes: { amountAtomic: string; walletId: string }[];
}

let stub: Api;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  session.status = 'signed-in';
  stub = {
    offers: [GHOST, FIXED, MIRA],
    price: 'ok',
    wallets: WALLETS,
    takes: [],
    take: () => ({ status: 200, json: { code: 'K7M2-9QXA-4FTR-8WPN' } }),
  };
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://x2f.test');
    if (url.pathname === '/v1/offers') return json(200, stub.offers);
    if (url.pathname === '/v1/methods') return json(200, { live: [{ id: 'ZELLE', name: 'Zelle', group: 'Payment apps', giftCard: false, offers: 1, bestRate: '33000' }], all: [] });
    if (url.pathname === '/v1/price') {
      const currency = url.searchParams.get('currency');
      return stub.price === 'ok' ? json(200, { currency, centsPerXmr: '33000', exponent: 2, at: '2026-10-24T00:00:00.000Z', usdCentsPerXmr: '33000' }) : json(503, { error: 'price-unavailable' });
    }
    if (url.pathname === '/v1/wallets') return session.status === 'signed-in' ? json(200, stub.wallets) : json(401, { error: 'not-authenticated' });
    const take = /^\/v1\/offers\/([^/]+)\/take$/.exec(url.pathname);
    if (take && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { amountAtomic: string; walletId: string };
      stub.takes.push(body);
      const r = stub.take(body);
      return json(r.status, r.json);
    }
    return json(404, { error: 'not-found' });
  }) as typeof fetch;
});

afterEach(() => vi.restoreAllMocks());

function Where() {
  const l = useLocation();
  return <output data-where={l.pathname + l.search} />;
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
    expect(where(host)).toBe('/trade/K7M2-9QXA-4FTR-8WPN');
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

  it('with no usable wallet the primary is "Add a wallet", and it comes back to resume the take', async () => {
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
    expect(back.searchParams.get('resume')).toBe('1');
  });

  it('back with resume=1 and one usable wallet: the take runs once and opens the trade', async () => {
    stub.wallets = [WALLETS[0]];
    const { host } = await open(`${BUY}&amount=412.50&unit=fiat&resume=1`);
    await settle();
    expect(stub.takes).toHaveLength(1);
    expect(stub.takes[0]!.walletId).toBe('w-cake');
    expect(where(host)).toBe('/trade/K7M2-9QXA-4FTR-8WPN');
  });

  it('back with resume=1 and several wallets: nothing is taken until the person picks (OD-11)', async () => {
    const { host } = await open(`${BUY}&amount=412.50&resume=1`);
    await settle();
    expect(stub.takes).toHaveLength(0);
    expect(primary(host).disabled).toBe(true);
  });

  it('logged out, Trade goes to setup with returnTo = this quote with resume=1', async () => {
    session.status = 'signed-out';
    const { host } = await open(`${BUY}&amount=412.50`);
    expect(host.querySelector('fieldset')).toBeNull();
    expect(primary(host).disabled).toBe(false);
    fire(primary(host), new MouseEvent('click', { bubbles: true }));
    const to = new URL(where(host)!, 'http://x2f.test');
    expect(to.pathname).toBe('/setup/terms');
    const back = new URL(to.searchParams.get('returnTo')!, 'http://x2f.test');
    expect(back.pathname).toBe('/buy/ZELLE/offer-ghost');
    expect(back.searchParams.get('resume')).toBe('1');
    expect(back.searchParams.get('amount')).toBe('412.50');
    expect(stub.takes).toHaveLength(0);
  });

  it('a starter-limit refusal names only the caller\'s own stage', async () => {
    stub.take = () => ({ status: 409, json: { error: 'starter-limit', stage: 'starter', capUsdCents: '20000' } });
    const { host } = await open(`${BUY}&amount=412.50`);
    pick(host, 'w-cake');
    fire(primary(host), new MouseEvent('click', { bubbles: true }));
    await settle();
    const alert = host.querySelector('[role="alert"]')!.textContent ?? '';
    expect(alert).toBe('Your account is on Starter limits up to $200 per trade. Try a smaller amount.');
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

describe('SellQuote', () => {
  const SELL = quotePath('buy', 'ZELLE', 'offer-mira', 'USD');

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
  });
});
