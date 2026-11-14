// Sign-up v2 (owner demo notes, 12 Nov 2026), at the owner's demo phone (443x794) and the boards'
// 390x844: the username heading; every login method a checkbox with the owner's labels, the ticked
// ones set up one after another and the recovery code after all of them; one long recovery code
// on two screens (shown with "I've written it down" and Next, then typed back unseen: red until it
// matches, green when it does, the dashes put in by themselves, Back showing the same code); the
// much bigger PGP key boxes on /setup/pgp-key and /login. The API is stubbed with page.route.
import { expect, test, type Page, type Route } from '@playwright/test';
import * as openpgp from 'openpgp';
import { expectPhoneLayout, setPhone } from './phone.js';
import type { ParityViewport } from './parity.js';

const VIEWPORTS = ['443x794', '390x844'] as const satisfies readonly ParityViewport[];
const TERMS_VERSION = '2026-11-09';
/** A 64-symbol code as the server makes them (16 groups of four). */
const CODE = 'K7M2-9QXA-4FTR-8WPN-ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-6789-0ABC-DEFG-HJKM-NPQR';
const MESSAGE = '-----BEGIN PGP MESSAGE-----\nhF4DkR7c2x9mPq0SAQdA4vJ8u2Lk0aQz\nWm3n…\n-----END PGP MESSAGE-----';
const ADDRESS = `4${'9'.repeat(90)}k3Fz`;
const SIGNING = { fingerprint: '3f2a9c417b0ed5a261c80e4b92d71f6ac3b80d15', publicKey: '-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nxjMEsigning\n-----END PGP PUBLIC KEY BLOCK-----\n' };

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

let realKey = '';
test.beforeAll(async () => {
  const { publicKey } = await openpgp.generateKey({ type: 'ecc', curve: 'ed25519Legacy', userIDs: [{ name: 'Signup Test' }], format: 'armored' });
  realKey = publicKey;
});

interface Stub {
  registered: boolean;
  methods: string[];
  calls: string[];
  bodies: Record<string, unknown[]>;
}

function recordIn(s: Stub, name: string, r: Route): void {
  s.calls.push(name);
  (s.bodies[name] ??= []).push(JSON.parse(r.request().postData() ?? 'null'));
}
const record = recordIn;

async function stubApi(page: Page): Promise<Stub> {
  const s: Stub = { registered: false, methods: [], calls: [], bodies: {} };
  const record = (name: string, r: Route) => recordIn(s, name, r);
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/v1/confirm/')) s.calls.push(`confirm ${u.pathname}`);
  });
  await page.route('**/v1/account/me', (r) =>
    s.registered
      ? json({ displayName: 'lumen.k', loginNameSet: true, kind: 'trader', level: 'full', holdUntil: null, methods: s.methods, hasBackup: false, suggestions: [], termsCurrent: true })(r)
      : json({ error: 'not-authenticated' }, 401)(r),
  );
  await page.route('**/v1/terms', json({ version: TERMS_VERSION }));
  await page.route('**/v1/pgp/signing-key', json(SIGNING));
  await page.route('**/v1/register/name-check', json({ available: true }));
  await page.route('**/v1/register/pgp/start', (r) => {
    record('pgp-start', r);
    return json({ challengeId: 'c1', encryptedMessage: MESSAGE, expiresAt: '2099-01-01T00:00:00.000Z', fingerprint: '3F2A9C417B0ED5A261C80E4B92D71F6AC3B80D15' })(r);
  });
  await page.route('**/v1/register/pgp/finish', (r) => {
    record('pgp-finish', r);
    s.registered = true;
    s.methods = ['pgp'];
    return json({ displayName: 'lumen.k' }, 201)(r);
  });
  await page.route('**/v1/register/password', (r) => {
    record('register-password', r);
    return json({ error: 'internal' }, 500)(r);
  });
  await page.route('**/v1/account/password', (r) => {
    record('set-password', r);
    s.methods.push('password');
    return json({ ok: true })(r);
  });
  await page.route('**/v1/account/totp/start', (r) => {
    record('totp-start', r);
    return json({ challengeId: 't1', otpauthUri: 'otpauth://totp/X2F:lumen.k?secret=JBSWY3DPEHPK3PXP&issuer=X2F', secret: 'JBSWY3DPEHPK3PXP' })(r);
  });
  await page.route('**/v1/account/totp/finish', (r) => {
    record('totp-finish', r);
    s.methods.push('totp');
    return json({ ok: true })(r);
  });
  await page.route('**/v1/account/recovery-codes', (r) => {
    record('recovery-codes', r);
    s.methods.push('recovery-codes');
    return json({ codes: [CODE] })(r);
  });
  await page.route('**/v1/wallets/rule', json({ firstWallet: true, strongMethods: ['pgp'], password: 'none', waitHours: 24 }));
  await page.route('**/v1/wallets', (r) => {
    if (r.request().method() === 'GET') return json([])(r);
    record('wallets', r);
    const b = JSON.parse(r.request().postData() ?? '{}') as { wallets: { app: string; label: string; address: string }[] };
    return json(b.wallets.map((w, i) => ({ id: `00000000-0000-4000-8000-00000000000${i}`, ...w, addressEnd: w.address.slice(-4), usableFrom: '2026-10-25T00:00:00.000Z', usable: true })), 201)(r);
  });
  // Security review M1(a): reaching Welcome closes the sign-up window.
  await page.route('**/v1/account/onboarding/end', (r) => {
    record('onboarding-end', r);
    return json({ ok: true })(r);
  });
  return s;
}

async function acceptTerms(page: Page): Promise<void> {
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
}

async function pickNames(page: Page): Promise<void> {
  await expect(page.locator('[data-screen="setup-name"]')).toBeVisible();
  await page.fill('#uname', 'lumen-login-7');
  await expect(page.locator('[data-part="name-status"]')).toHaveText('lumen-login-7 is available');
  await page.click('[data-part="names-continue"]');
  await page.fill('#display-name', 'lumen.k');
  await page.click('[data-part="display-continue"]');
}

const tick = (page: Page, id: string) => page.locator(`[data-method="${id}"] input[type="checkbox"]`);
const colour = (page: Page, sel: string, prop: 'color' | 'borderTopColor') => page.locator(sel).evaluate((el, p) => getComputedStyle(el)[p], prop);
const token = (page: Page, name: string) =>
  page.evaluate((n) => {
    // The token as a computed colour, read off a probe element.
    const probe = document.createElement('span');
    probe.style.color = `var(${n})`;
    document.body.append(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  }, name);

for (const v of VIEWPORTS) {
  test(`${v}: PGP, password and authenticator app are set up one after another, then the recovery code, written down and typed back unseen`, async ({ page }) => {
    await setPhone(page, v);
    const s = await stubApi(page);
    const [, height] = v.split('x').map(Number) as [number, number];
    await page.goto('/setup?returnTo=%2Fpost');
    await acceptTerms(page);

    // /setup/name
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pick a unique username');
    await expect(page.locator('[data-screen="setup-name"]')).not.toContainText('Nothing else to give');
    await expectPhoneLayout(page);
    await pickNames(page);

    // /setup/login: checkboxes with the owner's labels.
    await expect(page.locator('[data-screen="setup-login"]')).toBeVisible();
    await expect(page.locator('[role="radio"]')).toHaveCount(0);
    await expect(tick(page, 'pgp')).toBeChecked();
    for (const id of ['pgp', 'security-key']) {
      await expect(page.locator(`[data-method="${id}"] [data-part="recommended"]`)).toHaveText('Recommended');
      await expect(page.locator(`[data-method="${id}"] [data-part="strength"]`)).toHaveText('Strong');
      // Lead call (12 Nov 2026): green, its own token (not the escrow teal).
      expect(await colour(page, `[data-method="${id}"] [data-part="strength"]`, 'color')).toBe(await token(page, '--x2f-good'));
      expect(await token(page, '--x2f-good')).not.toBe(await token(page, '--x2f-escrow'));
    }
    await expect(page.locator('[data-method="totp"] [data-part="strength"]')).toHaveText('Medium');
    await expect(page.locator('[data-method="totp"]')).toContainText('6-digit code');
    await expect(page.locator('[data-method="password"] [data-part="strength"]')).toHaveText('Weak');
    await expect(page.locator('[data-method="password"]')).toContainText('It is strongly recommended you do not choose this as the only security method you use.');
    // Signup round 3 lead call: PGP (ticked by default) is enough for the authenticator app.
    await expect(tick(page, 'totp')).toBeEnabled();
    await page.click('[data-part="pgp-explain"]');
    await expect(page.locator('[data-part="pgp-explainer"]')).toContainText('On an Android phone we recommend PGP too, with PGPony (on F-Droid: com.pgpony.android). OpenKeychain works as well.');
    await page.click('[data-method="password"]');
    await expect(tick(page, 'password')).toBeChecked();
    await expect(tick(page, 'totp')).toBeEnabled();
    await page.click('[data-method="totp"]');
    await expect(tick(page, 'totp')).toBeChecked();
    // Lead call: "New to PGP?" is a 44 px tap target, and the whole step passes the phone layout check.
    expect((await page.locator('[data-part="pgp-explain"]').boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expectPhoneLayout(page);
    await page.click('[data-part="method-continue"]');

    // PGP first: its key box is much bigger.
    await expect(page).toHaveURL(/\/setup\/pgp-key\?/);
    const pub = await page.locator('#pub').boundingBox();
    const main = await page.locator('.x2f-start__main').boundingBox();
    expect(pub!.height).toBeGreaterThanOrEqual(Math.min(320, height * 0.4));
    expect(pub!.width).toBeGreaterThanOrEqual(main!.width - 2 * 16 - 1);
    await page.fill('#pub', realKey);
    await expect(page.locator('[data-part="key-check"]')).toContainText('Ed25519');
    await page.click('[data-part="key-continue"]');
    await expect(page).toHaveURL(/\/setup\/pgp-code\?/);
    // X2F's signing key to import (lead call, owner's "unknown signer" note): fingerprint and download.
    const signing = page.locator('[data-part="signing-key"]');
    await expect(signing).toContainText('3F2A 9C41 7B0E D5A2 61C8  0E4B 92D7 1F6A C3B8 0D15');
    await expect(signing.locator('a')).toHaveAttribute('href', '/.well-known/x2f-signing-key.asc');
    await expectPhoneLayout(page);
    await page.fill('#phrase', 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-6789-0ABC-DEFG-HJKM-NPQR');
    await page.click('[data-part="pgp-verify"]');
    await page.click('[data-part="pgp-continue"]');

    // Then the password, added to the account the PGP key made (no second sign-up).
    await expect(page).toHaveURL(/\/setup\/password\?/);
    await expect(page.locator('[data-screen="setup-password"]')).toBeVisible();
    // Signup round 3: each password field has a 44 px show/hide button; hidden by default.
    await expect(page.locator('#pw')).toHaveAttribute('type', 'password');
    const eye = page.locator('[data-part="password-field"]:has(#pw) [data-part="password-eye"]');
    await expect(eye).toHaveAttribute('aria-label', 'Show password');
    const eyeBox = (await eye.boundingBox())!;
    expect(Math.round(eyeBox.width)).toBeGreaterThanOrEqual(44);
    expect(Math.round(eyeBox.height)).toBeGreaterThanOrEqual(44);
    await eye.click();
    await expect(page.locator('#pw')).toHaveAttribute('type', 'text');
    await eye.click();
    await expect(page.locator('#pw')).toHaveAttribute('type', 'password');
    await page.fill('#pw', 'Quiet-harbour-58');
    await page.fill('#pw2', 'Quiet-harbour-58');
    await page.click('[data-part="password-set"]');

    // Then the authenticator app.
    await expect(page).toHaveURL(/\/setup\/authenticator\?/);
    await page.click('[data-part="totp-start"]');
    await expect(page.locator('[data-part="totp-secret"]')).toHaveText('JBSWY3DPEHPK3PXP');
    // Signup round 3: the otpauth link for a password manager on the same phone.
    await expect(page.locator('[data-part="totp-link"]')).toHaveAttribute('href', /^otpauth:\/\/totp\//);
    await page.fill('#totp-code', '123456');
    await page.click('[data-part="totp-finish"]');
    // Signup round 3: the green success state, until Continue.
    await expect(page.locator('[data-part="totp-success"]')).toHaveText('You have successfully set up your one-time password.');
    await page.click('[data-part="totp-continue"]');

    // The recovery code comes after all of them. Screen A: the code, the tick, Next.
    await expect(page).toHaveURL(/\/setup\/backup\?/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Save your recovery code');
    await page.click('[data-part="recovery-make"]');
    const shown = page.locator('[data-part="recovery-code"]');
    await expect(shown).toBeVisible();
    expect((await shown.innerText()).replace(/\s/g, '')).toBe(CODE.replaceAll('-', ''));
    await expect(page.locator('#recovery-typeback')).toHaveCount(0);
    await expect(page.locator('[data-part="recovery-next"]')).toBeDisabled();
    await expectPhoneLayout(page);
    await page.check('[data-part="recovery-written"]');
    await page.click('[data-part="recovery-next"]');

    // Screen B: the code is out of sight; red until it matches.
    await expect(shown).toHaveCount(0);
    await expect(page.locator('[data-screen="setup-backup"]')).not.toContainText(CODE.slice(20, 34));
    const input = page.locator('#recovery-typeback');
    await input.pressSequentially('k7m29qxa');
    await expect(input).toHaveValue('K7M2-9QXA');
    await expect(input).toHaveAttribute('data-match', 'no');
    expect(await colour(page, '#recovery-typeback', 'borderTopColor')).toBe(await token(page, '--x2f-danger'));
    await expect(page.locator('[data-part="recovery-continue"]')).toBeDisabled();
    await expectPhoneLayout(page);

    // Back shows the same code, and no new one is made.
    await page.click('[data-part="recovery-back"]');
    expect((await shown.innerText()).replace(/\s/g, '')).toBe(CODE.replaceAll('-', ''));
    await page.click('[data-part="recovery-next"]');

    // Pasted without dashes: the dashes go in, it turns green, and Next goes on.
    await input.focus();
    await page.keyboard.insertText(CODE.replaceAll('-', '').toLowerCase());
    await expect(input).toHaveValue(CODE);
    await expect(input).toHaveAttribute('data-match', 'yes');
    expect(await colour(page, '#recovery-typeback', 'borderTopColor')).toBe(await token(page, '--x2f-good'));
    await page.click('[data-part="recovery-continue"]');
    // Lead call: no "Add another backup" step; straight on to the wallet.
    await expect(page).toHaveURL(/\/setup\/wallet\?/);
    await page.fill('#addr', ADDRESS);
    await page.click('[data-part="wallet-finish"]');
    await expect(page).toHaveURL(/\/setup\/welcome\?/);
    await expect.poll(() => s.calls.includes('onboarding-end')).toBe(true);

    // One sign-up (the PGP key), then the password and the authenticator added to it, with no
    // confirm-it's-you in the sign-up window; one recovery code made, nothing sent to check it.
    expect(s.calls.filter((c) => !c.startsWith('confirm'))).toEqual(['pgp-start', 'pgp-finish', 'set-password', 'totp-start', 'totp-finish', 'recovery-codes', 'wallets', 'onboarding-end']);
    expect(s.calls.filter((c) => c.startsWith('confirm'))).toEqual([]);
    expect(s.bodies['set-password']).toEqual([{ password: 'Quiet-harbour-58' }]);
  });

  test(`${v}: a password added after PGP outside the sign-up window asks to confirm it's you (review m-1)`, async ({ page }) => {
    await setPhone(page, v);
    const s = await stubApi(page);
    await page.unroute('**/v1/account/password');
    await page.route('**/v1/account/password', (r) => {
      record(s, 'set-password', r);
      return json({ error: 'confirm-required', action: 'set-password' }, 403)(r);
    });
    await page.goto('/setup?returnTo=%2Fpost');
    await acceptTerms(page);
    await pickNames(page);
    await page.click('[data-method="password"]');
    await page.click('[data-part="method-continue"]');
    await page.fill('#pub', realKey);
    await expect(page.locator('[data-part="key-check"]')).toContainText('Ed25519');
    await page.click('[data-part="key-continue"]');
    await page.fill('#phrase', 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-6789-0ABC-DEFG-HJKM-NPQR');
    await page.click('[data-part="pgp-verify"]');
    await page.click('[data-part="pgp-continue"]');
    await expect(page).toHaveURL(/\/setup\/password\?/);
    await page.fill('#pw', 'Quiet-harbour-58');
    await page.fill('#pw2', 'Quiet-harbour-58');
    await page.click('[data-part="password-set"]');
    // The confirm sheet opens with the account's PGP key, rather than a dead end.
    await expect(page.locator('[role="dialog"] [data-method="pgp"]')).toBeVisible();
    await expect(page.locator('[data-part="register-error"]')).toHaveCount(0);
  });

  test(`${v}: the /login PGP key box is the same width and much taller`, async ({ page }) => {
    await setPhone(page, v);
    await page.route('**/v1/account/me', json({ error: 'not-authenticated' }, 401));
    const [, height] = v.split('x').map(Number) as [number, number];
    await page.goto('/login');
    await page.click('[data-method="pgp"]');
    const key = await page.locator('#pgp-key').boundingBox();
    const name = await page.locator('#pgp-login-name').boundingBox();
    expect(Math.abs(key!.width - name!.width)).toBeLessThanOrEqual(1);
    expect(key!.height).toBeGreaterThanOrEqual(Math.min(320, height * 0.4));
    await expectPhoneLayout(page);
  });
}

// The m-2 blocking fix (owner's demo notes, 13 Nov 2026): swiping Back from the recovery-code step
// reached the app without the code saved. Leaving /setup (Back, a typed address, a reload) now
// leads back to the recovery-code step until the code is saved.
test('leaving sign-up before the recovery code is saved leads back to it (m-2)', async ({ page }) => {
  await setPhone(page, VIEWPORTS[1]);
  const s = await stubApi(page);
  await page.goto('/setup?returnTo=%2Fpost');
  await acceptTerms(page);
  await pickNames(page);
  await page.click('[data-part="method-continue"]');
  await page.fill('#pub', realKey);
  await expect(page.locator('[data-part="key-check"]')).toContainText('Ed25519');
  await page.click('[data-part="key-continue"]');
  await page.fill('#phrase', 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-6789-0ABC-DEFG-HJKM-NPQR');
  await page.click('[data-part="pgp-verify"]');
  await page.click('[data-part="pgp-continue"]');
  await expect(page.locator('[data-screen="setup-backup"]')).toBeVisible();
  // Back, again and again: never out of sign-up past the owed step.
  for (let i = 0; i < 4; i++) {
    await page.goBack();
    await expect(page).toHaveURL(/\/setup\/backup/);
  }
  // A typed address outside sign-up (the front door, a trading page), even after a reload.
  for (const to of ['/', '/sell', '/setup/welcome']) {
    await page.goto(to);
    await expect(page).toHaveURL(/\/setup\/backup/);
    await expect(page.locator('[data-screen="setup-backup"]')).toBeVisible();
  }
  expect(s.calls).not.toContain('wallets');
});
