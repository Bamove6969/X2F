// Plan 4 Task 31 / J-14: the trader's support tickets and "My account has been compromised" in a
// real browser. No Claude Design boards exist yet (tripwire NEEDS_DESIGN_TICKETS), so there is no
// parity check here: only behaviour, the page rules (one data-primary, no horizontal scroll at phone
// width) and that the compromised form never has a secret field. The API is stubbed with page.route
// in the shapes of apps/api/src/tickets/traderRoutes.ts (its own tests cover the server side).
import { expect, test, type Page, type Route } from '@playwright/test';

const ME = { displayName: 'nightowl_44', kind: 'trader', level: 'full', termsCurrent: true };
const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const TICKET = {
  id: '11111111-1111-4111-8111-111111111111',
  number: 1001,
  category: 'trades',
  tradeCode: null,
  status: 'open',
  createdAt: '2026-11-09T10:00:00.000Z',
  updatedAt: '2026-11-09T10:00:00.000Z',
  closedAt: null,
};

async function noSideScroll(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test.use({ viewport: { width: 390, height: 844 } });

test('open a ticket, read the thread, reply and close it', async ({ page }) => {
  const sent: { url: string; body: unknown }[] = [];
  let status = 'open';
  const messages = [{ author: 'trader', memberName: null, body: 'Where is my trade?', at: TICKET.createdAt }];
  await page.route('**/v1/account/me', json(ME));
  await page.route('**/v1/tickets', (r) => {
    if (r.request().method() === 'POST') {
      sent.push({ url: '/v1/tickets', body: r.request().postDataJSON() });
      return json({ ticket: TICKET }, 201)(r);
    }
    return json({ tickets: [] })(r);
  });
  await page.route(`**/v1/tickets/${TICKET.id}`, (r) => json({ ticket: { ...TICKET, status }, messages })(r));
  await page.route(`**/v1/tickets/${TICKET.id}/messages`, (r) => {
    sent.push({ url: 'messages', body: r.request().postDataJSON() });
    messages.push({ author: 'trader', memberName: null, body: 'Thanks', at: TICKET.createdAt });
    return json({}, 201)(r);
  });
  await page.route(`**/v1/tickets/${TICKET.id}/close`, (r) => {
    status = 'closed';
    return json({ ticket: { ...TICKET, status } })(r);
  });

  await page.goto('/support');
  await expect(page.getByRole('heading', { name: 'Support' })).toBeVisible();
  await expect(page.locator('[data-primary]')).toHaveCount(1);
  await expect(page.getByLabel('What is it about?').locator('option').last()).toHaveText('Everything else');
  await noSideScroll(page);
  await page.getByLabel('What is it about?').selectOption('trades');
  await page.getByLabel('Your message').fill('Where is my trade?');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page).toHaveURL(new RegExp(`/support/${TICKET.id}$`));
  expect(sent[0]).toEqual({ url: '/v1/tickets', body: { category: 'trades', body: 'Where is my trade?' } });
  await expect(page.locator('[data-part="ticket-thread"]')).toContainText('Where is my trade?');
  await noSideScroll(page);
  await page.getByLabel('Reply').fill('Thanks');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('[data-part="ticket-thread"]')).toContainText('Thanks');
  await page.getByRole('button', { name: 'Close ticket' }).click();
  await expect(page.getByText('This ticket is closed.')).toBeVisible();
});

test('a second open ticket is refused in CantDoThat, naming the open one', async ({ page }) => {
  await page.route('**/v1/account/me', json(ME));
  await page.route('**/v1/tickets', (r) => (r.request().method() === 'POST' ? json({ error: 'ticket-open', number: 1001 }, 409)(r) : json({ tickets: [TICKET] })(r)));
  await page.goto('/support');
  await expect(page.locator('[data-ticket="1001"]')).toBeVisible();
  await page.getByLabel('Your message').fill('Another one');
  await page.getByRole('button', { name: 'Send' }).click();
  const popup = page.getByRole('dialog', { name: "This ticket can't be opened yet" });
  await expect(popup).toBeVisible();
  await expect(popup).toContainText('Ticket 1001 is still open.');
  await noSideScroll(page);
});

test('"My account has been compromised": no login needed, no secret field, kinds only; shows the number and how to reach staff', async ({ page }) => {
  let body: unknown = null;
  await page.route('**/v1/account/me', json({ error: 'not-authenticated' }, 401));
  await page.route('**/v1/tickets', json({ error: 'not-authenticated' }, 401));
  await page.route('**/v1/tickets/compromised', (r) => {
    body = r.request().postDataJSON();
    return json({ number: 1042 }, 202)(r);
  });
  await page.goto('/support');
  await page.getByRole('link', { name: 'My account has been compromised' }).click();
  await expect(page).toHaveURL(/\/support\/compromised$/);
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.locator('[data-primary]')).toHaveCount(1);
  await noSideScroll(page);
  await page.getByLabel(/Your username/).fill('my-login');
  await page.getByLabel('A recovery code').check();
  await page.getByLabel(/Tell us what happened/).fill('They took my phone.');
  await expect(page.getByRole('button', { name: 'Lock my account' })).toBeDisabled();
  await page.getByLabel(/I understand my account will be locked/).check();
  await page.getByRole('button', { name: 'Lock my account' }).click();
  await expect(page.locator('[data-part="compromised-number"]')).toContainText('1042');
  await expect(page.locator('[data-part="compromised-contact"]')).toContainText('Matrix');
  expect(body).toEqual({ loginName: 'my-login', methodsLeft: ['recovery-code'], comment: 'They took my phone.' });
  await noSideScroll(page);
});
