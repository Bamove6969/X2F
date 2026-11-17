// @vitest-environment happy-dom
// Owner demo note #6 (16 Nov 2026; docs/trade-wallet-note6.md) and his answers of 17 Nov: the quote's
// payout-address question, the rule by the account's rating (weak, medium, high), the "?" tip for weak
// and medium, the default wallet picked first, and the new-address sheet only a high account gets.
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { walletAction } from '@x2f/auth-client';
import { NewAddressSheet, type NewAddressResult } from '../src/screens/quote/NewAddressSheet.js';
import { WalletPicker } from '../src/screens/quote/WalletPicker.js';
import { PAYOUT_QUESTION, addressRuleText } from '../src/screens/quote/addressCopy.js';
import type { PickWallet } from '../src/screens/quote/api.js';
import { fire, render } from './render.js';

const ADDR = `4${'Q'.repeat(88)}ZZZZZ1`;
const W = (id: string, over: Partial<PickWallet> = {}): PickWallet => ({
  id, app: 'cake', label: id, address: `4${id.repeat(95).slice(0, 88)}AAAAA${id.length}`, addressEnd: 'AAAAA1', usable: true, oneTime: false, isDefault: false, ...over,
});

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function until(ready: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!ready() && Date.now() < deadline) await settle();
}

function picker(o: { rating: 'weak' | 'medium' | 'high' | null; onAddNew?: () => void; wallets?: PickWallet[] }) {
  return render(
    <MemoryRouter>
      <WalletPicker
        legend="Which wallet gets paid?"
        wallets={o.wallets ?? [W('a'), W('b', { oneTime: true }), W('c', { usable: false })]}
        picked={null}
        onPick={() => {}}
        addHref="/wallets?add=1"
        question={PAYOUT_QUESTION.buy}
        rating={o.rating}
        {...(o.onAddNew ? { onAddNew: o.onAddNew } : {})}
      />
    </MemoryRouter>,
  );
}

describe('the payout-address question on the quote (owner demo note #6)', () => {
  it('asks the question and gives the rule for each rating', () => {
    for (const rating of ['weak', 'medium', 'high', null] as const) {
      const { host, unmount } = picker({ rating });
      const rule = host.querySelector('[data-part="address-rule"]')!;
      expect(rule.textContent).toContain(PAYOUT_QUESTION.buy);
      expect(rule.textContent).toContain(addressRuleText(rating));
      unmount();
    }
    expect(addressRuleText('weak')).toContain('Settings');
    expect(addressRuleText('weak')).toContain('24 hours');
    expect(addressRuleText('high')).toContain('this trade only or saved for future trades');
    expect(addressRuleText('medium')).toContain('rated medium');
    expect(addressRuleText('medium')).toContain('Settings');
  });

  it('a high account gets "Add a new address"; any other keeps the link to Your wallets', () => {
    const opened = vi.fn();
    const secure = picker({ rating: 'high', onAddNew: opened });
    const add = secure.host.querySelector<HTMLButtonElement>('[data-part="add-new-address"]')!;
    expect(add.textContent).toBe('Add a new address');
    expect(secure.host.querySelector('a.x2f-quote__add')).toBeNull();
    fire(add, new MouseEvent('click', { bubbles: true }));
    expect(opened).toHaveBeenCalledTimes(1);
    secure.unmount();

    const weak = picker({ rating: 'weak' });
    expect(weak.host.querySelector('[data-part="add-new-address"]')).toBeNull();
    expect(weak.host.querySelector('a.x2f-quote__add')!.getAttribute('href')).toBe('/wallets?add=1');
  });

  it('offers usable wallets only, and marks a one-time one', () => {
    const { host } = picker({ rating: 'high', onAddNew: () => {} });
    const radios = [...host.querySelectorAll<HTMLInputElement>('input[name="wallet"]')];
    expect(radios.map((r) => r.value)).toEqual(['a', 'b']);
    const labels = [...host.querySelectorAll('.x2f-quote__wallet')].map((l) => l.textContent ?? '');
    expect(labels[0]).not.toContain('One trade only');
    expect(labels[1]).toContain('One trade only');
  });
});

describe('the "?" tip for weak and medium accounts (owner, 17 Nov 2026)', () => {
  const tipButton = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('[data-part="address-tip"]');

  it('weak and medium get a "?" button that opens the explanation on tap, with links to Your wallets and to a login method', () => {
    for (const rating of ['weak', 'medium'] as const) {
      const { host, unmount } = picker({ rating });
      const tip = tipButton(host)!;
      expect(tip.tagName).toBe('BUTTON');
      expect(tip.textContent).toBe('?');
      expect(tip.getAttribute('aria-label')).toBe('Why is there no option to add a new address here?');
      expect(tip.getAttribute('aria-expanded')).toBe('false');
      const panelId = tip.getAttribute('aria-controls')!;
      expect(document.getElementById(panelId)).toBeNull();
      fire(tip, new MouseEvent('click', { bubbles: true }));
      expect(tip.getAttribute('aria-expanded')).toBe('true');
      const panel = document.getElementById(panelId)!;
      expect(panel.textContent).toContain('security rating');
      expect(panel.textContent).toContain('24 hours');
      const links = [...panel.querySelectorAll('a')].map((a) => a.getAttribute('href'));
      expect(links).toEqual(['/wallets?add=1', '/settings/security']);
      fire(tip, new MouseEvent('click', { bubbles: true }));
      expect(tip.getAttribute('aria-expanded')).toBe('false');
      unmount();
    }
  });

  it('closes with Escape and gives focus back to the "?"', () => {
    const { host } = picker({ rating: 'medium' });
    const tip = tipButton(host)!;
    tip.focus();
    fire(tip, new MouseEvent('click', { bubbles: true }));
    const panel = document.getElementById(tip.getAttribute('aria-controls')!)!;
    fire(panel, new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(tip.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(tip);
  });

  it('a high account, and an unknown rating, get no tip', () => {
    for (const rating of ['high', null] as const) {
      const { host, unmount } = picker({ rating, ...(rating === 'high' ? { onAddNew: () => {} } : {}) });
      expect(tipButton(host)).toBeNull();
      unmount();
    }
  });
});

describe('the default wallet on the quote (owner, 17 Nov 2026)', () => {
  it('marks the default wallet', () => {
    const { host } = picker({ rating: 'weak', wallets: [W('a'), W('b', { isDefault: true })] });
    const labels = [...host.querySelectorAll('.x2f-quote__wallet')].map((l) => l.textContent ?? '');
    expect(labels[0]).not.toContain('Default');
    expect(labels[1]).toContain('Default');
  });
});

describe('the new-address sheet (owner demo note #6)', () => {
  let posts: Array<Record<string, unknown>>;
  let confirms: Array<Record<string, unknown>>;
  let answer: (n: number) => { status: number; json: unknown };

  beforeEach(() => {
    posts = [];
    confirms = [];
    answer = () => ({ status: 500, json: { error: 'internal' } });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
        const res = (status: number, j: unknown) => new Response(JSON.stringify(j), { status, headers: { 'content-type': 'application/json' } });
        if (url === '/v1/wallets/rule') return res(200, { firstWallet: false, strongMethods: ['passkey'], password: 'waits', waitHours: 24 });
        if (url === '/v1/wallets' && method === 'POST') {
          posts.push(body!);
          const a = answer(posts.length);
          return res(a.status, a.json);
        }
        if (url === '/v1/account/me') return res(200, { methods: ['password'] });
        if (url === '/v1/confirm/password') {
          confirms.push(body!);
          return res(200, { confirmToken: 'tok-1' });
        }
        return res(404, { error: 'not-found' });
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function type(selector: string, value: string): void {
    const input = document.querySelector<HTMLInputElement>(selector)!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setValue.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  const clickText = (text: string, within: ParentNode = document) => {
    const b = [...within.querySelectorAll('button')].find((x) => x.textContent === text)!;
    fire(b, new MouseEvent('click', { bubbles: true }));
  };

  async function open(): Promise<NewAddressResult[]> {
    const done: NewAddressResult[] = [];
    render(
      <MemoryRouter>
        <NewAddressSheet onClose={() => {}} onDone={(r) => done.push(r)} />
      </MemoryRouter>,
    );
    await settle();
    return done;
  }

  it('posts the named address for this trade only through confirm-it-is-you, and hands back a usable one', async () => {
    answer = (n) =>
      n === 1
        ? { status: 403, json: { error: 'confirm-required', action: 'add-wallet' } }
        : { status: 201, json: { id: 'w-new', app: 'other', label: 'Rent', address: ADDR, addressEnd: 'ZZZZZ1', usableFrom: '2026-11-17T00:00:00.000Z', usable: true, oneTime: true } };
    const done = await open();
    // One trade only is the default on the quote.
    expect(document.querySelector<HTMLInputElement>('[data-part="new-address-keep"] input[value="one-time"]')!.checked).toBe(true);
    type('#new-address-label', 'Rent');
    type('#new-address-address', `  ${ADDR} `);
    clickText('Save address');
    await until(() => document.querySelector('#confirm-password') !== null);
    type('#confirm-password', 'Correct-Horse-9!');
    const sheet = [...document.querySelectorAll('[role="dialog"]')].find((d) => d.textContent?.includes("Confirm it's you"))!;
    clickText('Confirm', sheet.querySelector('[data-method="password"]')!);
    await until(() => done.length > 0);
    expect(posts[0]).toEqual({ app: 'other', label: 'Rent', address: ADDR, oneTime: true });
    expect(posts[1]).toEqual({ app: 'other', label: 'Rent', address: ADDR, oneTime: true, confirmToken: 'tok-1' });
    expect(done).toEqual([{ kind: 'usable', wallet: expect.objectContaining({ id: 'w-new', usable: true }) }]);
    // The token was proved for exactly this address.
    expect(confirms.map((c) => c.action)).toEqual([await walletAction(ADDR)]);
  });

  it('saved for future trades sends oneTime: false; a waiting address says when it starts working', async () => {
    answer = () => ({ status: 201, json: { id: 'w-wait', app: 'other', label: 'Trade address', address: ADDR, addressEnd: 'ZZZZZ1', usableFrom: '2026-11-18T10:00:00.000Z', usable: false, oneTime: false } });
    const done = await open();
    const saved = document.querySelector<HTMLInputElement>('[data-part="new-address-keep"] input[value="saved"]')!;
    fire(saved, new MouseEvent('click', { bubbles: true }));
    await settle();
    type('#new-address-address', ADDR);
    clickText('Save address');
    await until(() => done.length > 0);
    expect(posts[0]).toEqual({ app: 'other', label: 'Trade address', address: ADDR, oneTime: false });
    expect(done[0]!.kind).toBe('waits');
    expect(document.querySelector('[data-part="new-address-waits"]')!.textContent).toContain('pick a saved address for this trade');
  });

  it('a staged add (a username-and-password login) says it waits in the changes', async () => {
    answer = () => ({ status: 202, json: { status: 'staged', changeId: 'c-1' } });
    const done = await open();
    type('#new-address-address', ADDR);
    clickText('Save address');
    await until(() => done.length > 0);
    expect(done).toEqual([{ kind: 'staged' }]);
    expect(document.querySelector('[data-part="new-address-staged"]')).not.toBeNull();
  });

  it('shows the address error and hands back nothing', async () => {
    answer = () => ({ status: 400, json: { error: 'address-invalid' } });
    const done = await open();
    type('#new-address-address', 'nope');
    clickText('Save address');
    await until(() => document.querySelector('[role="alert"]') !== null);
    expect(document.querySelector('[role="alert"]')!.textContent).toContain('Monero address');
    expect(done).toEqual([]);
  });
});
