// The welcome screen and the guided tour (owner, 12 Nov 2026: demo note #47 on /sell, and the
// to-design notes' "Guided site tour"). The first visit on a device lands on the welcome screen
// ("Welcome to" running diagonally down to the big logo, Take the tour / Skip and get started, the
// tab bar, and FAQ, Getting started, Support and Settings); the tour walks the screens one feature at
// a time with a highlight, an arrow and a card. Run at the owner's phone (443x794) and the boards'
// 390x844. DESIGNER-REVIEW: the layout and motion here are the lead's until design draws them.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { BOARD_SELL_LIVE_USD, BOARD_SELL_OFFERS, boardSellOffers } from '../src/fixtures/boards.js';
import { stubBrowseApi } from './browse-stub.js';
import { expectPhoneLayout } from './phone.js';

// A new device: nothing in storage (the config marks the welcome as seen for every other spec).
test.use({ storageState: { cookies: [], origins: [] } });

const SIZES = [
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

/** The owner's phone-sized rule: every control at least 44 px on each side. */
async function expect44(locator: Locator): Promise<void> {
  const n = await locator.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
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
const cardTitle = (page: Page) => card(page).locator('h2');

/** The highlight sits around the target (within its padding). */
async function expectSpotOn(page: Page, target: Locator): Promise<void> {
  const spot = page.locator('[data-part="tour-spot"]');
  await expect(spot).toBeVisible();
  await expect
    .poll(async () => {
      const s = (await spot.boundingBox())!;
      const t = (await target.boundingBox())!;
      return s.x <= t.x + 1 && s.y <= t.y + 1 && s.x + s.width >= t.x + t.width - 1 && s.y + s.height >= t.y + t.height - 1;
    })
    .toBe(true);
}

for (const size of SIZES) {
  test.describe(`at ${size.name}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await stubApi(page);
    });

    test('the first visit lands on the welcome screen: "Welcome to" runs diagonally down to the big logo, two choices, the tab bar and the links', async ({ page }) => {
      await page.goto('/sell');
      await expect(page).toHaveURL(/\/welcome$/);
      const screen = page.locator('[data-screen="welcome"]');
      await expect(screen).toBeVisible();

      const logo = screen.locator('[data-part="welcome-logo"] svg[role="img"][aria-label="X2F"]');
      await expect(logo).toBeVisible();
      const lb = (await logo.boundingBox())!;
      // Large and in the middle.
      expect(lb.width).toBeGreaterThanOrEqual(size.width * 0.5);
      expect(Math.abs(lb.x + lb.width / 2 - size.width / 2)).toBeLessThanOrEqual(2);

      // "Welcome to": above and to the left of the logo, turned clockwise (down to the right).
      const hello = screen.locator('[data-part="welcome-to"]');
      await expect(hello).toHaveText('Welcome to');
      await expect.poll(async () => hello.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
      const angle = await hello.evaluate((el) => {
        const m = new DOMMatrix(getComputedStyle(el).transform);
        return (Math.atan2(m.b, m.a) * 180) / Math.PI;
      });
      expect(angle).toBeGreaterThanOrEqual(15);
      expect(angle).toBeLessThanOrEqual(45);
      const hb = (await hello.boundingBox())!;
      expect(hb.x).toBeLessThan(lb.x + lb.width / 2);
      expect(hb.y + hb.height).toBeLessThanOrEqual(lb.y + 8);

      await expect(screen.getByRole('button', { name: 'Take the tour' })).toBeVisible();
      await expect(screen.getByRole('button', { name: 'Skip and get started' })).toBeVisible();

      // The tab bar, as though they had dived right in.
      await expect(page.locator('nav[aria-label="Main"].x2f-bottom-nav')).toBeVisible();

      const links = screen.locator('nav[aria-label="Help and settings"] a');
      await expect(links).toHaveText(['FAQ', 'Getting started', 'Support', 'Settings']);
      await expect(links.nth(2)).toHaveAttribute('href', '/feedback');
      await expect(links.nth(3)).toHaveAttribute('href', '/settings/security');

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
      // Still reachable on purpose.
      await page.goto('/welcome');
      await expect(page.locator('[data-screen="welcome"]')).toBeVisible();
    });

    test('Take the tour walks Buy and Sell feature by feature, then "Next screen" moves to the offers; Back and Skip work', async ({ page }) => {
      await page.goto('/sell');
      await page.getByRole('button', { name: 'Take the tour' }).click();
      await expect(page).toHaveURL(/\/sell$/);
      await expect(card(page)).toBeVisible();
      await expect(cardTitle(page)).toHaveText('Buy or sell');
      await expectSpotOn(page, page.locator('.x2f-segment'));
      await expect(page.locator('[data-part="tour-arrow"]')).toBeVisible();
      await expect(card(page).getByRole('button', { name: 'Back' })).toBeDisabled();
      await expect44(card(page).locator('button'));
      await noSidewaysScroll(page);

      await card(page).getByRole('button', { name: 'Next', exact: true }).click();
      await expect(cardTitle(page)).toHaveText('Your currency');
      await card(page).getByRole('button', { name: 'Next', exact: true }).click();
      await expect(cardTitle(page)).toHaveText('Pick a payment method');
      await expectSpotOn(page, page.locator('[data-part="method-pick"]'));
      await card(page).getByRole('button', { name: 'Back' }).click();
      await expect(cardTitle(page)).toHaveText('Your currency');

      // On to the last feature of the page: Next becomes "Next screen".
      for (let i = 0; i < 10; i++) {
        if ((await card(page).getByRole('button', { name: 'Next screen' }).count()) > 0) break;
        await card(page).getByRole('button', { name: 'Next', exact: true }).click();
      }
      await card(page).getByRole('button', { name: 'Next screen' }).click();
      await expect(page).toHaveURL(/\/sell\/ZELLE\?currency=USD$/);
      await expect(cardTitle(page)).toHaveText('The market price');
      await card(page).getByRole('button', { name: 'Next', exact: true }).click();
      await card(page).getByRole('button', { name: 'Next', exact: true }).click();
      await expect(cardTitle(page)).toHaveText('An offer card');
      await expectSpotOn(page, page.locator('article.x2f-offer').first());
      await noSidewaysScroll(page);
      await expectPhoneLayout(page);

      await card(page).locator('[data-part="tour-skip"]').click();
      await expect(card(page)).toHaveCount(0);
      await expect(page.locator('[data-part="tour"]')).toHaveCount(0);
      // The screen is usable again.
      await expect(page.locator('article.x2f-offer').first()).toBeVisible();
    });

    test('prefers-reduced-motion gives the calm version: no sliding, no bobbing arrow', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('/sell');
      const hello = page.locator('[data-part="welcome-to"]');
      await expect(hello).toBeVisible();
      expect(await hello.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
      await page.getByRole('button', { name: 'Take the tour' }).click();
      await expect(page.locator('[data-part="tour"]')).toHaveAttribute('data-motion', 'reduced');
      await expect(card(page)).toBeVisible();
      const arrow = page.locator('[data-part="tour-arrow"]');
      await expect(arrow).toBeVisible();
      expect(await arrow.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
      const spot = page.locator('[data-part="tour-spot"]');
      expect(await spot.evaluate((el) => getComputedStyle(el).transitionDuration.split(',').every((d) => parseFloat(d) === 0))).toBe(true);
      await card(page).getByRole('button', { name: 'Next', exact: true }).click();
      await expect(cardTitle(page)).toHaveText('Your currency');
    });
  });
}

test('Settings has the way back to the welcome screen and the tour', async ({ page }) => {
  await page.route('**/v1/account/me', (r) =>
    r.fulfill({ json: { displayName: 'viewer_1', kind: 'trader', level: 'full', termsCurrent: true, holdUntil: null, methods: ['password'], hasBackup: true, suggestions: [], member: null } }),
  );
  await page.route('**/v1/account/methods', (r) => r.fulfill({ json: [] }));
  await page.route('**/v1/account/sessions', (r) => r.fulfill({ json: [] }));
  await page.route('**/v1/account/alerts', (r) => r.fulfill({ json: [] }));
  await page.addInitScript(() => window.localStorage.setItem('x2f.welcome.seen', '1'));
  await page.goto('/settings/security');
  const link = page.locator('[data-part="welcome-link"]');
  await expect(link).toHaveAttribute('href', '/welcome');
  await link.click();
  await expect(page.locator('[data-screen="welcome"]')).toBeVisible();
});
