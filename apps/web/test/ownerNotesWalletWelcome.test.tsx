// @vitest-environment happy-dom
// Owner demo notes 12 Nov #32 and 16 Nov #96 (/setup/wallet: the wallet names are a recommendation
// list, not buttons, then one address field; the Edge tip names Edge's real setting) and 16 Nov #97
// (/setup/welcome: the "Username" line (no security rating since owner 27 Nov 2026), a link back to each
// setting). COPY-UNSIGNED.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Wallet as WalletEntry } from '@x2f/auth-client';
import { INITIAL, SetupContext, type SetupApi, type SetupState } from '../src/screens/setup/kit.js';
import { SUGGESTED_WALLETS, WALLET_COPY, Wallet } from '../src/screens/setup/Wallet.js';
import { WELCOME_COPY, WELCOME_LINKS, Welcome, leavePath, methodRows, startTradingPath } from '../src/screens/setup/Welcome.js';
import { render } from './render.js';

const me = vi.hoisted(() => ({ current: { tradeTag: 'Lumen.K', methods: ['pgp'] } as Record<string, unknown> }));
vi.mock('../src/session/useSession.js', () => ({
  useSession: () => ({ status: 'signed-in', me: me.current }),
  refreshSession: () => undefined,
  tradeTagOf: (m: { tradeTag?: string } | null) => m?.tradeTag ?? '',
}));

const ADDRESS = `4${'9'.repeat(90)}k3Fz`;
const fresh = { registered: false, method: 'pgp' as const, backup: null };

afterEach(() => {
  vi.unstubAllGlobals();
});

const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });

function type(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  set.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function setup(state: Partial<SetupState> = {}): SetupApi {
  return { state: { ...INITIAL, ...state }, update: vi.fn(), returnTo: '/sell', go: vi.fn(), path: (s) => `/setup/${s}` };
}

/** Where the router is now (the Welcome links navigate). */
function Where() {
  const l = useLocation();
  return <span data-testid="where">{l.pathname + l.search}</span>;
}

function show(el: React.ReactNode, api: SetupApi) {
  return render(
    <MemoryRouter initialEntries={['/setup/welcome']}>
      <SetupContext.Provider value={api}>{el}</SetupContext.Provider>
      <Where />
    </MemoryRouter>,
  ).host;
}

const where = (host: HTMLElement) => host.querySelector('[data-testid="where"]')!.textContent;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('/setup/wallet (owner #32, #96)', () => {
  it('lists the well-known wallets as plain text, "and many more", and nothing to click but Finish setup', () => {
    vi.stubGlobal('fetch', async () => json({ error: 'internal' }, 500));
    const host = show(<Wallet />, setup());
    const list = host.querySelector('[data-part="wallet-list"]')!;
    expect([...list.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['Cake Wallet', 'Edge', 'Feather', 'Monerujo', 'Stack', 'Monero GUI', 'Ledger or Trezor']);
    expect(SUGGESTED_WALLETS).not.toContain('Other');
    expect(list.textContent).toContain('and many more.');
    expect(list.querySelectorAll('button, a, [role="radio"], input')).toHaveLength(0);
    expect(host.querySelector('[role="radiogroup"]')).toBeNull();
    expect([...host.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Finish setup']);
    expect(host.querySelector('label[for="xmr-payout"]')!.textContent).toContain('Enter your receiving wallet address below.');
  });

  it("the Edge tip names Edge's own setting (Wallet Settings, Full Node), not a Full Sync that Edge does not have", () => {
    vi.stubGlobal('fetch', async () => json({ error: 'internal' }, 500));
    const host = show(<Wallet />, setup());
    const tip = host.querySelector('[data-part="edge-tip"]')!.textContent!;
    expect(tip).toBe(WALLET_COPY.edgeTip);
    expect(tip).toContain('Wallet Settings');
    expect(tip).toContain('Full Node');
    expect(tip).not.toContain('Full Sync');
  });

  it('the address field asks the browser and password managers not to fill it in', () => {
    vi.stubGlobal('fetch', async () => json({ error: 'internal' }, 500));
    const input = show(<Wallet />, setup()).querySelector<HTMLInputElement>('#xmr-payout')!;
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.getAttribute('spellcheck')).toBe('false');
    expect(input.getAttribute('name')).toBe('xmr-payout');
    for (const a of ['data-1p-ignore', 'data-lpignore', 'data-bwignore', 'data-form-type']) expect(input.hasAttribute(a), a).toBe(true);
    // No id or name that browser address autofill reads as a postal address.
    expect(input.id).not.toMatch(/addr/i);
  });

  it('a malformed address is still refused before anything is sent (checks unchanged)', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (u: string) => {
      calls.push(String(u));
      return json({ error: 'internal' }, 500);
    });
    const api = setup();
    const host = show(<Wallet />, api);
    const input = host.querySelector<HTMLInputElement>('#xmr-payout')!;
    const finish = host.querySelector<HTMLButtonElement>('[data-part="wallet-finish"]')!;
    // Owner demo note #219: Finish setup is disabled until the address has a Monero address's shape.
    expect(finish.disabled).toBe(true);
    act(() => type(input, `4${'9'.repeat(93)}`));
    expect(finish.disabled).toBe(true);
    // The shape sentence waits until the field is left, then shows as help tied to the field.
    expect(host.querySelector('[data-part="wallet-shape"]')).toBeNull();
    act(() => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    expect(host.querySelector('[data-part="wallet-shape"]')!.textContent).toBe("That doesn't look like a Monero address. Copy the whole receive address from your wallet.");
    expect(input.getAttribute('aria-describedby')).toBe('xmr-payout-shape');
    act(() => finish.click());
    await settle();
    expect(calls.filter((u) => u.includes('/v1/wallets'))).toEqual([]);
    expect(api.go).not.toHaveBeenCalled();
    act(() => type(input, ADDRESS));
    expect(finish.disabled).toBe(false);
    expect(host.querySelector('[data-part="wallet-shape"]')).toBeNull();
  });

  it('sends the address exactly as entered (trimmed) under the app Other, then goes on to Welcome', async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal('fetch', async (u: string, init?: RequestInit) => {
      if (String(u).endsWith('/v1/wallets') && init?.method === 'POST') {
        bodies.push(JSON.parse(String(init.body)));
        return json([{ id: 'w', app: 'other', label: 'Wallet 1', address: ADDRESS, addressEnd: 'k3Fz', usableFrom: '2026-10-25T00:00:00.000Z', usable: true }], 201);
      }
      return json({ error: 'internal' }, 500);
    });
    const api = setup();
    const host = show(<Wallet />, api);
    act(() => type(host.querySelector<HTMLInputElement>('#xmr-payout')!, `  ${ADDRESS} `));
    act(() => host.querySelector<HTMLButtonElement>('[data-part="wallet-finish"]')!.click());
    // The add's confirm action hashes the address (WebCrypto, off the timer queue) before it is sent.
    for (let i = 0; i < 40 && host.querySelector('[data-part="wallet-continue"]') === null; i++) await settle();
    expect(bodies).toEqual([{ wallets: [{ app: 'other', label: 'Wallet 1', address: ADDRESS }] }]);
    expect(api.update).toHaveBeenCalledWith({ wallet: { app: 'other', addressEnd: 'k3Fz' } });
    // Owner #161: the saved wallet's green check, then Continue to Welcome.
    act(() => host.querySelector<HTMLButtonElement>('[data-part="wallet-continue"]')!.click());
    expect(api.go).toHaveBeenCalledWith('welcome');
  });
});

describe('/setup/welcome (owner #97)', () => {
  const walletList = (over: Partial<WalletEntry> = {}): WalletEntry[] => [
    { id: 'w', app: 'other', label: 'Wallet 1', address: ADDRESS, addressEnd: 'k3Fz', usableFrom: '2026-10-25T00:00:00.000Z', usable: true, ...over },
  ];

  let posts: string[] = [];
  async function showWelcome(methods: string[], wallets: WalletEntry[], state: Partial<SetupState> = {}) {
    me.current = { tradeTag: 'Lumen.K', methods };
    posts = [];
    vi.stubGlobal('fetch', async (u: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push(String(u));
        return new Response(null, { status: 204 });
      }
      return String(u).endsWith('/v1/wallets') ? json(wallets) : json({ error: 'internal' }, 500);
    });
    const host = show(<Welcome />, setup(state));
    await settle();
    return host;
  }

  it('owner 27 Nov 2026: no security level anywhere on the screen, whatever the methods', async () => {
    for (const methods of [['totp', 'recovery-codes'], ['pgp', 'recovery-codes'], ['passkey', 'totp']]) {
      const host = await showWelcome(methods, walletList());
      expect(host.querySelector('[data-part="security-rating"]')).toBeNull();
      expect(host.querySelector('[data-part="rating-link"]')).toBeNull();
      expect(host.textContent).not.toMatch(/achieved level|Highly secure|Security level|make it more secure/i);
    }
    const host = await showWelcome(['totp', 'recovery-codes'], walletList());
    expect(host.querySelector(`[data-method="totp"] [data-part="method-state"]`)!.textContent).toBe("Set up");
    expect(host.querySelector('[data-method="password"]')).toBeNull();
  });

  it('owner #165: the heading is "Welcome to" and the big X2F logo (no comma), then the name with a comma, then the lead', async () => {
    const host = await showWelcome(['pgp', 'recovery-codes'], walletList());
    const h1 = host.querySelector('h1')!;
    expect(h1.querySelector('.x2f-welcome__to')!.textContent).toBe('Welcome to');
    const logo = h1.querySelector('svg[role="img"]')!;
    expect(logo.getAttribute('aria-label')).toBe('X2F');
    expect(logo.classList.contains('x2f-welcome__logo')).toBe(true);
    // The heading's name: its text and the logo's label.
    expect(`${h1.textContent!.trim()} ${logo.getAttribute('aria-label')}`).toBe('Welcome to X2F');
    expect(h1.textContent).not.toContain(',');
    expect(h1.querySelector('[data-username]')).toBeNull();
    const nameLine = h1.nextElementSibling!;
    expect(nameLine.getAttribute('data-part')).toBe('welcome-name');
    expect(nameLine.textContent).toBe('Lumen.K,');
    expect(nameLine.querySelector('[data-username]')!.textContent).toBe('Lumen.K');
    expect(nameLine.nextElementSibling!.textContent).toBe(WELCOME_COPY.lead);
    // Owner #166: his second paragraph right after.
    expect(nameLine.nextElementSibling!.nextElementSibling!.textContent).toBe(WELCOME_COPY.leadMore);
  });

  describe('owner #168: every login method, a big green check or red cross each (no level line since 27 Nov 2026)', () => {
    const rowsOf = (host: HTMLElement) =>
      [...host.querySelectorAll('[data-part="method-row"]')].map((r) => ({
        method: r.getAttribute('data-method'),
        set: r.getAttribute('data-set'),
        text: r.querySelector('.x2f-welcome__row-name')!.textContent + ' / ' + r.querySelector('[data-part="method-state"]')!.textContent,
        mark: r.querySelector('[data-part^="mark-"]')!.getAttribute('data-part'),
        link: r.querySelector('a')!.textContent,
      }));

    it('lists all five under the bold heading, set up or not in words, check or cross, Change or Add', async () => {
      const host = await showWelcome(['totp', 'recovery-codes'], walletList());
      expect(host.querySelector('#welcome-logins-title')!.textContent).toBe('Secure X2F login methods');
      expect(host.querySelector('#welcome-logins-title')!.tagName).toBe('H2');
      expect(rowsOf(host)).toEqual([
        { method: 'pgp', set: 'false', text: 'PGP key / Not set up', mark: 'mark-unset', link: 'Add' },
        { method: 'security-key', set: 'false', text: 'Security key / Not set up', mark: 'mark-unset', link: 'Add' },
        { method: 'passkey', set: 'false', text: 'Passkey / Not set up', mark: 'mark-unset', link: 'Add' },
        { method: 'totp', set: 'true', text: 'Authenticator app / Set up', mark: 'mark-set', link: 'Change' },
        { method: 'recovery-codes', set: 'true', text: 'Recovery code / Set up', mark: 'mark-set', link: 'Change' },
      ]);
      // The marks are pictures for the eye only: the words carry it for a screen reader.
      for (const m of host.querySelectorAll('[data-part^="mark-"]')) expect(m.getAttribute('aria-hidden')).toBe('true');
    });

    it('counts what this setup just did (the method that made the account, the backup)', () => {
      const rows = methodRows({ methods: [] }, { registered: true, method: 'pgp', backup: 'recovery-codes' });
      expect(rows.filter((r) => r.set).map((r) => r.id)).toEqual(['pgp', 'recovery-codes']);
    });

    it('right after sign-up each method link leaves the way Start trading does (owner G25)', async () => {
      const host = await showWelcome(['totp'], walletList(), { registered: true, method: 'pgp', backup: 'recovery-codes' });
      for (const id of ['pgp', 'security-key', 'passkey', 'totp', 'recovery-codes']) {
        const target = id === 'recovery-codes' ? WELCOME_LINKS.recovery : WELCOME_LINKS.login;
        expect(host.querySelector(`[data-part="method-link-${id}"]`)!.getAttribute('href'), id).toBe(leavePath({ registered: true, target }).to);
      }
      act(() => host.querySelector<HTMLAnchorElement>('[data-part="method-link-passkey"]')!.click());
      await settle();
      expect(posts.filter((u) => u.includes('/v1/logout'))).toHaveLength(1);
      expect(where(host)).toBe(`/login?returnTo=${encodeURIComponent('/settings/security')}`);
    });

    it('the heading is underlined, the marks green and red by token', () => {
      const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/screens/setup/setup.css'), 'utf8');
      expect(/\.x2f-welcome__logins-title\s*\{([^}]*)\}/.exec(css)![1]).toMatch(/border-bottom:[^;]*var\(--x2f-ink\)/);
      expect(/\.x2f-welcome__mark\[data-part='mark-set'\]\s*\{([^}]*)\}/.exec(css)![1]).toContain('var(--x2f-good)');
      expect(/\.x2f-welcome__mark\[data-part='mark-unset'\]\s*\{([^}]*)\}/.exec(css)![1]).toContain('var(--x2f-danger)');
    });
  });

  it('each item links back to its setting: Change once done, Add before', async () => {
    let host = await showWelcome(['totp', 'recovery-codes'], walletList());
    for (const [part, href] of [
      ['method-link-totp', WELCOME_LINKS.login],
      ['method-link-recovery-codes', WELCOME_LINKS.recovery],
      ['change-wallet', WELCOME_LINKS.wallet],
    ] as const) {
      const a = host.querySelector(`[data-part="${part}"]`)!;
      expect(a.getAttribute('href'), part).toBe(href);
      expect(a.textContent, part).toBe('Change');
    }
    // A wallet saved by setup as Other goes by its own name.
    expect(host.querySelector('[data-part="summary-wallet"]')!.textContent).toBe('Wallet 1 …k3Fz');

    host = await showWelcome(['pgp'], walletList({ usable: false }));
    expect(host.querySelector('[data-part="method-link-recovery-codes"]')!.textContent).toBe('Add');
    // Add a wallet keeps the returnTo that started setup.
    const w = host.querySelector('[data-part="change-wallet"]')!;
    expect(w.getAttribute('href')).toBe('/wallets?add=1&returnTo=%2Fsell');
    expect(w.textContent).toBe('Add');
  });

  it('someone already logged in (setup opened only for a wallet) follows a link straight there, still logged in', async () => {
    const host = await showWelcome(['totp'], walletList(), { registered: false });
    act(() => host.querySelector<HTMLAnchorElement>('[data-part="method-link-totp"]')!.click());
    await settle();
    expect(where(host)).toBe('/settings/security');
    expect(posts.filter((u) => u.includes('/v1/logout'))).toEqual([]);
  });

  it('right after sign-up a link leaves the way Start trading does (owner G25): log out, Log in, then the setting', async () => {
    const host = await showWelcome(['totp'], walletList(), { registered: true, method: 'pgp', backup: 'recovery-codes' });
    for (const [part, target] of [
      ['method-link-totp', WELCOME_LINKS.login],
      ['method-link-recovery-codes', WELCOME_LINKS.recovery],
      ['change-wallet', WELCOME_LINKS.wallet],
    ] as const) {
      expect(host.querySelector(`[data-part="${part}"]`)!.getAttribute('href'), part).toBe(`/login?returnTo=${encodeURIComponent(target)}`);
    }
    act(() => host.querySelector<HTMLAnchorElement>('[data-part="method-link-totp"]')!.click());
    await settle();
    expect(posts.filter((u) => u.includes('/v1/logout'))).toHaveLength(1);
    expect(where(host)).toBe(`/login?returnTo=${encodeURIComponent('/settings/security')}`);
  });

  it("right after sign-up, Add a wallet logs out, then Log in, then Add a wallet, then the take that started setup", async () => {
    const host = await showWelcome(['pgp'], [], { registered: true, method: 'pgp', backup: 'recovery-codes' });
    const add = `/wallets?add=1&returnTo=${encodeURIComponent('/sell')}`;
    expect(host.querySelector('[data-part="change-wallet"]')!.getAttribute('href')).toBe(`/login?returnTo=${encodeURIComponent(add)}`);
    act(() => host.querySelector<HTMLAnchorElement>('[data-part="change-wallet"]')!.click());
    await settle();
    expect(posts.filter((u) => u.includes('/v1/logout'))).toHaveLength(1);
    expect(where(host)).toBe(`/login?returnTo=${encodeURIComponent(add)}`);
    // The same target Start trading uses when there is no usable wallet.
    expect(startTradingPath({ registered: true, usable: false, returnTo: '/sell' }).to).toBe(where(host));
  });

  it('leavePath: the one way out for Start trading and the links', () => {
    expect(leavePath({ registered: true, target: '/wallets' })).toEqual({ logOut: true, to: '/login?returnTo=%2Fwallets' });
    expect(leavePath({ registered: false, target: '/wallets' })).toEqual({ logOut: false, to: '/wallets' });
  });
});
