// Plan 3 Task 40: foldable phones in the app shell and the trade room (Fold-* boards). Width rules
// at the board sizes (390, 600, 700, 840, 1000, 1100 px), a book fold's two segments and a
// tabletop emulated through CDP (Chromium's own hinge emulation, setDeviceMetricsOverride's
// displayFeature), the flip cover screen, and state kept across a fold. On a fixtures-mode build
// (e2e/fixtures-serve.ts) with the real CSP; the trade room is BuyerPay (Task 23) with the fixture
// chat (src/fixtures/payChat.tsx), the API stubbed as in pay.spec.ts.
import { expect, test, type CDPSession, type Page } from '@playwright/test';
import type { FastifyInstance } from 'fastify';
import { BOARD_SELL_LIVE_USD, BOARD_SELL_OFFERS, boardSellOffers } from '../src/fixtures/boards.js';
import { BOARD_BUY_QUOTE as B } from '../src/fixtures/quoteBoard.js';
import { PAY_SECURED } from '../src/fixtures/payBoard.js';
import type { TradeView } from '../src/screens/trade/payTypes.js';
import { stubBrowseApi } from './browse-stub.js';
import { startFixtures } from './fixtures-serve.js';
import { FOLD_VIEWPORTS, expectPhoneLayout, setPhone } from './phone.js';
import { sellerView } from './refundViews.js';

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
  test.skip(!ok, `this Chromium does not report ${query} under CDP emulation`);
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

  test('no hinge reported: a sheet and its backdrop cover the whole screen, nothing behind it can be tapped (review I3)', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await openRoom(page);
    expect(await fold(page)).toBe('two');
    // The primary may open a warning sheet (role alertdialog, Task 38), so find the sheet by its class.
    await page.locator('[data-primary]').first().click();
    await expect(page.locator('.x2f-sheet')).toBeVisible();
    const backdrop = await box(page, '.x2f-sheet-backdrop');
    expect(backdrop.x).toBeLessThanOrEqual(0.5);
    expect(backdrop.width).toBeGreaterThanOrEqual(799.5);
    const dialog = await box(page, '.x2f-sheet');
    expect(dialog.width).toBeGreaterThanOrEqual(799.5);
    // The chat pane and the room behind the sheet are under the backdrop.
    for (const [x, y] of [
      [700, 450],
      [100, 100],
      [600, 50],
    ] as const) {
      expect(await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest('.x2f-sheet-layer') !== null, [x, y])).toBe(true);
    }
  });

  test('a Chat sheet open on the phone closes on unfold: one draft, one composer (review M3)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openRoom(page);
    await page.locator('[data-chat-link]').click();
    await page.getByRole('dialog').locator('#msg').fill('two minutes');
    await page.setViewportSize({ width: 840, height: 844 });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('#msg')).toHaveCount(1);
    await expect(page.locator('[data-pane="side"] #msg')).toHaveValue('two minutes');
  });

  test('a Chat sheet that closes on unfold hands the focus to the chat pane, not the page (round-2 review m4)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openRoom(page);
    await page.locator('[data-chat-link]').click();
    await page.getByRole('dialog').locator('#msg').fill('two minutes');
    await page.setViewportSize({ width: 840, height: 844 });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('[data-pane="side"] #msg')).toBeFocused();
    await expect(page.locator('[data-pane="side"] #msg')).toHaveValue('two minutes');
  });

  test("the seller's waiting room keeps its one primary in two panes: Chat goes to the chat pane (review M4)", async ({ page }) => {
    await page.setViewportSize({ width: 840, height: 900 });
    await openRoom(page, { ...PAY_SECURED, role: 'seller' });
    const primary = page.locator('[data-primary]');
    await expect(primary).toHaveCount(1);
    await expect(primary).toBeVisible();
    await expect(primary).toHaveText('Chat');
    await primary.click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('[data-pane="side"] #msg')).toBeFocused();
  });

  test('the chat pane is a whole screen tall, its composer at the bottom and Send off the edge (design review 51, 52)', async ({ page }) => {
    await page.setViewportSize({ width: 884, height: 1104 });
    await openRoom(page);
    const aside = await box(page, '[data-pane="side"] .x2f-room__aside');
    expect(aside.y).toBeLessThanOrEqual(0.5);
    expect(aside.y + aside.height).toBeGreaterThanOrEqual(1104 - 0.5);
    const send = await box(page, '[data-pane="side"] button:text-is("Send")');
    expect(send.y + send.height).toBeGreaterThan(1104 - 100);
    expect(send.x + send.width).toBeLessThanOrEqual(884 - 15.5);
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
    await expect(page.locator('.x2f-sheet')).toBeVisible();
    const dialog = await box(page, '.x2f-sheet');
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
    // Fold-Tabletop (design review 56): "I've paid" is on screen in the bottom half, and what the
    // glance shows is not shown again below it.
    const paid = await box(page, '[data-primary]');
    expect(paid.y).toBeGreaterThanOrEqual(428 - 0.5);
    expect(paid.y + paid.height).toBeLessThanOrEqual(840 + 0.5);
    await expect(page.locator('[data-primary]')).toHaveText("I've paid");
    await expect(glance).toContainText('Waiting for your payment');
    await expect(glance.locator('[data-glance-pay]')).toContainText('Send exactly');
    await expect(glance.locator('[data-glance-memo]')).toContainText(PAY_SECURED.code);
    for (const part of ['header', 'timer', 'pay']) await expect(page.locator(`[data-pane="main"] [data-fold-glance="${part}"]`)).toBeHidden();
    // A sheet opens in the bottom half.
    await page.locator('[data-primary]').first().click();
    expect((await box(page, '.x2f-sheet')).y).toBeGreaterThanOrEqual(428 - 0.5);
    await page.keyboard.press('Escape');
    // Flat again: off by itself.
    await halfFold.flat();
    await expect(page.locator('html')).toHaveAttribute('data-fold', 'wide');
    await expect(page.locator('[data-pane="glance"]')).toHaveCount(0);
  });
});

/** Emulates a folded posture with no segments (a flip phone on its cover screen; Device Posture API). */
async function folded(page: Page, size: { width: number; height: number }): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { ...size, deviceScaleFactor: 1, mobile: false, devicePosture: { type: 'folded' } });
  return cdp;
}

test.describe('the flip cover screen', () => {
  test('a folded posture on a small screen: the trade card first, the room still under it, the chat draft kept', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openRoom(page);
    await page.locator('[data-chat-link]').click();
    await page.locator('#msg').fill('sent it');
    await page.keyboard.press('Escape');
    const cdp = await folded(page, { width: 360, height: 380 });
    await needSegments(page, '(device-posture: folded)');
    await expect(page.locator('html')).toHaveAttribute('data-fold', 'cover');
    const card = page.locator('[data-pane="glance"]');
    await expect(card).toContainText('Buying from');
    await expect(card).toContainText('$412.50');
    // Fold-Cover: logo D (the board's "X2F"), the pill from the trade's state (never the API's
    // escrow chip), and one button, which takes no trade action.
    await expect(card.getByRole('img', { name: 'X2F' })).toBeVisible();
    await expect(card.locator('.x2f-chip')).toHaveText('Pay now');
    expect(await card.locator('a, input, select, textarea').count()).toBe(0);
    await expect(card.locator('button')).toHaveCount(1);
    await card.getByRole('button', { name: 'Open on main screen' }).click();
    await expect(card.getByRole('status')).toHaveText('Open your phone to keep going.');
    // The card fills the cover screen: nothing of the room shows under it (design review 55).
    expect((await box(page, '[data-pane="glance"]')).height).toBeGreaterThanOrEqual(380 - 0.5);
    expect((await box(page, '[data-pane="main"] .x2f-pay')).y).toBeGreaterThanOrEqual(380 - 0.5);
    // A wrong guess costs nothing: the room and its primary action are right under the card.
    await expect(page.locator('[data-pane="main"] .x2f-pay[data-layout="phone"]')).toBeAttached();
    await page.locator('[data-primary]').first().scrollIntoViewIfNeeded();
    await expect(page.locator('[data-primary]').first()).toBeVisible();
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await expect(page.locator('html')).toHaveAttribute('data-fold', 'phone');
    await page.locator('[data-chat-link]').click();
    await expect(page.locator('#msg')).toHaveValue('sent it');
  });

  test("the device's own warning shows on the card: a stopped escrow (review I1)", async ({ page }) => {
    await folded(page, { width: 360, height: 380 });
    await openRoom(page);
    await needSegments(page, '(device-posture: folded)');
    await page.evaluate(() => window.__x2fSetFixtureEscrow!({ phase: 'error', error: 'escrow-failed', retryable: true }));
    await expect(page.locator('[data-pane="glance"] [data-glance-warning]')).toContainText("Don't send any money until it runs again.");
  });

  test("the room under the card keeps its Chat link: SellerRefund's Chat opens the chat sheet (round-2 review m3)", async ({ page }) => {
    await folded(page, { width: 360, height: 380 });
    await openRoom(page, sellerView({ code: PAY_SECURED.code }));
    await needSegments(page, '(device-posture: folded)');
    await expect(page.locator('html')).toHaveAttribute('data-fold', 'cover');
    const link = page.locator('[data-pane="main"] [data-chat-link]');
    await link.scrollIntoViewIfNeeded();
    await link.click();
    expect(new URL(page.url()).hash).toBe('#chat');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').locator('#msg')).toBeVisible();
  });

  test('an integrity failure shows its alert in every layout, the cover included (review I1)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openRoom(page);
    await page.evaluate(() => window.__x2fSetFixtureEscrow!({ phase: 'error', error: 'participants-mismatch' }));
    const alert = page.getByText('Security check failed', { exact: false }).first();
    await expect(alert).toBeVisible();
    for (const size of [
      { width: 840, height: 900 },
      { width: 1100, height: 900 },
      { width: 412, height: 430 },
    ]) {
      await page.setViewportSize(size);
      await expect(alert).toBeVisible();
    }
    const cdp = await folded(page, { width: 360, height: 380 });
    await needSegments(page, '(device-posture: folded)');
    await expect(page.locator('html')).toHaveAttribute('data-fold', 'cover');
    await expect(alert).toBeVisible();
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 840, deviceScaleFactor: 1, mobile: false, displayFeature: { orientation: 'horizontal', offset: 412, maskLength: 16 } });
    await expect(page.locator('html')).toHaveAttribute('data-fold', 'tabletop');
    await expect(alert).toBeVisible();
  });

  for (const [what, size] of [
    ['a phone in split screen (412x430)', { width: 412, height: 430 }],
    ['a small desktop window (500x450)', { width: 500, height: 450 }],
  ] as const) {
    test(`size alone is never the cover screen: ${what} keeps the phone layout (review I2)`, async ({ page }) => {
      await page.setViewportSize(size);
      await openRoom(page);
      expect(await fold(page)).toBe('phone');
      await expect(page.locator('[data-pane="glance"]')).toHaveCount(0);
      await page.locator('[data-primary]').first().scrollIntoViewIfNeeded();
      await expect(page.locator('[data-primary]').first()).toBeVisible();
      await expect(page.locator('[data-primary]').first()).toBeEnabled();
    });
  }

  test('the keyboard shrinking the viewport (360x640 to 360x360) keeps the phone layout and the focused input (review I2)', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await openRoom(page);
    await page.locator('[data-chat-link]').click();
    const input = page.getByRole('dialog').locator('#msg');
    await input.focus();
    await page.setViewportSize({ width: 360, height: 360 });
    expect(await fold(page)).toBe('phone');
    await expect(input).toBeFocused();
    await input.pressSequentially('ok');
    await expect(input).toHaveValue('ok');
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

test.describe('screens with two panes: nothing across the hinge (design review 53, 54)', () => {
  async function offers(page: Page): Promise<void> {
    await stubBrowseApi(page, { signedIn: true, live: { USD: BOARD_SELL_LIVE_USD }, offers: (c) => (c === 'USD' ? boardSellOffers() : []), market: { USD: BOARD_SELL_OFFERS.marketCentsPerXmr } });
    await page.route('**/v1/wallets', (r) => r.fulfill({ json: [...B.wallets] }));
    await page.route('**/v1/wallets/rule', (r) => r.fulfill({ json: { firstWallet: false, strongMethods: [], password: 'immediate', waitHours: 24 } }));
  }

  for (const hingeReported of [false, true]) {
    test(`Fold-Offers: the list picks, the quote beside it has the one Trade${hingeReported ? ' (hinge reported)' : ''}`, async ({ page }) => {
      const size = hingeReported ? { width: 840, height: 900 } : { width: 884, height: 1104 };
      const gap = hingeReported ? [HINGE.offset, HINGE.offset + HINGE.mask] : [size.width / 2 - 8, size.width / 2 + 8];
      await page.setViewportSize(size);
      if (hingeReported) await hinge(page, size, 'vertical', HINGE.offset);
      await offers(page);
      await page.goto(`${ORIGIN}/sell/ZELLE`);
      if (hingeReported) await needSegments(page, '(horizontal-viewport-segments: 2)');
      expect(await fold(page)).toBe('two');
      const rows = page.locator('[data-pane="main"] button[aria-pressed]');
      await expect(rows.first()).toHaveAttribute('aria-pressed', 'true');
      const side = page.locator('[data-pane="side"]');
      await expect(side.locator('#quote-amount')).toBeVisible();
      await expect(page.locator('[data-primary]')).toHaveCount(1);
      await expect(side.locator('[data-primary]')).toHaveText('Trade');
      // The list's own back link stays; the quote's is left out (the list is beside it).
      await expect(side.getByRole('link', { name: /^Back to/ })).toHaveCount(0);
      expect(await crossing(page, 'x', gap[0]!, gap[1]!)).toEqual([]);
      await expectPhoneLayout(page);
      // Picking another row shows its quote, keeps the typed amount, and folding shows that quote.
      await side.locator('#quote-amount').fill('100');
      const second = rows.nth(1);
      const who = (await second.locator('[data-username]').textContent())!;
      await second.click();
      await expect(second).toHaveAttribute('aria-pressed', 'true');
      await expect(side).toContainText(who);
      await expect(side.locator('#quote-amount')).toHaveValue('100');
      expect(new URL(page.url()).pathname).toMatch(/^\/sell\/ZELLE\/[^/]+$/);
      if (!hingeReported) {
        await page.setViewportSize({ width: 390, height: 844 });
        await expect(page.locator('[data-screen="quote"]')).toContainText(who);
        await expect(page.locator('[data-pane="side"]')).toHaveCount(0);
        await page.goBack();
        await expect(page.locator('.x2f-browse')).toBeVisible();
      }
    });
  }

  test('Fold-Offers, nothing picked: an amount typed in the pane quote stays across a fold, and Back returns to the list (review 2026-11-06 m2)', async ({ page }) => {
    await page.setViewportSize({ width: 884, height: 1104 });
    await offers(page);
    await page.goto(`${ORIGIN}/sell/ZELLE`);
    expect(await fold(page)).toBe('two');
    const side = page.locator('[data-pane="side"]');
    const first = page.locator('[data-pane="main"] button[aria-pressed="true"]');
    const who = (await first.locator('[data-username]').textContent())!;
    expect(new URL(page.url()).pathname).toBe('/sell/ZELLE');
    await side.locator('#quote-amount').fill('100');
    await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/sell\/ZELLE\/[^/]+$/);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('[data-screen="quote"]')).toContainText(who);
    await expect(page.locator('#quote-amount')).toHaveValue('100');
    await page.goBack();
    await expect(page.locator('.x2f-browse')).toBeVisible();
  });

  test('Fold-MyOffers: the list, and the picked offer\'s details with its switch beside it', async ({ page }) => {
    await page.setViewportSize({ width: 884, height: 1104 });
    const list = [
      { id: '11111111-1111-4111-8111-111111111111', side: 'sell', methodId: 'ZELLE', methodName: 'Zelle', currency: 'USD', rate: '33165', pricing: { mode: 'market', marginBps: 50 }, minFiatCents: '5000', maxFiatCents: '200000', minTrades: 0, status: 'live', createdAt: '2026-10-29T10:00:00.000Z' },
      { id: '22222222-2222-4222-8222-222222222222', side: 'buy', methodId: 'REVOLUT', methodName: 'Revolut', currency: 'EUR', rate: '30000', pricing: { mode: 'fixed', centsPerXmr: '30000' }, minFiatCents: '1250', maxFiatCents: '50000', minTrades: 5, status: 'paused', createdAt: '2026-10-29T09:00:00.000Z' },
    ];
    await page.route('**/v1/account/me', (r) => r.fulfill({ json: { displayName: 'nightowl_44', kind: 'trader', level: 'full', termsCurrent: true } }));
    await page.route('**/v1/account/offers', (r) => r.fulfill({ json: list }));
    await page.goto(`${ORIGIN}/profile/offers`);
    const side = page.locator('[data-pane="side"]');
    await expect(side).toContainText('Selling XMR · USD');
    await page.locator('[data-pane="main"] button[aria-pressed]').nth(1).click();
    await expect(side).toContainText('Buying XMR · EUR');
    await expect(side.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    expect(await crossing(page, 'x', 884 / 2 - 8, 884 / 2 + 8)).toEqual([]);
    await expectPhoneLayout(page);
  });
});
