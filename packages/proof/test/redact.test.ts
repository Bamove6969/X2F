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

describe('padAndMerge: the amount stays clear and automatic blur is only ever added to (owner 2026-11-02)', () => {
  const hits = (a: Region | Box, b: Box): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  type Box = { x0: number; y0: number; x1: number; y1: number };
  /** Every pixel of `r` outside `keep` lies in some output region. */
  function stillCovered(out: Region[], r: Region, keep: Box[] = []): boolean {
    for (let y = Math.floor(r.y0); y < Math.ceil(r.y1); y++) {
      for (let x = Math.floor(r.x0); x < Math.ceil(r.x1); x++) {
        const p = { x0: x, y0: y, x1: x + 1, y1: y + 1 };
        if (keep.some((k) => hits(p, k))) continue;
        if (!out.some((o) => hits(o, p))) return false;
      }
    }
    return true;
  }

  it('padding never reaches into the amount', () => {
    const amount = { x0: 82, y0: 0, x1: 152, y1: 16 };
    const auto: Region = { x0: 0, y0: 0, x1: 80, y1: 16, kind: 'account' };
    const out = padAndMerge([auto], 400, 100, 4, [amount]);
    for (const o of out) expect(hits(o, amount)).toBe(false);
    expect(stillCovered(out, auto)).toBe(true);
  });

  it('two automatic regions are not merged into a box that covers the amount', () => {
    // A long name on one line, an email on the next starting further right, the amount under the name.
    const amount = { x0: 0, y0: 20, x1: 70, y1: 36 };
    const name: Region = { x0: 0, y0: 0, x1: 200, y1: 16, kind: 'name' };
    const email: Region = { x0: 150, y0: 20, x1: 300, y1: 36, kind: 'email' };
    // Without the amount box the union swallows it (why the box is passed).
    expect(padAndMerge([name, email], 400, 100).some((o) => hits(o, amount))).toBe(true);
    const out = padAndMerge([name, email], 400, 100, 4, [amount]);
    for (const o of out) expect(hits(o, amount)).toBe(false);
    expect(stillCovered(out, name)).toBe(true);
    expect(stillCovered(out, email)).toBe(true);
  });

  it("the uploader's own blur may cover the amount (Task 15 warns, posting is allowed)", () => {
    const amount = { x0: 82, y0: 0, x1: 152, y1: 16 };
    const manual: Region = { x0: 60, y0: 0, x1: 160, y1: 16, kind: 'manual' };
    const auto: Region = { x0: 0, y0: 0, x1: 80, y1: 16, kind: 'account' };
    const out = padAndMerge([auto, manual], 400, 100, 4, [amount]);
    expect(stillCovered(out, manual)).toBe(true);
    expect(stillCovered(out, auto)).toBe(true);
  });

  it('adding manual regions never removes automatic blur: every automatic pixel stays covered', () => {
    const amount = { x0: 100, y0: 40, x1: 170, y1: 56 };
    const auto: Region[] = [
      { x0: 0, y0: 0, x1: 120, y1: 16, kind: 'name' },
      { x0: 10, y0: 40, x1: 90, y1: 56, kind: 'account' },
      { x0: 180, y0: 40, x1: 260, y1: 56, kind: 'phone' },
    ];
    const manuals: Region[][] = [
      [],
      [{ x0: 0, y0: 0, x1: 5, y1: 5, kind: 'manual' }],
      [{ x0: 50, y0: 10, x1: 200, y1: 45, kind: 'manual' }],
      [{ x0: 0, y0: 0, x1: 300, y1: 100, kind: 'manual' }],
    ];
    for (const m of manuals) {
      const out = padAndMerge([...auto, ...m], 300, 100, 4, [amount]);
      for (const a of auto) expect(stillCovered(out, a, [amount])).toBe(true);
      for (const r of m) expect(stillCovered(out, r)).toBe(true);
    }
  });

  it('there is no way to take an automatic region back out: the package exports no remover', async () => {
    const api = Object.keys(await import('../src/index.js'));
    expect(api.filter((k) => /remove|unmask|unblur|unredact|drop|clear|subtract|exclude/i.test(k))).toEqual([]);
  });
});
