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
    displayName: 'nightowl',
    kind: 'trader',
    level: 'full',
    holdUntil: null,
    methods: ['password', 'passkey'],
    hasBackup: true,
    suggestions: [],
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

test('an outage or a wait is not a miss: a neutral retry or the wait, and ten of them keep the visitor here', async ({ page }) => {
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
  for (let i = 1; i <= 10; i++) {
    await page.click('[data-part="password-login"]');
    // Odd tries get the 429 (re-review item 3: say how long), even ones the 503.
    await expect(page.locator('[data-part="login-error"]')).toHaveText(
      i % 2 === 1 ? 'Too many tries. Try again in 1 minute.' : 'X2F could not check that just now. Try again in a moment.',
    );
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
  await expect(page.locator('[role="alert"]')).toContainText("don't match");
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

// Task 30 re-review (items 2, 3, 4).

test('PGP login: an expired or revoked key is turned away with the reason, a wait says how long', async ({ page }) => {
  await page.route('**/v1/account/me', json(overview(), 401));
  const answers = [json({ error: 'key-expired' }, 400), json({ error: 'key-revoked' }, 400), json({ error: 'slow-down', retryAfterSeconds: 600 }, 429)];
  await page.route('**/v1/login/pgp/start', (r) => answers.shift()!(r));
  await page.goto('/login');
  await page.click('[data-method="pgp"]');
  await page.fill('#pgp-key', FAKE_KEY);
  await page.click('text=Send me a login message');
  await expect(page.locator('[role="alert"]')).toHaveText('That key has expired. Extend it in your PGP app, then paste it again.');
  await page.click('text=Send me a login message');
  await expect(page.locator('[role="alert"]')).toHaveText('That key has been revoked, so it cannot be used to log in. Use a key that is still valid.');
  await page.click('text=Send me a login message');
  await expect(page.locator('[role="alert"]')).toHaveText('Too many tries. Try again in 10 minutes.');
});

test('PGP login: an expired message says so (not "wrong code") and a new message starts again', async ({ page }) => {
  await page.route('**/v1/account/me', json(overview(), 401));
  await page.route('**/v1/login/pgp/start', json({ challengeId: 'c1', encryptedMessage: PGP_MESSAGE, expiresAt: '2099-01-01T00:00:00.000Z' }));
  await page.route('**/v1/login/pgp/finish', json({ error: 'challenge-expired' }, 400));
  await page.goto('/login');
  await page.click('[data-method="pgp"]');
  await page.fill('#pgp-key', FAKE_KEY);
  await page.click('text=Send me a login message');
  await page.fill('[aria-label="Login code"]', '11111111');
  await page.click('[data-part="pgp-login"]');
  await expect(page.locator('[role="alert"]')).toHaveText('That message has expired. Send a new message and try again.');
  await expect(page.locator('[data-part="pgp-new-message"]')).toBeVisible();
});

test('password login: too many tries says how long to wait, not that the password was wrong', async ({ page }) => {
  await page.route('**/v1/account/me', json(overview(), 401));
  await page.route('**/v1/login/password', json({ error: 'locked', retryAfterSeconds: 900 }, 429));
  await page.goto('/login');
  await page.click('[data-method="password"]');
  await page.fill('#login-name', 'nightowl');
  await page.fill('#login-password', 'Some-Password-1!');
  await page.click('[data-part="password-login"]');
  await expect(page.locator('[data-part="login-error"]')).toHaveText('Too many tries. Try again in 15 minutes.');
});

test('security-key login: a second step that needs PGP asks for the PGP key, with the pendingId', async ({ page }) => {
  await page.route('**/v1/account/me', json(overview()));
  await page.route('**/v1/login/webauthn/start', json({ challengeId: 'w1', options: AUTH_OPTIONS }));
  await page.route('**/v1/login/webauthn/finish', json({ status: 'second-factor', pendingId: 'p7', needs: ['pgp'] }));
  let pgpStart: unknown = null;
  await page.route('**/v1/login/pgp/start', (r) => {
    pgpStart = JSON.parse(r.request().postData() ?? '{}');
    return json({ challengeId: 'c1', encryptedMessage: PGP_MESSAGE, expiresAt: '2099-01-01T00:00:00.000Z' })(r);
  });
  await page.route('**/v1/login/pgp/finish', json({ status: 'ok' }));

  await page.goto(`${LOCAL}/login?returnTo=%2Fbuy`);
  await virtualAuthenticator(page);
  await page.click('[data-method="security-key"]');
  await page.fill('#sk-login-name', 'nightowl');
  await page.click('[data-part="security-key-login"]');
  await expect(page.locator('[data-part="second-step"]')).toContainText('This account also needs its PGP key.');
  await expect(page.locator('[data-part="security-key-login"]')).toHaveCount(0);
  await page.fill('#pgp-key', FAKE_KEY);
  await page.click('text=Send me a login message');
  expect(pgpStart).toEqual({ key: FAKE_KEY.trim(), pendingId: 'p7' });
  await page.fill('[aria-label="Login code"]', '22222222');
  await page.click('[data-part="pgp-login"]');
  await expect(page).toHaveURL(/\/buy$/);
});

test('a TOTP backup login says when changes can be made, then carries on', async ({ page }) => {
  await page.route('**/v1/account/me', json(overview({ level: 'recovery', holdUntil: '2099-01-02T15:00:00.000Z' })));
  await page.route('**/v1/login/backup', json({ status: 'ok', level: 'recovery', holdUntil: '2099-01-02T15:00:00.000Z' }));
  await page.goto('/login/backup?returnTo=%2Fbuy');
  await page.click('[data-kind="totp"]');
  await page.fill('#backup-login-name', 'nightowl');
  await page.fill('#backup-code', '123456');
  await page.click('[data-part="backup-login"]');
  await expect(page.locator('[data-part="hold-note"]')).toContainText('Your account is on a 24-hour hold');
  await expect(page).toHaveURL(/\/login\/backup/);
  await page.click('[data-part="hold-continue"]');
  await expect(page).toHaveURL(/\/buy$/);
});

test('the TOTP backup daily cap says when to try again', async ({ page }) => {
  await page.route('**/v1/account/me', json(overview(), 401));
  await page.route('**/v1/login/backup', json({ error: 'slow-down', retryAfterSeconds: 5 * 3600 }, 429));
  await page.goto('/login/backup');
  await page.click('[data-kind="totp"]');
  await page.fill('#backup-login-name', 'nightowl');
  await page.fill('#backup-code', '123456');
  await page.click('[data-part="backup-login"]');
  await expect(page.locator('[role="alert"]')).toContainText('Too many tries. Try again after');
});

// Plan 2 Task 16: a login from a new device while the account is logged in elsewhere waits for
// that device's approval: this browser shows the number and polls until it is let in.
test('new-device approval: the number shows, the poll lets it in, and Continue goes on', async ({ page }) => {
  await page.route('**/v1/account/me', json(overview()));
  const id = '11111111-1111-4111-8111-111111111111';
  await page.route('**/v1/login/password', json({
    status: 'approve-on-device', approvalId: id, number: 47,
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
  }));
  let polls = 0;
  await page.route(`**/v1/login/approval/${id}/poll`, (r) => {
    polls++;
    return json(polls < 2 ? { status: 'waiting', expiresAt: new Date(Date.now() + 60_000).toISOString() } : { status: 'ok', loggedOut: [] })(r);
  });

  await page.goto('/login?returnTo=%2Fbuy');
  await page.click('[data-method="password"]');
  await page.fill('#login-name', 'nightowl');
  await page.fill('#login-password', 'Correct-Horse-9!');
  await page.click('[data-part="password-login"]');
  await expect(page.locator('[data-part="approve-number"]')).toHaveText('47');
  // Review M5: nothing about the account's devices before approval.
  await expect(page.locator('[data-part="approve-room"]')).toHaveCount(0);
  await expect(page.locator('[data-part="approve-in"]')).toBeVisible();
  await page.click('[data-part="approve-continue"]');
  await expect(page).toHaveURL(/\/buy$/);
});

test('new-device approval: a blocked login says so and offers a backup login', async ({ page }) => {
  const id = '22222222-2222-4222-8222-222222222222';
  await page.route('**/v1/login/password', json({
    status: 'approve-on-device', approvalId: id, number: 12,
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
  }));
  await page.route(`**/v1/login/approval/${id}/poll`, json({ status: 'blocked' }));
  await page.goto('/login');
  await page.click('[data-method="password"]');
  await page.fill('#login-name', 'nightowl');
  await page.fill('#login-password', 'Correct-Horse-9!');
  await page.click('[data-part="password-login"]');
  await expect(page.locator('[data-part="approve-blocked"]')).toContainText('This login was blocked');
  await page.click('[data-part="approve-retry"]');
  await expect(page.locator('[data-method="password"]')).toBeVisible();
});

// Plan 2 Task 17 review round 3 (R3-M3, R3-M4): a login refused during the hold opens CantDoThat
// with a sentence for this login (a login is never refused by the device limit any more).
test('a login refused during the 24-hour hold opens CantDoThat: this login waits until the hold ends', async ({ page }) => {
  await page.route('**/v1/login/password', json({ error: 'recovery-hold', holdUntil: '2099-01-02T15:00:00.000Z' }, 403));
  await page.goto('/login');
  await page.click('[data-method="password"]');
  await page.fill('#login-name', 'nightowl');
  await page.fill('#login-password', 'Correct-Horse-9!');
  await page.click('[data-part="password-login"]');
  const popup = page.locator('[role="dialog"] [data-part="cant-do-that"]');
  await expect(popup).toHaveAttribute('data-from', 'recovery-hold');
  await expect(popup).toContainText("This login can't get in until");
  await expect(popup).not.toContainText('can still be finished');
  await expect(page.locator('[data-part="login-error"]')).toHaveCount(0);
});
