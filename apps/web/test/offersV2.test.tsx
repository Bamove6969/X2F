// @vitest-environment happy-dom
// Design v2 batch 3 (wip/design-brief, docs/design-boards/: Main, BuyMain, SellOffers, BuyOffers,
// BuyQuote, PostOffer): the offers screens' v2 look, through the screens' CSS and the UI kit. These
// check the rules that carry the boards' sizes, radii, type and selection colours (selection is a
// 2 px ink border on surface-raised, never orange: design conventions, 2 Nov). Behaviour is
// unchanged (browse.test.tsx, browse-buy.test.tsx, quoteScreen.test.tsx, postOffer.test.ts).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MethodList } from '../src/screens/browse/MethodList.js';
import { OfferList } from '../src/screens/browse/OfferList.js';
import { SELL_COPY } from '../src/screens/browse/SellCopy.js';
import { render } from './render.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(join(HERE, '../src', p), 'utf8');
const browse = read('screens/browse/browse.css');
const quote = read('screens/quote/quote.css');
const post = read('screens/post/PostOffer.css');

/** The declarations of the rule whose selector list is exactly `selector` in `css`. */
function rule(css: string, selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`(?:^|\\n)${esc} \\{([^}]*)\\}`));
  if (m === null) throw new Error(`no rule "${selector}"`);
  return m[1]!.replace(/\s+/g, ' ');
}

/** Every rule (selector and body) whose selector marks a chosen state. */
function selectedRules(css: string): string[] {
  return [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter((m) => /aria-checked='true'|aria-selected='true'|data-on|:checked/.test(m[1]!))
    .map((m) => `${m[1]!.trim()} { ${m[2]!.replace(/\s+/g, ' ').trim()} }`);
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('selection is ink, never orange', () => {
  it('no chosen chip, tab, wallet or side toggle uses the monero colour', () => {
    for (const css of [browse, quote, post]) {
      const rules = selectedRules(css);
      expect(rules.length).toBeGreaterThan(0);
      for (const r of rules) expect(r).not.toMatch(/--x2f-monero\b/);
    }
  });

  it('a chosen chip (currency, Sort, I want to, Your price) and the Buy/Sell tab: a 2 px ink border on surface-raised', () => {
    for (const r of [rule(browse, ".x2f-chip-button[aria-checked='true']::before"), rule(browse, ".x2f-segment__tab[aria-selected='true']::before")]) {
      expect(r).toContain('border: 2px solid var(--x2f-ink);');
      expect(r).toContain('background: var(--x2f-surface-raised);');
    }
  });

  it('the picked wallet: a 2 px ink border on surface-raised, an ink radio dot', () => {
    const on = rule(quote, '.x2f-quote__wallet[data-on]');
    expect(on).toContain('border-color: var(--x2f-ink);');
    expect(on).toContain('background: var(--x2f-surface-raised);');
    expect(rule(quote, '.x2f-quote__wallet input:checked')).toContain('var(--x2f-ink)');
  });
});

describe('44 px tap targets', () => {
  it('chips, the Buy/Sell tabs, the +N badge button and Nudge are 44 px tall (the drawn pill stays smaller)', () => {
    expect(rule(browse, '.x2f-chip-button')).toContain('height: 44px;');
    expect(rule(browse, '.x2f-segment__tab')).toContain('height: 44px;');
    expect(rule(browse, '.x2f-offer__more')).toContain('height: 44px;');
    expect(rule(browse, '.x2f-offer__nudge')).toContain('height: 44px;');
  });

  it('PostOffer: the two-up choices are 48 px, the steppers and the close 44 px', () => {
    expect(rule(post, '.post-choices .x2f-chip-button')).toContain('height: 48px;');
    expect(rule(post, '.post-step')).toContain('height: 44px;');
    expect(rule(post, '.post-close')).toContain('height: 44px;');
  });
});

describe('16 px cards', () => {
  it('offer cards, the method list, the quote card and the PostOffer cards use radius-lg', () => {
    expect(rule(browse, '.x2f-offer')).toContain('border-radius: var(--x2f-radius-lg);');
    expect(rule(browse, 'a.x2f-method:first-of-type')).toContain('var(--x2f-radius-lg)');
    expect(rule(browse, 'a.x2f-method:last-of-type')).toContain('var(--x2f-radius-lg)');
    expect(rule(quote, '.x2f-quote__card')).toContain('border-radius: var(--x2f-radius-lg);');
    expect(rule(post, '.post-card')).toContain('border-radius: var(--x2f-radius-lg);');
    expect(rule(post, '.post-preview')).toContain('border-radius: var(--x2f-radius-lg);');
  });
});

describe('screen titles: the v2 screen-title (28/32 700)', () => {
  it('Main and BuyMain', () => {
    const { host } = render(
      <MemoryRouter initialEntries={['/sell']}>
        <MethodList side="sell" copy={SELL_COPY} />
      </MemoryRouter>,
    );
    expect(host.querySelector('h1')?.classList.contains('x2f-screen-title')).toBe(true);
  });

  it('SellOffers and BuyOffers', () => {
    const { host } = render(
      <MemoryRouter initialEntries={['/sell/ZELLE']}>
        <Routes>
          <Route path="/sell/:methodId" element={<OfferList side="sell" copy={SELL_COPY} />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(host.querySelector('.x2f-browse__head-title')?.classList.contains('x2f-screen-title')).toBe(true);
  });

  it('the quotes and PostOffer', () => {
    expect(read('screens/quote/Quote.tsx')).toMatch(/className="x2f-quote__title x2f-screen-title">\{copy\.title/);
    expect(read('screens/PostOffer.tsx')).toMatch(/<h1 className="x2f-screen-title">Post an offer<\/h1>/);
  });
});
