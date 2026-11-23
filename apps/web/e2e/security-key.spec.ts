// /setup/security-key with a real browser ceremony (owner demo 13 Nov 2026: "Unable to add
// security key. I've tried both USB and nfc"; review of wip/third-seckey-fix: no committed spec
// covered this screen). Chrome's virtual authenticator (CDP WebAuthn domain) stands in for the key,
// over USB and over NFC; the API is stubbed with page.route, with options shaped as the server
// sends them for a trader's security key (registrationOptionsFor: hints security-key,
// cross-platform, no resident key, UV preferred, attestation none, algorithms -8/-7/-257).
// After the key is added the step shows it was (owner 16 Nov 2026) and waits for Continue.
// The page is opened on http://localhost (a secure context and a valid RP ID; 127.0.0.1 is an IP,
// which can never be one).
import { expect, test, type CDPSession, type Page, type Route } from '@playwright/test';
import * as openpgp from 'openpgp';
import { KEY_ERROR } from '../src/screens/auth/keyErrors.js';
import { TERMS_TEXT_VERSION } from '../src/screens/setup/termsText.js';
import { PORT } from './playwright.config.js';

const ORIGIN = `http://localhost:${PORT}`;
const MESSAGE = '-----BEGIN PGP MESSAGE-----\nhF4DkR7c2x9mPq0SAQdA4vJ8u2Lk0aQz\nWm3n…\n-----END PGP MESSAGE-----';
const b64url = (b: Uint8Array) => Buffer.from(b).toString('base64url');

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

let realKey = '';
test.beforeAll(async () => {
  const { publicKey } = await openpgp.generateKey({ type: 'ecc', curve: 'ed25519Legacy', userIDs: [{ name: 'Key Test' }], format: 'armored' });
  realKey = publicKey;
});

/** Registration options as the API sends them for a trader's security key. */
function keyOptions(rpId: string) {
  return {
    rp: { name: 'X2F', id: rpId },
    user: { id: b64url(new Uint8Array(32).fill(3)), name: 'lumen.k', displayName: 'lumen.k' },
    challenge: b64url(crypto.getRandomValues(new Uint8Array(32))),
    pubKeyCredParams: [-8, -7, -257].map((alg) => ({ alg, type: 'public-key' })),
    timeout: 60_000,
    attestation: 'none',
    excludeCredentials: [],
    authenticatorSelection: { authenticatorAttachment: 'cross-platform', residentKey: 'discouraged', requireResidentKey: false, userVerification: 'preferred' },
    hints: ['security-key'],
    extensions: { credProps: true },
  };
}

interface Stub {
  starts: unknown[];
  finishes: { response: { response: { transports?: string[] }; authenticatorAttachment?: string } }[];
}

async function stubApi(page: Page, o: { rpId: string; finish?: (r: Route) => Promise<void> }): Promise<Stub> {
  const s: Stub = { starts: [], finishes: [] };
  let registered = false;
  const methods: string[] = [];
  await page.route('**/v1/account/me', (r) =>
    registered
      ? json({ displayName: 'lumen.k', loginNameSet: true, kind: 'trader', level: 'full', holdUntil: null, methods, hasBackup: false, suggestions: [], termsCurrent: true })(r)
      : json({ error: 'not-authenticated' }, 401)(r),
  );
  await page.route('**/v1/terms', json({ version: TERMS_TEXT_VERSION }));
  await page.route('**/v1/register/name-check', json({ available: true }));
  await page.route('**/v1/register/pgp/start', json({ challengeId: 'c1', encryptedMessage: MESSAGE, expiresAt: '2099-01-01T00:00:00.000Z', fingerprint: '3F2A9C417B0ED5A261C80E4B92D71F6AC3B80D15' }));
  await page.route('**/v1/register/pgp/finish', (r) => {
    registered = true;
    methods.push('pgp');
    return json({ displayName: 'lumen.k' }, 201)(r);
  });
  await page.route('**/v1/account/webauthn/start', (r) => {
    s.starts.push(JSON.parse(r.request().postData() ?? 'null'));
    return json({ challengeId: `w${s.starts.length}`, options: keyOptions(o.rpId) })(r);
  });
  await page.route('**/v1/account/webauthn/finish', async (r) => {
    s.finishes.push(JSON.parse(r.request().postData() ?? 'null'));
    if (o.finish) return o.finish(r);
    methods.push('security-key');
    return json({ ok: true }, 201)(r);
  });
  await page.route('**/v1/wallets/rule', json({ firstWallet: true, strongMethods: ['pgp'], password: 'none', waitHours: 24 }));
  await page.route('**/v1/wallets', (r) => (r.request().method() === 'GET' ? json([])(r) : json([], 201)(r)));
  return s;
}

/** A roaming CTAP2 key on `transport`, which answers at once (presence simulated). */
async function virtualKey(page: Page, transport: 'usb' | 'nfc'): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport, hasResidentKey: false, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  return cdp;
}

/** Terms, names, PGP and security key ticked, the PGP key made: lands on /setup/security-key. */
async function toSecurityKeyStep(page: Page): Promise<void> {
  await page.goto(`${ORIGIN}/setup?returnTo=%2Fpost`);
  await page.locator('[data-part="terms-text"]').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
    el.dispatchEvent(new Event('scroll'));
  });
  await page.check('[data-part="terms-tick"]');
  const pad = page.locator('[data-part="signature-pad"]');
  await pad.scrollIntoViewIfNeeded();
  const b = (await pad.boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.2, b.y + b.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.4, b.y + b.height * 0.7, { steps: 8 });
  await page.mouse.up();
  await page.click('[data-part="terms-accept"]');

  await expect(page.locator('[data-screen="setup-name"]')).toBeVisible();
  await page.fill('#uname', 'lumen-login-7');
  await expect(page.locator('[data-part="name-status"]')).toHaveText('lumen-login-7 is available');
  await page.click('[data-part="names-continue"]');
  await page.fill('#display-name', 'lumen.k');
  await page.click('[data-part="display-continue"]');

  await expect(page.locator('[data-screen="setup-login"]')).toBeVisible();
  await page.click('[data-method="security-key"]');
  await expect(page.locator('[data-method="security-key"] input[type="checkbox"]')).toBeChecked();
  await page.click('[data-part="method-continue"]');

  await expect(page).toHaveURL(/\/setup\/pgp-key\?/);
  await page.fill('#pub', realKey);
  await expect(page.locator('[data-part="key-check"]')).toContainText('Ed25519');
  await page.click('[data-part="key-continue"]');
  await expect(page).toHaveURL(/\/setup\/pgp-code\?/);
  await page.fill('#phrase', 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-6789-0ABC-DEFG-HJKM-NPQR');
  await page.click('[data-part="pgp-verify"]');
  await page.click('[data-part="pgp-continue"]');

  await expect(page).toHaveURL(/\/setup\/security-key\?/);
  await expect(page.locator('[data-screen="setup-security-key"]')).toBeVisible();
}

for (const transport of ['usb', 'nfc'] as const) {
  test(`a security key over ${transport.toUpperCase()} is added on /setup/security-key`, async ({ page }) => {
    const s = await stubApi(page, { rpId: 'localhost' });
    await virtualKey(page, transport);
    await toSecurityKeyStep(page);
    await page.fill('#key-name', `My ${transport} key`);
    await page.click('[data-part="key-add"]');
    // Owner 16 Nov: the step turns green, shows the key and its name, and waits for Continue.
    const done = page.locator('[data-part="key-done"]');
    await expect(done).toBeVisible();
    await expect(done).toContainText('Security key added');
    await expect(done.locator('[data-part="key-name"]')).toHaveText(`My ${transport} key`);
    await expect(done.locator('[data-part="key-picture"]')).toBeVisible();
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/\/setup\/security-key\?/);
    await page.click('[data-part="key-continue"]');
    await expect(page).toHaveURL(/\/setup\/backup\?/);
    expect(s.starts).toEqual([{ kind: 'security-key' }]);
    expect(s.finishes).toHaveLength(1);
    expect((s.finishes[0] as unknown as { label?: string }).label).toBe(`My ${transport} key`);
    expect(s.finishes[0]!.response.response.transports).toEqual([transport]);
    expect(s.finishes[0]!.response.authenticatorAttachment).toBe('cross-platform');
  });
}

test("an RP ID that is not the page's host says it is the wrong address, and no finish is sent",async ({ page }) => {
  const s = await stubApi(page, { rpId: 'x2f.example' });
  await virtualKey(page, 'usb');
  await toSecurityKeyStep(page);
  await page.click('[data-part="key-add"]');
  await expect(page.locator('[data-screen="setup-security-key"] [role="alert"]')).toHaveText(KEY_ERROR.wrongAddress);
  await expect(page).toHaveURL(/\/setup\/security-key\?/);
  expect(s.finishes).toEqual([]);
});

test('a key model the server turns away says so', async ({ page }) => {
  const s = await stubApi(page, { rpId: 'localhost', finish: (r) => json({ error: 'method-not-allowed' }, 403)(r) });
  await virtualKey(page, 'nfc');
  await toSecurityKeyStep(page);
  await page.click('[data-part="key-add"]');
  await expect(page.locator('[data-screen="setup-security-key"] [role="alert"]')).toHaveText(KEY_ERROR.notAccepted);
  expect(s.finishes).toHaveLength(1);
});
