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
  let startBody: unknown = null;
  await page.route('**/v1/login/pgp/start', (r) => {
    startBody = JSON.parse(r.request().postData() ?? '{}');
    return json({ challengeId: 'c1', encryptedMessage: PGP_MESSAGE, expiresAt: '2099-01-01T00:00:00.000Z' })(r);
  });
  await page.route('**/v1/login/pgp/finish', json({ status: 'ok' }));

  await page.goto('/login?returnTo=%2Fbuy');
  await page.click('[data-method="pgp"]');
  await page.fill('#pgp-key', FAKE_KEY);
  await page.click('text=Send me a login message');
  await expect(page.locator('[data-part="pgp-message"]')).toContainText('BEGIN PGP MESSAGE');
  await page.fill('[aria-label="Login code"]', '12345678');
  await page.click('[data-part="pgp-login"]');
  await expect(page).toHaveURL(/\/buy$/);
  // FU-A: PGP login takes the key alone, never a login name.
  expect(startBody).toEqual({ key: FAKE_KEY.trim() });
});

test('PGP login: an expired code offers a new message, and a second step goes on to the security key', async ({ page }) => {
  await page.route('**/v1/account/me', json(overview()));
  let starts = 0;
  await page.route('**/v1/login/pgp/start', (r) => {
    starts += 1;
    return json({ challengeId: `c${starts}`, encryptedMessage: `${PGP_MESSAGE}#${starts}`, expiresAt: '2099-01-01T00:00:00.000Z' })(r);
  });
  let finishes = 0;
  await page.route('**/v1/login/pgp/finish', (r) => {
    finishes += 1;
    return finishes === 1
      ? json({ error: 'challenge-expired' }, 401)(r)
      : json({ status: 'second-factor', pendingId: 'p9', needs: ['security-key'] })(r);
  });
  let webauthnStart: unknown = null;
  await page.route('**/v1/login/webauthn/start', (r) => {
    webauthnStart = JSON.parse(r.request().postData() ?? '{}');
    return json({ challengeId: 'w1', options: AUTH_OPTIONS })(r);
  });
  await page.route('**/v1/login/webauthn/finish', json({ status: 'ok' }));

  await page.goto(`${LOCAL}/login?returnTo=%2Fbuy`);
  await virtualAuthenticator(page);
  await page.click('[data-method="pgp"]');
  await page.fill('#pgp-key', FAKE_KEY);
  await page.click('text=Send me a login message');
  await page.fill('[aria-label="Login code"]', '11111111');
  await page.click('[data-part="pgp-login"]');
  await page.click('[data-part="pgp-new-message"]');
  await expect(page.locator('[data-part="pgp-message"]')).toContainText('#2');

  await page.fill('[aria-label="Login code"]', '22222222');
  await page.click('[data-part="pgp-login"]');
  await page.click('[data-part="second-step-key"]');
  await expect(page).toHaveURL(/\/buy$/);
  expect(webauthnStart).toEqual({ pendingId: 'p9' });
});

test('password login with an authenticator step lands on the default screen', async ({ page }) => {
  await page.route('**/v1/account/me', json(overview()));
  let body: unknown = null;
  await page.route('**/v1/login/password', (r) => {
    body = JSON.parse(r.request().postData() ?? '{}');
    return json({ status: 'second-factor', pendingId: 'p1', needs: ['totp'] })(r);
  });
  await page.route('**/v1/login/second-factor', json({ status: 'ok' }));

  await page.goto('/login');
  await page.click('[data-method="password"]');
  await page.fill('#login-name', 'nightowl');
  await page.fill('#login-password', 'Correct-Horse-9!');
  await page.click('[data-part="password-login"]');
  await page.fill('#login-totp', '123456');
  await page.click('[data-part="verify-totp"]');
  await expect(page).toHaveURL(/\/sell$/);
  // FU-A: the private login name goes as `loginName`.
  expect(body).toMatchObject({ loginName: 'nightowl', password: 'Correct-Horse-9!' });
});

test('a wrong login name and a wrong password both give the one generic error', async ({ page }) => {
  await page.route('**/v1/account/me', json(overview(), 401));
  await page.route('**/v1/login/password', json({ error: 'credentials-invalid', misses: 1 }, 401));

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

test('the server miss count sends the visitor off the site, even across a method switch', async ({ page }) => {
  // The server counts misses per browser (FU-A), so switching method or reloading never resets it.
  let misses = 0;
  await page.route('**/v1/account/me', json(overview(), 401));
  await page.route('**/v1/login/password', (r) => {
    misses += 1;
    return json({ error: 'credentials-invalid', misses }, 401)(r);
  });
  await page.route('https://duckduckgo.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' }));

  const tryOnce = async () => {
    await page.fill('#login-name', 'nightowl');
    await page.fill('#login-password', 'wrong-1!');
    await page.click('[data-part="password-login"]');
  };
  await page.goto('/login');
  await page.click('[data-method="password"]');
  for (let i = 0; i < 5; i++) {
    await tryOnce();
    await expect(page.locator('[data-part="login-error"]')).toHaveText("That login name and password don't match");
  }
  await page.click('[data-part="back"]');
  await page.click('[data-method="password"]');
  await page.reload();
  await page.click('[data-method="password"]');
  for (let i = 0; i < 4; i++) {
    await tryOnce();
    await expect(page.locator('[data-part="password-login"]')).toBeEnabled();
  }
  await expect(page).toHaveURL(/\/login$/);
  await tryOnce();
  await expect(page).toHaveURL(/^https:\/\/duckduckgo\.com\//);
});

test('an outage is not a miss: a neutral retry message, and ten of them keep the visitor here', async ({ page }) => {
  await page.route('**/v1/account/me', json(overview(), 401));
  let n = 0;
  await page.route('**/v1/login/password', (r) => {
    n += 1;
    return n % 2 === 0 ? json({ error: 'busy' }, 503)(r) : json({ error: 'slow-down', retryAfterSeconds: 5 }, 429)(r);
  });

  await page.goto('/login');
  await page.click('[data-method="password"]');
  await page.fill('#login-name', 'nightowl');
  await page.fill('#login-password', 'Correct-Horse-9!');
  for (let i = 0; i < 10; i++) {
    await page.click('[data-part="password-login"]');
    await expect(page.locator('[data-part="login-error"]')).toHaveText('X2F could not check that just now. Try again in a moment.');
  }
  await expect(page).toHaveURL(/\/login$/);
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

test('a wrong backup code says so on the backup screen and does not redirect', async ({ page }) => {
  await page.route('**/v1/account/me', json(overview(), 401));
  await page.route('**/v1/login/backup', json({ error: 'credentials-invalid' }, 401));

  await page.goto('/login/backup?returnTo=%2Fbuy');
  await page.fill('#backup-login-name', 'nightowl');
  await page.fill('#backup-code', 'wrong-code-00');
  await page.click('[data-part="backup-login"]');
  await expect(page.locator('[role="alert"]')).toContainText('don\u2019t match');
  await expect(page).toHaveURL(/\/login\/backup\?returnTo=%2Fbuy$/);
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
