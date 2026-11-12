// @vitest-environment happy-dom
// Plan 3 Task 36: My offers against a stubbed API in the shapes of apps/api/src/offers/routes.ts
// (MyOffer, OfferSwitchResult), and the screen's small rules. Behaviour after Claude Design's
// MyOffers board (2026-10-29): a tick box per offer, Select all only ticks, the bar applies. Design
// review 1 Nov 2026 (shots 31-35): real switches and 24 px tick boxes from the kit, the selection
// bar in the footer in place of Post an offer, and a hold summary that never contradicts itself.
import { act } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MyOffers } from '../src/screens/MyOffers.js';
import { parseMyOffers, parseSwitch, type MyOffer } from '../src/screens/myoffers/api.js';
import {
  allHint, applyResults, batches, cantDoFor, countLine, idsFor, isHeld, offerLimits, offerMethods, offerPrice, offerPriceParts, offerTitle, refusalLine, statusLine, summaryLine,
} from '../src/screens/myoffers/model.js';
import { CANT_DO_TITLE, MY_OFFERS_HOLD, myOffersCantDoText, postCantDoText } from '../src/ui/cantDoCodes.js';
import { fire, render } from './render.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

type Raw = Record<string, unknown> & { id: string; status: string };

const RAW: Raw[] = [
  {
    id: A, side: 'sell', methodId: 'ZELLE', methodName: 'Zelle', currency: 'USD', rate: '33165',
    pricing: { mode: 'market', marginBps: 50 }, minFiatCents: '5000', maxFiatCents: '200000', minTrades: null,
    status: 'live', createdAt: '2026-10-29T10:00:00.000Z',
  },
  {
    id: B, side: 'buy', methodId: 'REVOLUT', methodName: 'Revolut', currency: 'EUR', rate: '27000',
    pricing: { mode: 'market', marginBps: -1000 }, minFiatCents: '1250', maxFiatCents: '50000', minTrades: 5,
    status: 'paused', createdAt: '2026-10-29T09:00:00.000Z',
  },
  {
    id: C, side: 'sell', methodId: 'AMAZON_GC', methodName: 'Amazon gift card', currency: 'USD', rate: null,
    pricing: { mode: 'market', marginBps: -100 }, minFiatCents: '2500', maxFiatCents: '10000', minTrades: null,
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
const tick = (host: Element, id: string) => q<HTMLInputElement>(row(host, id), 'input[type="checkbox"][data-part="select"]');
const selectAll = (host: Element) => q<HTMLInputElement>(host, 'input[type="checkbox"][data-part="select-all"]');
const isOn = (host: Element, id: string) => sw(host, id).getAttribute('aria-checked') === 'true';
const isTicked = (host: Element, id: string) => tick(host, id).checked;
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
    expect(offers.map((o) => [o.id, o.status, o.rate])).toEqual([[A, 'live', 33165n], [B, 'paused', 27000n], [C, 'paused', null], ['x', 'live', 33165n]]);
    expect(offers[2]!.country).toBe('US');
    expect(offers[3]!.hidden).toBe('trading-hold');
    // No minimum is null on the wire (owner, 8 Nov), 0 in the model.
    expect(offers.map((o) => o.minTrades)).toEqual([0, 5, 0, 0]);
    expect(() => parseMyOffers([{ ...RAW[0], minTrades: '5' }])).toThrow();
    expect(() => parseMyOffers([{ ...RAW[0], hidden: 'nope' }])).toThrow();
    expect(() => parseMyOffers([{ ...RAW[0], status: 'removed' }])).toThrow();
    expect(() => parseMyOffers([{ ...RAW[0], minFiatCents: 5000 }])).toThrow();
    expect(() => parseMyOffers({})).toThrow();
    // There are no fixed-price offers (owner Q1): one priced as fixed does not parse.
    expect(() => parseMyOffers([{ ...RAW[1], pricing: { mode: 'fixed', centsPerXmr: '30000' } }])).toThrow();
    expect(parseSwitch({ status: 'live', results: [{ id: A, status: 'live' }, { id: B, status: 'paused', refused: 'trading-hold' }, { id: C, refused: 'not-found' }] })).toEqual([
      { id: A, status: 'live' }, { id: B, status: 'paused', refused: 'trading-hold' }, { id: C, refused: 'not-found' },
    ]);
    expect(() => parseSwitch({ results: [{ id: A }] })).toThrow();
  });

  it("words an offer as the board does, and an On offer nobody can see says why (M4)", () => {
    const [a, b, c] = parseMyOffers(RAW) as [MyOffer, MyOffer, MyOffer];
    expect([offerTitle(a), offerMethods(a), offerPrice(a), offerLimits(a)]).toEqual(['Selling XMR · USD', 'Zelle', '0.5% above market · follows the market', '$50 – $2,000 per trade']);
    expect([offerTitle(b), offerPrice(b), offerLimits(b)]).toEqual(['Buying XMR · EUR', '10% below market · follows the market', '€12.50 – €500 per trade']);
    expect(offerMethods(c)).toBe('Amazon gift card (US)');
    // Design final call (10 Nov 2026): the margin in the one form everywhere (ui/margin.ts).
    expect(offerPriceParts(a)).toEqual(['0.5% above market', 'follows the market']);
    expect(offerPriceParts(b)).toEqual(['10% below market', 'follows the market']);
    expect(statusLine(a)).toEqual({ text: 'On · people can see and take it', tone: 'on' });
    expect(statusLine(b)).toEqual({ text: 'Off · hidden from everyone', tone: 'off' });
    expect(statusLine({ ...a, hidden: 'trading-paused' })).toEqual({ text: 'On, hidden while trading is paused', tone: 'caution' });
    expect(statusLine({ ...b, hidden: 'trading-hold' })).toEqual({ text: 'Off · hidden from everyone', tone: 'off' });
    // During a trading hold every row and the header say so, in caution (design review shot 34).
    // Design session 2 Nov 2026: one caution chip, on or off.
    expect(statusLine(a, true)).toEqual({ text: 'Paused · trading hold', tone: 'caution' });
    expect(statusLine(b, true)).toEqual({ text: 'Paused · trading hold', tone: 'caution' });
    // Plan 5 Task 3 review M3: hidden until the poster rates their last trade.
    expect(statusLine({ ...a, hidden: 'review-pending' })).toEqual({ text: 'On, hidden until you rate your last trade', tone: 'caution' });
    expect(parseMyOffers([{ ...RAW[0], hidden: 'review-pending' }])[0]!.hidden).toBe('review-pending');
    expect(countLine([a, b, c])).toBe('1 of 3 offers on');
    expect(countLine([a, b, c], true)).toBe('Trading hold · all offers paused');
    expect(isHeld([a, b], false)).toBe(false);
    expect(isHeld([{ ...a, hidden: 'trading-hold' }, b], false)).toBe(true);
    expect(isHeld([{ ...a, hidden: 'trading-paused' }, b], false)).toBe(false);
    expect(isHeld([b], true)).toBe(true);
    expect([allHint(0, 3), allHint(3, 3), allHint(2, 3)]).toEqual(['Pick offers to turn them on or off together.', 'All 3 offers selected.', 'Some selected: 2 of 3.']);
  });

  it('J-16: an offer with several currencies and payment types lists them all; no market price in any is said (Task 34 review M4)', () => {
    const tier = { min: '5000', max: '200000', marginBps: 50, minTrades: null, methodIds: null };
    const multi = {
      ...RAW[0],
      currencies: [{ currency: 'USD', rate: '33165', tiers: [tier] }, { currency: 'CAD', rate: null, tiers: [tier] }],
      methods: [
        { methodId: 'ZELLE', methodName: 'Zelle', adjustBps: 0, instructions: '', currencies: ['USD'], instructionsByCurrency: {} },
        { methodId: 'PAYPAL', methodName: 'PayPal', adjustBps: 200, instructions: 'pp', currencies: ['USD', 'CAD'], instructionsByCurrency: {} },
      ],
    };
    const [m] = parseMyOffers([multi]) as [MyOffer];
    expect(m.currencies).toEqual(['USD', 'CAD']);
    expect(m.methodNames).toEqual(['Zelle', 'PayPal']);
    expect([offerTitle(m), offerMethods(m)]).toEqual(['Selling XMR · USD, CAD', 'Zelle, PayPal']);
    // An answer from before J-16 (no lists) reads as its one currency and method.
    const [a] = parseMyOffers(RAW) as [MyOffer];
    expect([a.currencies, a.methodNames]).toEqual([['USD'], ['Zelle']]);
    expect(() => parseMyOffers([{ ...multi, currencies: [{ currency: 'USD' }] }])).toThrow();
    expect(() => parseMyOffers([{ ...multi, methods: [{ methodId: 'ZELLE' }] }])).toThrow();
    const hidden = parseMyOffers([{ ...RAW[0], hidden: 'no-price' }])[0]!;
    expect(hidden.hidden).toBe('no-price');
    expect(statusLine(hidden).tone).toBe('caution');
  });

  it('applies results, words the summary, always sends explicit ids (M1) and batches them (M5)', () => {
    const [a, b, c] = parseMyOffers(RAW) as [MyOffer, MyOffer, MyOffer];
    const next = applyResults([a, b, c], [{ id: a.id, status: 'paused' }, { id: b.id, status: 'paused', refused: 'trading-hold' }, { id: c.id, refused: 'not-found' }]);
    expect(next.map((o) => [o.id, o.status])).toEqual([[A, 'paused'], [B, 'paused']]);
    expect(summaryLine('paused', [{ id: A, status: 'paused' }, { id: B, status: 'paused' }])).toEqual({ text: '2 offers turned off.', tone: 'plain' });
    // Counted against the statuses before (design review shot 33): an offer already on is not "turned on".
    expect(summaryLine('live', [{ id: A, status: 'live' }, { id: B, status: 'live' }], [a, b])).toEqual({ text: '1 offer turned on. 1 offer was already on.', tone: 'plain' });
    expect(summaryLine('live', [{ id: B, status: 'paused', refused: 'no-wallet' }, { id: C, status: 'paused', refused: 'no-wallet' }], [a, b, c])).toEqual({
      text: 'No offers turned on. 2 offers stayed as they were; each one says why below.', tone: 'caution',
    });
    expect(summaryLine('live', [{ id: B, status: 'live' }, { id: C, status: 'paused', refused: 'no-wallet' }], [a, b, c]).text).toBe('1 offer turned on. 1 offer stayed as it was; each one says why below.');
    // A hold: the one already on and the refused ones never read as "turned on"; it says the hold, in caution.
    const hold = summaryLine('live', [{ id: A, status: 'live' }, { id: B, status: 'paused', refused: 'trading-hold' }], [a, b]);
    expect(hold).toEqual({ text: 'Trading hold: no offers were turned on. They stay paused until the hold ends.', tone: 'caution', hold: true });
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
    // The cap is per side now (owner 2026-11-01), not per market.
    expect(refusalLine('too-many-offers')).toBe('Stayed off: over the offer limit.');
    expect(cantDoFor([{ id: A, status: 'paused', refused: 'no-wallet' }])).toBeNull();
    expect(cantDoFor([{ id: A, status: 'paused', refused: 'too-many-offers' }, { id: B, status: 'paused', refused: 'trading-hold' }])).toEqual({ code: 'trading-hold', count: 1 });
    expect(cantDoFor([{ id: A, refused: 'too-many-offers' }, { id: B, refused: 'too-many-offers' }, { id: C, refused: 'trading-hold' }])).toEqual({ code: 'too-many-offers', count: 2 });
    // O-028 (owner 28 Oct Q14): the limit pop-up in the owner's words.
    expect(myOffersCantDoText('too-many-offers', 1)).toBe("Sorry, you're limited to 3 offers per side: 3 buying and 3 selling. Remove one you no longer need, then turn this one on.");
    expect(myOffersCantDoText('too-many-offers', 2)).toBe("Sorry, you're limited to 3 offers per side: 3 buying and 3 selling. Remove ones you no longer need, then turn these on.");
    for (const n of [1, 2]) expect(myOffersCantDoText('too-many-offers', n)).not.toMatch(/market/);
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
    expect(sw(host, A).tagName).toBe('BUTTON');
    expect(tick(host, A).type).toBe('checkbox');
    // The tick box's whole 44 px label is its tap target (ui/Checkbox).
    expect(tick(host, A).closest('label')!.className).toBe('x2f-tickbox');
    // M2: the names carry the method, price and limits. The switch is a real track with no words now.
    expect(sw(host, A).textContent).toBe('');
    expect(nameOf(sw(host, A))).toBe('Selling XMR · USD Zelle 0.5% above market · follows the market $50 – $2,000 per trade');
    expect(nameOf(tick(host, A))).toBe('Select Selling XMR · USD Zelle 0.5% above market · follows the market $50 – $2,000 per trade');
    expect(row(host, A).querySelector('[data-part="status"]')!.textContent).toBe('On · people can see and take it');
    // An Off offer's card is drawn dashed; a ticked one gets the ink ring (never orange).
    expect([row(host, A).getAttribute('data-on'), row(host, B).getAttribute('data-on')]).toEqual(['true', 'false']);
    expect(row(host, A).getAttribute('data-selected')).toBe('false');
    expect(q(host, '[data-part="bar"]')).toBeNull();
    // With nothing ticked, the footer holds Post an offer.
    expect(q(host, '.x2f-action-bar [data-part="post"]')).not.toBeNull();

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
    await click(selectAll(host));
    expect([A, B, C].every((id) => isTicked(host, id))).toBe(true);
    expect(row(host, A).getAttribute('data-selected')).toBe('true');
    // The selection bar takes the place of Post an offer in the footer (design review shot 32).
    expect(q(host, '.x2f-action-bar[data-part="bar"]')).not.toBeNull();
    expect(q(host, '[data-part="post"]')).toBeNull();
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
    expect(selectAll(host).indeterminate).toBe(true);
    expect(selectAll(host).checked).toBe(false);
    expect(q(host, '[data-part="all-hint"]').textContent).toBe('Some selected: 2 of 3.');
    await click(q(host, '[data-part="turn-on"]'));
    expect(posts().at(-1)!.body).toEqual({ ids: [A, C], status: 'live' });
    expect([isOn(host, A), isOn(host, B), isOn(host, C)]).toEqual([true, false, true]);

    // Select all with all ticked clears; Clear clears.
    await click(selectAll(host));
    expect(selectAll(host).indeterminate).toBe(false);
    expect(selectAll(host).checked).toBe(true);
    await click(selectAll(host));
    expect([A, B, C].some((id) => isTicked(host, id))).toBe(false);
    await click(tick(host, B));
    await click(q(host, '[data-part="clear"]'));
    expect(isTicked(host, B)).toBe(false);
    expect(posts()).toHaveLength(2);
  });

  it('more than 100 ticked offers go in batches of 100 (M5)', async () => {
    list = Array.from({ length: 230 }, (_, i) => ({ ...RAW[1]!, id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` }));
    const host = await mount();
    await click(selectAll(host));
    await click(q(host, '[data-part="turn-on"]'));
    expect(posts().map((c) => (c.body!.ids as string[]).length)).toEqual([100, 100, 30]);
    expect(q(host, '[data-part="summary"]').textContent).toBe('230 offers turned on.');
    expect(host.querySelectorAll('[data-status="live"]')).toHaveLength(230);
    // Its own time budget: 230 rows rendered several times take ~0.8 s alone and several times
    // that under the full parallel suite, past the 5 s default. A timeout here also broke every
    // later test in this file (the timed-out body keeps calling act(), and React refuses
    // overlapping act() calls), which is why the full run showed six failures.
  }, 30_000);

  it('turning on while held: the hold popup, one caution notice at the top, a Paused chip on every offer and every switch disabled (design session 2 Nov 2026)', async () => {
    onSwitch = (body) => ({
      status: 200,
      json: { status: body.status, results: body.ids.map((id) => ({ id, status: list.find((o) => o.id === id)!.status, refused: 'trading-hold' })) },
    });
    const host = await mount();
    expect(q(host, '[data-part="hold-notice"]')).toBeNull();
    await click(tick(host, B));
    await click(tick(host, C));
    await click(q(host, '[data-part="turn-on"]'));
    // None could be turned on: the hold's own popup, with the feedback link (Plan 5 Task 21).
    const pop = document.querySelector('[data-part="cant-do-that"]')!;
    expect(pop.getAttribute('data-from')).toBe('trading-hold');
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain("You can't turn offers on during a trading hold");
    expect(CANT_DO_TITLE.myOffersHold).toBe("You can't turn offers on during a trading hold");
    expect(pop.querySelector('[data-part="cant-do-message"]')!.textContent).toBe('They stay paused until the hold ends. Trades already started carry on.');
    expect(pop.querySelector('[data-part="cant-do-items"]')).toBeNull();
    expect(pop.querySelector('a')!.getAttribute('href')).toBe('/feedback?from=trading-hold');
    await click([...pop.querySelectorAll('button')].find((b) => b.textContent === 'OK')!);
    expect(document.querySelector('[data-part="cant-do-that"]')).toBeNull();
    // One caution notice at the top; no second summary line repeats it.
    const notice = q(host, '[data-part="hold-notice"]');
    expect(notice.getAttribute('data-tone')).toBe('caution');
    expect(notice.querySelector('.x2f-outcome__title')!.textContent).toBe('Your offers are paused during a trading hold');
    expect(notice.textContent).toBe(MY_OFFERS_HOLD.title + MY_OFFERS_HOLD.body);
    expect(MY_OFFERS_HOLD.body).toBe('Nobody can see or take them until the hold ends. Trades already started carry on.');
    expect(host.querySelectorAll('.x2f-outcome')).toHaveLength(1);
    expect(q(host, '[data-part="summary"]')).toBeNull();
    expect(isOn(host, B)).toBe(false);
    expect(q(host, '[data-part="count"]').textContent).toBe('Trading hold · all offers paused');
    for (const id of [A, B, C]) {
      const status = row(host, id).querySelector('[data-part="status"]')!;
      expect([status.textContent, status.getAttribute('data-tone'), status.getAttribute('data-chip')]).toEqual(['Paused · trading hold', 'caution', 'true']);
      expect(row(host, id).querySelector('[data-part="refused"]')).toBeNull();
      expect(sw(host, id).getAttribute('aria-describedby')).toBe(status.id);
      expect(sw(host, id).disabled).toBe(true);
    }
  });

  it('during a hold, Post an offer opens CantDoThat instead of the form (batch 3 board)', async () => {
    list[0] = { ...list[0]!, hidden: 'trading-hold' };
    const host = await mount();
    const post = q<HTMLAnchorElement>(host, '[data-part="post"]');
    expect(post.hasAttribute('data-primary')).toBe(true);
    await click(post);
    const pop = document.querySelector('[data-part="cant-do-that"]')!;
    expect(pop.getAttribute('data-from')).toBe('trading-hold');
    expect(pop.querySelector('[data-part="cant-do-message"]')!.textContent).toBe(postCantDoText('trading-hold'));
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain(CANT_DO_TITLE.post);
  });

  it('the footnote carries the cap line (batch 3 board, COPY-UNSIGNED)', async () => {
    const host = await mount();
    expect(q(host, '[data-part="footnote"]').textContent).toContain('You can have 3 buying and 3 selling offers. Each offer can cover several currencies.');
  });

  it('a Turn on that some offers pass and some cannot: "Some offers can\'t be turned on", listing which and why', async () => {
    onSwitch = (body) => {
      const results = body.ids.map((id) => (id === B ? { id, status: 'paused', refused: 'too-many-offers' } : { id, status: 'live' }));
      list = list.map((o) => (o.id === C ? { ...o, status: 'live' } : o));
      return { status: 200, json: { status: body.status, results } };
    };
    const host = await mount();
    await click(tick(host, B));
    await click(tick(host, C));
    await click(q(host, '[data-part="turn-on"]'));
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain(CANT_DO_TITLE.myOffers);
    expect(CANT_DO_TITLE.myOffers).toBe("Some offers can't be turned on");
    const items = [...document.querySelectorAll('[data-part="cant-do-items"] li')].map((li) => li.textContent);
    expect(items).toEqual([`Buying XMR · EUR, Revolut: ${refusalLine('too-many-offers')}`]);
    expect(isOn(host, C)).toBe(true);
    expect(q(host, '[data-part="hold-notice"]')).toBeNull();
  });

  it('the hold state comes from the latest Turn on and is cleared by a fresh list read (review M1)', async () => {
    onSwitch = (body) => ({
      status: 200,
      json: { status: body.status, results: body.ids.map((id) => ({ id, status: list.find((o) => o.id === id)!.status, refused: 'trading-hold' })) },
    });
    let host = await mount();
    await click(sw(host, B));
    expect(q(host, '[data-part="count"]').textContent).toBe('Trading hold · all offers paused');
    await click([...document.querySelectorAll('[data-part="cant-do-that"] button')].find((b) => b.textContent === 'OK')!);
    // Batch 3 board: the switches and the bar's Turn on / Turn off are disabled during the hold.
    await click(tick(host, B));
    expect(q<HTMLButtonElement>(host, '[data-part="turn-on"]').disabled).toBe(true);
    expect(q<HTMLButtonElement>(host, '[data-part="turn-off"]').disabled).toBe(true);
    host.remove();

    // A Turn on refused for the hold that also re-reads the list (an offer removed elsewhere): the
    // fresh list marks no live offer hidden, so the screen leaves the hold state.
    onSwitch = (body) => {
      list = list.filter((o) => o.id !== C);
      return { status: 200, json: { status: body.status, results: [{ id: B, status: 'paused', refused: 'trading-hold' }, { id: C, refused: 'not-found' }] } };
    };
    host = await mount();
    await click(tick(host, B));
    await click(tick(host, C));
    await click(q(host, '[data-part="turn-on"]'));
    expect(q(host, '[data-part="count"]').textContent).toBe('1 of 2 offers on');
    expect(sw(host, B).disabled).toBe(false);
  });

  it('the selected count is a live region that exists before the first tick, so "1 selected" is announced (review N2)', async () => {
    const host = await mount();
    const live = q(host, '[data-part="sel-count"]');
    expect(live).not.toBeNull();
    expect([live.getAttribute('aria-live'), live.textContent]).toEqual(['polite', '']);
    await click(tick(host, A));
    expect(q(host, '[data-part="sel-count"]')).toBe(live);
    expect(live.textContent).toBe('1 selected');
    await click(tick(host, A));
    expect(live.textContent).toBe('');
  });

  it('a refusal that is not a "can\'t do that" (no wallet) stays inline, with no popup', async () => {
    onSwitch = (body) => ({ status: 200, json: { status: body.status, results: body.ids.map((id) => ({ id, status: 'paused', refused: 'no-wallet' })) } });
    const host = await mount();
    await click(sw(host, B));
    const why = row(host, B).querySelector('[data-part="refused"]')!;
    expect(why.textContent).toBe(refusalLine('no-wallet'));
    expect(sw(host, B).getAttribute('aria-describedby')).toContain(why.id);
    expect(document.querySelector('[data-part="cant-do-that"]')).toBeNull();
    // A refusal is information, not an error: caution, not danger.
    expect(q(host, '[data-part="summary"]').getAttribute('data-tone')).toBe('caution');
  });

  it('a live offer hidden by a hold or a stop shows the real state (M4)', async () => {
    list[0] = { ...list[0]!, hidden: 'trading-paused' };
    const host = await mount();
    expect(isOn(host, A)).toBe(true);
    expect(row(host, A).querySelector('[data-part="status"]')!.textContent).toBe('On, hidden while trading is paused');
  });

  it('a live offer hidden by a hold puts the whole screen in the hold state on load', async () => {
    list[0] = { ...list[0]!, hidden: 'trading-hold' };
    const host = await mount();
    expect(isOn(host, A)).toBe(true);
    expect(q(host, '[data-part="count"]').textContent).toBe('Trading hold · all offers paused');
    expect(row(host, B).querySelector('[data-part="status"]')!.textContent).toBe('Paused · trading hold');
    expect(q(host, '[data-part="hold-notice"]')).not.toBeNull();
    expect(sw(host, A).disabled).toBe(true);
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
    expect(q(host, '[data-part="empty"] h2').textContent).toBe('No offers yet');
    expect(q(host, '[data-part="empty"] p').textContent).toBe('Post an offer to buy or sell XMR.');
    // No "0 of 0 offers on" (design review shot 35).
    expect(q(host, '[data-part="count"]')).toBeNull();
    expect(q<HTMLAnchorElement>(host, '[data-part="post"]').getAttribute('href')).toBe('/post');
    host.remove();

    list = RAW.map((o) => ({ ...o }));
    onSwitch = () => ({ status: 500, json: { error: 'internal' } });
    host = await mount();
    await click(sw(host, A));
    expect(q(host, '[data-part="summary"]').textContent).toContain("weren't changed");
    expect(q(host, '[data-part="summary"]').getAttribute('role')).toBe('alert');
    expect(q(host, '[data-part="summary"]').getAttribute('data-tone')).toBe('danger');
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
    // Review N5: named by its title and methods, described by its status (not the whole row).
    expect(picks[0]!.getAttribute('aria-labelledby')).toMatch(/-title \S+-methods$/);
    expect(picks[0]!.getAttribute('aria-describedby')).toMatch(/-status$/);
    await click(picks[1]!);
    expect(q(side, '[data-detail-offer]').getAttribute('data-detail-offer')).toBe(B);
    expect(side.textContent).toContain('Who can trade');
    expect(side.textContent).toContain('5+ completed trades');
    // Owner Q1: every offer follows the market (there is no fixed-price line).
    expect(side.textContent).toContain('Percent of the market price, updated as the market moves.');
    expect(side.textContent).not.toContain('fixed price');
    const detailSwitch = q<HTMLButtonElement>(side, '[data-part="detail-switch"]');
    // Review N6: the pane's switch is the kit Switch, the same part as each card's.
    expect(detailSwitch.className).toBe(q(host, '[data-pane="main"] [data-part="switch"]').className);
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
