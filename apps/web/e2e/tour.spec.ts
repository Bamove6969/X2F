// The welcome screen and the first-trade tour (owner, 12 Nov 2026, demo note #47; design,
// wip/design-brief b3b8315b: tour-stops.md §1-2 and tour-motion.md §2-7). The first visit on a
// device lands on the welcome screen (the logo's letters spring in, Take the tour / Skip and get
// started, the links on tall screens, the tab bar); the tour follows one pretend sell trade on
// example screens, stop by stop, with the scrim's hole and ring, the arrow and the card.
// Run at the owner's phone (443x794) and the boards' 390x844, plus the iPhone Duo folded
// (466x678) and unfolded in landscape (890x626). DESIGNER-REVIEW.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { BOARD_SELL_LIVE_USD, BOARD_SELL_OFFERS, boardSellOffers } from '../src/fixtures/boards.js';
import { stubBrowseApi } from './browse-stub.js';
import { expectPhoneLayout } from './phone.js';

// A new device: nothing in storage (the config marks the welcome as seen for every other spec).
test.use({ storageState: { cookies: [], origins: [] } });

const PHONES = [
  { name: '443x794', width: 443, height: 794 },
  { name: '390x844', width: 390, height: 844 },
] as const;

async function stubApi(page: Page): Promise<void> {
  await stubBrowseApi(page, {
    live: { USD: BOARD_SELL_LIVE_USD },
    offers: (currency) => (currency === 'USD' ? boardSellOffers() : []),
    market: { USD: BOARD_SELL_OFFERS.marketCentsPerXmr },
  });
}

/** The owner's phone rule: every control at least 44 px on each side. */
async function expect44(locator: Locator): Promise<void> {
  const n = await locator.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    if (!(await locator.nth(i).isVisible())) continue;
    const box = (await locator.nth(i).boundingBox())!;
    const label = (await locator.nth(i).textContent())?.trim();
    expect(box.height, label).toBeGreaterThanOrEqual(44);
    expect(box.width, label).toBeGreaterThanOrEqual(44);
  }
}

async function noSidewaysScroll(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

const card = (page: Page) => page.locator('[data-part="tour-card"]');
const count = (page: Page) => card(page).locator('[data-part="tour-count"]');
const body = (page: Page) => card(page).locator('[data-part="tour-body"]');
const stage = (page: Page) => page.locator('[data-part="tour-stage"]');
const next = (page: Page) => card(page).locator('[data-part="tour-next"]');

/** The ring sits round the element (padded 6 px), and the card does not cover it. */
async function expectRingOn(page: Page, target: Locator): Promise<void> {
  const ring = page.locator('[data-part="tour-ring"]');
  await expect(ring).toBeVisible();
  await expect
    .poll(async () => {
      const s = (await ring.boundingBox())!;
      const t = (await target.boundingBox())!;
      const c = (await card(page).boundingBox())!;
      const around = s.x <= t.x + 1 && s.y <= t.y + 1 && s.x + s.width >= t.x + t.width - 1 && s.y + s.height >= t.y + t.height - 1;
      const clear = c.y >= s.y + s.height || c.y + c.height <= s.y || c.x >= s.x + s.width || c.x + c.width <= s.x;
      return around && clear;
    })
    .toBe(true);
}

async function goTo(page: Page, n: number): Promise<void> {
  for (let i = Number((await count(page).textContent())!.split(' ')[0]); i < n; i++) {
    await next(page).click();
    await expect(count(page)).toHaveText(`${i + 1} of 17`);
  }
}

for (const size of PHONES) {
  test.describe(`at ${size.name}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await stubApi(page);
    });

    test('the first visit lands on the welcome screen: the letter intro, the heading, two choices, the links and the tab bar', async ({ page }) => {
      await page.goto('/sell');
      await expect(page).toHaveURL(/\/welcome$/);
      const screen = page.locator('[data-screen="welcome"]');
      const mark = screen.locator('[data-part="welcome-mark"][role="img"][aria-label="X2F"]');
      await expect(mark).toBeVisible();
      // Four layers in one box: X, 2, F and the dot, spring-animated in turn.
      for (const l of ['x', '2', 'f', 'dot']) await expect(mark.locator(`[data-part="letter-${l}"]`)).toBeAttached();
      expect(await mark.locator('[data-part="letter-x"]').evaluate((el) => el.getAnimations().length)).toBeGreaterThan(0);
      const mb = (await mark.boundingBox())!;
      expect(Math.abs(mb.x + mb.width / 2 - size.width / 2)).toBeLessThanOrEqual(2);
      expect(mb.width).toBeLessThanOrEqual(280);
      await expect(screen.getByRole('heading', { level: 1 })).toHaveText('Welcome to X2F');
      await expect(screen.getByText('Swap Monero for cash, bank transfers or gift cards, person to person.')).toBeVisible();
      const tourBtn = screen.getByRole('button', { name: 'Take the tour' });
      const skipBtn = screen.getByRole('button', { name: 'Skip and get started' });
      await expect(tourBtn).toBeVisible();
      expect((await tourBtn.boundingBox())!.height).toBeGreaterThanOrEqual(56);
      expect((await skipBtn.boundingBox())!.height).toBeGreaterThanOrEqual(52);
      // Both phones are 760+ tall, so the links show.
      const links = screen.locator('nav[aria-label="Help and settings"] a');
      await expect(links).toHaveText(['FAQ', 'Getting started', 'Support', 'Settings']);
      // One help page for every link (review 12 Nov, L3: /help/:topic, as /login's help links).
      for (const [i, to] of ['/help/faq', '/help/getting-started', '/help/support', '/help/settings'].entries()) {
        await expect(links.nth(i)).toHaveAttribute('href', to);
      }
      // The tab bar, with no tab current.
      await expect(page.locator('nav[aria-label="Main"].x2f-bottom-nav')).toBeVisible();
      await expect(page.locator('nav[aria-label="Main"] [aria-current="page"]')).toHaveCount(0);
      await expect(links.last()).toHaveCSS('opacity', '1');
      await expect44(screen.locator('button, a'));
      await noSidewaysScroll(page);
      await expectPhoneLayout(page);
    });

    test('Skip and get started goes to /sell, and the welcome screen is not shown again on this device', async ({ page }) => {
      await page.goto('/sell');
      await page.getByRole('button', { name: 'Skip and get started' }).click();
      await expect(page).toHaveURL(/\/sell$/);
      await expect(page.locator('.x2f-browse')).toBeVisible();
      await expect(card(page)).toHaveCount(0);
      await page.goto('/sell');
      await expect(page.locator('.x2f-browse')).toBeVisible();
      await expect(page).toHaveURL(/\/sell$/);
      await page.goto('/welcome');
      await expect(page.locator('[data-screen="welcome"]')).toBeVisible();
    });

    test('Take the tour: stop by stop on the example screens, Back, keys, a centred stop, the next screen, then Skip and Restart', async ({ page }) => {
      await page.goto('/sell');
      await page.getByRole('button', { name: 'Take the tour' }).click();
      await expect(card(page)).toBeVisible();
      await expect(count(page)).toHaveText('1 of 17');
      await expect(body(page)).toHaveText("First, decide why you're here: to buy Monero or to sell it.");
      await expect(card(page).locator('h2')).toHaveCount(0);
      await expect(card(page).getByRole('img', { name: 'Page 1 of 6, Find a trade' })).toBeAttached();
      await expectRingOn(page, stage(page).locator('[data-tour="buy"]'));
      await expect(page.locator('[data-part="tour-arrow"]')).toBeVisible();
      await expect(card(page).locator('[data-part="tour-back"]')).toBeDisabled();
      await expect44(card(page).locator('button'));
      await noSidewaysScroll(page);
      // Review 12 Nov, T2: the app behind is inert, and Tab and Shift+Tab never leave the card.
      await expect(page.locator('#root')).toHaveAttribute('inert', '');
      for (const k of ['Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']) {
        await page.keyboard.press(k);
        expect(await card(page).evaluate((c) => c.contains(document.activeElement) && document.activeElement !== c), k).toBe(true);
      }

      // Stop 2: Sell is tapped and fills; the heading changes.
      await next(page).click();
      await expect(body(page)).toHaveText("Let's pretend we're selling. Tap Sell.");
      await expectRingOn(page, stage(page).locator('[data-tour="sell"]'));
      await expect(stage(page).locator('[data-tour="sell"]')).toHaveAttribute('aria-selected', 'true');
      await expect(stage(page).getByRole('heading', { level: 1 })).toHaveText('How do you want to be paid?');

      // Keys: → Next, ← Back.
      await page.keyboard.press('ArrowRight');
      await expect(count(page)).toHaveText('3 of 17');
      await page.keyboard.press('ArrowLeft');
      await expect(count(page)).toHaveText('2 of 17');
      await card(page).locator('[data-part="tour-back"]').click();
      await expect(count(page)).toHaveText('1 of 17');

      // Stop 5: a centred card with the eye-off tile, no ring.
      await goTo(page, 5);
      await expect(card(page)).toHaveAttribute('data-placement', 'center');
      await expect(card(page).locator('[data-icon="eye-off"]')).toBeVisible();
      await expect(page.locator('[data-part="tour-ring"]')).toHaveCount(0);

      // Stop 6: the Offers screen pushes in, marked Example.
      await next(page).click();
      await expect(count(page)).toHaveText('6 of 17');
      await expect(stage(page).getByRole('heading', { level: 1 })).toHaveText('Sell XMR via Cash App');
      await expect(stage(page).locator('[data-part="example"]')).toBeVisible();
      await expect(card(page).getByRole('img', { name: 'Page 2 of 6, Offers' })).toBeAttached();
      await expectRingOn(page, stage(page).locator('[data-tour="ohead"]'));
      await next(page).click();
      await expect(body(page)).toHaveText("Each card tells you about the trader: the badges they've earned...");
      await expectRingOn(page, stage(page).locator('[data-tour="badges"]'));
      await noSidewaysScroll(page);
      await expectPhoneLayout(page);

      await card(page).locator('[data-part="tour-skip"]').click();
      await expect(card(page)).toHaveCount(0);
      const closed = page.locator('[data-part="tour-closed"]');
      await expect(closed).toContainText('Tour closed. Take it again any time from Settings, under Help.');
      await closed.getByRole('button', { name: 'Restart' }).click();
      await expect(count(page)).toHaveText('1 of 17');
      await page.keyboard.press('Escape');
      await expect(card(page)).toHaveCount(0);
      // The welcome screen is usable again.
      await expect(page.locator('#root')).not.toHaveAttribute('inert', '');
      await expect(page.getByRole('button', { name: 'Take the tour' })).toBeVisible();
    });

    test('the whole trade plays out: typing, the request, funding, release, then Done goes to Find a trade', async ({ page }) => {
      await page.goto('/sell');
      await page.getByRole('button', { name: 'Take the tour' }).click();
      await goTo(page, 11);
      await expect(stage(page).locator('[data-tour="receive"]')).toContainText('$200.00');
      await expectRingOn(page, stage(page).locator('[data-tour="receive"]'));
      await goTo(page, 12);
      await expect(stage(page).locator('[data-tour="request-button"]')).toHaveText('Trade started');
      await goTo(page, 14);
      await expect(stage(page).locator('[data-tour="status"]')).toContainText('Locked in escrow');
      await goTo(page, 15);
      await expect(stage(page).locator('[data-tour="tick"]')).toHaveAttribute('data-on', 'true');
      await goTo(page, 16);
      await expect(stage(page).locator('[data-tour="release"]')).toContainText('Released 0.594354 XMR to example_seller');
      await goTo(page, 17);
      await expect(next(page)).toHaveText('Done');
      await expect(card(page).locator('[data-icon="tick"]')).toBeVisible();
      await next(page).click();
      await expect(card(page)).toHaveCount(0);
      await expect(page).toHaveURL(/\/sell$/);
      await expect(page.locator('.x2f-browse')).toBeVisible();
    });

    test('prefers-reduced-motion gives the calm version: the static logo, no loop, no breathing ring, the arrow already drawn', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('/sell');
      const x = page.locator('[data-part="letter-x"]');
      await expect(x).toBeAttached();
      expect(await x.evaluate((el) => el.getAnimations().length)).toBe(0);
      await page.getByRole('button', { name: 'Take the tour' }).click();
      await expect(page.locator('[data-part="tour"]')).toHaveAttribute('data-motion', 'reduced');
      await expect(card(page)).toBeVisible();
      await expect(page.locator('[data-part="tour-pulse"]')).toBeHidden();
      const line = page.locator('[data-part="tour-arrow"] .x2f-tour__arrow-line');
      await expect(line).toBeAttached();
      expect(await line.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
      await next(page).click();
      await expect(count(page)).toHaveText('2 of 17');
    });
  });
}

test('folded iPhone Duo (466x678): the links hide, both choices fit with no scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 466, height: 678 });
  await stubApi(page);
  await page.goto('/sell');
  await expect(page.locator('[data-screen="welcome"]')).toBeVisible();
  await expect(page.locator('nav[aria-label="Help and settings"]')).toBeHidden();
  const skip = (await page.getByRole('button', { name: 'Skip and get started' }).boundingBox())!;
  const nav = (await page.locator('nav[aria-label="Main"]').boundingBox())!;
  expect(skip.y + skip.height).toBeLessThanOrEqual(nav.y);
  await noSidewaysScroll(page);
});

test('unfolded landscape (890x626): the card sits beside the highlight, the arrow running sideways', async ({ page }) => {
  await page.setViewportSize({ width: 890, height: 626 });
  await stubApi(page);
  await page.goto('/welcome');
  await page.getByRole('button', { name: 'Take the tour' }).click();
  await expect(count(page)).toHaveText('1 of 17');
  await expect(card(page)).toHaveAttribute('data-placement', 'side');
  await expect(stage(page)).toHaveAttribute('data-side', 'true');
  await expect
    .poll(async () => {
      const ring = (await page.locator('[data-part="tour-ring"]').boundingBox())!;
      const c = (await card(page).boundingBox())!;
      return c.x >= ring.x + ring.width;
    })
    .toBe(true);
  await noSidewaysScroll(page);
});

test('Settings, Help: "Take the tour again", reading "Carry on the tour" once left half done; and the welcome screen', async ({ page }) => {
  await page.route('**/v1/account/me', (r) =>
    r.fulfill({ json: { displayName: 'viewer_1', kind: 'trader', level: 'full', termsCurrent: true, holdUntil: null, methods: ['password'], hasBackup: true, suggestions: [], member: null } }),
  );
  await page.route('**/v1/account/methods', (r) => r.fulfill({ json: [] }));
  await page.route('**/v1/account/sessions', (r) => r.fulfill({ json: [] }));
  await page.route('**/v1/account/alerts', (r) => r.fulfill({ json: [] }));
  await page.addInitScript(() => window.localStorage.setItem('x2f.welcome.seen', '1'));
  await page.goto('/settings/security');
  const replay = page.locator('[data-part="tour-replay"]');
  await expect(replay).toContainText('Take the tour again');
  await expect(replay).toContainText('A quick walk through each screen');
  await replay.click();
  await expect(count(page)).toHaveText('1 of 17');
  await next(page).click();
  await next(page).click();
  await expect(count(page)).toHaveText('3 of 17');
  await card(page).locator('[data-part="tour-skip"]').click();
  await page.reload();
  await expect(replay).toContainText('Carry on the tour');
  await replay.click();
  await expect(count(page)).toHaveText('3 of 17');
  await page.keyboard.press('Escape');
  const link = page.locator('[data-part="welcome-link"]');
  await expect(link).toHaveAttribute('href', '/welcome');
  await link.click();
  await expect(page.locator('[data-screen="welcome"]')).toBeVisible();
});
