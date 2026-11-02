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
  // Review N1: the message is the dialog's description, not also an alert.
  await expect(popup).toHaveAccessibleDescription(/trading hold/);
  await expect(popup.getByRole('alert')).toHaveCount(0);
  await expect(popup.locator('[data-part="feedback-line"]')).toHaveText('If you feel this feature can be improved please leave feedback');
  // Review X2 (board CantDoThat): no X close; OK is the popup's one filled primary.
  await expect(popup.getByRole('button', { name: 'Close' })).toHaveCount(0);
  await expect(popup.locator('[data-primary]')).toHaveCount(1);
  await expect(popup.locator('[data-primary]')).toHaveText('OK');
  await noSideScroll(page);

  // OK closes it and the reason stays on the screen as a line.
  await popup.getByRole('button', { name: 'OK' }).click();
  await expect(popup).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveText(/trading hold/);

  // Again, then the link.
  await page.getByRole('button', { name: 'Post offer' }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'feedback' }).click();
  await expect(page).toHaveURL(/\/feedback\?from=trading-hold$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Tell us what you think' })).toBeVisible();
  await expect(page.locator('[data-primary]')).toHaveCount(1);
  await noSideScroll(page);

  await page.getByRole('radio', { name: 'Complaint' }).check();
  await page.getByLabel('Your message').fill('A hold should say how long it lasts.');
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
  await page.goto('/feedback?from=too-many-offers');
  await expect(page.getByRole('radio', { name: 'Feedback' })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled();
  await page.getByLabel('Your message').fill('Love it.');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('[data-part="feedback-thanks"]')).toHaveText(THANKS);
  expect(sent).toEqual([{ kind: 'feedback', text: 'Love it.', anonymous: false, from: 'too-many-offers' }]);
  // Focus moves to the thank-you heading (review M7).
  await expect(page.locator('[data-part="feedback-thanks-heading"]')).toBeFocused();
  await noSideScroll(page);
});

test('signed out: told before typing, and the draft is kept through the log-in round trip', async ({ page }) => {
  await stub(page);
  await page.unroute('**/v1/account/me');
  let signedIn = false;
  await page.route('**/v1/account/me', (r) => (signedIn ? json(ME)(r) : json({ error: 'not-authenticated' }, 401)(r)));
  await page.goto('/feedback?from=trading-hold');
  await expect(page.locator('[data-part="feedback-login-first"]')).toContainText('Log in to send feedback');
  await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled();
  await page.getByLabel('Your message').fill('Hold rules are unclear.');
  signedIn = true;
  // The person logs in elsewhere in this tab and comes back: the words are still there.
  await page.goto('/feedback?from=trading-hold');
  await expect(page.getByLabel('Your message')).toHaveValue('Hold rules are unclear.');
  await expect(page.locator('[data-part="feedback-login-first"]')).toHaveCount(0);
});

// C11 review M1/M2: a real touch drag (CDP touch events, so the browser decides pan vs pointer) down
// from the grab handle closes the sheet; a short one does not. On the wide dialog the handle is
// hidden and a mouse drag over the message (selecting it) never closes it.
test.describe('CantDoThat: swipe down from the handle on a touch screen', () => {
  test.use({ hasTouch: true, isMobile: true });

  async function openPopup(page: Page) {
    await stub(page);
    await page.goto('/post?method=ZELLE');
    await page.getByLabel('Smallest trade').fill('$50');
    await page.getByLabel('Largest trade').fill('$2,000');
    await page.getByRole('button', { name: 'Post offer' }).click();
    const popup = page.getByRole('dialog', { name: "This offer can't be posted" });
    await expect(popup).toBeVisible();
    return popup;
  }

  async function touchDrag(page: Page, x: number, y: number, dy: number) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + (dy * i) / 6 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  }

  test('a 150 px swipe closes it; a 20 px one does not', async ({ page }) => {
    const popup = await openPopup(page);
    const handle = popup.locator('[data-part="sheet-handle"]');
    const box = (await handle.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    await touchDrag(page, box.x + box.width / 2, box.y + box.height / 2, 20);
    await expect(popup).toBeVisible();
    await touchDrag(page, box.x + box.width / 2, box.y + box.height / 2, 150);
    await expect(popup).toHaveCount(0);
  });
});

test('CantDoThat on the wide dialog: no handle, and a mouse drag over the message does not close it', async ({ page }) => {
  await stub(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/post?method=ZELLE');
  await page.getByLabel('Smallest trade').fill('$50');
  await page.getByLabel('Largest trade').fill('$2,000');
  await page.getByRole('button', { name: 'Post offer' }).click();
  const popup = page.getByRole('dialog', { name: "This offer can't be posted" });
  await expect(popup).toBeVisible();
  await expect(popup.locator('[data-part="sheet-handle"]')).toBeHidden();
  const msg = (await popup.locator('[data-part="cant-do-message"]').boundingBox())!;
  await page.mouse.move(msg.x + 4, msg.y + 2);
  await page.mouse.down();
  await page.mouse.move(msg.x + 40, msg.y + 160, { steps: 8 });
  await page.mouse.up();
  await expect(popup).toBeVisible();
});
