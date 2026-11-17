// @vitest-environment happy-dom
import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { AcceptedSheet, acceptedNavigation, type AcceptedTradeView, type AcceptedWallet } from '../src/screens/AcceptedSheet.js';
import { confirmedKey, readConfirmed, type ConfirmedTrade } from '../src/screens/quote/confirmed.js';
import { forgetTypedAddresses, recordTypedAddress } from '../src/screens/walletRecord.js';
import { fire, render } from './render.js';

// Fixtures (test-only): an accepted event and the poster's wallets as GET /v1/wallets returns them.
const EVENT = { type: 'accepted' as const, code: 'X2F-7KQ4-M9TD', by: 'mira.K_77' };
const ADDR1 = `5${'A'.repeat(88)}a1b2c3`;
const ADDR2 = `5${'B'.repeat(88)}d4e5f6`;
const WALLETS: AcceptedWallet[] = [
  // addressEnd is a decoy: the sheet must show the ending of the full address it will pay to (re-review gap 2).
  { id: 'w1', app: 'cake', label: 'Cake main', address: ADDR1, addressEnd: 'DECOY1', usable: true },
  { id: 'w2', app: 'feather', label: 'Feather', address: ADDR2, addressEnd: 'DECOY2', usable: true },
  { id: 'w3', app: 'edge', label: 'New Edge', address: `5${'C'.repeat(88)}778899`, addressEnd: '778899', usable: false },
];
// The poster's own view of the trade (GET /v1/trades/:code), as the API serializes it: a seller-posted offer.
const VIEW: AcceptedTradeView = {
  role: 'seller', poster: 'seller', amountAtomic: '1250000000000', grown: null,
  lockedRate: { currency: 'EUR', centsPerXmr: '15000' }, maxFiatCents: '20000',
};
const loadView = async () => VIEW;

const flush = () => act(async () => undefined);
const sheet = () => document.querySelector('[role="dialog"]') as HTMLElement;
const button = (text: string) =>
  [...sheet().querySelectorAll<HTMLElement>('button, a')].find((b) => b.textContent === text) as HTMLElement;

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  forgetTypedAddresses();
});

describe('AcceptedSheet', () => {
  it('names the taker by display name exactly as set, and lists only usable wallets', async () => {
    render(<AcceptedSheet event={EVENT} loadWallets={async () => WALLETS} loadTrade={loadView} submit={async () => undefined} onDone={() => undefined} onClose={() => undefined} />);
    await flush();
    expect(sheet().querySelector('h2')!.textContent).toBe('mira.K_77 accepted your offer');
    const options = [...sheet().querySelectorAll('input[type="radio"]')] as HTMLInputElement[];
    expect(options.map((o) => o.value)).toEqual(['w1', 'w2']);
    expect(sheet().textContent).toContain('Cake main');
    expect(sheet().textContent).not.toContain('New Edge');
    expect(sheet().querySelectorAll('[data-primary]')).toHaveLength(1);
  });

  it('owner 17 Nov (Q9): the default wallet is picked first, and another can be picked instead', async () => {
    const posted: Array<[string, string]> = [];
    const withDefault = WALLETS.map((w) => ({ ...w, isDefault: w.id === 'w2' }));
    render(<AcceptedSheet event={EVENT} loadWallets={async () => withDefault} loadTrade={loadView} submit={async (c, w) => void posted.push([c, w])} onDone={() => undefined} onClose={() => undefined} />);
    await flush();
    const options = [...sheet().querySelectorAll('input[type="radio"]')] as HTMLInputElement[];
    expect(options.map((o) => o.checked)).toEqual([false, true]);
    expect((button('Use this wallet') as HTMLButtonElement).disabled).toBe(false);
    fire(options[0]!, new MouseEvent('click', { bubbles: true }));
    await flush();
    expect(options.map((o) => o.checked)).toEqual([true, false]);
    fire(button('Use this wallet'), new MouseEvent('click', { bubbles: true }));
    await flush();
    expect(posted).toEqual([[EVENT.code, 'w1']]);
  });

  it('a default that is not usable is not picked', async () => {
    const waitingDefault = WALLETS.map((w) => ({ ...w, isDefault: w.id === 'w3' }));
    render(<AcceptedSheet event={EVENT} loadWallets={async () => waitingDefault} loadTrade={loadView} submit={async () => undefined} onDone={() => undefined} onClose={() => undefined} />);
    await flush();
    const options = [...sheet().querySelectorAll('input[type="radio"]')] as HTMLInputElement[];
    expect(options.map((o) => o.checked)).toEqual([false, false]);
  });

  it('with no default, pre-selects no wallet: Use this wallet is disabled until a radio is chosen', async () => {
    render(<AcceptedSheet event={EVENT} loadWallets={async () => WALLETS} loadTrade={loadView} submit={async () => undefined} onDone={() => undefined} onClose={() => undefined} />);
    await flush();
    const options = [...sheet().querySelectorAll('input[type="radio"]')] as HTMLInputElement[];
    expect(options.map((o) => o.checked)).toEqual([false, false]);
    expect((button('Use this wallet') as HTMLButtonElement).disabled).toBe(true);
    fire(options[0]!, new MouseEvent('click', { bubbles: true }));
    await flush();
    expect(options[0]!.checked).toBe(true);
    expect((button('Use this wallet') as HTMLButtonElement).disabled).toBe(false);
  });

  it('posts the picked wallet for this trade and moves on to Setting up escrow', async () => {
    const posted: Array<[string, string]> = [];
    const done: string[] = [];
    render(
      <AcceptedSheet
        event={EVENT}
        loadWallets={async () => WALLETS} loadTrade={loadView}
        submit={async (code, walletId) => void posted.push([code, walletId])}
        onDone={(code) => done.push(code)}
        onClose={() => undefined}
      />,
    );
    await flush();
    const second = sheet().querySelector('input[value="w2"]') as HTMLInputElement;
    fire(second, new MouseEvent('click', { bubbles: true }));
    await act(async () => {
      button('Use this wallet').click();
    });
    await flush();
    expect(posted).toEqual([['X2F-7KQ4-M9TD', 'w2']]);
    expect(sheet().textContent).toContain('Setting up escrow');
    expect(done).toEqual(['X2F-7KQ4-M9TD']);
  });

  it('offers Add a wallet, returning to this trade, when no wallet is usable', async () => {
    render(
      <AcceptedSheet event={EVENT} loadWallets={async () => [WALLETS[2]!]} loadTrade={loadView} submit={async () => undefined} onDone={() => undefined} onClose={() => undefined} />,
    );
    await flush();
    const add = button('Add a wallet');
    expect(add.getAttribute('href')).toBe('/wallets?add=1&returnTo=%2Ftrade%2FX2F-7KQ4-M9TD');
    expect(add.hasAttribute('data-primary')).toBe(true);
    expect(sheet().querySelectorAll('[data-primary]')).toHaveLength(1);
    expect(sheet().querySelector('input[type="radio"]')).toBeNull();
  });

  it('shows a refusal and lets the poster try again', async () => {
    let tries = 0;
    render(
      <AcceptedSheet
        event={EVENT}
        loadWallets={async () => WALLETS} loadTrade={loadView}
        submit={async () => {
          tries++;
          if (tries === 1) throw new Error('wrong-state');
        }}
        onDone={() => undefined}
        onClose={() => undefined}
      />,
    );
    await flush();
    fire(sheet().querySelector('input[value="w1"]') as HTMLInputElement, new MouseEvent('click', { bubbles: true }));
    await act(async () => {
      button('Use this wallet').click();
    });
    await flush();
    expect(sheet().querySelector('[role="alert"]')!.textContent).toBe('That did not work. Try again.');
    await act(async () => {
      button('Use this wallet').click();
    });
    await flush();
    expect(tries).toBe(2);
    expect(sheet().textContent).toContain('Setting up escrow');
  });
});

describe("AcceptedSheet hands the room the poster's ConfirmedTrade (Task 18 / 22 seam)", () => {
  it('the record handed on and stored equals what the sheet showed, with the picked full address never rendered', async () => {
    const done: Array<[string, ConfirmedTrade]> = [];
    render(
      <AcceptedSheet event={EVENT} loadWallets={async () => WALLETS} loadTrade={loadView} submit={async () => undefined}
        onDone={(code, confirmed) => done.push([code, confirmed])} onClose={() => undefined} />,
    );
    await flush();
    const deal = sheet().querySelector('[data-part="deal"]')!;
    expect(deal.textContent).toContain('1.250000 XMR');
    expect(deal.textContent).toContain('€150.00');
    expect(deal.textContent).toContain('€200.00');
    fire(sheet().querySelector('input[value="w2"]') as HTMLInputElement, new MouseEvent('click', { bubbles: true }));
    await act(async () => {
      button('Use this wallet').click();
    });
    await flush();
    const expected: ConfirmedTrade = {
      role: 'seller', ownAddress: ADDR2,
      deal: { poster: 'seller', takeAmountAtomic: 1_250_000_000_000n, currency: 'EUR', centsPerXmr: 15000n, maxFiatCents: 20000n },
    };
    expect(done).toEqual([[EVENT.code, expected]]);
    expect(readConfirmed(EVENT.code)).toEqual(expected);
    expect(JSON.parse(sessionStorage.getItem(confirmedKey(EVENT.code))!).deal.takeAmountAtomic).toBe('1250000000000');
    expect(document.body.innerHTML).not.toContain(ADDR2);
    expect(document.body.innerHTML).not.toContain(ADDR1);
  });

  it('takes the amount at take when the trade has grown since', async () => {
    const done: ConfirmedTrade[] = [];
    const grown = { ...VIEW, amountAtomic: '2000000000000', grown: { at: '2026-10-27T10:00:00Z', fromAtomic: '1250000000000', fromFiatCents: '18750' } };
    render(
      <AcceptedSheet event={EVENT} loadWallets={async () => WALLETS} loadTrade={async () => grown} submit={async () => undefined}
        onDone={(_c, confirmed) => done.push(confirmed)} onClose={() => undefined} />,
    );
    await flush();
    fire(sheet().querySelector('input[value="w1"]') as HTMLInputElement, new MouseEvent('click', { bubbles: true }));
    await act(async () => {
      button('Use this wallet').click();
    });
    await flush();
    expect(done[0]!.deal.takeAmountAtomic).toBe(1_250_000_000_000n);
  });

  it.each([
    ['the trade cannot be loaded', async (): Promise<AcceptedTradeView> => { throw new Error('offline'); }],
    ['the viewer is not the poster', async () => ({ ...VIEW, role: 'buyer' as const })],
    ['the view is malformed', async () => ({ ...VIEW, lockedRate: { currency: 'EUR', centsPerXmr: 'lots' } })],
  ])('no navigation and no record when %s', async (_why, loadTrade) => {
    const done: string[] = [];
    const posted: string[] = [];
    render(
      <AcceptedSheet event={EVENT} loadWallets={async () => WALLETS} loadTrade={loadTrade} submit={async (_c, w) => void posted.push(w)}
        onDone={(code) => done.push(code)} onClose={() => undefined} />,
    );
    await flush();
    const radio = sheet().querySelector('input[value="w1"]') as HTMLInputElement | null;
    if (radio) fire(radio, new MouseEvent('click', { bubbles: true }));
    const use = button('Use this wallet') as HTMLButtonElement | undefined;
    if (use) {
      expect(use.disabled).toBe(true);
      await act(async () => {
        use.click();
      });
    }
    await flush();
    expect(sheet().querySelector('[role="alert"]')).not.toBeNull();
    expect(posted).toEqual([]);
    expect(done).toEqual([]);
    expect(readConfirmed(EVENT.code)).toBeNull();
  });

  it('acceptedNavigation goes to the trade room with { state: { confirmed } }', () => {
    const confirmed: ConfirmedTrade = {
      role: 'seller', ownAddress: ADDR1,
      deal: { poster: 'seller', takeAmountAtomic: 1n, currency: 'EUR', centsPerXmr: 2n, maxFiatCents: 3n },
    };
    expect(acceptedNavigation(EVENT.code, confirmed)).toEqual(['/trade/X2F-7KQ4-M9TD', { state: { confirmed } }]);
  });
});

describe('AcceptedSheet re-review (gaps 1-3)', () => {
  const renderWith = (o: { view?: AcceptedTradeView; wallets?: AcceptedWallet[]; posted?: string[]; done?: string[] } = {}) =>
    render(
      <AcceptedSheet event={EVENT} loadWallets={async () => o.wallets ?? WALLETS} loadTrade={async () => o.view ?? VIEW}
        submit={async (_c, w) => void o.posted?.push(w)} onDone={(code) => o.done?.push(code)} onClose={() => undefined} />,
    );

  it('gap 1: the deal line names the side: "You sell" for a seller-posted offer, "You buy" for a buyer-posted one', async () => {
    renderWith();
    await flush();
    expect(sheet().querySelector('[data-part="deal"]')!.textContent).toMatch(/^You sell 1\.250000 XMR/);
  });

  it('gap 1: a buyer poster sees "You buy"', async () => {
    renderWith({ view: { ...VIEW, role: 'buyer', poster: 'buyer' } });
    await flush();
    expect(sheet().querySelector('[data-part="deal"]')!.textContent).toMatch(/^You buy 1\.250000 XMR/);
  });

  it("gap 2: each wallet's ending comes from its full address, never from the API's addressEnd", async () => {
    renderWith();
    await flush();
    const ends = [...sheet().querySelectorAll('.x2f-accepted__end')].map((e) => e.textContent);
    expect(ends).toEqual(['…a1b2c3', '…d4e5f6']);
    expect(sheet().textContent).not.toContain('DECOY');
  });

  it('gap 3: a wallet whose address is longer than 256 characters (or empty) is never offered or posted', async () => {
    const long: AcceptedWallet = { id: 'w9', app: 'cake', label: 'Too long', address: `5${'Z'.repeat(256)}`, addressEnd: 'ZZZZZZ', usable: true };
    const empty: AcceptedWallet = { id: 'w8', app: 'cake', label: 'Empty', address: '', addressEnd: '', usable: true };
    const posted: string[] = [];
    const done: string[] = [];
    renderWith({ wallets: [long, empty], posted, done });
    await flush();
    expect(sheet().querySelector('input[type="radio"]')).toBeNull();
    expect(sheet().textContent).not.toContain('Too long');
    expect(button('Add a wallet')).toBeDefined();
    expect(posted).toEqual([]);
    expect(done).toEqual([]);
    expect(readConfirmed(EVENT.code)).toBeNull();
  });

  it('review 17 Nov M4: a wallet listed with another address than this device recorded for it is never offered, picked or posted', async () => {
    // The poster typed ADDR2's twin for w2 on this device (quote or Settings); the API now lists ADDR2.
    recordTypedAddress('w2', `5${'B'.repeat(88)}TYPED2`);
    const posted: Array<[string, string]> = [];
    const withDefault = WALLETS.map((w) => ({ ...w, isDefault: w.id === 'w2' }));
    render(<AcceptedSheet event={EVENT} loadWallets={async () => withDefault} loadTrade={loadView} submit={async (c, w) => void posted.push([c, w])} onDone={() => undefined} onClose={() => undefined} />);
    await flush();
    const options = [...sheet().querySelectorAll('input[type="radio"]')] as HTMLInputElement[];
    expect(options.map((o) => o.value)).toEqual(['w1']);
    expect(options.map((o) => o.checked)).toEqual([false]);
    expect(sheet().textContent).not.toContain('d4e5f6');
    expect(sheet().querySelector('[data-part="accepted-address-swapped"]')!.textContent).toContain('different address');
    expect((button('Use this wallet') as HTMLButtonElement).disabled).toBe(true);
    expect(posted).toEqual([]);
  });

  it('review 17 Nov M4: a wallet listed with the address this device recorded is offered as before', async () => {
    recordTypedAddress('w2', ADDR2);
    const withDefault = WALLETS.map((w) => ({ ...w, isDefault: w.id === 'w2' }));
    render(<AcceptedSheet event={EVENT} loadWallets={async () => withDefault} loadTrade={loadView} submit={async () => undefined} onDone={() => undefined} onClose={() => undefined} />);
    await flush();
    const options = [...sheet().querySelectorAll('input[type="radio"]')] as HTMLInputElement[];
    expect(options.map((o) => [o.value, o.checked])).toEqual([['w1', false], ['w2', true]]);
    expect(sheet().querySelector('[data-part="accepted-address-swapped"]')).toBeNull();
  });
});
