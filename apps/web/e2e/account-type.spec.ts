// Settings > Account type (owner, 2 Nov 2026; owner answer Q77, 6 Nov 2026): a trader switches to a
// vendor account with a passkey, security key or PGP key (never an authenticator app), the switch is one
// way, and an unused vendor account closes after 60 days. Phone layout on every state.
import { expect, test, type Page, type Route } from '@playwright/test';
import { ACCOUNT_TYPE_COPY as C } from '../src/screens/settings/accountTypeCopy.js';
import { PHONE_VIEWPORTS, expectPhoneLayout, setPhone } from './phone.js';

type Overview = Record<string, unknown>;
function overview(over: Overview = {}): Overview {
  return {
    tradeTag: 'nightowl',
    kind: 'trader',
    level: 'full',
    methods: ['totp'],
    hasBackup: false,
    suggestions: [],
    termsCurrent: true,
    accountType: 'trader',
    ...over,
  };
}

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** Visible elements carrying data-primary (Task 15: exactly one per state). */
async function visiblePrimaries(page: Page): Promise<number> {
  return page.locator('[data-primary]').evaluateAll((els) => els.filter((e) => (e as HTMLElement).checkVisibility()).length);
}

test('a trader with no key: the requirement is not met, Add a key links to Security, and Switch says why it cannot', async ({ page }) => {
  await page.route('**/v1/account/me', json(overview()));
  await page.goto('/settings/account-type');
  await expect(page.locator('[data-part="type-name"]')).toHaveText(C.typeName.trader);
  await expect(page.locator('[data-part="key-req"]')).toHaveAttribute('data-met', 'false');
  await expect(page.locator('[data-part="add-key"]')).toHaveAttribute('href', '/settings/security');
  await page.click('[data-part="switch"]');
  await expect(page.locator('[role="dialog"]')).toHaveCount(1);
  await expect(page.locator('[data-part="switch-sheet"]')).toHaveCount(0);
});

test('a trader with a PGP key switches: the sheet says it is one way, the confirm offers no authenticator code, and the switch is sent with the token', async ({ page }) => {
  let me = overview({ methods: ['totp', 'pgp'] });
  await page.route('**/v1/account/me', (r) => json(me)(r));
  await page.route('**/v1/confirm/pgp/start', json({ challengeId: 'pc1', encryptedMessage: '-----BEGIN PGP MESSAGE-----\nx\n-----END PGP MESSAGE-----', expiresAt: '2099-01-01T00:00:00.000Z' }));
  await page.route('**/v1/confirm/pgp/finish', json({ confirmToken: 'tok-v' }));
  const sent: unknown[] = [];
  await page.route('**/v1/account/type', async (r) => {
    const body = JSON.parse(r.request().postData() ?? '{}') as { confirmToken?: string };
    sent.push(body);
    if (body.confirmToken === undefined) return json({ error: 'confirm-required', action: 'become-vendor' }, 403)(r);
    me = overview({ methods: ['totp', 'pgp'], accountType: 'vendor' });
    return json({ accountType: 'vendor' })(r);
  });

  await page.goto('/settings/account-type');
  await expect(page.locator('[data-part="key-req"]')).toHaveAttribute('data-met', 'true');
  await page.click('[data-part="switch"]');
  const sheet = page.locator('[data-part="switch-sheet"]');
  await expect(sheet).toContainText('You pay the 1% fee on completed trades.');
  await expect(sheet).toContainText(C.noSwitchBack);
  await expect(sheet).toContainText(C.inactiveCloses);
  await page.click('[data-part="switch-confirm"]');

  await expect(page.locator('[role="dialog"] [data-method="pgp"]')).toBeVisible();
  await expect(page.locator('[role="dialog"] [data-method="totp"]')).toHaveCount(0);
  await page.click('[role="dialog"] [data-method="pgp"]');
  await page.fill('[data-method="pgp-code"] input', 'code-123');
  await page.click('[data-method="pgp-code"] >> text=Confirm');

  await expect(page.locator('[data-part="said"]')).toHaveText(C.switched);
  await expect(page.locator('[data-part="type-name"]')).toHaveText(C.typeName.vendor);
  await expect(page.locator('[data-part="no-switch-back"]')).toHaveText(C.noSwitchBack);
  await expect(page.locator('[data-part="inactive-closes"]')).toHaveText(C.inactiveCloses);
  await expect(page.getByText('comes later')).toHaveCount(0);
  expect(sent).toEqual([{ type: 'vendor' }, { type: 'vendor', confirmToken: 'tok-v' }]);
});

for (const vp of PHONE_VIEWPORTS) {
  test(`phone ${vp}: trader, the switch sheet and vendor fit, with one primary each`, async ({ page }) => {
    let me = overview({ methods: ['passkey'] });
    await page.route('**/v1/account/me', (r) => json(me)(r));
    await page.goto('/settings/account-type');
    await setPhone(page, vp);
    await expect(page.locator('[data-part="become"]')).toBeVisible();
    await expectPhoneLayout(page);
    expect(await visiblePrimaries(page)).toBeLessThanOrEqual(1);

    await page.click('[data-part="switch"]');
    await expect(page.locator('[data-part="switch-sheet"]')).toBeVisible();
    await expectPhoneLayout(page);

    me = overview({ methods: ['passkey'], accountType: 'vendor' });
    await page.reload();
    await expect(page.locator('[data-part="vendor"]')).toBeVisible();
    await expectPhoneLayout(page);
    expect(await visiblePrimaries(page)).toBe(1);
  });
}
