// Plan 4 Task 28: the News page (owner, 2026-10-29; spec 6.6). Newest first with posted dates, new
// versus seen kept on this device, opening after login when something is new, and working logged
// out. No board yet (Claude Design owns the look; test/news-tripwire.test.ts NEEDS_DESIGN_NEWS),
// so there is no expectParity here: the phone layout rule and the one-primary rule still apply.
import { expect, test, type Page, type Route } from '@playwright/test';
import { PHONE_VIEWPORTS, expectPhoneLayout, setPhone } from './phone.js';
import { signedIn } from './session.js';

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const item = (id: number, iso: string, title: string, body: string) => ({ id, title, body, publishedAt: iso, editedAt: null });
const ITEMS = [
  item(3, '2026-10-29T09:00:00.000Z', 'Upgrade done', 'All systems are back.\nThanks for waiting.'),
  item(2, '2026-10-28T09:00:00.000Z', 'Planned upgrade', 'Tomorrow at 09:00 UTC. Trades in escrow are safe.'),
  item(1, '2026-10-20T09:00:00.000Z', 'Welcome', 'Hello from X2F.'),
];

async function stubNews(page: Page, items: unknown[]): Promise<{ writes: string[] }> {
  const writes: string[] = [];
  await page.route('**/v1/news**', (r) => {
    if (r.request().method() !== 'GET') writes.push(`${r.request().method()} ${r.request().url()}`);
    return json({ items, serverNow: '2026-10-29T12:00:00.000Z' })(r);
  });
  return { writes };
}

const titles = (page: Page) => page.locator('[data-part="news-item"] h2').allTextContents();
const newTitles = (page: Page) => page.locator('[data-part="news-item"][data-new] h2').allTextContents();

test('logged out, News never opens: the front door sends the visitor to log in, and nothing is read (owner, 8 Nov 2026)', async ({ page }) => {
  const reads: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).pathname === '/v1/news') reads.push(r.url());
  });
  await stubNews(page, ITEMS);
  await page.route('**/v1/account/me', json({ error: 'not-authenticated' }, 401));
  await page.goto('/news');
  await expect(page).toHaveURL('/login?returnTo=%2Fnews');
  await expect(page.locator('[data-part="news-item"]')).toHaveCount(0);
  expect(reads).toEqual([]);
});

test('newest first with dates, all new, then seen on the next visit', async ({ page }) => {
  const s = await stubNews(page, ITEMS);
  await page.route('**/v1/account/me', json({ displayName: 'nightowl', kind: 'trader', level: 'full', holdUntil: null, methods: ['password'], hasBackup: true, suggestions: [], termsCurrent: true }));
  await page.goto('/news');
  await expect(page.getByRole('heading', { level: 1, name: 'News' })).toBeVisible();
  expect(await titles(page)).toEqual(['Upgrade done', 'Planned upgrade', 'Welcome']);
  expect(await newTitles(page)).toEqual(['Upgrade done', 'Planned upgrade', 'Welcome']);
  expect(await page.locator('[data-part="news-date"] time').evaluateAll((ts) => ts.map((t) => t.getAttribute('datetime')))).toEqual(
    ITEMS.map((i) => i.publishedAt),
  );
  await expect(page.locator('[data-part="news-date"]').first()).toHaveText(/^Posted .*2026/);
  await expect(page.locator('[data-primary]')).toHaveCount(1);
  await expect(page.locator('input[type="checkbox"]')).toHaveCount(0);

  await page.reload();
  await expect(page.locator('[data-part="news-count"]')).toHaveText('Nothing new since your last visit.');
  expect(await newTitles(page)).toEqual([]);
  // Reading sent nothing back.
  expect(s.writes).toEqual([]);
});

test('after login, unseen news opens first and Continue goes on', async ({ page }) => {
  await stubNews(page, ITEMS);
  await page.route('**/v1/account/me', json({ displayName: 'nightowl', kind: 'trader', level: 'full', holdUntil: null, methods: ['password'], hasBackup: true, suggestions: [], termsCurrent: true }));
  await page.route('**/v1/login/password', json({ status: 'ok' }));
  await page.goto('/login?returnTo=%2Fwallets');
  await page.click('[data-method="password"]');
  await page.fill('#login-name', 'nightowl');
  await page.fill('#login-password', 'Correct-Horse-9!');
  await page.click('[data-part="password-login"]');
  await expect(page).toHaveURL(/\/news\?returnTo=%2Fwallets$/);
  // Wait for the list: allTextContents() reads once and does not retry.
  await expect(page.locator('[data-part="news-item"][data-new] h2')).toHaveCount(3);
  await page.click('[data-part="news-continue"]');
  await expect(page).toHaveURL(/\/wallets$/);

  // Logging in again with nothing new goes straight on.
  await page.goto('/login?returnTo=%2Fbuy');
  await page.click('[data-method="password"]');
  await page.fill('#login-name', 'nightowl');
  await page.fill('#login-password', 'Correct-Horse-9!');
  await page.click('[data-part="password-login"]');
  await expect(page).toHaveURL(/\/buy$/);
});

for (const viewport of PHONE_VIEWPORTS) {
  test(`phone layout at ${viewport}`, async ({ page }) => {
    await stubNews(page, [item(4, '2026-10-30T09:00:00.000Z', 'A longer title that has to wrap on a small phone screen', 'x '.repeat(300)), ...ITEMS]);
    await signedIn(page);
    await page.goto('/news');
    await setPhone(page, viewport);
    await expect(page.locator('[data-part="news-item"]')).toHaveCount(4);
    await expectPhoneLayout(page);
  });
}
