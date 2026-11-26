// Owner demo note #196 (25 Nov 2026): "Generate random" fills a random adjective_animal_NN login
// name from crypto.getRandomValues that passes checkNewLoginName and trips no reserved-word or
// look-alike rule in @x2f/accounts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkNewTradeTag, checkNewLoginName } from '../src/screens/setup/names.js';
import { ADJECTIVES, ANIMALS, randomBelow, randomLoginName, suggestTradeTags, tracesBack } from '../src/screens/setup/randomName.js';

afterEach(() => vi.restoreAllMocks());

describe('randomLoginName (owner demo note #196)', () => {
  it('1000 generations all pass checkNewLoginName, 8-20 characters, adjective_animal_NN', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const name = randomLoginName();
      expect(checkNewLoginName(name).ok, name).toBe(true);
      expect(checkNewTradeTag(name).ok, name).toBe(true);
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
          expect(checkNewLoginName(name).ok && checkNewTradeTag(name).ok, name).toBe(true);
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

describe('suggestTradeTags (owner demo note #200)', () => {
  it('gives distinct names that pass checkNewTradeTag (the reserved-word rule included) and differ from the login name', () => {
    for (let i = 0; i < 300; i++) {
      const out = suggestTradeTags(3, 'midnight_otter_42');
      expect(out).toHaveLength(3);
      expect(new Set(out).size).toBe(3);
      for (const n of out) {
        expect(checkNewTradeTag(n).ok, n).toBe(true);
        expect(n.toLowerCase()).not.toBe('midnight_otter_42');
      }
    }
  });

  it('never shares the login name\'s adjective or animal, ignoring case, so it cannot be traced back (review of 6e984272)', () => {
    for (const login of ['amber_otter_42', 'Amber_Otter_42', 'midnight_heron_10']) {
      const [adj, animal] = login.toLowerCase().split('_');
      for (let i = 0; i < 200; i++) {
        for (const n of suggestTradeTags(3, login)) {
          const [a, b] = n.split('_');
          expect(a, `${login} -> ${n}`).not.toBe(adj);
          expect(b, `${login} -> ${n}`).not.toBe(animal);
        }
      }
    }
  });

  it('tracesBack: the same name, a shared word, or the login name\'s longest word inside', () => {
    expect(tracesBack('amber_otter_43', 'amber_otter_42')).toBe(true);
    expect(tracesBack('amber_heron_17', 'Amber_Otter_42')).toBe(true);
    expect(tracesBack('quiet_otter_17', 'amber_otter_42')).toBe(true);
    expect(tracesBack('amber_otter_42', 'AMBER_OTTER_42')).toBe(true);
    // A typed login name: its longest letter run anywhere in the suggestion.
    expect(tracesBack('kind_llama_12', 'llam.2024')).toBe(true);
    expect(tracesBack('swift_marmot_88', 'juniper.oak')).toBe(false);
    // Runs under 3 letters only count as whole words.
    expect(tracesBack('noble_koala_23', 'jo.ko')).toBe(false);
    expect(tracesBack('calm_otter_17', 'quiet_heron_42')).toBe(false);
  });

  it('never repeats the login name, ignoring case, even when the draw keeps landing on it', () => {
    // Draws 26 (midnight), 23 (otter), 32 (42) once, then index 0 everywhere: amber_badger_10.
    let i = 0;
    const seq = [26, 23, 32, 0, 0, 0, 0, 0, 0, 1, 1, 1];
    const fake = (a: Uint32Array<ArrayBuffer>) => {
      a[0] = seq[i++ % seq.length]!;
      return a;
    };
    expect(suggestTradeTags(1, 'Midnight_Otter_42', fake)).toEqual(['amber_badger_10']);
  });
});
