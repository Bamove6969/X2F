import { expect, test, type Page, type Route } from '@playwright/test';
import { signedIn } from './session.js';

// Plan 4 Task 27 (Revision 2026-10-29b; D-020, owner G39) and the bans review S1: a site-banned
// person who logs in lands on the ban notice, with the exact end (or Permanent), the moderator
// links, and a link to each trade they may still finish; that link opens the trade, and the room
// stays open. The API is stubbed in the shapes of apps/api/src/staff/bans.ts (`GET /v1/account/ban`)
// and of the site-ban gate (banState.ts: 403 `banned` with the kind, reason and end); the API side
// is apps/api/test/staff/bans.test.ts. No board yet (D-020): no parity check, only behaviour and the
// page rules.

const CODE = 'K7M2-9QXA-4FTR-8WPN';
const UNTIL = '2026-11-19T12:00:00.000Z';
const CONTACTS = { moderatorUrl: null, matrixUrl: 'https://matrix.to/#/#x2f-mods:matrix.org', telegramUrl: null };
const OFF = { banner: null, tradingPaused: false, maintenance: null, plannedMaintenance: null };

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', headers: { 'cache-control': 'no-store' }, body: JSON.stringify(body) });

/**
 * As the gate answers a site-banned account with an open trade: that trade's own routes pass (here
 * the handler's 404, the room's stub), and every other trader route is 403 `banned`.
 */
async function siteBanned(page: Page, notice: unknown, refusal: unknown): Promise<string[]> {
  const refused: string[] = [];
  // Registered first, so the specific routes below win (Playwright tries the newest route first).
  await page.route('**/v1/**', (r) => {
    refused.push(new URL(r.request().url()).pathname);
    return json({ error: 'banned', ...(refusal as object) }, 403)(r);
  });
  await page.route('**/v1/site', json(OFF));
  await page.route(new RegExp(`/v1/(trades/${CODE}(/.*)?|events|chats/.*)$`), json({ error: 'not-found' }, 404));
  await page.route('**/v1/account/ban', json(notice));
  await signedIn(page);
  return refused;
}

test('a site ban with an open trade: the notice says the exact end, links a moderator and the trade; the trade opens and stays open', async ({ page }) => {
  const refused = await siteBanned(
    page,
    { bans: [{ kind: 'site', reasonCode: 'abuse', until: UNTIL, permanent: false }], unfinished: [{ code: CODE, dispute: false }], contacts: CONTACTS },
    { kind: 'site', reasonCode: 'abuse', until: UNTIL },
  );
  await page.goto('/sell');
  await expect(page).toHaveURL(/\/account\/banned$/);
  const notice = page.locator('[data-screen="account-banned"]');
  await expect(notice.locator('h1')).toHaveText('Your account has been banned');
  await expect(notice.locator('[data-part="ban-end"]')).toHaveText('Your account will be fully working again on 19 Nov 2026, 12:00 UTC.');
  await expect(notice.locator('a[data-part="ban-contact"]')).toHaveAttribute('href', CONTACTS.matrixUrl);
  expect(refused.length).toBeGreaterThan(0);
  const trade = notice.locator('[data-part="ban-unfinished"] a');
  await expect(trade).toHaveText(`Trade ${CODE}`);
  await trade.click();
  await expect(page).toHaveURL(new RegExp(`/trade/${CODE}$`));
  // The room's own calls pass the gate, so nothing sends the person back to the notice.
  await page.waitForTimeout(500);
  await expect(page).toHaveURL(new RegExp(`/trade/${CODE}$`));
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test('a lifetime site ban with nothing unfinished: Permanent, and no trade links', async ({ page }) => {
  await siteBanned(page, { bans: [{ kind: 'site', reasonCode: 'trade-problems', until: null, permanent: true }], unfinished: [], contacts: CONTACTS }, {
    kind: 'site', reasonCode: 'trade-problems', until: null,
  });
  await page.goto('/sell');
  await expect(page).toHaveURL(/\/account\/banned$/);
  const notice = page.locator('[data-screen="account-banned"]');
  await expect(notice.locator('[data-part="ban-end"]')).toHaveText('Permanent');
  await expect(notice.locator('[data-part="ban-unfinished"]')).toHaveCount(0);
  await expect(notice.locator('[data-primary]')).toHaveCount(0);
});

test('once the ban has ended (no bans in force) the notice sends the person home', async ({ page }) => {
  await page.route('**/v1/site', json(OFF));
  await page.route('**/v1/account/ban', json({ bans: [], unfinished: [], contacts: CONTACTS }));
  await signedIn(page);
  await page.goto('/account/banned');
  await expect(page).not.toHaveURL(/\/account\/banned$/);
});
