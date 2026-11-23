// @vitest-environment happy-dom
// Owner demo notes 12 Nov #32 and 16 Nov #96 (/setup/wallet: the wallet names are a recommendation
// list, not buttons, then one address field; the Edge tip names Edge's real setting) and 16 Nov #97
// (/setup/welcome: the security rating, the "Username and password" line, a link back to each
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
import { RATING_WORDS, WELCOME_COPY, WELCOME_LINKS, Welcome, leavePath, securityRating, startTradingPath } from '../src/screens/setup/Welcome.js';
import { render } from './render.js';

const me = vi.hoisted(() => ({ current: { displayName: 'Lumen.K', methods: ['password'] } as Record<string, unknown> }));
vi.mock('../src/session/useSession.js', () => ({
  useSession: () => ({ status: 'signed-in', me: me.current }),
  refreshSession: () => undefined,
  displayNameOf: (m: { displayName?: string } | null) => m?.displayName ?? '',
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
    act(() => type(host.querySelector<HTMLInputElement>('#xmr-payout')!, `4${'9'.repeat(93)}`));
    act(() => host.querySelector<HTMLButtonElement>('[data-part="wallet-finish"]')!.click());
    await settle();
    expect(host.querySelector('[data-part="wallet-error"]')!.textContent).toBe("That doesn't look like a Monero address. Copy the whole receive address from your wallet.");
    expect(calls.filter((u) => u.includes('/v1/wallets'))).toEqual([]);
    expect(api.go).not.toHaveBeenCalled();
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

describe('securityRating (owner #97)', () => {
  it('uses the API rating when it sends one', () => {
    expect(securityRating({ methods: ['password'], securityRating: 'high' }, fresh)).toBe('high');
    expect(securityRating({ methods: ['pgp'], securityRating: 'weak' }, fresh)).toBe('weak');
  });

  it("otherwise applies the API's three rules (apps/api/src/auth/rating.ts on main) to the methods", () => {
    expect(securityRating({ methods: ['pgp'] }, fresh)).toBe('high');
    expect(securityRating({ methods: ['passkey', 'password'] }, fresh)).toBe('high');
    expect(securityRating({ methods: ['security-key'] }, fresh)).toBe('high');
    expect(securityRating({ methods: ['password', 'totp'] }, fresh)).toBe('medium');
    expect(securityRating({ methods: ['totp'] }, fresh)).toBe('weak');
    expect(securityRating({ methods: ['password'] }, fresh)).toBe('weak');
    expect(securityRating({ methods: ['password', 'recovery-codes'] }, fresh)).toBe('weak');
    expect(securityRating({ methods: [] }, fresh)).toBe('weak');
  });

  it('counts what this setup just did before the account is read again', () => {
    expect(securityRating({ methods: [] }, { registered: true, method: 'password', backup: 'security-key' })).toBe('high');
    expect(securityRating({ methods: [] }, { registered: true, method: 'password', backup: 'recovery-codes' })).toBe('weak');
  });
});

describe('/setup/welcome (owner #97)', () => {
  const walletList = (over: Partial<WalletEntry> = {}): WalletEntry[] => [
    { id: 'w', app: 'other', label: 'Wallet 1', address: ADDRESS, addressEnd: 'k3Fz', usableFrom: '2026-10-25T00:00:00.000Z', usable: true, ...over },
  ];

  let posts: string[] = [];
  async function showWelcome(methods: string[], wallets: WalletEntry[], state: Partial<SetupState> = {}) {
    me.current = { displayName: 'Lumen.K', methods };
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

  it('a password-only account: rated Weak, the way to raise it, and "Username and password" in the list', async () => {
    const host = await showWelcome(['password', 'recovery-codes'], walletList());
    const rating = host.querySelector('[data-part="security-rating"]')!;
    expect(rating.getAttribute('data-rating')).toBe('weak');
    expect(rating.textContent).toContain(`${WELCOME_COPY.ratingTitle}: ${RATING_WORDS.weak}`);
    expect(rating.textContent).toContain(WELCOME_COPY.ratingRaise);
    expect(host.querySelector('[data-part="rating-link"]')!.getAttribute('href')).toBe('/settings/security');
    expect([...host.querySelectorAll('[data-part="login-methods"] li')].map((li) => li.textContent)).toEqual(['Username and password']);
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

  describe('owner #167: the rating line is big and its word is coloured by level', () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/screens/setup/setup.css'), 'utf8');
    const ruleFor = (sel: string) => {
      const i = css.indexOf(`${sel} {`);
      expect(i, sel).toBeGreaterThanOrEqual(0);
      return css.slice(i, css.indexOf('}', i));
    };
    it('the line uses the screen-title size, the biggest type after the heading', () => {
      expect(ruleFor('.x2f-welcome__rating-line')).toMatch(/font-size:\s*var\(--x2f-screen-title-size\)/);
    });
    for (const [level, methods, word, token] of [
      ['high', ['pgp', 'recovery-codes'], 'Highly secure', '--x2f-good'],
      ['medium', ['password', 'totp', 'recovery-codes'], RATING_WORDS.medium, '--x2f-caution'],
      ['weak', ['password', 'recovery-codes'], RATING_WORDS.weak, '--x2f-danger'],
    ] as const) {
      it(`${level}: "${word}" in var(${token}), never the button's Monero orange`, async () => {
        const host = await showWelcome([...methods], walletList());
        const section = host.querySelector('[data-part="security-rating"]')!;
        expect(section.getAttribute('data-rating')).toBe(level);
        expect(section.querySelector('[data-part="rating-word"]')!.textContent).toBe(word);
        const rule = ruleFor(`.x2f-welcome__rating[data-rating='${level}'] [data-part='rating-word']`);
        expect(rule).toContain(`color: var(${token})`);
        expect(rule).not.toContain('monero');
      });
    }
  });

  it('a PGP account is Highly secure, with no raise line, and still lists the username', async () => {
    const host = await showWelcome(['pgp', 'recovery-codes'], walletList());
    expect(host.querySelector('[data-part="rating-word"]')!.textContent).toBe('Highly secure');
    expect(host.querySelector('[data-part="rating-link"]')).toBeNull();
    expect([...host.querySelectorAll('[data-part="login-methods"] li')].map((li) => li.textContent)).toEqual(['PGP key', 'Username']);
  });

  it('each item links back to its setting: Change once done, Add before', async () => {
    let host = await showWelcome(['password', 'totp', 'recovery-codes'], walletList());
    expect(host.querySelector('[data-part="rating-word"]')!.textContent).toBe('Medium');
    for (const [part, href] of [
      ['change-login', WELCOME_LINKS.login],
      ['change-recovery', WELCOME_LINKS.recovery],
      ['change-wallet', WELCOME_LINKS.wallet],
    ] as const) {
      const a = host.querySelector(`[data-part="${part}"]`)!;
      expect(a.getAttribute('href'), part).toBe(href);
      expect(a.textContent, part).toBe('Change');
    }
    // A wallet saved by setup as Other goes by its own name.
    expect(host.querySelector('[data-part="summary-wallet"]')!.textContent).toBe('Wallet 1 …k3Fz');

    host = await showWelcome(['pgp'], walletList({ usable: false }));
    expect(host.querySelector('[data-part="change-recovery"]')!.textContent).toBe('Add');
    // Add a wallet keeps the returnTo that started setup.
    const w = host.querySelector('[data-part="change-wallet"]')!;
    expect(w.getAttribute('href')).toBe('/wallets?add=1&returnTo=%2Fsell');
    expect(w.textContent).toBe('Add');
  });

  it('someone already logged in (setup opened only for a wallet) follows a link straight there, still logged in', async () => {
    const host = await showWelcome(['password'], walletList(), { registered: false });
    act(() => host.querySelector<HTMLAnchorElement>('[data-part="change-login"]')!.click());
    await settle();
    expect(where(host)).toBe('/settings/security');
    expect(posts.filter((u) => u.includes('/v1/logout'))).toEqual([]);
  });

  it('right after sign-up a link leaves the way Start trading does (owner G25): log out, Log in, then the setting', async () => {
    const host = await showWelcome(['password'], walletList(), { registered: true, method: 'password', backup: 'recovery-codes' });
    for (const [part, target] of [
      ['rating-link', WELCOME_LINKS.rating],
      ['change-login', WELCOME_LINKS.login],
      ['change-recovery', WELCOME_LINKS.recovery],
      ['change-wallet', WELCOME_LINKS.wallet],
    ] as const) {
      expect(host.querySelector(`[data-part="${part}"]`)!.getAttribute('href'), part).toBe(`/login?returnTo=${encodeURIComponent(target)}`);
    }
    act(() => host.querySelector<HTMLAnchorElement>('[data-part="change-login"]')!.click());
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
