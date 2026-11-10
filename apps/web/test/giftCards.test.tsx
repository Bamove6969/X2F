// @vitest-environment happy-dom
// J-17 (owner G50-G53, F13, T-081): the gift-card rules on the web. The words are COPY-UNSIGNED
// placeholders (design writes the rules text, J-31 T-058); these tests pin which boxes and items
// show, not their sentences.
import { act, useState } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { GIFT_CARD_EVIDENCE, GIFT_CARD_TERMS, GIFT_CARD_TERMS_VERSION, type GiftCardRole } from '@x2f/trade';
import { PostOffer } from '../src/screens/PostOffer.js';
import { GiftCardEvidence, GiftCardTerms } from '../src/screens/giftcard/GiftCardRules.js';
import { GIFT_CARD_COPY, giftCardEvidenceText, giftCardTermText } from '../src/screens/giftcard/giftCardCopy.js';
import { CURRENCY_NOT_CARD, DEFAULT_FORM, GIFT_CARD_TERMS_UNTICKED, validate, type FormState } from '../src/screens/post/offerForm.js';
import { fire, render } from './render.js';

/** A fiat offer in `currencies` (one band 50-2,000 each) paid by a Steam card from the US (J-16's form shape). */
const form = (over: Partial<FormState> = {}, currencies: string[] = ['USD'], methodId = 'STEAM_GIFT_CARD'): FormState => ({
  ...DEFAULT_FORM,
  unit: 'fiat',
  currencies,
  bands: Object.fromEntries(currencies.map((c, i) => [c, [{ key: i + 1, min: '50', max: '2000', marginSide: 'above', marginPct: '0.5', minTrades: null }]])),
  methods: [{ methodId, adjustBps: 0, same: true, instructions: '', byCurrency: {} }],
  country: 'US',
  ...over,
});
const all = (role: GiftCardRole) => new Set<string>(GIFT_CARD_TERMS[role]);
const giftCard = (id: string) => id !== 'ZELLE';

describe('the post form (J-17)', () => {
  it("the card's currency follows its country (T-081): every currency the card method is offered in", () => {
    const r = validate(form({ country: 'DE' }), { giftCard, giftCardTicked: all('checker') });
    expect(r.body).toBeUndefined();
    expect(r.errors).toEqual({ currencies: CURRENCY_NOT_CARD });
    expect(validate(form({ country: 'DE' }, ['EUR']), { giftCard, giftCardTicked: all('checker') }).errors).toEqual({});
    // J-16: the form offers every method in every picked currency, so with a card method on the
    // offer every picked currency must be the card's country's (lead ruling, 10 Nov).
    expect(validate(form({}, ['USD', 'EUR']), { giftCard, giftCardTicked: all('checker') }).errors).toEqual({ currencies: CURRENCY_NOT_CARD });
    // Panama's cards may be in US dollars (ISO 4217 lists both legal tenders).
    expect(validate(form({ country: 'PA' }), { giftCard, giftCardTicked: all('checker') }).errors).toEqual({});
    // Not a gift card: any listed currencies.
    expect(validate(form({ country: '' }, ['USD', 'EUR'], 'ZELLE'), { giftCard }).errors).toEqual({});
  });

  it("the poster ticks every term of their side (a sell ad's poster checks the card, a buy ad's sends it); the body carries the version (F13)", () => {
    // Sell XMR: the poster is the seller, who checks the card.
    const sell = validate(form(), { giftCard, giftCardTicked: all('sender') });
    expect(sell.errors).toEqual({ giftCardTerms: GIFT_CARD_TERMS_UNTICKED });
    const sold = validate(form(), { giftCard, giftCardTicked: all('checker') });
    expect(sold.body?.giftCardTerms).toBe(GIFT_CARD_TERMS_VERSION);
    expect(sold.body?.country).toBe('US');
    // Buy XMR: the poster pays with the card.
    expect(validate(form({ side: 'buy' }), { giftCard, giftCardTicked: all('checker') }).errors).toEqual({ giftCardTerms: GIFT_CARD_TERMS_UNTICKED });
    expect(validate(form({ side: 'buy' }), { giftCard, giftCardTicked: all('sender') }).body?.giftCardTerms).toBe(GIFT_CARD_TERMS_VERSION);
    // Never on another method.
    expect(validate(form({ country: '' }, ['USD'], 'ZELLE'), { giftCard, giftCardTicked: all('checker') }).body).not.toHaveProperty('giftCardTerms');
  });
});

describe('the words (COPY-UNSIGNED)', () => {
  it('every term and evidence item of each side has words', () => {
    for (const role of ['sender', 'checker'] as const) {
      for (const k of GIFT_CARD_TERMS[role]) expect(giftCardTermText(role, k).length, `${role} ${k}`).toBeGreaterThan(0);
      for (const e of GIFT_CARD_EVIDENCE[role]) expect(giftCardEvidenceText(e.key).length, e.key).toBeGreaterThan(0);
    }
    expect(GIFT_CARD_COPY.unsigned).toBe(true);
  });
});

function Terms({ role }: { role: GiftCardRole }) {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  return (
    <>
      <GiftCardTerms role={role} ticked={ticked} onChange={setTicked} />
      <output data-done={String(GIFT_CARD_TERMS[role].every((k) => ticked.has(k)))} />
    </>
  );
}

describe('<GiftCardTerms>', () => {
  it("shows one tick box per term of the reader's side, in order, and reports each tick", () => {
    const { host } = render(<Terms role="sender" />);
    const boxes = [...host.querySelectorAll<HTMLInputElement>('[data-part="gift-card-terms"] input[type="checkbox"]')];
    expect(boxes.map((b) => b.closest('[data-term]')?.getAttribute('data-term'))).toEqual([...GIFT_CARD_TERMS.sender]);
    for (const b of boxes) fire(b, new MouseEvent('click', { bubbles: true }));
    expect(host.querySelector('output')?.getAttribute('data-done')).toBe('true');
    fire(boxes[0]!, new MouseEvent('click', { bubbles: true }));
    expect(host.querySelector('output')?.getAttribute('data-done')).toBe('false');
  });
});

describe('<GiftCardEvidence>', () => {
  it('the sender keeps the receipt and a photo; the login video is for a range card, a seam the lead builds (T-054)', () => {
    const { host } = render(<GiftCardEvidence role="sender" />);
    const items = [...host.querySelectorAll('[data-part="gift-card-evidence"] [data-evidence]')];
    expect(items.map((i) => [i.getAttribute('data-evidence'), i.getAttribute('data-needed')])).toEqual([
      ['receipt', 'always'],
      ['card-photo', 'always'],
      ['login-video', 'range-card'],
    ]);
    // NEEDS(lead, T-054): no upload control here yet.
    expect(items[2]!.getAttribute('data-seam')).toBe('video-proof');
    expect(host.querySelector('input[type="file"]')).toBeNull();
  });

  it('the checker keeps what the check showed', () => {
    const { host } = render(<GiftCardEvidence role="checker" />);
    expect([...host.querySelectorAll('[data-evidence]')].map((i) => i.getAttribute('data-evidence'))).toEqual(['check-result']);
  });
});

describe('<PostOffer> on a gift card (J-17)', () => {
  it("shows the poster's tick boxes and posts the terms version only once all are ticked", async () => {
    const posted: Record<string, unknown>[] = [];
    const methods = { live: [], all: [{ id: 'STEAM_GIFT_CARD', name: 'Steam gift card', group: 'Gift cards & vouchers', giftCard: true, offers: 0, bestRate: null }] };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), 'http://x2f.test');
        const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
        if (url.pathname === '/v1/methods') return json(methods);
        if (url.pathname === '/v1/offers' && init?.method === 'POST') {
          posted.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          return json({ id: 'o1' }, 201);
        }
        return json({ error: 'price-unavailable' }, 503);
      }),
    );
    sessionStorage.clear();
    const { host } = render(
      <MemoryRouter initialEntries={['/post?method=STEAM_GIFT_CARD&side=buy']}>
        <PostOffer />
      </MemoryRouter>,
    );
    const settle = async () => {
      for (let i = 0; i < 6; i += 1) await act(async () => new Promise((r) => setTimeout(r, 0)));
    };
    await settle();
    const setValue = (sel: string, v: string) => {
      const el = host.querySelector<HTMLInputElement | HTMLSelectElement>(sel)!;
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      act(() => {
        Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, v);
        el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
      });
    };
    setValue('#country', 'US');
    // A buy ad's poster pays with the card: the sender's boxes.
    const boxes = [...host.querySelectorAll<HTMLInputElement>('[data-part="gift-card-terms"] input[type="checkbox"]')];
    expect(boxes.map((b) => b.closest('[data-term]')?.getAttribute('data-term'))).toEqual([...GIFT_CARD_TERMS.sender]);
    // The one USD band's boxes (J-16: ids are currency-key-part); the form opens in XMR.
    expect(host.querySelector('#USD-1-min')).not.toBeNull();
    expect(host.querySelector('#USD-1-max')).not.toBeNull();
    setValue('#USD-1-min', '0.5');
    setValue('#USD-1-max', '2');
    const postButton = () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Post offer')!;
    fire(postButton(), new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(posted).toEqual([]);
    expect(host.textContent).toContain(GIFT_CARD_TERMS_UNTICKED);
    for (const b of boxes) fire(b, new MouseEvent('click', { bubbles: true }));
    fire(postButton(), new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ methods: [{ methodId: 'STEAM_GIFT_CARD' }], country: 'US', currencies: [{ currency: 'USD' }], giftCardTerms: GIFT_CARD_TERMS_VERSION });
    vi.unstubAllGlobals();
  });
});
