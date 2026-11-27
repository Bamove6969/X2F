// @vitest-environment happy-dom
// Owner demo note #6 (16 Nov 2026; docs/trade-wallet-note6.md) and his answers of 17 Nov: the quote's
// payout-address question, the default wallet picked first, and the new-address sheet. Owner, 27 Nov
// 2026: no security rating any more, so the account's owner always gets the new-address sheet and no
// "?" tip; a team member (wallets are the lead's) keeps the link to Your wallets.
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

function picker(o: { onAddNew?: () => void; wallets?: PickWallet[] }) {
  return render(
    <MemoryRouter>
      <WalletPicker
        legend="Which wallet gets paid?"
        wallets={o.wallets ?? [W('a'), W('b', { oneTime: true }), W('c', { usable: false })]}
        picked={null}
        onPick={() => {}}
        addHref="/wallets?add=1"
        question={PAYOUT_QUESTION.buy}
        {...(o.onAddNew ? { onAddNew: o.onAddNew } : {})}
      />
    </MemoryRouter>,
  );
}

describe('the payout-address question on the quote (owner demo note #6)', () => {
  it('asks the question and gives the rule, with no rating word', () => {
    for (const onAddNew of [() => {}, undefined]) {
      const { host, unmount } = picker(onAddNew ? { onAddNew } : {});
      const rule = host.querySelector('[data-part="address-rule"]')!;
      expect(rule.textContent).toContain(PAYOUT_QUESTION.buy);
      expect(rule.textContent).toContain(addressRuleText(onAddNew !== undefined));
      expect(rule.textContent).not.toMatch(/rated|highly secure|weak|medium|security rating/i);
      unmount();
    }
    expect(addressRuleText(true)).toContain('this trade only or saved for future trades');
    expect(addressRuleText(true)).not.toContain('Settings');
    expect(addressRuleText(false)).toContain('Settings');
    expect(addressRuleText(false)).not.toContain('24 hours');
  });

  it('the account\'s owner gets "Add a new address"; a team member keeps the link to Your wallets', () => {
    const opened = vi.fn();
    const owner = picker({ onAddNew: opened });
    const add = owner.host.querySelector<HTMLButtonElement>('[data-part="add-new-address"]')!;
    expect(add.textContent).toBe('Add a new address');
    expect(owner.host.querySelector('a.x2f-quote__add')).toBeNull();
    fire(add, new MouseEvent('click', { bubbles: true }));
    expect(opened).toHaveBeenCalledTimes(1);
    owner.unmount();

    const member = picker({});
    expect(member.host.querySelector('[data-part="add-new-address"]')).toBeNull();
    expect(member.host.querySelector('a.x2f-quote__add')!.getAttribute('href')).toBe('/wallets?add=1');
  });

  it('offers usable wallets only, and marks a one-time one', () => {
    const { host } = picker({ onAddNew: () => {} });
    const radios = [...host.querySelectorAll<HTMLInputElement>('input[name="wallet"]')];
    expect(radios.map((r) => r.value)).toEqual(['a', 'b']);
    const labels = [...host.querySelectorAll('.x2f-quote__wallet')].map((l) => l.textContent ?? '');
    expect(labels[0]).not.toContain('One trade only');
    expect(labels[1]).toContain('One trade only');
  });

  it('shows no "?" tip, with or without the inline add (owner 27 Nov 2026: no rating to explain)', () => {
    for (const onAddNew of [() => {}, undefined]) {
      const { host, unmount } = picker(onAddNew ? { onAddNew } : {});
      expect(host.querySelector('[data-part="address-tip"]')).toBeNull();
      unmount();
    }
  });
});

describe('the default wallet on the quote (owner, 17 Nov 2026)', () => {
  it('marks the default wallet', () => {
    const { host } = picker({ wallets: [W('a'), W('b', { isDefault: true })] });
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
        if (url === '/v1/wallets/rule') return res(200, { firstWallet: false, strongMethods: ['pgp'] });
        if (url === '/v1/wallets' && method === 'POST') {
          posts.push(body!);
          const a = answer(posts.length);
          return res(a.status, a.json);
        }
        if (url === '/v1/account/me') return res(200, { methods: ['pgp'] });
        if (url === '/v1/confirm/pgp/start') {
          confirms.push(body!);
          return res(200, { challengeId: 'ch-1', encryptedMessage: '-----BEGIN PGP MESSAGE-----' });
        }
        if (url === '/v1/confirm/pgp/finish') return res(200, { confirmToken: 'tok-1' });
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
    await until(() => document.querySelector('[data-method="pgp"]') !== null);
    fire(document.querySelector('[data-method="pgp"]')!, new MouseEvent('click', { bubbles: true }));
    await until(() => document.querySelector('[data-method="pgp-code"]') !== null);
    type('[data-method="pgp-code"] input[aria-label="Login code"]', '123456');
    clickText('Confirm', document.querySelector('[data-method="pgp-code"]')!);
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

  it('an API answer naming another address than the one typed is refused: nothing is handed back (lead 17 Nov)', async () => {
    const OTHER = `4${'X'.repeat(88)}OTHER1`;
    answer = () => ({ status: 201, json: { id: 'w-swap', app: 'other', label: 'Trade address', address: OTHER, addressEnd: 'OTHER1', usableFrom: '2026-11-17T00:00:00.000Z', usable: true, oneTime: true } });
    const done = await open();
    type('#new-address-address', ADDR);
    clickText('Save address');
    await until(() => document.querySelector('[role="alert"]') !== null);
    expect(document.querySelector('[role="alert"]')!.textContent).toContain('different address from the one you typed');
    expect(done).toEqual([]);
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

// Review of wip/third-trade-wallet 17 Nov (b), M1: a one-time wallet a trade in setup is using is
// listed by the API for Settings; the quote neither offers it nor counts it as waiting.
describe('the quote wallet list leaves out a one-time wallet another trade is using', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('drops entries with inUseByTrade, keeps the rest as before', async () => {
    const { fetchWallets } = await import('../src/screens/quote/api.js');
    const wire = (id: string, over: Record<string, unknown> = {}) => ({
      id, app: 'cake', label: id, address: `4${'R'.repeat(88)}AAAAA${id}`, addressEnd: `AAAAA${id}`, usableFrom: '2026-10-20T00:00:00.000Z', usable: true, oneTime: false, isDefault: false, inUseByTrade: null, ...over,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify([wire('1', { isDefault: true }), wire('2', { usable: false, oneTime: true, inUseByTrade: 'ABCD-EFGH-JKLM-NPQR' }), wire('3', { usable: false })]), {
          status: 200, headers: { 'content-type': 'application/json' },
        })),
    );
    const got = await fetchWallets();
    expect(got.map((w) => [w.id, w.usable])).toEqual([['1', true], ['3', false]]);
    expect(Object.keys(got[0]!).sort()).toEqual(['address', 'addressEnd', 'app', 'id', 'isDefault', 'label', 'oneTime', 'usable']);
  });
});
