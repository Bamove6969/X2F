// Plan 4 Tasks 30-31: a helper with the owner's tickets grant works the support-ticket queue in a
// real browser, under STAFF_CSP. No board draws it (DESIGN: not drawn), so there is no parity check.
// The staff API is stubbed with page.route in the shapes of apps/api/src/tickets/staffRoutes.ts: the
// queue carries no text; the thread opens after Take; a reply, then Close.
import { expect, test, type Page, type Route } from '@playwright/test';

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const H = 3_600_000;
const HELPER = { displayName: 'hana', role: 'helper', nav: ['tickets'], sessionEndsAt: new Date(Date.now() + 8 * H).toISOString() };
const ID = '5d0c8f6e-4c1b-4a8e-9a57-0b3c2d1e4f60';
const AT = new Date(Date.now() - 3 * H).toISOString();
const TEXT = 'My Feather wallet does not show up.';

async function stub(page: Page, posts: Array<{ path: string; body: unknown }>): Promise<void> {
  let taken = false;
  let status: 'open' | 'answered' | 'closed' = 'open';
  const messages: Array<{ from: 'trader' | 'staff'; body: string; at: string; mine: boolean }> = [{ from: 'trader', body: TEXT, at: AT, mine: false }];
  const kase = () => ({ id: ID, category: 'wallets', status, tradeCode: null, createdAt: AT, updatedAt: AT, messages });
  await page.route('**/staff/v1/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (req.method() === 'POST') posts.push({ path, body: req.postDataJSON() });
    if (path === '/staff/v1/me') return json(HELPER)(route);
    if (path === '/staff/v1/tickets' && req.method() === 'GET') {
      return json({ items: status === 'closed' ? [] : [{ id: ID, category: 'wallets', status, createdAt: AT, updatedAt: AT, waiting: status === 'open' ? 'staff' : 'trader', taken: taken ? 'me' : null }] })(route);
    }
    if (path === `/staff/v1/tickets/${ID}/take`) {
      taken = true;
      return json(kase())(route);
    }
    if (path === `/staff/v1/tickets/${ID}` && req.method() === 'GET') return taken ? json(kase())(route) : json({ error: 'forbidden-case' }, 403)(route);
    if (path === `/staff/v1/tickets/${ID}/messages`) {
      messages.push({ from: 'staff', body: (req.postDataJSON() as { body: string }).body, at: new Date().toISOString(), mine: true });
      status = 'answered';
      return json(kase())(route);
    }
    if (path === `/staff/v1/tickets/${ID}/close`) {
      status = 'closed';
      return json(kase())(route);
    }
    return json({ error: 'not-found' }, 404)(route);
  });
}

test('a helper with the grant takes, answers and closes a ticket; the queue shows no text; no CSP violation', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/content security policy/i.test(m.text())) violations.push(m.text());
  });
  const posts: Array<{ path: string; body: unknown }> = [];
  await stub(page, posts);
  await page.goto('/');
  await expect(page).toHaveURL(/\/tickets$/);
  await expect(page.locator('nav[aria-label="Staff"] a')).toHaveText(['Tickets']);
  const queue = page.locator('[data-screen="ticket-queue"]');
  await expect(queue.locator('tbody tr')).toHaveCount(1);
  await expect(queue).toContainText('Wallets');
  await expect(queue).toContainText('3 h');
  await expect(queue).not.toContainText(TEXT);

  await page.locator('[data-part="ticket-take"]').click();
  await expect(page).toHaveURL(new RegExp(`/tickets/${ID}$`));
  const thread = page.locator('[data-part="ticket-thread"]');
  await expect(thread).toContainText(TEXT);
  await expect(thread).toContainText('Trader');
  await expect(page.locator('[data-primary]')).toHaveCount(1);
  await page.getByLabel('Reply to the trader').fill('Add it again from Wallets, Add a wallet.');
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(page.locator('[data-part="ticket-message"]')).toHaveCount(2);
  await expect(page.locator('[data-part="ticket-message"]').last()).toContainText('You');
  await page.locator('[data-part="ticket-close"]').click();
  await expect(page.locator('[data-part="ticket-closed"]')).toBeVisible();

  await page.getByRole('link', { name: 'Back to the queue' }).click();
  await expect(page.locator('[data-screen="ticket-queue"]')).toContainText('No tickets waiting.');
  expect(posts.map((p) => p.path)).toEqual([`/staff/v1/tickets/${ID}/take`, `/staff/v1/tickets/${ID}/messages`, `/staff/v1/tickets/${ID}/close`]);
  expect(posts[1]!.body).toEqual({ body: 'Add it again from Wallets, Add a wallet.' });
  expect(violations).toEqual([]);
});

test('a helper without the grant has no Tickets page', async ({ page }) => {
  await page.route('**/staff/v1/**', (route) => (new URL(route.request().url()).pathname === '/staff/v1/me' ? json({ ...HELPER, nav: [] })(route) : json({ error: 'forbidden' }, 403)(route)));
  await page.goto('/tickets');
  await expect(page.locator('[data-part="nothing-for-role"]')).toBeVisible();
  await expect(page.locator('nav[aria-label="Staff"] a')).toHaveCount(0);
});
