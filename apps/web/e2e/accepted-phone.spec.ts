import { expect, test, type Page } from '@playwright/test';

// AcceptedSheet (Task 19) at phone sizes: "Mobile ready at launch" (spec, owner 2026-10-25) needs
// every screen tested at phone sizes. These are the three the trade screens use (Tasks 22-24):
// a small Android phone, the boards' 390x844 and a large phone.
const PHONES = [
  { width: 360, height: 640 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const;

const CODE = 'X2F-7KQ4-M9TD';
const ME = { kind: 'trader', level: 'full', termsCurrent: true };

/** The poster's own trade view (Task 6), the fields the sheet shows and confirms (the seller posted). */
const VIEW = {
  role: 'seller',
  poster: 'seller',
  amountAtomic: '1250000000000',
  grown: null,
  lockedRate: { currency: 'EUR', centsPerXmr: '15000' },
  maxFiatCents: '20000',
};

/**
 * A signed-in trader whose live events stream sends one `accepted` event; `wallets` is GET
 * /v1/wallets and the trade view is GET /v1/trades/:code (the sheet loads both before it offers a pick).
 */
async function signedIn(page: Page, wallets: unknown[]) {
  await page.route('**/v1/account/me', (r) => r.fulfill({ json: ME }));
  await page.route('**/v1/wallets', (r) => r.fulfill({ json: wallets }));
  await page.route(`**/v1/trades/${CODE}`, (r) => r.fulfill({ json: VIEW }));
  await page.route('**/v1/events', (r) =>
    r.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' },
      // A long retry, so the browser's own reconnect does not reopen the sheet mid-test.
      body: `retry: 600000\n\ndata: ${JSON.stringify({ type: 'accepted', code: CODE, by: 'mira.k' })}\n\n`,
    }),
  );
}

// Placeholder addresses (not real Monero addresses): the sheet keeps the full address for the trade
// room and shows only its last 6 characters.
const WALLETS = [
  { id: 'w1', app: 'Cake Wallet', label: 'Cake Wallet (main)', address: '4TESTADDRESSCAKE00009QxA', addressEnd: '009QxA', usable: true },
  { id: 'w2', app: 'Feather', label: 'Feather on my laptop, the long-named one', address: '4TESTADDRESSFEATHER04FtR', addressEnd: '004FtR', usable: true },
  { id: 'w3', app: 'Edge', label: 'Edge', address: '4TESTADDRESSEDGE00008WpN', addressEnd: '008WpN', usable: false },
];

/** Elements whose box pokes out past the viewport's left or right edge. */
function overflowing(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || el.closest('.x2f-visually-hidden')) continue;
      if (r.left < -0.5 || r.right > vw + 0.5) out.push(`${el.tagName.toLowerCase()}.${el.className} [${Math.round(r.left)}..${Math.round(r.right)}]`);
    }
    return out;
  });
}

/** Controls in the sheet under 44 px tall. A radio inside its label is exempt: the whole row is the target. */
function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('[role="dialog"] :is(button, a, label, input)')) {
      if (el.matches('.x2f-visually-hidden, label input[type="radio"]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 44 - 0.5) out.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim() || el.getAttribute('aria-label')}" ${Math.round(r.height)} px`);
    }
    return out;
  });
}

async function expectFitsPhone(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(await overflowing(page)).toEqual([]);
  expect(await smallTargets(page)).toEqual([]);
}

/** The sheet's whole box is inside the viewport (nothing cut off at the bottom either). */
async function expectSheetOnScreen(page: Page): Promise<void> {
  const box = await page.getByRole('dialog').boundingBox();
  const vp = page.viewportSize()!;
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(-0.5);
  expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width + 0.5);
  expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height + 0.5);
}

test.describe('AcceptedSheet at phone sizes', () => {
  test.use({ hasTouch: true, isMobile: true });

  for (const vp of PHONES) {
    test(`${vp.width}x${vp.height}: the wallet picker fits, every control is tappable, and the pick goes through`, async ({ page }) => {
      await page.setViewportSize(vp);
      await signedIn(page, WALLETS);
      let posted: unknown = null;
      await page.route(`**/v1/trades/${CODE}/wallet`, async (r) => {
        posted = r.request().postDataJSON();
        await r.fulfill({ status: 204, body: '' });
      });
      await page.goto('/sell');
      // The page behind the sheet has radios of its own (currency, sort), so look inside the sheet only.
      const sheet = page.getByRole('dialog', { name: 'mira.k accepted your offer' });
      await expect(sheet).toBeVisible();
      // Only usable wallets are offered, and none is picked for the poster (OD-11, X-2: no default
      // payout wallet; always ask), so the button waits for a pick.
      await expect(sheet.getByText(/^You sell .* XMR at /)).toBeVisible();
      await expect(sheet.getByRole('radio')).toHaveCount(2);
      await expect(sheet.getByRole('radio', { checked: true })).toHaveCount(0);
      const use = sheet.getByRole('button', { name: 'Use this wallet' });
      await expect(use).toBeDisabled();
      await expect(use).toBeInViewport();
      await expectFitsPhone(page);
      await expectSheetOnScreen(page);

      await sheet.getByText('Feather on my laptop, the long-named one').tap();
      await expect(sheet.getByRole('radio', { name: /Feather/ })).toBeChecked();
      await expect(use).toBeEnabled();
      await use.tap();
      await expect(page).toHaveURL(new RegExp(`/trade/${CODE}$`));
      expect(posted).toEqual({ walletId: 'w2' });
    });

    test(`${vp.width}x${vp.height}: with no usable wallet, Add a wallet fits and is tappable`, async ({ page }) => {
      await page.setViewportSize(vp);
      await signedIn(page, [WALLETS[2]]);
      await page.goto('/sell');
      const sheet = page.getByRole('dialog', { name: 'mira.k accepted your offer' });
      await expect(sheet).toBeVisible();
      const add = sheet.getByRole('link', { name: 'Add a wallet' });
      await expect(add).toBeInViewport();
      await expect(add).toHaveAttribute('href', `/wallets?add=1&returnTo=${encodeURIComponent(`/trade/${CODE}`)}`);
      await expectFitsPhone(page);
      await expectSheetOnScreen(page);
    });
  }
});
