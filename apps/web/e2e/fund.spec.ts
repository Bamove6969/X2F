// TradeFund and the escrow check (Task 22; board TradeFund.dc.html; spec 2.2 step 5). The API is
// stubbed with the boards' example trade (src/fixtures/boards.ts) in Task 6's TradeView shape. The
// escrow runtime (Task 12) is not merged, so the room runs with its stand-in; the check words and
// the security-check danger state are covered in test/tradeFund.test.tsx against a fake escrow.
import { expect, test, type Page } from '@playwright/test';
import { fiatCents, formatFiat, moneroUri } from '@x2f/trade';
import { BOARD_TRADE as B } from '../src/fixtures/boards.js';
import { expectParity } from './parity.js';

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

const ADDRESS = '4' + '8sKx3vQz1A'.repeat(9) + 'Bc7dE';
const SERVER_NOW = Date.parse('2026-10-25T11:11:18.000Z');
/** "28:42" left on the board's funding timer. */
const FUND_BY = new Date(SERVER_NOW + (28 * 60 + 42) * 1000).toISOString();
const FEE = B.amountAtomic / 100n;

type View = Record<string, unknown>;

function sellerView(over: View = {}): View {
  return {
    code: B.code,
    role: 'seller',
    poster: 'buyer',
    state: 'funding',
    counterparty: { username: B.buyer, completedTrades: 3, online: true, lastSeenAt: null, typicalMinutes: null, positivePct: null, badges: [] },
    methodId: B.method.id,
    profile: { name: B.method.name, whatItIs: B.method.whatItIs },
    amountAtomic: B.amountAtomic.toString(),
    fiatCents: fiatCents(B.amountAtomic, { currency: B.currency, centsPerXmr: B.rateCentsPerXmr }).toString(),
    lockedRate: { currency: B.currency, centsPerXmr: B.rateCentsPerXmr.toString() },
    maxFiatCents: '100000',
    grown: null,
    receivedAtomic: '0',
    confirmations: 0,
    releasable: false,
    releasableEtaMin: null,
    funding: {
      sellerFundsAtomic: B.amountAtomic.toString(),
      escrowAddress: ADDRESS,
      uri: moneroUri(ADDRESS, B.amountAtomic),
      walletApp: 'cake',
    },
    extensions: 0,
    cancelProposedBy: null,
    settling: null,
    dispute: null,
    txHash: null,
    takenAt: new Date(SERVER_NOW - 60_000).toISOString(),
    setupBy: null,
    fundBy: FUND_BY,
    fundingSeenAt: null,
    securedAt: null,
    payBy: null,
    paidAt: null,
    confirmBy: null,
    finalAlertAt: null,
    settleBy: null,
    pausedAt: null,
    closedAt: null,
    nextDeadline: FUND_BY,
    serverNow: new Date(SERVER_NOW).toISOString(),
    ...over,
  };
}

const posterView = (): View =>
  sellerView({
    poster: 'seller',
    fee: { atomic: FEE.toString() },
    funding: {
      sellerFundsAtomic: (B.amountAtomic + FEE).toString(),
      escrowAddress: ADDRESS,
      uri: moneroUri(ADDRESS, B.amountAtomic + FEE),
      walletApp: 'cake',
    },
  });

const buyerView = (): View =>
  sellerView({ role: 'buyer', funding: null, counterparty: { ...(sellerView().counterparty as object), username: B.seller } });

/** Stubs the session and the trade; `view()` is read on every request, so a test can change it. */
async function stub(page: Page, view: () => View): Promise<void> {
  await page.route('**/v1/account/me', (r) => r.fulfill({ json: { kind: 'trader' } }));
  await page.route(`**/v1/trades/${B.code}`, (r) => r.fulfill({ json: view() }));
}

/** Records every `monero:` link the page follows, and stops the navigation. */
async function recordWalletOpens(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const w = window as unknown as { __opened: string[] };
    w.__opened = [];
    document.addEventListener(
      'click',
      (e) => {
        const a = (e.target as Element | null)?.closest?.('a[href^="monero:"]');
        if (a) {
          w.__opened.push(a.getAttribute('href') ?? '');
          e.preventDefault();
        }
      },
      true,
    );
  });
  return () => page.evaluate(() => (window as unknown as { __opened: string[] }).__opened);
}

async function hold(page: Page): Promise<void> {
  const button = page.locator('button.x2f-hold');
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1700);
  await page.mouse.up();
}

const room = (page: Page) => page.goto(`/trade/${B.code}`);

test.describe('TradeFund (seller, phone)', () => {
  test.use({ userAgent: ANDROID });

  test('matches the TradeFund board at 390x844', async ({ page }) => {
    await stub(page, () => sellerView());
    await room(page);
    await expect(page.getByText('mira.k is in. Fund the escrow to lock the trade.')).toBeVisible();
    await expectParity(page, 'TradeFund');
  });

  test('the wallet link is exactly moneroUri(escrowAddress, sellerFundsAtomic), and the screen says to send exactly it', async ({ page }) => {
    await stub(page, () => sellerView());
    await room(page);
    await expect(page.locator('[data-wallet-link]')).toHaveAttribute('href', moneroUri(ADDRESS, B.amountAtomic));
    await expect(page.locator('[data-primary]')).toHaveText(/Open in Cake Wallet/);
    await page.getByRole('button', { name: 'Use another wallet (QR code or address)' }).click();
    await expect(page.getByText('Send exactly this amount: 1.250000 XMR')).toBeVisible();
    await expect(page.locator('[data-qr]')).toBeVisible();
  });

  test('the poster seller funds amount + 1% and sees the fee; the link carries that exact total', async ({ page }) => {
    await stub(page, posterView);
    await room(page);
    await expect(page.getByText('Includes X2F fee (1%, your ad)')).toBeVisible();
    await expect(page.getByText('0.012500 XMR')).toBeVisible();
    await expect(page.locator('[data-wallet-link]')).toHaveAttribute('href', moneroUri(ADDRESS, B.amountAtomic + FEE));
    await expect(page.getByText('Opens Cake Wallet with the escrow address and 1.2625 XMR filled in. You confirm there.')).toBeVisible();
  });

  test('the taker seller sees no X2F fee', async ({ page }) => {
    await stub(page, () => sellerView());
    await room(page);
    await expect(page.getByText('You send to escrow')).toBeVisible();
    await expect(page.locator('body')).not.toContainText('X2F fee');
    await expect(page.locator('body')).not.toContainText('1%');
  });

  test('the fiat total is the quote\'s: fiatCents(amount, locked rate)', async ({ page }) => {
    await stub(page, () => sellerView());
    await room(page);
    const quoted = formatFiat(fiatCents(B.amountAtomic, { currency: B.currency, centsPerXmr: B.rateCentsPerXmr }), B.currency);
    expect(quoted).toBe('$412.50');
    await expect(page.locator('[data-total="true"]')).toHaveText(`You receive${quoted} USD`);
  });

  test('the countdown follows serverNow with the browser clock 10 min ahead', async ({ page }) => {
    await page.clock.setFixedTime(SERVER_NOW + 10 * 60_000);
    await stub(page, () => sellerView());
    await room(page);
    await expect(page.locator('[role="timer"]')).toHaveText('28:42');
  });

  test('the hold opens the wallet once; a second hold, and a reload, do nothing more', async ({ page }) => {
    const opened = await recordWalletOpens(page);
    await stub(page, () => sellerView());
    await room(page);
    await hold(page);
    await expect(page.locator('[data-primary]')).toContainText('Waiting for your payment…');
    expect(await opened()).toEqual([moneroUri(ADDRESS, B.amountAtomic)]);
    // The QR code and copy stay until funded.
    await expect(page.locator('[data-qr]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy address' })).toBeVisible();
    await hold(page);
    expect(await opened()).toHaveLength(1);
    await page.reload();
    await expect(page.locator('[data-primary]')).toContainText('Waiting for your payment…');
    await hold(page);
    expect(await opened()).toEqual([]);
  });

  test('once the full amount is seen: "Escrow funded", and no address or monero: link, even after a reload', async ({ page }) => {
    let view = sellerView();
    await stub(page, () => view);
    await room(page);
    await expect(page.locator('[data-wallet-link]')).toBeAttached();
    view = sellerView({ receivedAtomic: B.amountAtomic.toString() });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Escrow funded' })).toBeVisible();
    const html = () => page.content();
    expect(await html()).not.toContain(ADDRESS);
    expect(await html()).not.toContain('monero:');
    // The API stops returning the funding details once funded (Task 6).
    view = sellerView({ state: 'securing', funding: null, receivedAtomic: B.amountAtomic.toString(), confirmations: 1 });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Escrow funded' })).toBeVisible();
    expect(await html()).not.toContain(ADDRESS);
    expect(await html()).not.toContain('monero:');
    await expect(page.locator('[data-qr], [data-wallet-link], [data-escrow-address]')).toHaveCount(0);
  });

  test('short funding: "Received 1.000000 of 1.250000 XMR, send the rest"', async ({ page }) => {
    await stub(page, () => sellerView({ receivedAtomic: '1000000000000' }));
    await room(page);
    await expect(page.getByText('Received 1.000000 of 1.250000 XMR, send the rest')).toBeVisible();
  });

  test('Edge sellers get the Full Sync tip', async ({ page }) => {
    await stub(page, () => sellerView({ funding: { ...(sellerView().funding as object), walletApp: 'edge' } }));
    await room(page);
    await expect(page.locator('[data-primary]')).toContainText('Open in Edge');
    await expect(page.getByText("For best privacy, turn on Full Sync in Edge's Monero settings.")).toBeVisible();
  });
});

test.describe('TradeFund on iPhone', () => {
  test.use({ userAgent: IPHONE });
  test('iOS also gets "Open in <wallet>" as the primary', async ({ page }) => {
    await stub(page, () => sellerView());
    await room(page);
    await expect(page.locator('[data-primary]')).toContainText('Open in Cake Wallet');
  });
});

test.describe('TradeFund on a desktop', () => {
  test.use({ userAgent: DESKTOP });
  test('the primary is Copy address, with the QR code; there is no wallet link', async ({ page }) => {
    await stub(page, () => sellerView());
    await room(page);
    await expect(page.locator('[data-primary]')).toHaveText('Copy address');
    await expect(page.locator('[data-qr]')).toBeVisible();
    await expect(page.locator('[data-wallet-link]')).toHaveCount(0);
    await expect(page.locator('[data-escrow-address]')).toHaveText(ADDRESS);
  });

  test('at 1280x800 the room fits with no horizontal scroll and one primary', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await stub(page, () => sellerView());
    await room(page);
    await expect(page.locator('[data-shell="desktop"]')).toBeAttached();
    await expect(page.locator('[data-primary]')).toHaveCount(1);
    const scroll = await page.evaluate(() => ({ wide: document.documentElement.scrollWidth, view: document.documentElement.clientWidth }));
    expect(scroll.wide).toBeLessThanOrEqual(scroll.view);
  });
});

test.describe('the buyer before funding', () => {
  test.use({ userAgent: ANDROID });
  test('sees "Waiting for <seller> to fund" and no address, QR code or wallet link', async ({ page }) => {
    await stub(page, buyerView);
    await room(page);
    await expect(page.getByRole('heading', { name: `Waiting for ${B.seller} to fund` })).toBeVisible();
    await expect(page.getByText(`Buying from ${B.seller}`)).toBeVisible();
    await expect(page.locator('[data-qr], [data-wallet-link], [data-escrow-address]')).toHaveCount(0);
    expect(await page.content()).not.toContain('monero:');
  });
});

// Phone sizes (spec "Mobile ready at launch", owner 2026-10-25): a small Android, the boards'
// 390x844 and a large phone. The primary stays fully on screen, nothing scrolls sideways, the
// other trader's name has no text-transform, and body text is at least 16 px.
for (const [width, height] of [
  [360, 640],
  [390, 844],
  [430, 932],
] as const) {
  test.describe(`at ${width}x${height}`, () => {
    test.use({ userAgent: ANDROID, viewport: { width, height } });

    test('the seller funding room fits the phone, before and after the hold', async ({ page }) => {
      await recordWalletOpens(page);
      await stub(page, posterView);
      await room(page);
      const primary = page.locator('[data-primary]');
      await expect(primary).toHaveCount(1);
      await expect(primary).toBeInViewport({ ratio: 1 });
      const fits = () =>
        page.evaluate(() => ({ wide: document.documentElement.scrollWidth, view: document.documentElement.clientWidth }));
      let s = await fits();
      expect(s.wide).toBeLessThanOrEqual(s.view);
      expect(await page.locator('.x2f-trade-lead').evaluate((e) => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);
      for (const t of await page.locator('[data-username]').evaluateAll((els) => els.map((e) => getComputedStyle(e).textTransform))) {
        expect(t).toBe('none');
      }
      await hold(page);
      await expect(primary).toContainText('Waiting for your payment…');
      await expect(primary).toBeInViewport({ ratio: 1 });
      await page.locator('[data-escrow-address]').scrollIntoViewIfNeeded();
      await expect(page.locator('[data-escrow-address]')).toBeInViewport();
      s = await fits();
      expect(s.wide).toBeLessThanOrEqual(s.view);
    });

    test('the buyer waiting room fits the phone', async ({ page }) => {
      await stub(page, buyerView);
      await room(page);
      await expect(page.getByRole('heading', { name: `Waiting for ${B.seller} to fund` })).toBeInViewport();
      const s = await page.evaluate(() => ({ wide: document.documentElement.scrollWidth, view: document.documentElement.clientWidth }));
      expect(s.wide).toBeLessThanOrEqual(s.view);
    });
  });
}
