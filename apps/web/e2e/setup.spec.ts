// Getting started (Plan 3 Task 28): Terms first, then names, login method, PGP key and code or a
// password, a backup login (or Skip for now), the first payout wallet, and Welcome with Start
// trading back to `returnTo`. Every Setup board is checked with the parity harness at the board's
// phone size (390x844) and at a small Android size (360x800) (owner 2026-10-25: mobile ready at
// launch). The API is stubbed per test with page.route, in FU-A's shapes (display name + private
// login name), as FU-A's API defines them (on the main line since 2026-10-28).
import { expect, test, type Page, type Route } from '@playwright/test';
import * as openpgp from 'openpgp';
import { BOARD_BUY_QUOTE as B } from '../src/fixtures/quoteBoard.js';
import { expectParity, type ParityViewport } from './parity.js';

const PHONES = ['390x844', '360x800'] as const satisfies readonly ParityViewport[];

const TERMS_VERSION = '2026-10-17';
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
          logoutTimer: { idleHours: 12, adjustable: true },
          termsCurrent: s.termsCurrent,
        })(r)
      : json({ error: 'not-authenticated' }, 401)(r),
  );
  await page.route('**/v1/terms', json({ version: TERMS_VERSION }));
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

async function acceptTerms(page: Page): Promise<void> {
  await readTermsToEnd(page);
  await page.check('[data-part="terms-tick"]');
  await page.click('[data-part="terms-accept"]');
}

async function pickNames(page: Page, display: string, login: string): Promise<void> {
  await page.fill('#uname', display);
  await page.fill('#login-name', login);
  await page.click('[data-part="names-continue"]');
}

for (const v of PHONES) {
  test(`the PGP path matches every Setup board at ${v} and Start trading resumes the take`, async ({ page }) => {
    await setViewport(page, v);
    const s = await stubApi(page);

    await page.goto(`/setup?returnTo=${encodeURIComponent(TAKE)}`);
    await expect(page.locator('[data-screen="setup-terms"]')).toBeVisible();
    await acceptTerms(page);

    await expect(page).toHaveURL(/\/setup\/name\?/);
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
    await expectParity(page, 'SetupBackup', { viewport: v });
    await page.click('[data-part="backup-add"]');
    await page.click('[data-part="totp-start"]');
    await page.fill('#totp-code', '123456');
    await page.click('[data-part="totp-finish"]');

    await expect(page).toHaveURL(/\/setup\/wallet\?/);
    await expectParity(page, 'SetupWallet', { viewport: v });
    await page.fill('#addr', ADDRESS);
    await page.click('[data-part="wallet-finish"]');

    await expect(page).toHaveURL(/\/setup\/welcome\?/);
    await expect(page.locator('h1')).toHaveText('Welcome to X2F, lumen.k');
    await expectParity(page, 'SetupWelcome', { viewport: v });
    await page.click('[data-part="start-trading"]');
    await expect(page).toHaveURL(new RegExp(`${TAKE.replace(/[?]/g, '\\?')}$`));

    // The register calls carry both names (FU-A) and the accepted Terms version.
    expect(s.bodies['pgp-start']).toEqual([{ displayName: 'lumen.k', loginName: 'lumen-login-7', publicKey: realKey.trim() }]);
    expect(s.bodies['pgp-finish']).toEqual([expect.objectContaining({ challengeId: 'c1', code: '1234-5678-9ABC', acceptedTerms: TERMS_VERSION })]);
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
  await expect(accept).toBeEnabled();
  await page.uncheck('[data-part="terms-tick"]');
  await expect(accept).toBeDisabled();
});

test('Mira.K_ shows exactly as typed after setup (password path, backup skipped)', async ({ page }) => {
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
  await page.click('[data-part="backup-skip"]');
  await page.fill('#addr', ADDRESS);
  await page.click('[data-part="wallet-finish"]');

  await expect(page.locator('h1')).toHaveText('Welcome to X2F, Mira.K_');
  const name = page.locator('[data-username]');
  await expect(name).toHaveText('Mira.K_');
  expect(await name.evaluate((el) => getComputedStyle(el).textTransform)).toBe('none');
  await expect(page.locator('[data-part="summary-backup"]')).toHaveText('None yet');
  await expect(page.getByText('You pay X2F 1% of each completed trade from your own ads. Taking an offer is free.')).toBeVisible();
  expect(s.bodies.password?.[0]).toMatchObject({ displayName: 'Mira.K_', loginName: 'mira-signin-01' });

  await page.click('[data-part="start-trading"]');
  await expect(page).toHaveURL(/\/post$/);

  // No secret in any URL or in browser storage.
  for (const u of urls) expect(u).not.toContain('harbour');
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(stored).not.toContain('harbour');
  expect(stored).not.toContain('mira-signin');
});

test('the display name and login name are checked before going on (5-20, allowed characters, different)', async ({ page }) => {
  await stubApi(page);
  await page.goto('/setup');
  await acceptTerms(page);
  const go = page.locator('[data-part="names-continue"]');

  await page.fill('#uname', 'abcd');
  await page.fill('#login-name', 'login-name-1');
  await go.click();
  await expect(page.locator('[data-part="names-error"]')).toHaveText('Your username needs 5 to 20 characters.');
  await page.fill('#uname', 'Mira K');
  await go.click();
  await expect(page.locator('[data-part="names-error"]')).toHaveText('Your username can use only letters, numbers, dots, dashes and underscores.');
  await page.fill('#uname', 'login-NAME-1');
  await go.click();
  await expect(page.locator('[data-part="names-error"]')).toHaveText('Your login name must be different from your username.');
  await expect(page).toHaveURL(/\/setup\/name/);
});

test('a taken username at register sends the person back to change it', async ({ page }) => {
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
  await expect(page.locator('[data-part="register-error"]')).toContainText('That username is taken.');
  await page.click('[data-part="change-names"]');
  await expect(page).toHaveURL(/\/setup\/name\?/);
  await expect(page.locator('#uname')).toHaveValue('lumen.k');
});

test('a step opened without the earlier ones goes back to the Terms', async ({ page }) => {
  await stubApi(page);
  await page.goto(`/setup/password?returnTo=${encodeURIComponent('/post')}`);
  await expect(page).toHaveURL(/\/setup\?returnTo=%2Fpost$/);
  await expect(page.locator('[data-screen="setup-terms"]')).toBeVisible();
});

// Plan 3 Revision 2026-10-28 (no guest buying): a visitor's Trade tap must stay a short trip. From
// the quote, the shortest route (Terms, names, a login method, the first wallet) comes back to the
// same quote with the amount kept, through no more screens than the Setup boards, each one reached
// by a single tap of its own button (no dead end). Any step added later must keep this green.
test('a visitor who taps Trade comes back to the same quote, amount kept, through no more than the Setup boards', async ({ page }) => {
  const s = await stubApi(page);
  const takes: unknown[] = [];
  await page.route('**/v1/methods?*', json({ live: [{ id: B.method.id, name: B.method.name, group: 'Payment apps', giftCard: false, offers: 1, bestRate: B.marketCentsPerXmr }], all: [] }));
  await page.route('**/v1/price?*', json({ currency: B.currency, centsPerXmr: B.marketCentsPerXmr, exponent: 2, at: new Date().toISOString(), usdCentsPerXmr: B.marketCentsPerXmr }));
  await page.route('**/v1/offers?*', json([B.offer]));
  await page.route('**/v1/offers/*/take', (r) => {
    takes.push(r.request().postDataJSON());
    return json({ code: B.code })(r);
  });

  const quote = `/buy/${B.method.id}/${B.offer.id}?currency=${B.currency}&amount=${B.amount}`;
  await page.goto(quote);
  await expect(page.locator('#quote-amount')).toHaveValue(B.amount);
  await page.locator('[data-primary]').click();

  // Every screen on the way, in order: one tap of its primary action moves on.
  const seen: string[] = [];
  const at = async (screen: string) => {
    await expect(page.locator(`[data-screen="${screen}"]`)).toBeVisible();
    seen.push(screen);
  };
  await at('setup-terms');
  await acceptTerms(page);
  await at('setup-name');
  await pickNames(page, 'lumen.k', 'lumen-login-7');
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
  await page.click('[data-part="backup-skip"]');
  await at('setup-wallet');
  await page.fill('#addr', ADDRESS);
  await page.click('[data-part="wallet-finish"]');
  await at('setup-welcome');
  await page.click('[data-part="start-trading"]');

  // Back on the same quote in this tab, the amount kept, asking for a fresh tap; nothing taken yet.
  await expect(page.locator('[data-screen="quote"]')).toBeVisible();
  const back = new URL(page.url());
  expect(back.pathname).toBe(`/buy/${B.method.id}/${B.offer.id}`);
  await expect(page.locator('#quote-amount')).toHaveValue(B.amount);
  await expect(page.getByRole('status')).toHaveText("You're back. Check the total, then tap Trade.");
  expect(takes).toEqual([]);

  // No more screens than the Setup boards (SetupPassword is the other branch of the login step).
  const SETUP_BOARDS = ['SetupTerms', 'SetupUsername', 'SetupLogin', 'SetupPgpKey', 'SetupPgpChallenge', 'SetupPassword', 'SetupBackup', 'SetupWallet', 'SetupWelcome'];
  expect(seen.length).toBeLessThanOrEqual(SETUP_BOARDS.length - 1);
  expect(seen).toEqual(['setup-terms', 'setup-name', 'setup-login', 'setup-pgp-key', 'setup-pgp-code', 'setup-backup', 'setup-wallet', 'setup-welcome']);
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
  let accepted: unknown = null;
  let version = '2026-10-17';
  await page.route('**/v1/terms', (r) => json({ version })(r));
  await page.route('**/v1/account/me', (r) =>
    accepted === null && version !== '2026-10-17'
      ? json({ error: 'terms-required', version }, 403)(r)
      : json({ displayName: 'nightowl', loginNameSet: true, kind: 'trader', level: 'full', holdUntil: null, methods: ['pgp'], hasBackup: false, suggestions: [], logoutTimer: { idleHours: 12, adjustable: true }, termsCurrent: true })(r),
  );
  await page.route('**/v1/account/terms', (r) => {
    accepted = JSON.parse(r.request().postData() ?? 'null');
    return r.fulfill({ status: 204 });
  });

  // The owner publishes new Terms: the next page load is refused with terms-required.
  version = '2026-11-02';
  await page.goto('/trade/K7M2-9QXA-4FTR-8WPN');
  await expect(page).toHaveURL(/\/terms\?returnTo=%2Ftrade%2FK7M2-9QXA-4FTR-8WPN$/);
  await expect(page.locator('[data-part="terms-accept"]')).toBeDisabled();
  await acceptTerms(page);
  await expect(page).toHaveURL(/\/trade\/K7M2-9QXA-4FTR-8WPN$/);
  expect(accepted).toEqual({ version: '2026-11-02' });
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
    await expect(page.locator('[data-part="terms-text"]')).toContainText('End of Terms. Version 2026-10-17.');
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
    const [, height] = v.split('x').map(Number) as [number, number];
    expect(accept!.y + accept!.height).toBeLessThanOrEqual(height);
  });
}
