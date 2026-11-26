// /setup/security-key with a real browser ceremony (owner demo 13 Nov 2026: "Unable to add
// security key. I've tried both USB and nfc"; review of wip/third-seckey-fix: no committed spec
// covered this screen). Chrome's virtual authenticator (CDP WebAuthn domain) stands in for the key,
// over USB and over NFC; the API is stubbed with page.route, with options shaped as the server
// sends them for a trader's security key (registrationOptionsFor: hints security-key,
// cross-platform, no resident key, UV required, attestation none, algorithms -7/-8/-257, 5 minutes).
// After the key is added the step shows it was (owner 16 Nov 2026) and waits for Continue.
// Owner 25 Nov security-key report: "Security key saved", then the key is named (default
// "Security key N", PUT /v1/account/webauthn/label) and the name shown, both on the step for a key
// ticked after another method and when the security key is the method the account is made with;
// each failure (cancelled or timed out, already registered, no PIN, unsupported) says why.
// The page is opened on http://localhost (a secure context and a valid RP ID; 127.0.0.1 is an IP,
// which can never be one).
import { generateKeyPairSync, randomBytes } from 'node:crypto';
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

/** Registration options as the API sends them for a trader's security key (`o` overrides fields). */
function keyOptions(rpId: string, o: Record<string, unknown> = {}) {
  return {
    rp: { name: 'X2F', id: rpId },
    user: { id: b64url(new Uint8Array(32).fill(3)), name: 'lumen.kai', displayName: 'lumen.kai' },
    challenge: b64url(crypto.getRandomValues(new Uint8Array(32))),
    pubKeyCredParams: [-7, -8, -257].map((alg) => ({ alg, type: 'public-key' })),
    timeout: 300_000,
    attestation: 'none',
    excludeCredentials: [],
    authenticatorSelection: { authenticatorAttachment: 'cross-platform', residentKey: 'discouraged', requireResidentKey: false, userVerification: 'required' },
    hints: ['security-key'],
    extensions: { credProps: true },
    ...o,
  };
}

interface Stub {
  starts: unknown[];
  finishes: { response: { id: string; response: { transports?: string[] }; authenticatorAttachment?: string } }[];
  labels: { credentialId: string; label: string }[];
}

async function stubApi(
  page: Page,
  o: { rpId: string; finish?: (r: Route) => Promise<void>; options?: Record<string, unknown>; finishDelayMs?: number },
): Promise<Stub> {
  const s: Stub = { starts: [], finishes: [], labels: [] };
  let registered = false;
  const methods: string[] = [];
  const list = () =>
    methods.map((m, i) => ({ type: m, id: `${m}-${i}`, label: s.labels.at(-1)?.label ?? (m === 'security-key' ? 'Security key' : ''), createdAt: null, lastUsedAt: null }));
  await page.route('**/v1/account/methods', (r) => json(list())(r));
  await page.route('**/v1/account/webauthn/label', (r) => {
    const b = JSON.parse(r.request().postData() ?? 'null') as { credentialId: string; label: string };
    s.labels.push(b);
    return json({ label: b.label })(r);
  });
  // The security key as the first method: the account is made with it (sign-up).
  await page.route('**/v1/register/webauthn/start', (r) => {
    s.starts.push(JSON.parse(r.request().postData() ?? 'null'));
    return json({ challengeId: `r${s.starts.length}`, options: keyOptions(o.rpId, o.options) })(r);
  });
  await page.route('**/v1/register/webauthn/finish', async (r) => {
    s.finishes.push(JSON.parse(r.request().postData() ?? 'null'));
    if (o.finishDelayMs) await new Promise((d) => setTimeout(d, o.finishDelayMs));
    if (o.finish) return o.finish(r);
    registered = true;
    methods.push('security-key');
    return json({ tradeTag: 'lumen.kai' }, 201)(r);
  });
  await page.route('**/v1/account/me', (r) =>
    registered
      ? json({ tradeTag: 'lumen.kai', loginNameSet: true, kind: 'trader', level: 'full', holdUntil: null, methods, hasBackup: false, suggestions: [], termsCurrent: true })(r)
      : json({ error: 'not-authenticated' }, 401)(r),
  );
  await page.route('**/v1/terms', json({ version: TERMS_TEXT_VERSION }));
  await page.route('**/v1/register/name-check', json({ available: true }));
  await page.route('**/v1/register/pgp/start', json({ challengeId: 'c1', encryptedMessage: MESSAGE, expiresAt: '2099-01-01T00:00:00.000Z', fingerprint: '3F2A9C417B0ED5A261C80E4B92D71F6AC3B80D15' }));
  await page.route('**/v1/register/pgp/finish', (r) => {
    registered = true;
    methods.push('pgp');
    return json({ tradeTag: 'lumen.kai' }, 201)(r);
  });
  await page.route('**/v1/account/webauthn/start', (r) => {
    s.starts.push(JSON.parse(r.request().postData() ?? 'null'));
    return json({ challengeId: `w${s.starts.length}`, options: keyOptions(o.rpId, o.options) })(r);
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

/** A roaming CTAP2 key on `transport`, which answers at once (presence simulated); its authenticator id. */
async function virtualKey(page: Page, transport: 'usb' | 'nfc'): Promise<{ cdp: CDPSession; authenticatorId: string }> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport, hasResidentKey: false, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  return { cdp, authenticatorId };
}

/** Terms and names, then only the security key ticked: the login step's Continue makes the account with it. */
async function toLoginStep(page: Page): Promise<void> {
  await page.goto(`${ORIGIN}/setup?returnTo=%2Fpost`);
  await page.check('[data-part="terms-tick"]');
  await page.click('[data-part="terms-accept"]');
  await page.fill('#uname', 'lumen-login-7');
  await expect(page.locator('[data-part="name-status"]')).toHaveText('lumen-login-7 is available');
  await page.click('[data-part="names-continue"]');
  await page.fill('#trade-tag', 'lumen.kai');
  await page.click('[data-part="display-continue"]');
  await expect(page.locator('[data-screen="setup-login"]')).toBeVisible();
  await page.uncheck('[data-method="pgp"] input[type="checkbox"]');
  await page.check('[data-method="security-key"] input[type="checkbox"]');
}

/** Terms, names, PGP and security key ticked, the PGP key made: lands on /setup/security-key. */
async function toSecurityKeyStep(page: Page): Promise<void> {
  await page.goto(`${ORIGIN}/setup?returnTo=%2Fpost`);
  await page.check('[data-part="terms-tick"]');
  // A trader agrees with the tick alone (owner demo note #187, 25 Nov 2026).
  await page.click('[data-part="terms-accept"]');

  await expect(page.locator('[data-screen="setup-name"]')).toBeVisible();
  await page.fill('#uname', 'lumen-login-7');
  await expect(page.locator('[data-part="name-status"]')).toHaveText('lumen-login-7 is available');
  await page.click('[data-part="names-continue"]');
  await page.fill('#trade-tag', 'lumen.kai');
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
    // Owner 25 Nov: no name before the tap; it is asked once the key is saved.
    await expect(page.locator('[data-part="key-name-input"]')).toHaveCount(0);
    await page.click('[data-part="key-add"]');
    // Owner 16 Nov and 25 Nov: the step turns green, says the key is saved, asks for its name, and waits for Continue.
    const done = page.locator('[data-part="key-done"]');
    await expect(done).toBeVisible();
    await expect(done.locator('[data-part="key-saved"]')).toHaveText('Security key saved');
    await expect(done.locator('[data-part="key-picture"]')).toBeVisible();
    // PGP and this key on the account: the account's first security key.
    await expect(done.locator('[data-part="key-name-input"]')).toHaveValue('Security key 1');
    await expect(done.locator('[data-part="key-continue"]')).toHaveCount(0);
    await done.locator('[data-part="key-name-input"]').fill(`My ${transport} key`);
    await done.locator('[data-part="key-name-save"]').click();
    await expect(done.locator('[data-part="key-name"]')).toContainText(`My ${transport} key`);
    expect(s.labels).toEqual([{ credentialId: s.finishes[0]!.response.id, label: `My ${transport} key` }]);
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/\/setup\/security-key\?/);
    await page.click('[data-part="key-continue"]');
    await expect(page).toHaveURL(/\/setup\/backup\?/);
    expect(s.starts).toEqual([{ kind: 'security-key' }]);
    expect(s.finishes).toHaveLength(1);
    expect((s.finishes[0] as unknown as { label?: string }).label).toBeUndefined();
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

// Owner 25 Nov security-key report: the security key as the method the account is made with.
for (const transport of ['usb', 'nfc'] as const) {
  test(`sign-up with a security key over ${transport.toUpperCase()}: waiting words, "Security key saved", its name, saved and shown`, async ({ page }) => {
    const s = await stubApi(page, { rpId: 'localhost', finishDelayMs: 800 });
    await virtualKey(page, transport);
    await toLoginStep(page);
    await page.click('[data-part="method-continue"]');
    // While the ceremony and its check run: enter the PIN, then touch the key.
    await expect(page.locator('[data-part="key-waiting"]')).toContainText("Enter your key's PIN, then touch your key.");
    const done = page.locator('[data-screen="setup-key-saved"] [data-part="key-done"]');
    await expect(done.locator('[data-part="key-saved"]')).toHaveText('Security key saved');
    await expect(page.locator('[data-screen="setup-key-saved"] h1')).toHaveText('Name your security key');
    await expect(done.locator('[data-part="key-name-input"]')).toHaveValue('Security key 1');
    // A name outside the rule says why and is not sent.
    await done.locator('[data-part="key-name-input"]').fill('x'.repeat(33));
    await done.locator('[data-part="key-name-save"]').click();
    await expect(done.locator('[data-part="key-name-problem"]')).toHaveText('Use 32 characters or fewer.');
    expect(s.labels).toEqual([]);
    await done.locator('[data-part="key-name-input"]').fill('  Gold   YubiKey ');
    await done.locator('[data-part="key-name-save"]').click();
    await expect(done.locator('[data-part="key-name"]')).toContainText('Gold YubiKey');
    expect(s.starts).toEqual([{ tradeTag: 'lumen.kai', loginName: 'lumen-login-7', kind: 'security-key' }]);
    expect(s.labels).toEqual([{ credentialId: s.finishes[0]!.response.id, label: 'Gold YubiKey' }]);
    expect(s.finishes[0]!.response.response.transports).toEqual([transport]);
    // The test is offered once named; Continue goes on to the backup step.
    await expect(done.locator('[data-part="key-test-run"]')).toBeVisible();
    await done.locator('[data-part="key-continue"]').click();
    await expect(page).toHaveURL(/\/setup\/backup\?/);
  });
}

test.describe('sign-up with a security key: each failure says why, and nothing is saved', () => {
  test('cancelled or timed out (no key answered)', async ({ page }) => {
    const s = await stubApi(page, { rpId: 'localhost', options: { timeout: 1500 } });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await toLoginStep(page);
    await page.click('[data-part="method-continue"]');
    await expect(page.locator('[data-part="key-waiting"]')).toBeVisible();
    await expect(page.locator('[data-part="register-error"]')).toHaveText(KEY_ERROR.noAnswer('security-key'), { timeout: 15_000 });
    await expect(page).toHaveURL(/\/setup\/login\?/);
    expect(s.finishes).toEqual([]);
  });

  test('a key already registered', async ({ page }) => {
    const { cdp, authenticatorId } = await virtualKey(page, 'usb');
    const credentialId = randomBytes(16);
    const privateKey = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'der', type: 'pkcs8' });
    await cdp.send('WebAuthn.addCredential', {
      authenticatorId,
      credential: { credentialId: credentialId.toString('base64'), isResidentCredential: false, rpId: 'localhost', privateKey: privateKey.toString('base64'), signCount: 0 },
    });
    const s = await stubApi(page, { rpId: 'localhost', options: { excludeCredentials: [{ id: b64url(credentialId), type: 'public-key' }] } });
    await toLoginStep(page);
    await page.click('[data-part="method-continue"]');
    await expect(page.locator('[data-part="register-error"]')).toHaveText(KEY_ERROR.already('security-key'));
    expect(s.finishes).toEqual([]);
  });

  test('a key without a PIN (the API says the key did not check it)', async ({ page }) => {
    const s = await stubApi(page, { rpId: 'localhost', finish: (r) => json({ error: 'webauthn-failed', reason: 'needs-pin' }, 401)(r) });
    await virtualKey(page, 'nfc');
    await toLoginStep(page);
    await page.click('[data-part="method-continue"]');
    await expect(page.locator('[data-part="register-error"]')).toHaveText(KEY_ERROR.keyNeedsPin);
    await expect(page.locator('[data-part="key-done"]')).toHaveCount(0);
    expect(s.finishes).toHaveLength(1);
  });

  test('an unsupported key (the browser finds none of the algorithms offered)', async ({ page }) => {
    // Chrome's virtual authenticator answers an unknown algorithm with NotAllowedError, as a real key
    // usually does; the browser's own NotSupportedError is stood in for here.
    await page.addInitScript(() => {
      navigator.credentials.create = () => Promise.reject(new DOMException('No supported algorithm', 'NotSupportedError'));
    });
    const s = await stubApi(page, { rpId: 'localhost' });
    await virtualKey(page, 'usb');
    await toLoginStep(page);
    await page.click('[data-part="method-continue"]');
    await expect(page.locator('[data-part="register-error"]')).toHaveText(KEY_ERROR.noAlgorithm);
    expect(s.finishes).toEqual([]);
  });
});
