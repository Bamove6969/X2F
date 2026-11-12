// D-049 (owner 28 Oct, leaning yes; lead default, J-21): profiles show "Disputes: N won, M lost".
import { describe, expect, it } from 'vitest';
import { disputesLine } from '../src/ui/disputesLine.js';

describe('disputesLine', () => {
  it('reads "Disputes: N won, M lost", zeros included, numbers grouped', () => {
    expect(disputesLine({ won: 2, lost: 1 })).toBe('Disputes: 2 won, 1 lost');
    expect(disputesLine({ won: 0, lost: 0 })).toBe('Disputes: 0 won, 0 lost');
    expect(disputesLine({ won: 1240, lost: 3 })).toBe('Disputes: 1,240 won, 3 lost');
  });

  it('shows nothing for an answer without the counts (an older API)', () => {
    expect(disputesLine(undefined)).toBeNull();
  });
});
