// Settings → Alerts → Secure Jabber alerts (owner rule p5-7) and Jabber notifications (W-021, batch
// 8): the three-step set-up (address, code from the test message, done) with its refusals, turning
// it off, and the events page with its always-on security notice (review F1). The API is stubbed per
// test with page.route in the shapes of @x2f/auth-client (the server's rules are tested in
// apps/api/test/jabber*.test.ts).
//
// The JabberSetup board has no reference in design/x2f-app (canvas.json), and no board draws the
// events page yet (NEEDS_DESIGN_TEAM): no parity; the phone layout (expectPhoneLayout) at
// PHONE_VIEWPORTS only.
import { expect, test, type Page, type Route } from '@playwright/test';
import { PHONE_VIEWPORTS, expectPhoneLayout, setPhone } from './phone.js';

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const ME = { displayName: 'nightowl', kind: 'trader', level: 'full', holdUntil: null, methods: ['password'], hasBackup: false, suggestions: [], termsCurrent: true };
const MASKED = 'n•••@xmpp.example.org';
const OFF = { available: true, state: 'off', address: null, pendingAddress: null, lastSentAt: null };
const ON = { available: true, state: 'on', address: MASKED, pendingAddress: null, lastSentAt: null };

async function base(page: Page, jabber: unknown): Promise<void> {
  await page.route('**/v1/account/me', json(ME));
  await page.route('**/v1/account/alerts', json([]));
  await page.route('**/v1/account/jabber', (r) => (r.request().method() === 'DELETE' ? r.fulfill({ status: 204 }) : json(jabber)(r)));
}

async function expectAtLeast44(page: Page, selector: string): Promise<void> {
  const boxes = await page.locator(selector).evaluateAll((els) =>
    els.filter((e) => (e as HTMLElement).checkVisibility()).map((e) => ({ s: e.outerHTML.slice(0, 80), ...e.getBoundingClientRect().toJSON() as { width: number; height: number } })),
  );
  expect(boxes.length, selector).toBeGreaterThan(0);
  for (const b of boxes) expect(Math.min(b.width, b.height), b.s).toBeGreaterThanOrEqual(44);
}

for (const viewport of PHONE_VIEWPORTS) {
  test(`set-up at ${viewport}: address, test message, code, on; phone layout at every step; then turn off`, async ({ page }) => {
    await base(page, OFF);
    const posted: Array<[string, unknown]> = [];
    await page.route('**/v1/account/jabber/test', (r) => {
      posted.push(['test', JSON.parse(r.request().postData() ?? '{}')]);
      return json({ pendingAddress: MASKED, resendAfterSeconds: 60 })(r);
    });
    await page.route('**/v1/account/jabber/verify', (r) => {
      posted.push(['verify', JSON.parse(r.request().postData() ?? '{}')]);
      return json(ON)(r);
    });
    await setPhone(page, viewport);
    await page.goto('/settings/jabber');

    const screen = page.locator('[data-screen="jabber-setup"]');
    await expect(screen).toHaveAttribute('data-step', 'address');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Secure Jabber alerts');
    const send = page.locator('[data-part="jabber-send-test"]');
    await expect(send).toBeDisabled();
    await page.getByRole('textbox', { name: 'Your Jabber address' }).fill('nightowl@xmpp.example.org');
    await expectPhoneLayout(page);
    await expectAtLeast44(page, '[aria-label="Back to alerts"], #js-jid, [data-part="jabber-send-test"]');
    await send.click();

    await expect(screen).toHaveAttribute('data-step', 'verify');
    await expect(page.locator('[data-part="jabber-verify"]')).toContainText(`Sent to ${MASKED}.`);
    const code = page.getByRole('textbox', { name: 'Enter the code from the test message' });
    // Only digits are kept.
    await code.fill('12 34a');
    await expect(code).toHaveValue('1234');
    await expectPhoneLayout(page);
    await expectAtLeast44(page, '#js-code, [data-part="jabber-resend"], [data-part="jabber-turn-on"]');
    await page.locator('[data-part="jabber-resend"]').click();
    await expect(page.locator('[data-part="jabber-resend"]')).toHaveText('Sent again');
    await code.fill('123456');
    await page.locator('[data-part="jabber-turn-on"]').click();

    await expect(screen).toHaveAttribute('data-step', 'done');
    await expect(page.locator('[data-part="jabber-done"]')).toContainText(`Every account change now sends one short message to ${MASKED}.`);
    await expect(page.locator('[data-part="jabber-preview-text"]')).toHaveText('An account change was made on your X2F account.');
    await expectPhoneLayout(page);
    await expectAtLeast44(page, '[data-part="jabber-done-link"], [data-part="jabber-turn-off"]');
    expect(posted).toEqual([
      ['test', { address: 'nightowl@xmpp.example.org' }],
      ['test', { address: 'nightowl@xmpp.example.org' }],
      ['verify', { code: '123456' }],
    ]);

    // Turn off is never the primary; it goes back to the address step, empty.
    await expect(page.locator('[data-part="jabber-turn-off"]')).not.toHaveAttribute('data-primary', /.*/);
    await page.locator('[data-part="jabber-turn-off"]').click();
    await expect(screen).toHaveAttribute('data-step', 'address');
    await expect(page.getByRole('textbox', { name: 'Your Jabber address' })).toHaveValue('');
  });
}

test('the set-up says plainly what went wrong: a bad address, a wrong code, an ended code', async ({ page }) => {
  await base(page, OFF);
  let tests = 0;
  await page.route('**/v1/account/jabber/test', (r) => {
    tests += 1;
    return tests === 1 ? json({ error: 'jabber-address-invalid' }, 400)(r) : json({ pendingAddress: MASKED, resendAfterSeconds: 60 })(r);
  });
  let verifies = 0;
  await page.route('**/v1/account/jabber/verify', (r) => {
    verifies += 1;
    return verifies === 1 ? json({ error: 'code-invalid' }, 400)(r) : json({ error: 'challenge-expired' }, 400)(r);
  });
  await page.goto('/settings/jabber');
  await page.getByRole('textbox', { name: 'Your Jabber address' }).fill('not-an-address');
  await page.locator('[data-part="jabber-send-test"]').click();
  await expect(page.locator('[role="alert"]')).toHaveText("That isn't a Jabber address. It looks like name@server.org.");
  await expect(page.locator('[data-screen="jabber-setup"]')).toHaveAttribute('data-step', 'address');

  await page.getByRole('textbox', { name: 'Your Jabber address' }).fill('nightowl@xmpp.example.org');
  await page.locator('[data-part="jabber-send-test"]').click();
  await page.getByRole('textbox', { name: 'Enter the code from the test message' }).fill('000000');
  await page.locator('[data-part="jabber-turn-on"]').click();
  await expect(page.locator('[role="alert"]')).toHaveText("That code isn't right. Check the test message and try again.");
  await page.locator('[data-part="jabber-turn-on"]').click();
  await expect(page.locator('[role="alert"]')).toHaveText('That code has ended. Send a new test message.');
  await expect(page.locator('[data-screen="jabber-setup"]')).toHaveAttribute('data-step', 'verify');
});

test('without a sending account the set-up says it is coming and cannot send', async ({ page }) => {
  await base(page, { ...OFF, available: false });
  await page.goto('/settings/jabber');
  await expect(page.locator('[data-part="jabber-unavailable"]')).toHaveText('Jabber alerts are coming to X2F soon.');
  await page.getByRole('textbox', { name: 'Your Jabber address' }).fill('nightowl@xmpp.example.org');
  await expect(page.locator('[data-part="jabber-send-test"]')).toBeDisabled();
});

const EVENTS = {
  events: [
    { kind: 'account-change', on: true, canTurnOff: false },
    { kind: 'trade-attention', on: false, canTurnOff: true },
    { kind: 'team-member-first-login', on: true, canTurnOff: true },
  ],
};

for (const viewport of PHONE_VIEWPORTS) {
  test(`Jabber notifications at ${viewport}: phone layout; the security notice stays on; a tick sends that event only`, async ({ page }) => {
    await base(page, ON);
    const puts: unknown[] = [];
    let events = EVENTS.events;
    await page.route('**/v1/account/jabber/events', (r) => {
      if (r.request().method() === 'GET') return json({ events })(r);
      const body = JSON.parse(r.request().postData() ?? '{}') as { kind: string; on: boolean };
      puts.push(body);
      events = events.map((e) => (e.kind === body.kind ? { ...e, on: body.on } : e));
      return json({ events })(r);
    });
    await setPhone(page, viewport);
    await page.goto('/settings/jabber/events');
    const list = page.locator('[data-part="jabber-events"]');
    await expect(list).toBeVisible();
    await expectPhoneLayout(page);
    await expectAtLeast44(page, '[aria-label="Back to alerts"]');

    const account = list.getByRole('checkbox', { name: 'Account changes' });
    await expect(account).toBeChecked();
    await expect(account).toBeDisabled();
    await expect(page.locator('[data-part="jabber-events-always-on"]')).toHaveText("Security alerts can't be turned off.");

    const trade = list.getByRole('checkbox', { name: 'A trade needs your attention' });
    await expect(trade).not.toBeChecked();
    await list.getByText('A trade needs your attention', { exact: true }).click();
    await expect(trade).toBeChecked();
    // The boxes are disabled while a change is on its way.
    await expect(trade).toBeEnabled();
    // The box shows what the server answered, so it is clicked and then read (not `uncheck`, which wants the change at once).
    await list.getByRole('checkbox', { name: 'A team member logs in for the first time' }).click();
    await expect(list.getByRole('checkbox', { name: 'A team member logs in for the first time' })).not.toBeChecked();
    expect(puts).toEqual([
      { kind: 'trade-attention', on: true },
      { kind: 'team-member-first-login', on: false },
    ]);
  });
}

test('Jabber notifications before an address is set up: a link to the set-up, no boxes', async ({ page }) => {
  await base(page, OFF);
  await page.route('**/v1/account/jabber/events', json(EVENTS));
  await page.goto('/settings/jabber/events');
  const setup = page.locator('[data-part="jabber-events-setup"]');
  await expect(setup).toContainText('Set up a Jabber address first.');
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await setup.getByRole('link', { name: 'Set up Jabber alerts' }).click();
  await expect(page).toHaveURL(/\/settings\/jabber$/);
});
