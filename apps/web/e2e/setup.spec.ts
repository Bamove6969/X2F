// Getting started (Plan 3 Task 28): Terms first, then names, login method, PGP key and code or a
// password, the recovery codes (required: shown, ticked and one typed back, owner S-017), an
// optional extra backup (or Skip for now), the first payout wallet, and Welcome with Start
// trading back to `returnTo`. Owner G25 (6 Nov 2026): right after sign-up, Start trading ends the
// sign-up session and goes to Log in (keeping `returnTo`); the login asks the session length, then
// goes on. Every Setup board is checked with the parity harness at the board's
// phone size (390x844) and at a small Android size (360x800) (owner 2026-10-25: mobile ready at
// launch). The API is stubbed per test with page.route, in FU-A's shapes (display name + private
// login name), as FU-A's API defines them (on the main line since 2026-10-28).
import { expect, test, type Page, type Route } from '@playwright/test';
import * as openpgp from 'openpgp';
import { BOARD_BUY_QUOTE as B } from '../src/fixtures/quoteBoard.js';
import { expectParity, type ParityViewport } from './parity.js';

const PHONES = ['390x844', '360x800'] as const satisfies readonly ParityViewport[];
const RECOVERY_CODES = Array.from({ length: 10 }, (_, i) => `ABCD-EFGH-JKMN-PQR${i}`);

/** Owner S-017: make the recovery codes, tick "I've written it down" and type back the code asked for. */
async function saveRecoveryCodes(page: Page): Promise<void> {
  await expect(page.locator('[data-part="backup-skip"]')).toHaveCount(0);
  await page.click('[data-part="recovery-make"]');
  const input = page.locator('#recovery-typeback');
  const n = Number(await input.getAttribute('data-code-number'));
  await expect(page.locator('[data-part="recovery-continue"]')).toBeDisabled();
  await page.check('[data-part="recovery-written"]');
  await input.fill(RECOVERY_CODES[n - 1]!);
  await page.click('[data-part="recovery-continue"]');
}

const TERMS_VERSION = '2026-11-09';
/** The board's example message (SetupPgpChallenge), so the page shows exactly the board's text. */
const BOARD_MESSAGE = '-----BEGIN PGP MESSAGE-----\nhF4DkR7c2x9mPq0SAQdA4vJ8u2Lk0aQz\nWm3n…\n-----END PGP MESSAGE-----';
/** A 95-character standard address ending like the board's example ("…k3Fz"). */
const ADDRESS = `4${'9'.repeat(90)}k3Fz`;
const TAKE = '/sell/zelle?take=offer-42';

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

let realKey = '';
test.beforeAll(async () => {
  // A real Ed25519 key that never expires, so the key check reads "Ed25519" and "Never" as on the board.
  const { publicKey } = await openpgp.generateKey({ type: 'ecc', curve: 'ed25519Legacy', userIDs: [{ name: 'Setup Test' }], format: 'armored' });
  realKey = publicKey;
});

interface Stub {
  registered: boolean;
  /** Logged in again after sign-up (G25): `me` then carries the session with its length question. */
  loggedIn: boolean;
  lengthHours: number | null;
  displayName: string;
  methods: string[];
  wallets: Record<string, unknown>[];
  termsCurrent: boolean;
  bodies: Record<string, unknown[]>;
  requests: string[];
}

/** The signed-out-until-registered API a new person meets. */
async function stubApi(page: Page, o: { signedIn?: boolean; methods?: string[]; wallets?: Record<string, unknown>[] } = {}): Promise<Stub> {
  const s: Stub = {
    registered: o.signedIn ?? false,
    loggedIn: false,
    lengthHours: null,
    displayName: 'nightowl',
    methods: o.methods ?? [],
    wallets: o.wallets ?? [],
    termsCurrent: true,
    bodies: {},
    requests: [],
  };
  const record = (name: string, r: Route) => {
    (s.bodies[name] ??= []).push(JSON.parse(r.request().postData() ?? 'null'));
  };
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/v1/')) s.requests.push(`${r.method()} ${u.pathname}`);
  });
  await page.route('**/v1/account/me', (r) =>
    s.registered
      ? json({
          displayName: s.displayName,
          loginNameSet: true,
          kind: 'trader',
          level: 'full',
          holdUntil: null,
          methods: s.methods,
          hasBackup: s.methods.length > 1,
          suggestions: [],
          termsCurrent: s.termsCurrent,
          ...(s.loggedIn ? { session: sessionInfo(s) } : {}),
        })(r)
      : json({ error: 'not-authenticated' }, 401)(r),
  );
  // G25: Start trading after sign-up logs out; the person then logs in with what they set up.
  await page.route('**/v1/logout', (r) => {
    s.registered = false;
    return json({ ok: true })(r);
  });
  await page.route('**/v1/login/password', (r) => {
    record('login-password', r);
    s.registered = true;
    s.loggedIn = true;
    return json({ status: 'ok' })(r);
  });
  await page.route('**/v1/account/session/length', (r) => {
    record('session-length', r);
    s.lengthHours = (JSON.parse(r.request().postData() ?? '{}') as { hours: number }).hours;
    return json(sessionInfo(s))(r);
  });
  await page.route('**/v1/terms', json({ version: TERMS_VERSION }));
  // The private username's live tick: every name is free unless it starts with "taken".
  await page.route('**/v1/register/name-check', (r) => {
    record('name-check', r);
    const b = JSON.parse(r.request().postData() ?? '{}') as { loginName: string };
    return json({ available: !b.loginName.startsWith('taken') })(r);
  });
  await page.route('**/v1/register/pgp/start', (r) => {
    record('pgp-start', r);
    return json({ challengeId: 'c1', encryptedMessage: BOARD_MESSAGE, expiresAt: '2099-01-01T00:00:00.000Z', fingerprint: '3F2A9C417B0ED5A261C80E4B92D71F6AC3B80D15' })(r);
  });
  await page.route('**/v1/register/pgp/finish', (r) => {
    record('pgp-finish', r);
    const b = s.bodies['pgp-start']?.at(-1) as { displayName: string };
    s.registered = true;
    s.displayName = b.displayName;
    s.methods = ['pgp'];
    return json({ displayName: b.displayName }, 201)(r);
  });
  await page.route('**/v1/register/password', (r) => {
    record('password', r);
    const b = JSON.parse(r.request().postData() ?? '{}') as { displayName: string };
    s.registered = true;
    s.displayName = b.displayName;
    s.methods = ['password'];
    return json({ displayName: b.displayName }, 201)(r);
  });
  await page.route('**/v1/account/recovery-codes', (r) => {
    record('recovery-codes', r);
    s.methods = [...s.methods, 'recovery-codes'];
    return json({ codes: RECOVERY_CODES })(r);
  });
  await page.route('**/v1/account/totp/start', (r) => {
    record('totp-start', r);
    return json({ challengeId: 't1', otpauthUri: 'otpauth://totp/X2F?secret=JBSWY3DPEHPK3PXP&issuer=X2F', secret: 'JBSWY3DPEHPK3PXP' })(r);
  });
  await page.route('**/v1/account/totp/finish', (r) => {
    record('totp-finish', r);
    s.methods = [...s.methods, 'totp'];
    return r.fulfill({ status: 204 });
  });
  await page.route('**/v1/wallets/rule', json({ firstWallet: s.wallets.length === 0, strongMethods: ['pgp'], password: 'none', waitHours: 24 }));
  await page.route('**/v1/wallets', (r) => {
    if (r.request().method() === 'GET') return json(s.wallets)(r);
    record('wallets', r);
    const b = JSON.parse(r.request().postData() ?? '{}') as { wallets: { app: string; label: string; address: string }[] };
    const added = b.wallets.map((w, i) => ({
      id: `00000000-0000-4000-8000-00000000000${i}`,
      app: w.app,
      label: w.label,
      address: w.address,
      addressEnd: w.address.slice(-4),
      usableFrom: '2026-10-25T00:00:00.000Z',
      usable: true,
    }));
    s.wallets.push(...added);
    return json(added, 201)(r);
  });
  return s;
}

function sessionInfo(s: Stub) {
  const now = Date.now();
  return {
    lengthHours: s.lengthHours,
    choices: [2, 4, 8, 12],
    expiresAt: new Date(now + (s.lengthHours ?? 2) * 3_600_000).toISOString(),
    canExtend: true,
    serverNow: new Date(now).toISOString(),
  };
}

async function setViewport(page: Page, v: ParityViewport): Promise<void> {
  const [width, height] = v.split('x').map(Number) as [number, number];
  await page.setViewportSize({ width, height });
}

/** Scrolls the Terms box to its end, as a reader would. */
async function readTermsToEnd(page: Page): Promise<void> {
  await page.locator('[data-part="terms-text"]').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
    el.dispatchEvent(new Event('scroll'));
  });
}

/** Draws an X on the signature pad with the mouse (owner, 8 Nov 2026: a scribble or an X is fine). */
async function signTerms(page: Page): Promise<void> {
  const pad = page.locator('[data-part="signature-pad"]');
  await pad.scrollIntoViewIfNeeded();
  const b = (await pad.boundingBox())!;
  const at = (fx: number, fy: number) => [b.x + b.width * fx, b.y + b.height * fy] as const;
  for (const [from, to] of [[at(0.2, 0.2), at(0.4, 0.7)], [at(0.4, 0.2), at(0.2, 0.7)]] as const) {
    await page.mouse.move(from[0], from[1]);
    await page.mouse.down();
    await page.mouse.move(to[0], to[1], { steps: 8 });
    await page.mouse.up();
  }
  await expect(pad).toHaveAttribute('data-empty', 'false');
}

/** What every accept carries with the version: a drawn signature (the X above). */
const DRAWN = expect.objectContaining({ kind: 'drawn', path: expect.stringMatching(/^M\d+ \d+(L\d+ \d+)+M\d+ \d+(L\d+ \d+)+$/) });

async function acceptTerms(page: Page): Promise<void> {
  await readTermsToEnd(page);
  await page.check('[data-part="terms-tick"]');
  await signTerms(page);
  await page.click('[data-part="terms-accept"]');
}

/** Step 1: the private username (with its tick), then the public display name on its own screen. */
async function pickNames(page: Page, display: string, login: string): Promise<void> {
  await page.fill('#uname', login);
  await expect(page.locator('[data-part="name-status"]')).toHaveText(`${login} is available`);
  await page.click('[data-part="names-continue"]');
  await expect(page.locator('[data-screen="setup-display-name"]')).toBeVisible();
  await page.fill('#display-name', display);
  await page.click('[data-part="display-continue"]');
}

for (const v of PHONES) {
  test(`the PGP path matches every Setup board at ${v} and Start trading goes to Log in, keeping the take (G25)`, async ({ page }) => {
    await setViewport(page, v);
    const s = await stubApi(page);

    await page.goto(`/setup?returnTo=${encodeURIComponent(TAKE)}`);
    await expect(page.locator('[data-screen="setup-terms"]')).toBeVisible();
    await acceptTerms(page);

    await expect(page).toHaveURL(/\/setup\/name\?/);
    // The URL changes before the router commits the new screen: wait for the screen itself.
    await expect(page.locator('[data-screen="setup-name"]')).toBeVisible();
    await expectParity(page, 'SetupUsername', { viewport: v });
    await pickNames(page, 'lumen.k', 'lumen-login-7');

    await expect(page).toHaveURL(/\/setup\/login\?/);
    // PGP is first and picked by default.
    await expect(page.locator('[role="radio"]').first()).toContainText('PGP key');
    await expect(page.locator('[role="radio"]').first()).toHaveAttribute('aria-checked', 'true');
    await expectParity(page, 'SetupLogin', { viewport: v });
    await page.click('[data-part="method-continue"]');

    await expect(page).toHaveURL(/\/setup\/pgp-key\?/);
    await page.fill('#pub', realKey);
    await expect(page.locator('[data-part="key-check"]')).toContainText('Ed25519');
    await expectParity(page, 'SetupPgpKey', { viewport: v });
    await page.click('[data-part="key-continue"]');

    await expect(page).toHaveURL(/\/setup\/pgp-code\?/);
    await expect(page.locator('[data-part="pgp-message"]')).toContainText('hF4DkR7c2x9mPq0SAQdA4vJ8u2Lk0aQz');
    await expectParity(page, 'SetupPgpChallenge', { viewport: v });
    await page.fill('#phrase', '1234-5678-9ABC');
    await page.click('[data-part="pgp-verify"]');
    await expect(page.locator('[aria-label="Key verified"]')).toBeVisible();
    await page.click('[data-part="pgp-continue"]');

    await expect(page).toHaveURL(/\/setup\/backup\?/);
    // The URL changes before the router commits the new screen: wait for the screen itself.
    await expect(page.locator('[data-screen="setup-backup"]')).toBeVisible();
    // Owner S-017: the recovery codes come first and are required; then the extras are optional.
    // The first view keeps the board's panel ("Your coins stay…"); the board is checked on the
    // optional view after it, which is the board's own choice (parity.ts SetupBackup exceptions).
    await expect(page.locator('[data-part="recovery-make"]')).toBeVisible();
    await expect(page.getByText("Your coins stay in your own wallet either way. Without a backup, you could lose this account and the reputation you've built on it.")).toBeVisible();
    await saveRecoveryCodes(page);
    await expect(page.locator('[data-part="backup-skip"]')).toBeVisible();
    await expectParity(page, 'SetupBackup', { viewport: v });
    // Design build gaps Job 1: no authenticator app as a backup.
    await expect(page.locator('[data-backup="totp"]')).toHaveCount(0);
    await expect(page.locator('[data-backup="security-key"]')).toHaveAttribute('aria-checked', 'true');
    await page.click('[data-part="backup-skip"]');

    await expect(page).toHaveURL(/\/setup\/wallet\?/);
    // The URL changes before the router commits the new screen: wait for the screen itself.
    await expect(page.locator('[data-screen="setup-wallet"]')).toBeVisible();
    await expectParity(page, 'SetupWallet', { viewport: v });
    await page.fill('#addr', ADDRESS);
    await page.click('[data-part="wallet-finish"]');

    await expect(page).toHaveURL(/\/setup\/welcome\?/);
    await expect(page.locator('h1')).toHaveText('Welcome to X2F, lumen.k');
    // Owner S-017: the backup login is the recovery codes saved on the backup step (parity.ts SetupWelcome).
    await expect(page.locator('[data-part="check-recovery"] [data-part="tick"]')).toHaveCount(1);
    await expectParity(page, 'SetupWelcome', { viewport: v });
    await page.click('[data-part="start-trading"]');
    // Owner G25: the sign-up session ends and Log in comes next, carrying the take on.
    await expect(page).toHaveURL(`/login?returnTo=${encodeURIComponent(TAKE)}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Log in');
    expect(s.requests).toContain('POST /v1/logout');

    // The register calls carry both names (FU-A), the accepted Terms version and the signature.
    expect(s.bodies['pgp-start']).toEqual([{ displayName: 'lumen.k', loginName: 'lumen-login-7', publicKey: realKey.trim() }]);
    expect(s.bodies['pgp-finish']).toEqual([
      expect.objectContaining({ challengeId: 'c1', code: '1234-5678-9ABC', acceptedTerms: TERMS_VERSION, termsSignature: DRAWN }),
    ]);
    // The first wallet goes with no confirm token and no confirm-it's-you call at all.
    expect(s.bodies.wallets).toEqual([{ wallets: [{ app: 'cake', label: 'Wallet 1', address: ADDRESS }] }]);
    expect(s.requests.filter((r) => r.includes('/v1/confirm/'))).toEqual([]);
  });

  test(`the password path matches SetupPassword at ${v}; the leaked list is the server's answer`, async ({ page }) => {
    await setViewport(page, v);
    const s = await stubApi(page);
    let tries = 0;
    await page.unroute('**/v1/register/password');
    await page.route('**/v1/register/password', (r) => {
      tries += 1;
      (s.bodies.password ??= []).push(JSON.parse(r.request().postData() ?? 'null'));
      if (tries === 1) return json({ error: 'password-leaked' }, 400)(r);
      s.registered = true;
      s.methods = ['password'];
      return json({ displayName: 'lumen.k' }, 201)(r);
    });

    await page.goto('/setup');
    await acceptTerms(page);
    await pickNames(page, 'lumen.k', 'lumen-login-7');
    await page.click('[data-method="password"]');
    await page.click('[data-part="method-continue"]');
    await expect(page).toHaveURL(/\/setup\/password\?/);

    const setBtn = page.locator('[data-part="password-set"]');
    await page.fill('#pw', 'short');
    await expect(setBtn).toBeDisabled();
    await page.fill('#pw', 'Orbit-lantern-74');
    await page.fill('#pw2', 'Orbit-lantern-7');
    await expect(setBtn).toBeDisabled();
    await page.fill('#pw2', 'Orbit-lantern-74');
    await expect(setBtn).toBeEnabled();
    await expectParity(page, 'SetupPassword', { viewport: v });

    await setBtn.click();
    await expect(page.locator('[data-rule="leaked"]')).toHaveAttribute('data-met', 'false');
    await expect(page).toHaveURL(/\/setup\/password\?/);
    await page.fill('#pw', 'Quiet-harbour-58');
    await page.fill('#pw2', 'Quiet-harbour-58');
    await setBtn.click();
    await expect(page).toHaveURL(/\/setup\/backup\?/);

    expect(s.bodies.password?.at(-1)).toMatchObject({
      displayName: 'lumen.k',
      loginName: 'lumen-login-7',
      password: 'Quiet-harbour-58',
      acceptedTerms: TERMS_VERSION,
      termsSignature: DRAWN,
    });
  });
}

test('I accept stays disabled until the Terms are scrolled to the end and ticked', async ({ page }) => {
  await stubApi(page);
  await page.goto('/setup');
  const tick = page.locator('[data-part="terms-tick"]');
  const accept = page.locator('[data-part="terms-accept"]');
  await expect(accept).toBeVisible();
  await expect(tick).toBeDisabled();
  await expect(accept).toBeDisabled();

  // Half way is not the end.
  await page.locator('[data-part="terms-text"]').evaluate((el) => {
    el.scrollTop = Math.floor((el.scrollHeight - el.clientHeight) / 2);
    el.dispatchEvent(new Event('scroll'));
  });
  await expect(tick).toBeDisabled();
  await expect(accept).toBeDisabled();

  await readTermsToEnd(page);
  await expect(tick).toBeEnabled();
  await expect(accept).toBeDisabled();
  await page.check('[data-part="terms-tick"]');
  // The tick alone is not enough: a signature too (owner, 8 Nov 2026).
  await expect(accept).toBeDisabled();
  await signTerms(page);
  await expect(accept).toBeEnabled();
  await page.uncheck('[data-part="terms-tick"]');
  await expect(accept).toBeDisabled();
  await page.check('[data-part="terms-tick"]');
  await expect(accept).toBeEnabled();
  await page.click('[data-part="signature-clear"]');
  await expect(page.locator('[data-part="signature-pad"]')).toHaveAttribute('data-empty', 'true');
  await expect(accept).toBeDisabled();
});

test('the signature pad: drawn by touch, or a typed name by keyboard only; the setup sends it once', async ({ page }) => {
  const s = await stubApi(page);
  await page.goto('/setup');
  const accept = page.locator('[data-part="terms-accept"]');
  await readTermsToEnd(page);
  await page.check('[data-part="terms-tick"]');

  // A finger: touch pointer events draw a mark too.
  {
    const pad = page.locator('[data-part="signature-pad"]');
    await pad.scrollIntoViewIfNeeded();
    const b = (await pad.boundingBox())!;
    await pad.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 7, isPrimary: true, button: 0, clientX: b.x + 20, clientY: b.y + 20 });
    await pad.dispatchEvent('pointermove', { pointerType: 'touch', pointerId: 7, isPrimary: true, clientX: b.x + 60, clientY: b.y + 50 });
    await pad.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 7, isPrimary: true, clientX: b.x + 60, clientY: b.y + 50 });
    await expect(pad).toHaveAttribute('data-empty', 'false');
    await expect(accept).toBeEnabled();
    await page.click('[data-part="signature-clear"]');
    await expect(accept).toBeDisabled();
  }

  // Keyboard only: Tab to "Type your name to sign", type the name, Tab on to I accept.
  await page.locator('[data-part="signature-type"]').focus();
  await page.keyboard.press('Enter');
  const name = page.getByLabel('Type your name to sign');
  await expect(name).toBeFocused();
  await page.keyboard.type('Lumen K');
  await expect(accept).toBeEnabled();
  await accept.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/setup\/name\?/);

  await pickNames(page, 'lumen.k', 'lumen-login-7');
  await page.click('[data-method="password"]');
  await page.click('[data-part="method-continue"]');
  await page.fill('#pw', 'Quiet-harbour-58');
  await page.fill('#pw2', 'Quiet-harbour-58');
  await page.click('[data-part="password-set"]');
  await expect(page).toHaveURL(/\/setup\/backup\?/);
  expect(s.bodies.password).toEqual([expect.objectContaining({ acceptedTerms: TERMS_VERSION, termsSignature: { kind: 'typed', name: 'Lumen K' } })]);
});

test('Mira.K_ shows exactly as typed after setup (password path, extra backup skipped)', async ({ page }) => {
  const s = await stubApi(page);
  const urls: string[] = [];
  page.on('framenavigated', (f) => urls.push(f.url()));

  await page.goto(`/setup?returnTo=${encodeURIComponent('/post')}`);
  await acceptTerms(page);
  await pickNames(page, 'Mira.K_', 'mira-signin-01');
  await page.click('[data-method="password"]');
  await page.click('[data-part="method-continue"]');
  await page.fill('#pw', 'Quiet-harbour-58');
  await page.fill('#pw2', 'Quiet-harbour-58');
  await page.click('[data-part="password-set"]');

  await expect(page).toHaveURL(/\/setup\/backup\?/);
  await saveRecoveryCodes(page);
  await page.click('[data-part="backup-skip"]');
  await page.fill('#addr', ADDRESS);
  await page.click('[data-part="wallet-finish"]');

  await expect(page.locator('h1')).toHaveText('Welcome to X2F, Mira.K_');
  const name = page.locator('[data-username]');
  await expect(name).toHaveText('Mira.K_');
  expect(await name.evaluate((el) => getComputedStyle(el).textTransform)).toBe('none');
  await expect(page.locator('[data-part="check-recovery"] [data-part="tick"]')).toHaveCount(1);
  await expect(page.getByText('You pay X2F 1% of each completed trade from your own ads. Taking an offer is free.')).toBeVisible();
  expect(s.bodies.password?.[0]).toMatchObject({ displayName: 'Mira.K_', loginName: 'mira-signin-01' });

  await page.click('[data-part="start-trading"]');
  // Owner G25: Log in next, then on to the post.
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fpost$/);
  expect(s.requests).toContain('POST /v1/logout');

  // No secret in any URL or in browser storage.
  for (const u of urls) expect(u).not.toContain('harbour');
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(stored).not.toContain('harbour');
  expect(stored).not.toContain('mira-signin');
});

test('the username and display name are checked before going on (5-20, allowed characters, free, different)', async ({ page }) => {
  const s = await stubApi(page);
  await page.goto('/setup');
  await acceptTerms(page);
  const go = page.locator('[data-part="names-continue"]');

  // Step 1 is one private field: no second name on this screen.
  await expect(page.locator('[data-screen="setup-name"] input')).toHaveCount(1);
  await page.fill('#uname', 'abcd');
  await go.click();
  await expect(page.locator('[data-part="names-error"]')).toHaveText('Your username needs 5 to 20 characters.');
  await page.fill('#uname', 'Mira K');
  await go.click();
  await expect(page.locator('[data-part="names-error"]')).toHaveText('Your username can use only letters, numbers, dots, dashes and underscores.');
  // Wrong shapes are never sent to the live check.
  expect(s.bodies['name-check'] ?? []).toEqual([]);
  await page.fill('#uname', 'taken.name');
  await expect(page.locator('[data-part="name-status"]')).toHaveText('taken.name is taken. Try another.');
  await go.click();
  await expect(page.locator('[data-part="names-error"]')).toHaveText('That username is taken. Pick another.');
  await expect(page).toHaveURL(/\/setup\/name/);

  await page.fill('#uname', 'login-name-1');
  await expect(page.locator('[data-part="name-status"]')).toHaveText('login-name-1 is available');
  await go.click();
  await expect(page.locator('[data-screen="setup-display-name"]')).toBeVisible();
  await page.fill('#display-name', 'login-NAME-1');
  await page.click('[data-part="display-continue"]');
  await expect(page.locator('[data-part="display-error"]')).toHaveText('Your display name must be different from your username.');
  await expect(page).toHaveURL(/\/setup\/display-name/);
});

test('a taken display name at register sends the person back to change their names, both kept', async ({ page }) => {
  await stubApi(page);
  await page.unroute('**/v1/register/password');
  await page.route('**/v1/register/password', json({ error: 'display-name-taken' }, 409));
  await page.goto('/setup');
  await acceptTerms(page);
  await pickNames(page, 'lumen.k', 'lumen-login-7');
  await page.click('[data-method="password"]');
  await page.click('[data-part="method-continue"]');
  await page.fill('#pw', 'Quiet-harbour-58');
  await page.fill('#pw2', 'Quiet-harbour-58');
  await page.click('[data-part="password-set"]');
  await expect(page.locator('[data-part="register-error"]')).toContainText('That display name is taken.');
  // Review F8: "Change your names" opens the screen of the name that was refused (the display name).
  await page.click('[data-part="change-names"]');
  await expect(page).toHaveURL(/\/setup\/display-name\?/);
  await expect(page.locator('#display-name')).toHaveValue('lumen.k');
  await page.click('[aria-label="Back"]');
  await expect(page).toHaveURL(/\/setup\/name\?/);
  await expect(page.locator('#uname')).toHaveValue('lumen-login-7');
});

test('a step opened without the earlier ones goes back to the Terms', async ({ page }) => {
  await stubApi(page);
  await page.goto(`/setup/password?returnTo=${encodeURIComponent('/post')}`);
  await expect(page).toHaveURL(/\/setup\?returnTo=%2Fpost$/);
  await expect(page.locator('[data-screen="setup-terms"]')).toBeVisible();
});

// Plan 3 Revision 2026-10-28 (no guest buying), with the front door (owner, 8 Nov 2026): a visitor
// sent a quote link sees the Landing board (design review 2026-11-08 item 1), not the quote. From
// there, Create account and the shortest
// route (Terms, names, a login method, the first wallet) come back to the same quote with the amount
// kept, through no more screens than the Setup boards plus the login owner G25 asks for after
// sign-up (Log in, then the session length), each one reached by a single tap of its own
// button (no dead end). Any step added later must keep this green.
test('a visitor with a quote link comes back to the same quote, amount kept, through the Landing board, the Setup boards and one login', async ({ page }) => {
  const s = await stubApi(page);
  const takes: unknown[] = [];
  await page.route('**/v1/methods?*', json({ live: [{ id: B.method.id, name: B.method.name, group: 'Payment apps', giftCard: false, offers: 1, bestRate: B.marketCentsPerXmr }], all: [] }));
  await page.route('**/v1/price?*', json({ currency: B.currency, centsPerXmr: B.marketCentsPerXmr, exponent: 2, at: new Date().toISOString(), usdCentsPerXmr: B.marketCentsPerXmr }));
  await page.route('**/v1/offers?*', json([B.offer]));
  await page.route('**/v1/offers/*/take', (r) => {
    const body = r.request().postDataJSON() as { centsPerXmr: string; fiatCents: string };
    takes.push(body);
    return json({ code: B.code, centsPerXmr: body.centsPerXmr, fiatCents: body.fiatCents, maxFiatCents: B.offer.maxFiatCents })(r);
  });

  const quote = `/buy/${B.method.id}/${B.offer.id}?currency=${B.currency}&amount=${B.amount}`;
  await page.goto(quote);
  // Outside the door: the Landing board, keeping the quote (and its amount) to come back to.
  await expect(page.locator('[data-screen="landing"]')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('returnTo')).toBe(quote);
  await expect(page.locator('#quote-amount')).toHaveCount(0);
  await page.click('[data-part="landing-create"]');

  // Every screen on the way, in order: one tap of its primary action moves on.
  const seen: string[] = [];
  const at = async (screen: string) => {
    await expect(page.locator(`[data-screen="${screen}"]`)).toBeVisible();
    seen.push(screen);
  };
  await at('setup-terms');
  await acceptTerms(page);
  await at('setup-name');
  await page.fill('#uname', 'lumen-login-7');
  await page.click('[data-part="names-continue"]');
  await at('setup-display-name');
  await page.fill('#display-name', 'lumen.k');
  await page.click('[data-part="display-continue"]');
  await at('setup-login');
  await page.click('[data-part="method-continue"]');
  await at('setup-pgp-key');
  await page.fill('#pub', realKey);
  await expect(page.locator('[data-part="key-check"]')).toContainText('Ed25519');
  await page.click('[data-part="key-continue"]');
  await at('setup-pgp-code');
  await page.fill('#phrase', '1234-5678-9ABC');
  await page.click('[data-part="pgp-verify"]');
  await page.click('[data-part="pgp-continue"]');
  await at('setup-backup');
  // Owner S-017 (recovery codes required) knowingly overrides this test's "one tap per board" rule
  // for this step: it needs a tap to show the codes, a tick and one code typed back before
  // "Skip for now" appears (review S2b; confirmation asked of the owner).
  await saveRecoveryCodes(page);
  await page.click('[data-part="backup-skip"]');
  await at('setup-wallet');
  await page.fill('#addr', ADDRESS);
  await page.click('[data-part="wallet-finish"]');
  await at('setup-welcome');
  await page.click('[data-part="start-trading"]');
  // Owner G25: log in with what was just set up, choose the session length, then on.
  await at('login');
  await page.click('[data-method="password"]');
  await page.fill('#login-name', 'lumen-login-7');
  await page.fill('#login-password', 'Quiet-harbour-58');
  await page.click('[data-part="password-login"]');
  await at('session-length');
  await page.selectOption('[data-part="session-length-select"]', '4');
  await page.click('[data-part="session-length-continue"]');

  // Back on the same quote in this tab, the amount kept; nothing taken yet.
  await expect(page.locator('[data-screen="quote"]')).toBeVisible();
  const back = new URL(page.url());
  expect(back.pathname).toBe(`/buy/${B.method.id}/${B.offer.id}`);
  await expect(page.locator('#quote-amount')).toHaveValue(B.amount);
  expect(takes).toEqual([]);

  // No more screens than the Setup boards (SetupPassword is the other branch of the login step),
  // plus G25's Log in and session length.
  // The display name has its own screen after SetupUsername (design real-app review item 6: the
  // board's one private username, then the second name on its own step; its fields are on
  // SignupSecurity's "Your names" card), so it counts as one more board.
  const SETUP_BOARDS = ['SetupTerms', 'SetupUsername', 'display name', 'SetupLogin', 'SetupPgpKey', 'SetupPgpChallenge', 'SetupPassword', 'SetupBackup', 'SetupWallet', 'SetupWelcome'];
  const G25 = ['Login', 'SessionLength'];
  expect(seen.length).toBeLessThanOrEqual(SETUP_BOARDS.length - 1 + G25.length);
  expect(seen).toEqual(['setup-terms', 'setup-name', 'setup-display-name', 'setup-login', 'setup-pgp-key', 'setup-pgp-code', 'setup-backup', 'setup-wallet', 'setup-welcome', 'login', 'session-length']);
  expect(s.requests).toContain('POST /v1/logout');
  expect(s.bodies['session-length']).toEqual([{ hours: 4 }]);
  expect(s.registered).toBe(true);
});

test('someone who already has an account goes from the Terms to Log in, keeping returnTo', async ({ page }) => {
  await stubApi(page);
  await page.goto(`/setup?returnTo=${encodeURIComponent('/post')}`);
  await page.getByRole('link', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fpost$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Log in');
});

test('raising the Terms version sends a logged-in trader to /terms and back to the same screen', async ({ page }) => {
  // The trader accepted an older version; the owner has published TERMS_VERSION, whose text this
  // build carries (TERMS_TEXT_VERSION, review M4), so the next page load is refused terms-required.
  let accepted: unknown = null;
  await page.route('**/v1/terms', json({ version: TERMS_VERSION }));
  await page.route('**/v1/account/me', (r) =>
    accepted === null
      ? json({ error: 'terms-required', version: TERMS_VERSION }, 403)(r)
      : json({ displayName: 'nightowl', loginNameSet: true, kind: 'trader', level: 'full', holdUntil: null, methods: ['pgp'], hasBackup: false, suggestions: [], termsCurrent: true })(r),
  );
  await page.route('**/v1/account/terms', (r) => {
    accepted = JSON.parse(r.request().postData() ?? 'null');
    return r.fulfill({ status: 204 });
  });

  await page.goto('/trade/K7M2-9QXA-4FTR-8WPN');
  await expect(page).toHaveURL(/\/terms\?returnTo=%2Ftrade%2FK7M2-9QXA-4FTR-8WPN$/);
  await expect(page.locator('[data-part="terms-accept"]')).toBeDisabled();
  await acceptTerms(page);
  await expect(page).toHaveURL(/\/trade\/K7M2-9QXA-4FTR-8WPN$/);
  // A changed Terms version asks for a new signature too (owner, 8 Nov 2026).
  expect(accepted).toEqual({ version: TERMS_VERSION, signature: DRAWN });
});

test('Start trading with no usable wallet goes to Add a wallet first, then on to the take', async ({ page }) => {
  await stubApi(page, { signedIn: true, methods: ['pgp'], wallets: [] });
  await page.goto(`/setup/welcome?returnTo=${encodeURIComponent(TAKE)}`);
  await expect(page.locator('[data-part="summary-wallet"]')).toHaveText('None yet');
  await page.click('[data-part="start-trading"]');
  await expect(page).toHaveURL(`/wallets?add=1&returnTo=${encodeURIComponent(TAKE)}`);
});

test('a waiting wallet is not a usable one: Start trading still goes to Add a wallet', async ({ page }) => {
  await stubApi(page, {
    signedIn: true,
    methods: ['password'],
    wallets: [{ id: 'w', app: 'edge', label: 'Wallet 1', address: ADDRESS, addressEnd: 'k3Fz', usableFrom: '2099-01-01T00:00:00.000Z', usable: false }],
  });
  await page.goto(`/setup/welcome?returnTo=${encodeURIComponent('/post')}`);
  await page.click('[data-part="start-trading"]');
  await expect(page).toHaveURL(`/wallets?add=1&returnTo=${encodeURIComponent('/post')}`);
});

test('an unsafe returnTo is never followed: Start trading lands on the default screen', async ({ page }) => {
  await stubApi(page, {
    signedIn: true,
    methods: ['pgp'],
    wallets: [{ id: 'w', app: 'cake', label: 'Wallet 1', address: ADDRESS, addressEnd: 'k3Fz', usableFrom: '2026-10-25T00:00:00.000Z', usable: true }],
  });
  await page.goto(`/setup/welcome?returnTo=${encodeURIComponent('//evil.example/x')}`);
  await page.click('[data-part="start-trading"]');
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/sell$/);
});

test('a signed-in trader who opens /setup with a wallet goes straight to returnTo', async ({ page }) => {
  await stubApi(page, {
    signedIn: true,
    methods: ['pgp'],
    wallets: [{ id: 'w', app: 'cake', label: 'Wallet 1', address: ADDRESS, addressEnd: 'k3Fz', usableFrom: '2026-10-25T00:00:00.000Z', usable: true }],
  });
  await page.goto(`/setup?returnTo=${encodeURIComponent(TAKE)}`);
  await expect(page).toHaveURL(new RegExp(`${TAKE.replace(/[?]/g, '\\?')}$`));
});

test('a signed-in trader with no wallet who opens /setup lands on Link a wallet (no confirm prompt)', async ({ page }) => {
  const s = await stubApi(page, { signedIn: true, methods: ['pgp'], wallets: [] });
  await page.goto(`/setup?returnTo=${encodeURIComponent(TAKE)}`);
  await expect(page).toHaveURL(/\/setup\/wallet\?/);
  await page.click('[data-app="edge"]');
  await expect(page.getByText("For best privacy, turn on Full Sync in Edge's Monero settings.", { exact: false })).toBeVisible();
  await page.fill('#addr', ADDRESS);
  await page.click('[data-part="wallet-finish"]');
  await expect(page).toHaveURL(/\/setup\/welcome\?/);
  await expect(page.locator('[data-part="summary-wallet"]')).toHaveText('Edge …k3Fz');
  expect(s.bodies.wallets).toEqual([{ wallets: [{ app: 'edge', label: 'Wallet 1', address: ADDRESS }] }]);
  expect(s.requests.filter((r) => r.includes('/v1/confirm/'))).toEqual([]);
});

// SetupTerms (Getting started, screen 0) is mirrored in design/x2f-app/ with refs/SetupTerms.png
// since 2026-10-26. Its "[TERMS TEXT: …]" placeholders and "[DATE]" are KNOWN_EXCEPTIONS.SetupTerms.
for (const v of PHONES) {
  test(`the Terms screen matches SetupTerms at ${v}`, async ({ page }) => {
    await setViewport(page, v);
    await stubApi(page);
    await page.goto('/setup');
    // The screen renders once the session check answers (signed out): wait for it, not a race.
    await expect(page.locator('[data-part="terms-accept"]')).toBeVisible();
    await expect(page.locator('[data-part="terms-text"]')).toContainText(`End of Terms. Version ${TERMS_VERSION}.`);
    await expectParity(page, 'SetupTerms', { viewport: v });
  });

  test(`the Terms screen works at ${v}: one primary action, no sideways scroll, the box scrolls`, async ({ page }) => {
    await setViewport(page, v);
    await stubApi(page);
    await page.goto('/setup');
    await expect(page.locator('[data-part="terms-accept"]')).toBeVisible();
    expect(await page.locator('[data-primary]').count()).toBe(1);
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(sideways).toBe(false);
    const box = await page.locator('[data-part="terms-text"]').evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
    expect(box.scroll).toBeGreaterThan(box.client);
    // I accept is reachable on a small phone without scrolling the page.
    const accept = await page.locator('[data-part="terms-accept"]').boundingBox();
    const [width, height] = v.split('x').map(Number) as [number, number];
    expect(accept!.y + accept!.height).toBeLessThanOrEqual(height);
    // The signature pad (owner, 8 Nov 2026): white, at least 120 px tall, the content's full width.
    const pad = page.locator('.x2f-sign__pad');
    const padBox = (await pad.boundingBox())!;
    expect(padBox.height).toBeGreaterThanOrEqual(120);
    expect(padBox.width).toBeGreaterThanOrEqual(width - 2 * 16 - 1);
    expect(await pad.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');
    await expect(page.locator('.x2f-sign__here')).toHaveText('Sign your name here with your finger or mouse. A scribble or an X is fine.');
    // Design 9 Nov (p11-15): the intro and the button's words.
    await expect(page.locator('[data-screen="setup-terms"]')).toContainText(
      "Read to the end. If you agree to X2F's rules and terms, tick the box, sign your name and start creating your account. You agree once, here, never again on a trade.",
    );
    await expect(page.locator('[data-part="terms-accept"]')).toHaveText('Start creating my account');
    await expect(page.locator('#terms-sign-help')).toContainText('Start creating my account needs both the tick and your signature.');
  });
}

// Task 28 review fix round (review 2026-10-28, ~/x2f-comms/review-task28-2026-10-28.md).
test.describe('review fix round', () => {
  async function toPgpCode(page: Page): Promise<void> {
    await page.goto(`/setup?returnTo=${encodeURIComponent('/post')}`);
    await acceptTerms(page);
    await pickNames(page, 'lumen.k', 'lumen-login-7');
    await page.click('[data-part="method-continue"]');
    await page.fill('#pub', realKey);
    await expect(page.locator('[data-part="key-check"]')).toContainText('Ed25519');
    await page.click('[data-part="key-continue"]');
    await expect(page).toHaveURL(/\/setup\/pgp-code\?/);
  }

  async function toPassword(page: Page): Promise<void> {
    await page.goto(`/setup?returnTo=${encodeURIComponent('/post')}`);
    await acceptTerms(page);
    await pickNames(page, 'lumen.k', 'lumen-login-7');
    await page.click('[data-method="password"]');
    await page.click('[data-part="method-continue"]');
    await page.fill('#pw', 'Quiet-harbour-58');
    await page.fill('#pw2', 'Quiet-harbour-58');
  }

  test('I1: a key already on another account says so, links back to the key and to Log in, and offers no endless new message', async ({ page }) => {
    await stubApi(page);
    await page.unroute('**/v1/register/pgp/finish');
    await page.route('**/v1/register/pgp/finish', json({ error: 'key-in-use' }, 409));
    await toPgpCode(page);
    await page.fill('#phrase', '1234-5678-9ABC');
    await page.click('[data-part="pgp-verify"]');
    const err = page.locator('[data-part="register-error"]');
    await expect(err).toContainText('That key is already used by another X2F account. Use a different key, or log in instead.');
    await expect(page.locator('[data-part="pgp-new-message"]')).toHaveCount(0);
    await expect(err.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', `/login?returnTo=${encodeURIComponent('/post')}`);
    await err.getByRole('link', { name: 'Use a different key' }).click();
    await expect(page).toHaveURL(/\/setup\/pgp-key\?/);
  });

  test('I1: a second PGP key already on another account gets its own sentence on the backup step', async ({ page }) => {
    await stubApi(page, { signedIn: true, methods: ['pgp'] });
    await page.route('**/v1/account/pgp/start', json({ challengeId: 'b1', encryptedMessage: BOARD_MESSAGE, expiresAt: '2099-01-01T00:00:00.000Z' }));
    await page.route('**/v1/account/pgp/finish', json({ error: 'key-in-use' }, 409));
    await page.goto(`/setup/backup?returnTo=${encodeURIComponent('/post')}`);
    // Owner S-017: the extra backups are offered once the recovery codes are saved.
    await saveRecoveryCodes(page);
    await page.click('[data-backup="pgp"]');
    await page.click('[data-part="backup-add"]');
    await page.fill('#backup-pub', realKey);
    await page.click('[data-part="backup-pgp-start"]');
    await page.fill('#backup-code', '1234-5678-9ABC');
    await page.click('[data-part="backup-pgp-finish"]');
    await expect(page.locator('[data-part="backup-pgp"] [role="alert"]')).toHaveText(
      'That key is already used by another X2F account. Use a different second key.',
    );
  });

  test('I2: after a password sign-up, Back never reopens the sign-up steps or registers again', async ({ page }) => {
    const s = await stubApi(page);
    await toPassword(page);
    await page.click('[data-part="password-set"]');
    await expect(page).toHaveURL(/\/setup\/backup\?/);
    await page.goBack();
    await expect(page).toHaveURL(/\/setup\/backup\?/);
    await page.goBack();
    await expect(page.locator('[data-part="password-set"]')).toHaveCount(0);
    await expect(page.locator('[data-part="method-continue"]')).toHaveCount(0);
    expect(s.bodies.password).toHaveLength(1);
  });

  test('I2: after a PGP sign-up, Back never reopens the key step or starts a second sign-up', async ({ page }) => {
    const s = await stubApi(page);
    await toPgpCode(page);
    await page.fill('#phrase', '1234-5678-9ABC');
    await page.click('[data-part="pgp-verify"]');
    await page.click('[data-part="pgp-continue"]');
    await expect(page).toHaveURL(/\/setup\/backup\?/);
    await page.goBack();
    await expect(page).toHaveURL(/\/setup\/backup\?/);
    await expect(page.locator('[data-part="key-continue"]')).toHaveCount(0);
    expect(s.bodies['pgp-start']).toHaveLength(1);
    expect(s.bodies['pgp-finish']).toHaveLength(1);
  });

  test('M5: a passkey sign-up carries both names, the device label and the accepted Terms version', async ({ page }) => {
    const s = await stubApi(page);
    await page.route('**/v1/register/webauthn/start', (r) => {
      (s.bodies['webauthn-start'] ??= []).push(JSON.parse(r.request().postData() ?? 'null'));
      return json({
        challengeId: 'w1',
        options: {
          challenge: 'AQIDBAUGBwgJCgsMDQ4PEA',
          rp: { name: 'X2F', id: 'localhost' },
          user: { id: 'BwcH', name: 'lumen-login-7', displayName: 'lumen.k' },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
          authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
          attestation: 'none',
          timeout: 10000,
        },
      })(r);
    });
    await page.route('**/v1/register/webauthn/finish', (r) => {
      (s.bodies['webauthn-finish'] ??= []).push(JSON.parse(r.request().postData() ?? 'null'));
      s.registered = true;
      s.methods = ['passkey'];
      return json({ displayName: 'lumen.k' }, 201)(r);
    });
    await page.goto(`http://localhost:${process.env.X2F_E2E_PORT ?? 4317}/setup?returnTo=%2Fpost`);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
    });
    await acceptTerms(page);
    await pickNames(page, 'lumen.k', 'lumen-login-7');
    await page.click('[data-method="passkey"]');
    await page.click('[data-part="method-continue"]');
    await expect(page).toHaveURL(/\/setup\/backup\?/);
    expect(s.bodies['webauthn-start']).toEqual([{ displayName: 'lumen.k', loginName: 'lumen-login-7', kind: 'passkey' }]);
    const finish = s.bodies['webauthn-finish']?.[0] as { acceptedTerms: string; termsSignature: unknown; deviceLabel: string; challengeId: string };
    expect(finish.challengeId).toBe('w1');
    expect(finish.acceptedTerms).toBe(TERMS_VERSION);
    expect(finish.termsSignature).toEqual(DRAWN);
    expect(finish.deviceLabel).not.toBe(TERMS_VERSION);
    expect(finish.deviceLabel.length).toBeGreaterThan(0);
  });

  test('M5: a cancelled passkey prompt says so and keeps the person on the login step', async ({ page }) => {
    await stubApi(page);
    await page.route('**/v1/register/webauthn/start', json({ error: 'webauthn-failed' }, 401));
    await page.goto('/setup');
    await acceptTerms(page);
    await pickNames(page, 'lumen.k', 'lumen-login-7');
    await page.click('[data-method="passkey"]');
    await page.click('[data-part="method-continue"]');
    await expect(page.locator('[data-part="register-error"]')).toContainText('pick another way to log in');
    await expect(page).toHaveURL(/\/setup\/login\?/);
  });

  test('M6: Terms that change during setup send the person back to read them; the retry sends the version read', async ({ page }) => {
    const s = await stubApi(page);
    let tries = 0;
    await page.unroute('**/v1/register/password');
    await page.route('**/v1/register/password', (r) => {
      tries += 1;
      (s.bodies.password ??= []).push(JSON.parse(r.request().postData() ?? 'null'));
      if (tries === 1) return json({ error: 'terms-not-accepted', version: TERMS_VERSION }, 400)(r);
      s.registered = true;
      s.methods = ['password'];
      return json({ displayName: 'lumen.k' }, 201)(r);
    });
    await toPassword(page);
    await page.click('[data-part="password-set"]');
    await expect(page.locator('[data-screen="setup-terms"]')).toBeVisible();
    await expect(page.locator('[data-part="terms-tick"]')).toBeDisabled();
    // Read again means sign again: the pad starts empty.
    await expect(page.locator('[data-part="signature-pad"]')).toHaveAttribute('data-empty', 'true');
    await acceptTerms(page);
    // The names are kept (the private username, then the display name on its own screen); the
    // person picks the method again.
    await expect(page.locator('#uname')).toHaveValue('lumen-login-7');
    await page.click('[data-part="names-continue"]');
    await expect(page.locator('#display-name')).toHaveValue('lumen.k');
    await page.click('[data-part="display-continue"]');
    await page.click('[data-method="password"]');
    await page.click('[data-part="method-continue"]');
    await page.fill('#pw', 'Quiet-harbour-58');
    await page.fill('#pw2', 'Quiet-harbour-58');
    await page.click('[data-part="password-set"]');
    await expect(page).toHaveURL(/\/setup\/backup\?/);
    expect(s.bodies.password).toHaveLength(2);
    expect(s.bodies.password?.[1]).toMatchObject({ acceptedTerms: TERMS_VERSION, termsSignature: DRAWN });
  });

  test('M3: /terms reloads the version when the Terms change before I accept, and the retry posts the new one', async ({ page }) => {
    // The server's version is the one this page carries, but the accept is refused once: the page
    // re-reads the version, finds the same text, and asks for it to be read again.
    let gets = 0;
    const posts: unknown[] = [];
    await page.route('**/v1/terms', (r) => {
      gets += 1;
      return json({ version: TERMS_VERSION })(r);
    });
    await page.route('**/v1/account/me', json({ displayName: 'nightowl', kind: 'trader', level: 'full', methods: ['pgp'], termsCurrent: true }));
    await page.route('**/v1/account/terms', (r) => {
      posts.push(JSON.parse(r.request().postData() ?? 'null'));
      return posts.length === 1 ? json({ error: 'terms-not-accepted', version: TERMS_VERSION }, 400)(r) : r.fulfill({ status: 204 });
    });
    await page.goto('/terms?returnTo=%2Fpost');
    await acceptTerms(page);
    await expect(page.locator('[data-screen="terms"] [role="alert"]')).toContainText('The Terms changed while you were reading');
    await expect(page.locator('[data-part="terms-stale"]')).toHaveCount(0);
    await expect(page.locator('[data-part="terms-tick"]')).not.toBeChecked();
    await expect(page.locator('[data-part="signature-pad"]')).toHaveAttribute('data-empty', 'true');
    expect(gets).toBeGreaterThanOrEqual(2);
    await acceptTerms(page);
    await expect(page).toHaveURL(/\/post$/);
    expect(posts).toHaveLength(2);
    expect(posts[1]).toEqual({ version: TERMS_VERSION, signature: DRAWN });
  });

  test('M3 (review m2): Terms that move to a NEW version at accept say only "Reload"; after the reload (a page carrying the new text) I read and accept the new version', async ({ page }) => {
    const NEW = '2026-11-02';
    let serverVersion = TERMS_VERSION;
    // The deploy that moves the server to NEW also ships the page carrying NEW: once the server
    // has moved, the page's scripts are served as that new build (the constant rewritten).
    let newBuild = false;
    const posts: { version?: string }[] = [];
    await page.route('**/assets/*.js', async (r) => {
      if (!newBuild) return r.continue();
      const res = await r.fetch();
      let body = await res.text();
      // The minifier writes the constant in any of the three quote styles.
      for (const q of ['"', "'", '`']) body = body.replaceAll(`${q}${TERMS_VERSION}${q}`, `${q}${NEW}${q}`);
      return r.fulfill({ response: res, body });
    });
    await page.route('**/v1/terms', (r) => json({ version: serverVersion })(r));
    await page.route('**/v1/account/me', json({ displayName: 'nightowl', kind: 'trader', level: 'full', methods: ['pgp'], termsCurrent: true }));
    await page.route('**/v1/account/terms', (r) => {
      const body = JSON.parse(r.request().postData() ?? 'null') as { version?: string };
      posts.push(body);
      if (body.version !== serverVersion) {
        serverVersion = NEW;
        newBuild = true;
        return json({ error: 'terms-not-accepted', version: NEW }, 400)(r);
      }
      return r.fulfill({ status: 204 });
    });
    await page.goto('/terms?returnTo=%2Fpost');
    await expect(page.locator('[data-part="terms-text"]')).toContainText(`Version ${TERMS_VERSION}.`);
    // The Terms move to NEW while the person reads; the first accept still names the old version.
    serverVersion = NEW;
    newBuild = true;
    await acceptTerms(page);
    expect(posts).toEqual([{ version: TERMS_VERSION, signature: DRAWN }]);
    // One message, the one the person can act on: reload. No "read them again" next to it.
    const stale = page.locator('[data-part="terms-stale"]');
    await expect(stale).toHaveText('The Terms have been updated. Reload the page to read the new version.');
    await expect(page.locator('[data-screen="terms"] [role="alert"]')).toHaveCount(1);
    await expect(page.locator('[data-screen="terms"]')).not.toContainText('Read them to the end again');
    await expect(page.locator('[data-part="terms-tick"]')).toBeDisabled();
    await stale.getByRole('button', { name: 'Reload the page' }).click();
    // The reloaded page carries NEW: no stale notice, the box ends with NEW, and I can read and accept.
    await expect(page.locator('[data-part="terms-text"]')).toContainText(`Version ${NEW}.`);
    await expect(page.locator('[data-part="terms-stale"]')).toHaveCount(0);
    await expect(page.locator('[data-part="terms-tick"]')).toBeDisabled();
    await acceptTerms(page);
    await expect(page).toHaveURL(/\/post$/);
    expect(posts).toEqual([{ version: TERMS_VERSION, signature: DRAWN }, { version: NEW, signature: DRAWN }]);
  });

  test('M4: when the server names Terms this page does not carry, the page says to reload and I accept stays off', async ({ page }) => {
    await stubApi(page);
    await page.unroute('**/v1/terms');
    await page.route('**/v1/terms', json({ version: '2099-01-01' }));
    await page.goto('/setup');
    await expect(page.locator('[data-part="terms-stale"]')).toHaveText('The Terms have been updated. Reload the page to read the new version.');
    await readTermsToEnd(page);
    await expect(page.locator('[data-part="terms-tick"]')).toBeDisabled();
    await expect(page.locator('[data-part="terms-accept"]')).toBeDisabled();
  });

  test('M7: an integrated address reaches the server and gets its own sentence', async ({ page }) => {
    await stubApi(page, { signedIn: true, methods: ['pgp'] });
    await page.route('**/v1/wallets', (r) =>
      r.request().method() === 'GET' ? json([])(r) : json({ error: 'address-integrated' }, 400)(r),
    );
    await page.goto(`/setup/wallet?returnTo=${encodeURIComponent('/post')}`);
    await page.fill('#addr', `4${'9'.repeat(101)}k3Fz`);
    await page.click('[data-part="wallet-finish"]');
    await expect(page.locator('[data-part="wallet-error"]')).toHaveText('That is an integrated address. Paste a normal receive address from your wallet.');
  });

  test('M8: the choice groups follow the radio pattern (arrow keys, one tab stop) and help text is linked', async ({ page }) => {
    await stubApi(page);
    await page.goto('/setup');
    await expect(page.locator('[data-part="terms-tick"]')).toHaveAttribute('aria-describedby', /.+/);
    // The scroll hint, then the signature line (owner, 8 Nov 2026: the tick box says a signature is needed).
    const [hint, sign] = (await page.locator('[data-part="terms-tick"]').getAttribute('aria-describedby'))!.split(' ');
    await expect(page.locator(`[id="${hint}"]`)).toHaveText('Scroll to the end to continue');
    await expect(page.locator(`[id="${sign}"]`)).toContainText('A scribble or an X is fine.');
    await acceptTerms(page);
    // Each name's input is described by its help text (the username also by its live tick line,
    // which is empty until a check answers): every id it names exists, and the help is shown.
    const described = async (id: string, help: string) => {
      const ids = ((await page.locator(`#${id}`).getAttribute('aria-describedby')) ?? '').split(/\s+/).filter(Boolean);
      expect(ids).toContain(help);
      for (const d of ids) await expect(page.locator(`[id="${d}"]`)).toHaveCount(1);
      await expect(page.locator(`[id="${help}"]`)).toBeVisible();
    };
    await described('uname', 'uname-help');
    await page.fill('#uname', 'lumen-login-7');
    await expect(page.locator('[data-part="name-status"]')).toHaveText('lumen-login-7 is available');
    await page.click('[data-part="names-continue"]');
    await described('display-name', 'display-name-help');
    await page.fill('#display-name', 'lumen.k');
    await page.click('[data-part="display-continue"]');
    const radios = page.locator('[role="radiogroup"][aria-label="Login method"] [role="radio"]');
    await expect(radios.nth(0)).toHaveAttribute('tabindex', '0');
    await expect(radios.nth(1)).toHaveAttribute('tabindex', '-1');
    await radios.nth(0).focus();
    await page.keyboard.press('ArrowDown');
    await expect(radios.nth(1)).toHaveAttribute('aria-checked', 'true');
    await expect(radios.nth(1)).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await expect(radios.nth(3)).toHaveAttribute('aria-checked', 'true');
  });
});
