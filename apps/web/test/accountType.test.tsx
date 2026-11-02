// @vitest-environment happy-dom
// Owner 2 Nov 2026: Settings > Account type (Trader and Vendor), Post offer for traders, and the
// confirm sheet for become-vendor (no password), against a stubbed API.
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmSheet } from '../src/screens/auth/ConfirmSheet.js';
import { PostOffer } from '../src/screens/PostOffer.js';
import { AccountType, hasVendorKey } from '../src/screens/settings/AccountType.js';
import { accountTypeOf, mayPostOffers } from '../src/session/member.js';
import { refreshSession, type Session } from '../src/session/useSession.js';
import { fire, render } from './render.js';

interface Call {
  url: string;
  method: string;
  body: unknown;
}

let calls: Call[];
let me: Record<string, unknown>;
let typeReply: { status: number; body: unknown };

function json(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  calls = [];
  me = { kind: 'trader', level: 'full', displayName: 'Calcium', methods: ['pgp', 'password'], accountType: 'trader', member: null, termsCurrent: true };
  typeReply = { status: 403, body: { error: 'confirm-required', action: 'become-vendor' } };
  refreshSession();
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url: input, method, body });
    if (input === '/v1/account/me') return json(200, me);
    if (input === '/v1/account/type') return json(typeReply.status, typeReply.body);
    return json(500, { error: 'internal' });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });

const byPart = (host: ParentNode, part: string) => host.querySelector(`[data-part="${part}"]`);
const click = (el: Element | null) => fire(el!, new MouseEvent('click', { bubbles: true }));

const signedIn = (m: Record<string, unknown>): Session => ({ status: 'signed-in', me: m as never });

describe('session helpers', () => {
  it('a trader may not post offers (no Post offer tab); a vendor may; an older API that sends no type is left to the server', () => {
    expect(accountTypeOf(signedIn({ accountType: 'trader' }))).toBe('trader');
    expect(mayPostOffers(signedIn({ accountType: 'trader', member: null }))).toBe(false);
    expect(mayPostOffers(signedIn({ accountType: 'vendor', member: null }))).toBe(true);
    expect(mayPostOffers(signedIn({ member: null }))).toBe(true);
    // A member of a trader account may not either, whatever their roles.
    expect(mayPostOffers(signedIn({ accountType: 'trader', member: { name: 'A', roles: ['offers'] } }))).toBe(false);
    expect(mayPostOffers({ status: 'signed-out' })).toBe(true);
  });

  it('the vendor requirement: a passkey, security key or PGP key', () => {
    expect(hasVendorKey({ methods: ['password', 'totp'] })).toBe(false);
    expect(hasVendorKey({ methods: ['password', 'pgp'] })).toBe(true);
    expect(hasVendorKey({ methods: ['passkey'] })).toBe(true);
    expect(hasVendorKey({ methods: ['security-key'] })).toBe(true);
  });
});

describe('Settings > Account type', () => {
  it('a trader with a PGP key: Trader is current, the requirement is met, Switch asks first, then confirm-it\'s-you without a password', async () => {
    const { host } = render(<MemoryRouter><AccountType /></MemoryRouter>);
    await settle();
    expect(byPart(host, 'type-name')?.textContent).toBe('Trader');
    expect(byPart(host, 'key-req')?.getAttribute('data-met')).toBe('true');
    expect(byPart(host, 'add-key')).toBeNull();
    click(byPart(host, 'switch'));
    await settle();
    expect(byPart(document, 'switch-sheet')?.textContent).toContain('You pay the 1% fee on completed trades.');
    click(byPart(document, 'switch-confirm'));
    await settle();
    expect(calls.find((c) => c.url === '/v1/account/type')).toEqual({ url: '/v1/account/type', method: 'PUT', body: { type: 'vendor' } });
    // The confirm sheet: the PGP key, never the password, for become-vendor.
    expect(document.querySelector('[data-method="pgp"]')).not.toBeNull();
    expect(document.querySelector('[data-method="password"]')).toBeNull();
    expect(byPart(document, 'action')?.textContent).toContain('switch to a vendor account');
  });

  it('without a passkey, security key or PGP key: Not met, the way to add one, and Switch opens CantDoThat', async () => {
    me = { ...me, methods: ['password', 'totp'] };
    const { host } = render(<MemoryRouter><AccountType /></MemoryRouter>);
    await settle();
    expect(byPart(host, 'key-req')?.getAttribute('data-met')).toBe('false');
    expect(byPart(host, 'add-key')?.getAttribute('href')).toBe('/settings/security');
    click(byPart(host, 'switch'));
    await settle();
    expect(byPart(document, 'cant-do-that')?.getAttribute('data-from')).toBe('vendor-needs-key');
    expect(calls.some((c) => c.url === '/v1/account/type')).toBe(false);
  });

  it('the API refusing (vendor-needs-key) goes through CantDoThat too', async () => {
    typeReply = { status: 403, body: { error: 'vendor-needs-key' } };
    const { host } = render(<MemoryRouter><AccountType /></MemoryRouter>);
    await settle();
    click(byPart(host, 'switch'));
    await settle();
    click(byPart(document, 'switch-confirm'));
    await settle();
    expect(byPart(document, 'cant-do-that')?.getAttribute('data-from')).toBe('vendor-needs-key');
  });

  it('a vendor: Vendor is current, Post an offer is the one primary, no switch', async () => {
    me = { ...me, accountType: 'vendor' };
    const { host } = render(<MemoryRouter><AccountType /></MemoryRouter>);
    await settle();
    expect(byPart(host, 'type-name')?.textContent).toBe('Vendor');
    expect(byPart(host, 'switch')).toBeNull();
    expect(byPart(host, 'post')?.getAttribute('href')).toBe('/post');
    expect(host.querySelectorAll('[data-primary]').length).toBe(1);
  });
});

describe('Post offer for a trader', () => {
  it('shows the not-vendor refusal and the way to Account type instead of the form', async () => {
    const { host } = render(<MemoryRouter><PostOffer /></MemoryRouter>);
    await settle();
    expect(host.querySelector('[data-screen="post-not-vendor"]')).not.toBeNull();
    expect(byPart(document, 'cant-do-that')?.getAttribute('data-from')).toBe('not-vendor');
    expect(byPart(host, 'account-type')?.getAttribute('href')).toBe('/settings/account-type');
  });
});

describe('ConfirmSheet', () => {
  it('offers the password for other actions but not for become-vendor', () => {
    const a = render(<ConfirmSheet action={{ kind: 'set-login-name' }} methods={['password', 'pgp']} onToken={() => {}} onCancel={() => {}} />);
    expect(a.host.ownerDocument.querySelector('[data-method="password"]')).not.toBeNull();
    a.unmount();
    render(<ConfirmSheet action={{ kind: 'become-vendor' }} methods={['password', 'pgp']} onToken={() => {}} onCancel={() => {}} />);
    expect(document.querySelector('[data-method="password"]')).toBeNull();
    expect(document.querySelector('[data-method="pgp"]')).not.toBeNull();
  });
});
