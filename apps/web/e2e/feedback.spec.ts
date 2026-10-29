// Plan 5 Task 21 (owner, 2026-10-29; spec 5.2): a refusal opens CantDoThat with the owner's
// feedback line; "feedback" opens the form; sending shows the owner's thank-you. No Claude Design
// boards exist yet for either (tripwire NEEDS_DESIGN_CANTDOTHAT), so there is no parity check here:
// only behaviour, copy and the page rules (one data-primary, no horizontal scroll).
// The API is stubbed with page.route in the shapes of Task 3 (methods, price), Plan 3 Task 4's
// guessed POST /v1/offers refusal (post-tripwires.test.ts) and this task's POST /v1/feedback/form.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page, type Route } from '@playwright/test';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
type CatalogEntry = { id: string; name: string; group: string; legalReview?: string };
const ROWS = (JSON.parse(readFileSync(`${ROOT}data/payment-methods.json`, 'utf8')) as { methods: CatalogEntry[] }).methods
  .filter((m) => m.legalReview === undefined)
  .map((m) => ({ id: m.id, name: m.name, group: m.group, giftCard: false, offers: 0, bestRate: null }));
const ME = { displayName: 'nightowl_44', kind: 'trader', level: 'full', termsCurrent: true };
const THANKS = 'Thank you! Each and every comment is appreciated and reviewed to help make this community a better place for us all.';

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function stub(page: Page): Promise<unknown[]> {
  const sent: unknown[] = [];
  await page.route('**/v1/account/me', json(ME));
  await page.route(/\/v1\/methods\?/, json({ live: [], all: ROWS }));
  await page.route('**/v1/offers?*', json([]));
  await page.route(/\/v1\/price\?/, json({ currency: 'USD', centsPerXmr: '32990', usdCentsPerXmr: '32990', exponent: 2, at: '2026-10-24T12:00:00.000Z' }));
  await page.route('**/v1/offers', (r) => (r.request().method() === 'POST' ? json({ error: 'trading-hold' }, 409)(r) : r.fallback()));
  await page.route('**/v1/feedback/form', (r) => {
    sent.push(r.request().postDataJSON());
    return json({}, 202)(r);
  });
  return sent;
}

async function noSideScroll(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test('a refusal opens CantDoThat; its feedback link leads to the form; an anonymous send gets the thank-you', async ({ page }) => {
  const sent = await stub(page);
  await page.goto('/post?method=ZELLE');
  await page.getByLabel('Smallest trade').fill('$50');
  await page.getByLabel('Largest trade').fill('$2,000');
  await page.getByRole('button', { name: 'Post offer' }).click();

  const popup = page.getByRole('dialog', { name: "This offer can't be posted" });
  await expect(popup).toBeVisible();
  await expect(popup.getByRole('alert')).toHaveText(/trading hold/);
  await expect(popup.locator('[data-part="feedback-line"]')).toHaveText('If you feel this feature can be improved please leave feedback');
  await expect(page.locator('[data-primary]')).toHaveCount(1);
  await noSideScroll(page);

  // OK closes it and the reason stays on the screen as a line.
  await popup.getByRole('button', { name: 'OK' }).click();
  await expect(popup).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveText(/trading hold/);

  // Again, then the link.
  await page.getByRole('button', { name: 'Post offer' }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'feedback' }).click();
  await expect(page).toHaveURL(/\/feedback\?from=trading-hold$/);
  await expect(page.getByRole('heading', { name: 'Feedback' })).toBeVisible();
  await expect(page.locator('[data-primary]')).toHaveCount(1);
  await noSideScroll(page);

  await page.getByRole('radio', { name: 'Complaint' }).check();
  await page.getByLabel('Your comment').fill('A hold should say how long it lasts.');
  await page.getByLabel('Send anonymously').check();
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('[data-part="feedback-thanks"]')).toHaveText(THANKS);
  expect(sent).toEqual([{ kind: 'complaint', text: 'A hold should say how long it lasts.', anonymous: true }]);

  // Done goes back to where the person came from.
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page).toHaveURL(/\/post/);
});

test('a named send carries the refusal code; the form works at desktop width too', async ({ page }) => {
  const sent = await stub(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/feedback');
  await expect(page.getByRole('radio', { name: 'Feedback' })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled();
  await page.getByLabel('Your comment').fill('Love it.');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('[data-part="feedback-thanks"]')).toHaveText(THANKS);
  expect(sent).toEqual([{ kind: 'feedback', text: 'Love it.', anonymous: false }]);
  await noSideScroll(page);
});
