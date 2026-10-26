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
    termsCurrent: true,
    ...over,
  };
}

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** Default stubs so the screen mounts signed-in; a test re-routes the paths it exercises. */
async function base(page: Page, o: { methods?: unknown[]; sessions?: unknown[]; alerts?: unknown[]; me?: Overview; timer?: unknown } = {}): Promise<void> {
  await page.route('**/v1/account/me', json(overview(o.me)));
  await page.route('**/v1/account/methods', json(o.methods ?? [{ type: 'password', id: 'password', label: 'Password', createdAt: null, lastUsedAt: null }]));
  await page.route('**/v1/account/sessions', json(o.sessions ?? []));
  await page.route('**/v1/account/alerts', json(o.alerts ?? []));
  await page.route('**/v1/account/security/logout-timer', json(o.timer ?? { idleHours: 12, adjustable: true }));
}

/** Visible elements carrying data-primary (Task 15: exactly one per state). */
async function visiblePrimaries(page: Page): Promise<number> {
  return page.locator('[data-primary]').evaluateAll((els) => els.filter((e) => (e as HTMLElement).checkVisibility()).length);
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

test('the logout timer shows the saved value, offers 2–12 hours and saves a change as idleHours', async ({ page }) => {
  await base(page, { timer: { idleHours: 4, adjustable: true } });
  let saved: unknown = null;
  await page.route('**/v1/account/security/logout-timer', async (r) => {
    if (r.request().method() !== 'PUT') return r.fallback();
    saved = JSON.parse(r.request().postData() ?? '{}');
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ idleHours: 6, adjustable: true }) });
  });
  await page.goto('/settings/security');

  await expect(page.locator('[data-part="logout-timer-select"]')).toHaveValue('4');
  await expect(page.locator('[data-part="logout-timer-select"] option')).toHaveCount(6);
  await page.selectOption('[data-part="logout-timer-select"]', '6');
  await expect(page.locator('[data-part="logout-timer-status"]')).toHaveText('Saved.');
  expect(saved).toEqual({ idleHours: 6 });
});

test('staff and owner see their fixed logout timer without a dropdown', async ({ page }) => {
  await base(page, { timer: { idleHours: 2, adjustable: false } });
  await page.goto('/settings/security');
  await expect(page.locator('[data-part="logout-timer"]')).toContainText('2 hours');
  await expect(page.locator('[data-part="logout-timer-select"]')).toHaveCount(0);
});

test('a wrong password in the confirm sheet keeps the sheet and the action; the right one then completes it', async ({ page }) => {
  await base(page);
  let tries = 0;
  await page.route('**/v1/confirm/password', (r) => {
    tries += 1;
    return tries === 1
      ? r.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'credentials-invalid' }) })
      : r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ confirmToken: 't1' }) });
  });
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
  await page.fill('#confirm-password', 'wrong-password-1!');
  await page.click('[data-method="password"] >> text=Confirm');

  await expect(page.locator('[role="dialog"] [role="alert"]')).toBeVisible();
  await expect(page.locator('[role="dialog"]')).toHaveCount(1);
  await expect(page).toHaveURL(/\/settings\/security$/);

  await page.fill('#confirm-password', 'Correct-Horse-9!');
  await page.click('[data-method="password"] >> text=Confirm');
  await expect(page.locator('[data-part="code-list"] li')).toHaveCount(10);
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
});

test('a wrong authenticator code keeps the secret on screen and says so', async ({ page }) => {
  await base(page);
  await page.route('**/v1/account/totp/start', json({ challengeId: 'tc1', otpauthUri: 'otpauth://totp/X2F:nightowl?secret=JBSWY3DPEHPK3PXP&issuer=X2F', secret: 'JBSWY3DPEHPK3PXP' }));
  await page.route('**/v1/account/totp/finish', json({ error: 'code-invalid' }, 401));

  await page.goto('/settings/security');
  await page.click('[data-add="totp"]');
  await page.click('[data-part="totp-start"]');
  await expect(page.locator('[data-part="totp-secret"]')).toHaveText('JBSWY3DPEHPK3PXP');
  await page.fill('#totp-code', '000000');
  await page.click('[data-part="totp-finish"]');

  await expect(page.locator('[data-part="totp"] [role="alert"]')).toContainText('did not work');
  await expect(page.locator('[data-part="totp-secret"]')).toHaveText('JBSWY3DPEHPK3PXP');
  await expect(page).toHaveURL(/\/settings\/security$/);
});

test('with the confirm sheet open over Set a password, exactly one primary button is visible', async ({ page }) => {
  await base(page, { me: { methods: ['password', 'pgp'] } });
  await page.route('**/v1/account/password', json({ error: 'confirm-required', action: 'set-password' }, 403));
  await page.route('**/v1/confirm/pgp/start', json({ challengeId: 'pc1', encryptedMessage: '-----BEGIN PGP MESSAGE-----\nx\n-----END PGP MESSAGE-----', expiresAt: '2099-01-01T00:00:00.000Z' }));

  await page.goto('/settings/security');
  await page.click('[data-add="password"]');
  await page.fill('#new-password', 'Correct-Horse-9!');
  expect(await visiblePrimaries(page)).toBe(1);
  await page.click('[data-part="add-password"] >> text=Save');
  await expect(page.locator('[role="dialog"]')).toHaveCount(1);
  expect(await visiblePrimaries(page)).toBe(1);
  // A PGP challenge and the password form both inside the sheet: still one primary.
  await page.click('[role="dialog"] [data-method="pgp"]');
  await expect(page.locator('[data-part="pgp-message"]')).toBeVisible();
  expect(await visiblePrimaries(page)).toBe(1);
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

// Task 30 re-review (items 1, 2, 7).

test('with an authenticator app, the confirm sheet needs the code before Confirm and always sends it', async ({ page }) => {
  await base(page, { me: { methods: ['password', 'totp'] } });
  let body: Record<string, unknown> | null = null;
  await page.route('**/v1/confirm/password', (r) => {
    body = JSON.parse(r.request().postData() ?? '{}') as Record<string, unknown>;
    return json({ confirmToken: 't1' })(r);
  });
  await page.route('**/v1/account/recovery-codes', async (r) => {
    const b = JSON.parse(r.request().postData() ?? '{}') as { confirmToken?: string };
    return b.confirmToken === undefined
      ? json({ error: 'confirm-required', action: 'new-recovery-codes' }, 403)(r)
      : json({ codes: ['code-1'] })(r);
  });
  await page.goto('/settings/security');
  await page.click('[data-add="recovery-codes"]');
  await page.click('[data-part="recovery-make"]');
  await page.fill('#confirm-password', 'Correct-Horse-9!');
  const confirm = page.locator('[data-method="password"] >> text=Confirm');
  await expect(confirm).toBeDisabled();
  await page.fill('#confirm-totp', '123456');
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.locator('[data-part="code-list"] li')).toHaveCount(1);
  expect(body).toMatchObject({ password: 'Correct-Horse-9!', totp: '123456' });
});

test('a held backup session shows a banner, and a held change says until when', async ({ page }) => {
  await base(page, { me: { level: 'recovery', holdUntil: '2099-01-02T15:00:00.000Z' } });
  await page.route('**/v1/account/recovery-codes', json({ error: 'recovery-hold', holdUntil: '2099-01-02T15:00:00.000Z' }, 403));
  await page.goto('/settings/security');
  await expect(page.locator('[data-part="hold-banner"]')).toContainText('You logged in with a backup, so changes to your account wait until');
  await page.click('[data-add="recovery-codes"]');
  await page.click('[data-part="recovery-make"]');
  await expect(page.locator('[data-part="recovery-codes"] [role="alert"], [data-part="recovery-error"]').first()).toContainText('changes to your account wait until');
});

test('removing the only login method is refused at once, without a confirm or a request', async ({ page }) => {
  await base(page, {
    methods: [
      { type: 'passkey', id: 'k1', label: 'Passkey', createdAt: null, lastUsedAt: null },
      { type: 'totp', id: 'totp', label: 'Authenticator app', createdAt: null, lastUsedAt: null },
    ],
  });
  let deletes = 0;
  await page.route('**/v1/account/methods/passkey/k1', (r) => {
    deletes += 1;
    return json({ error: 'last-login-method' }, 409)(r);
  });
  await page.goto('/settings/security');
  await page.click('[data-method="passkey"] [data-part="remove"]');
  await expect(page.locator('[data-part="methods-error"]')).toContainText('only way to log in');
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  expect(deletes).toBe(0);
});
