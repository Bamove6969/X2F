// Plan 5 Task 12: the Profile tab opens my own profile (it used to fall through to /), and from it
// my badge settings. The API is stubbed with page.route in the shapes of
// apps/api/src/reputation/{profile,badgeRoutes}.ts, which apps/api/test/profile.test.ts checks
// against the real routes. No board parity yet (the Profile board's cancel tile is not drawn by the
// app, owner T-017), so the phone layout rule runs instead.
import { expect, test, type Page, type Route } from '@playwright/test';
import { PHONE_VIEWPORTS, expectPhoneLayout, setPhone } from './phone.js';
import { signedIn } from './session.js';

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const profile = (name: string, self: boolean) => ({
  tradeTag: name,
  self,
  memberSince: '2025-03',
  online: true,
  lastSeenAt: '2026-11-18T10:00:00.000Z',
  stats: { completedTrades: 212, positivePct: 99, ratedReviews: 198, reviewCount: 205, typicalMinutes: 6, disputes: { won: 0, lost: 0 } },
  badges: { featured: ['trusted', 'fast'], more: ['veteran-1', 'trades-100'] },
  pgpProtected: false,
  recordPublic: false,
  tradedOverXmr: null,
  imported: [],
  reviews: [{ neutral: false, stars: 5, phrases: ['Fast payment'], tradeBadges: [], note: 'Smooth.', method: 'Zelle', age: 'Nov 2026', underReview: false }],
  offers: 2,
});

async function stub(page: Page): Promise<void> {
  await signedIn(page, { tradeTag: 'viewer_1' });
  await page.route('**/v1/traders/viewer_1', json(profile('viewer_1', true)));
  await page.route('**/v1/traders/mira.k', json(profile('mira.k', false)));
  await page.route('**/v1/account/badges', json({
    earned: [{ id: 'trusted', level: 'featured' }, { id: 'fast', level: 'featured' }, { id: 'veteran-1', level: 'hover' }, { id: 'trades-100', level: 'hover' }],
    featured: ['trusted', 'fast'],
    more: ['veteran-1', 'trades-100'],
    nextMilestones: [{ label: '500 trades', have: 212, need: 500 }],
  }));
}

test('the Profile tab opens my own profile, and Choose badges opens my badge settings', async ({ page }) => {
  await stub(page);
  await page.goto('/buy');
  const nav = page.getByRole('navigation', { name: 'Main' });
  await nav.getByRole('link', { name: 'Profile' }).click();
  await expect(page).toHaveURL('/profile');
  await expect(nav.getByRole('link', { name: 'Profile' })).toHaveAttribute('aria-current', 'page');
  const main = page.locator('main[data-screen="profile"]');
  await expect(main.getByRole('heading', { name: 'Trader profile', level: 1 })).toBeVisible();
  await expect(main.locator('[data-username]').first()).toHaveText('viewer_1');
  await expect(main.locator('[data-part="completed"]')).toContainText('212');
  await expect(main.locator('[data-part="disputes"]')).toHaveText('Disputes: none');
  await expect(main).not.toContainText(/cancel/i);
  await expect(main.locator('[data-part="my-offers"]')).toHaveText('My offers (2)');

  await main.locator('[data-part="choose-badges"]').click();
  await expect(page).toHaveURL('/settings/badges');
  await expect(page.getByRole('heading', { name: 'Your badges', level: 1 })).toBeVisible();
  await expect(page.locator('[data-part="featured-count"]')).toHaveText('Featured 2 of 2');
  await expect(page.locator('[data-part="milestones"]')).toContainText('212 / 500');
});

test("another trader's profile opens at /u/:name with Block and no settings links", async ({ page }) => {
  await stub(page);
  await page.goto('/u/mira.k');
  const main = page.locator('main[data-screen="profile"]');
  await expect(main.locator('[data-username]').first()).toHaveText('mira.k');
  await expect(main.getByRole('button', { name: 'Block mira.k' })).toBeVisible();
  await expect(main.locator('[data-part="choose-badges"]')).toHaveCount(0);
  await expect(main.locator('[data-part="offers-count"]')).toHaveText('Offers (2)');
});

for (const vp of PHONE_VIEWPORTS) {
  test(`the profile keeps the phone layout at ${vp}`, async ({ page }) => {
    await stub(page);
    await setPhone(page, vp);
    await page.goto('/profile');
    await expect(page.locator('main[data-screen="profile"] [data-part="stats"]')).toBeVisible();
    await expectPhoneLayout(page);
  });
}
