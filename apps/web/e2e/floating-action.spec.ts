// Owner 17 Nov 2026 (to claude2, after the font-D Post offer screenshots): "The orange button should
// be floating or on its own. It doesn't need a background." Every bottom-docked primary-action bar
// (Post offer's footer, the list screens' ActionBar) has no fill, no top line and no shadow: the
// orange button floats over the page's own background, in the same place and size. The page can
// still be scrolled so its last control sits fully above the button (the bar keeps its height in
// the flow, so the content ends button height + gap above the screen's bottom).
//
// With X2F_OWNER_SHOTS=1 the last test also writes the owner's after-screenshots of Post offer
// (1366x768 and 390x844, the same view as owner-review/fonts/after/) into
// owner-review/fonts/after-floating/ at the repo root of the main checkout (X2F_OWNER_SHOTS_DIR).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page, type Route } from '@playwright/test';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
type CatalogEntry = { id: string; name: string; group: string; legalReview?: string };
const CATALOG = (JSON.parse(readFileSync(`${ROOT}data/payment-methods.json`, 'utf8')) as { methods: CatalogEntry[] }).methods;
const ROWS = CATALOG.filter((m) => m.legalReview === undefined)
  .map((m) => ({ id: m.id, name: m.name, group: m.group, giftCard: m.group === 'Gift cards & vouchers', offers: 0, bestRate: null }))
  .sort((a, b) => a.name.localeCompare(b.name, 'en'));

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const VENDOR = { displayName: 'nightowl_44', kind: 'trader', accountType: 'vendor', level: 'full', termsCurrent: true };

async function stubPost(page: Page): Promise<void> {
  await page.route('**/v1/account/me', json(VENDOR));
  await page.route(/\/v1\/methods\?/, json({ live: [], all: ROWS }));
  await page.route('**/v1/offers?*', json([]));
  await page.route(/\/v1\/price\?/, (r) => {
    const currency = new URL(r.request().url()).searchParams.get('currency') ?? 'USD';
    return json({ currency, centsPerXmr: '32990', usdCentsPerXmr: '32990', exponent: 2, at: '2026-10-24T12:00:00.000Z' })(r);
  });
}

const SIZES = [
  { name: 'desktop', width: 1366, height: 768 },
  { name: 'phone', width: 390, height: 844 },
] as const;

/**
 * No bar: no fill colour, no top line, no shadow. A fade is allowed (owner 17 Nov follow-up) only in
 * the page's own ground colour (any alpha), so it is invisible as a shape.
 */
async function expectFloating(bar: Locator): Promise<void> {
  const s = await bar.evaluate((el) => {
    const c = getComputedStyle(el);
    let page = 'rgba(0, 0, 0, 0)';
    for (let p = el.parentElement; p; p = p.parentElement) {
      const bg = getComputedStyle(p).backgroundColor;
      if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
        page = bg;
        break;
      }
    }
    return { page, bg: c.backgroundColor, bgImage: c.backgroundImage, borderTop: c.borderTopWidth, borderTopStyle: c.borderTopStyle, shadow: c.boxShadow };
  });
  expect(s.bg, 'no fill behind the button').toBe('rgba(0, 0, 0, 0)');
  if (s.bgImage !== 'none') {
    const rgb = (c: string) => c.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number).join(',');
    const colours = s.bgImage.match(/rgba?\([^)]*\)/g) ?? [];
    expect(colours.length, `a fade only: ${s.bgImage}`).toBeGreaterThan(0);
    for (const c of colours) expect(rgb(c), `the fade is the page's own colour (${s.page}), not another shade`).toBe(rgb(s.page));
  }
  expect(s.borderTopStyle === 'none' || s.borderTop === '0px', `no top line (${s.borderTop} ${s.borderTopStyle})`).toBe(true);
  expect(s.shadow).toBe('none');
}

/** Scrolls to the bottom and checks the last focusable control above the bar is fully above the button. */
async function expectLastFieldClear(page: Page, scope: Locator, button: Locator): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  const last = await scope.evaluate((el) => {
    const all = Array.from(el.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(
      (n) => n.checkVisibility() && n.getBoundingClientRect().height > 0,
    );
    const n = all[all.length - 1]!;
    return n.getBoundingClientRect().bottom;
  });
  const b = await button.boundingBox();
  expect(b).not.toBeNull();
  expect(b!.height, 'the button keeps its 44 px+ tap target').toBeGreaterThanOrEqual(44);
  expect(last, 'the last field scrolls fully above the floating button').toBeLessThanOrEqual(b!.y);
}

for (const size of SIZES) {
  test(`Post offer: the orange button floats with no bar behind it, last field clear (${size.width})`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await stubPost(page);
    await page.goto('/post');
    const button = page.getByRole('button', { name: 'Post offer', exact: true });
    await expect(button).toBeVisible();
    await expectFloating(page.locator('.post-footer'));
    await expectLastFieldClear(page, page.locator('.post-main'), button);
  });

  test(`My offers: the action bar is transparent around its orange button (${size.width})`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.route('**/v1/account/me', json(VENDOR));
    await page.route('**/v1/account/offers', json([]));
    await page.goto('/profile/offers');
    const button = page.locator('[data-part="post"]');
    await expect(button).toBeVisible();
    await expectFloating(page.locator('.x2f-action-bar'));
  });
}

// Lead, 17 Nov (another build crashed Post offer when browser storage is blocked: a localStorage read
// during render with no try/catch). A browser that blocks site data throws a SecurityError on the
// very getter (window.localStorage, window.sessionStorage, document.cookie). With all three throwing,
// and with the CAPS switch on and off, Post offer and its orange button still draw.
async function blockStorage(page: Page): Promise<void> {
  await page.addInitScript(() => {
    for (const name of ['localStorage', 'sessionStorage'] as const) {
      Object.defineProperty(window, name, {
        configurable: true,
        get() {
          throw new DOMException(`The access to ${name} is denied for this document.`, 'SecurityError');
        },
      });
    }
    Object.defineProperty(Document.prototype, 'cookie', {
      configurable: true,
      get() {
        throw new DOMException('Access is denied for this document.', 'SecurityError');
      },
      set() {
        throw new DOMException('Access is denied for this document.', 'SecurityError');
      },
    });
  });
}

for (const caps of [false, true]) {
  test(`Post offer draws with browser storage blocked (CAPS ${caps ? 'on' : 'off'})`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await blockStorage(page);
    await stubPost(page);
    await page.goto('/post');
    const button = page.getByRole('button', { name: 'Post offer', exact: true });
    await expect(button).toBeVisible();
    // The switch is an attribute on <html> (ui.css data-button-case), set as the owner shots set it.
    if (caps) await page.evaluate(() => (document.documentElement.dataset.buttonCase = 'upper'));
    await expect(page.locator('[data-primary]')).toHaveCount(1);
    await expect(page.getByLabel('Add a payment method')).toBeVisible();
    const blocked = await page.evaluate(() => {
      try {
        void window.localStorage;
        return false;
      } catch {
        return true;
      }
    });
    expect(blocked, 'the stub really blocks storage').toBe(true);
    if (caps) await expect(button).toHaveCSS('text-transform', 'uppercase');
    expect(errors, 'no uncaught error').toEqual([]);
  });
}

test('owner after-screenshots of Post offer (floating button)', async ({ page }) => {
  test.skip(process.env.X2F_OWNER_SHOTS !== '1', 'set X2F_OWNER_SHOTS=1 to write the owner screenshots');
  const out = process.env.X2F_OWNER_SHOTS_DIR ?? '/home/user/X2F/owner-review/fonts/after-floating/';
  await stubPost(page);
  for (const size of SIZES) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto('/post');
    await expect(page.getByRole('button', { name: 'Post offer', exact: true })).toBeVisible();
    await expect(page.getByLabel('Add a payment method')).toBeVisible();
    await page.evaluate(async () => {
      await document.fonts.ready;
      window.scrollTo(0, 0);
    });
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `${out}after_${size.name}_post.png`, animations: 'disabled', caret: 'hide' });
    // The owner's CAPS variant (ui.css data-button-case), switched on for this shot only.
    await page.evaluate(async () => {
      document.documentElement.dataset.buttonCase = 'upper';
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    });
    const caps = await page.getByRole('button', { name: 'Post offer', exact: true }).evaluate((b) => {
      const range = document.createRange();
      range.selectNodeContents(b);
      const box = b.getBoundingClientRect();
      const t = range.getBoundingClientRect();
      return { transform: getComputedStyle(b).textTransform, left: t.left - box.left, right: box.right - t.right };
    });
    expect(caps.transform).toBe('uppercase');
    expect(Math.min(caps.left, caps.right)).toBeGreaterThanOrEqual(16);
    await page.screenshot({ path: `${out}after_${size.name}_post_CAPS.png`, animations: 'disabled', caret: 'hide' });
    await page.evaluate(() => {
      delete document.documentElement.dataset.buttonCase;
    });
  }
});
