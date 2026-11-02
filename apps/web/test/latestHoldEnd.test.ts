// The Security screen's hold banner shows the later of the held backup session's end and the
// account's 24-hour hold end (Plan 2 Tasks 9 and 17).
import { describe, expect, it } from 'vitest';
import { latestHoldEnd } from '../src/screens/settings/Security.js';

const A = '2026-11-01T10:00:00.000Z';
const B = '2026-11-02T10:00:00.000Z';

describe('latestHoldEnd', () => {
  it('no hold: null, not a throw', () => {
    expect(latestHoldEnd([])).toBeNull();
  });

  it('one hold: that end', () => {
    expect(latestHoldEnd([A])).toBe(A);
  });

  it('two holds: the later end, whichever comes first', () => {
    expect(latestHoldEnd([A, B])).toBe(B);
    expect(latestHoldEnd([B, A])).toBe(B);
  });

  it('a tie keeps the first', () => {
    const same = '2026-11-02T10:00:00Z'; // the same instant as B, spelled differently
    expect(latestHoldEnd([B, same])).toBe(B);
    expect(latestHoldEnd([same, B])).toBe(same);
  });
});
