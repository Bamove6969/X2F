// Plan 5 Task 19 (Revision 2026-10-29b, owner): the moderators' Review disputes page in a real
// browser, from the queue's link to a decision. The staff API is stubbed with page.route in the
// shapes of apps/api/src/staff/reviewDisputes.ts (apps/api/test/reviewDisputes.test.ts checks them
// against the real routes). No Claude Design board yet (NEEDS_DESIGN): no parity; exactly one
// primary action, no horizontal scroll, and no CSP violation under STAFF_CSP instead.
import { expect, test, type Page, type Route } from '@playwright/test';

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const H = 3_600_000;
const ME = { tradeTag: 'nightowl_44', role: 'mod', nav: ['disputes', 'training', 'log'], sessionEndsAt: new Date(Date.now() + 8 * H).toISOString() };
const ITEMS = [
  {
    id: 'd1', openedAt: '2026-11-12T12:00:00.000Z', reason: 'Revenge for the dispute I opened.',
    review: { neutral: false, stars: 1, phrases: ['Slow', 'Went quiet'], tradeBadges: [], note: 'Rude and slow', method: 'Zelle', age: 'Nov 2026', reviewerRole: 'buyer' },
    tradeCode: null,
  },
];

async function stub(page: Page): Promise<unknown[]> {
  const decided: unknown[] = [];
  await page.route('**/staff/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/staff/v1/me') return json(ME)(route);
    if (path === '/staff/v1/review-disputes') return json({ items: decided.length > 0 ? [] : ITEMS, next: null })(route);
    if (path === '/staff/v1/review-disputes/d1/decide') {
      decided.push(route.request().postDataJSON());
      return json({ ok: true })(route);
    }
    return json({ error: 'not-found' }, 404)(route);
  });
  return decided;
}

test('from the queue to a decision: let it stand, with a reason; one primary; no CSP violation', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/content security policy/i.test(m.text())) violations.push(m.text());
  });
  const decided = await stub(page);
  await page.goto('/disputes');
  await page.locator('[data-part="review-disputes-link"]').click();
  await expect(page).toHaveURL('/disputes/reviews');
  const card = page.locator('[data-part="review-dispute"]');
  await expect(card).toHaveCount(1);
  await expect(card.locator('[data-part="dispute-reason"]')).toHaveText('Revenge for the dispute I opened.');
  await expect(card.locator('[data-part="trade-line"]')).toContainText('The trade was deleted');
  await expect(page.locator('[data-primary]')).toHaveCount(1);
  const save = page.getByRole('button', { name: 'Save decision' });
  await expect(save).toBeDisabled();
  await page.getByRole('radio', { name: /Let it stand/ }).check();
  await page.getByLabel(/^Why/).fill('The review matches what the trade shows.');
  await save.click();
  await expect(page.locator('[data-part="decision-saved"]')).toHaveText('Decision saved.');
  expect(decided).toEqual([{ outcome: 'stands', reason: 'The review matches what the trade shows.' }]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(violations).toEqual([]);
});
