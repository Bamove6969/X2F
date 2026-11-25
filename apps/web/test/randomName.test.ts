// Owner demo note #196 (25 Nov 2026): "Generate random" fills a random adjective_animal_NN login
// name from crypto.getRandomValues that passes checkNewLoginName and trips no reserved-word or
// look-alike rule in @x2f/accounts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkNewDisplayName, checkNewLoginName } from '../src/screens/setup/names.js';
import { ADJECTIVES, ANIMALS, randomBelow, randomLoginName, suggestDisplayNames } from '../src/screens/setup/randomName.js';

afterEach(() => vi.restoreAllMocks());

describe('randomLoginName (owner demo note #196)', () => {
  it('1000 generations all pass checkNewLoginName, 8-20 characters, adjective_animal_NN', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const name = randomLoginName();
      expect(checkNewLoginName(name).ok, name).toBe(true);
      expect(checkNewDisplayName(name).ok, name).toBe(true);
      expect(name.length).toBeGreaterThanOrEqual(8);
      expect(name.length).toBeLessThanOrEqual(20);
      expect(name).toMatch(/^[a-z]+_[a-z]+_[1-9][0-9]$/);
      seen.add(name);
    }
    expect(seen.size).toBeGreaterThan(900);
  });

  it('every pair of words, with the shortest and longest number, passes and reads as nothing reserved', () => {
    expect(ADJECTIVES.length).toBeGreaterThanOrEqual(40);
    expect(ANIMALS.length).toBeGreaterThanOrEqual(40);
    expect(new Set(ADJECTIVES).size).toBe(ADJECTIVES.length);
    expect(new Set(ANIMALS).size).toBe(ANIMALS.length);
    for (const a of ADJECTIVES)
      for (const b of ANIMALS)
        for (const n of [10, 99]) {
          const name = `${a}_${b}_${n}`;
          expect(checkNewLoginName(name).ok && checkNewDisplayName(name).ok, name).toBe(true);
        }
  });

  it('draws from crypto.getRandomValues, never Math.random', () => {
    const math = vi.spyOn(Math, 'random');
    const crypt = vi.spyOn(crypto, 'getRandomValues');
    randomLoginName();
    expect(math).not.toHaveBeenCalled();
    expect(crypt).toHaveBeenCalled();
  });

  it('randomBelow rejects the biased top of the range', () => {
    const values = [0xffff_ffff, 7];
    const fake = (a: Uint32Array<ArrayBuffer>) => {
      a[0] = values.shift()!;
      return a;
    };
    expect(randomBelow(10, fake)).toBe(7);
  });
});

describe('suggestDisplayNames (owner demo note #200)', () => {
  it('gives distinct names that pass checkNewDisplayName (the reserved-word rule included) and differ from the login name', () => {
    for (let i = 0; i < 300; i++) {
      const out = suggestDisplayNames(3, 'midnight_otter_42');
      expect(out).toHaveLength(3);
      expect(new Set(out).size).toBe(3);
      for (const n of out) {
        expect(checkNewDisplayName(n).ok, n).toBe(true);
        expect(n.toLowerCase()).not.toBe('midnight_otter_42');
      }
    }
  });

  it('never repeats the login name, ignoring case, even when the draw keeps landing on it', () => {
    // Draws 26 (midnight), 23 (otter), 32 (42) once, then index 0 everywhere: amber_badger_10.
    let i = 0;
    const seq = [26, 23, 32, 0, 0, 0, 0, 0, 0, 1, 1, 1];
    const fake = (a: Uint32Array<ArrayBuffer>) => {
      a[0] = seq[i++ % seq.length]!;
      return a;
    };
    expect(suggestDisplayNames(1, 'Midnight_Otter_42', fake)).toEqual(['amber_badger_10']);
  });
});
