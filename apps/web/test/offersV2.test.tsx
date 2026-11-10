// @vitest-environment happy-dom
// Design v2 batch 3 (wip/design-brief, docs/design-boards/: Main, BuyMain, SellOffers, BuyOffers,
// BuyQuote, PostOffer): the offers screens' v2 look, through the screens' CSS and the UI kit. These
// check the rules that carry the boards' sizes, radii, type and selection colours (selection is a
// 2 px ink border on surface-raised, never orange: design conventions, 2 Nov). Behaviour is
// unchanged (browse.test.tsx, browse-buy.test.tsx, quoteScreen.test.tsx, postOffer.test.ts).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MethodList } from '../src/screens/browse/MethodList.js';
import { OfferList } from '../src/screens/browse/OfferList.js';
import { SELL_COPY } from '../src/screens/browse/SellCopy.js';
import { PostOffer } from '../src/screens/PostOffer.js';
import { Notice } from '../src/ui/Notice.js';
import { render } from './render.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(join(HERE, '../src', p), 'utf8');
const browse = read('screens/browse/browse.css');
const quote = read('screens/quote/quote.css');
const post = read('screens/post/PostOffer.css');
const kit = read('ui/ui.css');

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

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
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
      // The one owner-ruled exception (8 Nov): PostOffer's chosen XMR / currency unit is bold orange.
      for (const r of rules) if (!r.includes(".post-unit button[aria-checked='true']")) expect(r).not.toMatch(/--x2f-monero\b/);
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

  it('PostOffer: the two-up choices (above or below too) and the boxes (the percentage too) are 48 px, the close 44 px', () => {
    expect(rule(post, '.post-choices .x2f-chip-button')).toContain('height: 48px;');
    // Owner F1: the margin is typed in a box (the ±0.1% steppers are gone).
    expect(rule(post, '.post-field input')).toContain('height: 48px;');
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

  it('PostOffer (the quotes: quoteScreen.test.tsx)', () => {
    const { host } = render(
      <MemoryRouter initialEntries={['/post']}>
        <PostOffer />
      </MemoryRouter>,
    );
    expect(host.querySelector('h1')?.classList.contains('x2f-screen-title')).toBe(true);
    expect(host.querySelector('h1')?.textContent).toBe('Post an offer');
  });
});

describe('review round 1 (M1-M5)', () => {
  it('M1: the kit Notice has an info tone (an ink-muted info icon on surface-raised, not announced); the quote no longer restyles plain', () => {
    const { host } = render(<Notice tone="info">Nothing changes yet.</Notice>);
    const box = host.querySelector('.x2f-outcome');
    expect(box?.getAttribute('data-tone')).toBe('info');
    expect(box?.getAttribute('role')).toBeNull();
    expect(box?.querySelector('.x2f-outcome__icon svg')).not.toBeNull();
    const look = rule(kit, ".x2f-outcome[data-tone='info']");
    expect(look).toContain('background: var(--x2f-surface-raised);');
    expect(look).toContain('color-mix(in srgb, var(--x2f-ink-muted) 30%, transparent)');
    expect(rule(kit, ".x2f-outcome[data-tone='info'] .x2f-outcome__icon")).toContain('color: var(--x2f-ink-muted);');
    expect(quote).not.toContain("data-tone='plain'");
  });

  it('M2: the kit heading class, the amount and label tokens and one icon-button radius, not re-typed values', async () => {
    const methods = { live: [], all: [{ id: 'ZELLE', name: 'Zelle', group: 'Payment apps', giftCard: false, offers: 0, bestRate: null }] };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(methods), { status: 200, headers: { 'content-type': 'application/json' } })));
    const { host } = render(
      <MemoryRouter initialEntries={['/sell']}>
        <MethodList side="sell" copy={SELL_COPY} />
      </MemoryRouter>,
    );
    await settle();
    expect(host.querySelector('main h2')?.textContent).toBe('All payment methods');
    expect(host.querySelector('main h2')?.classList.contains('x2f-section-title')).toBe(true);
    for (const r of [rule(browse, '.x2f-offer__rate'), rule(post, '.post-preview .post-big')]) {
      expect(r).toContain('font-size: var(--x2f-amount-size);');
      expect(r).toContain('line-height: var(--x2f-amount-line);');
    }
    for (const r of [rule(post, '.post-label'), rule(quote, '.x2f-quote__label')]) expect(r).toContain('font-size: var(--x2f-label-size);');
    expect(rule(kit, '.x2f-icon-button')).toContain('border-radius: var(--x2f-radius-md);');
    for (const css of [browse, quote, post]) {
      expect(css).not.toMatch(/font-size: 18px;\s*line-height: 24px;\s*font-weight: 600/);
      expect(css).not.toMatch(/x2f-icon-button \{[^}]*border-radius/);
    }
  });

  it('M3: the chip and the Buy/Sell tab keep their own radius, so the focus ring follows the pill', () => {
    expect(rule(browse, '.x2f-chip-button')).toContain('border-radius: var(--x2f-radius-pill);');
    expect(rule(browse, '.x2f-segment__tab')).toContain('border-radius: var(--x2f-radius-pill);');
    expect(rule(post, '.post-choices .x2f-chip-button')).toContain('border-radius: var(--x2f-radius-md);');
  });

  it('M4: wrapped chip rows are 12 px apart, so the 44 px targets do not overlap', () => {
    expect(rule(browse, '.x2f-browse__sorts')).toContain('row-gap: var(--x2f-space-3);');
  });

  it('M5: the methods-failed "Payment method" caption is the same uppercase label as the others', async () => {
    const { host } = render(
      <MemoryRouter initialEntries={['/post']}>
        <PostOffer />
      </MemoryRouter>,
    );
    await settle();
    const caption = [...host.querySelectorAll('.post-field > *')].find((e) => e.textContent === 'Payment method');
    expect(caption?.classList.contains('post-caption')).toBe(true);
    expect(post).toMatch(/\.post-field > label,\n\.post-field > \.post-caption \{/);
  });
});
