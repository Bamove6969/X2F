// @vitest-environment happy-dom
// Plan 3 Task 36: My offers against a stubbed API in the shapes of apps/api/src/offers/routes.ts
// (MyOffer, OfferSwitchResult), and the screen's small rules. Behaviour after Claude Design's
// MyOffers board (2026-10-29): a tick box per offer, Select all only ticks, the bar applies.
import { act } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MyOffers } from '../src/screens/MyOffers.js';
import { parseMyOffers, parseSwitch, type MyOffer } from '../src/screens/myoffers/api.js';
import {
  allHint, applyResults, batches, cantDoFor, countLine, idsFor, offerLimits, offerMethods, offerPrice, offerTitle, refusalLine, statusLine, summaryLine,
} from '../src/screens/myoffers/model.js';
import { CANT_DO_TITLE, myOffersCantDoText } from '../src/ui/cantDoCodes.js';
import { fire, render } from './render.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

type Raw = Record<string, unknown> & { id: string; status: string };

const RAW: Raw[] = [
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

let list: Raw[];
let onSwitch: (body: { ids: string[]; status: string }) => { status: number; json: unknown };
let calls: Call[];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** The API's rule for a stub: every named offer switches; one already in the status is done. */
function allSwitch(body: { ids: string[]; status: string }): { status: number; json: unknown } {
  list = list.map((o) => (body.ids.includes(o.id) ? { ...o, status: body.status } : o));
  return { status: 200, json: { status: body.status, results: body.ids.map((id) => ({ id, status: body.status })) } };
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
        const a = onSwitch(body as { ids: string[]; status: string });
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
const tick = (host: Element, id: string) => q<HTMLButtonElement>(row(host, id), '[data-part="select"]');
const isOn = (host: Element, id: string) => sw(host, id).getAttribute('aria-checked') === 'true';
const isTicked = (host: Element, id: string) => tick(host, id).getAttribute('aria-checked') === 'true';
const posts = () => calls.filter((c) => c.method === 'POST');
/** The text of the elements an aria-labelledby names, joined as a name. */
const nameOf = (el: Element) =>
  (el.getAttribute('aria-labelledby') ?? '').split(' ').map((id) => document.getElementById(id)!.textContent).join(' ');

async function click(el: Element): Promise<void> {
  fire(el, new MouseEvent('click', { bubbles: true, cancelable: true }));
  await settle();
}

describe('the model', () => {
  it('parses the API answer strictly, hidden included', () => {
    const offers = parseMyOffers([...RAW, { ...RAW[0], id: 'x', hidden: 'trading-hold' }]);
    expect(offers.map((o) => [o.id, o.status, o.rate])).toEqual([[A, 'live', 33165n], [B, 'paused', 30000n], [C, 'paused', null], ['x', 'live', 33165n]]);
    expect(offers[2]!.country).toBe('US');
    expect(offers[3]!.hidden).toBe('trading-hold');
    expect(() => parseMyOffers([{ ...RAW[0], hidden: 'nope' }])).toThrow();
    expect(() => parseMyOffers([{ ...RAW[0], status: 'removed' }])).toThrow();
    expect(() => parseMyOffers([{ ...RAW[0], minFiatCents: 5000 }])).toThrow();
    expect(() => parseMyOffers({})).toThrow();
    expect(parseSwitch({ status: 'live', results: [{ id: A, status: 'live' }, { id: B, status: 'paused', refused: 'trading-hold' }, { id: C, refused: 'not-found' }] })).toEqual([
      { id: A, status: 'live' }, { id: B, status: 'paused', refused: 'trading-hold' }, { id: C, refused: 'not-found' },
    ]);
    expect(() => parseSwitch({ results: [{ id: A }] })).toThrow();
  });

  it("words an offer as the board does, and an On offer nobody can see says why (M4)", () => {
    const [a, b, c] = parseMyOffers(RAW) as [MyOffer, MyOffer, MyOffer];
    expect([offerTitle(a), offerMethods(a), offerPrice(a), offerLimits(a)]).toEqual(['Selling XMR · USD', 'Zelle', '+0.5% · follows the market', '$50 – $2,000 per trade']);
    expect([offerTitle(b), offerPrice(b), offerLimits(b)]).toEqual(['Buying XMR · EUR', '€300.00 / XMR · Fixed price', '€12.50 – €500 per trade']);
    expect(offerMethods(c)).toBe('Amazon gift card (US)');
    expect(statusLine(a)).toBe('On · people can see and take it');
    expect(statusLine(b)).toBe('Off · hidden from everyone');
    expect(statusLine({ ...a, hidden: 'trading-paused' })).toBe('On, hidden while trading is paused');
    expect(statusLine({ ...a, hidden: 'trading-hold' })).toBe('On, hidden while your account has a trading hold');
    expect(statusLine({ ...b, hidden: 'trading-hold' })).toBe('Off · hidden from everyone');
    expect(countLine([a, b, c])).toBe('1 of 3 offers on');
    expect([allHint(0, 3), allHint(3, 3), allHint(2, 3)]).toEqual(['Pick offers to turn them on or off together.', 'All 3 offers selected.', 'Some selected: 2 of 3.']);
  });

  it('applies results, words the summary, always sends explicit ids (M1) and batches them (M5)', () => {
    const [a, b, c] = parseMyOffers(RAW) as [MyOffer, MyOffer, MyOffer];
    const next = applyResults([a, b, c], [{ id: a.id, status: 'paused' }, { id: b.id, status: 'paused', refused: 'trading-hold' }, { id: c.id, refused: 'not-found' }]);
    expect(next.map((o) => [o.id, o.status])).toEqual([[A, 'paused'], [B, 'paused']]);
    expect(summaryLine('paused', [{ id: A, status: 'paused' }, { id: B, status: 'paused' }])).toBe('2 offers turned off.');
    expect(summaryLine('live', [{ id: A, status: 'paused', refused: 'trading-hold' }])).toBe('No offers turned on. Each one says why below.');
    expect(idsFor([a, b, c], new Set([A, B, C]))).toEqual([A, B, C]);
    expect(idsFor([a, b, c], new Set([B, 'not-listed']))).toEqual([B]);
    const many = Array.from({ length: 250 }, (_, i) => `id${i}`);
    expect(batches(many).map((x) => x.length)).toEqual([100, 100, 50]);
    expect(batches(many).flat()).toEqual(many);
    for (const code of ['trading-hold', 'trading-paused', 'no-wallet', 'too-many-offers', 'method-unavailable', 'not-found', 'other']) {
      expect(refusalLine(code)).toMatch(/\.$/);
    }
    // The "can't do that" refusals get a short row line and the popup; the rest are said in the row.
    expect(refusalLine('trading-hold')).toBe('Stayed off: your account has a trading hold.');
    expect(refusalLine('too-many-offers')).toBe('Stayed off: over the offer limit for this market.');
    expect(cantDoFor([{ id: A, status: 'paused', refused: 'no-wallet' }])).toBeNull();
    expect(cantDoFor([{ id: A, status: 'paused', refused: 'too-many-offers' }, { id: B, status: 'paused', refused: 'trading-hold' }])).toEqual({ code: 'trading-hold', count: 1 });
    expect(cantDoFor([{ id: A, refused: 'too-many-offers' }, { id: B, refused: 'too-many-offers' }, { id: C, refused: 'trading-hold' }])).toEqual({ code: 'too-many-offers', count: 2 });
    expect(myOffersCantDoText('too-many-offers', 1)).toContain('turn this one on');
    expect(myOffersCantDoText('too-many-offers', 2)).toContain('turn these on');
  });
});

describe('the My offers screen', () => {
  it('lists every offer with its tick box and switch; a switch turns one offer on or off', async () => {
    const host = await mount();
    expect([...host.querySelectorAll('[data-part="offer"]')].map((r) => r.getAttribute('data-offer'))).toEqual([A, B, C]);
    expect(q(host, '[data-part="count"]').textContent).toBe('1 of 3 offers on');
    expect(isOn(host, A)).toBe(true);
    expect(isOn(host, B)).toBe(false);
    expect(sw(host, A).getAttribute('role')).toBe('switch');
    expect(tick(host, A).getAttribute('role')).toBe('checkbox');
    // M2 and M3: the names carry the method, price and limits; the switch's name starts with its visible text.
    expect(nameOf(sw(host, A))).toBe('On Selling XMR · USD Zelle +0.5% · follows the market $50 – $2,000 per trade');
    expect(nameOf(tick(host, A))).toBe('Select Selling XMR · USD Zelle +0.5% · follows the market $50 – $2,000 per trade');
    expect(row(host, A).querySelector('[data-part="status"]')!.textContent).toBe('On · people can see and take it');
    expect(q(host, '[data-part="bar"]')).toBeNull();

    await click(sw(host, B));
    expect(posts().at(-1)).toMatchObject({ url: '/v1/account/offers/status', body: { ids: [B], status: 'live' } });
    expect(isOn(host, B)).toBe(true);
    expect(q(host, '[data-part="summary"]').textContent).toBe('1 offer turned on.');
    expect(q(host, '[data-part="summary"]').getAttribute('role')).toBe('status');

    await click(sw(host, A));
    expect(posts().at(-1)!.body).toEqual({ ids: [A], status: 'paused' });
    expect(isOn(host, A)).toBe(false);
  });

  it('Select all only ticks: nothing is sent until Turn on or Turn off in the bar, which sends explicit ids (M1)', async () => {
    const host = await mount();
    await click(q(host, '[data-part="select-all"]'));
    expect([A, B, C].every((id) => isTicked(host, id))).toBe(true);
    expect(q(host, '[data-part="all-hint"]').textContent).toBe('All 3 offers selected.');
    expect(posts()).toEqual([]);
    expect([isOn(host, A), isOn(host, B), isOn(host, C)]).toEqual([true, false, false]);
    expect(q(host, '[data-part="sel-count"]').textContent).toBe('3 selected');

    await click(q(host, '[data-part="turn-off"]'));
    expect(posts().at(-1)!.body).toEqual({ ids: [A, B, C], status: 'paused' });
    for (const id of [A, B, C]) expect(isOn(host, id)).toBe(false);
    // The ticks clear after the bar's action, and the bar goes away.
    expect([A, B, C].some((id) => isTicked(host, id))).toBe(false);
    expect(q(host, '[data-part="bar"]')).toBeNull();

    // Two of three, then Turn on; Select all shows mixed.
    await click(tick(host, A));
    await click(tick(host, C));
    expect(q(host, '[data-part="select-all"]').getAttribute('aria-checked')).toBe('mixed');
    expect(q(host, '[data-part="all-hint"]').textContent).toBe('Some selected: 2 of 3.');
    await click(q(host, '[data-part="turn-on"]'));
    expect(posts().at(-1)!.body).toEqual({ ids: [A, C], status: 'live' });
    expect([isOn(host, A), isOn(host, B), isOn(host, C)]).toEqual([true, false, true]);

    // Select all with all ticked clears; Clear clears.
    await click(q(host, '[data-part="select-all"]'));
    await click(q(host, '[data-part="select-all"]'));
    expect([A, B, C].some((id) => isTicked(host, id))).toBe(false);
    await click(tick(host, B));
    await click(q(host, '[data-part="clear"]'));
    expect(isTicked(host, B)).toBe(false);
    expect(posts()).toHaveLength(2);
  });

  it('more than 100 ticked offers go in batches of 100 (M5)', async () => {
    list = Array.from({ length: 230 }, (_, i) => ({ ...RAW[1]!, id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` }));
    const host = await mount();
    await click(q(host, '[data-part="select-all"]'));
    await click(q(host, '[data-part="turn-on"]'));
    expect(posts().map((c) => (c.body!.ids as string[]).length)).toEqual([100, 100, 30]);
    expect(q(host, '[data-part="summary"]').textContent).toBe('230 offers turned on.');
    expect(host.querySelectorAll('[data-status="live"]')).toHaveLength(230);
    // Its own time budget: 230 rows rendered several times take ~0.8 s alone and several times
    // that under the full parallel suite, past the 5 s default. A timeout here also broke every
    // later test in this file (the timed-out body keeps calling act(), and React refuses
    // overlapping act() calls), which is why the full run showed six failures.
  }, 30_000);

  it('turning on while held: every offer stays off and each row says why, as an alert (N3)', async () => {
    onSwitch = (body) => ({
      status: 200,
      json: { status: body.status, results: body.ids.map((id) => ({ id, status: list.find((o) => o.id === id)!.status, refused: 'trading-hold' })) },
    });
    const host = await mount();
    await click(tick(host, B));
    await click(tick(host, C));
    await click(q(host, '[data-part="turn-on"]'));
    expect(q(host, '[data-part="summary"]').textContent).toBe('No offers turned on. Each one says why below.');
    expect(q(host, '[data-part="summary"]').getAttribute('role')).toBe('alert');
    expect(isOn(host, B)).toBe(false);
    const why = row(host, B).querySelector('[data-part="refused"]')!;
    expect(why.textContent).toBe(refusalLine('trading-hold'));
    expect(sw(host, B).getAttribute('aria-describedby')).toContain(why.id);
    // The hold is a "can't do that" refusal: CantDoThat opens, with the feedback link (Plan 5 Task 21).
    const pop = document.querySelector('[data-part="cant-do-that"]')!;
    expect(pop.getAttribute('data-from')).toBe('trading-hold');
    expect(pop.querySelector('[role="alert"]')!.textContent).toBe(myOffersCantDoText('trading-hold', 2));
    expect(pop.querySelector('a')!.getAttribute('href')).toBe('/feedback?from=trading-hold');
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain(CANT_DO_TITLE.myOffers);
    await click([...pop.querySelectorAll('button')].find((b) => b.textContent === 'OK')!);
    expect(document.querySelector('[data-part="cant-do-that"]')).toBeNull();
    onSwitch = allSwitch;
    await click(sw(host, B));
    expect(row(host, B).querySelector('[data-part="refused"]')).toBeNull();
  });

  it('a refusal that is not a "can\'t do that" (no wallet) stays inline, with no popup', async () => {
    onSwitch = (body) => ({ status: 200, json: { status: body.status, results: body.ids.map((id) => ({ id, status: 'paused', refused: 'no-wallet' })) } });
    const host = await mount();
    await click(sw(host, B));
    expect(row(host, B).querySelector('[data-part="refused"]')!.textContent).toBe(refusalLine('no-wallet'));
    expect(document.querySelector('[data-part="cant-do-that"]')).toBeNull();
  });

  it('a live offer hidden by a hold or a stop shows the real state (M4)', async () => {
    list[0] = { ...list[0]!, hidden: 'trading-paused' };
    const host = await mount();
    expect(isOn(host, A)).toBe(true);
    expect(row(host, A).querySelector('[data-part="status"]')!.textContent).toBe('On, hidden while trading is paused');
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
    expect(q(host, '[data-part="empty"]').textContent).toBe('You have no offers yet.');
    expect(q<HTMLAnchorElement>(host, '[data-part="post"]').getAttribute('href')).toBe('/post');
    host.remove();

    list = RAW.map((o) => ({ ...o }));
    onSwitch = () => ({ status: 500, json: { error: 'internal' } });
    host = await mount();
    await click(sw(host, A));
    expect(q(host, '[data-part="summary"]').textContent).toContain("weren't changed");
    expect(q(host, '[data-part="summary"]').getAttribute('role')).toBe('alert');
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

describe('My offers on a fold: two panes (Fold-MyOffers)', () => {
  const twoPanes = (q: string) => ({ matches: q === '(min-width: 600px)', addEventListener() {}, removeEventListener() {} });
  beforeEach(() => vi.stubGlobal('matchMedia', twoPanes));

  it('the list in the first pane, the shown offer in the next; a row picks the offer, its switch works there too', async () => {
    const host = await mount();
    const side = q(host, '[data-pane="side"]');
    expect(q(host, '[data-pane="main"] [data-screen="my-offers"]')).not.toBeNull();
    expect(side.getAttribute('aria-label')).toBe('Details: Selling XMR · USD');
    expect(q(side, '[data-detail-offer]').getAttribute('data-detail-offer')).toBe(A);
    const picks = [...host.querySelectorAll('[data-pane="main"] button[aria-pressed]')];
    expect(picks.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
    await click(picks[1]!);
    expect(q(side, '[data-detail-offer]').getAttribute('data-detail-offer')).toBe(B);
    expect(side.textContent).toContain('Who can trade');
    expect(side.textContent).toContain('5+ completed trades');
    expect(side.textContent).toContain('A fixed price doesn’t follow the market.');
    const detailSwitch = q<HTMLButtonElement>(side, '[data-part="detail-switch"]');
    expect(detailSwitch.getAttribute('aria-checked')).toBe('false');
    await click(detailSwitch);
    expect(posts().map((c) => c.body)).toEqual([{ ids: [B], status: 'live' }]);
    expect(isOn(host, B)).toBe(true);
    expect(q(side, '[data-part="detail-switch"]').getAttribute('aria-checked')).toBe('true');
  });

  it('on a phone there are no panes and no pick rows', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    const host = await mount();
    expect(host.querySelector('[data-pane="side"]')).toBeNull();
    expect(host.querySelector('button[aria-pressed]')).toBeNull();
  });
});
