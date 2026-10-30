// PNG and JPEG metadata cleaners (Plan 5 Task 7, spec 4.2).
//
// Allowlists, not blocklists: a PNG keeps only IHDR, PLTE, IDAT and IEND; a JPEG keeps only SOI,
// DQT, DHT, SOF0-SOF2, DRI, SOS with its scan data, and EOI. No image library: the walkers read every
// length with a bounds check and refuse anything malformed. Bytes after the end marker are dropped.

export type CleanErrorCode = 'unsupported' | 'metadata';

/** The message is the code alone, so an error never carries image bytes or text. */
export class CleanError extends Error {
  readonly code: CleanErrorCode;
  constructor(code: CleanErrorCode) {
    super(code);
    this.name = 'CleanError';
    this.code = code;
  }
}

const unsupported = (): CleanError => new CleanError('unsupported');

// ---------------------------------------------------------------------------------------------
// PNG

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_KEEP = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND']);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * At most this many separate byte ranges are kept (review M9). Kept pieces that touch are merged, so
 * a real image (IDATs in a row, JPEG tables and scans in a row) needs only a few; the cap keeps the
 * walker's memory bounded on hostile input made of thousands of tiny alternating pieces.
 */
const MAX_RANGES = 4096;

/** What a walk keeps: merged byte ranges on the allowlist (the header included). */
class Kept {
  readonly ranges: Array<[number, number]> = [];
  /** Chunks or segments off the allowlist; only counted, never stored. */
  dropped = 0;

  add(start: number, end: number): void {
    const last = this.ranges[this.ranges.length - 1];
    if (last && last[1] === start) {
      last[1] = end;
      return;
    }
    if (this.ranges.length >= MAX_RANGES) throw unsupported();
    this.ranges.push([start, end]);
  }
}

interface Walk {
  kept: Kept;
  /** Offset just past the end marker; anything from here on is trailing data. */
  end: number;
}

function isPng(b: Uint8Array): boolean {
  return b.length >= 8 && PNG_SIGNATURE.every((v, i) => b[i] === v);
}

function u32(b: Uint8Array, at: number): number {
  return ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;
}

/** Every chunk of a well-formed PNG, CRCs checked, up to IEND. Throws `unsupported` otherwise. */
function walkPng(b: Uint8Array): Walk {
  const kept = new Kept();
  kept.add(0, 8);
  let first = true;
  let at = 8;
  let sawIdat = false;
  for (;;) {
    if (at + 12 > b.length) throw unsupported();
    const len = u32(b, at);
    if (len > 0x7fffffff || len > b.length - at - 12) throw unsupported();
    const typeBytes = b.subarray(at + 4, at + 8);
    if (!typeBytes.every((c) => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a))) throw unsupported();
    const type = String.fromCharCode(...typeBytes);
    const end = at + 12 + len;
    if (crc32(b.subarray(at + 4, at + 8 + len)) !== u32(b, at + 8 + len)) throw unsupported();
    if (first) {
      first = false;
      if (type !== 'IHDR' || len !== 13) throw unsupported();
      const w = u32(b, at + 8);
      const h = u32(b, at + 12);
      if (w === 0 || h === 0 || w > 0x7fffffff || h > 0x7fffffff) throw unsupported();
    } else if (type === 'IHDR') {
      throw unsupported();
    }
    // A critical chunk (upper-case first letter) we do not know cannot be dropped safely.
    const critical = (typeBytes[0]! & 0x20) === 0;
    if (critical && !PNG_KEEP.has(type)) throw unsupported();
    if (type === 'PLTE' && sawIdat) throw unsupported();
    if (type === 'IDAT') sawIdat = true;
    if (PNG_KEEP.has(type)) kept.add(at, end);
    else kept.dropped++;
    at = end;
    if (type === 'IEND') {
      if (len !== 0 || !sawIdat) throw unsupported();
      return { kept, end: at };
    }
  }
}

// ---------------------------------------------------------------------------------------------
// JPEG

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const DQT = 0xdb;
const DHT = 0xc4;
const DRI = 0xdd;
const SOF = new Set([0xc0, 0xc1, 0xc2]);
const JPEG_KEEP = new Set([SOI, DQT, DHT, ...SOF, DRI, SOS, EOI]);

function isJpeg(b: Uint8Array): boolean {
  return b.length >= 3 && b[0] === 0xff && b[1] === SOI && b[2] === 0xff;
}

/** True when an allowed segment's body is exactly what its marker defines, with no spare bytes. */
function bodyOk(marker: number, body: Uint8Array): boolean {
  if (marker === DQT) {
    let at = 0;
    while (at < body.length) {
      const pq = body[at]! >> 4;
      const tq = body[at]! & 0x0f;
      if (pq > 1 || tq > 3) return false;
      at += 1 + (pq === 0 ? 64 : 128);
    }
    return at === body.length && body.length > 0;
  }
  if (marker === DHT) {
    let at = 0;
    while (at < body.length) {
      const tc = body[at]! >> 4;
      const th = body[at]! & 0x0f;
      if (tc > 1 || th > 3 || at + 17 > body.length) return false;
      let n = 0;
      for (let i = 1; i <= 16; i++) n += body[at + i]!;
      if (n > 256) return false;
      at += 17 + n;
    }
    return at === body.length && body.length > 0;
  }
  if (SOF.has(marker)) {
    if (body.length < 6) return false;
    const nf = body[5]!;
    const width = (body[3]! << 8) | body[4]!;
    // Grey or YCbCr only (review M10): 2 or 4 components (CMYK, YCCK) need APP14, which is dropped.
    return (nf === 1 || nf === 3) && width > 0 && body.length === 6 + 3 * nf;
  }
  if (marker === DRI) return body.length === 2;
  if (marker === SOS) {
    if (body.length < 1) return false;
    const ns = body[0]!;
    return ns >= 1 && ns <= 4 && body.length === 4 + 2 * ns;
  }
  return true;
}

/**
 * Every segment of a well-formed baseline, extended or progressive Huffman JPEG, up to EOI. A scan
 * piece runs from its SOS marker to the end of its entropy-coded data (stuffed bytes and restart
 * markers included). Throws `unsupported` otherwise.
 */
function walkJpeg(b: Uint8Array): Walk {
  const kept = new Kept();
  kept.add(0, 2);
  let at = 2;
  let sawFrame = false;
  let sawScan = false;
  for (;;) {
    if (at >= b.length || b[at] !== 0xff) throw unsupported();
    // Fill bytes before a marker carry nothing; they are skipped and never copied.
    while (at + 1 < b.length && b[at + 1] === 0xff) at++;
    if (at + 1 >= b.length) throw unsupported();
    const marker = b[at + 1]!;
    if (marker === EOI) {
      if (!sawScan) throw unsupported();
      kept.add(at, at + 2);
      return { kept, end: at + 2 };
    }
    // Standalone markers (SOI again, TEM, RSTn outside a scan) and 0xFF00 are not segments here.
    if (marker === SOI || marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) throw unsupported();
    if (at + 4 > b.length) throw unsupported();
    const len = (b[at + 2]! << 8) | b[at + 3]!;
    if (len < 2 || at + 2 + len > b.length) throw unsupported();
    const end = at + 2 + len;
    const isApp = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;
    if (!isApp && !JPEG_KEEP.has(marker)) throw unsupported();
    if (!isApp && !bodyOk(marker, b.subarray(at + 4, end))) throw unsupported();
    if (SOF.has(marker)) {
      if (sawFrame) throw unsupported();
      sawFrame = true;
    }
    if (marker !== SOS) {
      if (isApp) kept.dropped++;
      else kept.add(at, end);
      at = end;
      continue;
    }
    if (!sawFrame) throw unsupported();
    sawScan = true;
    // Entropy-coded data: until a 0xFF followed by anything but 0x00 or a restart marker.
    let p = end;
    for (;;) {
      if (p + 1 >= b.length) throw unsupported();
      if (b[p] === 0xff) {
        const n = b[p + 1]!;
        if (n !== 0x00 && !(n >= 0xd0 && n <= 0xd7)) break;
        p += 2;
      } else {
        p++;
      }
    }
    kept.add(at, p);
    at = p;
  }
}

// ---------------------------------------------------------------------------------------------

function walk(bytes: Uint8Array): Walk {
  if (isPng(bytes)) return walkPng(bytes);
  if (isJpeg(bytes)) return walkJpeg(bytes);
  throw unsupported();
}

/**
 * The image with every chunk or segment off the allowlist removed, and nothing after the end
 * marker. Only PNG and JPEG (Huffman, SOF0-SOF2); anything else or anything malformed throws
 * `CleanError('unsupported')`.
 */
export function cleanImage(bytes: Uint8Array): Uint8Array {
  const { ranges } = walk(bytes).kept;
  const out = new Uint8Array(ranges.reduce((n, [s, e]) => n + (e - s), 0));
  let at = 0;
  for (const [s, e] of ranges) {
    out.set(bytes.subarray(s, e), at);
    at += e - s;
  }
  return out;
}

/**
 * Throws `CleanError('metadata')` unless every chunk or segment is on the allowlist and nothing
 * follows the end marker; `CleanError('unsupported')` for anything that is not a well-formed PNG or JPEG.
 */
export function assertClean(bytes: Uint8Array): void {
  const w = walk(bytes);
  if (w.end !== bytes.length || w.kept.dropped > 0) throw new CleanError('metadata');
}
