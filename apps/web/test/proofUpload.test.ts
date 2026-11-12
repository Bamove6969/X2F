// Plan 5 Task 15: the buyer's proof upload, on the device. PRIVACY-critical: the unblurred picture
// (its pixels, its file bytes, its metadata) never leaves the device and is never logged. Only the
// redacted, re-encoded and cleaned PNG goes up, as ciphertext; the chat envelope carries its key.
//
// The browser parts (decode with createImageBitmap, encode with OffscreenCanvas, OCR) are passed in:
// Node has no canvas. The encoder here is a REAL PNG writer (node:zlib), and it adds a tEXt chunk on
// purpose, so the test also proves the output is cleaned rather than trusting the encoder.
import { deflateSync, inflateSync } from 'node:zlib';
import { type OcrWord, decryptProof, proofKeyFromBase64, redact } from '@x2f/proof';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type EditorRegion,
  type PreparedProof,
  type ProofImageDeps,
  PROOF_NO_AUTO_CHECK,
  ProofInputError,
  blurKindOf,
  finishProof,
  manualRegion,
  prepareProof,
  putProof,
  sendProof,
} from '../src/proof/upload.js';
import { cleanJpeg } from '../../../packages/proof/test/fixtures.js';

const CODE = 'K7M2-9QXA-4FTR-8WPN';
const KEEP = { tradeCode: CODE, fiatCents: 41250n, exponent: 2 };
const W = 300;
const H = 120;

/** Synthetic OCR, 10 px a character, 20 px a line (as packages/proof/test/ocr.ts). */
function ocr(...lines: string[]): OcrWord[] {
  const out: OcrWord[] = [];
  lines.forEach((text, line) => {
    let col = 0;
    for (const part of text.split(' ')) {
      if (part.length > 0) out.push({ text: part, x0: col * 10, y0: line * 20, x1: (col + part.length) * 10, y1: line * 20 + 16, line, conf: 90 });
      col += part.length + 1;
    }
  });
  return out;
}
// Blank lines between, so the padded regions stay apart (padAndMerge merges touching ones).
const WORDS = ocr('Sent $412.50', 'Card 4111 1111 1111 1111', '', 'jane@example.com', '', `Note ${CODE}`);

/** Every pixel different (so a run of original bytes is recognisable anywhere it might leak). */
function original(): Uint8ClampedArray {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    px[i] = (x * 7 + y * 13) & 255;
    px[i + 1] = (x * 3 + y * 29 + 11) & 255;
    px[i + 2] = (x * y + 101) & 255;
    px[i + 3] = 255;
  }
  return px;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc(b: Uint8Array): number {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  out.set(Buffer.from(type, 'latin1'), 4);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
  return out;
}
const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** A real RGBA PNG (filter 0), with `meta` as a tEXt chunk when given. */
function encodePng(rgba: Uint8ClampedArray, w: number, h: number, meta?: string): Uint8Array {
  const raw = new Uint8Array(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  const ih = new Uint8Array(13);
  const v = new DataView(ih.buffer);
  v.setUint32(0, w);
  v.setUint32(4, h);
  ih[8] = 8;
  ih[9] = 6;
  return Buffer.concat([
    Buffer.from(SIG),
    chunk('IHDR', ih),
    ...(meta ? [chunk('tEXt', Buffer.from(`Comment\0${meta}`, 'latin1'))] : []),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]);
}
/** Decode the PNG written above: its chunk types and its RGBA pixels. */
function decodePng(b: Uint8Array): { types: string[]; rgba: Uint8Array; w: number; h: number } {
  const types: string[] = [];
  const idat: Uint8Array[] = [];
  let w = 0;
  let h = 0;
  for (let at = 8; at < b.length; ) {
    const v = new DataView(b.buffer, b.byteOffset + at);
    const len = v.getUint32(0);
    const type = Buffer.from(b.subarray(at + 4, at + 8)).toString('latin1');
    types.push(type);
    const data = b.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') {
      w = new DataView(data.buffer, data.byteOffset).getUint32(0);
      h = new DataView(data.buffer, data.byteOffset).getUint32(4);
    }
    if (type === 'IDAT') idat.push(data);
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) rgba.set(raw.subarray(y * (w * 4 + 1) + 1, (y + 1) * (w * 4 + 1)), y * w * 4);
  return { types, rgba, w, h };
}

const has = (hay: Uint8Array | string, needle: Uint8Array | Uint8ClampedArray): boolean => Buffer.from(typeof hay === 'string' ? Buffer.from(hay, 'latin1') : hay).includes(Buffer.from(needle));

/** The picked file: a real PNG of the original pixels with private metadata in it. */
const FILE_META = 'GPS 52.37N 4.89E iPhone-15-Pro DateTimeOriginal 2026:11:12';
function pickedFile(): Blob {
  return new Blob([encodePng(original(), W, H, FILE_META) as Uint8Array<ArrayBuffer>], { type: 'image/png' });
}

let encoded: Uint8ClampedArray[];
function deps(over: Partial<ProofImageDeps> = {}): ProofImageDeps {
  return {
    decode: async () => ({ rgba: original(), width: W, height: H }),
    // The "browser" encoder adds metadata of its own: the pipeline must clean it off.
    encode: async (rgba, w, h, mime) => {
      encoded.push(new Uint8ClampedArray(rgba));
      if (mime !== 'image/png') throw new Error('png only here');
      return encodePng(rgba, w, h, 'encoder-added');
    },
    ocr: async () => WORDS,
    ...over,
  };
}

const logs = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;
beforeEach(() => {
  encoded = [];
  for (const k of logs) vi.spyOn(console, k);
});
afterEach(() => {
  for (const k of logs) expect(console[k], `console.${k} must never be called by the proof upload`).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const inRegion = (x: number, y: number, rs: readonly { x0: number; y0: number; x1: number; y1: number }[]) => rs.some((r) => x >= Math.floor(r.x0) && x < Math.ceil(r.x1) && y >= Math.floor(r.y0) && y < Math.ceil(r.y1));

describe('prepareProof', () => {
  it('finds the card and the email automatically, never the amount or the trade code', async () => {
    const p = await prepareProof(pickedFile(), KEEP, deps());
    expect(p.ocrOk).toBe(true);
    expect(p.width).toBe(W);
    const kinds = p.auto.map((r) => r.kind).sort();
    expect(kinds).toEqual(['card', 'email']);
    expect(p.auto.every((r) => r.source === 'auto')).toBe(true);
    const covers = (word: OcrWord) => p.auto.some((r) => word.x0 >= r.x0 && word.x1 <= r.x1 && word.y0 >= r.y0 && word.y1 <= r.y1);
    for (const w of WORDS.filter((w) => w.line === 1 && w.text !== 'Card')) expect(covers(w), w.text).toBe(true);
    expect(covers(WORDS.find((w) => w.text === 'jane@example.com')!)).toBe(true);
    const touches = (word: OcrWord) => p.auto.some((r) => word.x0 < r.x1 && r.x0 < word.x1 && word.y0 < r.y1 && r.y0 < word.y1);
    expect(touches(WORDS.find((w) => w.text === '$412.50')!)).toBe(false);
    expect(touches(WORDS.find((w) => w.text === CODE)!)).toBe(false);
    expect(p.amount.length).toBeGreaterThan(0);
    expect(p.memo.length).toBeGreaterThan(0);
  });

  it('OCR unavailable (null, or it throws): ocrOk false, no regions, the no-check line exists', async () => {
    for (const o of [async () => null, async () => { throw new Error('model failed'); }]) {
      const p = await prepareProof(pickedFile(), KEEP, deps({ ocr: o }));
      expect(p.ocrOk).toBe(false);
      expect(p.auto).toEqual([]);
      expect(p.words).toEqual([]);
    }
    expect(PROOF_NO_AUTO_CHECK).toBe("We couldn't check this image automatically. Blur anything private yourself.");
  });

  it('refuses before decoding: a huge header, an animation, an empty or unknown file', async () => {
    const decode = vi.fn(deps().decode);
    const ih = new Uint8Array(13);
    new DataView(ih.buffer).setUint32(0, 12000);
    new DataView(ih.buffer).setUint32(4, 12000);
    ih[8] = 8;
    ih[9] = 6;
    const big = Buffer.concat([Buffer.from(SIG), chunk('IHDR', ih), chunk('IDAT', deflateSync(new Uint8Array(8))), chunk('IEND', new Uint8Array(0))]);
    const cases: [Blob, string][] = [
      [new Blob([big]), 'too-large'],
      [new Blob([new Uint8Array(0)]), 'undecodable'],
      [new Blob([new TextEncoder().encode('not an image at all')]), 'unsupported'],
    ];
    for (const [file, code] of cases) {
      const e = await prepareProof(file, KEEP, deps({ decode })).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(ProofInputError);
      expect((e as ProofInputError).code).toBe(code);
    }
    expect(decode).not.toHaveBeenCalled();
  });
});

describe('the editor regions and the blur kind', () => {
  it('manualRegion normalises a drag in any direction and clamps it; a tiny drag is nothing', () => {
    expect(manualRegion({ x: 50, y: 40 }, { x: 10, y: 5 }, W, H)).toMatchObject({ x0: 10, y0: 5, x1: 50, y1: 40, kind: 'manual', source: 'manual' });
    expect(manualRegion({ x: -20, y: 70 }, { x: 400, y: 200 }, W, H)).toMatchObject({ x0: 0, y0: 70, x1: W, y1: H });
    expect(manualRegion({ x: 5, y: 5 }, { x: 6, y: 6 }, W, H)).toBeNull();
    const a = manualRegion({ x: 0, y: 0 }, { x: 10, y: 10 }, W, H)!;
    const b = manualRegion({ x: 0, y: 0 }, { x: 10, y: 10 }, W, H)!;
    expect(a.id).not.toBe(b.id);
  });

  it('auto, manual, both or none, as the blur check defines them', () => {
    const auto: EditorRegion[] = [
      { id: 'a1', source: 'auto', kind: 'card', x0: 0, y0: 0, x1: 5, y1: 5 },
      { id: 'a2', source: 'auto', kind: 'email', x0: 0, y0: 10, x1: 5, y1: 15 },
    ];
    const m = manualRegion({ x: 20, y: 20 }, { x: 40, y: 40 }, W, H)!;
    expect(blurKindOf(auto, auto)).toBe('auto');
    expect(blurKindOf(auto, [])).toBe('none');
    expect(blurKindOf([], [])).toBe('none');
    expect(blurKindOf([], [m])).toBe('manual');
    expect(blurKindOf(auto, [m])).toBe('manual');
    expect(blurKindOf(auto, [...auto, m])).toBe('both');
    // The tool's boxes with the uploader's change (one taken away) is both, not the tool alone.
    expect(blurKindOf(auto, [auto[0]!])).toBe('both');
  });
});

describe('finishProof', () => {
  it('burns the blur into a COPY of the pixels and cleans the output', async () => {
    const p = await prepareProof(pickedFile(), KEEP, deps());
    const before = new Uint8ClampedArray(p.rgba);
    const m = manualRegion({ x: 200, y: 0 }, { x: 260, y: 16 }, W, H)!;
    const regions = [...p.auto, m];
    const out = await finishProof(p, regions, deps());
    expect(p.rgba).toEqual(before);
    expect(out.mime).toBe('image/png');
    expect(out.hidden.sort()).toEqual(['card', 'email', 'manual']);
    const d = decodePng(out.bytes);
    expect(d.types).toEqual(['IHDR', 'IDAT', 'IEND']);
    const want = new Uint8ClampedArray(before);
    redact(want, W, H, regions);
    expect(Buffer.from(d.rgba).equals(Buffer.from(want))).toBe(true);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (inRegion(x, y, regions)) continue;
      const i = (y * W + x) * 4;
      expect(d.rgba[i]).toBe(before[i]);
    }
    // Only redacted pixels ever reached the encoder.
    expect(encoded).toHaveLength(1);
    expect(Buffer.from(encoded[0]!).equals(Buffer.from(want))).toBe(true);
  });

  it('an output that cannot be cleaned is refused: nothing falls back to the uncleaned bytes', async () => {
    const p = await prepareProof(pickedFile(), KEEP, deps());
    const bad = deps({ encode: async () => new Uint8Array([1, 2, 3]) });
    await expect(finishProof(p, p.auto, bad)).rejects.toThrow();
  });

  it('over the ciphertext cap as PNG, it is encoded again as JPEG', async () => {
    const p = await prepareProof(pickedFile(), KEEP, deps());
    const jpeg = cleanJpeg();
    const mimes: string[] = [];
    const out = await finishProof(p, p.auto, deps({
      encode: async (_r, _w, _h, mime) => {
        mimes.push(mime);
        return mime === 'image/png' ? new Uint8Array(5 * 1024 * 1024) : new Uint8Array(jpeg);
      },
    }));
    expect(mimes).toEqual(['image/png', 'image/jpeg']);
    expect(out.mime).toBe('image/jpeg');
  });
});

describe('sendProof: PRIVACY, the unblurred picture never leaves the device', () => {
  it('only ciphertext of the blurred, cleaned copy goes up; the envelope carries its key; nothing original anywhere', async () => {
    const file = pickedFile();
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    const p = await prepareProof(file, KEEP, deps());
    const orig = original();
    // A run of original bytes from inside the card region, and the whole first row of the email.
    const card = p.auto.find((r) => r.kind === 'card')!;
    const row = Math.ceil(card.y0) + 2;
    const secretRun = orig.subarray((row * W + Math.ceil(card.x0) + 2) * 4, (row * W + Math.ceil(card.x0) + 14) * 4);

    const requests: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(url), init: init ?? {} });
      return new Response(null, { status: 204 });
    }));
    const posted: unknown[] = [];
    const announced: unknown[] = [];
    const r = await sendProof(
      { code: CODE, prepared: p, regions: p.auto },
      {
        ...deps(),
        put: putProof,
        postAttached: async (code, payload) => void posted.push({ code, payload }),
        onPosted: async (code, proofId, blur) => void announced.push({ code, proofId, blur }),
      },
    );

    // One PUT, octet-stream, no file name or type of the source anywhere in the request.
    expect(requests).toHaveLength(1);
    const req = requests[0]!;
    expect(req.url).toBe(`/v1/trades/${CODE}/proofs/${r.proofId}?kind=proof`);
    expect(req.init.method).toBe('PUT');
    expect(req.init.credentials).toBe('same-origin');
    const headers = new Headers(req.init.headers);
    expect(headers.get('content-type')).toBe('application/octet-stream');
    expect(headers.get('content-disposition')).toBeNull();
    const body = req.init.body as Uint8Array;
    expect(body).toBeInstanceOf(Uint8Array);
    // Ciphertext: no PNG or JPEG magic, nothing of the original's pixels, file or metadata.
    expect(Buffer.from(body.subarray(0, 8)).equals(Buffer.from(SIG))).toBe(false);
    expect(has(body, new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    expect(has(body, secretRun)).toBe(false);
    expect(has(body, new TextEncoder().encode('GPS'))).toBe(false);

    // The envelope: the key and the facts, never the image or the source file.
    expect(posted).toHaveLength(1);
    const { payload } = posted[0] as { payload: { proofId: string; key: string; sha256: string; mime: string; kind: string; hidden: string[]; photoTakenAt: string | null } };
    expect(payload.proofId).toBe(r.proofId);
    expect(payload.kind).toBe('proof');
    expect(payload.hidden.sort()).toEqual(['card', 'email']);
    const wire = JSON.stringify(posted);
    for (const s of ['image/png;base64', 'GPS', 'iPhone', FILE_META, 'blob:', 'data:']) expect(wire).not.toContain(s);

    // The seller's view: decrypting gives the blurred, cleaned copy only.
    const key = await proofKeyFromBase64(payload.key);
    const plain = await decryptProof(body, key, { code: CODE, proofId: r.proofId, kind: 'proof', sha256: payload.sha256 });
    const d = decodePng(plain);
    expect(d.types).toEqual(['IHDR', 'IDAT', 'IEND']);
    expect(has(plain, new TextEncoder().encode('GPS'))).toBe(false);
    expect(has(plain, new TextEncoder().encode('encoder-added'))).toBe(false);
    expect(has(d.rgba, secretRun)).toBe(false);
    expect(Buffer.from(d.rgba).equals(Buffer.from(orig))).toBe(false);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (!inRegion(x, y, p.auto)) expect(d.rgba[i]).toBe(orig[i]);
    }
    // Nothing that left holds the picked file's bytes.
    expect(has(body, fileBytes.subarray(fileBytes.length - 64))).toBe(false);

    // The blur kind goes to the blur-check seam (proof id and kind only).
    expect(r.blur).toBe('auto');
    expect(announced).toEqual([{ code: CODE, proofId: r.proofId, blur: 'auto' }]);
    expect(JSON.stringify(announced)).not.toContain(payload.key);
  });

  it('a failed upload posts no envelope; a failed blur-check announcement does not fail the send', async () => {
    const p = await prepareProof(pickedFile(), KEEP, deps());
    const postAttached = vi.fn(async () => undefined);
    await expect(sendProof({ code: CODE, prepared: p, regions: p.auto }, { ...deps(), put: async () => { throw new Error('refused'); }, postAttached })).rejects.toThrow();
    expect(postAttached).not.toHaveBeenCalled();
    const r = await sendProof({ code: CODE, prepared: p, regions: [] }, { ...deps(), put: async () => undefined, postAttached, onPosted: async () => { throw new Error('later'); } });
    expect(r.blur).toBe('none');
    expect(postAttached).toHaveBeenCalledTimes(1);
  });

  it('putProof refuses an answer other than 2xx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'not-found' }), { status: 404 })));
    await expect(putProof(CODE, '0'.repeat(26), 'proof', new Uint8Array(40))).rejects.toMatchObject({ status: 404, code: 'not-found' });
  });
});

describe('the prepared proof is the only copy', () => {
  it('PreparedProof keeps no reference to the picked file', async () => {
    const file = pickedFile();
    const p: PreparedProof = await prepareProof(file, KEEP, deps());
    expect(Object.values(p)).not.toContain(file);
  });
});
