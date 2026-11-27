// Plan 5 Task 19 (Revision 2026-10-29b, owner): disputing a review of me in a real browser. From my
// own profile's Dispute link to the dispute screen, the reason, the send, and "Under review" on the
// profile. The API is stubbed with page.route in the shapes of apps/api/src/reputation/profile.ts and
// apps/api/src/reviews/routes.ts (apps/api/test/reviewDisputes.test.ts checks them against the real
// routes). No Claude Design board for either screen yet: no parity; the phone layout rule
// (expectPhoneLayout) at PHONE_VIEWPORTS instead.
import { expect, test, type Page, type Route } from '@playwright/test';
import { PHONE_VIEWPORTS, expectPhoneLayout, setPhone } from './phone.js';
import { signedIn } from './session.js';

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const ID = '3f2b6a1e-5c4d-4e8f-9a0b-1c2d3e4f5a6b';

function profile(disputed: boolean) {
  return {
    tradeTag: 'viewer_1',
    self: true,
    memberSince: '2025-03',
    online: true,
    lastSeenAt: '2026-11-18T10:00:00.000Z',
    stats: { completedTrades: 12, positivePct: disputed ? 100 : 91, ratedReviews: disputed ? 10 : 11, reviewCount: 11, typicalMinutes: 6, disputes: { won: 0, lost: 0 } },
    badges: { featured: ['new'], more: [] },
    pgpProtected: false,
    recordPublic: false,
    tradedOverXmr: null,
    imported: [],
    reviews: [
      { neutral: false, stars: 1, phrases: ['Slow', 'Went quiet'], tradeBadges: [], note: 'Rude and slow', method: 'Zelle', age: 'Nov 2026', underReview: disputed, id: ID, disputable: !disputed },
      { neutral: false, stars: 5, phrases: ['Friendly'], tradeBadges: [], note: null, method: 'Zelle', age: 'Oct 2026', underReview: false, id: '9e8d7c6b-5a49-4382-a1b0-c9d8e7f6a5b4', disputable: true },
    ],
    offers: 0,
  };
}

async function stub(page: Page): Promise<{ sent: unknown[] }> {
  const sent: unknown[] = [];
  await signedIn(page, { tradeTag: 'viewer_1' });
  await page.route('**/v1/traders/viewer_1', (r) => json(profile(sent.length > 0))(r));
  await page.route(`**/v1/reviews/${ID}/dispute`, (r) => {
    sent.push(r.request().postDataJSON());
    return r.fulfill({ status: 201 });
  });
  return { sent };
}

test('Dispute on my profile: a required reason, one primary, then "Under review" on the profile', async ({ page }) => {
  const { sent } = await stub(page);
  await page.goto('/profile');
  const first = page.locator('[data-part="review"]').first();
  await expect(first.locator('[data-part="under-review"]')).toHaveCount(0);
  await first.getByRole('link', { name: 'Dispute' }).click();
  await expect(page).toHaveURL(`/profile/reviews/${ID}/dispute`);
  const main = page.locator('main[data-screen="dispute-review"]');
  await expect(main.getByRole('heading', { name: 'Dispute a review', level: 1 })).toBeVisible();
  await expect(main.locator('[data-part="disputed-review"]')).toContainText('Rude and slow');
  await expect(page.locator('[data-primary]')).toHaveCount(1);
  const send = main.getByRole('button', { name: 'Send to a moderator' });
  await expect(send).toBeDisabled();
  await main.getByLabel('Why should this review be looked at?').fill('It is revenge for the dispute I opened.');
  await send.click();
  await expect(main.locator('[data-part="dispute-sent"]')).toHaveText('Sent. The review shows "Under review" until a moderator decides.');
  expect(sent).toEqual([{ reason: 'It is revenge for the dispute I opened.' }]);
  await main.getByRole('link', { name: 'Back to my profile' }).click();
  await expect(page.locator('[data-part="review"]').first().locator('[data-part="under-review"]')).toHaveText('Under review');
  await expect(page.locator('[data-part="review"]').first().getByRole('link', { name: 'Dispute' })).toHaveCount(0);
});

for (const viewport of PHONE_VIEWPORTS) {
  test(`the dispute screen at ${viewport}: phone layout`, async ({ page }) => {
    await stub(page);
    await setPhone(page, viewport);
    await page.goto(`/profile/reviews/${ID}/dispute`);
    await expect(page.locator('main[data-screen="dispute-review"] textarea')).toBeVisible();
    await expectPhoneLayout(page);
  });
}
