// Settings → Security (Task 30): the login methods with the last-method guard, no payout-wallet wait
// (owner, 26 Nov 2026), no logout-timer card (retired for the session length, 2 Nov), remote device
// log-out, and the one confirm sheet for an action-bound confirm (here: making recovery codes).
import { expect, test, type Page, type Route } from '@playwright/test';
import { PHONE_VIEWPORTS, expectPhoneLayout, setPhone } from './phone.js';
import { screenStatus } from './session.js';

type Overview = Record<string, unknown>;
function overview(over: Overview = {}): Overview {
  return {
    tradeTag: 'nightowl',
    kind: 'trader',
    level: 'full',
    methods: ['pgp', 'passkey'],
    hasBackup: false,
    suggestions: [],
    termsCurrent: true,
    ...over,
  };
}

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const PGP_MESSAGE = '-----BEGIN PGP MESSAGE-----\nx\n-----END PGP MESSAGE-----';
const METHODS = [
  { type: 'pgp', id: 'pgp-1', label: 'PGP key', createdAt: null, lastUsedAt: null },
  { type: 'passkey', id: 'k1', label: 'Passkey', createdAt: null, lastUsedAt: null },
];

/** Stubs the confirm sheet's PGP check; `finish` answers the code (a token by default). */
async function stubPgpConfirm(page: Page, finish: (r: Route) => Promise<void> = json({ confirmToken: 't1' })): Promise<void> {
  await page.route('**/v1/confirm/pgp/start', json({ challengeId: 'pc1', encryptedMessage: PGP_MESSAGE, expiresAt: '2099-01-01T00:00:00.000Z' }));
  await page.route('**/v1/confirm/pgp/finish', finish);
}

/** Confirms in the open sheet with the PGP key: start the check, paste the code, Confirm. */
async function confirmWithPgp(page: Page, code = '12345678'): Promise<void> {
  const sheet = page.locator('[role="dialog"]');
  if ((await sheet.locator('[data-method="pgp-code"]').count()) === 0) await sheet.locator('[data-method="pgp"]').click();
  await sheet.locator('[aria-label="Login code"]').fill(code);
  await sheet.locator('[data-method="pgp-code"]').getByRole('button', { name: 'Confirm' }).click();
}

/** Default stubs so the screen mounts signed-in; a test re-routes the paths it exercises. */
async function base(page: Page, o: { methods?: unknown[]; sessions?: unknown[]; alerts?: unknown[]; me?: Overview; timer?: unknown } = {}): Promise<void> {
  await page.route('**/v1/account/me', json(overview(o.me)));
  await page.route('**/v1/account/methods', json(o.methods ?? METHODS));
  await page.route('**/v1/account/sessions', json(o.sessions ?? []));
  await page.route('**/v1/account/alerts', json(o.alerts ?? []));
}

/** Visible elements carrying data-primary (Task 15: exactly one per state). */
async function visiblePrimaries(page: Page): Promise<number> {
  return page.locator('[data-primary]').evaluateAll((els) => els.filter((e) => (e as HTMLElement).checkVisibility()).length);
}

test('the security screen shows methods, no payout wait (no 24-hour toggle), devices, the alerts on their own tab (no logout timer: session length, owner 2 Nov 2026)', async ({ page }) => {
  await base(page, { methods: [{ type: 'passkey', id: 'k1', label: 'Passkey', createdAt: null, lastUsedAt: null }] });
  await page.goto('/settings/security');

  await expect(page.locator('[data-part="method-list"] [data-method="passkey"]')).toBeVisible();
  await expect(page.locator('[data-part="payout-wait"]')).toHaveCount(0);
  // The dropped opt-in toggle must not be here.
  await expect(page.getByText('Make new payout addresses wait 24 hours')).toHaveCount(0);
  // C2-D1: Devices is its own screen; Security links to it.
  await expect(page.locator('[data-part="devices-link"] a[href="/settings/devices"]')).toHaveText('Devices and sessions');
  await expect(page.locator('[data-part="logout-timer"]')).toHaveCount(0);
  // Settings split into tabs (owner note #101): the alerts moved off Security to their own tab.
  await expect(page.locator('[data-part="alerts"]')).toHaveCount(0);
  await page.goto('/settings/alerts');
  await expect(page.locator('[data-part="alerts"]')).toBeVisible();
});

test('a wrong PGP code in the confirm sheet keeps the sheet and the action; the right one then completes it', async ({ page }) => {
  await base(page);
  let tries = 0;
  await stubPgpConfirm(page, (r) => {
    tries += 1;
    return tries === 1 ? json({ error: 'credentials-invalid' }, 401)(r) : json({ confirmToken: 't1' })(r);
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
  await confirmWithPgp(page, '00000000');

  await expect(page.locator('[role="dialog"] [role="alert"]')).toBeVisible();
  await expect(page.locator('[role="dialog"]')).toHaveCount(1);
  await expect(page).toHaveURL(/\/settings\/security$/);

  await confirmWithPgp(page);
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

test('with the confirm sheet open over making recovery codes, at most one primary button is visible, and exactly one with the PGP check open', async ({ page }) => {
  await base(page);
  await page.route('**/v1/account/recovery-codes', json({ error: 'confirm-required', action: 'new-recovery-codes' }, 403));
  await stubPgpConfirm(page);

  await page.goto('/settings/security');
  await page.click('[data-add="recovery-codes"]');
  expect(await visiblePrimaries(page)).toBe(1);
  await page.click('[data-part="recovery-make"]');
  await expect(page.locator('[role="dialog"]')).toHaveCount(1);
  // The screen's own primary steps down while the sheet is open; the method buttons are secondary.
  expect(await visiblePrimaries(page)).toBeLessThanOrEqual(1);
  // A PGP challenge inside the sheet: its Confirm is the one primary.
  await page.click('[role="dialog"] [data-method="pgp"]');
  await expect(page.locator('[data-part="pgp-message"]')).toBeVisible();
  expect(await visiblePrimaries(page)).toBe(1);
});

test('making recovery codes opens the confirm sheet exactly once, then shows the codes', async ({ page }) => {
  await base(page);
  await stubPgpConfirm(page);
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
  await confirmWithPgp(page);

  await expect(page.locator('[data-part="code-list"] li')).toHaveCount(10);
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
});

test('removing the last method is refused with Plan 2’s message', async ({ page }) => {
  await base(page, { methods: [{ type: 'passkey', id: 'k1', label: 'Passkey', createdAt: null, lastUsedAt: null }] });
  await page.route('**/v1/account/methods/passkey/k1', json({ error: 'last-login-method' }, 409));

  await page.goto('/settings/security');
  await page.click('[data-method="passkey"] [data-part="remove"]');
  // Plan 5 Task 21: a refusal opens CantDoThat, with the feedback link for this code.
  const popup = page.locator('[role="dialog"] [data-part="cant-do-that"]');
  await expect(popup).toContainText('only way to log in');
  await expect(popup.getByRole('link', { name: 'feedback' })).toHaveAttribute('href', '/feedback?from=last-login-method');
});

test('ending another device’s session logs it out', async ({ page }) => {
  let ended = false;
  await page.route('**/v1/account/me', json(overview()));
  await page.route('**/v1/account/methods', json(METHODS));
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

  await page.goto('/settings/devices');
  await expect(page.locator('[data-part="device-list"] li')).toHaveCount(2);
  await page.getByRole('button', { name: 'Log out Browser on Android' }).click();
  // C2-D1 (Devices board): it asks first.
  const ask = page.getByRole('dialog', { name: 'Log out Browser on Android?' });
  await expect(ask).toBeVisible();
  expect(ended).toBe(false);
  await ask.locator('[data-part="end-confirm"]').click();
  await expect(page.locator('[data-part="device-list"] li')).toHaveCount(1);
  await expect(page.locator('[data-part="device-list"]')).not.toContainText('Browser on Android');
  await expect(screenStatus(page)).toHaveText('Browser on Android was logged out.');
});

// C2-D1 review I1 (owner, via the Devices board): "Log out all team members" asks first, then ends
// every team member's session and none of yours; "Log out all other devices" covers only yours.
test('"Log out all team members" asks first, then ends only the team members\' sessions', async ({ page }) => {
  const ended: string[] = [];
  const all = [
    { id: 's1', deviceLabel: 'Browser on Linux', level: 'full', createdAt: '2026-10-20T00:00:00.000Z', lastSeenAt: new Date().toISOString(), current: true, member: null },
    { id: 's2', deviceLabel: 'Chrome on Android', level: 'full', createdAt: '2026-10-21T00:00:00.000Z', lastSeenAt: new Date().toISOString(), current: false, member: null },
    { id: 's3', deviceLabel: 'Safari on macOS', level: 'full', createdAt: '2026-10-21T00:00:00.000Z', lastSeenAt: new Date().toISOString(), current: false, member: 'desk_ana' },
    { id: 's4', deviceLabel: 'Edge on Windows', level: 'full', createdAt: '2026-10-21T00:00:00.000Z', lastSeenAt: new Date().toISOString(), current: false, member: 'basil' },
  ];
  await base(page);
  await page.route('**/v1/account/security/devices', json({ oneDevice: false, maxDevices: 5 }));
  await page.route('**/v1/account/sessions', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(all.filter((s) => !ended.includes(s.id))) }),
  );
  await page.route('**/v1/account/sessions/*', async (r) => {
    if (r.request().method() !== 'DELETE') return r.fallback();
    ended.push(new URL(r.request().url()).pathname.split('/').pop()!);
    await r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/settings/devices');
  const team = page.locator('[data-part="team-sessions"]');
  await expect(team.locator('li')).toHaveCount(2);
  await expect(team).toContainText('"Log out all other devices" covers only your own devices. Use "Log out all team members" for your team.');
  await team.getByRole('button', { name: 'Log out all team members' }).click();
  const ask = page.getByRole('dialog', { name: 'Log out all team members?' });
  await expect(ask).toBeVisible();
  expect(ended).toEqual([]);
  await ask.getByRole('button', { name: 'Log out all team members' }).click();
  await expect(screenStatus(page)).toHaveText('All team members were logged out.');
  expect(ended).toEqual(['s3', 's4']);
  await expect(page.locator('[data-part="team-sessions"]')).toHaveCount(0);
  await expect(page.locator('[data-part="device-list"] li')).toHaveCount(2);
});

// Task 30 re-review (items 1, 2, 7).

test('an authenticator app never confirms: the confirm sheet offers only the PGP key, the passkey and the security key', async ({ page }) => {
  await base(page, { me: { methods: ['pgp', 'totp'] } });
  let body: Record<string, unknown> | null = null;
  await stubPgpConfirm(page, (r) => {
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
  const sheet = page.locator('[role="dialog"]');
  await expect(sheet.locator('[data-method="pgp"]')).toBeVisible();
  await expect(sheet.locator('#confirm-totp, #confirm-password, [data-method="totp"], [data-method="password"]')).toHaveCount(0);
  await confirmWithPgp(page);
  await expect(page.locator('[data-part="code-list"] li')).toHaveCount(1);
  expect(body).toEqual({ challengeId: 'pc1', code: '12345678' });
});

test('a recovery-code login says, on Security, how long methods can change without confirming (no hold)', async ({ page }) => {
  await base(page, { me: { recoveryUntil: new Date(Date.now() + 3_600_000).toISOString() } });
  await page.goto('/settings/security');
  await expect(page.locator('[data-part="recovery-window"]')).toBeVisible();
  await expect(page.locator('[data-part="hold-banner"]')).toHaveCount(0);
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
  // Refused before any confirm: the only dialog is CantDoThat.
  await expect(page.locator('[role="dialog"] [data-part="cant-do-that"]')).toContainText('only way to log in');
  await expect(page.locator('[role="dialog"]')).toHaveCount(1);
  expect(deletes).toBe(0);
});

// Plan 2 Task 16: the device limit, "One device at a time" (confirm-it's-you) and the approval
// sheet a logged-in device shows when a new device asks to log in.
test('Devices shows the count against the limit; One device at a time needs confirm-it’s-you', async ({ page }) => {
  await base(page, {
    sessions: [{ id: 's1', deviceLabel: 'Browser on Linux', level: 'full', createdAt: '2026-10-20T00:00:00.000Z', lastSeenAt: '2026-10-23T00:00:00.000Z', current: true }],
  });
  await page.route('**/v1/account/security/devices', json({ oneDevice: false, maxDevices: 3 }));
  await stubPgpConfirm(page);
  let sent: unknown = null;
  await page.route('**/v1/account/security/one-device', async (r) => {
    const body = JSON.parse(r.request().postData() ?? '{}') as { on?: boolean; confirmToken?: string };
    if (body.confirmToken === undefined) return json({ error: 'confirm-required', action: 'set-one-device' }, 403)(r);
    sent = body;
    return json({ oneDevice: true, maxDevices: 3 })(r);
  });

  await page.goto('/settings/devices');
  await expect(page.locator('[data-part="devices-count"]')).toHaveText('1 of 3 devices logged in');
  const sw = page.getByRole('switch', { name: 'One device at a time' });
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await sw.click();
  await expect(page.locator('[role="dialog"]')).toHaveCount(1);
  await confirmWithPgp(page);
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  expect(sent).toEqual({ on: true, confirmToken: 't1' });
});

test('a logged-in device asked "Is this you?" taps the number and lets the new device in', async ({ page }) => {
  await base(page);
  const id = '22222222-2222-4222-8222-222222222222';
  await page.route('**/v1/account/approvals', json([
    { id, deviceLabel: 'Chrome on Windows', choices: [31, 47, 86], createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 120_000).toISOString(), atLimit: false, oneDevice: false, keysOffered: false },
  ]));
  let decision: unknown = null;
  await page.route(`**/v1/account/approvals/${id}`, async (r) => {
    decision = JSON.parse(r.request().postData() ?? '{}');
    return json({ outcome: 'approved' })(r);
  });
  await page.goto('/settings/security');
  const sheet = page.locator('[role="dialog"]');
  await expect(sheet).toContainText('Someone is logging in on Chrome on Windows. Is this you?');
  await sheet.locator('[data-part="approve-choice"]', { hasText: '47' }).click();
  await sheet.locator('[data-part="approve-yes"]').click();
  await expect(sheet.locator('h2')).toHaveText('Chrome on Windows is logged in');
  await expect(sheet.locator('[data-part="approve-done"]')).toBeVisible();
  expect(decision).toEqual({ choice: 47 });
  await sheet.locator('[data-part="approve-ok"]').click();
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
});

test('a new recovery code is shown once, after the reminder, and must be written down', async ({ page }) => {
  await base(page, { me: { recoveryCodeToShow: true } });
  let reveals = 0;
  await page.route('**/v1/account/recovery-code/reveal', (r) => {
    reveals += 1;
    return json({ code: 'K7QM4XD2VT9BHP3A' })(r);
  });
  await page.goto('/settings/security');
  const card = page.locator('[data-part="new-recovery-code"]');
  await expect(card).toContainText('your emergency way back in');
  await card.locator('[data-part="new-code-show"]').click();
  await expect(card.locator('[data-part="new-code"] li')).toHaveText(['K7QM', '4XD2', 'VT9B', 'HP3A']);
  await expect(card).toContainText('You will not see it again.');
  await expect(card.locator('[data-part="new-code-done"]')).toBeDisabled();
  await card.locator('input[type="checkbox"]').check();
  await card.locator('[data-part="new-code-done"]').click();
  await expect(card).toHaveCount(0);
  expect(reveals).toBe(1);
});

// C2-D1: the LoginApprove and Devices boards at phone sizes: no sideways scroll, every control
// tappable, and the board's 44 px targets (number tiles, device cards, switch, row buttons, back).
async function expectAtLeast44(page: Page, selector: string): Promise<void> {
  const boxes = await page.locator(selector).evaluateAll((els) =>
    els.filter((e) => (e as HTMLElement).checkVisibility()).map((e) => ({ s: e.outerHTML.slice(0, 80), ...e.getBoundingClientRect().toJSON() as { width: number; height: number } })),
  );
  expect(boxes.length, selector).toBeGreaterThan(0);
  for (const b of boxes) expect(Math.min(b.width, b.height), b.s).toBeGreaterThanOrEqual(44);
}

for (const viewport of PHONE_VIEWPORTS) {
  test(`Devices and sessions at ${viewport}: phone layout, 44 px targets, the switch and named Log out buttons`, async ({ page }) => {
    await base(page, {
      sessions: [
        { id: 's1', deviceLabel: 'Browser on Linux', level: 'full', createdAt: '2026-10-20T00:00:00.000Z', lastSeenAt: new Date().toISOString(), current: true, member: null },
        { id: 's2', deviceLabel: 'Chrome on Android', level: 'full', createdAt: '2026-10-21T00:00:00.000Z', lastSeenAt: new Date(Date.now() - 7_200_000).toISOString(), current: false, member: null },
        { id: 's3', deviceLabel: 'Safari on macOS', level: 'full', createdAt: '2026-10-21T00:00:00.000Z', lastSeenAt: new Date(Date.now() - 1_500_000).toISOString(), current: false, member: 'desk_ana' },
      ],
    });
    await page.route('**/v1/account/security/devices', json({ oneDevice: false, maxDevices: 3 }));
    await setPhone(page, viewport);
    await page.goto('/settings/devices');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Devices and sessions');
    await expect(page.locator('[data-part="devices-count"]')).toHaveText('3 of 3 devices logged in');
    await expect(page.getByRole('button', { name: 'Log out Chrome on Android' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log out desk_ana on Safari on macOS' })).toBeVisible();
    await expectPhoneLayout(page);
    await expectAtLeast44(page, '[aria-label="Back to settings"], [role="switch"], [data-part="end-session"], [data-part="end-others"], [data-part="end-team"]');
    // The two "Log out all" buttons span their panel (Devices board), whatever other screens' panels do.
    for (const part of ['end-others', 'end-team']) {
      const gap = await page.locator(`[data-part="${part}"]`).evaluate((b) => {
        const p = b.parentElement!;
        const cs = getComputedStyle(p);
        const inner = p.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        return Math.abs(inner - b.getBoundingClientRect().width);
      });
      expect(gap, part).toBeLessThan(1);
    }
    // The back control is the first thing a keyboard reaches.
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toHaveAttribute('aria-label', 'Back to settings');
  });

  test(`the "Is this you?" sheet at ${viewport}: phone layout, 44 px tiles and cards, arrow keys pick a number`, async ({ page }) => {
    await base(page);
    const id = '22222222-2222-4222-8222-222222222222';
    await page.route('**/v1/account/approvals', json([
      { id, deviceLabel: 'Chrome on Windows', choices: [31, 47, 86], createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 120_000).toISOString(), atLimit: true, oneDevice: false, keysOffered: false },
    ]));
    await page.route('**/v1/account/security/devices', json({ oneDevice: false, maxDevices: 3 }));
    await page.route(`**/v1/account/approvals/${id}`, json({
      error: 'too-many-devices',
      sessions: [
        { id: 's1', deviceLabel: 'Browser on Linux', lastSeenAt: new Date().toISOString(), current: true },
        { id: 's2', deviceLabel: 'Chrome on Android', lastSeenAt: new Date(Date.now() - 3 * 86_400_000).toISOString(), current: false },
      ],
    }, 409));
    await setPhone(page, viewport);
    await page.goto('/settings/security');
    const sheet = page.getByRole('dialog', { name: 'Someone is logging in on Chrome on Windows. Is this you?' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Close' })).toHaveCount(0);
    await expectPhoneLayout(page);
    await expectAtLeast44(page, '[role="dialog"] .x2f-choice, [role="dialog"] [data-part="approve-yes"], [role="dialog"] [data-part="approve-block"]');
    const group = sheet.getByRole('radiogroup', { name: "If it's you, tap the number shown on the new device" });
    await group.getByRole('radio', { name: '31' }).check();
    await page.keyboard.press('ArrowRight');
    await expect(group.getByRole('radio', { name: '47' })).toBeChecked();
    await sheet.locator('[data-part="approve-yes"]').click();
    const choose = page.getByRole('dialog', { name: 'Choose a device to log out' });
    await expect(choose).toBeVisible();
    await expect(page.locator('[data-part="cant-do-that"]')).toHaveCount(0);
    await expect(choose.getByRole('radiogroup', { name: 'Device to log out' }).getByRole('radio')).toHaveCount(2);
    await expectAtLeast44(page, '[role="dialog"] .x2f-choice');
    await expectPhoneLayout(page);
  });
}
