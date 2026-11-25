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
/** The server's one recovery code (hold model v3), 64 symbols since the owner's demo notes (12 Nov 2026). */
const RECOVERY_CODE = 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-6789-ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-6789';

/**
 * Owner S-017 and demo notes (12 Nov 2026): make the recovery code, tick "I've written it down",
 * Next, then type it back on the next screen (the code out of sight) and Next.
 */
async function saveRecoveryCodes(page: Page): Promise<void> {
  await expect(page.locator('[data-part="backup-skip"]')).toHaveCount(0);
  await page.click('[data-part="recovery-make"]');
  await expect(page.locator('[data-part="recovery-next"]')).toBeDisabled();
  await page.check('[data-part="recovery-written"]');
  await page.click('[data-part="recovery-next"]');
  await expect(page.locator('[data-part="recovery-continue"]')).toBeDisabled();
  await page.fill('#recovery-typeback', RECOVERY_CODE);
  await page.click('[data-part="recovery-continue"]');
}

/**
 * Owner demo notes (12 Nov 2026): the login methods are checkboxes, PGP ticked first; tick only `id`.
 * Owner decision, 16 Nov 2026: a password does not stand alone, so the password path ticks the
 * authenticator app with it (its step follows the password: `addAuthenticator`).
 */
async function chooseOnly(page: Page, id: 'password' | 'passkey'): Promise<void> {
  await page.uncheck('[data-method="pgp"] input[type="checkbox"]');
  await page.check(`[data-method="${id}"] input[type="checkbox"]`);
  if (id === 'password') await page.check('[data-method="totp"] input[type="checkbox"]');
}

/** The authenticator step after the password (owner, 16 Nov 2026): no "Set up later" when the password is the only login. */
async function addAuthenticator(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/setup\/authenticator\?/);
  await expect(page.locator('[data-part="method-later"]')).toHaveCount(0);
  await page.click('[data-part="totp-start"]');
  await page.fill('#totp-code', '123456');
  await page.click('[data-part="totp-finish"]');
  await page.click('[data-part="totp-continue"]');
}

const TERMS_VERSION = '2026-11-25c';
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
    return json({ codes: [RECOVERY_CODE] })(r);
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

/**
 * What every trader's accept carries: the version alone, no signature (owner demo note #187, 25 Nov
 * 2026); the tick is the only condition (owner demo note #190: no read-to-the-end gate).
 */
async function acceptTerms(page: Page): Promise<void> {
  await page.check('[data-part="terms-tick"]');
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
    await pickNames(page, 'lumen.kai', 'lumen-login-7');

    await expect(page).toHaveURL(/\/setup\/login\?/);
    // PGP is first and picked (ticked) by default.
    await expect(page.locator('[data-method]').first()).toContainText('PGP key');
    await expect(page.locator('[data-method]').first().locator('input[type="checkbox"]')).toBeChecked();
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
    // Owner S-017: the recovery code is required. Lead call (12 Nov 2026): the optional "Add another
    // backup" view is gone (the ticked login methods replace it), so the board is checked on the
    // recovery-code view, which keeps the board's panel ("Your coins stay…"; parity.ts SetupBackup
    // exceptions), and the code goes straight on to the wallet.
    await expect(page.locator('[data-part="recovery-make"]')).toBeVisible();
    // Owner demo note #153 (23 Nov 2026): the "Your coins stay…" box is gone from this screen.
    await expect(page.getByText("Your coins stay in your own wallet either way.")).toHaveCount(0);
    await expectParity(page, 'SetupBackup', { viewport: v });
    await saveRecoveryCodes(page);
    // Design build gaps Job 1: no authenticator app as a backup; lead call: no other backup offered here at all.
    await expect(page.locator('[data-backup]')).toHaveCount(0);
    await expect(page.locator('[data-part="backup-skip"]')).toHaveCount(0);

    await expect(page).toHaveURL(/\/setup\/wallet\?/);
    // The URL changes before the router commits the new screen: wait for the screen itself.
    await expect(page.locator('[data-screen="setup-wallet"]')).toBeVisible();
    await expectParity(page, 'SetupWallet', { viewport: v });
    await page.fill('#xmr-payout', ADDRESS);
    await page.click('[data-part="wallet-finish"]');
    // Owner #161: the saved first wallet shows its green check, then Continue.
    await expect(page.locator('[data-part="address-verified"]')).toBeVisible();
    await page.click('[data-part="wallet-continue"]');

    await expect(page).toHaveURL(/\/setup\/welcome\?/);
    // Owner #165: "Welcome to" and the X2F logo (its label), then the name with a comma.
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome to X2F' })).toBeVisible();
    await expect(page.locator('[data-part="welcome-name"]')).toHaveText('lumen.kai,');
    // Owner S-017: the backup login is the recovery codes saved on the backup step (parity.ts SetupWelcome).
    await expect(page.locator('[data-method="recovery-codes"] [data-part="mark-set"]')).toHaveCount(1);
    await expectParity(page, 'SetupWelcome', { viewport: v });
    await page.click('[data-part="start-trading"]');
    // Owner G25: the sign-up session ends and Log in comes next, carrying the take on.
    await expect(page).toHaveURL(`/login?returnTo=${encodeURIComponent(TAKE)}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Log in');
    expect(s.requests).toContain('POST /v1/logout');

    // The register calls carry both names (FU-A) and the accepted Terms version, no signature (owner demo note #187).
    expect(s.bodies['pgp-start']).toEqual([{ displayName: 'lumen.kai', loginName: 'lumen-login-7', publicKey: realKey.trim() }]);
    expect(s.bodies['pgp-finish']).toEqual([
      expect.objectContaining({ challengeId: 'c1', code: '1234-5678-9ABC', acceptedTerms: TERMS_VERSION }),
    ]);
    expect(s.bodies['pgp-finish']?.[0]).not.toHaveProperty('termsSignature');
    // The first wallet goes with no confirm token and no confirm-it's-you call at all.
    expect(s.bodies.wallets).toEqual([{ wallets: [{ app: 'other', label: 'Wallet 1', address: ADDRESS }] }]);
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
      return json({ displayName: 'lumen.kai' }, 201)(r);
    });

    await page.goto('/setup');
    await acceptTerms(page);
    await pickNames(page, 'lumen.kai', 'lumen-login-7');
    await chooseOnly(page, 'password');
    await page.click('[data-part=\"method-continue\"]');
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
    await addAuthenticator(page);
    await expect(page).toHaveURL(/\/setup\/backup\?/);

    expect(s.bodies.password?.at(-1)).toMatchObject({
      displayName: 'lumen.kai',
      loginName: 'lumen-login-7',
      password: 'Quiet-harbour-58',
      acceptedTerms: TERMS_VERSION,
    });
    expect(s.bodies.password?.at(-1)).not.toHaveProperty('termsSignature');
  });
}

// Owner demo note #190 (25 Nov 2026): his layout makes the tick box the only condition; no
// read-to-the-end gate, no scroll hint. The order: the tick, the button, then the log-in line.
test('Start creating my account is disabled until the box is ticked, with no scroll gate', async ({ page }) => {
  await stubApi(page);
  await page.goto('/setup');
  const tick = page.locator('[data-part="terms-tick"]');
  const accept = page.locator('[data-part="terms-accept"]');
  await expect(accept).toBeVisible();
  await expect(accept).toBeDisabled();
  // Not scrolled at all: the box can be ticked at once.
  await expect(tick).toBeEnabled();
  await expect(page.locator('#terms-hint')).toHaveCount(0);
  await expect(page.locator('[data-screen="setup-terms"]')).not.toContainText('Scroll to the end');
  const y = async (sel: string) => (await page.locator(sel).boundingBox())!.y;
  await tick.scrollIntoViewIfNeeded();
  expect(await y('[data-part="terms-tick"]')).toBeLessThan(await y('[data-part="terms-accept"]'));
  expect(await y('[data-part="terms-accept"]')).toBeLessThan(await y('[data-part="setup-login"]'));
  await expect(page.locator('.x2f-start__foot')).toContainText('Already have an account? Log in');
  await page.check('[data-part="terms-tick"]');
  // The tick alone is enough: no signature (owner demo note #187, 25 Nov 2026).
  await expect(accept).toBeEnabled();
  await page.uncheck('[data-part="terms-tick"]');
  await expect(accept).toBeDisabled();
  await page.check('[data-part="terms-tick"]');
  await expect(accept).toBeEnabled();
});

// Owner demo note #189 (25 Nov 2026): "Privacy Policy" opens the privacy section in place.
test('Privacy Policy shows the privacy section in this page, by mouse or keyboard, and never ticks the box or leaves /setup', async ({ page }) => {
  await stubApi(page);
  await page.goto('/setup');
  const tick = page.locator('[data-part="terms-tick"]');
  await expect(page.locator('[data-part="terms-accept"]')).toBeVisible();
  const privacy = page.locator('[data-part="terms-show-privacy"]');
  await privacy.click();
  await expect(page).toHaveURL(/\/setup(\?|$)/);
  await expect(page.locator('#terms-privacy')).toBeInViewport();
  await expect(page.locator('#terms-privacy')).toBeFocused();
  await expect(tick).not.toBeChecked();
  // The keyboard: Enter on the button does the same.
  await page.locator('.x2f-start__main').evaluate((el) => el.scrollTo({ top: 0 }));
  await privacy.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#terms-privacy')).toBeFocused();
  await expect(tick).not.toBeChecked();
  await expect(page).toHaveURL(/\/setup(\?|$)/);
});

// Review of note #187 (M2): the whole tick row is one tap target, at least 44 px tall.
test('the tick row is at least 44 px tall and a tap on it ticks the box; its two buttons do not', async ({ page }) => {
  await setViewport(page, '390x844');
  await stubApi(page);
  await page.goto('/setup');
  const tick = page.locator('[data-part="terms-tick"]');
  const row = page.locator('[data-part="terms-agree"]');
  await row.scrollIntoViewIfNeeded();
  const box = (await row.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  // The right end of the row, past the words.
  await page.mouse.click(box.x + box.width - 4, box.y + box.height / 2);
  await expect(tick).toBeChecked();
  await page.locator('[data-part="terms-show-tos"]').click();
  await expect(tick).toBeChecked();
  await row.scrollIntoViewIfNeeded();
  await page.locator('[data-part="terms-show-privacy"]').click();
  await expect(tick).toBeChecked();
});

// Owner demo note #187 (25 Nov 2026): no signature pad, no typed name; the keyboard alone ticks and accepts.
test('no signature: no pad or typed name, and the keyboard alone ticks and accepts; the setup sends the version once', async ({ page }) => {
  const s = await stubApi(page);
  await page.goto('/setup');
  const accept = page.locator('[data-part="terms-accept"]');
  await expect(accept).toBeVisible();
  await expect(page.locator('[data-part="signature-pad"]')).toHaveCount(0);
  await expect(page.locator('[data-part="signature-type"]')).toHaveCount(0);
  await expect(page.locator('#terms-sign-help')).toHaveCount(0);
  await expect(page.locator('[data-screen="setup-terms"]')).not.toContainText('Sign your name');
  const tick = page.locator('[data-part="terms-tick"]');
  await tick.focus();
  await page.keyboard.press('Space');
  await expect(tick).toBeChecked();
  await expect(accept).toBeEnabled();
  await accept.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/setup\/name\?/);

  await pickNames(page, 'lumen.kai', 'lumen-login-7');
  await chooseOnly(page, 'password');
  await page.click('[data-part=\"method-continue\"]');
  await page.fill('#pw', 'Quiet-harbour-58');
  await page.fill('#pw2', 'Quiet-harbour-58');
  await page.click('[data-part="password-set"]');
  await addAuthenticator(page);
  await expect(page).toHaveURL(/\/setup\/backup\?/);
  expect(s.bodies.password).toEqual([expect.objectContaining({ acceptedTerms: TERMS_VERSION })]);
  expect(s.bodies.password?.[0]).not.toHaveProperty('termsSignature');
});

test('Mira.Kay_ shows exactly as typed after setup (password path)', async ({ page }) => {
  const s = await stubApi(page);
  const urls: string[] = [];
  page.on('framenavigated', (f) => urls.push(f.url()));

  await page.goto(`/setup?returnTo=${encodeURIComponent('/post')}`);
  await acceptTerms(page);
  await pickNames(page, 'Mira.Kay_', 'mira-signin-01');
  await chooseOnly(page, 'password');
  await page.click('[data-part=\"method-continue\"]');
  await page.fill('#pw', 'Quiet-harbour-58');
  await page.fill('#pw2', 'Quiet-harbour-58');
  await page.click('[data-part="password-set"]');

  await addAuthenticator(page);
  await expect(page).toHaveURL(/\/setup\/backup\?/);
  await saveRecoveryCodes(page);
  await page.fill('#xmr-payout', ADDRESS);
  await page.click('[data-part="wallet-finish"]');
  // Owner #161: the saved first wallet shows its green check, then Continue.
  await expect(page.locator('[data-part="address-verified"]')).toBeVisible();
  await page.click('[data-part="wallet-continue"]');

  // Owner #165: "Welcome to" and the X2F logo (its label), then the name with a comma.
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome to X2F' })).toBeVisible();
    await expect(page.locator('[data-part="welcome-name"]')).toHaveText('Mira.Kay_,');
  const name = page.locator('[data-username]');
  await expect(name).toHaveText('Mira.Kay_');
  expect(await name.evaluate((el) => getComputedStyle(el).textTransform)).toBe('none');
  await expect(page.locator('[data-method="recovery-codes"] [data-part="mark-set"]')).toHaveCount(1);
  // Owner demo notes 12 Nov 2026: Welcome's fee line is now his own (owner-copy.spec.ts).
  await expect(page.getByText('Remember, you only pay a fee if you post an ad. Clicking on an ad and starting a trade is always free.')).toBeVisible();
  expect(s.bodies.password?.[0]).toMatchObject({ displayName: 'Mira.Kay_', loginName: 'mira-signin-01' });

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

test('the username and display name are checked before going on (8-20, owner notes #126 and #127; allowed characters, free, different)', async ({ page }) => {
  const s = await stubApi(page);
  await page.goto('/setup');
  await acceptTerms(page);
  const go = page.locator('[data-part="names-continue"]');

  // Step 1 is one private field: no second name on this screen.
  await expect(page.locator('[data-screen="setup-name"] input')).toHaveCount(1);
  // Owner demo note #196: Continue is disabled until the name passes the rules, which tick live
  // (too short is "not yet", never red; a wrong character or a space is red).
  const rule = (id: string) => page.locator(`#uname-rules [data-rule="${id}"]`);
  await expect(go).toBeDisabled();
  await page.fill('#uname', 'abcdefg');
  await expect(go).toBeDisabled();
  await expect(rule('length')).toHaveAttribute('data-met', 'unknown');
  // Owner demo note #108: a space has its own message.
  await page.fill('#uname', 'Mira K12');
  await expect(go).toBeDisabled();
  await expect(rule('no-spaces')).toHaveAttribute('data-met', 'false');
  await expect(page.locator('[data-part="name-space"]')).toHaveText('Remove the spaces. A Login ID has no spaces.');
  // Any other character outside the set turns the characters row red.
  await page.fill('#uname', 'Mira#Kai');
  await expect(go).toBeDisabled();
  await expect(rule('characters')).toHaveAttribute('data-met', 'false');
  // Wrong shapes are never sent to the live check.
  expect(s.bodies['name-check'] ?? []).toEqual([]);
  await page.fill('#uname', 'taken.name');
  await expect(page.locator('[data-part="name-status"]')).toHaveText('taken.name is taken. Try another.');
  await expect(go).toBeDisabled();
  await expect(page.locator('[data-part="names-error"]')).toHaveCount(0);
  await expect(page).toHaveURL(/\/setup\/name/);

  await page.fill('#uname', 'login-name-1');
  await expect(page.locator('[data-part="name-status"]')).toHaveText('login-name-1 is available');
  await go.click();
  await expect(page.locator('[data-screen="setup-display-name"]')).toBeVisible();
  // Owner demo note #219: Continue is disabled until the display name passes, with the reason as help.
  const display = page.locator('[data-part="display-continue"]');
  await expect(display).toBeDisabled();
  await page.fill('#display-name', 'login-NAME-1');
  await expect(display).toBeDisabled();
  await expect(page.locator('[data-part="display-problem"]')).toHaveText('Your display name must be different from your Login ID.');
  await expect(page).toHaveURL(/\/setup\/display-name/);
  await page.fill('#display-name', 'Lumen.Kai');
  await expect(display).toBeEnabled();
  await expect(page.locator('[data-part="display-problem"]')).toHaveCount(0);
});

test('a taken display name at register sends the person back to change their names, both kept', async ({ page }) => {
  await stubApi(page);
  await page.unroute('**/v1/register/password');
  await page.route('**/v1/register/password', json({ error: 'display-name-taken' }, 409));
  await page.goto('/setup');
  await acceptTerms(page);
  await pickNames(page, 'lumen.kai', 'lumen-login-7');
  await chooseOnly(page, 'password');
  await page.click('[data-part=\"method-continue\"]');
  await page.fill('#pw', 'Quiet-harbour-58');
  await page.fill('#pw2', 'Quiet-harbour-58');
  await page.click('[data-part="password-set"]');
  await expect(page.locator('[data-part="register-error"]')).toContainText('That display name is taken.');
  // Review F8: "Change your names" opens the screen of the name that was refused (the display name).
  await page.click('[data-part="change-names"]');
  await expect(page).toHaveURL(/\/setup\/display-name\?/);
  await expect(page.locator('#display-name')).toHaveValue('lumen.kai');
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
  await page.fill('#display-name', 'lumen.kai');
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
  // Owner S-017 (recovery code required) knowingly overrides this test's "one tap per board" rule
  // for this step: it needs a tap to show the code, a tick, Next, and the code typed back (review
  // S2b; owner demo notes 12 Nov 2026); then it goes straight on to the wallet (lead call).
  await saveRecoveryCodes(page);
  await at('setup-wallet');
  await page.fill('#xmr-payout', ADDRESS);
  await page.click('[data-part="wallet-finish"]');
  // Owner #161: the saved first wallet shows its green check, then Continue.
  await expect(page.locator('[data-part="address-verified"]')).toBeVisible();
  await page.click('[data-part="wallet-continue"]');
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

// Review 12 Nov (the playwright.config change): every other spec starts on a device that has seen
// the welcome screen. This journey is what a new device really does: sign up, log in, and the
// first /sell is the welcome screen (owner, 12 Nov 2026, demo note #47).
test.describe('on a new device', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('sign-up, then the first login, lands on the welcome screen; Skip goes on to /sell', async ({ page }) => {
    await stubApi(page);
    await page.goto('/setup');
    await acceptTerms(page);
    await pickNames(page, 'lumen.kai', 'lumen-login-7');
    // Sign-up v2 (owner ruling): a password alone is not enough, so the password goes with an
    // authenticator app (the setup's own helpers), then the required recovery code and the wallet.
    await chooseOnly(page, 'password');
    await page.click('[data-part="method-continue"]');
    await page.fill('#pw', 'Quiet-harbour-58');
    await page.fill('#pw2', 'Quiet-harbour-58');
    await page.click('[data-part="password-set"]');
    await addAuthenticator(page);
    await expect(page).toHaveURL(/\/setup\/backup\?/);
    await saveRecoveryCodes(page);
    await page.fill('#xmr-payout', ADDRESS);
    await page.click('[data-part="wallet-finish"]');
    // Owner #161: the saved first wallet shows its green check, then Continue.
    await expect(page.locator('[data-part="address-verified"]')).toBeVisible();
    await page.click('[data-part="wallet-continue"]');
    await page.click('[data-part="start-trading"]');
    await expect(page.locator('[data-screen="login"]')).toBeVisible();
    await page.click('[data-method="password"]');
    await page.fill('#login-name', 'lumen-login-7');
    await page.fill('#login-password', 'Quiet-harbour-58');
    await page.click('[data-part="password-login"]');
    await expect(page.locator('[data-screen="session-length"]')).toBeVisible();
    await page.selectOption('[data-part="session-length-select"]', '4');
    await page.click('[data-part="session-length-continue"]');
    await expect(page).toHaveURL(/\/welcome$/);
    await expect(page.locator('[data-screen="welcome"]')).toBeVisible();
    await page.getByRole('button', { name: 'Skip and get started' }).click();
    await expect(page).toHaveURL(/\/sell$/);
    expect(await page.evaluate(() => localStorage.getItem('x2f.welcome.seen'))).toBe('1');
  });
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
  // A changed Terms version is accepted with the tick alone (owner demo note #187, 25 Nov 2026).
  expect(accepted).toEqual({ version: TERMS_VERSION });
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
  // Owner #96: a plain list of wallets (nothing to click) and the Edge tip with Edge's real setting.
  await expect(page.locator('[data-part="wallet-list"] li')).toHaveText(['Cake Wallet', 'Edge', 'Feather', 'Monerujo', 'Stack', 'Monero GUI', 'Ledger or Trezor']);
  await expect(page.locator('[data-part="wallet-list"] button')).toHaveCount(0);
  await expect(page.getByText("Using Edge? For best privacy, open your Monero wallet's menu in Edge, choose Wallet Settings and pick Full Node.", { exact: false })).toBeVisible();
  await page.fill('#xmr-payout', ADDRESS);
  await page.click('[data-part="wallet-finish"]');
  // Owner #161: the saved first wallet shows its green check, then Continue.
  await expect(page.locator('[data-part="address-verified"]')).toBeVisible();
  await page.click('[data-part="wallet-continue"]');
  await expect(page).toHaveURL(/\/setup\/welcome\?/);
  await expect(page.locator('[data-part="summary-wallet"]')).toHaveText('Wallet 1 …k3Fz');
  expect(s.bodies.wallets).toEqual([{ wallets: [{ app: 'other', label: 'Wallet 1', address: ADDRESS }] }]);
  expect(s.requests.filter((r) => r.includes('/v1/confirm/'))).toEqual([]);
});

test('owner demo note #226: the first wallet can be named in setup, and Welcome shows that name', async ({ page }) => {
  const s = await stubApi(page, { signedIn: true, methods: ['pgp'], wallets: [] });
  await page.goto(`/setup?returnTo=${encodeURIComponent(TAKE)}`);
  await expect(page).toHaveURL(/\/setup\/wallet\?/);
  const name = page.getByLabel('Wallet name (optional)');
  await expect(name).toHaveAttribute('placeholder', 'e.g. Cake Wallet savings');
  await page.fill('#xmr-payout', ADDRESS);
  // A name the API would refuse holds Finish setup back and says why (note #219's rule).
  await name.fill('a\u202Eb');
  await expect(page.locator('[data-part="wallet-finish"]')).toBeDisabled();
  await expect(page.locator('[data-part="wallet-name-invalid"]')).toHaveText('Use 1 to 40 characters, with no hidden or control characters.');
  await name.fill('  Cake Wallet savings ');
  await expect(page.locator('[data-part="wallet-finish"]')).toBeEnabled();
  await page.click('[data-part="wallet-finish"]');
  await expect(page.locator('[data-part="address-verified"]')).toBeVisible();
  await page.click('[data-part="wallet-continue"]');
  await expect(page).toHaveURL(/\/setup\/welcome\?/);
  await expect(page.locator('[data-part="summary-wallet"]')).toHaveText('Cake Wallet savings …k3Fz');
  expect(s.bodies.wallets).toEqual([{ wallets: [{ app: 'other', label: 'Cake Wallet savings', address: ADDRESS }] }]);
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

  test(`the Terms screen works at ${v}: one primary action, no sideways scroll, one scroller`, async ({ page }) => {
    await setViewport(page, v);
    await stubApi(page);
    await page.goto('/setup');
    await expect(page.locator('[data-part="terms-accept"]')).toBeVisible();
    expect(await page.locator('[data-primary]').count()).toBe(1);
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(sideways).toBe(false);
    // Owner demo note #187 (25 Nov 2026): the full Terms flow in the page, with no scroll box (or
    // height limit) of their own; the frame's middle is the one thing that scrolls.
    const box = await page.locator('[data-part="terms-text"]').evaluate((el) => {
      const st = getComputedStyle(el);
      return { scroll: el.scrollHeight, client: el.clientHeight, overflowY: st.overflowY, maxHeight: st.maxHeight };
    });
    expect(box.scroll).toBeLessThanOrEqual(box.client + 1);
    expect(box.overflowY).toBe('visible');
    expect(box.maxHeight).toBe('none');
    const main = await page.locator('.x2f-start__main').evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
    expect(main.scroll).toBeGreaterThan(main.client);
    // I accept is reachable on a small phone without scrolling the page.
    const accept = await page.locator('[data-part="terms-accept"]').boundingBox();
    const [width, height] = v.split('x').map(Number) as [number, number];
    expect(accept!.y + accept!.height).toBeLessThanOrEqual(height);
    // Owner demo note #187 (25 Nov 2026): no signature pad.
    expect(width).toBeGreaterThan(0);
    await expect(page.locator('.x2f-sign__pad')).toHaveCount(0);
    // Design 9 Nov (p11-15): the intro and the button's words.
    await expect(page.locator('[data-screen="setup-terms"]')).toContainText(
      "Please take a quick moment to review our Terms of Service before getting started. You only need to accept them once—if we ever update them down the road, we'll highlight what changed to make it easy to spot, and prompt you to review and agree before continuing.",
    );
    await expect(page.locator('[data-part="terms-accept"]')).toHaveText('Start creating my account');
    await expect(page.locator('#terms-sign-help')).toHaveCount(0);
    // Owner demo note #190 (25 Nov 2026): the two cards' headings.
    await expect(page.locator('#terms-glance-heading')).toHaveText('Key Highlights (TL;DR)');
    await expect(page.locator('[data-part="terms-full-heading"]')).toHaveText(`Full Terms of Service (Version ${TERMS_VERSION})`);
  });
}

// Task 28 review fix round (review 2026-10-28, ~/x2f-comms/review-task28-2026-10-28.md).
test.describe('review fix round', () => {
  async function toPgpCode(page: Page): Promise<void> {
    await page.goto(`/setup?returnTo=${encodeURIComponent('/post')}`);
    await acceptTerms(page);
    await pickNames(page, 'lumen.kai', 'lumen-login-7');
    await page.click('[data-part="method-continue"]');
    await page.fill('#pub', realKey);
    await expect(page.locator('[data-part="key-check"]')).toContainText('Ed25519');
    await page.click('[data-part="key-continue"]');
    await expect(page).toHaveURL(/\/setup\/pgp-code\?/);
  }

  async function toPassword(page: Page): Promise<void> {
    await page.goto(`/setup?returnTo=${encodeURIComponent('/post')}`);
    await acceptTerms(page);
    await pickNames(page, 'lumen.kai', 'lumen-login-7');
    await chooseOnly(page, 'password');
    await page.click('[data-part=\"method-continue\"]');
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

  // Lead call (12 Nov 2026): the optional extra backups (a second PGP key, a security key) left the
  // backup step, so its I1 test of a second key already on another account went with them; a second
  // PGP key is added in Settings, and that refusal stays covered by pgp.test.ts (adding a key already
  // on another account → key-in-use at finish).

  test('I2: after a password sign-up, Back never reopens the sign-up steps or registers again', async ({ page }) => {
    const s = await stubApi(page);
    await toPassword(page);
    await page.click('[data-part="password-set"]');
    await addAuthenticator(page);
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
          user: { id: 'BwcH', name: 'lumen-login-7', displayName: 'lumen.kai' },
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
      return json({ displayName: 'lumen.kai' }, 201)(r);
    });
    await page.goto(`http://localhost:${process.env.X2F_E2E_PORT ?? 4317}/setup?returnTo=%2Fpost`);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
    });
    await acceptTerms(page);
    await pickNames(page, 'lumen.kai', 'lumen-login-7');
    await chooseOnly(page, 'passkey');
    await page.click('[data-part=\"method-continue\"]');
    await expect(page).toHaveURL(/\/setup\/backup\?/);
    expect(s.bodies['webauthn-start']).toEqual([{ displayName: 'lumen.kai', loginName: 'lumen-login-7', kind: 'passkey' }]);
    const finish = s.bodies['webauthn-finish']?.[0] as { acceptedTerms: string; deviceLabel: string; challengeId: string };
    expect(finish.challengeId).toBe('w1');
    expect(finish.acceptedTerms).toBe(TERMS_VERSION);
    expect(finish).not.toHaveProperty('termsSignature');
    expect(finish.deviceLabel).not.toBe(TERMS_VERSION);
    expect(finish.deviceLabel.length).toBeGreaterThan(0);
  });

  test('M5: a cancelled passkey prompt says so and keeps the person on the login step', async ({ page }) => {
    await stubApi(page);
    await page.route('**/v1/register/webauthn/start', json({ error: 'webauthn-failed' }, 401));
    await page.goto('/setup');
    await acceptTerms(page);
    await pickNames(page, 'lumen.kai', 'lumen-login-7');
    await chooseOnly(page, 'passkey');
    await page.click('[data-part=\"method-continue\"]');
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
      return json({ displayName: 'lumen.kai' }, 201)(r);
    });
    await toPassword(page);
    await page.click('[data-part="password-set"]');
    await expect(page.locator('[data-screen="setup-terms"]')).toBeVisible();
    await expect(page.locator('[data-part="terms-tick"]')).not.toBeChecked();
    await acceptTerms(page);
    // The names are kept (the private username, then the display name on its own screen); the
    // person picks the method again.
    await expect(page.locator('#uname')).toHaveValue('lumen-login-7');
    await page.click('[data-part="names-continue"]');
    await expect(page.locator('#display-name')).toHaveValue('lumen.kai');
    await page.click('[data-part="display-continue"]');
    await chooseOnly(page, 'password');
    await page.click('[data-part=\"method-continue\"]');
    await page.fill('#pw', 'Quiet-harbour-58');
    await page.fill('#pw2', 'Quiet-harbour-58');
    await page.click('[data-part="password-set"]');
    await addAuthenticator(page);
    await expect(page).toHaveURL(/\/setup\/backup\?/);
    expect(s.bodies.password).toHaveLength(2);
    expect(s.bodies.password?.[1]).toMatchObject({ acceptedTerms: TERMS_VERSION });
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
    // Review of note #187 (M1): on a 390 px phone the message is on screen, not below the Terms.
    await setViewport(page, '390x844');
    await page.goto('/terms?returnTo=%2Fpost');
    await acceptTerms(page);
    await expect(page.locator('[data-screen="terms"] [role="alert"]')).toContainText('The Terms changed while you were reading');
    await expect(page.locator('[data-screen="terms"] [role="alert"]')).toBeInViewport();
    await expect(page.locator('[data-part="terms-stale"]')).toHaveCount(0);
    await expect(page.locator('[data-part="terms-tick"]')).not.toBeChecked();
    expect(gets).toBeGreaterThanOrEqual(2);
    await acceptTerms(page);
    await expect(page).toHaveURL(/\/post$/);
    expect(posts).toHaveLength(2);
    expect(posts[1]).toEqual({ version: TERMS_VERSION });
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
    // With no pad to draw on, the click comes at once: wait for the POST rather than race it.
    await expect.poll(() => posts).toEqual([{ version: TERMS_VERSION }]);
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
    await expect(page.locator('[data-part="terms-tick"]')).toBeEnabled();
    await expect(page.locator('[data-part="terms-accept"]')).toBeDisabled();
    await acceptTerms(page);
    await expect(page).toHaveURL(/\/post$/);
    expect(posts).toEqual([{ version: TERMS_VERSION }, { version: NEW }]);
  });

  test('M4: when the server names Terms this page does not carry, the page says to reload and I accept stays off', async ({ page }) => {
    await stubApi(page);
    await page.unroute('**/v1/terms');
    await page.route('**/v1/terms', json({ version: '2099-01-01' }));
    // Review of note #187 (M1): on a 390 px phone the notice is on screen, not below the Terms.
    await setViewport(page, '390x844');
    await page.goto('/setup');
    await expect(page.locator('[data-part="terms-stale"]')).toHaveText('The Terms have been updated. Reload the page to read the new version.');
    await expect(page.locator('[data-part="terms-stale"]')).toBeInViewport();
    await expect(page.locator('[data-part="terms-tick"]')).toBeDisabled();
    await expect(page.locator('[data-part="terms-accept"]')).toBeDisabled();
  });

  test('M7: an integrated address reaches the server and gets its own sentence', async ({ page }) => {
    await stubApi(page, { signedIn: true, methods: ['pgp'] });
    await page.route('**/v1/wallets', (r) =>
      r.request().method() === 'GET' ? json([])(r) : json({ error: 'address-integrated' }, 400)(r),
    );
    await page.goto(`/setup/wallet?returnTo=${encodeURIComponent('/post')}`);
    await page.fill('#xmr-payout', `4${'9'.repeat(101)}k3Fz`);
    await page.click('[data-part="wallet-finish"]');
    await expect(page.locator('[data-part="wallet-error"]')).toHaveText('That is an integrated address. Paste a normal receive address from your wallet.');
  });

  test('M8: the choice groups follow their pattern (login methods: checkboxes, one tab stop each) and help text is linked', async ({ page }) => {
    await stubApi(page);
    await page.goto('/setup');
    // No scroll hint (owner demo note #190) and no signature line (#187): the box is named by its
    // whole line and described by nothing until the page is stale.
    await expect(page.locator('[data-part="terms-tick"]')).not.toHaveAttribute('aria-describedby', /.+/);
    await expect(page.getByRole('checkbox', { name: 'I have read and agree to the Terms of Service and Privacy Policy' })).toBeVisible();
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
    await page.fill('#display-name', 'lumen.kai');
    await page.click('[data-part="display-continue"]');
    // Owner demo notes (12 Nov 2026): the login methods are checkboxes now, each its own tab stop,
    // ticked with Space, each linked to its description.
    const boxes = page.locator('[role="group"][aria-label="Login methods"] input[type="checkbox"]');
    await expect(boxes).toHaveCount(5);
    await expect(boxes.nth(0)).toBeChecked();
    await boxes.nth(0).focus();
    await page.keyboard.press('Tab');
    await expect(boxes.nth(1)).toBeFocused();
    await page.keyboard.press('Space');
    await expect(boxes.nth(1)).toBeChecked();
    await expect(boxes.nth(0)).toBeChecked();
    for (let i = 0; i < 5; i++) {
      const d = (await boxes.nth(i).getAttribute('aria-describedby'))!;
      await expect(page.locator(`[id="${d}"]`)).toHaveCount(1);
    }
  });
});
