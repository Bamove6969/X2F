// Plan 5 Task 15: the buyer's proof upload, on the device. PRIVACY-critical: the unblurred picture
// (its pixels, its file bytes, its metadata) never leaves the device and is never logged. Only the
// redacted, re-encoded and cleaned PNG goes up, as ciphertext; the chat envelope carries its key.
//
// The browser parts (decode with createImageBitmap, encode with OffscreenCanvas, OCR) are passed in:
// Node has no canvas. The encoder here is a REAL PNG writer (node:zlib), and it adds a tEXt chunk on
// purpose, so the test also proves the output is cleaned rather than trusting the encoder.
import { randomBytes } from 'node:crypto';
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
  prepareUnblurred,
  proofUploadOn,
  putProof,
  sendProof,
  sendUnblurred,
  UNBLURRED_POST_BACKOFF_MS,
  UnblurredPostFailed,
} from '../src/proof/upload.js';
import { ChatFailed } from '../src/chat/client.js';
import { browserProofImageDeps } from '../src/proof/browserImage.js';
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
  vi.unstubAllEnvs();
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

describe('review M3 and M1: the decode reads the checked bytes, never the File again', () => {
  /** A picked file that counts its reads and keeps the buffers it handed out. */
  class Picked extends Blob {
    reads = 0;
    slices = 0;
    buffers: ArrayBuffer[] = [];
    override async arrayBuffer(): Promise<ArrayBuffer> {
      this.reads++;
      const b = await super.arrayBuffer();
      this.buffers.push(b);
      return b;
    }
    override slice(start?: number, end?: number, type?: string): Blob {
      this.slices++;
      return super.slice(start, end, type);
    }
  }

  it('decodes a Blob of the checked bytes with the sniffed type, reads the file once, and zeroes those bytes', async () => {
    const png = encodePng(original(), W, H, FILE_META);
    // The file says it is a JPEG: the decoder is told what the header check found.
    const file = new Picked([png as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' });
    const got: { blob: Blob; bytes: Uint8Array }[] = [];
    const decode = vi.fn(async (blob: Blob) => {
      got.push({ blob, bytes: new Uint8Array(await blob.arrayBuffer()) });
      return { rgba: original(), width: W, height: H };
    });
    const p = await prepareProof(file, KEEP, deps({ decode }));
    expect(p.width).toBe(W);
    expect(got).toHaveLength(1);
    expect(got[0]!.blob).not.toBe(file);
    expect(got[0]!.blob.type).toBe('image/png');
    expect(Buffer.from(got[0]!.bytes).equals(Buffer.from(png))).toBe(true);
    // One read of the picked file: the photo time and the decode use the checked copy.
    expect(file.reads).toBe(1);
    expect(file.slices).toBe(0);
    // The bytes read for the check (the original file, its metadata included) are zeroed.
    expect(file.buffers).toHaveLength(1);
    expect(new Uint8Array(file.buffers[0]!).every((b) => b === 0)).toBe(true);
  });

  it('zeroes the checked bytes on a refusal too', async () => {
    const file = new Picked([new TextEncoder().encode('not an image at all')]);
    await expect(prepareProof(file, KEEP, deps())).rejects.toBeInstanceOf(ProofInputError);
    expect(new Uint8Array(file.buffers[0]!).every((b) => b === 0)).toBe(true);
    const bad = new Picked([encodePng(original(), W, H) as Uint8Array<ArrayBuffer>]);
    await expect(prepareProof(bad, KEEP, deps({ decode: async () => { throw new Error('no'); } }))).rejects.toMatchObject({ code: 'undecodable' });
    expect(new Uint8Array(bad.buffers[0]!).every((b) => b === 0)).toBe(true);
  });

  it('review M1: the decode canvas is wiped once its pixels are read', async () => {
    const canvases: { width: number; height: number; cleared: number; readAfterClear: boolean }[] = [];
    class FakeCanvas {
      width: number;
      height: number;
      state = { width: 0, height: 0, cleared: 0, readAfterClear: false };
      constructor(w: number, h: number) {
        this.width = w;
        this.height = h;
        canvases.push(this.state);
      }
      getContext() {
        const c = this;
        return {
          canvas: c,
          fillStyle: '',
          fillRect: () => undefined,
          drawImage: () => undefined,
          clearRect: () => void c.state.cleared++,
          getImageData: (_x: number, _y: number, w: number, h: number) => {
            if (c.state.cleared > 0) c.state.readAfterClear = true;
            return { data: new Uint8ClampedArray(w * h * 4).fill(9) };
          },
        };
      }
    }
    vi.stubGlobal('OffscreenCanvas', FakeCanvas);
    vi.stubGlobal('createImageBitmap', async () => ({ width: 40, height: 20, close: () => undefined }));
    const out = await browserProofImageDeps().decode(new Blob([new Uint8Array(4)]), 2600);
    expect(out.width).toBe(40);
    expect(out.rgba.every((b) => b === 9)).toBe(true);
    expect(canvases).toHaveLength(1);
    const c = canvases[0]!;
    expect(c.cleared).toBeGreaterThan(0);
    expect(c.readAfterClear).toBe(false);
  });
});

describe('review M6: the flag', () => {
  it('proofUploadOn() is off unless VITE_X2F_PROOF_UPLOAD is exactly 1', () => {
    for (const v of [undefined, '', '0', 'true', 'TRUE', 'yes', 'on', ' 1', '1 ', '01', '2']) {
      vi.stubEnv('VITE_X2F_PROOF_UPLOAD', v);
      expect(proofUploadOn(), String(v)).toBe(false);
    }
    vi.stubEnv('VITE_X2F_PROOF_UPLOAD', '1');
    expect(proofUploadOn()).toBe(true);
  });
});

describe('review M5: an image too large even as JPEG', () => {
  it('finishProof refuses it as ProofInputError too-large (the screen shows the can\'t-use line, not a connection error)', async () => {
    const p = await prepareProof(pickedFile(), KEEP, deps());
    // A real, clean PNG of noise, over the cap whatever the encoder is asked for.
    const noise = new Uint8ClampedArray(randomBytes(1100 * 1000 * 4));
    const big = encodePng(noise, 1100, 1000);
    expect(big.length).toBeGreaterThan(4 * 1024 * 1024);
    const e = await finishProof(p, p.auto, deps({ encode: async () => big })).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ProofInputError);
    expect((e as ProofInputError).code).toBe('too-large');
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

describe('re-verify Z1: a failure after the decode zeroes the decoded pixels', () => {
  it('a decode with the wrong size, and a throw while finding regions, both zero the pixels and refuse', async () => {
    // The decoder answers pixels that do not fit its own size: refused, and those pixels zeroed.
    const short = original().subarray(0, W * H * 4 - 4);
    const shortCopy = new Uint8ClampedArray(short);
    await expect(prepareProof(pickedFile(), KEEP, deps({ decode: async () => ({ rgba: shortCopy, width: W, height: H }) }))).rejects.toMatchObject({ code: 'undecodable' });
    expect(shortCopy.every((b) => b === 0)).toBe(true);
    // OCR words the detectors cannot read: whatever throws there, the pixels are zeroed and it rethrows.
    const px = original();
    await expect(prepareProof(pickedFile(), KEEP, deps({ decode: async () => ({ rgba: px, width: W, height: H }), ocr: async () => [null as unknown as OcrWord] }))).rejects.toThrow();
    expect(px.every((b) => b === 0)).toBe(true);
  });
});

describe('the unblurred copy for the moderator (Task 15 SendUnblurred, Review Focus 4): stripped, never blurred', () => {
  it('prepareUnblurred reads the picked file once, decodes it upright, runs no OCR, and zeroes the file bytes', async () => {
    const ocrCalls = vi.fn(async () => WORDS);
    let decoded: Blob | null = null;
    const pic = await prepareUnblurred(pickedFile(), deps({ ocr: ocrCalls, decode: async (b) => ((decoded = b), { rgba: original(), width: W, height: H }) }));
    expect(ocrCalls).not.toHaveBeenCalled();
    expect(decoded!.type).toBe('image/png');
    expect([pic.width, pic.height]).toEqual([W, H]);
    expect(Buffer.from(pic.rgba).equals(Buffer.from(original()))).toBe(true);
    // The same refusals as the proof: nothing undecodable or too large.
    await expect(prepareUnblurred(new Blob([]), deps())).rejects.toBeInstanceOf(ProofInputError);
    await expect(prepareUnblurred(new Blob([new TextEncoder().encode('not an image')]), deps())).rejects.toBeInstanceOf(ProofInputError);
  });

  it('only ciphertext of the stripped, cleaned copy goes up as kind=unblurred; the envelope is proof.unblurred; the pixels are zeroed after', async () => {
    const file = pickedFile();
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    const pic = await prepareUnblurred(file, deps());
    const requests: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(url), init: init ?? {} });
      return new Response(null, { status: 204 });
    }));
    const posted: { code: string; payload: Record<string, unknown> }[] = [];
    const r = await sendUnblurred({ code: CODE, picture: pic }, { ...deps(), put: putProof, postUnblurred: async (code, payload) => void posted.push({ code, payload: payload as unknown as Record<string, unknown> }) });

    expect(requests).toHaveLength(1);
    const req = requests[0]!;
    expect(req.url).toBe(`/v1/trades/${CODE}/proofs/${r.proofId}?kind=unblurred`);
    expect(new Headers(req.init.headers).get('content-type')).toBe('application/octet-stream');
    const body = req.init.body as Uint8Array;
    expect(has(body, new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    expect(has(body, new TextEncoder().encode('GPS'))).toBe(false);
    expect(has(body, fileBytes.subarray(fileBytes.length - 64))).toBe(false);

    // The payload is exactly proof.unblurred's (no kind, no hidden list, no photo time).
    expect(posted).toHaveLength(1);
    expect(Object.keys(posted[0]!.payload).sort()).toEqual(['height', 'key', 'mime', 'proofId', 'sha256', 'width']);
    const payload = posted[0]!.payload as { proofId: string; key: string; sha256: string; mime: string };
    expect(payload.proofId).toBe(r.proofId);
    const wire = JSON.stringify(posted);
    for (const s of ['GPS', 'iPhone', FILE_META, 'blob:', 'data:']) expect(wire).not.toContain(s);

    // The moderator's view: the whole picture, unblurred, with nothing but the image chunks.
    const key = await proofKeyFromBase64(payload.key);
    const plain = await decryptProof(body, key, { code: CODE, proofId: r.proofId, kind: 'unblurred', sha256: payload.sha256 });
    const d = decodePng(plain);
    expect(d.types).toEqual(['IHDR', 'IDAT', 'IEND']);
    expect(has(plain, new TextEncoder().encode('encoder-added'))).toBe(false);
    expect(Buffer.from(d.rgba).equals(Buffer.from(original()))).toBe(true);
    // Bound to its kind: it never opens as a payment proof.
    await expect(decryptProof(body, key, { code: CODE, proofId: r.proofId, kind: 'proof', sha256: payload.sha256 })).rejects.toThrow();
    // The decoded pixels are gone once it is sent.
    expect(pic.rgba.every((v) => v === 0)).toBe(true);
  });

  it('a failed upload posts no envelope, and the pixels are zeroed either way (the trader picks the file again)', async () => {
    const pic = await prepareUnblurred(pickedFile(), deps());
    const postUnblurred = vi.fn(async () => undefined);
    await expect(sendUnblurred({ code: CODE, picture: pic }, { ...deps(), put: async () => { throw new Error('refused'); }, postUnblurred })).rejects.toThrow();
    expect(postUnblurred).not.toHaveBeenCalled();
    expect(pic.rgba.every((v) => v === 0)).toBe(true);
  });

  // Review I2 (18 Nov): the upload worked but posting the key did not (a 429, no answer). The copy
  // cannot go up twice (the API holds one per request), so only the post is tried again.
  const slowDown = () => new ChatFailed('slow-down');
  it('review I2: a failed post after the upload is tried again with backoff; the ciphertext goes up once', async () => {
    const pic = await prepareUnblurred(pickedFile(), deps());
    const put = vi.fn(async () => undefined);
    const payloads: unknown[] = [];
    let n = 0;
    const postUnblurred = vi.fn(async (_c: string, p: unknown) => {
      payloads.push(p);
      if (n++ < 2) throw slowDown();
    });
    const waits: number[] = [];
    const r = await sendUnblurred({ code: CODE, picture: pic }, { ...deps(), put, postUnblurred, sleep: async (ms) => void waits.push(ms) });
    expect(put).toHaveBeenCalledTimes(1);
    expect(postUnblurred).toHaveBeenCalledTimes(3);
    expect(waits).toEqual(UNBLURRED_POST_BACKOFF_MS.slice(0, 2));
    expect(waits[1]!).toBeGreaterThan(waits[0]!);
    // The same payload each time (the same proof id and key).
    expect(payloads[1]).toEqual(payloads[0]);
    expect(payloads[2]).toEqual(payloads[0]);
    expect((payloads[0] as { proofId: string }).proofId).toBe(r.proofId);
    expect(pic.rgba.every((v) => v === 0)).toBe(true);
  });

  it('review I2: after a bounded number of tries, a clear error that keeps the payload in memory; its retry posts again and never uploads', async () => {
    const pic = await prepareUnblurred(pickedFile(), deps());
    const put = vi.fn(async () => undefined);
    let fail = true;
    const payloads: unknown[] = [];
    const postUnblurred = vi.fn(async (_c: string, p: unknown) => {
      payloads.push(p);
      if (fail) throw slowDown();
    });
    const sleep = vi.fn(async () => undefined);
    const e = await sendUnblurred({ code: CODE, picture: pic }, { ...deps(), put, postUnblurred, sleep }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(UnblurredPostFailed);
    expect(postUnblurred).toHaveBeenCalledTimes(UNBLURRED_POST_BACKOFF_MS.length + 1);
    expect(sleep).toHaveBeenCalledTimes(UNBLURRED_POST_BACKOFF_MS.length);
    const failed = e as UnblurredPostFailed;
    expect(failed.last).toBeInstanceOf(ChatFailed);
    // The pixels are gone: only the key and facts are kept, never the picture.
    expect(pic.rgba.every((v) => v === 0)).toBe(true);
    fail = false;
    const r = await failed.retry();
    expect(r.proofId).toBe(failed.proofId);
    expect(put).toHaveBeenCalledTimes(1);
    expect(payloads.at(-1)).toEqual(payloads[0]);
  });

  it('review I2: a payload the engine refuses as malformed is not tried again with backoff', async () => {
    const pic = await prepareUnblurred(pickedFile(), deps());
    const postUnblurred = vi.fn(async () => {
      throw new ChatFailed('bad-proof');
    });
    const sleep = vi.fn(async () => undefined);
    await expect(sendUnblurred({ code: CODE, picture: pic }, { ...deps(), put: async () => undefined, postUnblurred, sleep })).rejects.toBeInstanceOf(UnblurredPostFailed);
    expect(postUnblurred).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe('review m1: finishProof zeroes its working buffers on the error paths', () => {
  const pic = () => ({ rgba: original(), width: W, height: H });
  it('the redacted copy, when the encoder throws', async () => {
    let seen: Uint8ClampedArray | null = null;
    await expect(finishProof(pic(), [], { encode: async (rgba) => { seen = rgba; throw new Error('no canvas'); } })).rejects.toThrow();
    expect(seen!.every((v) => v === 0)).toBe(true);
  });

  it('the uncleaned bytes, when they cannot be cleaned', async () => {
    const out: Uint8Array[] = [];
    const bad = encodePng(original(), W, H, 'encoder-added').subarray(0, 40);
    await expect(finishProof(pic(), [], { encode: async () => (out.push(new Uint8Array(bad)), out.at(-1)!) })).rejects.toThrow();
    expect(out[0]!.every((v) => v === 0)).toBe(true);
  });

  it('the first PNG when it falls back to JPEG, and the uncleaned bytes after a clean', async () => {
    const out: Uint8Array[] = [];
    const jpeg = cleanJpeg();
    const r = await finishProof(pic(), [], {
      encode: async (_r, _w, _h, mime) => {
        out.push(mime === 'image/png' ? new Uint8Array(5 * 1024 * 1024).fill(7) : new Uint8Array(jpeg));
        return out.at(-1)!;
      },
    });
    expect(r.mime).toBe('image/jpeg');
    expect(out[0]!.every((v) => v === 0)).toBe(true);
    expect(out[1]!.every((v) => v === 0)).toBe(true);
    expect(r.bytes.some((v) => v !== 0)).toBe(true);
  });
});
