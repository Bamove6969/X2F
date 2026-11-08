import { describe, expect, it } from 'vitest';
import { type PhotoTime, readPhotoTime } from '../src/index.js';
import { PNG_SIGNATURE, cleanJpeg, cleanPng, concat, jpegCore, metadataJpeg, metadataPng, pngChunk, zlibStored, pngRaw } from './fixtures.js';

// Owner G16 (2026-11-07): the proof's date is read first from the photo's own Exif date, in the
// browser, before the re-encode strips it; only the date leaves the device.

const latin1 = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));

type Tag = [tag: number, value: string];

/**
 * A TIFF block: IFD0 with an Exif IFD pointer (0x8769) and a Model tag, then the Exif IFD with the
 * given ASCII tags. `le` writes it little-endian (`II`), as phones do; otherwise big-endian (`MM`).
 */
function tiff(exifTags: Tag[], le = true, ifd0Tags: Tag[] = [[0x0110, 'Pixel 9']]): Uint8Array {
  const parts: number[] = [];
  const u16 = (v: number): number[] => (le ? [v & 0xff, v >> 8] : [v >> 8, v & 0xff]);
  const u32 = (v: number): number[] => (le ? [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24] : [v >>> 24, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]);
  const header = [...(le ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8)];
  const ifdSize = (n: number): number => 2 + n * 12 + 4;
  const ifd0At = 8;
  const exifAt = ifd0At + ifdSize(ifd0Tags.length + 1);
  let dataAt = exifAt + ifdSize(exifTags.length);
  const data: number[] = [];
  const entry = (tag: number, value: string): number[] => {
    const bytes = [...latin1(value), 0];
    const out = [...u16(tag), ...u16(2), ...u32(bytes.length)];
    if (bytes.length <= 4) return [...out, ...bytes, ...new Array<number>(4 - bytes.length).fill(0)];
    const at = dataAt;
    dataAt += bytes.length;
    data.push(...bytes);
    return [...out, ...u32(at)];
  };
  parts.push(...header, ...u16(ifd0Tags.length + 1));
  for (const [t, v] of ifd0Tags) parts.push(...entry(t, v));
  parts.push(...u16(0x8769), ...u16(4), ...u32(1), ...u32(exifAt), ...u32(0));
  parts.push(...u16(exifTags.length));
  for (const [t, v] of exifTags) parts.push(...entry(t, v));
  parts.push(...u32(0));
  return Uint8Array.from([...parts, ...data]);
}

function segment(marker: number, body: Uint8Array): Uint8Array {
  return concat(Uint8Array.of(0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff), body);
}

function jpegWith(...app: Uint8Array[]): Uint8Array {
  return concat(Uint8Array.of(0xff, 0xd8), segment(0xe0, latin1('JFIF\0\x01\x01\0\0\x01\0\x01\0\0')), ...app, ...jpegCore(), Uint8Array.of(0xff, 0xd9));
}

const exifApp1 = (t: Uint8Array): Uint8Array => segment(0xe1, concat(latin1('Exif\0\0'), t));
const xmpApp1 = (xml: string): Uint8Array => segment(0xe1, concat(latin1('http://ns.adobe.com/xap/1.0/\0'), new TextEncoder().encode(xml)));

function pngWith(...chunks: Uint8Array[]): Uint8Array {
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, 4);
  new DataView(ihdr.buffer).setUint32(4, 3);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return concat(PNG_SIGNATURE, pngChunk('IHDR', ihdr), ...chunks, pngChunk('IDAT', zlibStored(pngRaw())), pngChunk('IEND', new Uint8Array(0)));
}

const at = (y: number, mo: number, d: number, h: number, mi: number, s: number, offsetMinutes: number | null): PhotoTime => ({
  year: y,
  month: mo,
  day: d,
  hour: h,
  minute: mi,
  second: s,
  offsetMinutes,
});

const ORIGINAL = 0x9003;
const DIGITIZED = 0x9004;
const OFFSET_ORIGINAL = 0x9011;
const OFFSET_DIGITIZED = 0x9012;

describe('readPhotoTime: Exif in a JPEG', () => {
  it('reads DateTimeOriginal with its offset (little-endian, as phones write it)', () => {
    const b = jpegWith(exifApp1(tiff([[ORIGINAL, '2026:10:16 14:32:05'], [OFFSET_ORIGINAL, '+02:00']])));
    expect(readPhotoTime(b)).toEqual(at(2026, 10, 16, 14, 32, 5, 120));
  });

  it('reads big-endian TIFF too', () => {
    const b = jpegWith(exifApp1(tiff([[ORIGINAL, '2026:10:16 14:32:05'], [OFFSET_ORIGINAL, '-05:30']], false)));
    expect(readPhotoTime(b)).toEqual(at(2026, 10, 16, 14, 32, 5, -330));
  });

  it('has no offset when the photo does not carry one', () => {
    const b = jpegWith(exifApp1(tiff([[ORIGINAL, '2026:10:16 14:32:05']])));
    expect(readPhotoTime(b)).toEqual(at(2026, 10, 16, 14, 32, 5, null));
  });

  it('falls back to CreateDate (DateTimeDigitized) with its own offset', () => {
    const b = jpegWith(exifApp1(tiff([[DIGITIZED, '2026:10:15 23:59:59'], [OFFSET_DIGITIZED, '+00:00']])));
    expect(readPhotoTime(b)).toEqual(at(2026, 10, 15, 23, 59, 59, 0));
  });

  it('prefers DateTimeOriginal over CreateDate', () => {
    const b = jpegWith(exifApp1(tiff([[ORIGINAL, '2026:10:16 08:00:00'], [DIGITIZED, '2026:10:17 09:00:00']])));
    expect(readPhotoTime(b)?.day).toBe(16);
  });

  it('ignores an empty or impossible date and an offset that is not one', () => {
    expect(readPhotoTime(jpegWith(exifApp1(tiff([[ORIGINAL, '0000:00:00 00:00:00']]))))).toBeNull();
    expect(readPhotoTime(jpegWith(exifApp1(tiff([[ORIGINAL, '2026:02:30 10:00:00']]))))).toBeNull();
    expect(readPhotoTime(jpegWith(exifApp1(tiff([[ORIGINAL, '    :  :     :  :  ']]))))).toBeNull();
    expect(readPhotoTime(jpegWith(exifApp1(tiff([[ORIGINAL, '2026:10:16 14:32:05'], [OFFSET_ORIGINAL, '+99:00']]))))).toEqual(at(2026, 10, 16, 14, 32, 5, null));
  });

  it('never takes IFD0 ModifyDate (an edit time, not when the proof was made)', () => {
    expect(readPhotoTime(jpegWith(exifApp1(tiff([], true, [[0x0132, '2026:10:16 14:32:05']]))))).toBeNull();
  });

  it('reads nothing from a picture without metadata, or from the fake blocks of the clean() fixtures', () => {
    expect(readPhotoTime(cleanJpeg())).toBeNull();
    expect(readPhotoTime(cleanPng())).toBeNull();
    expect(readPhotoTime(metadataJpeg())).toBeNull();
    expect(readPhotoTime(metadataPng())).toBeNull();
  });

  it('survives truncated and hostile bytes', () => {
    const good = jpegWith(exifApp1(tiff([[ORIGINAL, '2026:10:16 14:32:05']])));
    for (let n = 0; n < good.length; n += 7) expect(() => readPhotoTime(good.subarray(0, n))).not.toThrow();
    // The Exif IFD pointer aimed back at IFD0, and an Exif IFD claiming 65535 entries.
    const loop = tiff([[ORIGINAL, '2026:10:16 14:32:05']]);
    new DataView(loop.buffer).setUint32(8 + 2 + 12 + 8, 8, true);
    expect(readPhotoTime(jpegWith(exifApp1(loop)))).toBeNull();
    const huge = tiff([[ORIGINAL, '2026:10:16 14:32:05']]);
    new DataView(huge.buffer).setUint16(8 + 2 + 2 * 12 + 4, 0xffff, true);
    expect(readPhotoTime(jpegWith(exifApp1(huge)))).toBeNull();
    expect(readPhotoTime(new Uint8Array(0))).toBeNull();
    expect(readPhotoTime(latin1('not a picture'))).toBeNull();
  });
});

describe('readPhotoTime: PNG and XMP', () => {
  it('reads a PNG eXIf chunk', () => {
    const b = pngWith(pngChunk('eXIf', tiff([[ORIGINAL, '2026:10:16 14:32:05'], [OFFSET_ORIGINAL, '+01:00']])));
    expect(readPhotoTime(b)).toEqual(at(2026, 10, 16, 14, 32, 5, 60));
  });

  it('reads XMP DateCreated in a PNG iTXt chunk (phone screenshots)', () => {
    const xml = '<x:xmpmeta><rdf:Description photoshop:DateCreated="2026-10-16T14:32:05"/></x:xmpmeta>';
    const b = pngWith(pngChunk('iTXt', concat(latin1('XML:com.adobe.xmp\0\0\0\0\0'), new TextEncoder().encode(xml))));
    expect(readPhotoTime(b)).toEqual(at(2026, 10, 16, 14, 32, 5, null));
  });

  it('reads XMP in a JPEG, element or attribute form, with a zone', () => {
    const el = '<x:xmpmeta><exif:DateTimeOriginal>2026-10-16T14:32:05.120+05:45</exif:DateTimeOriginal></x:xmpmeta>';
    expect(readPhotoTime(jpegWith(xmpApp1(el)))).toEqual(at(2026, 10, 16, 14, 32, 5, 345));
    const attr = '<rdf:Description xmp:CreateDate="2026-10-16T14:32Z"/>';
    expect(readPhotoTime(jpegWith(xmpApp1(attr)))).toEqual(at(2026, 10, 16, 14, 32, 0, 0));
  });

  it('prefers the Exif block over XMP', () => {
    const b = jpegWith(xmpApp1('<x xmp:CreateDate="2026-10-01T00:00:00Z"/>'), exifApp1(tiff([[ORIGINAL, '2026:10:16 14:32:05']])));
    expect(readPhotoTime(b)?.day).toBe(16);
  });

  it('skips a compressed iTXt (it does not inflate) and other text chunks', () => {
    const b = pngWith(pngChunk('iTXt', concat(latin1('XML:com.adobe.xmp\0\x01\0\0\0'), zlibStored(latin1('<x xmp:CreateDate="2026-10-16T14:32:05Z"/>')))));
    expect(readPhotoTime(b)).toBeNull();
  });
});
