// TradeFund and the escrow check (Task 22; board TradeFund.dc.html; spec 2.2 step 5). The API is
// stubbed with the boards' example trade (src/fixtures/boards.ts) in Task 6's TradeView shape.
//
// Funding shows only an address this device's escrow runtime derived and verified (security
// review). Task 12's runtime needs a relay, a node and a moderator, so most tests run against a
// fixtures-mode build (`vite build --mode fixtures`, e2e/fixtures-serve.ts, served through the
// API's serveWeb with the real CSP) whose escrow state each test sets with
// `window.__x2fFixtureEscrow`. The production build (the config's web server) runs Task 12's real
// runtime, and its test checks that a device that never confirmed the trade shows no address at all.
import { expect, test, type Page } from '@playwright/test';
import type { FastifyInstance } from 'fastify';
import { fiatCents, formatFiat, moneroUri } from '@x2f/trade';
import { BOARD_TRADE as B } from '../src/fixtures/boards.js';
import { startFixtures } from './fixtures-serve.js';
import { expectParity } from './parity.js';
import { PORT } from './playwright.config.js';
import { INSIDE } from './session.js';

const FIXTURES_PORT = PORT + 1;
const FIXTURES = `http://127.0.0.1:${FIXTURES_PORT}`;
const PRODUCTION = `http://127.0.0.1:${PORT}`;
let server: FastifyInstance | null = null;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  server = await startFixtures(FIXTURES_PORT);
});

test.afterAll(async () => {
  await server?.close();
});

test.use({ baseURL: FIXTURES });

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
    counterparty: { displayName: B.buyer, completedTrades: 3, online: true, lastSeenAt: null, typicalMinutes: null, positivePct: null, badges: [], stage: 'graduated' },
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
    fundStartedAt: null,
    securedAt: null,
    payBy: null,
    paidAt: null,
    confirmBy: null,
    finalAlertAt: null,
    finalAlertSeenAt: null,
    settleBy: null,
    releaseClaimedAt: null,
    pausedAt: null,
    closedAt: null,
    cancelConfirmedAt: null,
    cancelConfirmableAt: null,
    sellerNudgedAt: null,
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
  sellerView({ role: 'buyer', funding: null, counterparty: { ...(sellerView().counterparty as object), displayName: B.seller } });

const WORDS = ['amber', 'canal', 'violin', 'oxygen'];
type FixtureEscrow = NonNullable<Window['__x2fFixtureEscrow']>;
/** The device derived ADDRESS and has its check words: the only state that may show funding. */
const VERIFIED: FixtureEscrow = { phase: 'ready', checkWords: WORDS, escrowAddress: ADDRESS, deal: { poster: 'buyer', takeAmountAtomic: B.amountAtomic.toString() } };
/** The same, on a device whose user posted the sell ad (it funds amount + 1%). */
const VERIFIED_POSTER: FixtureEscrow = { ...VERIFIED, deal: { poster: 'seller', takeAmountAtomic: B.amountAtomic.toString() } };

/**
 * Stubs the session and the trade (`view()` is read on every request, so a test can change it)
 * and sets the fixture build's escrow state (VERIFIED unless given).
 */
async function stub(page: Page, view: () => View, escrow: FixtureEscrow = VERIFIED): Promise<void> {
  await page.addInitScript((e) => {
    window.__x2fFixtureEscrow = e;
  }, escrow);
  await page.route('**/v1/account/me', (r) => r.fulfill({ json: INSIDE }));
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
    await stub(page, posterView, VERIFIED_POSTER);
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

  test('the hold opens the wallet on the release, once; a second hold, and a reload, do nothing more', async ({ page }) => {
    const opened = await recordWalletOpens(page);
    await stub(page, () => sellerView());
    await room(page);
    // While the finger is still down past 1.5 s nothing has opened: the release performs it (review I2).
    const button = page.locator('button.x2f-hold');
    const box = (await button.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(button).toContainText('Release to open');
    expect(await opened()).toEqual([]);
    await page.mouse.up();
    expect(await opened()).toEqual([moneroUri(ADDRESS, B.amountAtomic)]);
    await expect(page.locator('[data-primary]')).toContainText('Waiting for your payment…');
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

  test('short funding this device has seen: the link, QR and copy carry the remainder, never the full amount again', async ({ page }) => {
    await stub(page, () => sellerView({ receivedAtomic: '1000000000000' }), { ...VERIFIED, receivedAtomic: '1000000000000' });
    await room(page);
    await expect(page.getByText('Received 1.000000 of 1.250000 XMR, send the rest')).toBeVisible();
    await expect(page.locator('[data-wallet-link]')).toHaveAttribute('href', moneroUri(ADDRESS, B.amountAtomic - 1_000_000_000_000n));
    await page.getByRole('button', { name: 'Use another wallet (QR code or address)' }).click();
    await expect(page.getByText('Send the rest: 0.250000 XMR')).toBeVisible();
    await expect(page.locator('[data-qr]')).toBeVisible();
    expect(await page.content()).not.toContain(`tx_amount=1.25`);
  });

  test('short funding this device has not seen yet: the address only, no link, QR or amount', async ({ page }) => {
    await stub(page, () => sellerView({ receivedAtomic: '1000000000000' }));
    await room(page);
    await expect(page.getByText('Received 1.000000 of 1.250000 XMR, send the rest')).toBeVisible();
    await expect(page.getByText('Send the rest: 0.250000 XMR')).toBeVisible();
    await expect(page.locator('[data-escrow-address]')).toHaveText(ADDRESS);
    await expect(page.locator('[data-qr], [data-wallet-link]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Copy amount' })).toHaveCount(0);
    await expect(page.locator('[data-primary]')).toHaveText('Copy address');
    expect(await page.content()).not.toContain('tx_amount');
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

  test('a non-6-aligned amount is shown in full wherever it must be sent, and equals what Copy amount carries', async ({ page, context }) => {
    // atomicForFiat floors to the atomic unit: real amounts have 12 places (review kit round 1, finding 1).
    const ODD = 610_529_733_574n;
    const odd = (over: View = {}) =>
      sellerView({ amountAtomic: ODD.toString(), funding: { sellerFundsAtomic: ODD.toString(), escrowAddress: ADDRESS, uri: moneroUri(ADDRESS, ODD), walletApp: 'cake' }, ...over });
    const deal = { poster: 'buyer' as const, takeAmountAtomic: ODD.toString() };
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await stub(page, () => odd(), { ...VERIFIED, deal });
    await room(page);
    await expect(page.getByText('Send exactly this amount: 0.610529733574 XMR')).toBeVisible();
    await expect(page.locator('.x2f-trade-quote__head .x2f-amount')).toHaveText('0.610529733574 XMR');
    await page.getByRole('button', { name: 'Copy amount' }).click();
    await expect(page.getByText('Amount copied.')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('0.610529733574');
  });

  test('short by under 0.000001: "Send the rest: 0.000000733574 XMR", never 0.000000', async ({ page }) => {
    const ODD = 610_529_733_574n;
    const view = sellerView({
      amountAtomic: ODD.toString(),
      receivedAtomic: '610529000000',
      funding: { sellerFundsAtomic: ODD.toString(), escrowAddress: ADDRESS, uri: moneroUri(ADDRESS, ODD), walletApp: 'cake' },
    });
    await stub(page, () => view, { ...VERIFIED, deal: { poster: 'buyer', takeAmountAtomic: ODD.toString() }, receivedAtomic: '610529000000' });
    await room(page);
    await expect(page.getByText('Received 0.610529 of 0.610529733574 XMR, send the rest')).toBeVisible();
    await expect(page.getByText('Send the rest: 0.000000733574 XMR')).toBeVisible();
    await expect(page.locator('body')).not.toContainText('0.000000 XMR');
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

test.describe('only a verified escrow address is ever shown', () => {
  test.use({ userAgent: ANDROID });
  const ATTACKER = '4' + 'Zz9Yy8Xx7W'.repeat(9) + 'vU6tS';

  test('a server uri pointing elsewhere is never used: the link is built from the verified address', async ({ page }) => {
    const opened = await recordWalletOpens(page);
    await stub(page, () => sellerView({ funding: { ...(sellerView().funding as object), uri: moneroUri(ATTACKER, 99n * B.amountAtomic) } }));
    await room(page);
    await expect(page.locator('[data-wallet-link]')).toHaveAttribute('href', moneroUri(ADDRESS, B.amountAtomic));
    await hold(page);
    expect(await opened()).toEqual([moneroUri(ADDRESS, B.amountAtomic)]);
    expect(await page.content()).not.toContain(ATTACKER);
  });

  test('an API address that differs from the device-derived one: "Security check failed", no address, link or QR', async ({ page }) => {
    await stub(page, () => sellerView({ funding: { ...(sellerView().funding as object), escrowAddress: ATTACKER, uri: moneroUri(ATTACKER, B.amountAtomic) } }));
    await room(page);
    await expect(page.getByRole('heading', { name: "Security check failed. Don't fund this trade." })).toBeVisible();
    await expect(page.locator('[data-qr], [data-wallet-link], [data-escrow-address]')).toHaveCount(0);
    expect(await page.content()).not.toContain(ATTACKER);
    expect(await page.content()).not.toContain(ADDRESS);
    expect(await page.content()).not.toContain('monero:');
  });

  test('an inflated server amount: "Security check failed", and no address, link, QR or copy', async ({ page }) => {
    await stub(page, () => sellerView({ funding: { ...(sellerView().funding as object), sellerFundsAtomic: (10n * B.amountAtomic).toString() } }));
    await room(page);
    await expect(page.getByRole('heading', { name: "Security check failed. Don't fund this trade." })).toBeVisible();
    await expect(page.locator('[data-qr], [data-wallet-link], [data-escrow-address]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Copy/ })).toHaveCount(0);
    expect(await page.content()).not.toContain(ADDRESS);
  });

  for (const [name, escrow] of [
    ['setting up', { phase: 'setting-up', keepOpen: true }],
    ['an error', { phase: 'error', error: 'escrow-failed', retryable: true, escrowAddress: ADDRESS, checkWords: WORDS }],
    ['participants-mismatch', { phase: 'error', error: 'participants-mismatch' }],
  ] as [string, FixtureEscrow][]) {
    test(`${name}: no address, link or QR`, async ({ page }) => {
      await stub(page, () => sellerView(), escrow);
      await room(page);
      await expect(page.locator('[data-screen="trade"]')).toHaveAttribute('data-trade-state', 'funding');
      await expect(page.locator('[data-qr], [data-wallet-link], [data-escrow-address]')).toHaveCount(0);
      expect(await page.content()).not.toContain(ADDRESS);
      expect(await page.content()).not.toContain('monero:');
    });
  }

  test.describe('the production build (Task 12 not merged: stand-in escrow)', () => {
    test.use({ baseURL: PRODUCTION });
    test('shows setup progress and no address, link or QR, whatever the API sends', async ({ page }) => {
      await stub(page, () => sellerView());
      await room(page);
      await expect(page.getByText('Setting up escrow')).toBeVisible();
      await expect(page.locator('[data-qr], [data-wallet-link], [data-escrow-address]')).toHaveCount(0);
      expect(await page.content()).not.toContain(ADDRESS);
      expect(await page.content()).not.toContain('monero:');
    });
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
      await stub(page, posterView, VERIFIED_POSTER);
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

    test('a 12-place amount fits the phone, and the wallet link and hint carry all of it', async ({ page }) => {
      const ODD = 12_610_529_733_574n;
      const view = sellerView({
        amountAtomic: ODD.toString(),
        funding: { sellerFundsAtomic: ODD.toString(), escrowAddress: ADDRESS, uri: moneroUri(ADDRESS, ODD), walletApp: 'cake' },
      });
      await stub(page, () => view, { ...VERIFIED, deal: { poster: 'buyer', takeAmountAtomic: ODD.toString() } });
      await room(page);
      await expect(page.locator('.x2f-trade-quote__head .x2f-amount')).toHaveText('12.610529733574 XMR');
      await expect(page.locator('[data-wallet-link]')).toHaveAttribute('href', moneroUri(ADDRESS, ODD));
      await expect(page.getByText('Opens Cake Wallet with the escrow address and 12.610529733574 XMR filled in. You confirm there.')).toBeVisible();
      const s = await page.evaluate(() => ({ wide: document.documentElement.scrollWidth, view: document.documentElement.clientWidth }));
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
