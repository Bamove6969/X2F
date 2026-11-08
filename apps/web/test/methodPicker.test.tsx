// @vitest-environment happy-dom
// The live-method card on Main (/sell) and BuyMain (/buy) is a picker (owner, 2026-11-08: "Make
// this a drop down of all the currently available selected payment method in chosen currency").
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { BOARD_BUY_LIVE_USD, BOARD_SELL_LIVE_USD } from '../src/fixtures/boards.js';
import { parseMethodLists, type MethodRow } from '../src/screens/browse/api.js';
import { BUY_COPY } from '../src/screens/browse/BuyCopy.js';
import { MethodList } from '../src/screens/browse/MethodList.js';
import { MethodPicker, methodShown } from '../src/screens/browse/MethodPicker.js';
import { SELL_COPY } from '../src/screens/browse/SellCopy.js';
import { fire, key, render } from './render.js';

const live = (): MethodRow[] => parseMethodLists({ live: BOARD_SELL_LIVE_USD, all: [] }).live;
const click = (el: Element, detail = 1) => fire(el, new MouseEvent('click', { bubbles: true, detail }));
const sub = (m: MethodRow) => SELL_COPY.liveRow(m.offers, 'USD', null);

describe('methodShown', () => {
  it('shows the first live method until one is picked (the order the board shows today)', () => {
    expect(methodShown(live(), null)!.id).toBe('ZELLE');
  });

  it('shows the picked method while it has live offers', () => {
    expect(methodShown(live(), 'VENMO')!.id).toBe('VENMO');
  });

  it('falls back to the first live method when the picked one has none here (another currency)', () => {
    expect(methodShown(live(), 'SEPA')!.id).toBe('ZELLE');
  });

  it('shows nothing when no method has a live offer', () => {
    expect(methodShown([], 'ZELLE')).toBeNull();
  });
});

function picker(rows: MethodRow[], value: string) {
  const picks: string[] = [];
  const view = render(
    <MemoryRouter>
      <MethodPicker live={rows} value={methodShown(rows, value)!} onChange={(id) => picks.push(id)} title="Buyers paying in USD" sub={sub} href={(m) => `/sell/${m.id}?currency=USD`} />
    </MemoryRouter>,
  );
  const button = view.host.querySelector<HTMLButtonElement>('button[aria-haspopup]')!;
  return { ...view, picks, button };
}

const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]');
const radios = () => [...document.body.querySelectorAll<HTMLInputElement>('[role="dialog"] input[type="radio"]')];

describe('MethodPicker', () => {
  it('is a button that says it opens a dialog, named with the method', () => {
    const { button } = picker(live(), 'ZELLE');
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.textContent).toBe('Payment method: Zelle');
    expect(dialog()).toBeNull();
  });

  it('the card leads to the shown method\'s offers, named with the method and its line', () => {
    const { host } = picker(live(), 'VENMO');
    const link = host.querySelector<HTMLAnchorElement>('a')!;
    expect(link.getAttribute('href')).toBe('/sell/VENMO?currency=USD');
    const name = (link.getAttribute('aria-labelledby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent);
    expect(name).toEqual(['Venmo', '12 buyers paying in USD']);
  });

  it('opens a sheet listing every live method as radios, each with its count, the shown one checked', () => {
    const { button } = picker(live(), 'ZELLE');
    click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(dialog()!.getAttribute('aria-labelledby')).toBeTruthy();
    expect(document.getElementById(dialog()!.getAttribute('aria-labelledby')!)!.textContent).toBe('Buyers paying in USD');
    expect(dialog()!.querySelector('[role="radiogroup"]')!.getAttribute('aria-label')).toBe('Buyers paying in USD');
    expect(radios()).toHaveLength(BOARD_SELL_LIVE_USD.length);
    expect(radios().filter((r) => r.checked).map((r) => r.value)).toEqual(['ZELLE']);
    const options = [...dialog()!.querySelectorAll('[data-part="method-option"]')].map((o) => o.textContent);
    expect(options[0]).toBe('Zelle34 buyers paying in USD');
    expect(options[1]).toBe('Cash App27 buyers paying in USD');
  });

  it('a tap on a method picks it and closes the sheet; focus goes back to the button', () => {
    const { button, picks } = picker(live(), 'ZELLE');
    button.focus();
    click(button);
    const venmo = radios().find((r) => r.value === 'VENMO')!;
    click(venmo.closest('label')!);
    expect(picks).toEqual(['VENMO']);
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('arrow keys move the choice without closing; Enter or Space closes', () => {
    const { button, picks } = picker(live(), 'ZELLE');
    click(button);
    const venmo = radios().find((r) => r.value === 'VENMO')!;
    // A keyboard move checks the radio with a click of detail 0 (no pointer): the sheet stays open.
    click(venmo, 0);
    expect(picks).toEqual(['VENMO']);
    expect(dialog()).not.toBeNull();
    key(venmo, 'keydown', 'Enter');
    expect(dialog()).toBeNull();
    click(button);
    key(radios()[0]!, 'keydown', ' ');
    expect(dialog()).toBeNull();
  });

  it('Escape closes without picking', () => {
    const { button, picks } = picker(live(), 'ZELLE');
    click(button);
    key(dialog()!, 'keydown', 'Escape');
    expect(dialog()).toBeNull();
    expect(picks).toEqual([]);
  });

  it('with one live method it still opens and lists that one', () => {
    const one = live().slice(0, 1);
    const { button } = picker(one, 'ZELLE');
    click(button);
    expect(radios().map((r) => r.value)).toEqual(['ZELLE']);
    expect(radios()[0]!.checked).toBe(true);
  });
});

describe('MethodList: the live section is one picker card', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubMethods(lists: (currency: string) => unknown) {
    const f = vi.fn(async (url: string) => {
      const q = new URL(url, 'http://x').searchParams;
      return new Response(JSON.stringify(lists(q.get('currency') ?? 'USD')), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', f);
    return f;
  }

  const settle = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  };

  async function screen(path: string, side: 'sell' | 'buy') {
    const view = render(
      <MemoryRouter initialEntries={[path]}>
        <MethodList side={side} copy={side === 'sell' ? SELL_COPY : BUY_COPY} />
      </MemoryRouter>,
    );
    const { act } = await import('react');
    await act(settle);
    return view;
  }

  const liveSection = (host: HTMLElement) => host.querySelectorAll<HTMLElement>('main section')[0]!;

  it('sell: one card for Zelle (the top method), linking to its offers; the other live methods are in the picker', async () => {
    stubMethods(() => ({ live: BOARD_SELL_LIVE_USD, all: [...BOARD_SELL_LIVE_USD, { id: 'SEPA', name: 'SEPA', group: 'Bank transfers', giftCard: false, offers: 0, bestRate: null }] }));
    const { host } = await screen('/sell', 'sell');
    const sec = liveSection(host);
    expect(sec.querySelector('h2')!.textContent).toBe('Buyers paying in USD');
    expect(sec.querySelectorAll('a')).toHaveLength(1);
    expect(sec.querySelector('a')!.getAttribute('href')).toBe('/sell/ZELLE?currency=USD');
    expect(sec.textContent).toContain('34 buyers paying in USD · up to $331.20');
    expect(sec.textContent).not.toContain('Cash App');
    // Methods with no live offer stay listed below, A–Z.
    const rest = host.querySelectorAll('main section')[1]!;
    expect(rest.querySelector('h2')!.textContent).toBe('All payment methods');
    expect([...rest.querySelectorAll('[data-part="name"]')].map((n) => n.textContent)).toEqual(['SEPA']);

    const { act } = await import('react');
    click(sec.querySelector('button[aria-haspopup]')!);
    click(radios().find((r) => r.value === 'CASH_APP')!.closest('label')!);
    await act(settle);
    expect(sec.querySelector('a')!.getAttribute('href')).toBe('/sell/CASH_APP?currency=USD');
    expect(sec.textContent).toContain('Cash App');
    expect(sec.textContent).toContain('27 buyers paying in USD · up to $332.10');
  });

  it('buy: the same card with the buy words', async () => {
    stubMethods(() => ({ live: BOARD_BUY_LIVE_USD, all: BOARD_BUY_LIVE_USD }));
    const { host } = await screen('/buy', 'buy');
    const sec = liveSection(host);
    expect(sec.querySelector('h2')!.textContent).toBe('Sellers taking USD');
    expect(sec.querySelector('button[aria-haspopup]')!.textContent).toBe('Payment method: Zelle');
    expect(sec.textContent).toContain('29 sellers taking USD · from $330.00');
    click(sec.querySelector('button[aria-haspopup]')!);
    expect(radios()).toHaveLength(BOARD_BUY_LIVE_USD.length);
  });

  it('no live method in the currency: no card, only the full list', async () => {
    stubMethods(() => ({ live: [], all: [{ id: 'SEPA', name: 'SEPA', group: 'Bank transfers', giftCard: false, offers: 0, bestRate: null }] }));
    const { host } = await screen('/sell?currency=GBP', 'sell');
    expect(host.querySelector('button[aria-haspopup]')).toBeNull();
    expect([...host.querySelectorAll('main h2')].map((h) => h.textContent)).toEqual(['All payment methods']);
  });
});
