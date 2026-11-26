// Plan 5 Task 16 end to end in Chromium: the smart proof card on SellerConfirm (board
// SellerConfirm.dc.html, section "Payment proof"), on a fixtures-mode build with the proof feature on
// (VITE_X2F_PROOF_UPLOAD=1), served by the API's own serveWeb (the real page CSP, the worker CSP on
// /ocr/*). The chat is stood in for by window.__x2fFixtureSellerProof (the buyer's `proof.attached`
// line); everything after it is real: the card fetches the ciphertext, decrypts it with the line's
// key (ChatProof), runs the receive check and shows the redrawn copy (ProofThumb), and THIS device's
// self-hosted OCR reads that copy. The receipts are made-up screenshots rendered here in Chromium and
// encrypted here with @x2f/proof, as the buyer's device would.
//
// Proven: the board's three lines (parity with the card unmasked), the mismatch line for $400, the
// couldn't-read line for an image with no text, the closing line in every variant, the release
// still locked until the box is ticked, and every request to this origin only.
import { expect, test, type Browser, type Page, type Route } from '@playwright/test';
import { encryptProof, newProofId, proofKeyToBase64, type ProofAttachedPayload } from '@x2f/proof';
import type { FastifyInstance } from 'fastify';
import { startFixtures } from './fixtures-serve.js';
import { boardTexts, boardViewport, missingTexts } from './parity.js';

const CODE = 'K7M2-9QXA-4FTR-8WPN';
const PORT = 4343;
const BASE = `http://127.0.0.1:${PORT}`;
const NOW = '2026-10-25T12:00:00.000Z';
const CLOSING = 'Look for a $412.50 payment with the note K7M2-9QXA-4FTR-8WPN in your bank. Screenshot checks catch mistakes, but only your bank proves the money arrived.';

let server: FastifyInstance;
test.beforeAll(async () => {
  test.setTimeout(300_000);
  process.env.VITE_X2F_PROOF_UPLOAD = '1';
  server = await startFixtures(PORT, 'dist-fixtures-proof-card');
});
test.afterAll(async () => {
  await server?.close();
});

const ME = { tradeTag: 'satoshi_ghost', kind: 'trader', level: 'full', termsCurrent: true };
const ZELLE = {
  id: 'ZELLE',
  name: 'Zelle',
  whatItIs: 'Zelle: a US bank-to-bank instant transfer built into most US banking apps.',
  landsIn: "your bank account, checked in your bank's app",
  checkPrompt: "Open your bank's app and check that the payment arrived in your account.",
  arrival: 'instant',
  confirmWindowMin: 120,
  fields: [],
};

/** The board trade (release.spec.ts's): satoshi_ghost sells 1.25 XMR to mira.k for $412.50 via Zelle, paid, secured at 10:25. */
const VIEW = {
  code: CODE,
  role: 'seller',
  poster: 'seller',
  state: 'paid',
  counterparty: { tradeTag: 'mira.k', completedTrades: 3, online: true, lastSeenAt: NOW, typicalMinutes: null, positivePct: null, badges: [] },
  methodId: 'ZELLE',
  profile: ZELLE,
  amountAtomic: '1250000000000',
  fiatCents: '41250',
  lockedRate: { currency: 'USD', centsPerXmr: '33000' },
  maxFiatCents: '100000',
  grown: null,
  receivedAtomic: '1262500000000',
  confirmations: 12,
  releasable: true,
  releasableEtaMin: 0,
  funding: null,
  fee: { atomic: '12500000000' },
  extensions: 0,
  cancelProposedBy: null,
  settling: null,
  dispute: null,
  txHash: null,
  takenAt: '2026-10-25T10:00:00.000Z',
  setupBy: null,
  fundBy: null,
  fundingSeenAt: '2026-10-25T10:05:00.000Z',
  fundStartedAt: null,
  securedAt: '2026-10-25T10:25:00.000Z',
  payBy: '2026-10-25T11:55:00.000Z',
  paidAt: '2026-10-25T11:52:00.000Z',
  confirmBy: '2026-10-25T13:52:00.000Z',
  confirmWindowMin: 120,
  settleBy: null,
  pausedAt: null,
  closedAt: null,
  cancelConfirmedAt: null,
  cancelConfirmableAt: null,
  sellerNudgedAt: null,
  nextDeadline: '2026-10-25T13:52:00.000Z',
  serverNow: NOW,
};

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/**
 * A made-up Zelle-style screenshot as the buyer would send it: the sender's name already blurred (a
 * flat patch, as the buyer's editor burns it in). `amount: null` and `blank` give the other variants.
 */
async function receipt(browser: Browser, o: { amount?: string; blank?: boolean } = {}): Promise<Buffer> {
  const page = await browser.newPage({ viewport: { width: 760, height: 520 } });
  const body = o.blank
    ? '<div style="height:440px;background:#e6e8ec;border-radius:16px"></div>'
    : `<h1>Zelle</h1>
       <div class="row">Payment sent</div>
       <div class="row"><span class="lbl">Amount:</span> ${o.amount ?? '$412.50'}</div>
       <div class="row"><span class="lbl">From:</span> <span style="display:inline-block;width:220px;height:26px;background:#9aa0a8;vertical-align:middle"></span></div>
       <div class="row">Memo ${CODE}</div>
       <div class="row">Oct 25, 2026 at 11:50 AM</div>`;
  await page.setContent(
    `<!doctype html><style>body{margin:0;font-family:"DejaVu Sans",sans-serif;-webkit-font-smoothing:antialiased} #r{width:760px;padding:40px 48px;box-sizing:border-box;background:#fff;color:#111} h1{font-size:34px;margin:0 0 24px} .row{margin:14px 0;font-size:26px} .lbl{color:#555}</style><div id="r">${body}</div>`,
  );
  const shot = await page.locator('#r').screenshot({ type: 'png' });
  await page.close();
  return shot;
}

/** Reads a PNG's size from its IHDR. */
const sizeOf = (png: Buffer) => ({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) });

interface World {
  requests: string[];
  errors: string[];
  violations: string[];
  proofGets: number;
}

/** The trade API, the proof's ciphertext and the buyer's proof line; opens the trade as the seller. */
async function open(page: Page, plain: Buffer): Promise<World> {
  const proofId = newProofId();
  const { ciphertext, key, sha256 } = await encryptProof(new Uint8Array(plain), { code: CODE, proofId, kind: 'proof' });
  const line: ProofAttachedPayload = { proofId, kind: 'proof', key: await proofKeyToBase64(key), sha256, ...sizeOf(plain), mime: 'image/png', hidden: ['name'], photoTakenAt: null };
  const w: World = { requests: [], errors: [], violations: [], proofGets: 0 };
  page.context().on('request', (r) => w.requests.push(r.url()));
  page.on('pageerror', (e) => w.errors.push(String(e)));
  page.on('console', (m) => {
    if (/Content.Security.Policy|Refused to/i.test(m.text())) w.violations.push(m.text());
  });
  await page.route('**/v1/account/me', json(ME));
  await page.route(`**/v1/trades/${CODE}/confirmations`, json({ confirmations: 1, target: 10 }));
  await page.route(`**/v1/trades/${CODE}/proofs/${proofId}`, (r) => {
    w.proofGets++;
    return r.fulfill({ status: 200, contentType: 'application/octet-stream', body: Buffer.from(ciphertext) });
  });
  await page.route(`**/v1/trades/${CODE}`, json(VIEW));
  await page.addInitScript(
    ({ code, line }) => {
      window.__x2fFixtureEscrow = { phase: 'ready', amountAtomic: '1250000000000', fiatCents: '41250' };
      localStorage.setItem(`x2f.warned.release.${code}`, '1');
      window.__x2fFixtureSellerProof = line;
      document.addEventListener('securitypolicyviolation', (e) => console.error(`Refused to: CSP ${e.violatedDirective} ${e.blockedURI}`));
    },
    { code: CODE, line },
  );
  await page.goto(`${BASE}/trade/${CODE}`);
  await expect(page.locator('[data-screen="seller-confirm"]')).toBeVisible();
  return w;
}

const card = (page: Page) => page.locator('[data-part="smart-proof"]');
const lines = (page: Page) => card(page).locator('[data-part="smart-proof-line"]');
async function checked(page: Page): Promise<void> {
  await expect(card(page)).toHaveAttribute('data-state', 'checked', { timeout: 90_000 });
}
function sameOriginOnly(w: World): void {
  expect(w.requests.filter((u) => !u.startsWith(`${BASE}/`) && !u.startsWith('data:'))).toEqual([]);
  expect(w.violations).toEqual([]);
  expect(w.errors).toEqual([]);
}

test.describe('the smart proof card on SellerConfirm', () => {
  test('the board example: parity with the card unmasked, the three board lines, the hold still locked', async ({ page, browser }) => {
    test.setTimeout(180_000);
    const w = await open(page, await receipt(browser));
    await checked(page);
    await expect(card(page).locator('[data-part="smart-proof-head"]')).toHaveText("We checked mira.k's screenshot");
    await expect(lines(page)).toHaveText(['Shows $412.50, the right amount', "Note says K7M2-9QXA-4FTR-8WPN, this trade's code", 'Sender name hidden by mira.k']);
    await expect(lines(page).nth(0)).toHaveAttribute('data-tone', 'escrow');
    await expect(lines(page).nth(1)).toHaveAttribute('data-tone', 'escrow');
    await expect(lines(page).nth(2)).toHaveAttribute('data-tone', 'caution');
    await expect(card(page).locator('[data-part="smart-proof-closing"]')).toHaveText(CLOSING);
    // The picture is the receive check's redrawn copy (ProofThumb), fetched once.
    await expect(card(page).locator('img[data-part="proof-image"]')).toHaveAttribute('src', /^data:image\/png;base64,/);
    expect(w.proofGets).toBe(1);

    // The card never unlocks the release by itself.
    await expect(page.locator('button[data-primary]')).toBeDisabled();
    await page.getByRole('checkbox').check();
    await expect(page.locator('button[data-primary]')).toBeEnabled();

    // The OCR ran in the self-hosted worker, from this origin only, with no CSP violation. (Checked
    // before the parity step: the harness reads the board's own HTML, whose inline styles the page
    // CSP reports.)
    expect(w.requests.some((u) => u === `${BASE}/ocr/worker.min.js`)).toBe(true);
    sameOriginOnly(w);

    // Board parity for the card itself: every text of the board's "Payment proof" section is on the page.
    const viewport = boardViewport('SellerConfirm');
    const [width, height] = viewport.split('x').map(Number) as [number, number];
    await page.setViewportSize({ width, height });
    const texts = await boardTexts(page, 'SellerConfirm', { within: 'section[aria-label="Payment proof"]' });
    expect(texts.length).toBeGreaterThanOrEqual(5);
    expect(await missingTexts(page, texts, [])).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await expect(page.locator('[data-primary]')).toHaveCount(1);
  });

  test('$400 on the screenshot: "Shows $400.00, not $412.50" in caution, and the closing line', async ({ page, browser }) => {
    test.setTimeout(180_000);
    const w = await open(page, await receipt(browser, { amount: '$400.00' }));
    await checked(page);
    await expect(lines(page).nth(0)).toHaveText('Shows $400.00, not $412.50');
    await expect(lines(page).nth(0)).toHaveAttribute('data-tone', 'caution');
    await expect(card(page)).not.toContainText('the right amount');
    await expect(card(page).locator('[data-part="smart-proof-closing"]')).toHaveText(CLOSING);
    sameOriginOnly(w);
  });

  test('an image with no text: "We couldn\'t read this screenshot", and the closing line', async ({ page, browser }) => {
    test.setTimeout(180_000);
    const w = await open(page, await receipt(browser, { blank: true }));
    await checked(page);
    await expect(lines(page).nth(0)).toHaveText("We couldn't read this screenshot");
    await expect(card(page)).not.toContainText('the right amount');
    await expect(card(page).locator('[data-part="smart-proof-closing"]')).toHaveText(CLOSING);
    sameOriginOnly(w);
  });

  test('the OCR engine blocked: the card says it could not read the screenshot, and nothing else breaks', async ({ page, browser }) => {
    test.setTimeout(180_000);
    await page.route('**/ocr/eng.traineddata.gz', (r) => r.abort());
    const w = await open(page, await receipt(browser));
    await checked(page);
    await expect(lines(page).nth(0)).toHaveText("We couldn't read this screenshot");
    await expect(card(page).locator('img[data-part="proof-image"]')).toBeVisible();
    expect(w.errors).toEqual([]);
  });
});
