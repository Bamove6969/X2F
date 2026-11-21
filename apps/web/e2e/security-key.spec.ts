// A security key added during setup with a real browser ceremony (owner demo 13 Nov 2026: "Unable
// to add security key. I've tried both USB and nfc"; review of wip/third-seckey-fix: no committed
// spec covered this). Ported to main from 0ae388d9: main's setup has no /setup/security-key step
// (that comes with demo-r2's sign-up v2), so this drives the same account add-key calls through
// main's backup step (Backup.tsx SecurityKeyBackup), without the 16 Nov success state. Chrome's virtual authenticator (CDP WebAuthn domain) stands in for the key,
// over USB and over NFC; the API is stubbed with page.route, with options shaped as the server
// sends them for a trader's security key (registrationOptionsFor: hints security-key,
// cross-platform, no resident key, UV preferred, attestation none, algorithms -8/-7/-257).
// The page is opened on http://localhost (a secure context and a valid RP ID; 127.0.0.1 is an IP,
// which can never be one).
import { expect, test, type CDPSession, type Page, type Route } from '@playwright/test';
import * as openpgp from 'openpgp';
import { KEY_ERROR } from '../src/screens/auth/keyErrors.js';
import { TERMS_TEXT_VERSION } from '../src/screens/setup/termsText.js';
import { PORT } from './playwright.config.js';

const ORIGIN = `http://localhost:${PORT}`;
const MESSAGE = '-----BEGIN PGP MESSAGE-----\nhF4DkR7c2x9mPq0SAQdA4vJ8u2Lk0aQz\nWm3n…\n-----END PGP MESSAGE-----';
const RECOVERY_CODES = Array.from({ length: 10 }, (_, i) => `ABCD-EFGH-JKMN-PQR${i}`);
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
  await page.route('**/v1/account/recovery-codes', (r) => {
    methods.push('recovery-codes');
    return json({ codes: RECOVERY_CODES })(r);
  });
  await page.route('**/v1/wallets/rule', json({ firstWallet: true, strongMethods: ['pgp'], password: 'none', waitHours: 24 }));
  await page.route('**/v1/wallets', json([]));
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

/** Terms, names, PGP sign-up and the recovery codes saved: lands on the backup step's security key. */
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
  await page.click('[data-part="method-continue"]');

  await expect(page).toHaveURL(/\/setup\/pgp-key\?/);
  await page.fill('#pub', realKey);
  await expect(page.locator('[data-part="key-check"]')).toContainText('Ed25519');
  await page.click('[data-part="key-continue"]');
  await expect(page).toHaveURL(/\/setup\/pgp-code\?/);
  await page.fill('#phrase', '1234-5678-9ABC');
  await page.click('[data-part="pgp-verify"]');
  await page.click('[data-part="pgp-continue"]');

  await expect(page).toHaveURL(/\/setup\/backup\?/);
  await page.click('[data-part="recovery-make"]');
  const input = page.locator('#recovery-typeback');
  const n = Number(await input.getAttribute('data-code-number'));
  await page.check('[data-part="recovery-written"]');
  await input.fill(RECOVERY_CODES[n - 1]!);
  await page.click('[data-part="recovery-continue"]');
  await page.click('[data-backup="security-key"]');
  await page.click('[data-part="backup-add"]');
  await expect(page.locator('[data-part="backup-security-key"]')).toBeVisible();
}

for (const transport of ['usb', 'nfc'] as const) {
  test(`a security key over ${transport.toUpperCase()} is added on the setup backup step`, async ({ page }) => {
    const s = await stubApi(page, { rpId: 'localhost' });
    await virtualKey(page, transport);
    await toSecurityKeyStep(page);
    await page.click('[data-part="backup-key-add"]');
    await expect(page).toHaveURL(/\/setup\/wallet\?/);
    expect(s.starts).toEqual([{ kind: 'security-key' }]);
    expect(s.finishes).toHaveLength(1);
    expect(s.finishes[0]!.response.response.transports).toEqual([transport]);
    expect(s.finishes[0]!.response.authenticatorAttachment).toBe('cross-platform');
  });
}

test("an RP ID that is not the page's host says it is the wrong address, and no finish is sent",async ({ page }) => {
  const s = await stubApi(page, { rpId: 'x2f.example' });
  await virtualKey(page, 'usb');
  await toSecurityKeyStep(page);
  await page.click('[data-part="backup-key-add"]');
  await expect(page.locator('[data-part="backup-security-key"] [role="alert"]')).toHaveText(KEY_ERROR.wrongAddress);
  await expect(page).toHaveURL(/\/setup\/backup\?/);
  expect(s.finishes).toEqual([]);
});

test('a key model the server turns away says so', async ({ page }) => {
  const s = await stubApi(page, { rpId: 'localhost', finish: (r) => json({ error: 'method-not-allowed' }, 403)(r) });
  await virtualKey(page, 'nfc');
  await toSecurityKeyStep(page);
  await page.click('[data-part="backup-key-add"]');
  await expect(page.locator('[data-part="backup-security-key"] [role="alert"]')).toHaveText(KEY_ERROR.notAccepted);
  expect(s.finishes).toHaveLength(1);
});
