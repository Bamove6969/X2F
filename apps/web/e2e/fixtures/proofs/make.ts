// Generates the synthetic payment receipts for e2e/proof-ocr.spec.ts (Plan 5 Task 13): each layout is
// rendered in Chromium as a real raster image (PNG or JPEG), and the ground truth is every marked
// span's box as the browser laid it out. Everyone and everything in them is made up: test card
// 4111 1111 1111 1111, the documentation IBAN GB82 WEST 1234 5698 7654 32, example.com/.net
// addresses and Ofcom drama numbers. No real person's receipt is ever committed.
//
// Run from the repo root: npx tsx apps/web/e2e/fixtures/proofs/make.ts
// (X2F_CHROMIUM_PATH points at the machine's Chromium, as in playwright.config.ts.)
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const OUT = fileURLToPath(new URL('.', import.meta.url));
export const FIXTURE_CODE = 'K7M2-9QXA-4FTR-8WPN';
/** $412.50: fiat cents and the currency's exponent, as `Keep` wants them. */
export const FIXTURE_KEEP = { tradeCode: FIXTURE_CODE, fiatCents: '41250', exponent: 2 } as const;

type Mark = 'card' | 'iban' | 'email' | 'phone' | 'name' | 'amount' | 'code';
const m = (kind: Mark, text: string) => `<span data-gt="${kind}">${text}</span>`;

interface Layout {
  file: string;
  /** Where the recipient's name sits: after a label (the detector's case), or not (Zelle/Cash App/Wise style). */
  name: 'labelled' | 'top-name' | 'avatar-caption';
  type: 'png' | 'jpeg';
  css: string;
  body: string;
}

const BASE = 'body{margin:0;font-family:"DejaVu Sans",sans-serif;-webkit-font-smoothing:antialiased} #r{width:760px;padding:40px 48px;box-sizing:border-box} .row{margin:14px 0;font-size:26px} .lbl{color:#555}';

const LAYOUTS: Layout[] = [
  {
    file: 'bank-labelled.png',
    name: 'labelled',
    type: 'png',
    css: `${BASE} #r{background:#fff;color:#111} h1{font-size:34px;margin:0 0 24px}`,
    body: `<h1>Payment sent</h1>
      <div class="row"><span class="lbl">Recipient:</span> ${m('name', 'Avery Quinlan')}</div>
      <div class="row"><span class="lbl">Card:</span> ${m('card', '4111 1111 1111 1111')}</div>
      <div class="row"><span class="lbl">IBAN:</span> ${m('iban', 'GB82 WEST 1234 5698 7654 32')}</div>
      <div class="row"><span class="lbl">Email:</span> ${m('email', 'avery.quinlan@example.com')}</div>
      <div class="row"><span class="lbl">Phone:</span> ${m('phone', '+44 7700 900123')}</div>
      <div class="row"><span class="lbl">Amount:</span> ${m('amount', '$412.50')}</div>
      <div class="row"><span class="lbl">Reference:</span> ${m('code', FIXTURE_CODE)}</div>`,
  },
  {
    file: 'top-name.png',
    name: 'top-name',
    type: 'png',
    css: `${BASE} #r{background:#fff;color:#1a1a1a;text-align:center} .big{font-size:44px;font-weight:bold;margin:8px 0 18px} .amt{font-size:56px;font-weight:bold;margin:16px 0}`,
    body: `<div class="row lbl">You sent money to</div>
      <div class="big">${m('name', 'Rowan Ellis')}</div>
      <div class="row">${m('email', 'rowan.ellis@example.net')}</div>
      <div class="amt">${m('amount', '$412.50')}</div>
      <div class="row">Memo ${m('code', FIXTURE_CODE)}</div>
      <div class="row">${m('phone', '+1 202 555 0147')}</div>`,
  },
  {
    file: 'avatar-caption.jpg',
    name: 'avatar-caption',
    type: 'jpeg',
    css: `${BASE} #r{background:#f4f6f8;color:#202124} .av{width:96px;height:96px;border-radius:50%;background:#9fa8da;color:#fff;font-size:40px;line-height:96px;text-align:center;margin:0 auto 10px} .cap{text-align:center;font-size:30px;margin-bottom:26px}`,
    body: `<div class="av">DM</div>
      <div class="cap">${m('name', 'Devon Marsh')}</div>
      <div class="row">You sent ${m('amount', '$412.50')}</div>
      <div class="row"><span class="lbl">To account</span> ${m('iban', 'GB82 WEST 1234 5698 7654 32')}</div>
      <div class="row"><span class="lbl">Reference</span> ${m('code', FIXTURE_CODE)}</div>`,
  },
  {
    file: 'dark-labelled.png',
    name: 'labelled',
    type: 'png',
    css: `${BASE} #r{background:#121417;color:#f1f3f4} .lbl{color:#a0a4a8} h1{font-size:34px;margin:0 0 24px}`,
    body: `<h1>Transfer complete</h1>
      <div class="row"><span class="lbl">Paid to:</span> ${m('name', 'Sasha Whitcombe')}</div>
      <div class="row"><span class="lbl">Email:</span> ${m('email', 'sasha.w@example.org')}</div>
      <div class="row"><span class="lbl">Phone:</span> ${m('phone', '+44 7700 900456')}</div>
      <div class="row"><span class="lbl">Card:</span> ${m('card', '5555 5555 5555 4444')}</div>
      <div class="row"><span class="lbl">Total:</span> ${m('amount', '$412.50')}</div>
      <div class="row"><span class="lbl">Note:</span> ${m('code', FIXTURE_CODE)}</div>`,
  },
];

export interface GroundTruth {
  file: string;
  name: Layout['name'];
  width: number;
  height: number;
  keep: typeof FIXTURE_KEEP;
  marks: Array<{ kind: Mark; text: string; x0: number; y0: number; x1: number; y1: number }>;
}

async function main(): Promise<void> {
  const executablePath = process.env.X2F_CHROMIUM_PATH;
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  try {
    const page = await browser.newPage({ viewport: { width: 760, height: 900 }, deviceScaleFactor: 1 });
    const index: string[] = [];
    for (const l of LAYOUTS) {
      await page.setContent(`<!doctype html><html><head><style>${l.css}</style></head><body><div id="r">${l.body}</div></body></html>`);
      const r = page.locator('#r');
      const box = (await r.boundingBox())!;
      const marks = await page.$$eval('[data-gt]', (els, origin) =>
        els.map((e) => {
          const b = e.getBoundingClientRect();
          return { kind: (e as HTMLElement).dataset.gt, text: e.textContent ?? '', x0: Math.round(b.left - origin.x), y0: Math.round(b.top - origin.y), x1: Math.round(b.right - origin.x), y1: Math.round(b.bottom - origin.y) };
        }), { x: box.x, y: box.y });
      const bytes = await r.screenshot({ type: l.type, ...(l.type === 'jpeg' ? { quality: 88 } : {}) });
      await writeFile(join(OUT, l.file), bytes);
      const gt: GroundTruth = { file: l.file, name: l.name, width: Math.round(box.width), height: Math.round(box.height), keep: FIXTURE_KEEP, marks: marks as GroundTruth['marks'] };
      await writeFile(join(OUT, `${l.file}.json`), `${JSON.stringify(gt, null, 2)}\n`);
      index.push(l.file);
    }
    await writeFile(join(OUT, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  } finally {
    await browser.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
