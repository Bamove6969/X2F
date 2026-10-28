// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router';
import { boardBuyOffers, boardSellOffers } from '../src/fixtures/boards.js';
import { parseOffers, sortOffers, type Offer } from '../src/screens/browse/api.js';
import { BUY_COPY } from '../src/screens/browse/BuyCopy.js';
import { OfferCard } from '../src/screens/browse/OfferCard.js';
import { SELL_COPY } from '../src/screens/browse/SellCopy.js';
import { render } from './render.js';

const NOW = new Date('2026-10-25T12:00:00Z');
const MARKET = 32990n;
const buyOffers = (): Offer[] => parseOffers(boardBuyOffers(NOW));
const byName = (name: string): Offer => buyOffers().find((o) => o.poster.username === name)!;

function card(offer: Offer, o: { market?: bigint | null; primary?: boolean; copy?: typeof BUY_COPY } = {}) {
  return render(
    <MemoryRouter>
      <OfferCard offer={offer} currency="USD" copy={o.copy ?? BUY_COPY} primary={o.primary ?? false} now={NOW} market={o.market === undefined ? MARKET : o.market} />
    </MemoryRouter>,
  );
}

const spans = (host: HTMLElement) => [...host.querySelectorAll('span')].map((s) => s.textContent);
const margin = (host: HTMLElement) => host.querySelector<HTMLElement>('.x2f-offer__margin');

describe('BUY_COPY: the BuyMain and BuyOffers words', () => {
  it('reads like the boards', () => {
    expect(BUY_COPY.heading).toBe('How do you want to pay?');
    expect(BUY_COPY.liveTitle('USD')).toBe('Sellers taking USD');
    expect(BUY_COPY.liveRow(29, 'USD', '$330.00')).toBe('29 sellers taking USD · from $330.00');
    expect(BUY_COPY.liveRow(1, 'USD', null)).toBe('1 seller taking USD');
    expect(BUY_COPY.emptyRow('USD')).toBe('No USD sellers right now · post an offer');
    expect(BUY_COPY.methodSorts).toEqual(['Most sellers', 'Best rate', 'A–Z']);
    expect(BUY_COPY.offersTitle('Zelle')).toBe('Buy XMR via Zelle');
    expect(BUY_COPY.offersCount(29, 'USD')).toBe('29 sellers · USD');
    expect(BUY_COPY.typicalTime(8)).toBe('Releases in ~8 min');
    expect(BUY_COPY.offersFooter).toBe('You pay no X2F fee when you take an offer.');
  });

  it('the sell side keeps its own words and has no footer', () => {
    expect(SELL_COPY.methodSorts).toEqual(['Most buyers', 'Best rate', 'A–Z']);
    expect(SELL_COPY.offersFooter).toBeUndefined();
  });
});

describe('OfferCard on the buy side', () => {
  it('shows the board lines for satoshi_ghost', () => {
    const { host } = card(byName('satoshi_ghost'), { primary: true });
    expect(spans(host)).toContain('Online · 340 trades · 99% positive');
    expect(spans(host)).toContain('$330.00');
    expect(spans(host)).toContain('$50 – $1,500Releases in ~8 min');
    expect(host.querySelector('[data-primary]')!.getAttribute('aria-label')).toBe('Trade with satoshi_ghost');
  });

  it('a fixed-price offer reads its difference from the market price', () => {
    const { host } = card(byName('satoshi_ghost'));
    expect(margin(host)!.textContent).toBe('$0.10 above market');
    // Above market costs the buyer more: not in the escrow (good) tone.
    expect(margin(host)!.hasAttribute('data-tone')).toBe(false);
  });

  it('a fixed price below market is good for the buyer', () => {
    const s = byName('satoshi_ghost');
    const { host } = card({ ...s, rate: 32900n, pricing: { mode: 'fixed', centsPerXmr: 32900n } });
    expect(margin(host)!.textContent).toBe('$0.90 below market');
    expect(margin(host)!.getAttribute('data-tone')).toBe('escrow');
  });

  it('a fixed price equal to the market reads "At market"', () => {
    const s = byName('satoshi_ghost');
    const { host } = card({ ...s, rate: MARKET, pricing: { mode: 'fixed', centsPerXmr: MARKET } });
    expect(margin(host)!.textContent).toBe('At market');
  });

  it('a fixed price with no market price now reads "Fixed price"', () => {
    const { host } = card(byName('satoshi_ghost'), { market: null });
    expect(margin(host)!.textContent).toBe('Fixed price');
  });

  it('a market offer above market is muted for the buyer, below market is in the escrow tone', () => {
    expect(margin(card(byName('kettle.moss')).host)!.hasAttribute('data-tone')).toBe(false);
    const k = byName('kettle.moss');
    const below = card({ ...k, pricing: { mode: 'market', marginBps: -50 } }).host;
    expect(margin(below)!.textContent).toBe('0.5% below market');
    expect(margin(below)!.getAttribute('data-tone')).toBe('escrow');
  });

  it('New follows the API stage: lowtide_rx (building) has it, satoshi_ghost (graduated) does not', () => {
    const labels = (o: Offer) => [...card(o).host.querySelectorAll('.x2f-badge')].map((b) => b.textContent);
    expect(labels(byName('lowtide_rx'))).toEqual(['New']);
    expect(labels(byName('satoshi_ghost'))).toEqual(['Trusted', 'Veteran']);
  });

  it("opensAt greys a buy-side card the same way", () => {
    const { host } = card({ ...byName('satoshi_ghost'), opensAt: 'graduated' }, { primary: true });
    expect(host.querySelector('article')!.getAttribute('data-opens-at')).toBe('graduated');
    expect(host.textContent).toContain('Opens at Graduated');
    expect(host.querySelector('[data-primary]')).toBeNull();
    expect([...host.querySelectorAll('button')].map((b) => b.textContent)).not.toContain('Trade');
  });
});

describe('sortOffers keeps the chosen order whatever order the API sent', () => {
  const names = (list: Offer[]) => list.map((o) => o.poster.username);

  it('Best price on the buy side: lowest rate first', () => {
    const [s, k, l] = buyOffers();
    expect(names(sortOffers([l!, s!, k!], 'best', 'buy'))).toEqual(['satoshi_ghost', 'kettle.moss', 'lowtide_rx']);
  });

  it('Best price on the sell side: highest rate first', () => {
    const sell = parseOffers(boardSellOffers(NOW));
    expect(names(sortOffers([...sell].reverse(), 'best', 'sell'))).toEqual(['mira.k', 'nightowl_44', 'first_trade_ty']);
  });

  it('an offer with no price now goes last; ties keep the API order', () => {
    const [s, k, l] = buyOffers();
    const tie = { ...k!, id: 'tie', rate: s!.rate };
    expect(names(sortOffers([{ ...l!, rate: null }, tie, s!], 'best', 'buy'))).toEqual(['kettle.moss', 'satoshi_ghost', 'lowtide_rx']);
  });

  it('Online now puts online posters first, Most trades the most completed first', () => {
    const [s, k, l] = buyOffers();
    expect(names(sortOffers([k!, l!, s!], 'online', 'buy'))).toEqual(['lowtide_rx', 'satoshi_ghost', 'kettle.moss']);
    expect(names(sortOffers([l!, k!, s!], 'trades', 'buy'))).toEqual(['satoshi_ghost', 'kettle.moss', 'lowtide_rx']);
  });

  it('does not change the list it is given', () => {
    const list = buyOffers().reverse();
    const before = names(list);
    sortOffers(list, 'best', 'buy');
    expect(names(list)).toEqual(before);
  });
});
