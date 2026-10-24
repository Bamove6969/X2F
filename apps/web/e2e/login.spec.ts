// Login screen (Task 30): one login per method, the generic password error and the leave-the-site
// guard, an expired session returning to the same screen, and a stale-Terms login seeing the Terms
// screen first. WebAuthn (passkey, security key) runs against a CDP virtual authenticator — the
// browser stand-in for Plan 2's soft authenticator. The API is stubbed per test with page.route.
import { expect, test, type CDPSession, type Page, type Route } from '@playwright/test';

const PGP_MESSAGE = '-----BEGIN PGP MESSAGE-----\n\nwcBMA0test\n-----END PGP MESSAGE-----\n';
const FAKE_KEY = '-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nmDMEtest\n-----END PGP PUBLIC KEY BLOCK-----\n';

type Overview = Record<string, unknown>;
function overview(over: Overview = {}): Overview {
  return {
    username: 'nightowl',
    kind: 'trader',
    level: 'full',
    holdUntil: null,
    methods: ['password', 'passkey'],
    hasBackup: true,
    suggestions: [],
    payoutWait: { enabled: false, offAt: null },
    termsCurrent: true,
    ...over,
  };
}

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

// WebAuthn refuses an IP address as the relying party, so the WebAuthn tests open the app on
// `localhost` (the same server; a secure context in Chromium).
const LOCAL = `http://localhost:${process.env.X2F_E2E_PORT ?? 4317}`;

const AUTH_OPTIONS = {
  challenge: 'dGVzdGNoYWxsZW5nZQ',
  timeout: 60_000,
  rpId: 'localhost',
  allowCredentials: [] as unknown[],
  userVerification: 'preferred',
};

/** A CDP virtual authenticator with one discoverable (resident) credential for this origin. */
async function virtualAuthenticator(page: Page): Promise<CDPSession> {
  const client = await page.context().newCDPSession(page);
  await client.send('WebAuthn.enable');
  await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  await page.evaluate(async () => {
    await navigator.credentials.create({
      publicKey: {
        challenge: new Uint8Array([1, 2, 3, 4]),
        rp: { name: 'X2F', id: location.hostname },
        user: { id: new Uint8Array([7, 7, 7]), name: 'nightowl', displayName: 'nightowl' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        timeout: 10_000,
      },
    });
  });
  return client;
}

test('PGP login (paste key, decrypt message, paste code) lands on returnTo', async ({ page }) => {
  await page.route('**/v1/account/me', json(overview()));
  await page.route('**/v1/login/pgp/start', json({ challengeId: 'c1', encryptedMessage: PGP_MESSAGE, expiresAt: '2099-01-01T00:00:00.000Z' }));
  await page.route('**/v1/login/pgp/finish', json({ status: 'ok' }));

  await page.goto('/login?returnTo=%2Fbuy');
  await page.click('[data-method="pgp"]');
  await page.fill('#pgp-key', FAKE_KEY);
  await page.click('text=Send me a login message');
  await expect(page.locator('[data-part="pgp-message"]')).toContainText('BEGIN PGP MESSAGE');
  await page.fill('[aria-label="Login code"]', '12345678');
  await page.click('[data-part="pgp-login"]');
  await expect(page).toHaveURL(/\/buy$/);
});

test('password login with an authenticator step lands on the default screen', async ({ page }) => {
  await page.route('**/v1/account/me', json(overview()));
  await page.route('**/v1/login/password', json({ status: 'second-factor', pendingId: 'p1', needs: ['totp'] }));
  await page.route('**/v1/login/second-factor', json({ status: 'ok' }));

  await page.goto('/login');
  await page.click('[data-method="password"]');
  await page.fill('#login-name', 'nightowl');
  await page.fill('#login-password', 'Correct-Horse-9!');
  await page.click('[data-part="password-login"]');
  await page.fill('#login-totp', '123456');
  await page.click('[data-part="verify-totp"]');
  await expect(page).toHaveURL(/\/sell$/);
});

test('a wrong login name and a wrong password both give the one generic error', async ({ page }) => {
  await page.route('**/v1/account/me', json(overview(), 401));
  await page.route('**/v1/login/password', json({ error: 'credentials-invalid' }, 401));

  await page.goto('/login');
  await page.click('[data-method="password"]');

  await page.fill('#login-name', 'does-not-exist');
  await page.fill('#login-password', 'whatever-1!');
  await page.click('[data-part="password-login"]');
  await expect(page.locator('[data-part="login-error"]')).toHaveText("That login name and password don't match");

  await page.fill('#login-name', 'nightowl');
  await page.fill('#login-password', 'wrong-pass-2!');
  await page.click('[data-part="password-login"]');
  await expect(page.locator('[data-part="login-error"]')).toHaveText("That login name and password don't match");
});

test('about ten password misses in a row send the visitor off the site', async ({ page }) => {
  await page.route('**/v1/account/me', json(overview(), 401));
  await page.route('**/v1/login/password', json({ error: 'credentials-invalid' }, 401));
  // Keep the leave-the-site navigation offline.
  await page.route('https://duckduckgo.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' }));

  await page.goto('/login');
  await page.click('[data-method="password"]');
  await page.fill('#login-name', 'nightowl');
  await page.fill('#login-password', 'wrong-1!');
  for (let i = 0; i < 9; i++) {
    await page.click('[data-part="password-login"]');
    await expect(page.locator('[data-part="password-login"]')).toBeEnabled();
  }
  // Nine misses: still here, with the same generic answer.
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator('[data-part="login-error"]')).toHaveText("That login name and password don't match");
  await page.click('[data-part="password-login"]');
  await expect(page).toHaveURL(/^https:\/\/duckduckgo\.com\//);
});

test('passkey login via the virtual authenticator lands on returnTo', async ({ page }) => {
  await page.route('**/v1/account/me', json(overview()));
  await page.route('**/v1/login/webauthn/start', json({ challengeId: 'w1', options: AUTH_OPTIONS }));
  await page.route('**/v1/login/webauthn/finish', json({ status: 'ok' }));

  await page.goto(`${LOCAL}/login?returnTo=%2Fbuy`);
  await virtualAuthenticator(page);
  await page.click('[data-method="passkey"]');
  await page.click('[data-part="passkey-login"]');
  await expect(page).toHaveURL(/\/buy$/);
});

test('security-key login by login name via the virtual authenticator lands on returnTo', async ({ page }) => {
  await page.route('**/v1/account/me', json(overview()));
  await page.route('**/v1/login/webauthn/start', json({ challengeId: 'w1', options: AUTH_OPTIONS }));
  await page.route('**/v1/login/webauthn/finish', json({ status: 'ok' }));

  await page.goto(`${LOCAL}/login?returnTo=%2Fbuy`);
  await virtualAuthenticator(page);
  await page.click('[data-method="security-key"]');
  await page.fill('#sk-login-name', 'nightowl');
  await page.click('[data-part="security-key-login"]');
  await expect(page).toHaveURL(/\/buy$/);
});

test('recovery-code backup login lands on the default screen', async ({ page }) => {
  await page.route('**/v1/account/me', json(overview()));
  await page.route('**/v1/login/backup', json({ status: 'ok', level: 'recovery', holdUntil: null }));

  await page.goto('/login/backup');
  await page.fill('#backup-login-name', 'nightowl');
  await page.fill('#backup-code', 'abcd-efgh-ij');
  await page.click('[data-part="backup-login"]');
  await expect(page).toHaveURL(/\/sell$/);
});

test('an expired session routes to /login and returns to the same screen after login', async ({ page }) => {
  let loggedIn = false;
  const gate = (body: unknown) => (r: Route) =>
    loggedIn ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }) : r.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'not-authenticated' }) });

  await page.route('**/v1/account/me', gate(overview()));
  await page.route('**/v1/account/methods', gate([]));
  await page.route('**/v1/account/sessions', gate([]));
  await page.route('**/v1/account/alerts', gate([]));
  await page.route('**/v1/login/webauthn/start', json({ challengeId: 'w1', options: AUTH_OPTIONS }));
  await page.route('**/v1/login/webauthn/finish', json({ status: 'ok' }));

  await page.goto(`${LOCAL}/settings/security`);
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fsettings%2Fsecurity$/);

  await virtualAuthenticator(page);
  loggedIn = true;
  await page.click('[data-method="passkey"]');
  await page.click('[data-part="passkey-login"]');
  await expect(page).toHaveURL(/\/settings\/security$/);
});

test('a login on a stale Terms version shows the Terms screen first', async ({ page }) => {
  await page.route('**/v1/account/me', json(overview({ termsCurrent: false })));
  await page.route('**/v1/login/webauthn/start', json({ challengeId: 'w1', options: AUTH_OPTIONS }));
  await page.route('**/v1/login/webauthn/finish', json({ status: 'ok' }));

  await page.goto(`${LOCAL}/login?returnTo=%2Fbuy`);
  await virtualAuthenticator(page);
  await page.click('[data-method="passkey"]');
  await page.click('[data-part="passkey-login"]');
  await expect(page).toHaveURL(/\/terms\?returnTo=%2Fbuy$/);
});
