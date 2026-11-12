// The receiving device's check of a proof image (row P-031, job J-22; Plan 5 Tasks 13 and 15).
//
// The owner's rule: no virus-scanning service and no server antivirus. Instead, before a proof
// image is shown, the device that received it:
//   1. refuses a declared type other than PNG, JPEG or WebP, and bytes whose magic is not that type;
//   2. reads the width and height from the header with bounds-checked walkers (like Task 7's
//      cleaners) and refuses a malformed, truncated, animated or over-cap file BEFORE any decode;
//   3. refuses a PNG with tRNS or a JPEG with an APP14 segment (`unsupported`), since stripping
//      either would change which pixels show and not only their tint (lead's ruling on the re-verify
//      of f8c9fa78, owner question Q2: fail closed; the sender's app never produces either), then
//      strips every other metadata chunk or segment (Exif with its orientation tag, XMP, ICC, text) and
//      decodes only the picture left (the browser's createImageBitmap, passed in as `deps.decode`):
//      browsers apply an Exif orientation when they decode, and nothing the sender never attested
//      may turn, mirror or recolour what this device shows;
//   4. draws the decoded pixels onto a fresh canvas and exports new PNG bytes (`deps.render`);
//   5. checks that output is a well-formed PNG of the same size, no larger than
//      RECEIVE_MAX_RENDER_BYTES (it becomes a data: URL, which browsers cap), and drops every chunk
//      but IHDR, PLTE, IDAT and IEND (`cleanImage`).
// Only the bytes from step 5 are ever shown. The received bytes never reach an <img> or the decoder
// as they came, so anything smuggled in them (trailing script bytes, a polyglot, metadata) is not in
// what the user sees.
// Any failure is a ProofReceiveError; nothing here falls back to the received bytes.
//
// Pure logic, no I/O, no Node-only APIs: the browser parts come in as `ReceiveDeps`.
import { cleanImage } from './clean.js';
import { PROOF_MAX_SIDE } from './payloads.js';
import { PROOF_MAX_CIPHERTEXT } from './seal.js';

export type ReceiveMime = 'image/png' | 'image/jpeg' | 'image/webp';
export const RECEIVE_MIMES: readonly ReceiveMime[] = ['image/png', 'image/jpeg', 'image/webp'];

/**
 * The cap on each side, in pixels. A sender's app scales every proof to PROOF_MAX_SIDE (2600,
 * P5-A25) before sealing it, so nothing larger is a real proof: at most 2600 x 2600 = 6.76
 * megapixels, about 27 MB of RGBA once decoded.
 */
export const RECEIVE_MAX_SIDE = PROOF_MAX_SIDE;
/** The cap on the received image bytes: a proof's ciphertext is at most PROOF_MAX_CIPHERTEXT (4 MiB). */
export const RECEIVE_MAX_BYTES = PROOF_MAX_CIPHERTEXT;
/**
 * The cap on the fresh copy drawn from a proof (`deps.render`'s PNG), which the page shows as a
 * data: URL. 28 MiB: the worst case is an image of the maximum side, 2600 x 2600, exported as an
 * uncompressed RGBA PNG, about 27 MB, so no decodable real proof is ever refused on size; and
 * Firefox's data: URL limit is 32 MB, so a copy within the cap always shows. Over it is
 * `render-failed`.
 */
export const RECEIVE_MAX_RENDER_BYTES = 28 * 1024 * 1024;

/**
 * - `unsupported`: the declared type is not PNG, JPEG or WebP, the bytes are another type, the
 *   image is animated, or it is a PNG with tRNS or a JPEG with APP14 (see step 3 above).
 * - `too-large`: over RECEIVE_MAX_BYTES, or a side over RECEIVE_MAX_SIDE.
 * - `undecodable`: the header is malformed or truncated, does not match the declared size, or the
 *   decoder failed.
 * - `render-failed`: drawing or exporting the fresh copy failed, or the copy is not a sound PNG of
 *   the same size, or is over RECEIVE_MAX_RENDER_BYTES.
 */
export type ProofReceiveErrorCode = 'unsupported' | 'too-large' | 'undecodable' | 'render-failed';

/** The message is the code alone, so an error never carries image bytes. */
export class ProofReceiveError extends Error {
  readonly code: ProofReceiveErrorCode;
  constructor(code: ProofReceiveErrorCode) {
    super(code);
    this.name = 'ProofReceiveError';
    this.code = code;
  }
}

const err = (code: ProofReceiveErrorCode): ProofReceiveError => new ProofReceiveError(code);
const bad = (): ProofReceiveError => err('undecodable');

/** Refuse a side over the cap as soon as a header names it, before the rest of the file is walked. */
function capped(w: number, h: number): void {
  if (w > RECEIVE_MAX_SIDE || h > RECEIVE_MAX_SIDE) throw err('too-large');
}

/** Plan 5 Task 15 / P5-A25: the uploader's picked file, at most this many bytes and decoded pixels. */
export const PROOF_MAX_INPUT_BYTES = 20 * 1024 * 1024;
export const PROOF_MAX_DECODED_PIXELS = 40_000_000;

/** The cap for a picked file: its decoded size, not its sides (it is scaled down to PROOF_MAX_SIDE). */
function inputCapped(w: number, h: number): void {
  if (w * h > PROOF_MAX_DECODED_PIXELS) throw err('too-large');
}

type Cap = (w: number, h: number) => void;

export interface ImageHeader {
  mime: ReceiveMime;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------------------------
// Header walkers. Each reads every length with a bounds check, walks the whole file to its end
// marker, and refuses trailing bytes after it.

const u32be = (b: Uint8Array, at: number): number => ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;
const u16be = (b: Uint8Array, at: number): number => (b[at]! << 8) | b[at + 1]!;
const u16le = (b: Uint8Array, at: number): number => b[at]! | (b[at + 1]! << 8);
const u24le = (b: Uint8Array, at: number): number => b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16);
const u32le = (b: Uint8Array, at: number): number => (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;
const ascii = (b: Uint8Array, at: number, s: string): boolean => [...s].every((c, i) => b[at + i] === c.charCodeAt(0));

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

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
  for (const x of bytes) c = CRC_TABLE[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Allowed bit depths per PNG colour type (PNG spec 11.2.2). */
const PNG_DEPTHS: Record<number, readonly number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
const PNG_CRITICAL = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND']);

/**
 * `received`: the walk is of the bytes as they came from the sender, so a chunk or segment whose
 * removal would change which pixels show (PNG tRNS, JPEG APP14) is refused as `unsupported` rather
 * than stripped. Off for the device's own copies (the stripped picture, the fresh PNG).
 */
function pngHeader(b: Uint8Array, received: boolean, cap: Cap = capped): ImageHeader {
  let at = 8;
  let width = 0;
  let height = 0;
  let colour = -1;
  let sawPlte = false;
  let sawIdat = false;
  let idatDone = false;
  for (let first = true; ; first = false) {
    if (at + 12 > b.length) throw bad();
    const len = u32be(b, at);
    if (len > 0x7fffffff || len > b.length - at - 12) throw bad();
    const typeBytes = b.subarray(at + 4, at + 8);
    if (!typeBytes.every((c) => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a))) throw bad();
    const type = String.fromCharCode(...typeBytes);
    if (crc32(b.subarray(at + 4, at + 8 + len)) !== u32be(b, at + 8 + len)) throw bad();
    const data = at + 8;
    if (first !== (type === 'IHDR')) throw bad();
    if (type === 'IHDR') {
      if (len !== 13) throw bad();
      width = u32be(b, data);
      height = u32be(b, data + 4);
      const depth = b[data + 8]!;
      colour = b[data + 9]!;
      if (width === 0 || height === 0 || width > 0x7fffffff || height > 0x7fffffff) throw bad();
      if (!PNG_DEPTHS[colour]?.includes(depth)) throw bad();
      cap(width, height);
      if (b[data + 10] !== 0 || b[data + 11] !== 0 || b[data + 12]! > 1) throw bad();
    }
    // APNG: an animation control chunk means more than one picture.
    if (type === 'acTL' || type === 'fcTL' || type === 'fdAT') throw err('unsupported');
    // Transparency: dropping it would turn transparent pixels opaque. gAMA, cHRM, sRGB and iCCP only
    // shift the colours, so they are stripped like any other ancillary chunk.
    if (received && type === 'tRNS') throw err('unsupported');
    const critical = (typeBytes[0]! & 0x20) === 0;
    if (critical && !PNG_CRITICAL.has(type)) throw bad();
    if (type === 'PLTE') {
      if (sawPlte || sawIdat || len === 0 || len % 3 !== 0 || len > 768 || colour === 0 || colour === 4) throw bad();
      sawPlte = true;
    }
    if (type === 'IDAT') {
      if (idatDone) throw bad(); // IDATs must be consecutive
      sawIdat = true;
    } else if (sawIdat) {
      idatDone = true;
    }
    at = data + len + 4;
    if (type === 'IEND') {
      if (len !== 0 || !sawIdat || (colour === 3 && !sawPlte)) throw bad();
      if (at !== b.length) throw bad();
      return { mime: 'image/png', width, height };
    }
  }
}

// JPEG markers (ITU T.81 table B.1).
const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const DQT = 0xdb;
const DHT = 0xc4;
const DAC = 0xcc;
const DRI = 0xdd;
/** Every frame type: baseline, extended, progressive, lossless, Huffman or arithmetic. */
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
/** APP14: Adobe's colour transform flag, which decides how the decoder reads the components. */
const APP14 = 0xee;

function jpegHeader(b: Uint8Array, received: boolean, cap: Cap = capped): ImageHeader {
  let at = 2;
  let width = 0;
  let height = 0;
  let sawScan = false;
  for (;;) {
    if (at >= b.length || b[at] !== 0xff) throw bad();
    while (at + 1 < b.length && b[at + 1] === 0xff) at++;
    if (at + 1 >= b.length) throw bad();
    const marker = b[at + 1]!;
    if (marker === EOI) {
      if (!sawScan || at + 2 !== b.length) throw bad();
      return { mime: 'image/jpeg', width, height };
    }
    if (at + 4 > b.length) throw bad();
    const len = u16be(b, at + 2);
    if (len < 2 || at + 2 + len > b.length) throw bad();
    const body = b.subarray(at + 4, at + 2 + len);
    const end = at + 2 + len;
    const isApp = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;
    // Any APP14, Adobe-tagged or not: decoders differ on which ones they honour, so none is stripped.
    if (received && marker === APP14) throw err('unsupported');
    if (SOF.has(marker)) {
      if (width !== 0) throw bad(); // one frame only
      if (body.length < 6) throw bad();
      height = u16be(body, 1);
      width = u16be(body, 3);
      const nf = body[5]!;
      // Height 0 needs a DNL segment later on: refused, as decoders handle it unevenly.
      if (width === 0 || height === 0 || nf < 1 || nf > 4 || body.length !== 6 + 3 * nf) throw bad();
      cap(width, height);
    } else if (marker === SOS) {
      if (width === 0 || body.length < 1) throw bad();
      const ns = body[0]!;
      if (ns < 1 || ns > 4 || body.length !== 4 + 2 * ns) throw bad();
      sawScan = true;
      // Entropy-coded data: until a 0xFF followed by anything but 0x00 or a restart marker.
      let p = end;
      for (;;) {
        if (p + 1 >= b.length) throw bad();
        if (b[p] === 0xff) {
          const n = b[p + 1]!;
          if (n !== 0x00 && !(n >= 0xd0 && n <= 0xd7)) break;
          p += 2;
        } else {
          p++;
        }
      }
      at = p;
      continue;
    } else if (!isApp && marker !== DQT && marker !== DHT && marker !== DAC && marker !== DRI) {
      throw bad(); // SOI again, TEM, RSTn outside a scan, DNL, DHP, EXP, JPG and the reserved ones
    }
    at = end;
  }
}

function webpHeader(b: Uint8Array, cap: Cap = capped): ImageHeader {
  if (b.length < 20) throw bad();
  if (u32le(b, 4) !== b.length - 8 || b.length % 2 !== 0) throw bad();
  let at = 12;
  let first: string | null = null;
  let canvas: { w: number; h: number } | null = null;
  let image: { w: number; h: number } | null = null;
  while (at < b.length) {
    if (at + 8 > b.length) throw bad();
    const fourcc = String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!);
    const size = u32le(b, at + 4);
    const data = at + 8;
    if (size > b.length - data) throw bad();
    const next = data + size + (size & 1);
    if (next > b.length) throw bad();
    if (first === null) {
      first = fourcc;
      if (fourcc !== 'VP8 ' && fourcc !== 'VP8L' && fourcc !== 'VP8X') throw bad();
    } else if (first !== 'VP8X') {
      throw bad(); // a simple file is one image chunk and nothing else
    }
    if (fourcc === 'ANIM' || fourcc === 'ANMF') throw err('unsupported');
    if (fourcc === 'VP8X') {
      if (at !== 12 || size !== 10) throw bad();
      if (b[data]! & 0x02) throw err('unsupported'); // the animation flag
      canvas = { w: u24le(b, data + 4) + 1, h: u24le(b, data + 7) + 1 };
      cap(canvas.w, canvas.h);
    } else if (fourcc === 'VP8 ' || fourcc === 'VP8L') {
      if (image !== null) throw bad();
      image = fourcc === 'VP8 ' ? vp8Size(b, data, size) : vp8lSize(b, data, size);
      cap(image.w, image.h);
    }
    at = next;
  }
  if (image === null) throw bad();
  if (canvas !== null && (canvas.w !== image.w || canvas.h !== image.h)) throw bad();
  return { mime: 'image/webp', width: image.w, height: image.h };
}

/** A lossy key frame: 3-byte frame tag, start code 9d 01 2a, then 14-bit width and height. */
function vp8Size(b: Uint8Array, at: number, size: number): { w: number; h: number } {
  if (size < 10) throw bad();
  const tag = u24le(b, at);
  if (tag & 1) throw bad(); // not a key frame
  if (((tag >> 5) & 0x7ffff) > size - 10) throw bad(); // the first partition runs past the chunk
  if (b[at + 3] !== 0x9d || b[at + 4] !== 0x01 || b[at + 5] !== 0x2a) throw bad();
  const w = u16le(b, at + 6) & 0x3fff;
  const h = u16le(b, at + 8) & 0x3fff;
  if (w === 0 || h === 0) throw bad();
  return { w, h };
}

/** A lossless image: signature 0x2f, 14-bit width-1, 14-bit height-1, alpha bit, 3-bit version 0. */
function vp8lSize(b: Uint8Array, at: number, size: number): { w: number; h: number } {
  if (size < 5 || b[at] !== 0x2f) throw bad();
  const bits = u32le(b, at + 1);
  if (bits >>> 29 !== 0) throw bad();
  return { w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1 };
}

/** The type the magic bytes say, or null. */
export function sniffImage(b: Uint8Array): ReceiveMime | null {
  if (b.length >= 8 && PNG_SIGNATURE.every((v, i) => b[i] === v)) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === SOI && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')) return 'image/webp';
  return null;
}

/**
 * The type, width and height of a PNG, JPEG or WebP, read without decoding. Throws
 * ProofReceiveError: `unsupported` for another type or an animation, `too-large` as soon as a
 * header names a side over RECEIVE_MAX_SIDE, `undecodable` for anything malformed or truncated,
 * or with bytes after its end.
 */
export function readImageHeader(bytes: Uint8Array): ImageHeader {
  return header(bytes, false);
}

/**
 * The uploader's picked file (Plan 5 Task 15, P5-A25), read without decoding: the same walkers and
 * refusals as `readImageHeader`, except that `too-large` is over PROOF_MAX_INPUT_BYTES or
 * PROOF_MAX_DECODED_PIXELS (the picture is scaled down to PROOF_MAX_SIDE after the decode).
 */
export function readInputHeader(bytes: Uint8Array): ImageHeader {
  if (bytes.length > PROOF_MAX_INPUT_BYTES) throw err('too-large');
  return header(bytes, false, inputCapped);
}

function header(bytes: Uint8Array, received: boolean, cap: Cap = capped): ImageHeader {
  const mime = sniffImage(bytes);
  if (mime === 'image/png') return pngHeader(bytes, received, cap);
  if (mime === 'image/jpeg') return jpegHeader(bytes, received, cap);
  if (mime === 'image/webp') return webpHeader(bytes, cap);
  throw err('unsupported');
}

// ---------------------------------------------------------------------------------------------
// What the decoder is handed: the picture, nothing else.

/** The VP8X flag bits (WebP container spec): ICC profile, alpha, Exif, XMP, animation. */
const VP8X_ALPHA = 0x10;

/**
 * A WebP with only its picture: VP8X (flags down to alpha, since the chunks the other flags announce
 * are gone, and its reserved bytes 0 as the spec requires), at most one ALPH and the one VP8 or VP8L
 * chunk, under a RIFF size that fits. EXIF, XMP and ICCP go. An ALPH is kept only before a lossy
 * `VP8 ` chunk, the one place it means anything: a later ALPH before it is dropped (libwebp reads the
 * first), and an ALPH after the image chunk or beside a VP8L chunk is refused (re-verify of f8c9fa78,
 * F-R3). Runs after `webpHeader` accepted the file, and still checks every length.
 */
function webpPictureOnly(b: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  let sawAlph = false;
  let sawImage = false;
  let at = 12;
  while (at < b.length) {
    if (at + 8 > b.length) throw bad();
    const fourcc = String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!);
    const size = u32le(b, at + 4);
    if (size > b.length - at - 8) throw bad();
    const next = at + 8 + size + (size & 1);
    if (next > b.length) throw bad();
    if (fourcc === 'VP8X') {
      if (size !== 10) throw bad();
      const x = b.slice(at, next);
      x[8] = x[8]! & VP8X_ALPHA;
      x.fill(0, 9, 12); // reserved
      parts.push(x);
    } else if (fourcc === 'ALPH') {
      if (sawImage) throw bad();
      if (!sawAlph) parts.push(b.subarray(at, next));
      sawAlph = true;
    } else if (fourcc === 'VP8 ' || fourcc === 'VP8L') {
      if (sawImage || (fourcc === 'VP8L' && sawAlph)) throw bad();
      sawImage = true;
      parts.push(b.subarray(at, next));
    }
    at = next;
  }
  if (!sawImage) throw bad();
  const out = new Uint8Array(12 + parts.reduce((n, part) => n + part.length, 0));
  out.set(b.subarray(0, 12));
  new DataView(out.buffer).setUint32(4, out.length - 8, true);
  let p = 12;
  for (const part of parts) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

/**
 * The bytes handed to the decoder: the received picture with every metadata chunk or segment removed
 * (review of 9 Nov 2026, F2). Browsers apply an Exif orientation tag when they decode (createImageBitmap's
 * `imageOrientation: 'none'` is deprecated and read as `'from-image'`; nothing turns it off), and
 * an ICC profile changes the colours, so a tag the sender never attested could turn, mirror or
 * recolour what this device shows. With the metadata gone, the decoder sees only what the header
 * walk checked. PNG and JPEG go through `cleanImage`, the sender's own allowlist, so a JPEG the
 * sender could not have produced (lossless, arithmetic, CMYK) is `undecodable` here too.
 */
function pictureOnly(bytes: Uint8Array, mime: ReceiveMime): Uint8Array {
  if (mime === 'image/webp') return webpPictureOnly(bytes);
  try {
    return cleanImage(bytes);
  } catch {
    throw bad();
  }
}

// ---------------------------------------------------------------------------------------------
// The check itself.

/** A decoded picture: what createImageBitmap returns. */
export interface ReceiveBitmap {
  readonly width: number;
  readonly height: number;
  close?(): void;
}

/** The browser parts, passed in so the rule can be tested without a real canvas. */
export interface ReceiveDeps {
  /**
   * Decode the bytes as `mime` (createImageBitmap on a Blob). Throws or rejects on failure. The bytes
   * carry no metadata (receiveProof strips it first), so there is no orientation tag to apply.
   */
  decode(bytes: Uint8Array, mime: ReceiveMime): Promise<ReceiveBitmap>;
  /** Draw `bitmap` at width x height on a fresh canvas and export it as PNG bytes. */
  render(bitmap: ReceiveBitmap, width: number, height: number): Promise<Uint8Array>;
}

/**
 * What the sender's envelope says about the image (`proof.attached`: mime, width, height). All
 * three are required, as in the envelope, so the header-against-envelope size check is never
 * skipped by a caller that left the size out.
 */
export interface ReceiveDeclared {
  mime: string;
  width: number;
  height: number;
}

export interface ReceivedProof {
  /** The fresh PNG drawn on this device: the only bytes ever shown. */
  png: Uint8Array;
  width: number;
  height: number;
}

/**
 * Check a received proof image and draw a fresh copy of it (see the top of this file). Resolves
 * with the fresh PNG; rejects with ProofReceiveError and nothing else.
 */
export async function receiveProof(bytes: Uint8Array, declared: ReceiveDeclared, deps: ReceiveDeps): Promise<ReceivedProof> {
  if (!(bytes instanceof Uint8Array)) throw bad();
  const mime = declared.mime as ReceiveMime;
  if (!RECEIVE_MIMES.includes(mime)) throw err('unsupported');
  if (bytes.length > RECEIVE_MAX_BYTES) throw err('too-large');
  if (sniffImage(bytes) !== mime) throw err('unsupported');
  const head = header(bytes, true);
  if (head.width > RECEIVE_MAX_SIDE || head.height > RECEIVE_MAX_SIDE) throw err('too-large');
  if (declared.width !== head.width || declared.height !== head.height) throw bad();

  // The decoder gets a fresh copy with the metadata gone, never the caller's buffer; the copy must
  // still be the same picture.
  const picture = pictureOnly(bytes, mime);
  const pictureHead = readImageHeader(picture);
  if (pictureHead.mime !== mime || pictureHead.width !== head.width || pictureHead.height !== head.height) throw bad();
  let bitmap: ReceiveBitmap;
  try {
    bitmap = await deps.decode(picture, mime);
  } catch {
    throw bad();
  }
  try {
    if (bitmap === null || typeof bitmap !== 'object' || bitmap.width !== head.width || bitmap.height !== head.height) throw bad();
    let out: Uint8Array;
    try {
      out = await deps.render(bitmap, head.width, head.height);
    } catch {
      throw err('render-failed');
    }
    // The byte cap comes before the walk, so an oversized copy is never scanned or base64-encoded.
    if (!(out instanceof Uint8Array) || out.length > RECEIVE_MAX_RENDER_BYTES || sniffImage(out) !== 'image/png') throw err('render-failed');
    let png: Uint8Array;
    try {
      const outHead = readImageHeader(out);
      if (outHead.width !== head.width || outHead.height !== head.height) throw err('render-failed');
      png = cleanImage(out);
    } catch {
      throw err('render-failed');
    }
    return { png, width: head.width, height: head.height };
  } finally {
    try {
      bitmap.close?.();
    } catch {
      // A close that throws changes nothing about the result.
    }
  }
}
