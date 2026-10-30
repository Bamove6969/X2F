// Plan 7 Task 4: Settings → Privacy, the one retention rule in plain statements. No board yet
// (test/privacy-tripwire.test.ts NEEDS_DESIGN_PRIVACY), so there is no expectParity here: the
// phone layout rule still applies. The page works logged out (the rule is the same for everyone).
import { BACKUP_KEEP_DAYS, DISPUTE_KEEP_DAYS, TRADE_KEEP_DAYS } from '@x2f/trade';
import { expect, test, type Route } from '@playwright/test';
import { PHONE_VIEWPORTS, expectPhoneLayout, setPhone } from './phone.js';

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

test('logged out: the rule with the shared numbers, no choices and nothing sent', async ({ page }) => {
  const writes: string[] = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET') writes.push(`${r.method()} ${r.url()}`);
  });
  await page.route('**/v1/account/me', json({ error: 'not-authenticated' }, 401));
  await page.goto('/settings/privacy');
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy' })).toBeVisible();
  const main = page.locator('main[data-screen="privacy"]');
  await expect(main).toContainText(`self-destructs ${TRADE_KEEP_DAYS} days after it ends`);
  await expect(main).toContainText(`kept ${DISPUTE_KEEP_DAYS} days from that moment`);
  await expect(main).toContainText(`within ${BACKUP_KEEP_DAYS} days`);
  await expect(main).not.toContainText(/month/i);
  await expect(main.locator('input, select, button, textarea')).toHaveCount(0);
  expect(writes).toEqual([]);
});

for (const viewport of PHONE_VIEWPORTS) {
  test(`phone layout at ${viewport}`, async ({ page }) => {
    await page.route('**/v1/account/me', json({ error: 'not-authenticated' }, 401));
    await page.goto('/settings/privacy');
    await setPhone(page, viewport);
    await expect(page.locator('[data-part="privacy-backups"]')).toBeVisible();
    await expectPhoneLayout(page);
  });
}
