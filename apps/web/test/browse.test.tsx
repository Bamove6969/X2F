// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router';
import { boardSellOffers } from '../src/fixtures/boards.js';
import { ApiShapeError, adSide, formatMinor, parseMethodLists, parseOffers, parsePrice, type Offer } from '../src/screens/browse/api.js';
import { OfferCard } from '../src/screens/browse/OfferCard.js';
import { SELL_COPY } from '../src/screens/browse/SellCopy.js';
import { fire, render } from './render.js';

const NOW = new Date('2026-10-24T12:00:00Z');
const raw = () => boardSellOffers(NOW);
const offers = (): Offer[] => parseOffers(raw());
const byName = (name: string): Offer => offers().find((o) => o.poster.displayName === name)!;

function card(offer: Offer, primary = false) {
  return render(
    <MemoryRouter>
      <OfferCard offer={offer} currency="USD" copy={SELL_COPY} primary={primary} now={NOW} />
    </MemoryRouter>,
  );
}

const buttons = (host: HTMLElement) => [...host.querySelectorAll('button, a')].map((b) => b.textContent?.trim());
const badgeLabels = (host: HTMLElement) => [...host.querySelectorAll('.x2f-badge')].map((b) => b.textContent);

describe('browse API shapes', () => {
  it('reads the offer list the boards show, bigints from strings', () => {
    const [mira] = offers();
    expect(mira!.poster.displayName).toBe('mira.k');
    expect(mira!.minFiatCents).toBe(5000n);
    expect(mira!.rate).toBe(33120n);
    expect(mira!.opensAt).toBeUndefined();
  });

  it("accepts opensAt 'building' and 'graduated' and refuses anything else", () => {
    const list = raw();
    expect(parseOffers([{ ...list[0]!, opensAt: 'building' }])[0]!.opensAt).toBe('building');
    expect(parseOffers([{ ...list[0]!, opensAt: 'graduated' }])[0]!.opensAt).toBe('graduated');
    expect(() => parseOffers([{ ...list[0]!, opensAt: 'starter' }])).toThrow(ApiShapeError);
  });

  it('reads minTrades null (no minimum, owner 8 Nov) as 0; a missing or string minTrades fails', () => {
    const list = raw();
    expect(parseOffers([{ ...list[0]!, minTrades: null }])[0]!.minTrades).toBe(0);
    expect(parseOffers([{ ...list[0]!, minTrades: 25 }])[0]!.minTrades).toBe(25);
    const { minTrades: _m, ...noMin } = list[0]!;
    expect(() => parseOffers([noMin])).toThrow(/minTrades/);
    expect(() => parseOffers([{ ...list[0]!, minTrades: '5' }])).toThrow(ApiShapeError);
  });

  it('fails loudly when the poster has no stage from the API', () => {
    const list = raw();
    const { stage: _s, ...poster } = list[0]!.poster;
    expect(() => parseOffers([{ ...list[0]!, poster }])).toThrow(/poster\.stage/);
  });

  it('reads the method lists and the market price', () => {
    const lists = parseMethodLists({ live: [{ id: 'ZELLE', name: 'Zelle', group: 'Payment apps', giftCard: false, offers: 34, bestRate: '33120' }], all: [] });
    expect(lists.live[0]!.bestRate).toBe(33120n);
    expect(parsePrice({ currency: 'USD', centsPerXmr: '32990', exponent: 2, at: NOW.toISOString() }).centsPerXmr).toBe(32990n);
    expect(() => parseMethodLists({ live: [{ id: 'ZELLE' }], all: [] })).toThrow(ApiShapeError);
  });

  it('reads strictly only what the screens render; group, giftCard, currency and exponent may be missing', () => {
    const lists = parseMethodLists({ live: [{ id: 'ZELLE', name: 'Zelle', offers: 34, bestRate: '33120' }], all: [] });
    expect(lists.live[0]).toMatchObject({ id: 'ZELLE', name: 'Zelle', offers: 34, bestRate: 33120n });
    expect(parsePrice({ centsPerXmr: '32990', at: NOW.toISOString() }).centsPerXmr).toBe(32990n);
    for (const k of ['id', 'name', 'offers', 'bestRate'] as const) {
      const row: Record<string, unknown> = { id: 'ZELLE', name: 'Zelle', offers: 34, bestRate: '33120' };
      delete row[k];
      expect(() => parseMethodLists({ live: [row], all: [] }), k).toThrow(ApiShapeError);
    }
    expect(() => parsePrice({ at: NOW.toISOString() })).toThrow(/price\.centsPerXmr/);
    expect(() => parsePrice({ centsPerXmr: '32990' })).toThrow(/price\.at/);
    // A field that is there but of the wrong type is still refused.
    expect(() => parseMethodLists({ live: [{ id: 'ZELLE', name: 'Zelle', offers: 34, bestRate: '33120', giftCard: 'no' }], all: [] })).toThrow(/giftCard/);
  });

  it('a seller browses buy ads and a buyer sell ads', () => {
    expect(adSide('sell')).toBe('buy');
    expect(adSide('buy')).toBe('sell');
  });

  it('formats minor units, whole amounts without cents when asked', () => {
    expect(formatMinor(33120n, 'USD')).toBe('$331.20');
    expect(formatMinor(200000n, 'USD', { whole: true })).toBe('$2,000');
    expect(formatMinor(200050n, 'USD', { whole: true })).toBe('$2,000.50');
    expect(formatMinor(33120n, 'EUR')).toBe('€331.20');
  });
});

describe('OfferCard', () => {
  it('an online offer with no opensAt shows Trade, primary when asked', () => {
    const { host } = card(byName('mira.k'), true);
    const trade = host.querySelector<HTMLButtonElement>('button[aria-label="Trade with mira.k"]')!;
    expect(trade.textContent).toBe('Trade');
    expect(trade.hasAttribute('data-primary')).toBe(true);
    expect(trade.disabled).toBe(false);
    expect(host.querySelector('[data-opens-at]')).toBeNull();
    expect(host.textContent).not.toContain('Opens at');
  });

  it('shows the board lines: poster, rate, margin, range and time', () => {
    const { host } = card(byName('mira.k'));
    expect(host.querySelector('[data-username]')!.textContent).toBe('mira.k');
    const texts = [...host.querySelectorAll('span')].map((s) => s.textContent);
    expect(texts).toContain('Online · 212 trades · 99% positive');
    expect(texts).toContain('$331.20');
    expect(texts).toContain('0.4% above market');
    expect(texts).toContain('$50 – $2,000Pays in ~6 min');
  });

  it("an offer with opensAt 'building' is greyed with \"Opens at Building\" and cannot be taken", () => {
    const { host } = card({ ...byName('mira.k'), opensAt: 'building' }, true);
    const article = host.querySelector('article')!;
    expect(article.getAttribute('data-opens-at')).toBe('building');
    expect(article.getAttribute('aria-disabled')).toBe('true');
    expect(host.textContent).toContain('Opens at Building');
    expect(buttons(host)).not.toContain('Trade');
    expect(host.querySelector('[data-primary]')).toBeNull();
  });

  it("opensAt 'graduated' reads \"Opens at Graduated\"", () => {
    const { host } = card({ ...byName('first_trade_ty'), opensAt: 'graduated' });
    expect(host.textContent).toContain('Opens at Graduated');
    expect(buttons(host)).not.toContain('Trade');
  });

  it('an offline poster gets Message and Nudge, not Trade', () => {
    const { host } = card(byName('nightowl_44'));
    expect(buttons(host)).toContain('Message nightowl_44');
    expect(host.querySelector('button[aria-label="Nudge nightowl_44"]')).not.toBeNull();
    expect(buttons(host)).not.toContain('Trade');
    expect(host.textContent).toContain('Seen 2 h ago · 58 trades · 97% positive');
  });
});

describe('the New badge follows the API stage, never the trade count', () => {
  it('stage starter: New', () => {
    const { host } = card(byName('first_trade_ty'));
    expect(badgeLabels(host)).toEqual(['New']);
    expect(host.querySelector('.x2f-badge')!.getAttribute('data-tone')).toBe('caution');
  });

  it('stage building with 212 completed trades: still New (the API wins)', () => {
    const mira = byName('mira.k');
    const { host } = card({ ...mira, poster: { ...mira.poster, stage: 'building' } });
    expect(badgeLabels(host)[0]).toBe('New');
  });

  it('stage graduated with 0 completed trades: no New (the API wins)', () => {
    const ty = byName('first_trade_ty');
    const { host } = card({ ...ty, poster: { ...ty.poster, stage: 'graduated' } });
    expect(badgeLabels(host)).not.toContain('New');
  });

  it("a 'new' entry in badges does not add New for a graduated poster", () => {
    const mira = byName('mira.k');
    const { host } = card({ ...mira, poster: { ...mira.poster, badges: ['new', ...mira.poster.badges] } });
    expect(badgeLabels(host)).not.toContain('New');
  });
});

describe('badges on the card', () => {
  it('at most 2 featured, the rest behind +N', () => {
    const { host } = card(byName('mira.k'));
    expect(badgeLabels(host)).toEqual(['Trusted', 'Fast']);
    const more = host.querySelector<HTMLButtonElement>('button[aria-label="Show all 5 badges"]')!;
    expect(more.textContent).toBe('+3');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('[role="tooltip"]')).toBeNull();
    fire(more, new MouseEvent('click', { bubbles: true }));
    const tip = host.querySelector('[role="tooltip"]')!;
    expect(more.getAttribute('aria-expanded')).toBe('true');
    expect(tip.textContent).toContain("All of mira.k's badges");
    expect(tip.textContent).toContain('Veteran · trading on X2F for 1+ year');
    expect(tip.textContent).toContain('Security key verified · protects the account with a hardware key');
  });

  it('New takes one of the 2 featured places', () => {
    const mira = byName('mira.k');
    const { host } = card({ ...mira, poster: { ...mira.poster, stage: 'starter' } });
    expect(badgeLabels(host)).toEqual(['New', 'Trusted']);
    expect(host.querySelector('button[aria-label="Show all 6 badges"]')!.textContent).toBe('+4');
  });

  it('two badges and no more: no +N', () => {
    const { host } = card(byName('nightowl_44'));
    expect(badgeLabels(host)).toEqual(['Security key verified', 'Veteran']);
    expect(host.querySelector('button[aria-label^="Show all"]')).toBeNull();
  });
});

describe('OfferCard as a pick row (two panes, Fold-Offers)', () => {
  it('an online offer is one button that picks it, pressed when picked, with no Trade of its own', () => {
    const picked: string[] = [];
    const mira = byName('mira.k');
    const { host } = render(
      <MemoryRouter>
        <OfferCard offer={mira} currency="USD" copy={SELL_COPY} primary={false} now={NOW} pick={{ pressed: true, onPick: (o) => picked.push(o.id) }} />
      </MemoryRouter>,
    );
    const rows = host.querySelectorAll('button');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.getAttribute('aria-pressed')).toBe('true');
    expect(rows[0]!.textContent).toContain('mira.k');
    expect(host.querySelector('[data-primary]')).toBeNull();
    fire(rows[0]!, new MouseEvent('click', { bubbles: true }));
    expect(picked).toEqual([mira.id]);
  });

  it("an offline poster's offer stays as on the phone: Message, no pick", () => {
    const off = offers().find((o) => !o.poster.online && o.opensAt === undefined)!;
    const { host } = render(
      <MemoryRouter>
        <OfferCard offer={off} currency="USD" copy={SELL_COPY} primary={false} now={NOW} pick={{ pressed: false, onPick: () => undefined }} />
      </MemoryRouter>,
    );
    expect(host.querySelector('[aria-pressed]')).toBeNull();
    expect(buttons(host)).toContain(`Message ${off.poster.displayName}`);
  });
});

describe('the opt-in traded line in XMR (owner Q63) and imported lines per site in USD (Q64, p4-1)', () => {
  it('reads tradedOverXmr and imported (missing or null: nothing) and shows them only when the API sends them', () => {
    const mira = byName('mira.k');
    expect(mira.poster.tradedOverXmr).toBeNull();
    expect(mira.poster.imported).toEqual([]);
    const poster = (raw()[0] as { poster: object }).poster;
    const [withLine] = parseOffers([{ ...raw()[0], poster: { ...poster, tradedOverXmr: 90, imported: [{ site: 'LocalMonero', overUsd: 150_000 }] } }]);
    expect(withLine!.poster.tradedOverXmr).toBe(90);
    expect(withLine!.poster.imported).toEqual([{ site: 'LocalMonero', overUsd: 150_000 }]);
    expect(() => parseOffers([{ ...raw()[0], poster: { ...poster, tradedOverXmr: '90' } }])).toThrow(ApiShapeError);
    expect(() => parseOffers([{ ...raw()[0], poster: { ...poster, imported: [{ site: 'X', overUsd: '1' }] } }])).toThrow(ApiShapeError);
    expect(() => parseOffers([{ ...raw()[0], poster: { ...poster, imported: [{ site: 'X', overXmr: 50 }] } }])).toThrow(ApiShapeError);
    expect(card(mira).host.textContent).not.toContain('traded to date');
    const on = card({ ...mira, poster: { ...mira.poster, tradedOverXmr: 1_200, imported: [{ site: 'Paxful', overUsd: 50_000 }] } }).host.textContent;
    expect(on).toContain('1,200+ XMR traded to date');
    expect(on).toContain('$50,000+ on Paxful, verified');
    expect(on).not.toContain('XMR on Paxful');
    expect(on).not.toContain('in trades to date');
  });
});
