import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, test, type Page } from '@playwright/test';
import { KNOWN_EXCEPTIONS, boardTexts, expectParity, missingTexts, reportPixels, withoutBoardMarkers } from './parity.js';

const run = promisify(execFile);
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const TSX = join(REPO, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const CAPTURE = join(REPO, 'tools', 'parity', 'capture-refs.ts');

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A page that carries every text of `board`, one per element, with `extra` HTML after them. */
async function pageWithBoardTexts(page: Page, board: string, extra = '<button data-primary>Go</button>'): Promise<void> {
  const texts = await boardTexts(page, board);
  // A {{…}} placeholder (MASK) is filled with a sample value, as the app would fill it.
  await page.setContent(
    `<!doctype html><html><body style="margin:0">${texts.map((t) => `<p>${escape(t.replaceAll('\u0000', '7'))}</p>`).join('')}${extra}</body></html>`,
  );
}

test.describe('expectParity: blocking checks', () => {
  test('a page with every board text and one [data-primary] passes; the pixel diff is only reported', async ({ page }) => {
    await pageWithBoardTexts(page, 'Review');
    await expectParity(page, 'Review');
    const pixels = test.info().annotations.filter((a) => a.type === 'parity-pixels');
    expect(pixels).toHaveLength(1);
    // This bare text page looks nothing like the Review board: the difference is reported, not blocking.
    expect(pixels[0]!.description).toMatch(/^Review 390x844: reported, not blocking: [\d.]+% of pixels differ from refs\/Review\.png$/);
  });

  test('the pixel result is printed, so the list reporter shows it for a passing test', async ({ page }) => {
    await pageWithBoardTexts(page, 'Review');
    const printed: string[] = [];
    const log = console.log;
    console.log = (...a: unknown[]) => {
      printed.push(a.map(String).join(' '));
    };
    try {
      await expectParity(page, 'Review');
    } finally {
      console.log = log;
    }
    expect(printed.filter((l) => l.startsWith('parity-pixels '))).toEqual([expect.stringMatching(/^parity-pixels Review 390x844: reported, not blocking: [\d.]+% of pixels differ/)]);
  });

  test('pages are compared in the dark colour scheme the references were shot in', async ({ page }) => {
    expect(await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true);
  });

  test('a hidden extra [data-primary] does not count', async ({ page }) => {
    await pageWithBoardTexts(page, 'Review', '<button data-primary>Go</button><button data-primary style="display:none">Hidden</button>');
    await expectParity(page, 'Review');
  });

  test('fails a username given text-transform by a class, not only an inline style', async ({ page }) => {
    await pageWithBoardTexts(
      page,
      'Review',
      '<style>.caps{text-transform:uppercase}</style><button data-primary>Go</button><span class="caps"><span data-username>mira.k</span></span>',
    );
    await expect(expectParity(page, 'Review')).rejects.toThrow(/text-transform uppercase on \[data-username\] "mira.k"/);
  });

  test('fails a page with two [data-primary]', async ({ page }) => {
    await pageWithBoardTexts(page, 'Review', '<button data-primary>Submit rating</button><button data-primary>Skip</button>');
    await expect(expectParity(page, 'Review')).rejects.toThrow(/exactly one \[data-primary\], found 2/);
  });

  test('fails a page with no [data-primary]', async ({ page }) => {
    await pageWithBoardTexts(page, 'Review', '');
    await expect(expectParity(page, 'Review')).rejects.toThrow(/exactly one \[data-primary\], found 0/);
  });

  test('a board with no primary action: { primary: false } requires no [data-primary] at all', async ({ page }) => {
    await pageWithBoardTexts(page, 'Review', '');
    await expectParity(page, 'Review', { primary: false });
    await pageWithBoardTexts(page, 'Review', '<button data-primary>Go</button>');
    await expect(expectParity(page, 'Review', { primary: false })).rejects.toThrow(/no \[data-primary\] on a board without a primary action, found 1/);
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

  test('a masked region only stands in for a value-shaped text, not real copy', async ({ page }) => {
    await page.setContent('<p><span class="m">28:12</span></p>');
    const m = [page.locator('.m')];
    // Real copy that happens to contain a digit cannot hide behind a mask.
    expect(await missingTexts(page, ['1.237500 XMR is yours'], m)).toEqual(['1.237500 XMR is yours']);
    expect(await missingTexts(page, ['Trade K7M2-9QXA-4FTR-8WPN · Zelle'], m)).toEqual(['Trade K7M2-9QXA-4FTR-8WPN · Zelle']);
    // A lone mask covers only a value of its own kind: a masked clock is not a missing amount.
    expect(await missingTexts(page, ['$412.50'], m)).toEqual(['$412.50']);
    expect(await missingTexts(page, ['10:00'], m)).toEqual([]);
  });

  test('a lone mask stands in only for a board value of the same kind (time, money, code)', async ({ page }) => {
    await page.setContent('<p><span data-mask="clock">28:12</span></p><p><span data-mask="amount">$398.10</span></p><p><span data-mask="code">K7M2-9QXA-4FTR-8WPN</span></p>');
    expect(await missingTexts(page, ['$412.50', '62 min', 'AB12-CD34-EF56-GH78'])).toEqual([]);
    await page.setContent('<p><span data-mask="clock">28:12</span></p>');
    expect(await missingTexts(page, ['$412.50'])).toEqual(['$412.50']);
    expect(await missingTexts(page, ['1.250000 XMR'])).toEqual(['1.250000 XMR']);
    expect(await missingTexts(page, ['AB12-CD34-EF56-GH78'])).toEqual(['AB12-CD34-EF56-GH78']);
    await page.setContent('<p><span data-mask="amount">1.250000 XMR</span></p>');
    expect(await missingTexts(page, ['$412.50'])).toEqual([]);
    expect(await missingTexts(page, ['28:42'])).toEqual(['28:42']);
  });

  test('one masked pattern cannot stand in for two different board texts', async ({ page }) => {
    await page.setContent('<p>You pay · <span data-mask>1 h 2 min</span> left</p>');
    expect(await missingTexts(page, ['You pay · 1 h left', 'You pay · 2 h left'])).toEqual(['You pay · 2 h left']);
  });

  test('a mask inside a sentence only absorbs a value, never words around it', async ({ page }) => {
    // The trade code is masked; losing " · Zelle" must be reported.
    await page.setContent('<p>Trade <span data-mask>K7M2-9QXA-4FTR-8WPN</span></p>');
    expect(await missingTexts(page, ['Trade K7M2-9QXA-4FTR-8WPN · Zelle'])).toEqual(['Trade K7M2-9QXA-4FTR-8WPN · Zelle']);
    await page.setContent('<p>Trade <span data-mask>K7M2-9QXA-4FTR-8WPN</span> · Zelle</p>');
    expect(await missingTexts(page, ['Trade K7M2-9QXA-4FTR-8WPN · Zelle'])).toEqual([]);
    // A masked count next to a sentence cannot cover lost words before it.
    await page.setContent('<ul><li><div><span data-mask>10 min</span></div><p> to fund escrow</p></li></ul>');
    expect(await missingTexts(page, ['Seller has 10 min to fund escrow'])).toEqual(['Seller has 10 min to fund escrow']);
    expect(await missingTexts(page, ['10 min to fund escrow'])).toEqual([]);
  });

  test('one mask covers one board text even when wrapper elements repeat its sentence', async ({ page }) => {
    await page.setContent('<div id="root"><div><p>You pay · <span data-mask>1 h 2 min</span> left</p></div></div>');
    expect(await missingTexts(page, ['You pay · 1 h left', 'You pay · 2 h left'])).toEqual(['You pay · 2 h left']);
    // A mask used on its own for a value cannot also fill the sentence around it.
    await page.setContent('<div id="root"><ul><li><div><span data-mask>10</span></div><p> min to fund escrow</p></li></ul></div>');
    expect(await missingTexts(page, ['12', '10 min to fund escrow'])).toEqual(['10 min to fund escrow']);
  });

  test('a board placeholder text consumes the page sentence it matched', async ({ page }) => {
    await page.setContent('<div id="root"><p><span data-mask>3</span> offers left</p></div>');
    expect(await missingTexts(page, ['\u0000 offers left', '5 offers left'])).toEqual(['5 offers left']);
    await page.setContent('<div id="root"><p><span data-mask>3</span> offers left</p><p><span data-mask>5</span> offers left</p></div>');
    expect(await missingTexts(page, ['\u0000 offers left', '5 offers left'])).toEqual([]);
  });

  test('a board placeholder checks the fixed copy around it', async ({ page }) => {
    // boardTexts turns "{{roleName}}" into a wildcard; the fixed sentence must still be present.
    await page.setContent('<p>Invite link for a new moderator. It works once and expires in 24 hours.</p>');
    const t = 'Invite link for a new \u0000. It works once and expires in 24 hours.';
    expect(await missingTexts(page, [t])).toEqual([]);
    await page.setContent('<p>Invite link for a new moderator. It works twice.</p>');
    expect(await missingTexts(page, [t])).toEqual([t]);
  });

  test('visually hidden text does not count as shown (sr-only clip, 0x0, off-screen)', async ({ page }) => {
    await page.setContent(
      '<style>.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}</style>' +
        '<p class="sr">Only for screen readers</p>' +
        '<p style="width:0;height:0;overflow:hidden;margin:0">Zero size</p>' +
        '<p style="position:absolute;left:-9999px">Off to the left</p>' +
        '<p style="position:absolute;top:-9999px">Off the top</p>' +
        '<p>Shown</p>',
    );
    expect(await missingTexts(page, ['Only for screen readers', 'Zero size', 'Off to the left', 'Off the top', 'Shown'])).toEqual([
      'Only for screen readers',
      'Zero size',
      'Off to the left',
      'Off the top',
    ]);
  });

  test('text below the fold still counts as shown', async ({ page }) => {
    await page.setContent('<div style="height:3000px"></div><p>Far down</p>');
    expect(await missingTexts(page, ['Far down'])).toEqual([]);
  });

  test('text below the fold inside an inner scroll container still counts as shown', async ({ page }) => {
    // An app shell that scrolls in <main>, so the document itself is one viewport tall.
    await page.setContent(
      '<style>html,body{height:100%;margin:0;overflow:hidden}</style>' +
        '<main style="height:100%;overflow:auto"><h1>How do you want to log in?</h1><div style="height:3000px"></div><button>New to PGP?</button></main>',
    );
    expect(await missingTexts(page, ['New to PGP?'])).toEqual([]);
  });

  test('text moved off the right edge of a page that cannot scroll does not count as shown', async ({ page }) => {
    await page.setContent(
      '<style>html,body{margin:0;overflow:hidden}</style><p>Here</p><p style="position:absolute;left:5000px;top:0">Off to the right</p>',
    );
    expect(await missingTexts(page, ['Here', 'Off to the right'])).toEqual(['Off to the right']);
  });

  test('text clipped inside a non-scrolling overflow:hidden box does not count as shown', async ({ page }) => {
    await page.setContent(
      '<div style="height:40px;width:300px;overflow:hidden"><p style="margin:0">Inside</p><div style="height:400px"></div><p>Clipped below</p></div>' +
        '<div style="height:40px;width:300px;overflow:hidden"><div style="width:3000px">Row <span style="margin-left:2000px">Clipped right</span></div></div>',
    );
    expect(await missingTexts(page, ['Inside', 'Clipped below', 'Clipped right'])).toEqual(['Clipped below', 'Clipped right']);
  });

  test("a select's options are shown with their select, and are not part of the label's text", async ({ page }) => {
    await page.setContent(
      '<label>Currency<select><option>USD</option><option>EUR</option></select></label>' +
        '<label style="display:none">Sort<select><option>Best</option></select></label>',
    );
    expect(await missingTexts(page, ['Currency', 'USD', 'EUR', 'Currency USDEUR', 'Best'])).toEqual(['Currency USDEUR', 'Best']);
  });

  test('text in a hidden element does not count as shown', async ({ page }) => {
    await page.setContent('<p style="display:none">Escrow funded</p><p style="visibility:hidden">Released</p>');
    expect(await missingTexts(page, ['Escrow funded', 'Released'])).toEqual(['Escrow funded', 'Released']);
  });
});

test.describe('board texts', () => {
  test('board-only "Example" markers and example notes are not required', async ({ page }) => {
    expect(withoutBoardMarkers('Trade K7M2-9QXA-4FTR-8WPN · Zelle · Example')).toBe('Trade K7M2-9QXA-4FTR-8WPN · Zelle');
    expect(withoutBoardMarkers('Sellers and prices are examples. You pay no X2F fee when you take an offer.')).toBe(
      'You pay no X2F fee when you take an offer.',
    );
    expect(withoutBoardMarkers('Buyer counts and rates are examples.')).toBe('');
    // The boards' unsigned-copy badge is a marker, not app copy.
    expect(withoutBoardMarkers('Draft copy')).toBe('');
    expect(withoutBoardMarkers('This is a draft copy of the rules.')).toBe('This is a draft copy of the rules.');
    expect(await boardTexts(page, 'SellerRefund')).not.toContain('Draft copy');
    // Nor are the boards' own "Design notes" sections beside the app frame.
    expect(await boardTexts(page, 'SellerRefund')).not.toContain('Design notes');
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

  test('a {{…}} board text is kept as a pattern: SetupBackup "Add {{choice}}"', async ({ page }) => {
    const texts = await boardTexts(page, 'SetupBackup');
    expect(texts).toContain('Add \u0000');
    const page1 = (last: string) =>
      `<body style="margin:0">${texts.filter((t) => !t.includes('\u0000')).map((t) => `<p>${escape(t)}</p>`).join('')}<a data-primary>${last}</a></body>`;
    await page.setContent(page1('Add'));
    await expect(expectParity(page, 'SetupBackup')).rejects.toThrow(/board copy missing: "Add …"/);
    await page.setContent(page1('Add authenticator app'));
    expect(await missingTexts(page, ['Add \u0000'])).toEqual([]);
  });

  test('real copy that mentions "example" is kept', () => {
    expect(withoutBoardMarkers('For example, pay by Zelle.')).toBe('For example, pay by Zelle.');
    expect(withoutBoardMarkers('Paste an example key from your keyring.')).toBe('Paste an example key from your keyring.');
    expect(withoutBoardMarkers('These are examples of good names. Pick one.')).toBe('These are examples of good names. Pick one.');
    expect(withoutBoardMarkers('Sample size: 3')).toBe('Sample size: 3');
  });

  test.describe('with a temp boards folder', () => {
    let dir = '';
    test.beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'x2f-board-'));
    });
    test.afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    test('expectParity fails when no board text can be read', async ({ page }) => {
      await writeFile(join(dir, 'canvas.json'), JSON.stringify({ boards: { 'Empty.dc.html': { w: 390, h: 844 } } }));
      await writeFile(join(dir, 'Empty.dc.html'), '<!doctype html><html><body><x-dc><div><p>{{only}}</p></div></x-dc></body></html>');
      await page.setContent('<body><button data-primary>Go</button></body>');
      await expect(expectParity(page, 'Empty', { boardsDir: dir })).rejects.toThrow(/no board texts read for Empty/);
    });

    test('text the board itself hides visually (a screen-reader-only label) is not required', async ({ page }) => {
      await writeFile(
        join(dir, 'Labels.dc.html'),
        '<!doctype html><html><body><x-dc>' +
          '<label for="cur" style="position: absolute; width: 1px; height: 1px; overflow: hidden;">Currency</label>' +
          '<span style="position:absolute;width:1px;height:1px;clip:rect(0 0 0 0)">Clipped</span>' +
          '<p style="width: 1px">Narrow but shown</p><p>USD</p>' +
          '</x-dc></body></html>',
      );
      expect(await boardTexts(page, 'Labels', { boardsDir: dir })).toEqual(['Narrow but shown', 'USD']);
      // The same under the app's CSP (no inline styles), where the parsed board's CSSOM stays empty.
      await page.setContent(`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'"></head><body></body></html>`);
      expect(await boardTexts(page, 'Labels', { boardsDir: dir })).toEqual(['Narrow but shown', 'USD']);
    });

    test("a select's options are board texts of their own, not part of the label around the select", async ({ page }) => {
      await writeFile(
        join(dir, 'Picker.dc.html'),
        '<!doctype html><html><body><x-dc>' +
          '<label for="c">Currency\n  <select id="c"><option>USD</option><option>EUR</option></select>\n</label>' +
          '</x-dc></body></html>',
      );
      expect(await boardTexts(page, 'Picker', { boardsDir: dir })).toEqual(['Currency', 'USD', 'EUR']);
    });

    test('a KNOWN_EXCEPTIONS text no longer on the board throws (a stale exception)', async ({ page }) => {
      await writeFile(join(dir, 'Desktop.dc.html'), '<!doctype html><html><body><x-dc><p>Escrow funded</p></x-dc></body></html>');
      await expect(boardTexts(page, 'Desktop', { boardsDir: dir })).rejects.toThrow(/KNOWN_EXCEPTIONS\[Desktop\] lists "You pay · 62 min left".*stale/);
    });
  });

  test('known Desktop-board exceptions are listed with a reason and not required', async ({ page }) => {
    const desktop = KNOWN_EXCEPTIONS.Desktop ?? [];
    expect(desktop.map((e) => e.text)).toContain('You pay · 62 min left');
    for (const e of desktop) expect(e.why.length).toBeGreaterThan(10);
    // PostOffer (Task 21 review, lead 2026-10-27): the board's ACH name.
    const post = KNOWN_EXCEPTIONS.PostOffer ?? [];
    expect(post.map((e) => e.text)).toContain('Bank transfer (ACH)');
    for (const e of post) expect(e.why.length).toBeGreaterThan(10);
    expect(await boardTexts(page, 'PostOffer')).not.toContain('Bank transfer (ACH)');
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

test('expectParity at 1280x800 sets the viewport and compares the Desktop board', async ({ page }) => {
  await pageWithBoardTexts(page, 'Desktop');
  await expectParity(page, 'Desktop', { viewport: '1280x800' });
  expect(page.viewportSize()).toEqual({ width: 1280, height: 800 });
  const pixels = test.info().annotations.filter((a) => a.type === 'parity-pixels');
  expect(pixels.at(-1)!.description).toMatch(/^Desktop 1280x800: /);
});

test('expectParity defaults to the board\'s canvas.json size, so a staff board is really compared', async ({ page }) => {
  await pageWithBoardTexts(page, 'StaffLog');
  await expectParity(page, 'StaffLog');
  expect(page.viewportSize()).toEqual({ width: 1280, height: 900 });
  const pixels = test.info().annotations.filter((a) => a.type === 'parity-pixels');
  expect(pixels.at(-1)!.description).toMatch(/^StaffLog 1280x900: /);
  expect(pixels.at(-1)!.description).not.toMatch(/sizes differ/);
  // A tall board: the page is shot at the board's full height, not 800.
  await pageWithBoardTexts(page, 'ModCase');
  await expectParity(page, 'ModCase');
  expect(page.viewportSize()).toEqual({ width: 1280, height: 1600 });
  expect(test.info().annotations.at(-1)!.description).not.toMatch(/sizes differ/);
});

test.describe('reported pixel diff', () => {
  let dir = '';
  test.beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'x2f-refs-'));
  });
  test.afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const canvas = '<body style="margin:0;background:#0e1116;width:200px;height:120px">';

  test('reports a missing reference without blocking', async ({ page }) => {
    await page.setViewportSize({ width: 200, height: 120 });
    await page.setContent(canvas);
    expect(await reportPixels(page, 'Nope', '390x844', [], dir)).toMatch(/reported, not blocking: no reference/);
  });

  test('is within the ratio when the page matches, and a mask covers a changed region', async ({ page }) => {
    await page.setViewportSize({ width: 200, height: 120 });
    // The masked block is 100x60 = 25% of the image, far over the 3% ratio, so only a working mask
    // keeps the result within the ratio.
    const block = (colour: string, masked: boolean) =>
      `${canvas}<div ${masked ? 'data-mask ' : ''}style="position:absolute;left:0;top:0;width:100px;height:60px;background:${colour}"></div>`;
    await page.setContent(block('#ff0000', true));
    await writeFile(join(dir, 'Self.png'), await page.screenshot({ animations: 'disabled', caret: 'hide', scale: 'css' }));
    await page.setContent(block('#0000ff', true));
    expect(await reportPixels(page, 'Self', '390x844', [], dir)).toMatch(/within 3% of refs\/Self\.png/);
    // The same change without the mask is reported.
    await page.setContent(block('#0000ff', false));
    expect(await reportPixels(page, 'Self', '390x844', [], dir)).toMatch(/reported, not blocking: 25\.\d+% of pixels differ/);
  });

  test('reports a large difference without blocking', async ({ page }) => {
    await page.setViewportSize({ width: 200, height: 120 });
    await page.setContent(canvas);
    await writeFile(join(dir, 'Self.png'), await page.screenshot({ animations: 'disabled', caret: 'hide', scale: 'css' }));
    await page.setContent('<body style="margin:0;background:#ffffff;width:200px;height:120px">');
    expect(await reportPixels(page, 'Self', '390x844', [], dir)).toMatch(/reported, not blocking: \d.*% of pixels differ/);
  });
});

test.describe('capture-refs', () => {
  // Run as the command a person runs (tsx), with the boards and output pointed at a temp folder.
  async function capture(...args: string[]): Promise<{ code: number; out: string }> {
    return captureWith(process.env, ...args);
  }
  async function captureWith(env: NodeJS.ProcessEnv, ...args: string[]): Promise<{ code: number; out: string }> {
    try {
      const r = await run(process.execPath, [TSX, CAPTURE, ...args], { cwd: REPO, env, timeout: 60_000 });
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
    // The stub boards carry no placeholders, so a do-nothing runtime still renders them cleanly.
    await writeFile(join(dir, 'support.js'), '');
    const r = await capture(`--boards-dir=${dir}`, `--out-dir=${join(dir, 'refs')}`, 'Tiny');
    expect(r.out).toContain('capture-refs: wrote 1 reference');
    const png = await readFile(join(dir, 'refs', 'Tiny.png'));
    // PNG IHDR: width and height are big-endian at bytes 16 and 20.
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([200, 120]);
    await expect(readFile(join(dir, 'refs', 'Other.png'))).rejects.toThrow();
  });

  test('records each reference in refs/manifest.json with its board hash and size, keeping other entries', async () => {
    await writeFile(join(dir, 'support.js'), '');
    await mkdir(join(dir, 'refs'));
    const kept = { sha256: 'a'.repeat(64), w: 100, h: 100 };
    await writeFile(join(dir, 'refs', 'manifest.json'), JSON.stringify({ Other: kept }));
    const r = await capture(`--boards-dir=${dir}`, `--out-dir=${join(dir, 'refs')}`, 'Tiny');
    expect(r.code, r.out).toBe(0);
    const manifest = JSON.parse(await readFile(join(dir, 'refs', 'manifest.json'), 'utf8')) as Record<string, unknown>;
    const { createHash } = await import('node:crypto');
    const sha256 = createHash('sha256').update(await readFile(join(dir, 'Tiny.dc.html'))).digest('hex');
    expect(manifest).toEqual({ Other: kept, Tiny: { sha256, w: 200, h: 120 } });
  });

  test('fails when the runtime leaves a {{…}} placeholder in the body, writing no references', async () => {
    await writeFile(join(dir, 'support.js'), '');
    await writeFile(join(dir, 'Tiny.dc.html'), '<!doctype html><html><head><script src="./support.js"></script></head><body style="margin:0"><x-dc><p>You pay {{amount}}</p></x-dc></body></html>');
    const r = await capture(`--boards-dir=${dir}`, `--out-dir=${join(dir, 'refs')}`, 'Tiny');
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/\{\{…\}\} is still in the rendered body/);
    await expect(readFile(join(dir, 'refs', 'Tiny.png'))).rejects.toThrow();
  });

  test('removes its staging temp folder when a board fails', async () => {
    test.slow(); // a fresh TMPDIR means a cold tsx cache
    await writeFile(join(dir, 'support.js'), '');
    await writeFile(join(dir, 'Tiny.dc.html'), '<!doctype html><html><head><script src="./support.js"></script></head><body><x-dc><p>You pay {{amount}}</p></x-dc></body></html>');
    const tmp = join(dir, 'tmp');
    await mkdir(tmp);
    const r = await captureWith({ ...process.env, TMPDIR: tmp }, `--boards-dir=${dir}`, `--out-dir=${join(dir, 'refs')}`, 'Tiny');
    expect(r.code).not.toBe(0);
    expect((await readdir(tmp)).filter((n) => n.startsWith('x2f-refs-'))).toEqual([]);
  });

  test('fails when a board is not served with a 2xx status', async () => {
    await writeFile(join(dir, 'support.js'), '');
    await rm(join(dir, 'Other.dc.html'));
    const r = await capture(`--boards-dir=${dir}`, `--out-dir=${join(dir, 'refs')}`, 'Other');
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/Other\.dc\.html returned HTTP 404/);
    await expect(readFile(join(dir, 'refs', 'Other.png'))).rejects.toThrow();
  });

  test('fails on a page error thrown by the runtime', async () => {
    await writeFile(join(dir, 'support.js'), 'throw new Error("runtime broke");');
    const r = await capture(`--boards-dir=${dir}`, `--out-dir=${join(dir, 'refs')}`, 'Tiny');
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/page error: .*runtime broke/);
  });

  test('fails when the board reaches outside the local server', async () => {
    await writeFile(join(dir, 'support.js'), '');
    await writeFile(join(dir, 'Tiny.dc.html'), '<!doctype html><html><head><script src="./support.js"></script></head><body style="margin:0"><x-dc><img src="https://dc-keyframes-base.invalid/x.png"></x-dc></body></html>');
    const r = await capture(`--boards-dir=${dir}`, `--out-dir=${join(dir, 'refs')}`, 'Tiny');
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/request failed: https:\/\/dc-keyframes-base\.invalid/);
  });
});
