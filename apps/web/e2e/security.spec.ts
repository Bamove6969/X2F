// Settings → Security (Task 30): the login methods with the last-method guard, the new
// payout-wallet wait explanation (no opt-in toggle), the logout-timer dropdown, remote device
// log-out, and the one confirm sheet for an action-bound confirm (here: making recovery codes).
import { expect, test, type Page, type Route } from '@playwright/test';

type Overview = Record<string, unknown>;
function overview(over: Overview = {}): Overview {
  return {
    username: 'nightowl',
    kind: 'trader',
    level: 'full',
    holdUntil: null,
    methods: ['password'],
    hasBackup: false,
    suggestions: [],
    payoutWait: { enabled: false, offAt: null },
    termsCurrent: true,
    ...over,
  };
}

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** Default stubs so the screen mounts signed-in; a test re-routes the paths it exercises. */
async function base(page: Page, o: { methods?: unknown[]; sessions?: unknown[]; alerts?: unknown[]; me?: Overview } = {}): Promise<void> {
  await page.route('**/v1/account/me', json(overview(o.me)));
  await page.route('**/v1/account/methods', json(o.methods ?? [{ type: 'password', id: 'password', label: 'Password', createdAt: null, lastUsedAt: null }]));
  await page.route('**/v1/account/sessions', json(o.sessions ?? []));
  await page.route('**/v1/account/alerts', json(o.alerts ?? []));
}

test('the security screen shows methods, the payout-wait explanation (no 24-hour toggle), devices, alerts and the logout timer', async ({ page }) => {
  await base(page, { methods: [{ type: 'passkey', id: 'k1', label: 'Passkey', createdAt: null, lastUsedAt: null }] });
  await page.goto('/settings/security');

  await expect(page.locator('[data-part="method-list"] [data-method="passkey"]')).toBeVisible();
  await expect(page.locator('[data-part="payout-wait"]')).toContainText('waits 24 hours');
  // The dropped opt-in toggle must not be here.
  await expect(page.getByText('Make new payout addresses wait 24 hours')).toHaveCount(0);
  await expect(page.locator('[data-part="devices"]')).toBeVisible();
  await expect(page.locator('[data-part="alerts"]')).toBeVisible();
  await expect(page.locator('[data-part="logout-timer-select"]')).toHaveValue('12');
});

test('the logout timer offers 2–12 hours and saves a change', async ({ page }) => {
  await base(page);
  let saved: unknown = null;
  await page.route('**/v1/account/security/logout-timer', async (r) => {
    saved = JSON.parse(r.request().postData() ?? '{}');
    await r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto('/settings/security');

  await expect(page.locator('[data-part="logout-timer-select"] option')).toHaveCount(6);
  await page.selectOption('[data-part="logout-timer-select"]', '6');
  await expect(page.locator('[data-part="logout-timer-status"]')).toHaveText('Saved.');
  expect(saved).toEqual({ hours: 6 });
});

test('making recovery codes opens the confirm sheet exactly once, then shows the codes', async ({ page }) => {
  await base(page);
  await page.route('**/v1/confirm/password', json({ confirmToken: 't1' }));
  await page.route('**/v1/account/recovery-codes', async (r) => {
    const body = JSON.parse(r.request().postData() ?? '{}') as { confirmToken?: string };
    if (body.confirmToken === undefined) {
      return r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'confirm-required', action: 'new-recovery-codes' }) });
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ codes: Array.from({ length: 10 }, (_, i) => `code-${i}`) }) });
  });

  await page.goto('/settings/security');
  await page.click('[data-add="recovery-codes"]');
  await page.click('[data-part="recovery-make"]');

  await expect(page.locator('[role="dialog"]')).toHaveCount(1);
  await page.fill('#confirm-password', 'Correct-Horse-9!');
  await page.click('[data-method="password"] >> text=Confirm');

  await expect(page.locator('[data-part="code-list"] li')).toHaveCount(10);
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
});

test('removing the last method is refused with Plan 2’s message', async ({ page }) => {
  await base(page, { methods: [{ type: 'passkey', id: 'k1', label: 'Passkey', createdAt: null, lastUsedAt: null }] });
  await page.route('**/v1/account/methods/passkey/k1', json({ error: 'last-login-method' }, 409));

  await page.goto('/settings/security');
  await page.click('[data-method="passkey"] [data-part="remove"]');
  await expect(page.locator('[data-part="methods-error"]')).toContainText('only way to log in');
});

test('ending another device’s session logs it out', async ({ page }) => {
  let ended = false;
  await page.route('**/v1/account/me', json(overview()));
  await page.route('**/v1/account/methods', json([{ type: 'password', id: 'password', label: 'Password', createdAt: null, lastUsedAt: null }]));
  await page.route('**/v1/account/alerts', json([]));
  await page.route('**/v1/account/sessions', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        ended
          ? [{ id: 's1', deviceLabel: 'Browser on Linux', level: 'full', createdAt: '2026-10-20T00:00:00.000Z', lastSeenAt: '2026-10-23T00:00:00.000Z', current: true }]
          : [
              { id: 's1', deviceLabel: 'Browser on Linux', level: 'full', createdAt: '2026-10-20T00:00:00.000Z', lastSeenAt: '2026-10-23T00:00:00.000Z', current: true },
              { id: 's2', deviceLabel: 'Browser on Android', level: 'full', createdAt: '2026-10-21T00:00:00.000Z', lastSeenAt: '2026-10-22T00:00:00.000Z', current: false },
            ],
      ),
    }),
  );
  await page.route('**/v1/account/sessions/s2', async (r) => {
    ended = true;
    await r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/settings/security');
  await expect(page.locator('[data-part="device-list"] li')).toHaveCount(2);
  await page.click('[data-part="end-session"]');
  await expect(page.locator('[data-part="device-list"] li')).toHaveCount(1);
  await expect(page.getByText('Browser on Android')).toHaveCount(0);
});
