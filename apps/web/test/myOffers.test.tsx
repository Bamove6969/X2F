// @vitest-environment happy-dom
// Plan 3 Task 36: My offers against a stubbed API in the shapes of apps/api/src/offers/routes.ts
// (MyOffer, OfferSwitchResult), and the screen's small rules.
import { act } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MyOffers } from '../src/screens/MyOffers.js';
import { parseMyOffers, parseSwitch, type MyOffer } from '../src/screens/myoffers/api.js';
import { applyResults, idsFor, offerDetail, offerTitle, refusalLine, summaryLine } from '../src/screens/myoffers/model.js';
import { fire, render } from './render.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

const RAW = [
  {
    id: A, side: 'sell', methodId: 'ZELLE', methodName: 'Zelle', currency: 'USD', rate: '33165',
    pricing: { mode: 'market', marginBps: 50 }, minFiatCents: '5000', maxFiatCents: '200000', minTrades: 0,
    status: 'live', createdAt: '2026-10-29T10:00:00.000Z',
  },
  {
    id: B, side: 'buy', methodId: 'REVOLUT', methodName: 'Revolut', currency: 'EUR', rate: '30000',
    pricing: { mode: 'fixed', centsPerXmr: '30000' }, minFiatCents: '1250', maxFiatCents: '50000', minTrades: 5,
    status: 'paused', createdAt: '2026-10-29T09:00:00.000Z',
  },
  {
    id: C, side: 'sell', methodId: 'AMAZON_GC', methodName: 'Amazon gift card', currency: 'USD', rate: null,
    pricing: { mode: 'market', marginBps: -100 }, minFiatCents: '2500', maxFiatCents: '10000', minTrades: 0,
    country: 'US', status: 'paused', createdAt: '2026-10-29T08:00:00.000Z',
  },
];

interface Call {
  url: string;
  method: string;
  body: Record<string, unknown> | undefined;
}

let list: typeof RAW;
let onSwitch: (body: { ids: string[] | 'all'; status: string }) => { status: number; json: unknown };
let calls: Call[];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** The server's rule for a stub: every named (or every) offer switches. */
function allSwitch(body: { ids: string[] | 'all'; status: string }): { status: number; json: unknown } {
  const ids = body.ids === 'all' ? list.map((o) => o.id) : body.ids;
  list = list.map((o) => (ids.includes(o.id) ? { ...o, status: body.status } : o));
  return { status: 200, json: { status: body.status, results: ids.map((id) => ({ id, status: body.status })) } };
}

beforeEach(() => {
  list = RAW.map((o) => ({ ...o }));
  onSwitch = allSwitch;
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
      calls.push({ url, method, body });
      if (url === '/v1/account/offers' && method === 'GET') return json(200, list);
      if (url === '/v1/account/offers/status' && method === 'POST') {
        const a = onSwitch(body as { ids: string[] | 'all'; status: string });
        return json(a.status, a.json);
      }
      return json(404, { error: 'not-found' });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function mount(): Promise<HTMLElement> {
  const { host } = render(
    <MemoryRouter initialEntries={['/profile/offers']}>
      <Routes>
        <Route path="/profile/offers" element={<MyOffers />} />
      </Routes>
    </MemoryRouter>,
  );
  await settle();
  return host;
}

const q = <T extends Element = HTMLElement>(host: Element, sel: string) => host.querySelector(sel) as T;
const row = (host: Element, id: string) => q(host, `[data-offer="${id}"]`);
const sw = (host: Element, id: string) => q<HTMLButtonElement>(row(host, id), '[data-part="switch"]');
const isOn = (host: Element, id: string) => sw(host, id).getAttribute('aria-checked') === 'true';

async function click(el: Element): Promise<void> {
  fire(el, new MouseEvent('click', { bubbles: true, cancelable: true }));
  await settle();
}

describe('the model', () => {
  it('parses the API answer strictly', () => {
    const offers = parseMyOffers(RAW);
    expect(offers.map((o) => [o.id, o.status, o.rate])).toEqual([[A, 'live', 33165n], [B, 'paused', 30000n], [C, 'paused', null]]);
    expect(offers[2]!.country).toBe('US');
    expect(() => parseMyOffers([{ ...RAW[0], status: 'removed' }])).toThrow();
    expect(() => parseMyOffers([{ ...RAW[0], minFiatCents: 5000 }])).toThrow();
    expect(() => parseMyOffers({})).toThrow();
    expect(parseSwitch({ status: 'live', results: [{ id: A, status: 'live' }, { id: B, status: 'paused', refused: 'trading-hold' }, { id: C, refused: 'not-found' }] })).toEqual([
      { id: A, status: 'live' }, { id: B, status: 'paused', refused: 'trading-hold' }, { id: C, refused: 'not-found' },
    ]);
    expect(() => parseSwitch({ results: [{ id: A }] })).toThrow();
  });

  it('describes an offer, applies results and words the summary', () => {
    const [a, b, c] = parseMyOffers(RAW) as [MyOffer, MyOffer, MyOffer];
    expect(offerTitle(a)).toBe('Sell · Zelle · USD');
    expect(offerTitle(c)).toBe('Sell · Amazon gift card · USD (US)');
    expect(offerDetail(a)).toBe('Market +0.5% · $331.65 / XMR · $50 to $2,000');
    expect(offerDetail(b)).toBe('Fixed €300.00 / XMR · €12.50 to €500');
    expect(offerDetail(c)).toBe('Market -1.0% · $25 to $100');
    const next = applyResults([a, b, c], [{ id: a.id, status: 'paused' }, { id: b.id, status: 'paused', refused: 'trading-hold' }, { id: c.id, refused: 'not-found' }]);
    expect(next.map((o) => [o.id, o.status])).toEqual([[A, 'paused'], [B, 'paused']]);
    expect(summaryLine('paused', [{ id: A, status: 'paused' }, { id: B, status: 'paused' }])).toBe('2 offers turned off.');
    expect(summaryLine('live', [{ id: A, status: 'paused', refused: 'trading-hold' }])).toBe('No offers turned on. Each one says why below.');
    expect(summaryLine('live', [{ id: A, status: 'live' }, { id: B, status: 'paused', refused: 'no-wallet' }])).toBe(
      '1 offer turned on. 1 offer stayed as they were; each one says why below.',
    );
    expect(idsFor([a, b, c], new Set([A, B, C]))).toBe('all');
    expect(idsFor([a, b, c], new Set([B]))).toEqual([B]);
    for (const code of ['trading-hold', 'trading-paused', 'no-wallet', 'too-many-offers', 'method-unavailable', 'not-found', 'other']) {
      expect(refusalLine(code)).toMatch(/\.$/);
    }
    expect(refusalLine('trading-hold')).toContain('trading hold');
  });
});

describe('the My offers screen', () => {
  it('lists every offer with its switch; a switch turns one offer on or off', async () => {
    const host = await mount();
    expect([...host.querySelectorAll('[data-part="offer"]')].map((r) => r.getAttribute('data-offer'))).toEqual([A, B, C]);
    expect(isOn(host, A)).toBe(true);
    expect(isOn(host, B)).toBe(false);
    expect(sw(host, A).getAttribute('role')).toBe('switch');
    expect(sw(host, A).textContent).toBe('On');
    expect(sw(host, A).getAttribute('aria-labelledby')).toBeTruthy();

    await click(sw(host, B));
    expect(calls.at(-1)).toMatchObject({ url: '/v1/account/offers/status', method: 'POST', body: { ids: [B], status: 'live' } });
    expect(isOn(host, B)).toBe(true);
    expect(q(host, '[data-part="summary"]').textContent).toBe('1 offer turned on.');

    await click(sw(host, A));
    expect(calls.at(-1)!.body).toEqual({ ids: [A], status: 'paused' });
    expect(isOn(host, A)).toBe(false);
  });

  it('Select all, then Turn off sends "all"; a part selection sends its ids', async () => {
    const host = await mount();
    const on = q<HTMLButtonElement>(host, '[data-part="turn-on"]');
    expect(on.disabled).toBe(true);
    await click(q(host, '[data-part="select-all"]'));
    expect([...host.querySelectorAll('[data-part="select"]')].every((c) => c.getAttribute('aria-pressed') === 'true')).toBe(true);
    await click(q(host, '[data-part="turn-off"]'));
    expect(calls.at(-1)!.body).toEqual({ ids: 'all', status: 'paused' });
    for (const id of [A, B, C]) expect(isOn(host, id)).toBe(false);

    // Clear, pick two, turn them on.
    await click(q(host, '[data-part="select-all"]'));
    await click(q(row(host, A), '[data-part="select"]'));
    await click(q(row(host, C), '[data-part="select"]'));
    expect(q(host, '[data-part="select-all"]').getAttribute('aria-pressed')).toBe('mixed');
    await click(q(host, '[data-part="turn-on"]'));
    expect(calls.at(-1)!.body).toEqual({ ids: [A, C], status: 'live' });
    expect([isOn(host, A), isOn(host, B), isOn(host, C)]).toEqual([true, false, true]);
  });

  it('turning all on while held: every offer stays off and each row says why', async () => {
    onSwitch = (body) => ({
      status: 200,
      json: { status: body.status, results: list.map((o) => ({ id: o.id, status: o.status, refused: 'trading-hold' })) },
    });
    const host = await mount();
    await click(q(host, '[data-part="select-all"]'));
    await click(q(host, '[data-part="turn-on"]'));
    expect(calls.at(-1)!.body).toEqual({ ids: 'all', status: 'live' });
    expect(q(host, '[data-part="summary"]').textContent).toBe('No offers turned on. Each one says why below.');
    expect(isOn(host, B)).toBe(false);
    expect(row(host, B).querySelector('[data-part="refused"]')!.textContent).toBe(refusalLine('trading-hold'));
    expect(sw(host, B).getAttribute('aria-describedby')).toBe(row(host, B).querySelector('[data-part="refused"]')!.id);
    // A later success clears the row's reason.
    onSwitch = allSwitch;
    await click(sw(host, B));
    expect(row(host, B).querySelector('[data-part="refused"]')).toBeNull();
  });

  it('an offer removed elsewhere drops off the list (not-found re-reads it)', async () => {
    const host = await mount();
    onSwitch = (body) => {
      list = list.filter((o) => o.id !== C);
      return { status: 200, json: { status: body.status, results: [{ id: C, refused: 'not-found' }] } };
    };
    await click(sw(host, C));
    expect(row(host, C)).toBeNull();
    expect(calls.filter((c) => c.url === '/v1/account/offers').length).toBe(2);
  });

  it('shows the empty state, a load failure with Retry, a failed switch, and the log-in link when signed out', async () => {
    list = [];
    let host = await mount();
    expect(q(host, '[data-part="empty"]').textContent).toContain('You have no offers yet.');
    host.remove();

    list = RAW.map((o) => ({ ...o }));
    onSwitch = () => ({ status: 500, json: { error: 'internal' } });
    host = await mount();
    await click(sw(host, A));
    expect(q(host, '[data-part="summary"]').textContent).toContain("weren't changed");
    expect(isOn(host, A)).toBe(true);
    host.remove();

    vi.stubGlobal('fetch', vi.fn(async () => json(500, { error: 'internal' })));
    host = await mount();
    expect(q(host, '[role="alert"]').textContent).toBe('Could not load your offers.');
    host.remove();

    vi.stubGlobal('fetch', vi.fn(async () => json(401, { error: 'not-authenticated' })));
    host = await mount();
    expect(q<HTMLAnchorElement>(host, 'a.x2f-link').getAttribute('href')).toBe('/login?returnTo=%2Fprofile%2Foffers');
  });
});
