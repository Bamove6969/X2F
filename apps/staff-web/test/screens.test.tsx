// @vitest-environment happy-dom
// Plan 4 Task 16: staff login, invite acceptance, owner setup and the owner's Feedback page
// (Plan 5 Task 4's NEEDS_P4_STAFF_WEB_FEEDBACK_PAGE).
import { NAV, inviteRegistrationChallenge, inviteTokenHash, ownerSetupChallenge, staffLoginChallenge, stampIssuedAt, tapChallenge } from '@x2f/staff';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import { StaffApiError } from '../src/api.js';
import { STAFF_REFUSALS, refusalOf } from '../src/refusals.js';
import { canFinish, INVITE_GONE, keyCheckLine } from '../src/screens/Invite.js';
import { LOCKED_TITLE } from '../src/screens/OwnerSetup.js';
import { TERMS_TEXT_VERSION } from '../src/ui/kit.js';
import { button, cleanup, click, fakeApi, field, refused, render, settle, tick, typeInto } from './helpers.js';

const webauthn = vi.hoisted(() => ({ startAuthentication: vi.fn(), startRegistration: vi.fn() }));
vi.mock('@simplewebauthn/browser', () => webauthn);

const PGP_KEY = '-----BEGIN PGP PUBLIC KEY BLOCK-----\nabc\n-----END PGP PUBLIC KEY BLOCK-----';
const ME = { displayName: 'nightowl_44', role: 'mod', nav: NAV.mod, sessionEndsAt: new Date(Date.now() + 3600_000).toISOString() };

async function open(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  await settle();
}

const b64url = (b: Uint8Array) => Buffer.from(b).toString('base64url');
/** Re-verify X2: a server nonce, and what a lying server might send as the challenge instead (a tap's). */
const NONCE = 'ab'.repeat(32);
const TAP_LOOKALIKE = b64url(tapChallenge(stampIssuedAt({ kind: 'settings', largeTradeLimitUsd: 1_000_000, firstResponseH: 4, appealWindowH: 48 }, new Date()), new Uint8Array(16).fill(1)));
const LOGIN_CHALLENGE = b64url(staffLoginChallenge(NONCE));

const screen = () => document.querySelector('[data-screen]')?.getAttribute('data-screen');
const cantDo = () => document.querySelector('[data-part="cant-do-that"]')?.getAttribute('data-from') ?? null;

beforeEach(() => {
  webauthn.startAuthentication.mockReset().mockResolvedValue({ id: 'cred', response: {} });
  webauthn.startRegistration.mockReset().mockResolvedValue({ id: 'new', response: {} });
});

describe('Login', () => {
  it('offers a security key or PGP', async () => {
    fakeApi({});
    await open('/login');
    const labels = [...document.querySelectorAll('[role="radiogroup"] label')].map((l) => l.textContent);
    expect(labels).toEqual(['Security key', 'PGP key']);
    expect(document.querySelectorAll('[data-primary]')).toHaveLength(1);
  });

  it('security key first, then the PGP key the API asks for, bound to its pendingId, then the shell', async () => {
    const api = fakeApi({
      'POST /staff/v1/login/security-key/start': { body: { challengeId: 'c1', options: { challenge: TAP_LOOKALIKE }, loginNonce: NONCE } },
      'POST /staff/v1/login/security-key/finish': { body: { status: 'second-factor', pendingId: 'p1', needs: ['pgp'] } },
      'POST /staff/v1/login/pgp/start': { body: { challengeId: 'c2', encryptedMessage: '-----BEGIN PGP MESSAGE-----', expiresAt: new Date().toISOString() } },
      'POST /staff/v1/login/pgp/finish': { body: { status: 'ok' } },
      'GET /staff/v1/me': { body: ME },
    });
    await open('/login');
    typeInto(field('Login name'), 'nightowl');
    await click(button('Tap security key'));
    expect(api.calls[0]!.body).toEqual({ loginName: 'nightowl' });
    // Re-verify X2: the key signs the staff site's own login challenge, whatever the server sent.
    expect(webauthn.startAuthentication).toHaveBeenCalledWith({ optionsJSON: { challenge: LOGIN_CHALLENGE } });
    expect(api.calls[1]!.body).toMatchObject({ challengeId: 'c1', response: { id: 'cred', response: {} } });
    expect(typeof (api.calls[1]!.body as { deviceLabel: unknown }).deviceLabel).toBe('string');
    // The second step: only PGP is asked for, so there is no choice to make.
    expect(document.querySelector('h1')?.textContent).toBe('Now your second key');
    expect(document.querySelector('[role="radiogroup"]')).toBeNull();
    typeInto(field('Your PGP public key'), PGP_KEY);
    await click(button('Send message'));
    expect(api.calls[2]!.body).toEqual({ key: PGP_KEY, pendingId: 'p1' });
    typeInto(field('Code from the message'), ' 1234-5678 ');
    await click(button('Log in'));
    expect(api.calls[3]!.body).toMatchObject({ challengeId: 'c2', code: '1234-5678' });
    expect(document.querySelector('nav[aria-label="Staff"]')).not.toBeNull();
  });

  it('PGP first, then a security key with the pendingId on both start and finish', async () => {
    const api = fakeApi({
      'POST /staff/v1/login/pgp/start': { body: { challengeId: 'c1', encryptedMessage: 'msg', expiresAt: new Date().toISOString() } },
      'POST /staff/v1/login/pgp/finish': { body: { status: 'second-factor', pendingId: 'p9', needs: ['security-key'] } },
      'POST /staff/v1/login/security-key/start': { body: { challengeId: 'c2', options: { challenge: 'y' }, loginNonce: NONCE } },
      'POST /staff/v1/login/security-key/finish': { body: { status: 'ok' } },
      'GET /staff/v1/me': { body: ME },
    });
    await open('/login');
    await click(document.querySelector('input[type="radio"][value="pgp"]'));
    typeInto(field('Your PGP public key'), PGP_KEY);
    await click(button('Send message'));
    typeInto(field('Code from the message'), '1234');
    await click(button('Log in'));
    expect(document.querySelector('[data-part="pgp-proof"]')).toBeNull();
    await click(button('Tap security key'));
    expect(api.calls[2]!.body).toEqual({ pendingId: 'p9' });
    expect(api.calls[3]!.body).toMatchObject({ challengeId: 'c2', pendingId: 'p9' });
    expect(document.querySelector('nav[aria-label="Staff"]')).not.toBeNull();
  });

  it('a switched-off account and a login outside the login hours are refusals (CantDoThat)', async () => {
    const api = fakeApi({
      'POST /staff/v1/login/security-key/start': { body: { challengeId: 'c1', options: {}, loginNonce: NONCE } },
      'POST /staff/v1/login/security-key/finish': refused(403, 'account-disabled'),
    });
    await open('/login');
    typeInto(field('Login name'), 'nightowl');
    await click(button('Tap security key'));
    expect(cantDo()).toBe('account-disabled');
    await click(button('OK'));
    api.set('POST /staff/v1/login/security-key/finish', refused(403, 'outside-login-hours'));
    await click(button('Tap security key'));
    expect(cantDo()).toBe('outside-login-hours');
  });

  it('a login start with no nonce of the staff site\'s format asks no key (re-verify X2)', async () => {
    for (const loginNonce of [undefined, 'AB'.repeat(32), 'ab']) {
      fakeApi({ 'POST /staff/v1/login/security-key/start': { body: { challengeId: 'c1', options: { challenge: TAP_LOOKALIKE }, ...(loginNonce !== undefined ? { loginNonce } : {}) } } });
      await open('/login');
      typeInto(field('Login name'), 'nightowl');
      await click(button('Tap security key'));
      expect(webauthn.startAuthentication, String(loginNonce)).not.toHaveBeenCalled();
      expect(document.querySelector('[data-part="login-fault"]')).not.toBeNull();
      cleanup();
    }
  });

  it('a failed key is a fault in a Notice, not a refusal', async () => {
    fakeApi({
      'POST /staff/v1/login/security-key/start': { body: { challengeId: 'c1', options: {}, loginNonce: NONCE } },
      'POST /staff/v1/login/security-key/finish': refused(401, 'webauthn-failed'),
    });
    await open('/login');
    typeInto(field('Login name'), 'nightowl');
    await click(button('Tap security key'));
    expect(cantDo()).toBeNull();
    expect(document.querySelector('[data-part="login-fault"]')?.textContent).toContain('That did not work');
  });

  it("review m1: a key refused only for its missing PIN shows the API's PIN sentence", async () => {
    const PIN = "Your key needs its PIN (or fingerprint) to log in. Set one in your key's settings, then try again.";
    fakeApi({
      'POST /staff/v1/login/security-key/start': { body: { challengeId: 'c1', options: {}, loginNonce: NONCE } },
      'POST /staff/v1/login/security-key/finish': refused(401, 'webauthn-failed', { detail: PIN }),
    });
    await open('/login');
    typeInto(field('Login name'), 'nightowl');
    await click(button('Tap security key'));
    expect(cantDo()).toBeNull();
    expect(document.querySelector('[data-part="login-fault"]')?.textContent).toContain(PIN);
  });
});

describe('Invite', () => {
  const view = { role: 'mod', hours: { days: ['Mon', 'Tue'], start: '09:00', end: '17:00', tz: 'UTC' }, expiresAt: new Date().toISOString(), resume: null };
  /** The Terms version the step checks its text against (inviteTerms.test.tsx has the step itself). */
  const TERMS_ROUTE = { 'GET /staff/v1/terms': { body: { version: TERMS_TEXT_VERSION } } };
  /** Owner 9 Nov 2026 (p11-14): the Terms come first; tick, sign with a typed name, Continue. */
  async function signTerms(name = 'Dmitri K') {
    await tick(document.querySelector('[data-part="terms-tick"]'));
    await click(document.querySelector('[data-part="signature-type"]'));
    typeInto(document.querySelector('[data-part="signature-name"]'), name);
    await settle();
    await click(document.querySelector('[data-part="terms-accept"]'));
  }

  it('a return visit carries on at the keys, counting what was added on the earlier visit', async () => {
    const api = fakeApi({
      'GET /staff/v1/invites/accept/:token': { body: { ...view, resume: { keys: 1, passkeys: 1, pgp: 1, keyCheckCode: 'AB12-CD34-EF56-GH78' } } },
      'POST /staff/v1/invites/accept/:token/finish': { status: 201, body: { keyCheckCode: 'AB12-CD34-EF56-GH78' } },
    });
    await open('/invite/tok_3');
    expect(button('Continue')).toBeUndefined();
    expect(button('Finish')!.disabled).toBe(false);
    await click(button('Finish')!);
    expect(api.calls.some((c) => c.path.endsWith('/account'))).toBe(false);
    expect(document.querySelector('[data-part="key-check"]')?.textContent).toBe('Your key check code: AB12-CD34-EF56-GH78. Read it to the owner.');
  });

  /** The key row named `name` (Security key, Passkey). */
  const row = (name: string) => [...document.querySelectorAll('.x2f-staff-key-row')].find((r) => r.querySelector('.x2f-staff-key-row__name')?.textContent === name)!;

  it('username, then all three of a security key, a PGP key and a passkey (owner G3), then finish shows the key check code', async () => {
    const api = fakeApi({
      ...TERMS_ROUTE,
      'GET /staff/v1/invites/accept/:token': { body: view },
      'POST /staff/v1/invites/accept/:token/account': { status: 201, body: { ok: true } },
      'POST /staff/v1/invites/accept/:token/key/start': { body: { options: { challenge: 'r' } } },
      'POST /staff/v1/invites/accept/:token/key/finish': { status: 201, body: { kind: 'security-key', keyCheckCode: 'AB12-CD34-EF56-GH78' } },
      'POST /staff/v1/invites/accept/:token/pgp/start': { body: { challengeId: 'c1', encryptedMessage: 'msg', expiresAt: new Date().toISOString() } },
      'POST /staff/v1/invites/accept/:token/pgp/finish': { status: 201, body: { ok: true } },
      'POST /staff/v1/invites/accept/:token/finish': { status: 201, body: { keyCheckCode: 'AB12-CD34-EF56-GH78' } },
    });
    await open('/invite/tok_1');
    expect(document.querySelector('[data-part="invite-role"]')?.textContent).toBe("You're invited as Moderator. You can log in Mon, Tue, 09:00 to 17:00 (UTC).");
    await signTerms();
    typeInto(field('Username'), 'dmitri_k');
    typeInto(field('Login name'), 'dk-login');
    await click(button('Continue'));
    // Owner Q54: the public name goes as displayName (the API refuses a field named username).
    // Owner 9 Nov 2026 (p11-14): the Terms version and the signature go with the names.
    expect(api.calls.find((c) => c.path.endsWith('/account'))?.body).toEqual({
      displayName: 'dmitri_k', loginName: 'dk-login', acceptedTerms: TERMS_TEXT_VERSION, termsSignature: { kind: 'typed', name: 'Dmitri K' },
    });
    // D-070 (owner p11-19, changing G3): a moderator holds a passkey and a PGP key; the security key
    // is optional, so the passkey row is shown and finish waits for the passkey and the PGP key.
    expect(document.body.textContent).toContain('Moderators log in with a passkey and a PGP key. A hardware security key, such as a YubiKey, is optional.');
    expect(row('Passkey')).toBeDefined();
    const finish = () => button('Finish')!;
    expect(finish().disabled).toBe(true);
    await click(button('Tap key to register', row('Security key')));
    expect(api.calls.find((c) => c.path.endsWith('/key/start'))?.body).toEqual({ kind: 'security-key' });
    // Re-verify X2: the invite key's challenge is derived here, from the token in the link.
    expect(webauthn.startRegistration).toHaveBeenCalledWith({ optionsJSON: { challenge: b64url(inviteRegistrationChallenge(inviteTokenHash('tok_1'))) } });
    expect(finish().disabled).toBe(true);
    await click(button('Add PGP key'));
    typeInto(field('Your PGP public key'), PGP_KEY);
    await click(button('Send message'));
    expect(api.calls.find((c) => c.path.endsWith('/pgp/start'))?.body).toEqual({ publicKey: PGP_KEY });
    typeInto(field('Code from the message'), '9999');
    await click(button('Check code'));
    // A security key and a PGP key are two factors, but a moderator also needs the passkey (D-070).
    expect(finish().disabled).toBe(true);
    await click(button('Tap key to register', row('Passkey')));
    expect(api.calls.filter((c) => c.path.endsWith('/key/start')).map((c) => c.body)).toEqual([{ kind: 'security-key' }, { kind: 'passkey' }]);
    expect(finish().disabled).toBe(false);
    await click(finish());
    expect(document.querySelector('h1')?.textContent).toBe("You're on the staff");
    expect(document.querySelector('[data-part="key-check"]')?.textContent).toBe('Your key check code: AB12-CD34-EF56-GH78. Read it to the owner.');
    expect(keyCheckLine('X')).toBe('Your key check code: X. Read it to the owner.');
  });

  it('an invite link opened twice: the second visit shows "This invite has already been used or has expired."', async () => {
    let used = false;
    fakeApi({
      ...TERMS_ROUTE,
      'GET /staff/v1/invites/accept/:token': () => (used ? refused(404, 'invite-invalid') : { body: { ...view, role: 'helper', hours: 'any' } }),
    });
    await open('/invite/tok_2');
    expect(document.querySelector('[data-part="invite-role"]')?.textContent).toBe("You're invited as Helper. You can log in at any time.");
    used = true;
    await open('/invite/tok_2');
    expect(document.querySelector('[data-part="invite-gone"]')?.textContent).toBe(INVITE_GONE);
    expect(INVITE_GONE).toBe('This invite has already been used or has expired.');
  });

  it('every role sees the passkey row; a helper may finish with two factors', async () => {
    fakeApi({ 'GET /staff/v1/invites/accept/:token': { body: { ...view, role: 'helper', resume: { keys: 0, passkeys: 0, pgp: 0, keyCheckCode: null } } } });
    await open('/invite/tok_4');
    expect(row('Passkey')).toBeDefined();
    expect(document.body.textContent).toContain('Staff log in with two keys');
  });

  it('a refused finish or passkey is a CantDoThat with the staff words (owner-page3 codes)', async () => {
    const api = fakeApi({
      'GET /staff/v1/invites/accept/:token': { body: { ...view, resume: { keys: 1, passkeys: 1, pgp: 1, keyCheckCode: 'AB12-CD34-EF56-GH78' } } },
      'POST /staff/v1/invites/accept/:token/finish': refused(409, 'all-three-methods-required'),
      'POST /staff/v1/invites/accept/:token/key/start': { body: { options: { challenge: 'r' } } },
      'POST /staff/v1/invites/accept/:token/key/finish': refused(409, 'passkey-is-security-key'),
    });
    await open('/invite/tok_5');
    await click(button('Finish')!);
    expect(cantDo()).toBe('all-three-methods-required');
    await click(button('OK')!);
    await click(button('Tap key to register', row('Passkey'))!);
    expect(cantDo()).toBe('passkey-is-security-key');
    expect(api.calls.some((c) => c.path.endsWith('/key/finish'))).toBe(true);
    for (const code of ['all-three-methods-required', 'moderator-methods-required', 'passkey-is-security-key', 'both-owner-keys-required'] as const) {
      expect(refusalOf(new StaffApiError(409, code)), code).toEqual({ code, text: STAFF_REFUSALS[code] });
    }
  });

  it('finish follows the API: a moderator or senior needs a passkey and a PGP key, a security key optional (D-070); everyone needs two factors', () => {
    expect(canFinish('mod', { keys: 0, passkeys: 0, pgp: 2 })).toBe(false);
    expect(canFinish('mod', { keys: 0, passkeys: 1, pgp: 2 })).toBe(true);
    expect(canFinish('senior', { keys: 0, passkeys: 1, pgp: 1 })).toBe(true);
    expect(canFinish('mod', { keys: 0, passkeys: 1, pgp: 0 })).toBe(false);
    expect(canFinish('senior', { keys: 1, passkeys: 0, pgp: 0 })).toBe(false);
    expect(canFinish('senior', { keys: 1, passkeys: 0, pgp: 1 })).toBe(false);
    expect(canFinish('senior', { keys: 1, passkeys: 0, pgp: 2 })).toBe(false);
    expect(canFinish('senior', { keys: 1, passkeys: 1, pgp: 0 })).toBe(false);
    expect(canFinish('senior', { keys: 1, passkeys: 1, pgp: 1 })).toBe(true);
    expect(canFinish('mod', { keys: 2, passkeys: 1, pgp: 1 })).toBe(true);
    expect(canFinish('helper', { keys: 0, passkeys: 0, pgp: 2 })).toBe(true);
    expect(canFinish('helper', { keys: 0, passkeys: 1, pgp: 1 })).toBe(true);
    expect(canFinish('helper', { keys: 0, passkeys: 2, pgp: 0 })).toBe(false);
  });
});

describe('OwnerSetup', () => {
  function setupApi(overrides: Record<string, Parameters<typeof fakeApi>[0][string]> = {}) {
    return fakeApi({
      'POST /staff/v1/setup/finish': refused(401, 'not-authenticated'),
      'POST /staff/v1/setup/code': { body: { ok: true, expiresAt: new Date().toISOString() } },
      'POST /staff/v1/setup/account': { status: 201, body: { ok: true } },
      'POST /staff/v1/setup/key/start': { body: { challengeId: 'k', options: { challenge: 'z' }, setupNonce: NONCE } },
      'POST /staff/v1/setup/key/finish': { status: 201, body: { keys: 1 } },
      'POST /staff/v1/setup/pgp/start': { body: { challengeId: 'g', encryptedMessage: 'msg', expiresAt: new Date().toISOString() } },
      'POST /staff/v1/setup/pgp/finish': { status: 201, body: { fingerprint: 'F' } },
      ...overrides,
    });
  }

  it('has steps 1-4 and keeps "Create owner account" disabled until both keys (and the PGP key) are in, then locks', async () => {
    const api = setupApi();
    await open('/setup');
    expect(screen()).toBe('owner-setup');
    expect([...document.querySelectorAll('h2')].map((h) => h.textContent)).toEqual(['1. Setup code', '2. Your username', '3. Two security keys', '4. PGP key']);
    const create = () => button('Create owner account')!;
    expect(create().disabled).toBe(true);
    expect(create().hasAttribute('data-primary')).toBe(true);
    expect(document.querySelector('[data-part="setup-hint"]')?.textContent).toBe('Register both keys to continue.');
    typeInto(field('Setup code'), '7QX4-MP2D-91KA');
    await click(button('Check code'));
    expect(document.querySelector('[data-part="code-ok"]')?.textContent).toBe('Code accepted');
    typeInto(field('Username'), 'lumen.k');
    typeInto(field('Login name'), 'lumen-login');
    await click(button('Tap key to register'));
    expect(api.calls.find((c) => c.path.endsWith('/setup/account'))?.body).toEqual({ displayName: 'lumen.k', loginName: 'lumen-login' });
    expect(create().disabled).toBe(true);
    await click(button('Tap key to register'));
    expect(api.calls.filter((c) => c.path.endsWith('/setup/key/finish'))).toHaveLength(2);
    // Re-verify X2: the owner's key signs the staff site's own setup challenge, not the server's 'z'.
    expect(webauthn.startRegistration).toHaveBeenLastCalledWith({ optionsJSON: { challenge: b64url(ownerSetupChallenge(NONCE)) } });
    expect(api.calls.filter((c) => c.path.endsWith('/setup/account'))).toHaveLength(1);
    expect((field('Username') as HTMLInputElement).readOnly).toBe(true);
    expect(create().disabled).toBe(true);
    expect(document.querySelector('[data-part="setup-hint"]')?.textContent).toBe('Add your PGP key to continue.');
    await click(button('Add PGP key'));
    typeInto(field('Your PGP public key'), PGP_KEY);
    await click(button('Send message'));
    typeInto(field('Code from the message'), '5555');
    await click(button('Check code'));
    expect(create().disabled).toBe(false);
    api.set('POST /staff/v1/setup/finish', (body) => {
      expect(typeof (body as { deviceLabel: unknown }).deviceLabel).toBe('string');
      return { body: { keyCheckCodes: ['AAAA-BBBB-CCCC-DDDD', 'EEEE-FFFF-GGGG-HHHH'] } };
    });
    await click(create());
    expect(document.querySelector('[data-screen="owner-setup"]')?.getAttribute('data-state')).toBe('locked');
    expect(document.querySelector('h1')?.textContent).toBe(LOCKED_TITLE);
    expect([...document.querySelectorAll('[data-part="key-check-codes"] li')].map((l) => l.textContent)).toEqual(['AAAA-BBBB-CCCC-DDDD', 'EEEE-FFFF-GGGG-HHHH']);
  });

  it('the code and username inputs are masked for parity', async () => {
    setupApi();
    await open('/setup');
    expect(field('Setup code').hasAttribute('data-mask')).toBe(true);
    expect(field('Username').hasAttribute('data-mask')).toBe(true);
  });

  it('a reload after setup shows the page as locked, with the owner\'s key check codes when logged in', async () => {
    const api = setupApi({
      'POST /staff/v1/setup/finish': refused(404, 'setup-locked'),
      'GET /staff/v1/owner/keys': { body: { keys: [{ id: '1', label: 'Main key', createdAt: '', lastUsedAt: null, keyCheckCode: 'AAAA-BBBB-CCCC-DDDD' }] } },
    });
    await open('/setup');
    expect(document.querySelector('[data-screen="owner-setup"]')?.getAttribute('data-state')).toBe('locked');
    expect(document.querySelector('[data-part="key-check-codes"]')?.textContent).toBe('AAAA-BBBB-CCCC-DDDD');
    // The probe costs no try of the code: it never calls setup/code.
    expect(api.calls.some((c) => c.path === '/staff/v1/setup/code')).toBe(false);
    api.set('GET /staff/v1/owner/keys', refused(401, 'not-authenticated'));
    await open('/setup');
    const pages = document.querySelectorAll('[data-screen="owner-setup"][data-state="locked"]');
    expect(pages[pages.length - 1]!.querySelector('[data-part="key-check-codes"]')).toBeNull();
  });

  it('a key X2F cannot check is a refusal (CantDoThat)', async () => {
    setupApi({ 'POST /staff/v1/setup/key/finish': refused(403, 'method-not-allowed') });
    await open('/setup');
    typeInto(field('Setup code'), 'X');
    await click(button('Check code'));
    typeInto(field('Username'), 'lumen.k');
    typeInto(field('Login name'), 'lumen-login');
    await click(button('Tap key to register'));
    expect(cantDo()).toBe('method-not-allowed');
  });

  it('a wrong setup code says so', async () => {
    setupApi({ 'POST /staff/v1/setup/code': refused(401, 'code-invalid') });
    await open('/setup');
    typeInto(field('Setup code'), 'NOPE');
    await click(button('Check code'));
    expect(document.querySelector('[data-part="setup-fault"]')?.textContent).toBe('That is not the setup code. Copy it again from the server log.');
  });
});

describe('Feedback (owner)', () => {
  it('lists both feedback kinds with the 30-day Great / OK / Needs work counts; a named message shows its account (D-058), never the raw id', async () => {
    fakeApi({
      'GET /staff/v1/me': { body: { ...ME, displayName: 'lumen.k', role: 'owner', nav: NAV.owner } },
      'GET /staff/v1/feedback': {
        body: { items: [{ id: 'm1', mood: 'needs-work', note: 'Slow payouts', createdOn: '2026-11-05' }], counts: { great: 4, ok: 2, needsWork: 1 }, next: null },
      },
      'GET /staff/v1/feedback/form': {
        body: {
          items: [
            // Review m1 (lead 12 Nov): the API sends no raw account id, only the display name.
            { id: 'f1', kind: 'complaint', text: 'Limits too low', accountName: 'Quiet.Fox', from: 'starter-limit', createdOn: '2026-11-04' },
            { id: 'f2', kind: 'feedback', text: 'Nice app', accountName: null, from: null, createdOn: '2026-11-03' },
          ],
          next: null,
        },
      },
    });
    await open('/feedback');
    const counts = document.querySelector('[data-part="mood-counts"]')!;
    expect([...counts.querySelectorAll('li')].map((l) => l.textContent)).toEqual(['4Great', '2OK', '1Needs work']);
    expect(document.body.textContent).toContain('Slow payouts');
    expect(document.body.textContent).toContain('Needs work');
    expect(document.body.textContent).toContain('Limits too low');
    expect(document.body.textContent).toContain('starter-limit');
    expect(document.body.textContent).not.toContain('acc-123');
    const rows = [...document.querySelectorAll('table[aria-label="Messages"] tbody tr')].map((r) => r.textContent ?? '');
    expect(rows[0]).toContain('Quiet.Fox');
    expect(rows[1]).toContain('Anonymous');
    expect(document.body.textContent).not.toContain('Nothing here says who sent it.');
  });
});

describe('NewsEditor (owner; Plan 4 Task 28)', () => {
  const OWNER = { ...ME, displayName: 'lumen.k', role: 'owner', nav: NAV.owner };
  const ITEM = { id: 7, title: 'Maintenance tonight', body: 'Back by 02:00 UTC.', publishedAt: '2026-11-05T10:00:00Z', editedAt: null };

  it('writes with a preview that is the trader view ("As traders will see it"), edits and deletes', async () => {
    let items = [ITEM];
    const api = fakeApi({
      'GET /staff/v1/me': { body: OWNER },
      'GET /staff/v1/news': () => ({ body: { items } }),
      'POST /staff/v1/news': (b) => {
        const it = { ...ITEM, id: 8, ...(b as object) };
        items = [it, ...items];
        return { status: 201, body: it };
      },
      'PUT /staff/v1/news/:id': (b) => ({ body: { ...ITEM, ...(b as object) } }),
      'DELETE /staff/v1/news/:id': { status: 204 },
    });
    await open('/overview');
    await click(document.querySelector('a[href="/overview/news"]'));
    expect(document.querySelector('[data-screen="news-editor"]')).not.toBeNull();
    expect(document.querySelectorAll('[data-part="news-row"]')).toHaveLength(1);
    const publish = () => button('Publish')!;
    expect(publish().disabled).toBe(true);
    typeInto(field('Title'), 'Zelle delays');
    typeInto(field('Message'), 'Bank holiday.\nExpect delays.');
    // Design final call (10 Nov 2026): the preview is the trader's own News post (apps/web NewsPost through
    // the kit), open, marked New, under the heading "As traders will see it".
    expect([...document.querySelectorAll('h2')].map((h) => h.textContent)).toContain('As traders will see it');
    expect(document.body.textContent).not.toContain('Preview');
    const preview = document.querySelector('[data-part="news-preview"] [data-part="news-item"]')!;
    expect(preview.classList.contains('x2f-post')).toBe(true);
    expect(preview.hasAttribute('data-new')).toBe(true);
    expect(preview.querySelector('[data-part="news-new"]')?.textContent).toBe('New');
    expect(preview.querySelector('[data-part="news-title"]')?.textContent).toBe('Zelle delays');
    const toggle = preview.querySelector<HTMLButtonElement>('.x2f-post__toggle')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const body = preview.querySelector<HTMLElement>('.x2f-post__body')!;
    expect(body.hidden).toBe(false);
    expect([...body.querySelectorAll('p')].map((p) => p.textContent)).toEqual(['Bank holiday.', 'Expect delays.']);
    // The trader's toggle works on the preview too, and it opens again.
    await click(toggle);
    expect(preview.querySelector<HTMLElement>('.x2f-post__body')!.hidden).toBe(true);
    await click(toggle);
    expect(preview.querySelector<HTMLElement>('.x2f-post__body')!.hidden).toBe(false);
    await click(publish());
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({ title: 'Zelle delays', body: 'Bank holiday.\nExpect delays.' });
    expect(document.querySelectorAll('[data-part="news-row"]')).toHaveLength(2);
    await click(button('Edit'));
    expect((field('Title') as HTMLInputElement).value).toBe('Zelle delays');
    typeInto(field('Message'), 'Fixed.');
    await click(button('Save changes'));
    expect(api.calls.find((c) => c.method === 'PUT')).toMatchObject({ path: '/staff/v1/news/8', body: { title: 'Zelle delays', body: 'Fixed.' } });
    await click(button('Delete'));
    await click(button('Delete', document.querySelector('[role="dialog"]')!));
    expect(api.calls.find((c) => c.method === 'DELETE')?.path).toBe('/staff/v1/news/8');
  });

  it('a title over 120 characters disables Publish', async () => {
    fakeApi({ 'GET /staff/v1/me': { body: OWNER }, 'GET /staff/v1/news': { body: { items: [] } } });
    await open('/overview/news');
    typeInto(field('Title'), 'x'.repeat(121));
    typeInto(field('Message'), 'Body');
    expect(button('Publish')!.disabled).toBe(true);
    expect(document.querySelector('[data-part="title-count"]')?.textContent).toBe('121 / 120');
  });
});
