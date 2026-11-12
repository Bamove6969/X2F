// The intro lab's block layouts (owner's proof of concept, /lab/intro, demo builds only).
import { describe, expect, it } from 'vitest';
import { BLOCKS, PITCH, SCENES, ease, mix, scattered, type Block } from '../src/lab/intro/layouts.js';

const cell = (b: Block) => `${Math.round(b.x * 100)},${Math.round(b.y * 100)},${Math.round(b.z * 100)}`;

describe('the intro scenes', () => {
  it('three scenes of the same 27 blocks, none sharing a place, all full size', () => {
    expect(SCENES).toHaveLength(3);
    for (const s of SCENES) {
      expect(s).toHaveLength(BLOCKS);
      expect(new Set(s.map(cell)).size).toBe(BLOCKS);
      for (const b of s) expect(b.scale).toBe(1);
    }
  });

  it('scene 1 is a 3×3×3 cube with one Monero-orange corner', () => {
    const s = SCENES[0]!;
    for (const axis of ['x', 'y', 'z'] as const) expect(new Set(s.map((b) => Math.round(b[axis] / PITCH))).size).toBe(3);
    expect(s.filter((b) => b.role === 'monero')).toHaveLength(1);
  });

  it('scene 2 is three slabs of nine, apart from each other, the top one escrow teal', () => {
    const ys = [...new Set(SCENES[1]!.map((b) => b.y))].sort((a, b) => a - b);
    expect(ys).toHaveLength(3);
    for (const y of ys) expect(SCENES[1]!.filter((b) => b.y === y)).toHaveLength(9);
    expect(ys[1]! - ys[0]!).toBeGreaterThan(PITCH * 1.2);
    expect(SCENES[1]!.filter((b) => b.y === ys[2]).every((b) => b.role === 'escrow')).toBe(true);
  });

  it('scene 3 is a padlock: a shackle of escrow blocks above a wider body with one keyhole', () => {
    const s = SCENES[2]!;
    const shackle = s.filter((b) => b.role === 'escrow');
    const body = s.filter((b) => b.role !== 'escrow');
    expect(shackle).toHaveLength(7);
    expect(Math.min(...shackle.map((b) => b.y))).toBeGreaterThan(Math.max(...body.map((b) => b.y)));
    const width = (bs: Block[]) => Math.max(...bs.map((b) => b.x)) - Math.min(...bs.map((b) => b.x));
    expect(width(body)).toBeGreaterThan(width(shackle));
    expect(s.filter((b) => b.role === 'monero')).toHaveLength(1);
  });

  it('the start is the cube thrown apart and shrunk, so scene 1 assembles', () => {
    const start = scattered();
    expect(start).toHaveLength(BLOCKS);
    expect(start.every((b) => b.scale < 1)).toBe(true);
    const spread = (bs: Block[]) => Math.max(...bs.map((b) => Math.hypot(b.x, b.y, b.z)));
    expect(spread(start)).toBeGreaterThan(spread(SCENES[0]!) * 1.5);
    expect(scattered()).toEqual(start);
  });
});

describe('the morph', () => {
  it('starts at one scene and lands exactly on the next', () => {
    expect(mix(SCENES[0]!, SCENES[1]!, 0)).toEqual(SCENES[0]);
    expect(mix(SCENES[0]!, SCENES[1]!, 1)).toEqual(SCENES[1]);
    const half = mix(SCENES[1]!, SCENES[2]!, 0.5);
    expect(half[0]!.x).toBeCloseTo((SCENES[1]![0]!.x + SCENES[2]![0]!.x) / 2);
  });

  it('eases in and out, clamped to 0..1', () => {
    expect([ease(-1), ease(0), ease(0.5), ease(1), ease(2)]).toEqual([0, 0, 0.5, 1, 1]);
    expect(ease(0.1)).toBeLessThan(0.1);
    expect(ease(0.9)).toBeGreaterThan(0.9);
  });
});
