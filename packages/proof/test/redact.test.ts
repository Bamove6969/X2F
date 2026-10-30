import { describe, expect, it } from 'vitest';
import { padAndMerge, redact, type Region } from '../src/index.js';

const W = 40;
const H = 30;

/** A deterministic busy image: every pixel differs from its neighbours. */
function image(seed: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    px[i * 4] = (i * 37 + seed * 11) & 0xff;
    px[i * 4 + 1] = (i * 91 + seed * 7) & 0xff;
    px[i * 4 + 2] = (i * 53 + seed * 3) & 0xff;
    px[i * 4 + 3] = 255;
  }
  return px;
}

function at(px: Uint8ClampedArray, x: number, y: number): number[] {
  const i = (y * W + x) * 4;
  return [px[i]!, px[i + 1]!, px[i + 2]!, px[i + 3]!];
}

function inside(r: Region, x: number, y: number): boolean {
  return x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;
}

const R: Region = { x0: 5, y0: 4, x1: 25, y1: 14, kind: 'account' };

describe('redact (P5-A26)', () => {
  it('two images that differ only inside a region and share its mean produce byte-identical output', () => {
    const a = image(1);
    const b = image(1);
    // Swap pairs of pixels inside the region in b: different glyphs, same mean.
    for (let y = R.y0; y < R.y1; y++) {
      for (let x = R.x0; x + 1 < R.x1; x += 2) {
        const i = (y * W + x) * 4;
        for (let c = 0; c < 4; c++) {
          const t = b[i + c]!;
          b[i + c] = b[i + 4 + c]!;
          b[i + 4 + c] = t;
        }
      }
    }
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    redact(a, W, H, [R]);
    redact(b, W, H, [R]);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('pixels outside every region are unchanged', () => {
    const before = image(2);
    const after = image(2);
    const r2: Region = { x0: 30, y0: 20, x1: 38, y1: 28, kind: 'name' };
    redact(after, W, H, [R, r2]);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (inside(R, x, y) || inside(r2, x, y)) continue;
        expect(at(after, x, y)).toEqual(at(before, x, y));
      }
    }
  });

  it('a redacted region keeps no trace of the original pixels', () => {
    const px = image(3);
    redact(px, W, H, [R]);
    // Every output pixel is the mean plus a texture that depends only on (x, y): a flat image with the
    // same mean, redacted, gives exactly the same region.
    const mean = [0, 0, 0, 0];
    const src = image(3);
    for (let y = R.y0; y < R.y1; y++) for (let x = R.x0; x < R.x1; x++) at(src, x, y).forEach((v, c) => (mean[c]! += v));
    const n = (R.x1 - R.x0) * (R.y1 - R.y0);
    const flat = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) for (let c = 0; c < 4; c++) flat[i * 4 + c] = Math.round(mean[c]! / n);
    redact(flat, W, H, [R]);
    for (let y = R.y0; y < R.y1; y++) for (let x = R.x0; x < R.x1; x++) expect(at(px, x, y)).toEqual(at(flat, x, y));
  });

  it('the patch is textured (frosted), not a flat fill', () => {
    const px = new Uint8ClampedArray(W * H * 4).fill(128);
    redact(px, W, H, [R]);
    const values = new Set<number>();
    for (let y = R.y0; y < R.y1; y++) for (let x = R.x0; x < R.x1; x++) values.add(at(px, x, y)[0]!);
    expect(values.size).toBeGreaterThan(1);
  });

  it('rounds fractional regions outward and clamps them to the image', () => {
    const px = image(4);
    const before = image(4);
    redact(px, W, H, [{ x0: -3.5, y0: 28.2, x1: 2.1, y1: 99, kind: 'manual' }]);
    expect(at(px, 2, 29)).not.toEqual(at(before, 2, 29)); // x1 2.1 rounds up to 3
    expect(at(px, 3, 29)).toEqual(at(before, 3, 29));
    expect(at(px, 0, 27)).toEqual(at(before, 0, 27)); // y0 28.2 rounds down to 28
  });

  it('refuses a buffer that does not match the size, and non-finite regions', () => {
    expect(() => redact(new Uint8ClampedArray(10), W, H, [])).toThrow(RangeError);
    expect(() => redact(image(1), W, H, [{ ...R, x1: Number.NaN }])).toThrow(RangeError);
  });
});

describe('padAndMerge', () => {
  it('pads by 4 px by default and clamps to the image', () => {
    expect(padAndMerge([{ x0: 2, y0: 10, x1: 12, y1: 18, kind: 'email' }], 100, 20)).toEqual([
      { x0: 0, y0: 6, x1: 16, y1: 20, kind: 'email' },
    ]);
  });

  it('merges overlapping regions after padding, transitively', () => {
    const out = padAndMerge(
      [
        { x0: 0, y0: 0, x1: 10, y1: 10, kind: 'account' },
        { x0: 15, y0: 0, x1: 25, y1: 10, kind: 'account' },
        { x0: 30, y0: 0, x1: 40, y1: 10, kind: 'account' },
        { x0: 80, y0: 80, x1: 90, y1: 90, kind: 'phone' },
      ],
      100,
      100,
      3,
    );
    expect(out).toEqual([
      { x0: 0, y0: 0, x1: 43, y1: 13, kind: 'account' },
      { x0: 77, y0: 77, x1: 93, y1: 93, kind: 'phone' },
    ]);
  });

  it('a merged region of two kinds keeps the higher-priority kind (name before others)', () => {
    const out = padAndMerge(
      [
        { x0: 0, y0: 0, x1: 10, y1: 10, kind: 'account' },
        { x0: 5, y0: 5, x1: 15, y1: 15, kind: 'name' },
      ],
      100,
      100,
      0,
    );
    expect(out).toEqual([{ x0: 0, y0: 0, x1: 15, y1: 15, kind: 'name' }]);
  });

  it('drops empty regions and refuses bad input', () => {
    expect(padAndMerge([{ x0: 200, y0: 0, x1: 300, y1: 5, kind: 'manual' }], 100, 100, 0)).toEqual([]);
    expect(() => padAndMerge([{ x0: 0, y0: 0, x1: Infinity, y1: 1, kind: 'manual' }], 100, 100)).toThrow(RangeError);
    expect(() => padAndMerge([], 100, 100, -1)).toThrow(RangeError);
  });
});
