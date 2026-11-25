/**
 * Plan 4 Task 21: the staff side of the end-to-end dispute specs on regtest (disputes.e2e.spec.ts):
 * the owner the stack set up, moderators and senior moderators hired through the owner's real
 * invite (a tapped `create-invite`, then the invite's own sign-up routes), staff logins with a
 * security key and a PGP key, key taps from Node, and staff browser contexts on the staff origin
 * whose virtual authenticator holds the person's own security key, so the staff app's taps sign
 * with it (KeyTapDialog → navigator.credentials.get).
 *
 * One key is one counter: a key used both in Node and in a browser has its counter read back from
 * the browser before Node signs, and written back after (the API and the gate refuse a counter that
 * does not move on).
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Browser, BrowserContext, CDPSession, Page } from '@playwright/test';
import type { KeyTapIntent, LoginHours } from '@x2f/staff';
import { addKey, newPgp, pgpCode, staffLogin, StaffClient, type PgpPair } from '../../../tools/regtest/e2e/staffClient.js';
import { authenticate, newKey, type KeyData } from '../../../tools/regtest/e2e/softKey.js';
import type { StaffInfo } from '../../../tools/regtest/e2e/staffStack.js';
import { TERMS_TEXT_VERSION } from '../../web/src/screens/setup/termsText.js';
import { DESKTOP, stack, type Size } from '../../web/e2e/regtestKit.js';

export function staffInfo(): StaffInfo {
  const s = stack().staff;
  if (!s) throw new Error('the stack has no staff side: run with -c apps/staff-web/e2e/playwright.regtest.config.ts');
  return s;
}

export interface Staffer {
  displayName: string;
  loginName: string;
  role: 'owner' | 'senior' | 'mod';
  keys: KeyData[];
  pgp: PgpPair;
  client: StaffClient;
  /** The browser contexts holding this person's keys (their counters are kept in step). */
  browsers: Array<{ cdp: CDPSession; authenticatorId: string; /** Only these keys (credential ids) are in this browser; null: all. */ only: string[] | null }>;
}

let ownerP: Staffer | null = null;
/** The stack's owner (two keys: [0] the main key, [1] the spare), logged in. */
export async function owner(): Promise<Staffer> {
  if (ownerP) return ownerP;
  const s = staffInfo();
  // Each Playwright worker (and a rerun on a reused stack) starts from the stack's copy of the keys,
  // so their counters restart from a clock reading: always above what an earlier worker reached.
  const counter = Math.floor(Date.now() / 1000) - 1_700_000_000;
  const o: Staffer = { ...s.owner, role: 'owner', keys: s.owner.keys.map((k) => ({ ...k, counter })), client: new StaffClient(s.api, s.origin), browsers: [] };
  await staffLogin(o.client, { loginName: o.loginName, key: o.keys[0]!, pgp: o.pgp });
  ownerP = o;
  return o;
}

const b64 = (s: string) => Buffer.from(s, 'base64url').toString('base64');

/** Reads each key's counter back from the browsers holding it. */
async function pull(p: Staffer): Promise<void> {
  for (const b of p.browsers) {
    const { credentials } = (await b.cdp.send('WebAuthn.getCredentials', { authenticatorId: b.authenticatorId }).catch(() => ({ credentials: [] }))) as { credentials: Array<{ credentialId: string; signCount: number }> };
    for (const c of credentials) {
      const k = p.keys.find((x) => b64(x.credentialId) === c.credentialId);
      if (k && c.signCount > k.counter) k.counter = c.signCount;
    }
  }
}

/** Writes each key's counter into the browsers holding it. */
async function push(p: Staffer): Promise<void> {
  for (const b of p.browsers) {
    for (const k of p.keys.filter((x) => b.only === null || b.only.includes(x.credentialId))) {
      const credentialId = b64(k.credentialId);
      await b.cdp.send('WebAuthn.removeCredential', { authenticatorId: b.authenticatorId, credentialId }).catch(() => undefined);
      await b.cdp.send('WebAuthn.addCredential', {
        authenticatorId: b.authenticatorId,
        credential: { credentialId, isResidentCredential: false, rpId: 'localhost', privateKey: k.pkcs8, signCount: k.counter, ...(k.userHandle ? { userHandle: b64(k.userHandle) } : {}) },
      }).catch(() => undefined);
    }
  }
}

/** Signs `options` with `key` in Node, keeping its counter in step with the browsers. */
export async function nodeSign<T>(p: Staffer, key: KeyData, sign: () => T): Promise<T> {
  await pull(p);
  const r = sign();
  await push(p);
  return r;
}

/** A finished key tap for `intent` through the staff routes, signed in Node; returns its id. */
export async function tap(p: Staffer, intent: KeyTapIntent, key = p.keys[0]!): Promise<string> {
  const s = staffInfo();
  const start = await p.client.ok<{ tapId: string; options: never }>('POST', '/staff/v1/taps/start', intent);
  const response = await nodeSign(p, key, () => authenticate(key, start.options, s.origin));
  await p.client.ok('POST', `/staff/v1/taps/${start.tapId}/finish`, { response });
  return start.tapId;
}

/** Any time, every day (the default for the hired staff). */
export const ANY_HOURS: LoginHours = 'any';

/**
 * A new staff member hired through the owner's invite: the owner taps `create-invite` and creates
 * it; the invitee picks names, signs the Terms, adds a security key, a passkey and a PGP key, and
 * finishes; then logs in. Only the staff app's own routes are used.
 */
export async function hire(role: 'mod' | 'senior', o: { hours?: LoginHours } = {}): Promise<Staffer> {
  const s = staffInfo();
  const own = await owner();
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');
  const inviteId = randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 3_600_000).toISOString();
  const tapId = await tap(own, { kind: 'create-invite', inviteId, role, tokenHash, expiresAt });
  await own.client.ok('POST', '/staff/v1/invites', { role, hours: o.hours ?? 'any', inviteId, token, expiresAt, tapId });

  const tag = randomBytes(3).toString('hex');
  const displayName = `${role === 'mod' ? 'Kestrel' : 'Senior'}${tag}`;
  const loginName = `${role}-login-${tag}`;
  const c = new StaffClient(s.api, s.origin);
  const url = (step = '') => `/staff/v1/invites/accept/${token}${step}`;
  await c.ok('GET', url());
  await c.ok('POST', url('/account'), { displayName, loginName, acceptedTerms: TERMS_TEXT_VERSION, termsSignature: { kind: 'typed', name: displayName } });
  const key = newKey();
  await addKey(c, { path: url('/key/start'), body: { kind: 'security-key' } }, (_s, response) => ({ path: url('/key/finish'), body: { kind: 'security-key', response } }), key, s.ca);
  const passkey = newKey();
  await addKey(c, { path: url('/key/start'), body: { kind: 'passkey' } }, (_s, response) => ({ path: url('/key/finish'), body: { kind: 'passkey', response } }), passkey, null);
  const pgp = await newPgp(displayName);
  const ps = await c.ok<{ challengeId: string; encryptedMessage: string }>('POST', url('/pgp/start'), { publicKey: pgp.publicKey });
  await c.ok('POST', url('/pgp/finish'), { challengeId: ps.challengeId, code: await pgpCode(ps.encryptedMessage, pgp) });
  await c.ok('POST', url('/finish'), {});
  const p: Staffer = { displayName, loginName, role, keys: [key], pgp, client: new StaffClient(s.api, s.origin), browsers: [] };
  await staffLogin(p.client, { loginName, key, pgp });
  return p;
}

/**
 * A browser context on the staff origin, logged in as `p` (their staff session cookie), whose
 * virtual authenticator holds `p`'s security keys. The staff boards are 1280 wide.
 */
export async function staffPage(browser: Browser, p: Staffer, size: Size = DESKTOP, o: { keys?: number[] } = {}): Promise<{ context: BrowserContext; page: Page; close(): Promise<void> }> {
  const s = staffInfo();
  const context = await browser.newContext({ baseURL: s.origin, viewport: size, ignoreHTTPSErrors: true });
  await context.addCookies([...p.client.jar].map(([name, value]) => ({ name, value, url: s.origin, secure: true, httpOnly: true, sameSite: 'Strict' as const })));
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = (await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'usb', hasResidentKey: false, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  })) as { authenticatorId: string };
  await pull(p);
  p.browsers.push({ cdp, authenticatorId, only: o.keys?.map((i) => p.keys[i]!.credentialId) ?? null });
  await push(p);
  context.on('close', () => {
    p.browsers = p.browsers.filter((b) => b.cdp !== cdp);
  });
  if (process.env.X2F_E2E_DIAG) {
    page.on('console', (m) => console.log(`[staff ${p.displayName} ${m.type()}] ${m.text().slice(0, 300)}`));
    page.on('pageerror', (e) => console.log(`[staff ${p.displayName} pageerror] ${e.message.slice(0, 300)}`));
    context.on('response', (r) => {
      if (r.status() >= 400) void r.text().then((t) => console.log(`[staff ${p.displayName} http ${r.status()}] ${r.request().method()} ${r.url().slice(0, 120)} ${t.slice(0, 200)}`), () => undefined);
    });
  }
  return {
    context,
    page,
    // The browser's counters are read back before it goes, so Node's next tap with the key moves on from them.
    close: async () => {
      await pull(p);
      await context.close();
    },
  };
}

/** The owner changes the large-trade limit (a tapped `settings` change, as StaffSettings does); returns the old limit. */
export async function setLargeTradeLimit(usd: number): Promise<number> {
  const o = await owner();
  const s = await o.client.ok<{ largeTradeLimitUsd: number; firstResponseH: number; appealWindowH: number }>('GET', '/staff/v1/settings');
  const tapId = await tap(o, { kind: 'settings', largeTradeLimitUsd: usd, firstResponseH: s.firstResponseH, appealWindowH: s.appealWindowH });
  await o.client.ok('PUT', '/staff/v1/settings', { largeTradeLimitUsd: usd, tapId });
  return s.largeTradeLimitUsd;
}
