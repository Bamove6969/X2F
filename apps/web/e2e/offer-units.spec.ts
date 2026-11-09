// Owner, 8 Nov 2026 ("Offer amounts in XMR or fiat"), on the offers list: each card shows the range
// in XMR and in fiat (the poster's own row exact, the other "≈"), and "Display amounts including
// vendor markup" (off by default, remembered on this device) moves the converted row from the
// market price to the offer's own price.
import { expect, test, type Page } from '@playwright/test';
import { BOARD_BUY_LIVE_USD, boardBuyOffers } from '../src/fixtures/boards.js';
import { stubBrowseApi } from './browse-stub.js';

const XMR = 1_000_000_000_000n;

function stub(page: Page) {
  const [satoshi, kettle] = boardBuyOffers();
  // kettle.moss sets 1 - 5 XMR at +2.5% on a $330.00 market ($338.25); satoshi_ghost keeps the board's $50 - $1,500.
  const xmrSet = {
    ...kettle!, rate: '33825', pricing: { mode: 'market', marginBps: 250 },
    amountUnit: 'xmr', minAtomic: (1n * XMR).toString(), maxAtomic: (5n * XMR).toString(), minFiatCents: '33825', maxFiatCents: '169125',
  };
  return stubBrowseApi(page, { live: { USD: BOARD_BUY_LIVE_USD }, offers: (c) => (c === 'USD' ? [satoshi, xmrSet] : []), market: { USD: '33000' } });
}

const card = (page: Page, name: string) => page.locator('article', { has: page.locator('[data-username]', { hasText: name }) });

test('each card shows the range in XMR and in fiat; the markup box recalculates and is remembered', async ({ page }) => {
  await stub(page);
  await page.goto('/buy/ZELLE');
  const box = page.getByRole('checkbox', { name: 'Display amounts including vendor markup' });
  await expect(box).not.toBeChecked();
  await expect(page.getByText('Converted at the market rate, before markup.')).toBeVisible();
  const kettle = card(page, 'kettle.moss');
  await expect(kettle.locator('[data-part="range-xmr"]')).toHaveText('1.000000 – 5.000000 XMR');
  await expect(kettle.locator('[data-part="range-fiat"]')).toHaveText('≈ $330 – $1,650 USD');
  // The markup stays bottom-left.
  await expect(kettle.locator('[data-part="markup"] .x2f-offer__margin')).toHaveText('+2.5%');
  await expect(kettle.locator('[data-part="markup"]')).toContainText('Vendor markup');
  const satoshi = card(page, 'satoshi_ghost');
  await expect(satoshi.locator('[data-part="range-fiat"]')).toHaveText('$50 – $1,500 USD');
  await expect(satoshi.locator('[data-part="range-xmr"]')).toHaveText(/^≈ \d+\.\d{6} – \d+\.\d{6} XMR$/);

  await box.check();
  await expect(kettle.locator('[data-part="range-fiat"]')).toHaveText('≈ $338.25 – $1,691.25 USD');
  await expect(kettle.locator('[data-part="range-xmr"]')).toHaveText('1.000000 – 5.000000 XMR');
  await expect(page.getByText("Converted at each offer's price, markup included.")).toBeVisible();

  await page.reload();
  await expect(page.getByRole('checkbox', { name: 'Display amounts including vendor markup' })).toBeChecked();
  await expect(card(page, 'kettle.moss').locator('[data-part="range-fiat"]')).toHaveText('≈ $338.25 – $1,691.25 USD');
});
