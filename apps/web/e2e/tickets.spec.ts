// Plan 4 Task 31: support tickets in a real browser, under the real CSP. Help, Support leads to
// "Open a ticket"; the trader picks a category, writes, follows the thread, replies and closes it.
// No Claude Design board exists yet for the ticket screens (Task 31's controller step), so there is
// no parity check: behaviour, copy and the page rules (one data-primary, no horizontal scroll), at
// phone and desktop width. The API is stubbed with page.route in the shapes of
// apps/api/src/tickets/traderRoutes.ts, and answers like it: the staff reply arrives between loads.
import { expect, test, type Page, type Route } from '@playwright/test';

const ME = { tradeTag: 'nightowl_44', kind: 'trader', level: 'full', termsCurrent: true, methods: ['password', 'totp'], hasBackup: true, suggestions: [], holdUntil: null };
const ID = '5d0c8f6e-4c1b-4a8e-9a57-0b3c2d1e4f60';
const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

interface Thread {
  id: string;
  category: string;
  status: 'open' | 'answered' | 'closed';
  tradeCode: string | null;
  createdAt: string;
  updatedAt: string;
  messages: Array<{ from: 'trader' | 'staff'; body: string; at: string }>;
}

async function stub(page: Page): Promise<{ posts: unknown[]; staffReplies(text: string): void }> {
  const posts: unknown[] = [];
  const at = '2026-11-20T10:00:00.000Z';
  let t: Thread | null = null;
  await page.route('**/v1/account/me', json(ME));
  await page.route('**/v1/tickets**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const body = req.postDataJSON() as Record<string, string> | null;
    if (req.method() === 'POST') posts.push({ path, body });
    if (path === '/v1/tickets' && req.method() === 'GET') {
      return json({ items: t === null ? [] : [{ id: t.id, category: t.category, status: t.status, tradeCode: t.tradeCode, createdAt: t.createdAt, updatedAt: t.updatedAt, lastFrom: t.messages.at(-1)!.from }] })(route);
    }
    if (path === '/v1/tickets' && req.method() === 'POST') {
      t = { id: ID, category: body!.category!, status: 'open', tradeCode: null, createdAt: at, updatedAt: at, messages: [{ from: 'trader', body: body!.body!.trim(), at }] };
      return json({ id: ID }, 201)(route);
    }
    if (t === null || !path.startsWith(`/v1/tickets/${ID}`)) return json({ error: 'not-found' }, 404)(route);
    if (path === `/v1/tickets/${ID}` && req.method() === 'GET') return json(t)(route);
    if (path.endsWith('/messages')) {
      t = { ...t, status: 'open', messages: [...t.messages, { from: 'trader', body: body!.body!, at }] };
      return json(t)(route);
    }
    if (path.endsWith('/close')) {
      t = { ...t, status: 'closed' };
      return json(t)(route);
    }
    return json({ error: 'not-found' }, 404)(route);
  });
  return {
    posts,
    staffReplies(text) {
      t = { ...t!, status: 'answered', messages: [...t!.messages, { from: 'staff', body: text, at }] };
    },
  };
}

async function pageRules(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.locator('[data-primary]')).toHaveCount(1);
}

for (const size of [{ name: 'phone', width: 390, height: 844 }, { name: 'desktop', width: 1280, height: 800 }]) {
  test(`${size.name}: open, answer and close a ticket from Help, Support; no CSP violation`, async ({ page }) => {
    const violations: string[] = [];
    page.on('console', (m) => {
      if (/content security policy/i.test(m.text())) violations.push(m.text());
    });
    await page.setViewportSize({ width: size.width, height: size.height });
    const api = await stub(page);

    await page.goto('/help/support');
    await page.locator('[data-part="help-action"]').click();
    await expect(page).toHaveURL(/\/support\/tickets\/new$/);
    await expect(page.locator('[data-part="ticket-privacy"]')).toContainText('Only you and the X2F staff member working on your ticket can read it.');
    await pageRules(page);
    const send = page.getByRole('button', { name: 'Send' });
    await expect(send).toBeDisabled();
    // The categories, "Everything else" last.
    const options = page.locator('[data-part="ticket-category"]');
    await expect(options.last()).toHaveText('Everything else');
    await page.getByRole('radio', { name: 'Wallets' }).check();
    await page.getByLabel('Your message').fill('My Feather wallet does not show up.');
    await send.click();

    await expect(page).toHaveURL(new RegExp(`/support/tickets/${ID}$`));
    await expect(page.locator('[data-part="ticket-message"]')).toHaveCount(1);
    await expect(page.locator('[data-screen="ticket-thread"]')).toContainText('Waiting for X2F');
    await pageRules(page);
    expect(api.posts[0]).toEqual({ path: '/v1/tickets', body: { category: 'wallets', body: 'My Feather wallet does not show up.' } });

    // Staff answer; the trader comes back to the list and opens it.
    api.staffReplies('Add it again from Wallets, Add a wallet.');
    await page.goto('/support/tickets');
    await expect(page.locator('[data-part="ticket-row"]')).toContainText('X2F replied');
    await pageRules(page);
    await page.locator('[data-part="ticket-row"] a').click();
    const msgs = page.locator('[data-part="ticket-message"]');
    await expect(msgs).toHaveCount(2);
    await expect(msgs.last()).toContainText('X2F support');
    await expect(msgs.last()).toContainText('Add it again from Wallets, Add a wallet.');

    await page.getByLabel('Write a reply').fill('That worked, thanks.');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(msgs).toHaveCount(3);
    await page.locator('[data-part="close-ticket"]').click();
    await expect(page.locator('[data-part="ticket-closed"]')).toHaveText('This ticket is closed. Open a new ticket if you need more help.');
    await expect(page.getByLabel('Write a reply')).toHaveCount(0);
    await pageRules(page);
    expect(api.posts.map((p) => (p as { path: string }).path)).toEqual(['/v1/tickets', `/v1/tickets/${ID}/messages`, `/v1/tickets/${ID}/close`]);
    expect(violations).toEqual([]);
  });
}

test('too many tickets open: CantDoThat with its feedback line', async ({ page }) => {
  await page.route('**/v1/account/me', json(ME));
  await page.route('**/v1/tickets', (r) => (r.request().method() === 'POST' ? json({ error: 'too-many-tickets' }, 409)(r) : json({ items: [] })(r)));
  await page.goto('/support/tickets/new');
  await page.getByRole('radio', { name: 'Everything else' }).check();
  await page.getByLabel('Your message').fill('One more question.');
  await page.getByRole('button', { name: 'Send' }).click();
  const popup = page.getByRole('dialog', { name: "You can't open another ticket yet" });
  await expect(popup).toBeVisible();
  await expect(popup.locator('[data-part="feedback-line"]')).toHaveText('If you feel this feature can be improved please leave feedback');
});
