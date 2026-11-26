// Plan 4 Task 16: the staff app in a real browser. The owner completes first-run setup with two
// soft security keys (Chromium's virtual authenticator) and a PGP key, and a reload shows the setup
// page as locked; OwnerSetup is checked with the parity harness at its board's size (1280x1180)
// with the code and username inputs masked; the page loads under STAFF_CSP with no violation and
// no request to another origin. The staff API is stubbed with page.route in the shapes of
// apps/api/src/staff/ownerSetup.ts (its own tests cover the server side).
//
// Not here (left for the full-stack run, Plan 4 Task 21): a fresh API process printing the setup
// code. The owner keys need attestation the virtual authenticator cannot give.
import { randomBytes } from 'node:crypto';
import { expect, test, type Page, type Route } from '@playwright/test';
import { expectParity } from '../../web/e2e/parity.js';

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const b64u = (n: number) => randomBytes(n).toString('base64url');
const PGP_KEY = '-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nmDMEZx2f\n-----END PGP PUBLIC KEY BLOCK-----';

/** The setup API as a fresh server answers it; `locked` flips when finish succeeds. */
async function stubSetup(page: Page): Promise<{ state: { locked: boolean; keys: number; calls: string[] } }> {
  const state = { locked: false, keys: 0, calls: [] as string[] };
  const userId = b64u(16);
  await page.route('**/staff/v1/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    state.calls.push(`${req.method()} ${path}`);
    const body = (req.postDataJSON() ?? {}) as Record<string, unknown>;
    switch (path) {
      case '/staff/v1/setup/finish':
        if (state.locked) return json({ error: 'setup-locked' }, 404)(route);
        // The probe (an empty body) while setup is open; the real finish carries the device label.
        if (!('deviceLabel' in body)) return json({ error: 'not-authenticated' }, 401)(route);
        state.locked = true;
        return json({ keyCheckCodes: ['K7M2-9QXA-4FTR-8WPN', 'J3HD-2LAX-9QPC-71MV'] })(route);
      case '/staff/v1/setup/code':
        return json({ ok: true, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() })(route);
      case '/staff/v1/setup/account':
        return json({ ok: true }, 201)(route);
      case '/staff/v1/setup/key/start':
        // Re-verify X2: the staff site derives the challenge from setupNonce itself.
        return json({
          challengeId: b64u(16),
          setupNonce: randomBytes(32).toString('hex'),
          options: {
            challenge: b64u(32),
            rp: { id: 'localhost', name: 'X2F Staff' },
            user: { id: userId, name: 'owner', displayName: 'owner' },
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
            timeout: 60_000,
            attestation: 'direct',
            authenticatorSelection: { authenticatorAttachment: 'cross-platform', residentKey: 'discouraged', userVerification: 'preferred' },
            excludeCredentials: [],
          },
        })(route);
      case '/staff/v1/setup/key/finish':
        state.keys += 1;
        return json({ keys: state.keys }, 201)(route);
      case '/staff/v1/setup/pgp/start':
        return json({ challengeId: b64u(16), encryptedMessage: '-----BEGIN PGP MESSAGE-----\n\nwV4D\n-----END PGP MESSAGE-----', expiresAt: new Date(Date.now() + 600_000).toISOString() })(route);
      case '/staff/v1/setup/pgp/finish':
        return json({ fingerprint: 'F'.repeat(40) }, 201)(route);
      default:
        // Signed out: the owner-keys read on the locked page, and anything else.
        return json({ error: 'not-authenticated' }, 401)(route);
    }
  });
  return { state };
}

/** Two virtual USB security keys' worth of taps: Chromium's virtual authenticator (CDP). */
async function softKeys(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'usb', hasResidentKey: false, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
}

test('the owner completes setup with two soft keys; a reload shows the page as locked; no CSP violation, no other origin', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const violations: string[] = [];
  const foreign: string[] = [];
  page.on('console', (m) => {
    if (/content security policy/i.test(m.text())) violations.push(m.text());
  });
  page.on('request', (r) => {
    if (new URL(r.url()).origin !== origin) foreign.push(r.url());
  });
  const { state } = await stubSetup(page);
  await softKeys(page);

  const res = await page.goto('/setup');
  expect(res?.headers()['content-security-policy']).toContain("default-src 'none'");
  await expect(page.locator('[data-screen="owner-setup"][data-state="open"]')).toBeVisible();
  const create = page.getByRole('button', { name: 'Create owner account' });
  await expect(create).toBeDisabled();

  await page.getByRole('textbox', { name: 'Setup code', exact: true }).fill('7QX4-MP2D-91KA');
  await page.getByRole('button', { name: 'Check code' }).click();
  await expect(page.locator('[data-part="code-ok"]')).toHaveText('Code accepted');
  await page.getByRole('textbox', { name: 'Username', exact: true }).fill('lumen.k');
  await page.getByRole('textbox', { name: 'Login name', exact: true }).fill('lumen-login');

  const slots = page.locator('[data-part="key-slot"]');
  await slots.nth(0).getByRole('button', { name: 'Tap key to register' }).click();
  await expect(slots.nth(0)).toHaveAttribute('data-done', 'true');
  await expect(create).toBeDisabled();
  await slots.nth(1).getByRole('button', { name: 'Tap key to register' }).click();
  await expect(slots.nth(1)).toHaveAttribute('data-done', 'true');
  expect(state.keys).toBe(2);
  await expect(create).toBeDisabled();

  await page.getByRole('button', { name: 'Add PGP key' }).click();
  await page.getByRole('textbox', { name: 'Your PGP public key', exact: true }).fill(PGP_KEY);
  await page.getByRole('button', { name: 'Send message' }).click();
  await page.getByRole('textbox', { name: 'Code from the message', exact: true }).fill('5555');
  await page.getByRole('button', { name: 'Check code' }).click();
  await expect(page.locator('[data-part="pgp-ok"]')).toBeVisible();
  await expect(create).toBeEnabled();
  await create.click();
  await expect(page.locator('[data-screen="owner-setup"][data-state="locked"]')).toBeVisible();
  await expect(page.locator('[data-part="key-check-codes"] li')).toHaveText(['K7M2-9QXA-4FTR-8WPN', 'J3HD-2LAX-9QPC-71MV']);

  await page.reload();
  await expect(page.locator('[data-screen="owner-setup"][data-state="locked"]')).toBeVisible();
  // Signed out after a reload: the locked page without the codes.
  await expect(page.locator('[data-part="key-check-codes"]')).toHaveCount(0);
  expect(state.calls.filter((c) => c === 'POST /staff/v1/setup/account')).toHaveLength(1);
  expect(violations).toEqual([]);
  expect(foreign).toEqual([]);
});

/**
 * The board's step 4 (redrawn in b427426e) makes the PGP key required: "Required: the owner logs in
 * with this key. It also receives encrypted staff alerts and signs important rulings." The built
 * page follows A9 with its own sentence ("Add your PGP public key. The owner logs in with it
 * together with a security key."), marked OWNER-Q in OwnerSetup.tsx: the owner owns that copy, so
 * this board line is the known difference until he picks one. Any other difference fails.
 */
const KNOWN_A9 = [
  'board copy missing: "Required: the owner logs in with this key. It also receives encrypted staff alerts and signs important rulings."',
];

test('OwnerSetup parity at the board size, the code and username inputs masked', async ({ page }) => {
  await stubSetup(page);
  await page.goto('/setup');
  await expect(page.locator('[data-screen="owner-setup"][data-state="open"]')).toBeVisible();
  // The board shows step 1 done.
  const code = page.getByRole('textbox', { name: 'Setup code', exact: true });
  await code.fill('7QX4-MP2D-91KA');
  await page.getByRole('button', { name: 'Check code' }).click();
  await expect(page.locator('[data-part="code-ok"]')).toHaveText('Code accepted');
  await page.evaluate(() => document.fonts.ready);
  let failures: string[] = [];
  try {
    await expectParity(page, 'OwnerSetup', { masks: [code, page.getByRole('textbox', { name: 'Username', exact: true })] });
  } catch (e) {
    failures = String((e as Error).message).split('\n  - ').slice(1).map((l) => l.trim());
  }
  expect(failures.filter((f) => !KNOWN_A9.includes(f))).toEqual([]);
});
