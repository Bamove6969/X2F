// Builds the image fixtures in test/fixtures/ (Plan 5 Task 7). The files are checked in;
// clean.test.ts checks they still match this builder, and rewrites them when run with
// X2F_WRITE_FIXTURES=1. The zlib streams use stored (uncompressed) blocks built here, so the bytes
// never depend on the zlib version Node ships.

function crc32(bytes: Uint8Array): number {
  let c = ~0;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const x of bytes) {
    a = (a + x) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** A zlib stream of stored deflate blocks: deterministic, and any inflater reads it. */
export function zlibStored(data: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [Uint8Array.of(0x78, 0x01)];
  for (let at = 0; at === 0 || at < data.length; at += 0xffff) {
    const block = data.subarray(at, at + 0xffff);
    const last = at + 0xffff >= data.length ? 1 : 0;
    const len = block.length;
    parts.push(Uint8Array.of(last, len & 0xff, len >> 8, ~len & 0xff, (~len >> 8) & 0xff), block);
  }
  const tail = new Uint8Array(4);
  new DataView(tail.buffer).setUint32(0, adler32(data));
  parts.push(tail);
  return concat(...parts);
}

export function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const latin1 = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));

export const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
export const PNG_W = 4;
export const PNG_H = 3;

/** The raw (filtered) scanlines of a 4 x 3 RGB image: filter byte 0, then RGB per pixel. */
export function pngRaw(): Uint8Array {
  const raw = new Uint8Array(PNG_H * (1 + PNG_W * 3));
  for (let y = 0; y < PNG_H; y++) {
    for (let x = 0; x < PNG_W; x++) {
      const i = y * (1 + PNG_W * 3) + 1 + x * 3;
      raw[i] = x * 60;
      raw[i + 1] = y * 100;
      raw[i + 2] = 200;
    }
  }
  return raw;
}

function ihdr(): Uint8Array {
  const d = new Uint8Array(13);
  const v = new DataView(d.buffer);
  v.setUint32(0, PNG_W);
  v.setUint32(4, PNG_H);
  d[8] = 8; // bit depth
  d[9] = 2; // colour type RGB
  return pngChunk('IHDR', d);
}

/** A clean PNG: IHDR, two IDATs, IEND. */
export function cleanPng(): Uint8Array {
  const z = zlibStored(pngRaw());
  const half = Math.floor(z.length / 2);
  return concat(PNG_SIGNATURE, ihdr(), pngChunk('IDAT', z.subarray(0, half)), pngChunk('IDAT', z.subarray(half)), pngChunk('IEND', new Uint8Array(0)));
}

/** The same image carrying every metadata chunk the plan names. */
export function metadataPng(): Uint8Array {
  const z = zlibStored(pngRaw());
  const exif = concat(latin1('MM\0*\0\0\0\x08'), latin1('GPS 51.5007N 0.1246W Model Pixel 9 DateTimeOriginal 2026:10:16 14:32:05'));
  return concat(
    PNG_SIGNATURE,
    ihdr(),
    pngChunk('iCCP', concat(latin1('Display P3\0\0'), zlibStored(latin1('icc profile bytes')))),
    pngChunk('pHYs', Uint8Array.of(0, 0, 0x0b, 0x13, 0, 0, 0x0b, 0x13, 1)),
    pngChunk('tIME', Uint8Array.of(0x07, 0xea, 10, 16, 14, 32, 5)),
    pngChunk('tEXt', latin1('Comment\0Screenshot of Jane Doe bank app')),
    pngChunk('iTXt', latin1('XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta>GPS</x:xmpmeta>')),
    pngChunk('zTXt', concat(latin1('Author\0\0'), zlibStored(latin1('Jane Doe')))),
    pngChunk('eXIf', exif),
    pngChunk('IDAT', z),
    pngChunk('IEND', new Uint8Array(0)),
  );
}

function segment(marker: number, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + body.length);
  out[0] = 0xff;
  out[1] = marker;
  out[2] = (body.length + 2) >> 8;
  out[3] = (body.length + 2) & 0xff;
  out.set(body, 4);
  return out;
}

/**
 * A clean baseline JPEG that really decodes: 8 x 8 grey, one component, one quantisation table, a DC
 * and an AC Huffman table each with one 1-bit code (DC category 0, AC end-of-block), one scan whose
 * entropy data is the two bits "00" padded with ones.
 */
export function jpegCore(): Uint8Array[] {
  const dqt = segment(0xdb, concat(Uint8Array.of(0x00), new Uint8Array(64).fill(1)));
  const sof0 = segment(0xc0, Uint8Array.of(8, 0, 8, 0, 8, 1, 1, 0x11, 0));
  const dcCounts = new Uint8Array(16);
  dcCounts[0] = 1;
  const dht = segment(0xc4, concat(Uint8Array.of(0x00), dcCounts, Uint8Array.of(0x00), Uint8Array.of(0x10), dcCounts, Uint8Array.of(0x00)));
  const dri = segment(0xdd, Uint8Array.of(0, 0));
  const sos = segment(0xda, Uint8Array.of(1, 1, 0x00, 0, 63, 0));
  return [dqt, sof0, dht, dri, concat(sos, Uint8Array.of(0x3f))];
}

const SOI = Uint8Array.of(0xff, 0xd8);
const EOI = Uint8Array.of(0xff, 0xd9);

export function cleanJpeg(): Uint8Array {
  return concat(SOI, ...jpegCore(), EOI);
}

/** The same JPEG with JFIF APP0, Exif APP1 (GPS, camera model, date), Photoshop APP13 and a COM. */
export function metadataJpeg(): Uint8Array {
  const app0 = segment(0xe0, latin1('JFIF\0\x01\x01\0\0\x01\0\x01\0\0'));
  const app1 = segment(0xe1, latin1('Exif\0\0MM\0*\0\0\0\x08 GPSLatitude 51.5007 Model Pixel 9 DateTimeOriginal 2026:10:16 14:32:05'));
  const app13 = segment(0xed, latin1('Photoshop 3.0\x008BIM\x04\x04 caption Jane Doe'));
  const com = segment(0xfe, latin1('Created with a phone camera'));
  const [dqt, sof0, dht, dri, scan] = jpegCore();
  return concat(SOI, app0, app1, dqt!, app13, sof0!, dht!, com, dri!, scan!, EOI);
}

/** A tiny animated-WebP header: cleanImage takes only PNG and JPEG, so it is refused. */
export function webp(): Uint8Array {
  const body = concat(latin1('WEBP'), latin1('VP8X'), Uint8Array.of(10, 0, 0, 0, 0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0));
  const v = new DataView(new ArrayBuffer(4));
  v.setUint32(0, body.length, true);
  return concat(latin1('RIFF'), new Uint8Array(v.buffer), body);
}

export function gif(): Uint8Array {
  return concat(latin1('GIF89a'), Uint8Array.of(1, 0, 1, 0, 0, 0, 0), latin1(';'));
}

/** File name → bytes, for test/fixtures/. */
export function fixtures(): Record<string, Uint8Array> {
  return {
    'clean.png': cleanPng(),
    'metadata.png': metadataPng(),
    'clean.jpg': cleanJpeg(),
    'metadata.jpg': metadataJpeg(),
    'animated.webp': webp(),
  };
}
