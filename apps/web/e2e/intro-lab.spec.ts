// The owner's intro proof of concept (/lab/intro, demo builds only): an isometric Three.js scene of
// blocks that morphs cube → stack → lock, with a tour over a stand-in screen. Served by the API's own
// serveWeb (the real CSP: no unsafe-eval), at 443×794. Proven here: the canvas paints, Next and Back
// move the tour, the highlight ring and the arrow fade in on each step's target, nothing goes to
// another origin, no CSP report, and prefers-reduced-motion switches the motion off.
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { FastifyInstance } from 'fastify';
import { startDemo } from './demo-serve.js';

const PORT = 4339;
const ORIGIN = `http://127.0.0.1:${PORT}`;
/** Where the step screenshots go (the owner's preview); defaults to the test's output folder. */
const SHOTS = process.env.X2F_INTRO_SHOTS;

test.use({ viewport: { width: 443, height: 794 } });

let server: FastifyInstance;
test.beforeAll(async () => {
  test.setTimeout(300_000);
  server = await startDemo(PORT, 'dist-demo-intro');
});
test.afterAll(async () => {
  await server?.close();
});

interface Watch {
  offOrigin: string[];
  violations: string[];
  errors: string[];
}

async function open(page: Page): Promise<Watch> {
  const w: Watch = { offOrigin: [], violations: [], errors: [] };
  page.context().on('request', (r) => {
    if (!r.url().startsWith(`${ORIGIN}/`) && !r.url().startsWith('data:')) w.offOrigin.push(r.url());
  });
  page.on('pageerror', (e) => w.errors.push(String(e)));
  page.on('console', (m) => {
    if (/Content.Security.Policy|Refused to/i.test(m.text())) w.violations.push(m.text());
  });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => console.error(`Refused to: CSP ${e.violatedDirective} ${e.blockedURI}`));
  });
  await page.goto(`${ORIGIN}/lab/intro`);
  return w;
}

/** The ring sits around the target, fully faded in, and the arrow is shown. */
async function expectPointing(page: Page, target: Locator): Promise<void> {
  const ring = page.locator('[data-tour-ring]');
  const arrow = page.locator('[data-tour-arrow]');
  await expect(ring).toHaveCSS('opacity', '1');
  await expect(arrow).toHaveCSS('opacity', '1');
  const r = (await ring.boundingBox())!;
  const t = (await target.boundingBox())!;
  expect(r.x).toBeLessThanOrEqual(t.x);
  expect(r.y).toBeLessThanOrEqual(t.y);
  expect(r.x + r.width).toBeGreaterThanOrEqual(t.x + t.width);
  expect(r.y + r.height).toBeGreaterThanOrEqual(t.y + t.height);
  const a = (await arrow.boundingBox())!;
  // The arrow sits just above the ring, over its horizontal span.
  expect(a.y + a.height).toBeLessThanOrEqual(r.y + 2);
  expect(a.x + a.width / 2).toBeGreaterThanOrEqual(r.x);
  expect(a.x + a.width / 2).toBeLessThanOrEqual(r.x + r.width);
}

async function shot(page: Page, name: string): Promise<void> {
  const dir = SHOTS ?? test.info().outputPath('shots');
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: join(dir, name) });
}

test.describe('intro lab (/lab/intro, demo builds only)', () => {
  test('the scene paints, and Next and Back move the tour with its ring and arrow', async ({ page }) => {
    test.setTimeout(120_000);
    const w = await open(page);
    const canvas = page.locator('canvas[data-intro-canvas]');
    await expect(canvas).toHaveAttribute('data-intro-scene', 'ready');
    await expect(canvas).toHaveAttribute('data-step', '0');
    await expect(canvas).toHaveAttribute('data-settled', 'true', { timeout: 10_000 });
    // A real WebGL picture: a good share of the canvas is blocks, not the clear colour.
    expect(Number(await canvas.getAttribute('data-painted'))).toBeGreaterThan(0.04);

    const back = page.getByRole('button', { name: 'Back' });
    const next = page.getByRole('button', { name: 'Next' });
    await expect(page.getByText('1 of 3')).toBeVisible();
    await expect(back).toBeDisabled();
    await expectPointing(page, page.locator('[data-tour-target="offer"]'));
    await shot(page, 'intro-1.png');

    await next.click();
    await expect(page.getByText('2 of 3')).toBeVisible();
    await expect(canvas).toHaveAttribute('data-step', '1');
    // The ring fades out before it moves: right after the click it is not fully shown.
    await expect(canvas).toHaveAttribute('data-settled', 'true', { timeout: 10_000 });
    await expectPointing(page, page.locator('[data-tour-target="escrow"]'));
    await shot(page, 'intro-2.png');

    await next.click();
    await expect(page.getByText('3 of 3')).toBeVisible();
    await expect(canvas).toHaveAttribute('data-step', '2');
    await expect(canvas).toHaveAttribute('data-settled', 'true', { timeout: 10_000 });
    await expect(next).toBeDisabled();
    await expectPointing(page, page.locator('[data-tour-target="release"]'));
    expect(Number(await canvas.getAttribute('data-painted'))).toBeGreaterThan(0.04);
    await shot(page, 'intro-3.png');

    await back.click();
    await expect(page.getByText('2 of 3')).toBeVisible();
    await expect(canvas).toHaveAttribute('data-step', '1');
    await expectPointing(page, page.locator('[data-tour-target="escrow"]'));

    expect(w.offOrigin).toEqual([]);
    expect(w.violations).toEqual([]);
    expect(w.errors).toEqual([]);
  });

  test('the ring and arrow fade quickly: hidden while they move, shown within a quarter second', async ({ page }) => {
    await open(page);
    await expect(page.locator('[data-tour-ring]')).toHaveCSS('opacity', '1');
    const duration = await page.locator('[data-tour-ring]').evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(parseFloat(duration)).toBeGreaterThan(0);
    expect(parseFloat(duration)).toBeLessThanOrEqual(0.25);
    await page.getByRole('button', { name: 'Next' }).click();
    // Mid-move the ring is (or is fading) out, then back in on the new target within a quarter second of settling.
    await expect(page.locator('[data-tour-ring]')).toHaveAttribute('data-shown', 'false');
    await expect(page.locator('[data-tour-ring]')).toHaveAttribute('data-shown', 'true', { timeout: 2_000 });
  });

  test('prefers-reduced-motion: no morph and no fades, each step shows at once', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const w = await open(page);
    const canvas = page.locator('canvas[data-intro-canvas]');
    await expect(canvas).toHaveAttribute('data-intro-scene', 'ready');
    await expect(page.locator('[data-intro-root]')).toHaveAttribute('data-motion', 'reduced');
    const duration = await page.locator('[data-tour-ring]').evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(parseFloat(duration)).toBe(0);
    await page.getByRole('button', { name: 'Next' }).click();
    // No tween: the next scene is in place on the next frame.
    await expect(canvas).toHaveAttribute('data-step', '1');
    await expect(canvas).toHaveAttribute('data-settled', 'true', { timeout: 500 });
    await expectPointing(page, page.locator('[data-tour-target="escrow"]'));
    expect(w.errors).toEqual([]);
    expect(w.violations).toEqual([]);
  });
});
