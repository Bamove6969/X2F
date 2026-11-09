// @vitest-environment happy-dom
// J-17 (owner G50-G53, F13, T-081): the gift-card rules on the web. The words are COPY-UNSIGNED
// placeholders (design writes the rules text, J-31 T-058); these tests pin which boxes and items
// show, not their sentences.
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { GIFT_CARD_EVIDENCE, GIFT_CARD_TERMS, GIFT_CARD_TERMS_VERSION, type GiftCardRole } from '@x2f/trade';
import { GiftCardEvidence, GiftCardTerms } from '../src/screens/giftcard/GiftCardRules.js';
import { GIFT_CARD_COPY, giftCardEvidenceText, giftCardTermText } from '../src/screens/giftcard/giftCardCopy.js';
import { CURRENCY_NOT_CARD, DEFAULT_FORM, GIFT_CARD_TERMS_UNTICKED, validate, type FormState } from '../src/screens/post/offerForm.js';
import { fire, render } from './render.js';

const form = (over: Partial<FormState> = {}): FormState => ({ ...DEFAULT_FORM, methodId: 'STEAM_GIFT_CARD', min: '50', max: '2000', unit: 'fiat', country: 'US', ...over });
const all = (role: GiftCardRole) => new Set<string>(GIFT_CARD_TERMS[role]);

describe('the post form (J-17)', () => {
  it("the card's currency follows its country (T-081)", () => {
    const r = validate(form({ country: 'DE', currency: 'USD' }), { giftCard: true, giftCardTicked: all('checker') });
    expect(r.body).toBeUndefined();
    expect(r.errors).toEqual({ currency: CURRENCY_NOT_CARD });
    expect(validate(form({ country: 'DE', currency: 'EUR' }), { giftCard: true, giftCardTicked: all('checker') }).errors).toEqual({});
    // Not a gift card: any listed currency.
    expect(validate(form({ methodId: 'ZELLE', country: '', currency: 'EUR' }), { giftCard: false }).errors).toEqual({});
  });

  it("the poster ticks every term of their side (a sell ad's poster checks the card, a buy ad's sends it); the body carries the version (F13)", () => {
    // Sell XMR: the poster is the seller, who checks the card.
    const sell = validate(form(), { giftCard: true, giftCardTicked: all('sender') });
    expect(sell.errors).toEqual({ giftCardTerms: GIFT_CARD_TERMS_UNTICKED });
    const sold = validate(form(), { giftCard: true, giftCardTicked: all('checker') });
    expect(sold.body?.giftCardTerms).toBe(GIFT_CARD_TERMS_VERSION);
    // Buy XMR: the poster pays with the card.
    expect(validate(form({ side: 'buy' }), { giftCard: true, giftCardTicked: all('checker') }).errors).toEqual({ giftCardTerms: GIFT_CARD_TERMS_UNTICKED });
    expect(validate(form({ side: 'buy' }), { giftCard: true, giftCardTicked: all('sender') }).body?.giftCardTerms).toBe(GIFT_CARD_TERMS_VERSION);
    // Never on another method.
    expect(validate(form({ methodId: 'ZELLE', country: '' }), { giftCard: false, giftCardTicked: all('checker') }).body).not.toHaveProperty('giftCardTerms');
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
