// @vitest-environment happy-dom
// My security (apps/api/src/staff/account.ts, perm self): every role's own login methods, sessions
// and alerts. Removing a method taps `remove-method` bound to its listed id (the owner taps both
// owner keys, owner G4); adding a PGP key taps `add-pgp-key` bound to the fingerprint the start
// names and the page shows; logging out another session is asked first and needs no tap; an alert
// is marked seen only when the person says so.
import { NAV, hasIssuedAt, stampIssuedAt, tapChallenge, type KeyTapIntent } from '@x2f/staff';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import { button, click, fakeApi, field, refused, render, settle, typeInto } from './helpers.js';

const webauthn = vi.hoisted(() => ({ startAuthentication: vi.fn(), startRegistration: vi.fn() }));
vi.mock('@simplewebauthn/browser', () => webauthn);

const H = 3_600_000;
const ends = () => new Date(Date.now() + H).toISOString();
const MOD = { displayName: 'dmitri_k', role: 'mod', nav: NAV.mod, sessionEndsAt: ends() };
const HELPER = { displayName: 'tobi.w', role: 'helper', nav: NAV.helper, sessionEndsAt: ends() };
const OWNER = { displayName: 'lumen.k', role: 'owner', nav: NAV.owner, sessionEndsAt: ends() };

const PGP_ID = '11111111-1111-4111-8111-111111111111';
const KEY_ID = '22222222-2222-4222-8222-222222222222';
const METHODS = [
  { type: 'pgp', id: PGP_ID, label: 'PGP key …ABCD 1234', createdAt: '2026-10-02T09:00:00.000Z', lastUsedAt: null },
  { type: 'security-key', id: KEY_ID, label: 'YubiKey 5', createdAt: '2026-10-02T09:05:00.000Z', lastUsedAt: new Date(Date.now() - 2 * H - 60_000).toISOString() },
];
const SESSIONS = [
  { id: 'aaaaaaaa-0000-4000-8000-000000000001', deviceLabel: 'Firefox on Linux', site: 'staff', createdAt: '2026-11-26T08:00:00.000Z', lastSeenAt: new Date().toISOString(), current: true },
  { id: 'aaaaaaaa-0000-4000-8000-000000000002', deviceLabel: 'Safari on macOS', site: 'staff', createdAt: '2026-11-25T08:00:00.000Z', lastSeenAt: new Date(Date.now() - 3 * H).toISOString(), current: false },
  { id: 'aaaaaaaa-0000-4000-8000-000000000003', deviceLabel: 'Chrome on Android', site: 'trader', createdAt: '2026-11-24T08:00:00.000Z', lastSeenAt: new Date(Date.now() - 30 * H).toISOString(), current: false },
];
const ALERTS = [
  { id: 'b1', kind: 'new-login', detail: { method: 'security-key', deviceLabel: 'Safari on macOS' }, createdAt: '2026-11-25T08:00:00.000Z', seenAt: null },
  { id: 'b2', kind: 'login-method-added', detail: { method: 'pgp' }, createdAt: '2026-10-02T09:00:00.000Z', seenAt: '2026-10-02T10:00:00.000Z' },
];
const FP = 'a'.repeat(40);

/** taps/start answers honestly with a new tap id each time; finish echoes it (so two taps are told apart). */
function tapRoutes() {
  let n = 0;
  return {
    'POST /staff/v1/taps/start': (body: unknown) => {
      n += 1;
      const intent = body as KeyTapIntent;
      const nonce = new Uint8Array(16).map(() => Math.floor(Math.random() * 256));
      const at = new Date();
      const challenge = Buffer.from(tapChallenge(stampIssuedAt(intent, at), nonce)).toString('base64url');
      return { body: { tapId: `tap-${n}`, options: { challenge }, nonce: Buffer.from(nonce).toString('hex'), issuedAt: hasIssuedAt(intent.kind) ? at.toISOString() : null } };
    },
    'POST /staff/v1/taps/:id/finish': (_b: unknown, path: string) => ({ body: { tapId: path.split('/')[4] } }),
  };
}

function api(me: object, extra: Record<string, Parameters<typeof fakeApi>[0][string]> = {}) {
  return fakeApi({
    'GET /staff/v1/me': { body: me },
    'GET /staff/v1/account/methods': { body: METHODS },
    'GET /staff/v1/account/sessions': { body: SESSIONS },
    'GET /staff/v1/account/alerts': { body: ALERTS },
    'GET /staff/v1/owner/alerts': { body: { items: [], unread: 0, next: null } },
    ...tapRoutes(),
    'DELETE /staff/v1/account/methods/:type/:id': { status: 204 },
    'DELETE /staff/v1/account/sessions/:id': { status: 204 },
    'POST /staff/v1/account/alerts/:id/seen': { status: 204 },
    'POST /staff/v1/account/pgp/start': { body: { challengeId: 'ch-1', encryptedMessage: '-----BEGIN PGP MESSAGE-----\nx\n-----END PGP MESSAGE-----', expiresAt: ends(), fingerprint: FP } },
    'POST /staff/v1/account/pgp/finish': { body: { fingerprint: FP } },
    ...extra,
  });
}

async function open(path = '/security') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  await settle();
}

const page = () => document.querySelector('[data-screen="my-security"]')!;
const tapIntents = (calls: { path: string; body: unknown }[]) => calls.filter((c) => c.path === '/staff/v1/taps/start').map((c) => c.body);
const ariaButton = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

beforeEach(() => {
  webauthn.startAuthentication.mockReset().mockResolvedValue({ id: 'cred', response: {} });
});

describe('My security in the shell', () => {
  it('every role has the My security link under the nav, a helper too, and it opens the page', async () => {
    for (const me of [MOD, HELPER, OWNER]) {
      api(me);
      await open('/');
      const link = document.querySelector<HTMLAnchorElement>('nav[aria-label="Your account"] a[data-part="my-security"]');
      expect(link?.textContent, me.role).toBe('My security');
      expect(link?.getAttribute('href')).toBe('/security');
      document.body.innerHTML = '';
    }
    api(HELPER);
    await open();
    expect(page().querySelector('h1')?.textContent).toBe('My security');
    expect(document.querySelector('nav[aria-label="Your account"] a')?.getAttribute('aria-current')).toBe('page');
  });
});

describe('Login methods', () => {
  it('lists each method; PGP keys, security keys and passkeys have Remove', async () => {
    api(MOD);
    await open();
    const items = [...page().querySelectorAll('[data-part="method"]')];
    expect(items.map((li) => li.getAttribute('data-method'))).toEqual(['pgp', 'security-key']);
    expect(items[0]!.textContent).toContain('Added 2026-10-02 09:00 UTC');
    expect(items[0]!.textContent).toContain('Not used to log in yet');
    expect(items[1]!.textContent).toContain('Last used 2 h ago');
    expect(ariaButton('Remove PGP key PGP key …ABCD 1234')).not.toBeNull();
    expect(ariaButton('Remove Security key YubiKey 5')).not.toBeNull();
    expect(page().querySelectorAll('[data-primary]')).toHaveLength(1);
  });

  it('a moderator removes a key with one tap bound to it', async () => {
    const c = api(MOD);
    await open();
    await click(ariaButton('Remove Security key YubiKey 5'));
    expect(c.calls.some((x) => x.method === 'DELETE')).toBe(false);
    await click(button('Tap security key'));
    expect(tapIntents(c.calls)).toEqual([{ kind: 'remove-method', methodType: 'security-key', methodId: KEY_ID }]);
    const del = c.calls.find((x) => x.method === 'DELETE')!;
    expect([del.path, del.body]).toEqual([`/staff/v1/account/methods/security-key/${KEY_ID}`, { tapId: 'tap-1' }]);
    expect(document.querySelector('[data-part="security-note"]')?.textContent).toBe('Removed. Your other sessions were logged out.');
  });

  it('the owner taps both owner keys for the same change', async () => {
    const c = api(OWNER);
    await open();
    await click(ariaButton('Remove PGP key PGP key …ABCD 1234'));
    await click(button('Tap security key'));
    expect(c.calls.some((x) => x.method === 'DELETE')).toBe(false);
    expect(document.body.textContent).toContain('Tap your other owner key');
    await click(button('Tap security key'));
    const intent = { kind: 'remove-method', methodType: 'pgp', methodId: PGP_ID };
    expect(tapIntents(c.calls)).toEqual([intent, intent]);
    expect(c.calls.find((x) => x.method === 'DELETE')!.body).toEqual({ tapId: 'tap-1', secondTapId: 'tap-2' });
  });

  it('a removal the login rule refuses shows the reason in CantDoThat', async () => {
    api(MOD, { 'DELETE /staff/v1/account/methods/:type/:id': refused(409, 'moderator-methods-required') });
    await open();
    await click(ariaButton('Remove PGP key PGP key …ABCD 1234'));
    await click(button('Tap security key'));
    expect(document.body.textContent).toContain('Moderators need a passkey and a PGP key.');
  });

  it('a cancelled tap removes nothing and shows no fault', async () => {
    const c = api(MOD);
    await open();
    await click(ariaButton('Remove Security key YubiKey 5'));
    await click(button('Cancel'));
    expect(c.calls.some((x) => x.method === 'DELETE')).toBe(false);
    expect(document.querySelector('[data-part="security-fault"]')).toBeNull();
  });

  it('adds a PGP key: the message, the fingerprint shown, the code, then the tap bound to that fingerprint', async () => {
    const c = api(MOD);
    await open();
    await click(button('Add a PGP key'));
    await click(button('Send message'));
    expect(document.querySelector('[data-part="add-pgp-fault"]')?.textContent).toContain('Paste your whole public key');
    typeInto(field('Your PGP public key'), '-----BEGIN PGP PUBLIC KEY BLOCK-----\nx\n-----END PGP PUBLIC KEY BLOCK-----');
    await click(button('Send message'));
    expect(document.querySelector('[data-part="add-pgp-fingerprint"]')?.textContent).toBe(FP.toUpperCase());
    await click(button('Tap key and add'));
    expect(document.querySelector('[data-part="add-pgp-fault"]')?.textContent).toBe('Paste the code from the decrypted message first.');
    typeInto(field('Code from the message'), ' 123456 ');
    await click(button('Tap key and add'));
    await click(button('Tap security key'));
    expect(tapIntents(c.calls)).toEqual([{ kind: 'add-pgp-key', fingerprint: FP }]);
    expect(c.calls.find((x) => x.path === '/staff/v1/account/pgp/finish')!.body).toEqual({ challengeId: 'ch-1', code: '123456', tapId: 'tap-1' });
    expect(document.querySelector('[data-part="security-note"]')?.textContent).toBe('PGP key added.');
    expect(document.querySelector('[data-part="add-pgp"]')).toBeNull();
  });
});

describe('Sessions', () => {
  it('marks this session; another is logged out only after asking, with no tap', async () => {
    const c = api(MOD);
    await open();
    const rows = [...page().querySelectorAll('[data-part="session"]')];
    expect(rows[0]!.textContent).toContain('This session');
    expect(rows[2]!.textContent).toContain('Trader site');
    await click(ariaButton('Log out Safari on macOS'));
    expect(c.calls.some((x) => x.method === 'DELETE')).toBe(false);
    expect(document.body.textContent).toContain('Log out Safari on macOS?');
    await click(button('Log out', document.querySelector('[data-part="end-session-ask"]')!));
    expect(c.calls.filter((x) => x.method === 'DELETE').map((x) => x.path)).toEqual(['/staff/v1/account/sessions/aaaaaaaa-0000-4000-8000-000000000002']);
    expect(tapIntents(c.calls)).toEqual([]);
  });

  it('"Log out all other sessions" ends every other one, never this one', async () => {
    const c = api(MOD);
    await open();
    await click(button('Log out all other sessions'));
    expect(document.body.textContent).toContain('Log out 2 other sessions?');
    await click(button('Log out', document.querySelector('[data-part="end-session-ask"]')!));
    expect(c.calls.filter((x) => x.method === 'DELETE').map((x) => x.path.split('/').at(-1))).toEqual(['aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000003']);
  });
});

describe('Alerts', () => {
  it('lists alerts in plain words; an unseen one is New until the person marks it seen', async () => {
    const c = api(MOD);
    await open();
    const items = [...page().querySelectorAll('[data-part="alert"]')];
    expect(items[0]!.textContent).toContain('New login');
    expect(items[0]!.textContent).toContain('Security key · On Safari on macOS');
    expect(items[0]!.querySelector('[data-part="alert-new"]')).not.toBeNull();
    expect(items[1]!.querySelector('[data-part="alert-new"]')).toBeNull();
    // Opening the page marks nothing.
    expect(c.calls.some((x) => x.path.endsWith('/seen'))).toBe(false);
    await click(ariaButton('Mark new login as seen'));
    expect(c.calls.filter((x) => x.path.endsWith('/seen')).map((x) => x.path)).toEqual(['/staff/v1/account/alerts/b1/seen']);
  });
});

// Coordinator follow-up 26 Nov 2026: a senior's lien alert names the work and links to the case.
describe('lien alerts on My security', () => {
  it('a lower share waiting for approval links to its case', async () => {
    const SENIOR = { ...MOD, role: 'senior', nav: NAV.senior };
    api(SENIOR, {
      'GET /staff/v1/account/alerts': {
        body: [{ id: 'al9', kind: 'lien-rate-requested', detail: { trade: 'AB12-CD34-EF56-GH78', lienId: 'l', requestId: 'r' }, createdAt: '2026-11-26T18:00:00.000Z', seenAt: null }],
      },
    });
    await open();
    expect(document.querySelector('[data-part="alerts"]')?.textContent).toContain('A lower share for a lien waits for your approval');
    expect(document.querySelector('[data-part="alert-case"]')?.getAttribute('href')).toBe('/disputes/AB12-CD34-EF56-GH78');
  });
});
