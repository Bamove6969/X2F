// When the proof picture was made, from its own metadata (owner G16, 2026-11-07).
//
// The poster's browser reads this BEFORE the picture is cleaned or re-encoded (both drop every
// metadata block). Only the time leaves the device, as a UTC instant (`proof.attached` `takenAt`);
// the Exif block itself is never sent. Read in this order: Exif DateTimeOriginal, Exif CreateDate
// (DateTimeDigitized), each with its own offset tag when there is one; then XMP
// exif:DateTimeOriginal, xmp:CreateDate, photoshop:DateCreated (phone screenshots often carry only
// XMP). IFD0 DateTime is an edit time, never read. Every length and offset is bounds-checked; a
// malformed block is ignored, never an error.

/** A wall-clock time from the photo, and its UTC offset in minutes when the photo says it. */
export interface PhotoTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** Minutes east of UTC (`+02:00` is 120), or null when the photo gives no offset. */
  offsetMinutes: number | null;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
const XMP_HEADER = 'http://ns.adobe.com/xap/1.0/\0';
const XMP_KEYWORD = 'XML:com.adobe.xmp';
/** At most this many PNG chunks or JPEG segments are walked, and this many IFD entries read. */
const MAX_BLOCKS = 4096;
const MAX_ENTRIES = 512;

const TAG_EXIF_IFD = 0x8769;
const TAG_ORIGINAL = 0x9003;
const TAG_DIGITIZED = 0x9004;
const TAG_OFFSET_ORIGINAL = 0x9011;
const TAG_OFFSET_DIGITIZED = 0x9012;

function startsWith(b: Uint8Array, at: number, sig: readonly number[]): boolean {
  if (at + sig.length > b.length) return false;
  return sig.every((v, i) => b[at + i] === v);
}

function ascii(b: Uint8Array): string {
  let s = '';
  for (const c of b) s += String.fromCharCode(c);
  return s;
}

/** The metadata blocks of a PNG or JPEG: Exif TIFF blocks and XMP packets, in file order. */
function blocks(b: Uint8Array): { tiff: Uint8Array[]; xmp: string[] } {
  const out = { tiff: [] as Uint8Array[], xmp: [] as string[] };
  if (startsWith(b, 0, PNG_SIGNATURE)) {
    let at = 8;
    for (let n = 0; n < MAX_BLOCKS && at + 12 <= b.length; n++) {
      const len = ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;
      const type = ascii(b.subarray(at + 4, at + 8));
      const end = at + 12 + len;
      if (end > b.length) break;
      const data = b.subarray(at + 8, at + 8 + len);
      if (type === 'eXIf') out.tiff.push(data);
      if (type === 'iTXt') {
        const xmp = itxtXmp(data);
        if (xmp !== null) out.xmp.push(xmp);
      }
      if (type === 'IEND') break;
      at = end;
    }
    return out;
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let at = 2;
    for (let n = 0; n < MAX_BLOCKS && at + 4 <= b.length; n++) {
      if (b[at] !== 0xff) break;
      const marker = b[at + 1]!;
      if (marker === 0xff) {
        at++;
        continue;
      }
      // Stand-alone markers carry no length; the scan (SOS) and the end (EOI) end the headers.
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        at += 2;
        continue;
      }
      if (marker === 0xda || marker === 0xd9) break;
      const len = (b[at + 2]! << 8) | b[at + 3]!;
      if (len < 2 || at + 2 + len > b.length) break;
      const body = b.subarray(at + 4, at + 2 + len);
      if (marker === 0xe1) {
        if (startsWith(body, 0, EXIF_HEADER)) out.tiff.push(body.subarray(EXIF_HEADER.length));
        else if (ascii(body.subarray(0, XMP_HEADER.length)) === XMP_HEADER) out.xmp.push(utf8(body.subarray(XMP_HEADER.length)));
      }
      at += 2 + len;
    }
  }
  return out;
}

function utf8(b: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(b);
}

/** The XMP text of an uncompressed iTXt chunk with the XMP keyword, else null. */
function itxtXmp(d: Uint8Array): string | null {
  const nul = d.indexOf(0);
  if (nul < 0 || ascii(d.subarray(0, nul)) !== XMP_KEYWORD) return null;
  // Compression flag and method, then the language tag and the translated keyword, each NUL-ended.
  if (d[nul + 1] !== 0) return null;
  let at = nul + 3;
  for (let k = 0; k < 2; k++) {
    const z = d.indexOf(0, at);
    if (z < 0) return null;
    at = z + 1;
  }
  return utf8(d.subarray(at));
}

/** The ASCII values of the Exif IFD tags in a TIFF block, by tag. */
function exifTags(t: Uint8Array): Map<number, string> {
  const tags = new Map<number, string>();
  if (t.length < 8) return tags;
  const le = t[0] === 0x49 && t[1] === 0x49;
  if (!le && !(t[0] === 0x4d && t[1] === 0x4d)) return tags;
  const v = new DataView(t.buffer, t.byteOffset, t.byteLength);
  const u16 = (at: number): number | null => (at + 2 <= t.length ? v.getUint16(at, le) : null);
  const u32 = (at: number): number | null => (at + 4 <= t.length ? v.getUint32(at, le) : null);
  if (u16(2) !== 42) return tags;
  /** Each entry of the IFD at `at`: tag, type, count, and where its value is. */
  const entries = (at: number | null): Array<{ tag: number; type: number; count: number; value: number }> => {
    if (at === null || at < 8) return [];
    const n = u16(at);
    if (n === null || n > MAX_ENTRIES || at + 2 + n * 12 > t.length) return [];
    const out = [];
    for (let i = 0; i < n; i++) {
      const e = at + 2 + i * 12;
      out.push({ tag: u16(e)!, type: u16(e + 2)!, count: u32(e + 4)!, value: e + 8 });
    }
    return out;
  };
  const ifd0 = u32(4);
  const ptr = entries(ifd0).find((e) => e.tag === TAG_EXIF_IFD && e.type === 4 && e.count === 1);
  if (!ptr) return tags;
  const exifAt = u32(ptr.value);
  if (exifAt === ifd0) return tags;
  for (const e of entries(exifAt)) {
    if (e.type !== 2 || e.count === 0 || e.count > 64) continue;
    const start = e.count <= 4 ? e.value : u32(e.value);
    if (start === null || start + e.count > t.length) continue;
    const raw = t.subarray(start, start + e.count);
    const z = raw.indexOf(0);
    tags.set(e.tag, ascii(z < 0 ? raw : raw.subarray(0, z)).trim());
  }
  return tags;
}

/** Whether y-m-d is a real calendar day in a plausible year. */
function realDay(y: number, m: number, d: number): boolean {
  if (y < 1990 || y > 2200) return false;
  const c = new Date(Date.UTC(y, m - 1, d));
  return c.getUTCFullYear() === y && c.getUTCMonth() === m - 1 && c.getUTCDate() === d;
}

/** `+02:00`, `-0530`, `Z`: minutes east of UTC, or null when it is not a real offset. */
function offset(s: string | undefined): number | null {
  if (s === undefined) return null;
  if (s === 'Z') return 0;
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[2]);
  const mi = Number(m[3]);
  if (h > 14 || mi > 59) return null;
  return (m[1] === '-' ? -1 : 1) * (h * 60 + mi);
}

function time(y: number, mo: number, d: number, h: number, mi: number, s: number, off: number | null): PhotoTime | null {
  if (!realDay(y, mo, d) || h > 23 || mi > 59 || s > 60) return null;
  return { year: y, month: mo, day: d, hour: h, minute: mi, second: Math.min(s, 59), offsetMinutes: off };
}

/** An Exif date `YYYY:MM:DD HH:MM:SS`. */
function exifTime(s: string | undefined, off: string | undefined): PhotoTime | null {
  const m = s === undefined ? null : /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s);
  if (!m) return null;
  return time(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]), offset(off));
}

const XMP_FIELDS = ['exif:DateTimeOriginal', 'xmp:CreateDate', 'photoshop:DateCreated'];

/** An XMP date (ISO 8601 with a time) for one field, attribute or element form. */
function xmpTime(xml: string, field: string): PhotoTime | null {
  const f = field.replace(':', '\\:');
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- `field` is one of the constant XMP_FIELDS names (letters and one escaped colon), never input
  const m = new RegExp(`${f}\\s*=\\s*["']([^"'<>]{1,64})["']|<${f}>\\s*([^<]{1,64})\\s*</${f}>`).exec(xml);
  const v = m ? (m[1] ?? m[2]!).trim() : null;
  const d = v === null ? null : /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(v);
  if (!d) return null;
  return time(Number(d[1]), Number(d[2]), Number(d[3]), Number(d[4]), Number(d[5]), Number(d[6] ?? 0), offset(d[7]));
}

/**
 * When the picture was made, from its own metadata (see the module comment for the order), or null
 * when it carries no usable date. Never throws on malformed input.
 */
export function readPhotoTime(bytes: Uint8Array): PhotoTime | null {
  const { tiff, xmp } = blocks(bytes);
  for (const t of tiff) {
    const tags = exifTags(t);
    const found = exifTime(tags.get(TAG_ORIGINAL), tags.get(TAG_OFFSET_ORIGINAL)) ?? exifTime(tags.get(TAG_DIGITIZED), tags.get(TAG_OFFSET_DIGITIZED));
    if (found) return found;
  }
  for (const field of XMP_FIELDS) {
    for (const x of xmp) {
      const found = xmpTime(x, field);
      if (found) return found;
    }
  }
  return null;
}
