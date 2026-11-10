// J-17 gift-card rules (owner G50-G52, F13, T-081): the card's age, its value, its currency by
// country, the check window, who ticks which terms and what evidence each side keeps.
import { describe, expect, it } from 'vitest';
import {
  GIFT_CARD_CHECK_MIN,
  GIFT_CARD_CURRENCIES,
  GIFT_CARD_EVIDENCE,
  GIFT_CARD_MAX_AGE_DAYS,
  GIFT_CARD_TERMS,
  GIFT_CARD_TERMS_VERSION,
  giftCardCurrencies,
  giftCardCurrencyOk,
  giftCardEvidence,
  giftCardRole,
  giftCardTermsComplete,
  giftCardValueRule,
} from '../src/index.js';

describe('gift-card rules', () => {
  it('a card bought within the last 30 days (G51); 45 minutes to check it (G50)', () => {
    expect(GIFT_CARD_MAX_AGE_DAYS).toBe(30);
    expect(GIFT_CARD_CHECK_MIN).toBe(45);
  });

  it('the full written value only; a range card may be partial and then needs video proof (G52)', () => {
    expect(giftCardValueRule(false)).toEqual({ partialAllowed: false, videoProof: false });
    expect(giftCardValueRule(true)).toEqual({ partialAllowed: true, videoProof: true });
  });

  it('the card sender is the XMR buyer (pays with the card); the checker is the seller who holds the escrow', () => {
    expect(giftCardRole('buyer')).toBe('sender');
    expect(giftCardRole('seller')).toBe('checker');
  });
});

describe("the card's currency follows its country (T-081)", () => {
  it('covers all 249 ISO 3166-1 alpha-2 codes, each with ISO 4217 codes', () => {
    expect(Object.keys(GIFT_CARD_CURRENCIES)).toHaveLength(249);
    for (const [country, list] of Object.entries(GIFT_CARD_CURRENCIES)) {
      expect(country, country).toMatch(/^[A-Z]{2}$/);
      for (const c of list) expect(c, country).toMatch(/^[A-Z]{3}$/);
    }
  });

  it("a card is in its country's currency, never another", () => {
    expect(giftCardCurrencies('US')).toEqual(['USD']);
    expect(giftCardCurrencies('CA')).toEqual(['CAD']);
    expect(giftCardCurrencies('GB')).toEqual(['GBP']);
    expect(giftCardCurrencies('DE')).toEqual(['EUR']);
    expect(giftCardCurrencies('BR')).toEqual(['BRL']);
    expect(giftCardCurrencies('IN')).toEqual(['INR']);
    // Bulgaria joined the euro on 1 Jan 2026; Croatia on 1 Jan 2023.
    expect(giftCardCurrencies('BG')).toEqual(['EUR']);
    expect(giftCardCurrencies('HR')).toEqual(['EUR']);
    // ISO 4217 lists two legal tenders for a few countries.
    expect(giftCardCurrencies('PA')).toEqual(['PAB', 'USD']);
    expect(giftCardCurrencyOk('US', 'USD')).toBe(true);
    expect(giftCardCurrencyOk('US', 'CAD')).toBe(false);
    expect(giftCardCurrencyOk('CA', 'USD')).toBe(false);
    expect(giftCardCurrencyOk('PA', 'USD')).toBe(true);
  });

  it('no currency for a place ISO 4217 gives none, nor for an unknown code', () => {
    expect(giftCardCurrencies('AQ')).toEqual([]);
    expect(giftCardCurrencies('ZZ')).toEqual([]);
    expect(giftCardCurrencies('us')).toEqual([]);
    expect(giftCardCurrencyOk('AQ', 'USD')).toBe(false);
    expect(giftCardCurrencyOk('toString', 'USD')).toBe(false);
  });
});

describe('tick-box terms (F13)', () => {
  it('each side ticks its own list; the version names the draft until design signs the words', () => {
    expect(GIFT_CARD_TERMS_VERSION).toMatch(/unsigned/);
    expect(GIFT_CARD_TERMS.sender).toEqual(['bought-within-30-days', 'full-written-value', 'country-currency', 'check-window']);
    expect(GIFT_CARD_TERMS.checker).toEqual(['check-window', 'check-before-release', 'country-currency']);
  });

  it('complete only when every term of that side is ticked', () => {
    expect(giftCardTermsComplete('sender', new Set(GIFT_CARD_TERMS.sender))).toBe(true);
    expect(giftCardTermsComplete('sender', new Set(GIFT_CARD_TERMS.checker))).toBe(false);
    expect(giftCardTermsComplete('checker', new Set(GIFT_CARD_TERMS.checker))).toBe(true);
    expect(giftCardTermsComplete('checker', new Set())).toBe(false);
  });
});

describe('evidence checklist (F13, G50-G52)', () => {
  it('the sender keeps the receipt and a photo of the card; a range card adds the login video', () => {
    expect(GIFT_CARD_EVIDENCE.sender.map((e) => e.key)).toEqual(['receipt', 'card-photo', 'login-video']);
    expect(giftCardEvidence('sender', { rangeCard: false })).toEqual([
      { key: 'receipt', required: true },
      { key: 'card-photo', required: true },
      { key: 'login-video', required: false, seam: 'video-proof' },
    ]);
    expect(giftCardEvidence('sender', { rangeCard: true }).find((e) => e.key === 'login-video')).toEqual({
      key: 'login-video',
      required: true,
      seam: 'video-proof',
    });
  });

  it('the checker keeps what the check showed, inside the window', () => {
    expect(giftCardEvidence('checker', { rangeCard: false })).toEqual([{ key: 'check-result', required: true }]);
    expect(giftCardEvidence('checker', { rangeCard: true })).toEqual([{ key: 'check-result', required: true }]);
  });
});
