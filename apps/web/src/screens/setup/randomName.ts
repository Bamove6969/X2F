/**
 * "Generate random" on the private username step (owner demo note #196, 25 Nov 2026, the advice he
 * pasted): a random login name in an adjective_animal_NN style ("midnight_otter_42"), from two short
 * built-in lists of neutral words. The randomness is crypto.getRandomValues, never Math.random.
 *
 * Every pick is 8-20 characters (the longest adjective is 8 letters and the longest animal 7, so at
 * most 19) and is checked against `checkNewLoginName`; it is also kept clear of the display name's
 * reserved words and their look-alikes (`checkNewDisplayName`), though a login name has none, so a
 * pick can never read as staff. A pick that fails either is drawn again. The usual availability
 * check then runs on it like on a typed name.
 */
import { checkNewDisplayName, checkNewLoginName } from './names.js';

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
  return checkNewLoginName(name).ok && checkNewDisplayName(name).ok;
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
 * same lists that pass the display-name rules (`checkNewDisplayName`, which holds the reserved-word
 * and look-alike rule `isReservedNewName` of @x2f/accounts) and differ, ignoring case, from the
 * private login name (`avoid`), as checkNames requires. The API still checks the staff names and
 * whether a name is taken when the account is made.
 */
export function suggestDisplayNames(count: number, avoid: string, random?: RandomFill): string[] {
  const out: string[] = [];
  const avoidKey = avoid.toLowerCase();
  while (out.length < count) {
    const name = randomLoginName(random);
    if (name.toLowerCase() !== avoidKey && !out.includes(name) && checkNewDisplayName(name).ok) out.push(name);
  }
  return out;
}
