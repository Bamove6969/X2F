/**
 * "Generate random" on the private username step (owner demo note #196, 25 Nov 2026, the advice he
 * pasted): a random login name in an adjective_animal_NN style ("midnight_otter_42"), from two short
 * built-in lists of neutral words. The randomness is crypto.getRandomValues, never Math.random.
 *
 * Every pick is 8-20 characters (the longest adjective is 8 letters and the longest animal 7, so at
 * most 19) and is checked against `checkNewLoginName`; it is also kept clear of the Trade Tag's
 * reserved words and their look-alikes (`checkNewTradeTag`), though a login name has none, so a
 * pick can never read as staff. A pick that fails either is drawn again. The usual availability
 * check then runs on it like on a typed name.
 */
import { checkNewTradeTag, checkNewLoginName } from './names.js';

export const ADJECTIVES = [
  'amber', 'autumn', 'bold', 'brave', 'bright', 'calm', 'clever', 'cobalt', 'coral', 'crisp',
  'dusty', 'eager', 'early', 'frosty', 'gentle', 'golden', 'grand', 'happy', 'hazel', 'humble',
  'jolly', 'keen', 'kind', 'lively', 'lucky', 'mellow', 'midnight', 'misty', 'noble', 'olive',
  'quiet', 'rapid', 'rustic', 'silver', 'snowy', 'sunny', 'swift', 'velvet', 'witty', 'zesty',
] as const;

export const ANIMALS = [
  'badger', 'beaver', 'bison', 'crane', 'dingo', 'falcon', 'ferret', 'finch', 'gecko', 'hare',
  'heron', 'ibis', 'koala', 'lemur', 'llama', 'lynx', 'magpie', 'marmot', 'moose', 'newt',
  'ocelot', 'okapi', 'oriole', 'otter', 'owl', 'panda', 'pelican', 'puffin', 'quail', 'raven',
  'robin', 'salmon', 'seal', 'sparrow', 'stork', 'tapir', 'toucan', 'turtle', 'walrus', 'wombat',
] as const;

export type RandomFill = (a: Uint32Array<ArrayBuffer>) => Uint32Array<ArrayBuffer>;

/** A uniform whole number in [0, n), from crypto.getRandomValues (rejection sampling, no modulo bias). */
export function randomBelow(n: number, random: RandomFill = (a) => crypto.getRandomValues(a)): number {
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    const v = random(buf)[0]!;
    if (v < limit) return v % n;
  }
}

/** Whether a generated name may be offered: a valid new login name that reads as nothing reserved. */
export function acceptableRandomName(name: string): boolean {
  return checkNewLoginName(name).ok && checkNewTradeTag(name).ok;
}

/** One random login name, "adjective_animal_NN" with NN from 10 to 99, drawn again until acceptable. */
export function randomLoginName(random?: RandomFill): string {
  for (;;) {
    const adjective = ADJECTIVES[randomBelow(ADJECTIVES.length, random)]!;
    const animal = ANIMALS[randomBelow(ANIMALS.length, random)]!;
    const name = `${adjective}_${animal}_${10 + randomBelow(90, random)}`;
    if (acceptableRandomName(name)) return name;
  }
}

/**
 * Display-name suggestions (owner demo note #200, 25 Nov 2026): `count` different picks from the
 * same lists that pass the trade-tag rules (`checkNewTradeTag`, which holds the reserved-word
 * and look-alike rule `isReservedNewName` of @x2f/accounts) and differ, ignoring case, from the
 * private login name (`avoid`), as checkNames requires. The API still checks the staff names and
 * whether a name is taken when the account is made.
 *
 * The Trade Tag "cannot be traced back to your login username" (owner demo note #195), so a
 * suggestion that shares a word with the login name is skipped (`tracesBack`): amber_otter_42 must
 * never be offered amber_otter_43, nor amber_heron_17.
 */
export function suggestTradeTags(count: number, avoid: string, random?: RandomFill): string[] {
  const out: string[] = [];
  while (out.length < count) {
    const name = randomLoginName(random);
    if (!tracesBack(name, avoid) && !out.includes(name) && checkNewTradeTag(name).ok) out.push(name);
  }
  return out;
}

/** The letter runs of a name, lower case ("Juniper.Oak_7" → ["juniper", "oak"]). */
function wordsOf(name: string): string[] {
  return name.toLowerCase().split(/[^a-z]+/).filter((w) => w !== '');
}

/**
 * Whether a suggested Trade Tag would point back at the login name: the same name ignoring
 * case, a word in common (the adjective or the animal of a generated login name, or any letter run
 * of a typed one), or the login name's longest letter run anywhere inside it (from 3 letters, so
 * "otter" in "otters" counts, but a lone "a" or "jo" does not empty the lists).
 */
export function tracesBack(suggestion: string, loginName: string): boolean {
  const s = suggestion.toLowerCase();
  if (s === loginName.toLowerCase()) return true;
  const login = wordsOf(loginName);
  if (wordsOf(suggestion).some((w) => login.includes(w))) return true;
  const longest = login.reduce((a, w) => (w.length > a.length ? w : a), '');
  return longest.length >= 3 && s.includes(longest);
}
