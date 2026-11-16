// Account recovery with the recovery code (batch 8, owner rulings of 9 Nov 2026): a backup login
// says the code just used is burned (S-111, p11-36) and that changes wait out the 24-hour hold; the
// password form takes the recovery code (optional) so the new password applies at once (S-110,
// p11-35), then says the code is burned. The API is stubbed per test with page.route in the shapes
// of @x2f/auth-client (the server's side is tested in apps/api/test/recovery*.test.ts).
// e2e/login.spec.ts keeps the backup login's own refusals and pacing.
//
// No board draws the burned notice or the password form's code field yet (holdCopy.ts:
// COPY-UNSIGNED, DESIGN): no parity; the phone layout (expectPhoneLayout) at PHONE_VIEWPORTS only.
import { expect, test, type Page, type Route } from '@playwright/test';
import { PHONE_VIEWPORTS, expectPhoneLayout, setPhone } from './phone.js';

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const HOLD = '2099-01-02T15:00:00.000Z';
const me = (over: Record<string, unknown> = {}) => ({
  displayName: 'nightowl', kind: 'trader', level: 'full', holdUntil: null, methods: ['passkey'], hasBackup: true, suggestions: [], termsCurrent: true, ...over,
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
  test(`a backup login at ${viewport}: phone layout, the code is burned, the hold is said, then Security`, async ({ page }) => {
    await page.route('**/v1/account/me', json(me({ level: 'recovery', holdUntil: HOLD })));
    await page.route('**/v1/account/methods', json([{ type: 'passkey', id: 'k1', label: 'Passkey', createdAt: null, lastUsedAt: null }]));
    await page.route('**/v1/account/sessions', json([]));
    await page.route('**/v1/account/alerts', json([]));
    let sent: unknown = null;
    await page.route('**/v1/login/backup', (r) => {
      sent = JSON.parse(r.request().postData() ?? '{}');
      return json({ status: 'ok', level: 'recovery', holdUntil: HOLD })(r);
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
    await expect(page.locator('[data-part="hold-note"]')).toContainText('Your account is on a 24-hour hold');
    const burned = page.locator('[data-part="code-burned"]');
    await expect(burned).toContainText(BURNED_TITLE);
    await expect(burned).toContainText(BURNED_BODY);
    expect(sent).toMatchObject({ loginName: 'nightowl', kind: 'recovery-code', code: 'ABCD-EFGH-JKMN-PQRT' });
    await expectPhoneLayout(page);
    await expectAtLeast44(page, '[data-part="hold-continue"]');
    await page.locator('[data-part="hold-continue"]').click();
    // A recovery session lands on Security, where a new recovery code can be made.
    await expect(page).toHaveURL(/\/settings\/security$/);
  });
}

/** Security signed in with a passkey only, and the password PUT answered by `answer`. */
async function security(page: Page, answer: (body: Record<string, unknown>) => (r: Route) => Promise<void>): Promise<Record<string, unknown>[]> {
  const puts: Record<string, unknown>[] = [];
  await page.route('**/v1/account/me', json(me()));
  await page.route('**/v1/account/methods', json([{ type: 'passkey', id: 'k1', label: 'Passkey', createdAt: null, lastUsedAt: null }]));
  await page.route('**/v1/account/sessions', json([]));
  await page.route('**/v1/account/alerts', json([]));
  await page.route('**/v1/account/password', (r) => {
    const body = JSON.parse(r.request().postData() ?? '{}') as Record<string, unknown>;
    puts.push(body);
    return answer(body)(r);
  });
  return puts;
}

for (const viewport of PHONE_VIEWPORTS) {
  test(`a new password with the recovery code at ${viewport}: phone layout, applied at once, the code is burned`, async ({ page }) => {
    const puts = await security(page, () => (r) => r.fulfill({ status: 204 }));
    await setPhone(page, viewport);
    await page.goto('/settings/security');
    await page.locator('[data-add="password"]').click();
    const form = page.locator('[data-part="add-password"]');
    await form.getByLabel('New password').fill('Correct-Horse-9!');
    await form.getByLabel('Recovery code (optional)').fill('  ABCD-EFGH-JKMN-PQRT ');
    await expect(form).toContainText('Add your recovery code and the new password takes effect at once, with no 24-hour wait. The code is then used up.');
    await expectPhoneLayout(page);
    await expectAtLeast44(page, '#new-password, #password-recovery-code');
    await form.getByRole('button', { name: 'Save' }).click();

    const burned = form.locator('[data-part="code-burned"]');
    await expect(burned).toContainText(BURNED_TITLE);
    await expect(burned).toContainText(BURNED_BODY);
    expect(puts).toEqual([{ password: 'Correct-Horse-9!', recoveryCode: 'ABCD-EFGH-JKMN-PQRT' }]);
    await expectPhoneLayout(page);
    await expectAtLeast44(page, '[data-part="code-burned-done"]');
    await page.locator('[data-part="code-burned-done"]').click();
    await expect(page.locator('[data-part="add-password"]')).toHaveCount(0);
  });
}

test('a recovery code that does not match says so and keeps the form; without a code nothing is burned', async ({ page }) => {
  const puts = await security(page, (b) => (b.recoveryCode !== undefined ? json({ error: 'credentials-invalid' }, 401) : (r) => r.fulfill({ status: 204 })));
  await page.goto('/settings/security');
  await page.locator('[data-add="password"]').click();
  const form = page.locator('[data-part="add-password"]');
  await form.getByLabel('New password').fill('Correct-Horse-9!');
  await form.getByLabel('Recovery code (optional)').fill('WRONG-CODE-0000');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.locator('[role="alert"]')).toHaveText("That recovery code doesn't match.");
  await expect(form.getByLabel('New password')).toBeVisible();
  await expect(form.locator('[data-part="code-burned"]')).toHaveCount(0);

  // Leaving the code out sends none, and no burned notice follows.
  await form.getByLabel('Recovery code (optional)').fill('');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('[data-part="add-password"]')).toHaveCount(0);
  await expect(page.locator('[data-part="code-burned"]')).toHaveCount(0);
  expect(puts).toEqual([{ password: 'Correct-Horse-9!', recoveryCode: 'WRONG-CODE-0000' }, { password: 'Correct-Horse-9!' }]);
});
