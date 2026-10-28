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

/** A signed-in trader whose live events stream sends one `accepted` event; `wallets` is GET /v1/wallets. */
async function signedIn(page: Page, wallets: unknown[]) {
  await page.route('**/v1/account/me', (r) => r.fulfill({ json: ME }));
  await page.route('**/v1/wallets', (r) => r.fulfill({ json: wallets }));
  await page.route('**/v1/events', (r) =>
    r.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' },
      // A long retry, so the browser's own reconnect does not reopen the sheet mid-test.
      body: `retry: 600000\n\ndata: ${JSON.stringify({ type: 'accepted', code: CODE, by: 'mira.k' })}\n\n`,
    }),
  );
}

const WALLETS = [
  { id: 'w1', app: 'Cake Wallet', label: 'Cake Wallet (main)', addressEnd: '9QxA', usable: true },
  { id: 'w2', app: 'Feather', label: 'Feather on my laptop, the long-named one', addressEnd: '4FtR', usable: true },
  { id: 'w3', app: 'Edge', label: 'Edge', addressEnd: '8WpN', usable: false },
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
      await expect(page.getByRole('dialog', { name: 'mira.k accepted your offer' })).toBeVisible();
      // Only usable wallets are offered; the first is picked.
      await expect(page.getByRole('radio')).toHaveCount(2);
      await expect(page.getByRole('radio', { name: /Cake Wallet \(main\)/ })).toBeChecked();
      await expect(page.getByRole('button', { name: 'Use this wallet' })).toBeInViewport();
      await expectFitsPhone(page);
      await expectSheetOnScreen(page);

      await page.getByText('Feather on my laptop, the long-named one').tap();
      await expect(page.getByRole('radio', { name: /Feather/ })).toBeChecked();
      await page.getByRole('button', { name: 'Use this wallet' }).tap();
      await expect(page).toHaveURL(new RegExp(`/trade/${CODE}$`));
      expect(posted).toEqual({ walletId: 'w2' });
    });

    test(`${vp.width}x${vp.height}: with no usable wallet, Add a wallet fits and is tappable`, async ({ page }) => {
      await page.setViewportSize(vp);
      await signedIn(page, [WALLETS[2]]);
      await page.goto('/sell');
      await expect(page.getByRole('dialog', { name: 'mira.k accepted your offer' })).toBeVisible();
      const add = page.getByRole('link', { name: 'Add a wallet' });
      await expect(add).toBeInViewport();
      await expect(add).toHaveAttribute('href', `/wallets?add=1&returnTo=${encodeURIComponent(`/trade/${CODE}`)}`);
      await expectFitsPhone(page);
      await expectSheetOnScreen(page);
    });
  }
});
