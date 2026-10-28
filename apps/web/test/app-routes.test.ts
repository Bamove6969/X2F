// App.tsx's route table is merged by hand from many task branches. A path listed twice keeps only
// the first element, so a later, wired-up route (2026-10-27: the offer lists with their Trade
// button) silently loses to a stale one. Every path must appear exactly once.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const APP = fileURLToPath(new URL('../src/App.tsx', import.meta.url));

describe('the route table', () => {
  it('lists every path once', () => {
    const paths = [...readFileSync(APP, 'utf8').matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);
    expect(paths.length).toBeGreaterThan(10);
    expect(paths.filter((p, i) => paths.indexOf(p) !== i)).toEqual([]);
  });
});
