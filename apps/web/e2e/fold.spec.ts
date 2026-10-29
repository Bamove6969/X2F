// Plan 3 Task 40: foldable phones in the app shell and the trade room (Fold-* boards). Width rules
// at the board sizes (390, 600, 700, 840, 1000, 1100 px), a book fold's two segments and a
// tabletop emulated through CDP (Chromium's own hinge emulation, setDeviceMetricsOverride's
// displayFeature), the flip cover screen, and state kept across a fold. On a fixtures-mode build
// (e2e/fixtures-serve.ts) with the real CSP; the trade room is BuyerPay (Task 23) with the fixture
// chat (src/fixtures/payChat.tsx), the API stubbed as in pay.spec.ts.
import { expect, test, type CDPSession, type Page } from '@playwright/test';
import type { FastifyInstance } from 'fastify';
import { BOARD_BUY_QUOTE as B } from '../src/fixtures/quoteBoard.js';
import { PAY_SECURED } from '../src/fixtures/payBoard.js';
import type { TradeView } from '../src/screens/trade/payTypes.js';
import { startFixtures } from './fixtures-serve.js';
import { FOLD_VIEWPORTS, expectPhoneLayout, setPhone } from './phone.js';

const PORT = 4326;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const ROOM = `${ORIGIN}/trade/${PAY_SECURED.code}`;
/** The emulated book fold: an 840 px inner screen with a 16 px hinge from 412 to 428 px. */
const HINGE = { offset: 412, mask: 16 };

let server: FastifyInstance;
test.beforeAll(async () => {
  test.setTimeout(240_000);
  server = await startFixtures(PORT, 'dist-fixtures-fold');
});
test.afterAll(async () => {
  await server?.close();
});

const DEVICE = { phase: 'ready' as const, amountAtomic: PAY_SECURED.amountAtomic, fiatCents: PAY_SECURED.fiatCents, deal: { poster: 'seller' as const, takeAmountAtomic: PAY_SECURED.amountAtomic } };

async function openRoom(page: Page, view: TradeView = PAY_SECURED): Promise<void> {
  await page.route('**/v1/account/me', (r) => r.fulfill({ json: { kind: 'trader' } }));
  await page.route(/\/v1\/trades\/[^/]+(\/events)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(view) }));
  await page.addInitScript((e) => {
    window.__x2fFixtureEscrow = e;
  }, DEVICE);
  await page.goto(ROOM);
  await expect(page.locator('main[data-screen="trade"]')).toHaveAttribute('data-trade-state', view.state);
}

const fold = (page: Page) => page.locator('html').getAttribute('data-fold');
const box = async (page: Page, selector: string) => {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error(`${selector} has no box`);
  return b;
};

/**
 * Emulates a hinge on a `width` x `height` screen: 'vertical' splits left and right (a book fold
 * open), 'horizontal' top and bottom (tabletop). Chromium takes a display feature through
 * `Emulation.setDeviceMetricsOverride` (`Emulation.setDisplayFeaturesOverride` alone reports no
 * segments in the pinned build); `flat()` takes it away again.
 */
async function hinge(
  page: Page,
  size: { width: number; height: number },
  orientation: 'vertical' | 'horizontal',
  offset: number,
  maskLength = HINGE.mask,
): Promise<{ cdp: CDPSession; flat: () => Promise<void> }> {
  const cdp = await page.context().newCDPSession(page);
  const metrics = { ...size, deviceScaleFactor: 1, mobile: false };
  await cdp.send('Emulation.setDeviceMetricsOverride', { ...metrics, displayFeature: { orientation, offset, maskLength } });
  return { cdp, flat: () => cdp.send('Emulation.setDeviceMetricsOverride', metrics).then(() => undefined) };
}

/** Skips with the reason when this Chromium does not report viewport segments (lead default, Task 40 Step 1). */
async function needSegments(page: Page, query: string): Promise<void> {
  const ok = await page.evaluate((q) => matchMedia(q).matches, query);
  test.skip(!ok, `this Chromium does not report ${query} under an emulated display feature`);
}

/** Every visible element whose box overlaps [from, to) on the axis (x for a vertical hinge, y for a horizontal one). */
async function crossing(page: Page, axis: 'x' | 'y', from: number, to: number): Promise<string[]> {
  return page.evaluate(
    ({ axis, from, to }) => {
      const out: string[] = [];
      for (const el of Array.from(document.body.querySelectorAll('*'))) {
        if (!el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
        // Boxes that only paint a background behind the panes (the shell, the panes grid) span everything by design.
        if (el.matches('#root, #root > *, [data-shell-body], main[data-screen], .x2f-panes, .x2f-sheet-layer, .x2f-sheet-backdrop')) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const [a, b] = axis === 'x' ? [r.left, r.right] : [r.top, r.bottom];
        if (a < to - 0.5 && b > from + 0.5) out.push(`${el.tagName.toLowerCase()}.${el.className} ${Math.round(a)}..${Math.round(b)}`);
      }
      return out;
    },
    { axis, from, to },
  );
}

test.describe('width rules (Safari on the iPhone Fold, and any browser without segments)', () => {
  for (const [width, layout] of [
    [390, 'phone'],
    [599, 'phone'],
    [600, 'two'],
    [700, 'two'],
    [840, 'two'],
    [999, 'two'],
    [1000, 'wide'],
    [1100, 'wide'],
  ] as const) {
    test(`${width} px wide is the ${layout} layout`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openRoom(page);
      expect(await fold(page)).toBe(layout);
      if (layout === 'wide') {
        await expect(page.locator('[data-shell="desktop"]')).toBeAttached();
        await expect(page.locator('[data-layout="wide"]')).toBeVisible();
        await expect(page.locator('[data-pane="side"]')).toHaveCount(0);
      } else {
        await expect(page.locator('[data-shell="phone"]')).toBeAttached();
        await expect(page.locator('.x2f-pay[data-layout="phone"]')).toBeVisible();
      }
      if (layout === 'two') {
        // The room in the first pane, the chat in the second, a 16 px gutter between.
        const main = await box(page, '[data-pane="main"] > .x2f-pay');
        const side = await box(page, '[data-pane="side"]');
        expect(main.x).toBe(0);
        expect(side.x - (main.x + main.width)).toBeGreaterThanOrEqual(15.5);
        expect(side.x + side.width).toBeLessThanOrEqual(width + 0.5);
        await expect(page.locator('[data-pane="side"] input#msg')).toBeVisible();
        // The chat has its pane: the header's Chat button is hidden.
        await expect(page.locator('[data-chat-link]')).toBeHidden();
        await expectPhoneLayout(page);
      }
      if (layout === 'phone') {
        await expect(page.locator('[data-pane="side"]')).toHaveCount(0);
        await expect(page.locator('[data-chat-link]')).toBeVisible();
      }
    });
  }

  test('FOLD_VIEWPORTS: every size fits with no sideways scroll, and under 1000 px every control is tappable', async ({ page }) => {
    await openRoom(page);
    for (const v of FOLD_VIEWPORTS) {
      await setPhone(page, v);
      if (Number(v.split('x')[0]) < 1000) {
        await expectPhoneLayout(page);
      } else {
        // The wide layout is the Desktop board (its header links are its own, 24 px tall): no sideways scroll.
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      }
    }
  });

  test("a sheet opened from the room stays in the room's pane", async ({ page }) => {
    await page.setViewportSize({ width: 840, height: 900 });
    await openRoom(page);
    await page.locator('[data-primary]').first().click();
    const dialog = await box(page, '[role="dialog"]');
    const main = await box(page, '[data-pane="main"] > .x2f-pay');
    expect(dialog.x).toBeGreaterThanOrEqual(-0.5);
    expect(dialog.x + dialog.width).toBeLessThanOrEqual(main.x + main.width + 0.5);
  });
});

test.describe('a book fold open: two segments (Chrome on Android)', () => {
  test('the gutter sits on the hinge, nothing crosses it, and a sheet stays in one pane', async ({ page }) => {
    await page.setViewportSize({ width: 840, height: 900 });
    await hinge(page, { width: 840, height: 900 }, 'vertical', HINGE.offset);
    await openRoom(page);
    await needSegments(page, '(horizontal-viewport-segments: 2)');
    expect(await fold(page)).toBe('two');
    const side = await box(page, '[data-pane="side"]');
    expect(side.x).toBeGreaterThanOrEqual(HINGE.offset + HINGE.mask - 0.5);
    expect(await crossing(page, 'x', HINGE.offset, HINGE.offset + HINGE.mask)).toEqual([]);
    await page.locator('[data-primary]').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    const dialog = await box(page, '[role="dialog"]');
    expect(dialog.x + dialog.width).toBeLessThanOrEqual(HINGE.offset + 0.5);
    expect(await crossing(page, 'x', HINGE.offset, HINGE.offset + HINGE.mask)).toEqual([]);
  });

  test('a hinge off the middle moves the panes with it', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 });
    await hinge(page, { width: 900, height: 900 }, 'vertical', 500, 0);
    await openRoom(page);
    await needSegments(page, '(horizontal-viewport-segments: 2)');
    const main = await box(page, '[data-pane="main"] > .x2f-pay');
    const side = await box(page, '[data-pane="side"]');
    // A hinge with no gap still gets the 16 px gutter, centred on it.
    expect(main.x + main.width).toBeCloseTo(492, 0);
    expect(side.x).toBeCloseTo(508, 0);
  });

  test('a screen without panes stays in the first pane, its bottom nav too', async ({ page }) => {
    await page.setViewportSize({ width: 840, height: 900 });
    await hinge(page, { width: 840, height: 900 }, 'vertical', HINGE.offset);
    await page.route('**/v1/**', (r) => r.fulfill({ status: 401, json: { error: 'not-authenticated' } }));
    await page.goto(`${ORIGIN}/sell`);
    await needSegments(page, '(horizontal-viewport-segments: 2)');
    await expect(page.locator('nav[aria-label="Main"]')).toBeVisible();
    expect(await crossing(page, 'x', HINGE.offset, HINGE.offset + HINGE.mask)).toEqual([]);
  });
});

test.describe('tabletop: half folded', () => {
  test('turns on by itself: the top half shows information only, every control and the chat are in the bottom half', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 840 });
    await openRoom(page);
    expect(await fold(page)).toBe('wide');
    const halfFold = await hinge(page, { width: 1000, height: 840 }, 'horizontal', 412);
    await needSegments(page, '(vertical-viewport-segments: 2)');
    await expect(page.locator('html')).toHaveAttribute('data-fold', 'tabletop');
    const glance = page.locator('[data-pane="glance"]');
    await expect(glance).toContainText('Buying from');
    await expect(glance).toContainText('$412.50');
    expect(await glance.locator('a, button, input, select, textarea').count()).toBe(0);
    expect((await box(page, '[data-pane="glance"]')).y + (await box(page, '[data-pane="glance"]')).height).toBeLessThanOrEqual(412.5);
    const controls = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea'))
        .filter((el) => el.checkVisibility({ visibilityProperty: true, opacityProperty: true }) && el.getBoundingClientRect().height > 0)
        .map((el) => ({ what: (el.textContent ?? el.getAttribute('aria-label') ?? '').trim().slice(0, 30), top: el.getBoundingClientRect().top })),
    );
    expect(controls.length).toBeGreaterThan(0);
    expect(controls.filter((c) => c.top < 428 - 0.5)).toEqual([]);
    await expect(page.locator('[data-pane="side"] input#msg')).toBeVisible();
    expect(await crossing(page, 'y', 412, 428)).toEqual([]);
    // A sheet opens in the bottom half.
    await page.locator('[data-primary]').first().click();
    expect((await box(page, '[role="dialog"]')).y).toBeGreaterThanOrEqual(428 - 0.5);
    await page.keyboard.press('Escape');
    // Flat again: off by itself.
    await halfFold.flat();
    await expect(page.locator('html')).toHaveAttribute('data-fold', 'wide');
    await expect(page.locator('[data-pane="glance"]')).toHaveCount(0);
  });
});

test.describe('the flip cover screen', () => {
  test('shows the trade as a small card with no trade actions; opening the phone brings the room back as it was', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openRoom(page);
    await page.locator('[data-chat-link]').click();
    await page.locator('#msg').fill('sent it');
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 360, height: 380 });
    await expect(page.locator('html')).toHaveAttribute('data-fold', 'cover');
    const card = page.locator('[data-pane="glance"]');
    await expect(card).toContainText('Buying from');
    await expect(card).toContainText('Open your phone to keep going.');
    await expect(page.locator('[data-pane="main"]')).toBeHidden();
    expect(await page.locator('a[href], button, input').filter({ visible: true }).count()).toBe(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.x2f-pay[data-layout="phone"]')).toBeVisible();
    await page.locator('[data-chat-link]').click();
    await expect(page.locator('#msg')).toHaveValue('sent it');
  });
});

test.describe('folding keeps the screen, the scroll position and typed text', () => {
  test('840 to 390 px mid-trade: same route, same scroll, the chat draft moves behind the Chat button', async ({ page }) => {
    await page.setViewportSize({ width: 840, height: 500 });
    await openRoom(page);
    await page.locator('[data-pane="side"] #msg').fill('paying now, one minute');
    const max = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    expect(max).toBeGreaterThan(100);
    await page.evaluate(() => window.scrollTo(0, 100));
    await page.setViewportSize({ width: 390, height: 500 });
    await expect(page.locator('html')).toHaveAttribute('data-fold', 'phone');
    expect(page.url()).toBe(ROOM);
    expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(100, -1);
    await expect(page.locator('[data-pane="side"]')).toHaveCount(0);
    await page.locator('[data-chat-link]').click();
    await expect(page.getByRole('dialog').locator('#msg')).toHaveValue('paying now, one minute');
    // And back: the sheet closes, the draft is in the chat pane.
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 840, height: 500 });
    await expect(page.locator('[data-pane="side"] #msg')).toHaveValue('paying now, one minute');
  });

  test('a half-typed amount on the quote survives unfolding and folding', async ({ page }) => {
    await page.route('**/v1/account/me', (r) => r.fulfill({ json: { displayName: 'viewer_1', kind: 'trader', methods: ['pgp'] } }));
    await page.route('**/v1/methods?*', (r) =>
      r.fulfill({ json: { live: [{ id: B.method.id, name: B.method.name, group: 'Payment apps', giftCard: false, offers: 1, bestRate: B.marketCentsPerXmr }], all: [] } }),
    );
    await page.route('**/v1/price?*', (r) =>
      r.fulfill({ json: { currency: B.currency, centsPerXmr: B.marketCentsPerXmr, exponent: 2, at: new Date().toISOString(), usdCentsPerXmr: B.marketCentsPerXmr } }),
    );
    await page.route('**/v1/offers?*', (r) => r.fulfill({ json: [B.offer] }));
    await page.route('**/v1/wallets', (r) => r.fulfill({ json: [...B.wallets] }));
    await page.route('**/v1/wallets/rule', (r) => r.fulfill({ json: { firstWallet: false, strongMethods: [], password: 'immediate', waitHours: 24 } }));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${ORIGIN}/buy/${B.method.id}/${B.offer.id}?currency=${B.currency}`);
    const amount = page.locator('#quote-amount');
    await amount.fill('41');
    for (const width of [840, 1100, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(amount).toHaveValue('41');
    }
    expect(new URL(page.url()).pathname).toBe(`/buy/${B.method.id}/${B.offer.id}`);
  });
});
