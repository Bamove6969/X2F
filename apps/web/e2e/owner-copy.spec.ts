// Owner demo notes of 12 Nov 2026 (his own words, typos fixed), at the size he looked at them:
// 443x794. /session-length's hints and /setup/welcome's lead line and checklist (one big green tick
// per item; the login methods best to worst under one tick). COPY-UNSIGNED, DESIGNER-REVIEW: design
// restyles both screens, so this checks the words, the ticks and the phone rules, not the look.
import { expect, test, type Page, type Route } from '@playwright/test';

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const ADDRESS = `4${'9'.repeat(90)}k3Fz`;

test.use({ viewport: { width: 443, height: 794 } });

async function stub(page: Page, o: { methods: string[]; session: boolean }) {
  const now = Date.now();
  await page.route('**/v1/account/me', json({
    displayName: 'nightowl', loginNameSet: true, kind: 'trader', level: 'full', holdUntil: null, methods: o.methods, hasBackup: true, suggestions: [], termsCurrent: true,
    ...(o.session ? { session: { lengthHours: null, choices: [2, 4, 8, 12], expiresAt: new Date(now + 2 * 3_600_000).toISOString(), canExtend: true, serverNow: new Date(now).toISOString() } } : {}),
  }));
  await page.route('**/v1/wallets', json([{ id: 'w', app: 'cake', label: 'Wallet 1', address: ADDRESS, addressEnd: 'k3Fz', usableFrom: '2026-10-25T00:00:00.000Z', usable: true }]));
  await page.route('**/v1/terms', json({ version: '2026-11-09' }));
}

async function phoneRules(page: Page) {
  const s = await page.evaluate(() => ({ wide: document.documentElement.scrollWidth, view: document.documentElement.clientWidth }));
  expect(s.wide).toBeLessThanOrEqual(s.view);
}

test('/session-length: "Nudges", why a logout happens, and Settings under Devices and Sessions', async ({ page }) => {
  await stub(page, { methods: ['pgp'], session: true });
  await page.goto('/session-length?returnTo=%2Fsell');
  await expect(page.locator('[data-screen="session-length"] h1')).toBeVisible();
  await expect(page.getByText("Longer sessions so you don't miss a trade while you sleep. Turn on alert sounds (\"Nudges\") so a new trade wakes you.")).toBeVisible();
  await expect(page.getByText("When this time is up, we'll ask you to confirm it's you to stay logged in. If you are unable to confirm your identity at that time, your account will be logged out for your security.")).toBeVisible();
  await expect(page.locator('[data-screen="session-length"] p', { hasText: 'You can change this any time' })).toHaveText('You can change this any time in Settings under Devices and Sessions.');
  await expect(page.getByRole('link', { name: 'Devices and Sessions' })).toHaveAttribute('href', '/settings/devices');
  await phoneRules(page);
});

test('/setup/welcome: the lead line, three ticked items with the methods best to worst, then the next step and the fee note', async ({ page }) => {
  await stub(page, { methods: ['password', 'totp', 'security-key', 'recovery-codes'], session: false });
  await page.goto('/setup/welcome?returnTo=%2Fsell');
  const screen = page.locator('[data-screen="setup-welcome"]');
  // Owner demo note #166 (23 Nov): two paragraphs.
  await expect(screen.locator('.x2f-start__lead')).toHaveText([
    'Your account is ready. Buy and sell Monero using cash, bank transfers, gift cards, or any payment method you prefer, with every trade protected by 2-of-3 escrow.',
    'Don’t see your preferred payment method? Send us feedback with as many details as you can (or a link with more info) so we can get it added quickly.',
  ]);
  // Owner #168: every login method, set up or not, a big check or cross each, then the level reached.
  await expect(screen.locator('#welcome-logins-title')).toHaveText('Secure X2F login methods');
  await expect(screen.locator('[data-part="method-row"] .x2f-welcome__row-name')).toHaveText(['PGP key', 'Security key', 'Passkey', 'Authenticator app', 'Password', 'Recovery code']);
  await expect(screen.locator('[data-part="method-state"]')).toHaveText(['Not set up', 'Set up', 'Not set up', 'Set up', 'Set up', 'Set up']);
  await expect(screen.locator('[data-part="mark-set"]')).toHaveCount(4);
  await expect(screen.locator('[data-part="mark-unset"]')).toHaveCount(2);
  expect((await screen.locator('[data-part="mark-set"]').first().boundingBox())!.width).toBeGreaterThanOrEqual(28);
  await expect(screen.locator('.x2f-welcome__rating-line')).toHaveText('You have achieved level: Highly secure');
  await expect(screen.locator('[data-part="check-wallet"] [data-part="check-title"]')).toHaveText('Payout wallet:');
  await expect(screen.locator('[data-part="summary-wallet"]')).toHaveText('Cake Wallet …k3Fz');
  await expect(screen.locator('[data-part="check-wallet"] [data-part="tick"]')).toHaveCount(1);
  // Bigger than the lead line's size: the line under the checklist.
  const next = screen.locator('[data-part="change-later"]');
  await expect(next).toHaveText('Any information provided above can be changed later in Settings.');
  const size = async (sel: string) => Number.parseFloat(await screen.locator(sel).evaluate((e) => getComputedStyle(e).fontSize));
  expect(await size('[data-part="change-later"]')).toBeGreaterThan(await size('[data-part="fee"]'));
  await expect(screen.locator('[data-part="fee"]')).toHaveText('Remember, you only pay a fee if you post an ad. Clicking on an ad and starting a trade is always free.');
  await phoneRules(page);
  await expect(page.locator('[data-primary]:visible')).toHaveCount(1);
});
