// Settings → Alerts, as drawn on the Security screen (batch 8): the loud alarm card (W-006), the
// secure Jabber section (owner rule p5-7, W-021) and the alerts list (Task 30). The API is stubbed
// per test with page.route in the shapes of @x2f/auth-client; the alarm keeps its settings on this
// device only (localStorage, IndexedDB), so nothing about it reaches the API.
//
// No Claude Design board yet for the alarm card or the Jabber section (NEEDS_DESIGN_TEAM): no
// parity; the phone layout (expectPhoneLayout) at PHONE_VIEWPORTS and 44 px targets only.
import { expect, test, type Page, type Route } from '@playwright/test';
import { PHONE_VIEWPORTS, expectPhoneLayout, setPhone } from './phone.js';

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const ME = { displayName: 'nightowl', kind: 'trader', level: 'full', holdUntil: null, methods: ['password'], hasBackup: false, suggestions: [], termsCurrent: true };
const JABBER_ON = { available: true, state: 'on', address: 'n•••@xmpp.example.org', pendingAddress: null, lastSentAt: '2026-11-10T09:00:00.000Z' };
const JABBER_OFF = { available: true, state: 'off', address: null, pendingAddress: null, lastSentAt: null };

/** The Security screen signed in, with two alerts (one unseen) and the given Jabber state. */
async function base(page: Page, jabber: unknown = JABBER_ON): Promise<string[]> {
  const seen: string[] = [];
  await page.route('**/v1/account/me', json(ME));
  await page.route('**/v1/account/methods', json([{ type: 'password', id: 'password', label: 'Password', createdAt: null, lastUsedAt: null }]));
  await page.route('**/v1/account/sessions', json([]));
  await page.route('**/v1/account/alerts', json([
    { id: 'a1', kind: 'new-login', detail: null, createdAt: '2026-11-11T08:00:00.000Z', seenAt: null },
    { id: 'a2', kind: 'recovery-code-renewed', detail: null, createdAt: '2026-11-10T08:00:00.000Z', seenAt: '2026-11-10T09:00:00.000Z' },
  ]));
  await page.route('**/v1/account/alerts/*/seen', (r) => {
    seen.push(new URL(r.request().url()).pathname);
    return r.fulfill({ status: 204 });
  });
  await page.route('**/v1/account/jabber', json(jabber));
  return seen;
}

async function expectAtLeast44(page: Page, selector: string): Promise<void> {
  const boxes = await page.locator(selector).evaluateAll((els) =>
    els.filter((e) => (e as HTMLElement).checkVisibility()).map((e) => ({ s: e.outerHTML.slice(0, 80), ...e.getBoundingClientRect().toJSON() as { width: number; height: number } })),
  );
  expect(boxes.length, selector).toBeGreaterThan(0);
  for (const b of boxes) expect(Math.min(b.width, b.height), b.s).toBeGreaterThanOrEqual(44);
}

for (const viewport of PHONE_VIEWPORTS) {
  test(`Alerts at ${viewport}: phone layout, 44 px alarm and Jabber controls, every alarm control named`, async ({ page }) => {
    await base(page);
    await setPhone(page, viewport);
    await page.goto('/settings/alerts');
    await expect(page.locator('[data-part="alarm"]')).toBeVisible();
    await expect(page.locator('[data-part="jabber-switch"]')).toBeVisible();
    await expect(page.locator('[data-part="alert-list"] li')).toHaveCount(2);
    await expectPhoneLayout(page);
    await expectAtLeast44(
      page,
      '[data-part="alarm-switch"], [data-part="alarm-volume"], [data-part="alarm"] .x2f-tickbox, [data-part="alarm"] label:has([data-part="alarm-file"]), [data-part="alarm-test"], [data-part="jabber-switch"], [data-part="jabber-address-row"], [data-part="jabber-events-row"]',
    );
    const alarm = page.locator('[data-part="alarm"]');
    await expect(alarm.getByRole('switch', { name: 'Loud alarm' })).toBeVisible();
    await expect(alarm.getByRole('slider', { name: 'Volume 80%' })).toBeVisible();
    for (const name of ['Trade changes', 'A cancel that needs your input', 'Alerts that need your attention', 'Nudges']) {
      await expect(alarm.getByRole('checkbox', { name })).toBeVisible();
    }
    await expect(alarm.getByLabel('Choose sound')).toHaveAttribute('type', 'file');
  });
}

test('the alarm: turn it on, set the volume and the events, choose a sound; it all stays on this device', async ({ page }) => {
  await base(page);
  const api: string[] = [];
  page.on('request', (r) => {
    const p = new URL(r.url()).pathname;
    if (p.startsWith('/v1/') && r.method() !== 'GET') api.push(`${r.method()} ${p}`);
  });
  await page.goto('/settings/alerts');
  const alarm = page.locator('[data-part="alarm"]');
  const sw = alarm.getByRole('switch', { name: 'Loud alarm' });
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'true');

  const volume = alarm.getByRole('slider');
  await volume.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(alarm.getByRole('slider', { name: 'Volume 75%' })).toBeVisible();

  // Tapping the words ticks the box (the label is the target).
  const nudges = alarm.getByRole('checkbox', { name: 'Nudges' });
  await expect(nudges).not.toBeChecked();
  await alarm.getByText('Nudges', { exact: true }).click();
  await expect(nudges).toBeChecked();
  await alarm.getByRole('checkbox', { name: 'Trade changes' }).uncheck();

  // The file input is behind the "Choose sound" button: a picture is refused, a sound is kept.
  const file = alarm.locator('[data-part="alarm-file"]');
  await file.setInputFiles({ name: 'pic.png', mimeType: 'image/png', buffer: Buffer.from([1, 2, 3]) });
  await expect(alarm.locator('[role="alert"]')).toHaveText("That isn't a sound file. Choose an audio file.");
  await file.setInputFiles({ name: 'mine.ogg', mimeType: 'audio/ogg', buffer: Buffer.from([5, 6, 7]) });
  await expect(alarm.locator('[data-part="alarm-sound"]')).toHaveText('Your sound');
  await expect(alarm.locator('[role="alert"]')).toHaveCount(0);
  await expect(alarm.locator('[data-part="alarm-default-sound"]')).toBeVisible();

  // After a reload the card reads back what was set.
  await page.reload();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await expect(alarm.getByRole('slider', { name: 'Volume 75%' })).toBeVisible();
  await expect(alarm.getByRole('checkbox', { name: 'Nudges' })).toBeChecked();
  await expect(alarm.getByRole('checkbox', { name: 'Trade changes' })).not.toBeChecked();
  await expect(alarm.locator('[data-part="alarm-sound"]')).toHaveText('Your sound');
  await alarm.locator('[data-part="alarm-default-sound"]').click();
  await expect(alarm.locator('[data-part="alarm-sound"]')).toHaveText('Default sound');

  // Only the unseen alert is marked seen; the alarm sent nothing.
  expect(api.filter((a) => !a.endsWith('/seen'))).toEqual([]);
});

test('the Jabber switch pauses and resumes alerts; the rows open the set-up and the events page', async ({ page }) => {
  const seen = await base(page);
  const puts: unknown[] = [];
  await page.route('**/v1/account/jabber/enabled', (r) => {
    const body = JSON.parse(r.request().postData() ?? '{}') as { on: boolean };
    puts.push(body);
    return json({ ...JABBER_ON, state: body.on ? 'on' : 'paused' })(r);
  });
  await page.goto('/settings/alerts');
  const jabber = page.locator('[data-part="jabber-alerts"]');
  const sw = jabber.getByRole('switch', { name: 'Account and trade alerts' });
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await expect(jabber.locator('[data-part="jabber-last"]')).toContainText('Last message');
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  expect(puts).toEqual([{ on: false }, { on: true }]);
  expect(seen).toEqual(['/v1/account/alerts/a1/seen']);

  await expect(jabber.getByRole('link', { name: 'Jabber address n•••@xmpp.example.org, change it' })).toHaveAttribute('href', '/settings/jabber');
  await expect(jabber.locator('[data-part="jabber-events-row"]')).toHaveAttribute('href', '/settings/jabber/events');
});

for (const viewport of PHONE_VIEWPORTS) {
  test(`Jabber not set up at ${viewport}: no switch, the address row says so and opens the set-up`, async ({ page }) => {
    await base(page, JABBER_OFF);
    await setPhone(page, viewport);
    await page.goto('/settings/alerts');
    const jabber = page.locator('[data-part="jabber-alerts"]');
    await expect(jabber).toBeVisible();
    await expect(jabber.getByRole('switch')).toHaveCount(0);
    await expect(jabber.locator('[data-part="jabber-events-row"]')).toHaveCount(0);
    const row = jabber.getByRole('link', { name: 'Jabber address not set up, set it up' });
    await expect(row).toContainText('Not set up');
    await expectPhoneLayout(page);
    await row.click();
    await expect(page).toHaveURL(/\/settings\/jabber$/);
  });
}
