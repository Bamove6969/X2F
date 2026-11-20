// Plan 5 Task 13, the browser half not covered by proof-ocr.spec.ts: the proof upload pipeline with
// the browser's OWN decoder and encoder (createImageBitmap, OffscreenCanvas), on a fixtures-mode build
// served by the API's serveWeb (the real CSP). The unit tests (test/proofUpload.test.ts) run the same
// rules with stand-in decoders; this runs them on real pictures. The OCR is left out here (its own
// spec), so each case is about the picture: metadata, orientation, size, animation, transparency.
//
// Proven: a JPEG with Exif GPS, a camera model and DateTimeOriginal, and a PNG with tEXt, eXIf and
// iCCP, come out (both the blurred proof and the moderator's unblurred copy) with none of it and
// pass assertClean; an orientation-6 photo comes out upright; a 12,000 x 12,000 header, an animated
// WebP or PNG and an empty file are refused before any decode (createImageBitmap never called); a
// transparent PNG is flattened onto white.
import { crc32 } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import { assertClean } from '@x2f/proof';
import type { FastifyInstance } from 'fastify';
import type { ProofPipelineResult } from '../src/fixtures/index.js';
import { startFixtures } from './fixtures-serve.js';

const PORT = 4345;
const ORIGIN = `http://127.0.0.1:${PORT}`;

let server: FastifyInstance;
test.beforeAll(async () => {
  test.setTimeout(300_000);
  server = await startFixtures(PORT, 'dist-fixtures-proof-pipeline');
});
test.afterAll(async () => {
  await server?.close();
});

const ascii = (s: string) => Buffer.from(s, 'latin1');
const u16 = (n: number) => Buffer.from([n >> 8, n & 0xff]);
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};

function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([ascii(type), data]);
  return Buffer.concat([u32(data.length), body, u32(crc32(body))]);
}
/** The PNG's chunks, in order. */
function pngChunks(b: Buffer): string[] {
  const out: string[] = [];
  for (let at = 8; at < b.length; ) {
    const len = b.readUInt32BE(at);
    out.push(b.toString('latin1', at + 4, at + 8));
    at += 12 + len;
  }
  return out;
}
/** `extra` chunks put right after IHDR. */
function withPngChunks(png: Buffer, extra: Buffer[]): Buffer {
  const ihdrEnd = 8 + 12 + png.readUInt32BE(8);
  return Buffer.concat([png.subarray(0, ihdrEnd), ...extra, png.subarray(ihdrEnd)]);
}

/** A big-endian TIFF (Exif) with IFD0 Orientation and Model, an Exif IFD with DateTimeOriginal, and a GPS IFD with a latitude. */
function exifTiff(o: { orientation: number; model: string; date: string }): Buffer {
  // Layout: header (8) | IFD0 (2 + 4*12 + 4) | Exif IFD (2 + 12 + 4) | GPS IFD (2 + 2*12 + 4) | strings and rationals.
  const ifd0 = 8;
  const ifd0Size = 2 + 4 * 12 + 4;
  const exifIfd = ifd0 + ifd0Size;
  const exifSize = 2 + 12 + 4;
  const gpsIfd = exifIfd + exifSize;
  const gpsSize = 2 + 2 * 12 + 4;
  const data = gpsIfd + gpsSize;
  const model = Buffer.concat([ascii(o.model), Buffer.from([0])]);
  const date = Buffer.concat([ascii(o.date), Buffer.from([0])]);
  const modelAt = data;
  const dateAt = modelAt + model.length;
  const latAt = dateAt + date.length;
  const lat = Buffer.concat([u32(49), u32(1), u32(16), u32(1), u32(0), u32(1)]); // 49° 16' 0" N, made up
  const entry = (tag: number, type: number, count: number, value: Buffer) => Buffer.concat([u16(tag), u16(type), u32(count), Buffer.concat([value, Buffer.alloc(4)]).subarray(0, 4)]);
  const SHORT = 3;
  const LONG = 4;
  const ASCII = 2;
  const RATIONAL = 5;
  return Buffer.concat([
    ascii('MM'), u16(42), u32(ifd0),
    u16(4),
    entry(0x0110, ASCII, model.length, u32(modelAt)),
    entry(0x0112, SHORT, 1, u16(o.orientation)),
    entry(0x8769, LONG, 1, u32(exifIfd)),
    entry(0x8825, LONG, 1, u32(gpsIfd)),
    u32(0),
    u16(1),
    entry(0x9003, ASCII, date.length, u32(dateAt)),
    u32(0),
    u16(2),
    entry(0x0001, ASCII, 2, ascii('N\0')),
    entry(0x0002, RATIONAL, 3, u32(latAt)),
    u32(0),
    model, date, lat,
  ]);
}
/** The JPEG with an APP1 Exif segment right after SOI. */
function withExif(jpeg: Buffer, tiff: Buffer): Buffer {
  const app1 = Buffer.concat([ascii('Exif\0\0'), tiff]);
  return Buffer.concat([jpeg.subarray(0, 2), Buffer.from([0xff, 0xe1]), u16(app1.length + 2), app1, jpeg.subarray(2)]);
}

/** A picture drawn by the page's canvas: `paint` runs in the page on a w x h 2D context. */
async function drawn(page: Page, w: number, h: number, type: 'image/png' | 'image/jpeg', paint: string): Promise<Buffer> {
  const b64 = await page.evaluate(
    async ({ w, h, type, paint }) => {
      const c = new OffscreenCanvas(w, h);
      const ctx = c.getContext('2d')!;
      new Function('ctx', paint)(ctx);
      const blob = await c.convertToBlob(type === 'image/jpeg' ? { type, quality: 0.95 } : { type });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (const x of bytes) s += String.fromCharCode(x);
      return btoa(s);
    },
    { w, h, type, paint },
  );
  return Buffer.from(b64, 'base64');
}

async function run(page: Page, bytes: Buffer, mime: string): Promise<ProofPipelineResult> {
  return page.evaluate(([b, m]) => window.__x2fProofPipeline!(b, m), [bytes.toString('base64'), mime] as const);
}

async function open(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${ORIGIN}/`);
  await expect(page.locator('html[data-fixture-mode="on"]')).toHaveCount(1);
  return errors;
}

/** Paints in the page under the app's CSP, which refuses new Function: so the pictures are made on about:blank. */
async function painter(page: Page): Promise<Page> {
  const p = await page.context().newPage();
  await p.goto('about:blank');
  return p;
}

const near = (px: number[], rgb: [number, number, number], tol = 40) => px.slice(0, 3).every((v, i) => Math.abs(v - rgb[i]!) <= tol);
const bytesOf = (r: Extract<ProofPipelineResult, { ok: true }>, which: 'proof' | 'unblurred') => Buffer.from(r[which].b64, 'base64');

test.describe('the proof pipeline on real pictures (createImageBitmap, OffscreenCanvas)', () => {
  test('a JPEG with Exif GPS, a camera model and DateTimeOriginal: none of it survives, and orientation 6 comes out upright', async ({ page }) => {
    const errors = await open(page);
    const pt = await painter(page);
    // 40 x 20 as stored: top-left red, bottom-left blue, the right half green. Orientation 6 means
    // "rotate 90 degrees clockwise to show": shown upright it is 20 x 40 with blue at the top left.
    const jpeg = await drawn(pt, 40, 20, 'image/jpeg', "ctx.fillStyle='#00ff00';ctx.fillRect(0,0,40,20);ctx.fillStyle='#ff0000';ctx.fillRect(0,0,20,10);ctx.fillStyle='#0000ff';ctx.fillRect(0,10,20,10);");
    const input = withExif(jpeg, exifTiff({ orientation: 6, model: 'X2FTESTCAM-9', date: '2026:10:25 11:50:00' }));
    for (const s of ['Exif', 'X2FTESTCAM-9', '2026:10:25 11:50:00']) expect(input.includes(ascii(s)), `the input carries ${s}`).toBe(true);
    const r = await run(page, input, 'image/jpeg');
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect([r.width, r.height]).toEqual([20, 40]);
    expect(near(r.corners[0]!, [0, 0, 255]), `top-left ${r.corners[0]}`).toBe(true);
    expect(near(r.corners[1]!, [255, 0, 0]), `top-right ${r.corners[1]}`).toBe(true);
    expect(near(r.corners[2]!, [0, 255, 0]), `bottom-left ${r.corners[2]}`).toBe(true);
    for (const which of ['proof', 'unblurred'] as const) {
      const out = bytesOf(r, which);
      for (const s of ['Exif', 'GPS', 'X2FTESTCAM-9', '2026:10:25', 'MM\0*']) expect(out.includes(ascii(s)), `${which}: ${s}`).toBe(false);
      expect(() => assertClean(new Uint8Array(out)), which).not.toThrow();
    }
    expect(errors).toEqual([]);
  });

  test('a PNG with tEXt, eXIf and iCCP: only the image chunks come out', async ({ page }) => {
    const errors = await open(page);
    const pt = await painter(page);
    const base = await drawn(pt, 24, 16, 'image/png', "ctx.fillStyle='#336699';ctx.fillRect(0,0,24,16);");
    const input = withPngChunks(base, [
      pngChunk('tEXt', Buffer.concat([ascii('Comment\0'), ascii('X2FSECRET-NOTE')])),
      pngChunk('eXIf', exifTiff({ orientation: 1, model: 'X2FTESTCAM-9', date: '2026:10:25 11:50:00' })),
      pngChunk('iCCP', Buffer.concat([ascii('X2FPROFILE\0\0'), Buffer.from([0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01])])),
    ]);
    expect(pngChunks(input)).toEqual(expect.arrayContaining(['tEXt', 'eXIf', 'iCCP']));
    const r = await run(page, input, 'image/png');
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    for (const which of ['proof', 'unblurred'] as const) {
      const out = bytesOf(r, which);
      expect(r[which].mime).toBe('image/png');
      expect(pngChunks(out).filter((t) => !['IHDR', 'PLTE', 'IDAT', 'IEND'].includes(t)), which).toEqual([]);
      for (const s of ['X2FSECRET-NOTE', 'X2FTESTCAM-9', 'X2FPROFILE', 'Exif']) expect(out.includes(ascii(s)), `${which}: ${s}`).toBe(false);
      expect(() => assertClean(new Uint8Array(out)), which).not.toThrow();
    }
    expect(errors).toEqual([]);
  });

  test('refused before any decode: a 12,000 x 12,000 header on a tiny body, an animated WebP or PNG, an empty file', async ({ page }) => {
    const errors = await open(page);
    const pt = await painter(page);
    const small = await drawn(pt, 4, 4, 'image/png', "ctx.fillStyle='#000';ctx.fillRect(0,0,4,4);");
    // The IHDR says 12,000 x 12,000 (144 megapixels); the rest is the 4 x 4 picture's.
    const ihdr = Buffer.concat([u32(12_000), u32(12_000), small.subarray(24, 29)]);
    const huge = Buffer.concat([small.subarray(0, 8), pngChunk('IHDR', ihdr), small.subarray(8 + 12 + 13)]);
    const apng = withPngChunks(small, [pngChunk('acTL', Buffer.concat([u32(2), u32(0)]))]);
    // RIFF WEBP: VP8X with the animation flag, then ANIM.
    const vp8x = Buffer.concat([Buffer.from([0x02, 0, 0, 0]), Buffer.from([3, 0, 0]), Buffer.from([3, 0, 0])]);
    const chunk = (cc: string, d: Buffer) => {
      const len = Buffer.alloc(4);
      len.writeUInt32LE(d.length);
      return Buffer.concat([ascii(cc), len, d, d.length % 2 ? Buffer.from([0]) : Buffer.alloc(0)]);
    };
    const body = Buffer.concat([ascii('WEBP'), chunk('VP8X', vp8x), chunk('ANIM', Buffer.alloc(6))]);
    const riffLen = Buffer.alloc(4);
    riffLen.writeUInt32LE(body.length);
    const webp = Buffer.concat([ascii('RIFF'), riffLen, body]);
    for (const [what, bytes, mime, want] of [
      ['12,000 x 12,000 PNG header', huge, 'image/png', 'too-large'],
      ['animated WebP', webp, 'image/webp', 'unsupported'],
      ['animated PNG (acTL)', apng, 'image/png', 'unsupported'],
      ['empty file', Buffer.alloc(0), 'image/png', 'undecodable'],
    ] as const) {
      const r = await run(page, bytes, mime);
      expect(r, what).toEqual({ ok: false, error: want, bitmaps: 0 });
    }
    expect(errors).toEqual([]);
  });

  test('a transparent PNG is flattened onto white', async ({ page }) => {
    const errors = await open(page);
    const pt = await painter(page);
    const input = await drawn(pt, 16, 16, 'image/png', "ctx.clearRect(0,0,16,16);ctx.fillStyle='rgba(0,0,0,1)';ctx.fillRect(6,6,4,4);");
    const r = await run(page, input, 'image/png');
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    for (const c of r.corners) expect(c).toEqual([255, 255, 255, 255]);
    expect(r.bitmaps).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
});
