import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { CleanError, assertClean, cleanImage } from '../src/index.js';
import { PNG_SIGNATURE, cleanJpeg, cleanPng, concat, fixtures, gif, metadataJpeg, metadataPng, pngChunk, pngRaw, webp } from './fixtures.js';

const DIR = new URL('./fixtures/', import.meta.url);
const read = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(name, DIR)));
const has = (bytes: Uint8Array, s: string): boolean => Buffer.from(bytes).includes(Buffer.from(s, 'latin1'));

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof CleanError) return e.code;
    throw e;
  }
  return undefined;
}

/** Chunk types of a PNG, in order. */
function pngChunks(bytes: Uint8Array): string[] {
  const out: string[] = [];
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = 8; at < bytes.length; ) {
    const len = v.getUint32(at);
    out.push(Buffer.from(bytes.subarray(at + 4, at + 8)).toString('latin1'));
    at += 12 + len;
  }
  return out;
}

/** Concatenated IDAT data of a PNG. */
function idat(bytes: Uint8Array): Buffer {
  const parts: Uint8Array[] = [];
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = 8; at < bytes.length; ) {
    const len = v.getUint32(at);
    if (Buffer.from(bytes.subarray(at + 4, at + 8)).toString('latin1') === 'IDAT') parts.push(bytes.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  return Buffer.concat(parts);
}

/** JPEG markers outside entropy-coded data, in order. */
function jpegMarkers(bytes: Uint8Array): number[] {
  const out: number[] = [];
  let at = 2;
  out.push(0xd8);
  while (at < bytes.length) {
    const m = bytes[at + 1]!;
    out.push(m);
    if (m === 0xd9) break;
    const len = (bytes[at + 2]! << 8) | bytes[at + 3]!;
    at += 2 + len;
    if (m === 0xda) {
      while (!(bytes[at] === 0xff && bytes[at + 1] !== 0 && !(bytes[at + 1]! >= 0xd0 && bytes[at + 1]! <= 0xd7))) at++;
    }
  }
  return out;
}

describe('fixtures', () => {
  it('the checked-in fixtures match the builder', () => {
    const all = fixtures();
    if (process.env['X2F_WRITE_FIXTURES'] === '1') {
      for (const [name, bytes] of Object.entries(all)) writeFileSync(new URL(name, DIR), bytes);
    }
    for (const [name, bytes] of Object.entries(all)) expect(Buffer.from(read(name)).equals(Buffer.from(bytes)), name).toBe(true);
  });
});

describe('cleanImage: PNG', () => {
  it('keeps only IHDR, PLTE, IDAT and IEND, and the image still decodes', () => {
    const input = read('metadata.png');
    expect(pngChunks(input)).toEqual(['IHDR', 'iCCP', 'pHYs', 'tIME', 'tEXt', 'iTXt', 'zTXt', 'eXIf', 'IDAT', 'IEND']);
    const out = cleanImage(input);
    expect(pngChunks(out)).toEqual(['IHDR', 'IDAT', 'IEND']);
    expect(Buffer.from(out.subarray(0, 8)).equals(Buffer.from(PNG_SIGNATURE))).toBe(true);
    expect(Buffer.from(inflateSync(idat(out))).equals(Buffer.from(pngRaw()))).toBe(true);
    for (const s of ['GPS', 'Jane', 'Pixel 9', '2026:10:16', 'Display P3', 'xmpmeta']) expect(has(out, s), s).toBe(false);
  });

  it('leaves a clean PNG byte-identical, split IDATs included', () => {
    const input = read('clean.png');
    expect(Buffer.from(cleanImage(input)).equals(Buffer.from(input))).toBe(true);
  });

  it('keeps PLTE for a palette image', () => {
    const d = new Uint8Array(13);
    new DataView(d.buffer).setUint32(0, 1);
    new DataView(d.buffer).setUint32(4, 1);
    d[8] = 8;
    d[9] = 3;
    const png = concat(PNG_SIGNATURE, pngChunk('IHDR', d), pngChunk('PLTE', Uint8Array.of(255, 0, 0)), pngChunk('tRNS', Uint8Array.of(0)), pngChunk('IDAT', Uint8Array.of(0x78, 0x9c, 0x63, 0x60, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01)), pngChunk('IEND', new Uint8Array(0)));
    expect(pngChunks(cleanImage(png))).toEqual(['IHDR', 'PLTE', 'IDAT', 'IEND']);
  });

  it('drops bytes after IEND', () => {
    const out = cleanImage(concat(read('clean.png'), new TextEncoder().encode('secret trailer')));
    expect(has(out, 'secret')).toBe(false);
    expect(Buffer.from(out).equals(Buffer.from(read('clean.png')))).toBe(true);
  });

  it('refuses a bad CRC, a truncated file, an unknown critical chunk and a missing IHDR', () => {
    const bad = read('clean.png').slice();
    bad[8 + 4 + 4 + 13] ^= 0xff; // IHDR CRC
    expect(code(() => cleanImage(bad))).toBe('unsupported');
    const png = read('clean.png');
    expect(code(() => cleanImage(png.subarray(0, png.length - 5)))).toBe('unsupported');
    expect(code(() => cleanImage(png.subarray(0, 20)))).toBe('unsupported');
    const z = Uint8Array.of(0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01);
    const ih = png.subarray(8, 8 + 25);
    expect(code(() => cleanImage(concat(PNG_SIGNATURE, ih, pngChunk('ABCD', new Uint8Array(1)), pngChunk('IDAT', z), pngChunk('IEND', new Uint8Array(0)))))).toBe('unsupported');
    expect(code(() => cleanImage(concat(PNG_SIGNATURE, pngChunk('IDAT', z), pngChunk('IEND', new Uint8Array(0)))))).toBe('unsupported');
    expect(code(() => cleanImage(concat(PNG_SIGNATURE, ih, pngChunk('IEND', new Uint8Array(0)))))).toBe('unsupported');
  });

  it('refuses a chunk length that runs past the end', () => {
    const png = read('clean.png').slice();
    new DataView(png.buffer).setUint32(8, 0x7fffffff);
    expect(code(() => cleanImage(png))).toBe('unsupported');
  });
});

describe('cleanImage: JPEG', () => {
  it('drops APP0, APP1 Exif, APP13 and COM; Exif, GPS and Photoshop are absent', () => {
    const input = read('metadata.jpg');
    expect(jpegMarkers(input)).toEqual([0xd8, 0xe0, 0xe1, 0xdb, 0xed, 0xc0, 0xc4, 0xfe, 0xdd, 0xda, 0xd9]);
    const out = cleanImage(input);
    expect(jpegMarkers(out)).toEqual([0xd8, 0xdb, 0xc0, 0xc4, 0xdd, 0xda, 0xd9]);
    for (const s of ['Exif', 'GPS', 'Photoshop', 'JFIF', 'Pixel 9', '2026:10:16', 'Jane', 'camera']) expect(has(out, s), s).toBe(false);
    expect(Buffer.from(out).equals(Buffer.from(cleanJpeg()))).toBe(true);
  });

  it('leaves a clean JPEG byte-identical', () => {
    const input = read('clean.jpg');
    expect(Buffer.from(cleanImage(input)).equals(Buffer.from(input))).toBe(true);
  });

  it('keeps entropy data with stuffed bytes and restart markers', () => {
    const core = cleanJpeg();
    const eoi = core.length - 2;
    const scan = Uint8Array.of(0xff, 0x00, 0x12, 0xff, 0xd0, 0x34, 0xff, 0xd7);
    const jpg = concat(core.subarray(0, eoi), scan, core.subarray(eoi));
    expect(Buffer.from(cleanImage(jpg)).equals(Buffer.from(jpg))).toBe(true);
  });

  it('keeps a progressive JPEG (SOF2, several scans, DHT between them)', () => {
    const core = cleanJpeg();
    const sof2 = core.slice();
    const sofAt = Buffer.from(sof2).indexOf(Buffer.from([0xff, 0xc0]));
    sof2[sofAt + 1] = 0xc2;
    const eoi = sof2.length - 2;
    const dhtAt = Buffer.from(sof2).indexOf(Buffer.from([0xff, 0xc4]));
    const dhtLen = (sof2[dhtAt + 2]! << 8) | sof2[dhtAt + 3]!;
    const dht = sof2.subarray(dhtAt, dhtAt + 2 + dhtLen);
    const sosAt = Buffer.from(sof2).indexOf(Buffer.from([0xff, 0xda]));
    const scan = sof2.subarray(sosAt, eoi);
    const jpg = concat(sof2.subarray(0, eoi), dht, scan, sof2.subarray(eoi));
    expect(Buffer.from(cleanImage(jpg)).equals(Buffer.from(jpg))).toBe(true);
  });

  it('drops bytes after EOI', () => {
    const out = cleanImage(concat(read('clean.jpg'), new TextEncoder().encode('secret trailer')));
    expect(Buffer.from(out).equals(Buffer.from(read('clean.jpg')))).toBe(true);
  });

  it('refuses truncated files, arithmetic and lossless JPEGs, and a scan before any frame', () => {
    const jpg = read('clean.jpg');
    expect(code(() => cleanImage(jpg.subarray(0, jpg.length - 2)))).toBe('unsupported');
    expect(code(() => cleanImage(jpg.subarray(0, 10)))).toBe('unsupported');
    for (const sof of [0xc3, 0xc9, 0xcb]) {
      const x = jpg.slice();
      x[Buffer.from(x).indexOf(Buffer.from([0xff, 0xc0])) + 1] = sof;
      expect(code(() => cleanImage(x)), sof.toString(16)).toBe('unsupported');
    }
    const sosAt = Buffer.from(jpg).indexOf(Buffer.from([0xff, 0xda]));
    const sofAt = Buffer.from(jpg).indexOf(Buffer.from([0xff, 0xc0]));
    const noFrame = concat(jpg.subarray(0, sofAt), jpg.subarray(sofAt + 13));
    expect(sosAt).toBeGreaterThan(sofAt);
    expect(code(() => cleanImage(noFrame))).toBe('unsupported');
  });

  it('refuses allowed segments that carry extra bytes', () => {
    const jpg = read('clean.jpg');
    const at = Buffer.from(jpg).indexOf(Buffer.from([0xff, 0xdb]));
    const len = (jpg[at + 2]! << 8) | jpg[at + 3]!;
    const padded = concat(jpg.subarray(0, at), Uint8Array.of(0xff, 0xdb, (len + 6) >> 8, (len + 6) & 0xff), jpg.subarray(at + 4, at + 2 + len), new TextEncoder().encode('Jane D'), jpg.subarray(at + 2 + len));
    expect(code(() => cleanImage(padded))).toBe('unsupported');
  });
});

describe('cleanImage: other formats', () => {
  it('refuses a GIF, a WebP, a zero-byte file and random bytes', () => {
    expect(code(() => cleanImage(gif()))).toBe('unsupported');
    expect(code(() => cleanImage(read('animated.webp')))).toBe('unsupported');
    expect(code(() => cleanImage(webp()))).toBe('unsupported');
    expect(code(() => cleanImage(new Uint8Array(0)))).toBe('unsupported');
    expect(code(() => cleanImage(Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9)))).toBe('unsupported');
  });

  it('the error names only its code', () => {
    try {
      cleanImage(concat(read('clean.png').subarray(0, 40)));
    } catch (e) {
      expect(e).toBeInstanceOf(CleanError);
      expect((e as Error).message).toBe('unsupported');
    }
  });
});

describe('assertClean', () => {
  it('rejects the metadata inputs and accepts the cleaned outputs', () => {
    for (const name of ['metadata.png', 'metadata.jpg']) {
      const input = read(name);
      expect(code(() => assertClean(input)), name).toBe('metadata');
      expect(code(() => assertClean(cleanImage(input))), name).toBeUndefined();
    }
    expect(code(() => assertClean(cleanPng()))).toBeUndefined();
    expect(code(() => assertClean(cleanJpeg()))).toBeUndefined();
  });

  it('rejects trailing bytes as metadata', () => {
    expect(code(() => assertClean(concat(cleanPng(), Uint8Array.of(0))))).toBe('metadata');
    expect(code(() => assertClean(concat(cleanJpeg(), Uint8Array.of(0))))).toBe('metadata');
  });

  it('rejects one ancillary chunk of any kind', () => {
    const png = cleanPng();
    const ihdrEnd = 8 + 25;
    for (const t of ['sRGB', 'gAMA', 'tRNS', 'bKGD', 'acTL', 'caBX']) {
      const x = concat(png.subarray(0, ihdrEnd), pngChunk(t, Uint8Array.of(0)), png.subarray(ihdrEnd));
      expect(code(() => assertClean(x)), t).toBe('metadata');
    }
  });

  it('refuses what is not a PNG or JPEG', () => {
    expect(code(() => assertClean(gif()))).toBe('unsupported');
    expect(code(() => assertClean(metadataJpeg().subarray(0, 30)))).toBe('unsupported');
    expect(code(() => assertClean(metadataPng().subarray(0, 30)))).toBe('unsupported');
  });
});
