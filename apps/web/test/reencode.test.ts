// Plan 4 Task 15: reencodeImage draws the picture again and saves a fresh JPEG 0.9 of at most 5 MB,
// which carries none of the original's metadata. The browser parts are passed in, so the rule is
// checked here and the device check on the output (no Exif, no XMP) is checked on real bytes.
import { describe, expect, it, vi } from 'vitest';
import { hasImageMetadata, MAX_UNBLURRED_BYTES, reencodeImage, type ReencodeDeps } from '../src/proof/reencode.js';

const enc = (s: string) => new TextEncoder().encode(s);
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
};
const SOI = new Uint8Array([0xff, 0xd8]);
const EOI = new Uint8Array([0xff, 0xd9]);
const APP0 = cat(new Uint8Array([0xff, 0xe0, 0x00, 0x10]), enc('JFIF\0'), new Uint8Array(9));
const EXIF = cat(new Uint8Array([0xff, 0xe1, 0x00, 0x10]), enc('Exif\0\0'), enc('GPS-48.85N'));
const XMP = cat(new Uint8Array([0xff, 0xe1, 0x00, 0x30]), enc('http://ns.adobe.com/xap/1.0/\0'), enc('<x:xmpmeta/>'));
const clean = cat(SOI, APP0, new Uint8Array(64), EOI);

function deps(outputs: Uint8Array[], size = { width: 4000, height: 3000 }) {
  const calls: { width: number; height: number; type: string; quality: number }[] = [];
  const close = vi.fn();
  const d: ReencodeDeps = {
    createImageBitmap: vi.fn(async () => ({ ...size, close })),
    makeCanvas: (width, height) => ({
      getContext: () => ({ drawImage: () => undefined }),
      convertToBlob: async ({ type, quality }) => {
        calls.push({ width, height, type, quality });
        const bytes = outputs[Math.min(calls.length - 1, outputs.length - 1)]!;
        return new Blob([bytes.slice()], { type });
      },
    }),
  };
  return { d, calls, close };
}

describe('hasImageMetadata: a byte scan of the output', () => {
  it('finds an Exif block or an XMP packet, and nothing in a clean JPEG', () => {
    expect(hasImageMetadata(clean)).toBe(false);
    expect(hasImageMetadata(cat(SOI, APP0, EXIF, EOI))).toBe(true);
    expect(hasImageMetadata(cat(SOI, XMP, EOI))).toBe(true);
  });
});

describe('reencodeImage', () => {
  it('draws the picture again as JPEG 0.9 and returns bytes with no Exif', async () => {
    const { d, calls, close } = deps([clean]);
    const out = await reencodeImage(new Blob([cat(SOI, APP0, EXIF, EOI)], { type: 'image/jpeg' }), d);
    expect(out.type).toBe('image/jpeg');
    const bytes = new Uint8Array(await out.arrayBuffer());
    expect(hasImageMetadata(bytes)).toBe(false);
    expect(calls).toEqual([{ width: 4000, height: 3000, type: 'image/jpeg', quality: 0.9 }]);
    expect(close).toHaveBeenCalled();
  });

  it('refuses an output that still carries metadata (never sent)', async () => {
    const { d } = deps([cat(SOI, EXIF, EOI)]);
    await expect(reencodeImage(new Blob([clean]), d)).rejects.toThrow(/metadata/);
  });

  it('keeps the quality and shrinks the picture until it fits in 5 MB', async () => {
    const big = new Uint8Array(MAX_UNBLURRED_BYTES + 1);
    const { d, calls } = deps([big, big, clean]);
    const out = await reencodeImage(new Blob([clean]), d);
    expect(out.size).toBe(clean.length);
    expect(calls.map((c) => c.quality)).toEqual([0.9, 0.9, 0.9]);
    expect(calls[1]!.width).toBeLessThan(calls[0]!.width);
    expect(calls[2]!.width).toBeLessThan(calls[1]!.width);
    expect(calls[2]!.width / calls[2]!.height).toBeCloseTo(4 / 3, 2);
  });

  it('gives up on a picture that never fits', async () => {
    const { d } = deps([new Uint8Array(MAX_UNBLURRED_BYTES + 1)]);
    await expect(reencodeImage(new Blob([clean]), d)).rejects.toThrow(RangeError);
  });

  it('refuses a file the browser cannot read as a picture', async () => {
    const d: ReencodeDeps = { ...deps([clean]).d, createImageBitmap: async () => { throw new Error('bad'); } };
    await expect(reencodeImage(new Blob([enc('not an image')]), d)).rejects.toThrow();
  });
});
