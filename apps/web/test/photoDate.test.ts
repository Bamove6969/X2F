// Owner G16 (2026-11-07): the proof's date comes first from the photo's own Exif date, read in the
// browser before the re-encode strips it; only the UTC time is sent, never the Exif.
import { isUtcSecond } from '@x2f/proof';
import { describe, expect, it } from 'vitest';
import { photoTakenAt, photoTimeToUtc } from '../src/proof/photoDate.js';
import { hasImageMetadata } from '../src/proof/reencode.js';

const latin1 = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));
const cat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
};

/** A little-endian TIFF with IFD0 → Exif IFD holding DateTimeOriginal and (optionally) its offset. */
function tiff(date: string, off?: string): Uint8Array {
  const tags: Array<[number, string]> = [[0x9003, date]];
  if (off !== undefined) tags.push([0x9011, off]);
  const b: number[] = [0x49, 0x49, 42, 0, 8, 0, 0, 0];
  const exifAt = 8 + 2 + 12 + 4;
  let dataAt = exifAt + 2 + tags.length * 12 + 4;
  const u16 = (v: number): number[] => [v & 0xff, v >> 8];
  const u32 = (v: number): number[] => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24];
  b.push(...u16(1), ...u16(0x8769), ...u16(4), ...u32(1), ...u32(exifAt), ...u32(0));
  b.push(...u16(tags.length));
  const data: number[] = [];
  for (const [tag, v] of tags) {
    const bytes = [...latin1(v), 0];
    b.push(...u16(tag), ...u16(2), ...u32(bytes.length), ...u32(dataAt));
    dataAt += bytes.length;
    data.push(...bytes);
  }
  b.push(...u32(0), ...data);
  return Uint8Array.from(b);
}

function jpeg(t: Uint8Array): Blob {
  const body = cat(latin1('Exif\0\0'), t);
  const app1 = cat(Uint8Array.of(0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 0xff), body);
  return new Blob([new Uint8Array(cat(Uint8Array.of(0xff, 0xd8), app1, Uint8Array.of(0xff, 0xda, 0, 2, 0xff, 0xd9)))], { type: 'image/jpeg' });
}

describe('photoTakenAt (owner G16)', () => {
  it('a photo with its own offset gives that exact instant in UTC', async () => {
    expect(await photoTakenAt(jpeg(tiff('2026:10:16 14:32:05', '+02:00')))).toBe('2026-10-16T12:32:05Z');
    expect(await photoTakenAt(jpeg(tiff('2026:10:16 22:10:00', '-05:00')))).toBe('2026-10-17T03:10:00Z');
  });

  it('a photo with no offset is read in this device time zone', async () => {
    const want = new Date(2026, 9, 16, 14, 32, 5).toISOString().replace(/\.\d{3}Z$/, 'Z');
    expect(await photoTakenAt(jpeg(tiff('2026:10:16 14:32:05')))).toBe(want);
  });

  it('gives only a UTC time: no camera, place or other Exif field', async () => {
    const out = await photoTakenAt(jpeg(tiff('2026:10:16 14:32:05', '+00:00')));
    expect(isUtcSecond(out)).toBe(true);
    expect(hasImageMetadata(latin1(String(out)))).toBe(false);
  });

  it('null when the picture has no date, or cannot be read', async () => {
    expect(await photoTakenAt(new Blob([Uint8Array.of(0xff, 0xd8, 0xff, 0xd9)]))).toBeNull();
    expect(await photoTakenAt(new Blob([]))).toBeNull();
    const broken = { size: 100, arrayBuffer: () => Promise.reject(new Error('gone')), slice: () => ({ arrayBuffer: () => Promise.reject(new Error('gone')) }) } as unknown as Blob;
    expect(await photoTakenAt(broken)).toBeNull();
  });

  it('reads only the metadata, never the whole picture (review 2026-11-10)', async () => {
    const real = jpeg(tiff('2026:10:16 14:32:05', '+02:00'));
    const big = new Blob([await real.slice(0, real.size - 2).arrayBuffer(), new Uint8Array(4 * 1024 * 1024), Uint8Array.of(0xff, 0xd9)], { type: 'image/jpeg' });
    let read = 0;
    const spy = {
      size: big.size,
      type: big.type,
      arrayBuffer: () => {
        read += big.size;
        return big.arrayBuffer();
      },
      slice: (s?: number, e?: number) => {
        const part = big.slice(s, e);
        read += part.size;
        return part;
      },
    } as unknown as Blob;
    expect(await photoTakenAt(spy)).toBe('2026-10-16T12:32:05Z');
    expect(read).toBeLessThan(1024);
  });

  it('photoTimeToUtc crosses the date line both ways', () => {
    const t = { year: 2026, month: 1, day: 1, hour: 0, minute: 30, second: 0 };
    expect(photoTimeToUtc({ ...t, offsetMinutes: 840 })).toBe('2025-12-31T10:30:00Z');
    expect(photoTimeToUtc({ ...t, offsetMinutes: -720 })).toBe('2026-01-01T12:30:00Z');
  });
});
