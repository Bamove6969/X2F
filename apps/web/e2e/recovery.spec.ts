// Account recovery with the recovery code (batch 8, owner rulings of 9 Nov 2026): a backup login
// says the code just used is burned (S-111, p11-36). Owner, 26 Nov 2026: no passwords and no
// 24-hour hold; the recovery-code login is a full session that may change every login method for
// an hour. The API is stubbed per test with page.route in the shapes of @x2f/auth-client (the
// server's side is tested in apps/api/test/recovery*.test.ts). e2e/login.spec.ts keeps the backup
// login's own refusals and pacing.
//
// No board draws the burned notice yet (recoveryCopy.ts: COPY-UNSIGNED, DESIGN): no parity; the
// phone layout (expectPhoneLayout) at PHONE_VIEWPORTS only.
import { expect, test, type Page, type Route } from '@playwright/test';
import { PHONE_VIEWPORTS, expectPhoneLayout, setPhone } from './phone.js';

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const WINDOW_END = '2099-01-02T15:00:00.000Z';
const me = (over: Record<string, unknown> = {}) => ({
  tradeTag: 'nightowl', kind: 'trader', level: 'full', recoveryUntil: null, methods: ['passkey', 'pgp'], hasBackup: true, suggestions: [], termsCurrent: true, ...over,
});
const BURNED_TITLE = 'Your recovery code is now burned';
const BURNED_BODY = 'The recovery code you just used will never work again. Go to Security settings for a new recovery code.';

async function expectAtLeast44(page: Page, selector: string): Promise<void> {
  const boxes = await page.locator(selector).evaluateAll((els) =>
    els.filter((e) => (e as HTMLElement).checkVisibility()).map((e) => ({ s: e.outerHTML.slice(0, 80), ...e.getBoundingClientRect().toJSON() as { width: number; height: number } })),
  );
  expect(boxes.length, selector).toBeGreaterThan(0);
  for (const b of boxes) expect(Math.min(b.width, b.height), b.s).toBeGreaterThanOrEqual(44);
}

for (const viewport of PHONE_VIEWPORTS) {
  test(`a backup login at ${viewport}: phone layout, the code is burned, the hour to change methods is said, then on`, async ({ page }) => {
    await page.route('**/v1/account/me', json(me({ recoveryUntil: WINDOW_END })));
    await page.route('**/v1/account/methods', json([{ type: 'passkey', id: 'k1', label: 'Passkey', createdAt: null, lastUsedAt: null }]));
    await page.route('**/v1/account/sessions', json([]));
    await page.route('**/v1/account/alerts', json([]));
    let sent: unknown = null;
    await page.route('**/v1/login/backup', (r) => {
      sent = JSON.parse(r.request().postData() ?? '{}');
      return json({ status: 'ok' })(r);
    });
    await setPhone(page, viewport);
    await page.goto('/login/backup?returnTo=%2Fbuy');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Use a backup');
    await page.getByLabel('Your login name').fill(' nightowl ');
    await page.getByLabel('A recovery code').fill('ABCD-EFGH-JKMN-PQRT');
    await expectPhoneLayout(page);
    await expectAtLeast44(page, '#backup-login-name, #backup-code, [data-part="backup-login"]');
    await page.locator('[data-part="backup-login"]').click();

    await expect(page.getByRole('heading', { level: 1 })).toHaveText("You're in");
    await expect(page.locator('[data-part="recovery-window-note"]')).toBeVisible();
    const burned = page.locator('[data-part="code-burned"]');
    await expect(burned).toContainText(BURNED_TITLE);
    await expect(burned).toContainText(BURNED_BODY);
    expect(sent).toMatchObject({ loginName: 'nightowl', kind: 'recovery-code', code: 'ABCD-EFGH-JKMN-PQRT' });
    await expectPhoneLayout(page);
    await expectAtLeast44(page, '[data-part="recovery-continue"]');
    await page.locator('[data-part="recovery-continue"]').click();
    await expect(page).not.toHaveURL(/\/login\/backup/);
  });
}
