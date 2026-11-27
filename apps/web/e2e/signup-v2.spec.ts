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
import { TERMS_TEXT_VERSION } from '../src/screens/setup/termsText.js';

const VIEWPORTS = ['443x794', '390x844'] as const satisfies readonly ParityViewport[];
// Review of third-signup-r3 (16 Nov 2026), M5a: the mock serves the version the app's Terms text is.
const TERMS_VERSION = TERMS_TEXT_VERSION;
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
      ? json({ tradeTag: 'lumen.kai', loginNameSet: true, kind: 'trader', level: 'full', methods: s.methods, hasBackup: false, suggestions: [], termsCurrent: true })(r)
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
    return json({ tradeTag: 'lumen.kai' }, 201)(r);
  });
  await page.route('**/v1/account/totp/start', (r) => {
    record('totp-start', r);
    return json({ challengeId: 't1', otpauthUri: 'otpauth://totp/X2F:lumen.kai?secret=JBSWY3DPEHPK3PXP&issuer=X2F', secret: 'JBSWY3DPEHPK3PXP' })(r);
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
  await page.route('**/v1/wallets/rule', json({ firstWallet: true, strongMethods: ['pgp'] }));
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
  await page.check('[data-part="terms-tick"]');
  // A trader agrees with the tick alone (owner demo note #187, 25 Nov 2026).
  await page.click('[data-part="terms-accept"]');
}

async function pickNames(page: Page): Promise<void> {
  await expect(page.locator('[data-screen="setup-name"]')).toBeVisible();
  await page.fill('#uname', 'lumen-login-7');
  await expect(page.locator('[data-part="name-status"]')).toHaveText('lumen-login-7 is available');
  await page.click('[data-part="names-continue"]');
  await page.fill('#trade-tag', 'lumen.kai');
  await page.click('[data-part="display-continue"]');
}

/** The PGP key step and its code step, from /setup/pgp-key. */
async function pgpSteps(page: Page): Promise<void> {
  await page.fill('#pub', realKey);
  await expect(page.locator('[data-part="key-check"]')).toContainText('Ed25519');
  await page.click('[data-part="key-continue"]');
  await expect(page).toHaveURL(/\/setup\/pgp-code\?/);
  await page.fill('#phrase', 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-6789-0ABC-DEFG-HJKM-NPQR');
  await page.click('[data-part="pgp-verify"]');
  await page.click('[data-part="pgp-continue"]');
}

/** The authenticator-app step, from /setup/authenticator. */
async function totpStep(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/setup\/authenticator\?/);
  await page.click('[data-part="totp-start"]');
  await page.fill('#totp-code', '123456');
  await page.click('[data-part="totp-finish"]');
  await expect(page.locator('[data-part="totp-success"]')).toBeVisible();
  await page.click('[data-part="totp-continue"]');
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
  test(`${v}: PGP and authenticator app are set up one after another, then the recovery code, written down and typed back unseen`, async ({ page }) => {
    await setPhone(page, v);
    const s = await stubApi(page);
    const [, height] = v.split('x').map(Number) as [number, number];
    await page.goto('/setup?returnTo=%2Fpost');
    await acceptTerms(page);

    // /setup/name
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Create your private login ID');
    await expect(page.locator('[data-screen="setup-name"]')).not.toContainText('Nothing else to give');
    await expectPhoneLayout(page);
    await pickNames(page);

    // /setup/login: checkboxes with the owner's labels.
    await expect(page.locator('[data-screen="setup-login"]')).toBeVisible();
    await expect(page.locator('[role="radio"]')).toHaveCount(0);
    await expect(tick(page, 'pgp')).toBeChecked();
    for (const id of ['pgp', 'security-key']) {
      await expect(page.locator(`[data-method="${id}"] [data-part="recommended"]`)).toHaveText('Recommended');
      await expect(page.locator(`[data-method="${id}"] [data-part="strength"]`)).toHaveText('RATED-STRONG');
      // Lead call (12 Nov 2026): green, its own token (not the escrow teal).
      expect(await colour(page, `[data-method="${id}"] [data-part="strength"]`, 'color')).toBe(await token(page, '--x2f-good'));
      expect(await token(page, '--x2f-good')).not.toBe(await token(page, '--x2f-escrow'));
    }
    await expect(page.locator('[data-method="totp"] [data-part="strength"]')).toHaveText('RATED-MEDIUM');
    await expect(page.locator('[data-method="totp"]')).toContainText('6-digit code');
    // No passwords (owner, 26 Nov 2026); PGP and passkey are ticked by default.
    await expect(page.locator('[data-method="password"]')).toHaveCount(0);
    await expect(tick(page, 'passkey')).toBeChecked();
    await expect(tick(page, 'security-key')).not.toBeChecked();
    await expect(tick(page, 'totp')).not.toBeChecked();
    await page.click('[data-part="pgp-explain"]');
    await expect(page.locator('[data-part="pgp-explainer"]')).toContainText('PGPony (com.pgpony.android on F-Droid, our top Android pick) and OpenKeychain on Android');
    // An authenticator app counts as the second kind: PGP and the app, no passkey.
    await page.click('[data-method="passkey"]');
    await expect(tick(page, 'passkey')).not.toBeChecked();
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
    await expect(page.locator('[data-part="recovery-make"]')).toBeDisabled();
    await page.check('[data-part="recovery-understood"]');
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
    await page.fill('#xmr-payout', ADDRESS);
    await page.click('[data-part="wallet-finish"]');
    // Owner #161: the saved first wallet shows its green check, then Continue.
    await expect(page.locator('[data-part="address-verified"]')).toBeVisible();
    await page.click('[data-part="wallet-continue"]');
    await expect(page).toHaveURL(/\/setup\/welcome\?/);
    await expect.poll(() => s.calls.includes('onboarding-end')).toBe(true);

    // One sign-up (the PGP key), then the authenticator added to it, with no
    // confirm-it's-you in the sign-up window; one recovery code made, nothing sent to check it.
    expect(s.calls.filter((c) => !c.startsWith('confirm'))).toEqual(['pgp-start', 'pgp-finish', 'totp-start', 'totp-finish', 'recovery-codes', 'wallets', 'onboarding-end']);
    expect(s.calls.filter((c) => c.startsWith('confirm'))).toEqual([]);
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
  await page.click('[data-method="passkey"]');
  await page.click('[data-method="totp"]');
  await page.click('[data-part="method-continue"]');
  await pgpSteps(page);
  await totpStep(page);
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

// Owner demo notes 12 Nov 2026 (#27 a8b080ad, #30 4a8a6e47): ticking all four security options
// walks through every ticked method in SIGNUP_ORDER (pgp -> security-key -> passkey ->
// authenticator; no passwords since 26 Nov 2026), prevents skipping ahead to /setup/backup before all chosen options are handled,
// and opens the recovery code screen only after all selected options are complete.
test('ticking all four security options walks through every chosen method in order before the recovery code screen (#27, #30)', async ({ page }) => {
  await setPhone(page, VIEWPORTS[1]);
  const s = await stubApi(page);
  await page.goto('/setup?returnTo=%2Fpost');
  await acceptTerms(page);
  await pickNames(page);

  await expect(page.locator('[data-screen="setup-login"]')).toBeVisible();
  for (const id of ['security-key', 'totp']) {
    await page.click(`[data-method="${id}"]`);
    await expect(tick(page, id)).toBeChecked();
  }
  await page.click('[data-part="method-continue"]');

  // 1. PGP key & code
  await expect(page).toHaveURL(/\/setup\/pgp-key\?/);
  await page.fill('#pub', realKey);
  await expect(page.locator('[data-part="key-check"]')).toContainText('Ed25519');
  await page.click('[data-part="key-continue"]');
  await expect(page).toHaveURL(/\/setup\/pgp-code\?/);
  await page.fill('#phrase', 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-6789-0ABC-DEFG-HJKM-NPQR');
  await page.click('[data-part="pgp-verify"]');
  await page.click('[data-part="pgp-continue"]');

  // 2. Security key (and cannot skip ahead to /setup/backup or /sell before finishing remaining methods)
  await expect(page).toHaveURL(/\/setup\/security-key\?/);
  await expect(page.locator('[data-screen="setup-security-key"]')).toBeVisible();
  for (const skipTo of ['/setup/backup', '/setup/authenticator', '/sell']) {
    await page.goto(skipTo);
    await expect(page).toHaveURL(/\/setup\/security-key/);
    await expect(page.locator('[data-screen="setup-security-key"]')).toBeVisible();
  }
  await page.click('[data-part="method-later"]');

  // 3. Passkey
  await expect(page).toHaveURL(/\/setup\/passkey\?/);
  await expect(page.locator('[data-screen="setup-passkey"]')).toBeVisible();
  await page.click('[data-part="method-later"]');

  // 4. Authenticator app (OTP)
  await expect(page).toHaveURL(/\/setup\/authenticator\?/);
  await expect(page.locator('[data-screen="setup-authenticator"]')).toBeVisible();
  await page.click('[data-part="totp-start"]');
  await page.fill('#totp-code', '123456');
  await page.click('[data-part="totp-finish"]');
  await expect(page.locator('[data-part="totp-success"]')).toBeVisible();
  await page.click('[data-part="totp-continue"]');

  // 5. Recovery code screen comes only after all chosen methods are done
  await expect(page).toHaveURL(/\/setup\/backup\?/);
  await expect(page.locator('[data-screen="setup-backup"]')).toBeVisible();
  expect(s.calls.filter((c) => !c.startsWith('confirm'))).toEqual(['pgp-start', 'pgp-finish', 'totp-start', 'totp-finish']);
});
