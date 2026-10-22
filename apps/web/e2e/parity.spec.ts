import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, test, type Page } from '@playwright/test';
import { KNOWN_EXCEPTIONS, boardTexts, expectParity, missingTexts, withoutBoardMarkers } from './parity.js';

const run = promisify(execFile);
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const TSX = join(REPO, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const CAPTURE = join(REPO, 'tools', 'parity', 'capture-refs.ts');

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A page that carries every text of `board`, one per element, with `extra` HTML after them. */
async function pageWithBoardTexts(page: Page, board: string, extra = '<button data-primary>Go</button>'): Promise<void> {
  const texts = await boardTexts(page, board);
  await page.setContent(`<!doctype html><html><body style="margin:0">${texts.map((t) => `<p>${escape(t)}</p>`).join('')}${extra}</body></html>`);
}

test.describe('expectParity: blocking checks', () => {
  test('a page with every board text and one [data-primary] passes; the pixel diff is only reported', async ({ page }) => {
    await pageWithBoardTexts(page, 'Review');
    await expectParity(page, 'Review');
    const pixels = test.info().annotations.filter((a) => a.type === 'parity-pixels');
    expect(pixels).toHaveLength(1);
    expect(pixels[0]!.description).toMatch(/^Review 390x844: /);
  });

  test('fails a page with two [data-primary]', async ({ page }) => {
    await pageWithBoardTexts(page, 'Review', '<button data-primary>Submit rating</button><button data-primary>Skip</button>');
    await expect(expectParity(page, 'Review')).rejects.toThrow(/exactly one \[data-primary\], found 2/);
  });

  test('fails a page with no [data-primary]', async ({ page }) => {
    await pageWithBoardTexts(page, 'Review', '');
    await expect(expectParity(page, 'Review')).rejects.toThrow(/exactly one \[data-primary\], found 0/);
  });

  test('fails a page that scrolls sideways', async ({ page }) => {
    await pageWithBoardTexts(page, 'Review', '<button data-primary>Go</button><div style="width: 600px; height: 4px"></div>');
    await expect(expectParity(page, 'Review')).rejects.toThrow(/horizontal scroll: 600 px wide in a 390 px viewport/);
  });

  test('fails a username shown with text-transform', async ({ page }) => {
    await pageWithBoardTexts(page, 'Review', '<button data-primary>Go</button><span data-username style="text-transform: uppercase">mira.k</span>');
    await expect(expectParity(page, 'Review')).rejects.toThrow(/text-transform uppercase on \[data-username\] "mira.k"/);
  });

  test('fails when board copy is missing or reworded, and names it', async ({ page }) => {
    const texts = await boardTexts(page, 'Review');
    const reworded = texts.map((t) => (t === '1.237500 XMR is yours' ? '1.237500 XMR is now yours' : t));
    await page.setContent(`<body>${reworded.map((t) => `<p>${escape(t)}</p>`).join('')}<button data-primary>Go</button></body>`);
    await expect(expectParity(page, 'Review')).rejects.toThrow(/board copy missing: "1.237500 XMR is yours"/);
  });

  test("compares each element's whole text, so copy split across nodes still matches", async ({ page }) => {
    await page.setContent(
      '<header><span>Trade K7M2-9QXA-4FTR-8WPN · <button>Zelle</button></span><span>Selling to <b data-username>mira.k</b></span></header>',
    );
    expect(await missingTexts(page, ['Trade K7M2-9QXA-4FTR-8WPN · Zelle', 'Selling to mira.k', 'Zelle'])).toEqual([]);
    expect(await missingTexts(page, ['Trade K7M2-9QXA-4FTR-8WPN'])).toEqual(['Trade K7M2-9QXA-4FTR-8WPN']);
  });

  test('a masked region stands in for the changing part of a text', async ({ page }) => {
    await page.setContent('<p>You pay · <span data-mask="clock">1 h 2 min</span> left</p>');
    expect(await missingTexts(page, ['You pay · 62 min left'])).toEqual([]);
    expect(await missingTexts(page, ['You get · 62 min left'])).toEqual(['You get · 62 min left']);
    // A masked region can also stand in for one text of its own with a number in it, and only one.
    await page.setContent('<p><span class="m">28:12</span></p>');
    const m = [page.locator('.m')];
    expect(await missingTexts(page, ['28:42'])).toEqual(['28:42']);
    expect(await missingTexts(page, ['28:42'], m)).toEqual([]);
    expect(await missingTexts(page, ['28:42', '10:00'], m)).toEqual(['10:00']);
    expect(await missingTexts(page, ['Released'], m)).toEqual(['Released']);
  });
});

test.describe('board texts', () => {
  test('board-only "Example" markers and example notes are not required', async ({ page }) => {
    expect(withoutBoardMarkers('Trade K7M2-9QXA-4FTR-8WPN · Zelle · Example')).toBe('Trade K7M2-9QXA-4FTR-8WPN · Zelle');
    expect(withoutBoardMarkers('Sellers and prices are examples. You pay no X2F fee when you take an offer.')).toBe(
      'You pay no X2F fee when you take an offer.',
    );
    expect(withoutBoardMarkers('Buyer counts and rates are examples.')).toBe('');
    const confirm = await boardTexts(page, 'SellerConfirm');
    expect(confirm).toContain('Trade K7M2-9QXA-4FTR-8WPN · Zelle');
    expect(confirm).toContain('Check your bank account for $412.50 sent via Zelle');
    for (const board of ['SellerConfirm', 'Main', 'BuyOffers', 'SetupPgpKey']) {
      for (const t of await boardTexts(page, board)) expect(t, board).not.toMatch(/\b(examples?|samples?)\b/i);
    }
    expect(await boardTexts(page, 'BuyOffers')).toContain('You pay no X2F fee when you take an offer.');
  });

  test('template placeholders, scripts and branches hidden by default are left out', async ({ page }) => {
    const main = await boardTexts(page, 'Main');
    expect(main).toContain('How do you want to get paid?');
    expect(main.some((t) => t.includes('{{'))).toBe(false);
    // The empty-search copy sits in an <sc-if> that is off on the board.
    const review = await boardTexts(page, 'Review');
    expect(review).toContain('How was trading with satoshi_ghost?');
    expect(review).not.toContain("Rating saved. satoshi_ghost sees it once they've rated you too.");
  });

  test('known Desktop-board exceptions are listed with a reason and not required', async ({ page }) => {
    const desktop = KNOWN_EXCEPTIONS.Desktop ?? [];
    expect(desktop.map((e) => e.text)).toContain('You pay · 62 min left');
    for (const e of desktop) expect(e.why.length).toBeGreaterThan(10);
    const texts = await boardTexts(page, 'Desktop');
    for (const e of desktop) expect(texts).not.toContain(e.text);
    expect(texts).toContain('Escrow funded');
    expect(texts).toContain('Trade K7M2-9QXA-4FTR-8WPN · Zelle');
  });
});

test('the 1280×800 header text matches the Desktop board', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/sell');
  await expect(page.locator('[data-shell="desktop"]')).toBeAttached();
  const header = await boardTexts(page, 'Desktop', { within: 'header' });
  expect(header).toEqual(['X2F', 'Buy', 'Sell', 'My trades', 'Wallets']);
  expect(await missingTexts(page, header)).toEqual([]);
});

test.describe('capture-refs', () => {
  // Run as the command a person runs (tsx), with the boards and output pointed at a temp folder.
  async function capture(...args: string[]): Promise<{ code: number; out: string }> {
    try {
      const r = await run(process.execPath, [TSX, CAPTURE, ...args], { cwd: REPO, env: process.env, timeout: 60_000 });
      return { code: 0, out: r.stdout + r.stderr };
    } catch (e) {
      const err = e as { code?: number; stdout?: string; stderr?: string };
      return { code: err.code ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
  }
  let dir = '';
  test.beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'x2f-boards-'));
    await writeFile(
      join(dir, 'canvas.json'),
      JSON.stringify({ boards: { 'Tiny.dc.html': { w: 200, h: 120 }, 'Other.dc.html': { w: 100, h: 100 } } }),
    );
    const board = '<!doctype html><html><head><script src="./support.js"></script></head><body style="margin:0"><x-dc><div style="width:200px;height:120px;background:#0e1116"></div></x-dc></body></html>';
    await writeFile(join(dir, 'Tiny.dc.html'), board);
    await writeFile(join(dir, 'Other.dc.html'), board);
  });
  test.afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('refuses to run without the canvas runtime (support.js)', async () => {
    const r = await capture(`--boards-dir=${dir}`, `--out-dir=${join(dir, 'refs')}`);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/support\.js is missing/);
  });

  test('screenshots each chosen board at its canvas.json size', async () => {
    await writeFile(join(dir, 'support.js'), '');
    const r = await capture(`--boards-dir=${dir}`, `--out-dir=${join(dir, 'refs')}`, 'Tiny');
    expect(r.out).toContain('capture-refs: wrote 1 reference');
    const png = await readFile(join(dir, 'refs', 'Tiny.png'));
    // PNG IHDR: width and height are big-endian at bytes 16 and 20.
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([200, 120]);
    await expect(readFile(join(dir, 'refs', 'Other.png'))).rejects.toThrow();
  });
});
