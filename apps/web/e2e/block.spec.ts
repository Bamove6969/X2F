// Plan 3 Task 37: the trader-to-trader block in the browser. Block the poster from the quote, then
// unblock them from Settings → Blocked traders. The API is stubbed in the shapes of
// apps/api/src/nudge/routes.ts (POST, GET, DELETE /v1/account/blocks). There is no board yet
// (NEEDS_DESIGN_BLOCK, apps/web/test/block-tripwires.test.ts): the layout half of the phone rule
// runs, parity waits for the board.
import { expect, test, type Page } from '@playwright/test';
import { BOARD_BUY_QUOTE as B } from '../src/fixtures/quoteBoard.js';
import { PHONE_VIEWPORTS, expectPhoneLayout, setPhone } from './phone.js';

interface Seen {
  blocks: string[];
  posts: unknown[];
  deletes: string[];
}

async function stubApi(page: Page, o: { signedIn: boolean }): Promise<Seen> {
  const seen: Seen = { blocks: [], posts: [], deletes: [] };
  await page.route('**/v1/account/me', (r) =>
    o.signedIn
      ? r.fulfill({ json: { tradeTag: 'viewer_1', kind: 'trader', level: 'full', termsCurrent: true, methods: ['pgp'] } })
      : r.fulfill({ status: 401, json: { error: 'not-authenticated' } }),
  );
  await page.route('**/v1/events', (r) => r.fulfill({ status: 401, json: { error: 'not-authenticated' } }));
  await page.route('**/v1/methods?*', (r) =>
    r.fulfill({ json: { live: [{ id: B.method.id, name: B.method.name, group: 'Payment apps', giftCard: false, offers: 1, bestRate: B.marketCentsPerXmr }], all: [] } }),
  );
  await page.route('**/v1/price?*', (r) => {
    const currency = new URL(r.request().url()).searchParams.get('currency');
    return r.fulfill({ json: { currency, centsPerXmr: B.marketCentsPerXmr, exponent: 2, at: new Date().toISOString(), usdCentsPerXmr: B.marketCentsPerXmr } });
  });
  // The real API leaves out a blocked poster's offers (apps/api/test/blocks.test.ts).
  await page.route('**/v1/offers?*', (r) => r.fulfill({ json: seen.blocks.includes(B.offer.poster.tradeTag) ? [] : [B.offer] }));
  await page.route('**/v1/wallets', (r) => (o.signedIn ? r.fulfill({ json: [...B.wallets] }) : r.fulfill({ status: 401, json: { error: 'not-authenticated' } })));
  await page.route('**/v1/wallets/rule', (r) => r.fulfill({ json: { firstWallet: false, strongMethods: ['pgp'] } }));
  await page.route('**/v1/account/liens/preview?*', (r) => r.fulfill({ json: { lienRecoveryAtomic: '0', sellerLienRecoveryAtomic: '0' } }));
  await page.route('**/v1/account/blocks', (r) => {
    if (r.request().method() === 'POST') {
      const body = r.request().postDataJSON() as { tradeTag: string };
      seen.posts.push(body);
      seen.blocks = [body.tradeTag, ...seen.blocks.filter((n) => n !== body.tradeTag)];
      return r.fulfill({ status: 204 });
    }
    return r.fulfill({ json: seen.blocks.map((tradeTag) => ({ tradeTag, blockedAt: '2026-10-29T10:00:00.000Z' })) });
  });
  await page.route('**/v1/account/blocks/*', (r) => {
    const name = decodeURIComponent(new URL(r.request().url()).pathname.split('/').pop()!);
    seen.deletes.push(name);
    seen.blocks = seen.blocks.filter((n) => n !== name);
    return r.fulfill({ status: 204 });
  });
  return seen;
}

const BUY = `/buy/${B.method.id}/${B.offer.id}?currency=${B.currency}`;
const poster = B.offer.poster.tradeTag;

for (const viewport of PHONE_VIEWPORTS) {
  test.describe(`block on a ${viewport} phone`, () => {
    test.beforeEach(async ({ page }) => {
      await setPhone(page, viewport);
    });

    test('block the poster from the quote, then unblock them from Blocked traders', async ({ page }) => {
      const seen = await stubApi(page, { signedIn: true });
      await page.goto(`${BUY}&amount=${B.amount}`);
      const open = page.getByRole('button', { name: `Block ${poster}` });
      await expect(open).toBeVisible();
      await expectPhoneLayout(page);
      await open.click();
      // The Block board's confirm sheet (design review 64).
      await expect(page.getByRole('dialog', { name: `Block ${poster}?` })).toBeVisible();
      await expect(page.locator('#block-ask-h')).toBeFocused();
      await expect(page.locator('[data-part="block-ask"]')).toContainText("They won't be told you blocked them.");
      await expectPhoneLayout(page);
      // Still exactly one primary (Trade): the block buttons are never primary.
      expect(await page.locator('[data-primary]').count()).toBe(1);
      await page.locator('[data-part="block-confirm"]').click();
      await expect(page.locator('[data-part="block-done"]')).toContainText(`You blocked ${poster}.`);
      expect(seen.posts).toEqual([{ tradeTag: poster }]);
      // The offer is gone for them: Trade is off.
      await expect(page.locator('[data-primary]')).toBeDisabled();

      await expectPhoneLayout(page);
      await page.getByRole('link', { name: 'Blocked traders' }).click();
      await expect(page).toHaveURL('/settings/blocked');
      await expect(page.locator('[data-part="blocked-list"] [data-username]')).toHaveText([poster]);
      await expectPhoneLayout(page);
      const unblock = page.getByRole('button', { name: `Unblock ${poster}` });
      await unblock.focus();
      await unblock.click();
      await expect(page.locator('[data-part="blocked-said"]')).toHaveText(`Unblocked ${poster}.`);
      await expect(page.getByRole('button', { name: `Undo: block ${poster} again` })).toBeFocused();
      expect(seen.deletes).toEqual([poster]);
      await expectPhoneLayout(page);

      // Unblocked: the offer is back.
      await page.goto(`${BUY}&amount=${B.amount}`);
      await expect(page.getByRole('button', { name: `Block ${poster}` })).toBeVisible();
    });

    test('Settings, Security links to Blocked traders (review M3)', async ({ page }) => {
      await stubApi(page, { signedIn: true });
      for (const [path, body] of [
        ['**/v1/account/methods', [{ type: 'pgp', id: 'pgp-1', label: 'PGP key', createdAt: null, lastUsedAt: null }, { type: 'passkey', id: 'pk-1', label: 'Passkey', createdAt: null, lastUsedAt: null }]],
        ['**/v1/account/sessions', []],
        ['**/v1/account/alerts', []],
      ] as const) {
        await page.route(path, (r) => r.fulfill({ json: body }));
      }
      await page.goto('/settings/account');
      // Settings split into tabs (owner note #101): the row link itself carries data-part (SettingsRow).
      const blocked = page.locator('a[data-part="blocked-link"]');
      await expect(blocked).toHaveText('Blocked traders');
      await blocked.click();
      await expect(page).toHaveURL('/settings/blocked');
      await expect(page.locator('[data-part="blocked-empty"]')).toHaveText("You haven't blocked anyone.");
    });

    test('logged out: neither the quote nor Blocked traders opens; both go to the Landing board (the front door, owner 8 Nov 2026)', async ({ page }) => {
      const seen = await stubApi(page, { signedIn: false });
      await page.goto(`${BUY}&amount=${B.amount}`);
      await expect(page).toHaveURL(`/?returnTo=${encodeURIComponent(`${BUY}&amount=${B.amount}`)}`);
      await expect(page.getByRole('button', { name: /^Block / })).toHaveCount(0);
      await page.goto('/settings/blocked');
      await expect(page).toHaveURL('/?returnTo=%2Fsettings%2Fblocked');
      await expect(page.locator('[data-screen="blocked"]')).toHaveCount(0);
      await expectPhoneLayout(page);
      expect(seen.posts).toEqual([]);
    });
  });
}
