/**
 * Name rules (spec 6.1, owner 2026-10-23): FU-A's `checkTradeTag`, `checkLoginName` and
 * `checkNames` from `@x2f/auth-client` (defined in `@x2f/accounts`, the same rules the API applies).
 * The server checks again; this is for the person's sake.
 *
 * Every account has a private **username** (owner Q54: the login name, never shown, "as
 * confidential"; the API calls it `loginName`) and a public **Trade Tag**
 * (offers, profiles, chat; `tradeTag`). A new one of either is 8-20 characters (owner demo notes
 * #126 and #127, 23 Nov 2026; names stored before may be 5-7 and still work), and they must differ,
 * ignoring case.
 * The username is ASCII letters, digits, dots, dashes and underscores, kept exactly as typed; the
 * Trade Tag (signup round 3) takes letters of most scripts, digits and common symbols. Neither
 * a username nor a Trade Tag may hold a space (owner demo note #108, 17 Nov 2026):
 * the screens say so inline as soon as one is typed (`spaceProblem`), and the API refuses them too.
 * Reserved words and their look-alikes are refused for the Trade Tag only.
 */
import { checkNames } from '@x2f/auth-client';

export { checkTradeTag, checkLoginName, checkNames, checkNewTradeTag, checkNewLoginName } from '@x2f/auth-client';

/** Whether a typed value holds a space or other white space (note #108). */
export const hasSpace = (s: string): boolean => /\s/u.test(s);

/** A rule row's state: met, broken by what was typed, or not met yet (muted, nothing wrong typed). */
export type UsernameRuleState = 'true' | 'false' | 'unknown';

export interface UsernameRules {
  length: UsernameRuleState;
  characters: UsernameRuleState;
  noSpaces: UsernameRuleState;
}

/**
 * The live checklist for what has been typed (note #196). Too short is "not yet", never red (the
 * person is still typing); more than 20, a character outside the set, or a space is red. The
 * characters row leaves spaces to the "No spaces" row, so a space turns only that one red.
 */
export function usernameRules(name: string): UsernameRules {
  if (name === '') return { length: 'unknown', characters: 'unknown', noSpaces: 'unknown' };
  const len = [...name].length;
  const length = len > 20 ? 'false' : len >= 8 ? 'true' : 'unknown';
  const rest = name.replace(/\s/gu, '');
  const characters = rest === '' ? 'unknown' : /^[A-Za-z0-9._-]+$/.test(rest) ? 'true' : 'false';
  return { length, characters, noSpaces: hasSpace(name) ? 'false' : 'true' };
}

/** What a value holds no spaces in: the inline sentence names it. */
export type SpaceField = 'username' | 'Trade Tag';

/**
 * COPY-UNSIGNED (owner demo note #108): the inline line under a field that holds a space. `label`
 * names the field otherwise where a screen calls it something else (the sign-up's "Login ID",
 * owner demo notes #197 and #199); every other caller keeps `field`'s word.
 */
export function spaceProblem(field: SpaceField, label?: string): string {
  return `Remove the spaces. A ${label ?? field} has no spaces.`;
}

export type NamesCheck = ReturnType<typeof checkNames>;

/** The sentence for a name of the wrong shape: `which` is "Your username" or "Your Trade Tag". */
export function nameShapeProblem(which: string, reason: 'length' | 'characters' | 'spaces'): string {
  if (reason === 'spaces') return spaceProblem(which === 'Your Trade Tag' ? 'Trade Tag' : 'username');
  // COPY-UNSIGNED (owner demo notes #126 and #127: a new username or Trade Tag is 8 to 20 characters)
  if (reason === 'length') return `${which} needs 8 to 20 characters.`;
  // COPY-UNSIGNED (signup round 3: the Trade Tag's wider set; note #108: no spaces)
  if (which === 'Your Trade Tag') return `${which} can use letters, numbers and common symbols such as ${DISPLAY_SYMBOLS}, with no spaces.`;
  return `${which} can use only letters, numbers, dots, dashes and underscores.`;
}

/**
 * Some of the symbols a Trade Tag may hold, as the help and the refusal name them ("such as":
 * the full list is in @x2f/accounts; "!" is left out of the copy by the design rule on "!").
 */
export const DISPLAY_SYMBOLS = '$ & ? @ # % + ( )';

/** The sentence for a refused pair of names (shown on the trade-tag step only, so in its words: note #199). */
export function namesProblem(r: Extract<NamesCheck, { ok: false }>): string {
  switch (r.reason) {
    case 'length':
    case 'characters':
    case 'spaces':
      // Owner demo note #199 (25 Nov): the trade-tag step calls the private name "your Login ID".
      return nameShapeProblem(r.field === 'tradeTag' ? 'Your Trade Tag' : 'Your Login ID', r.reason);
    case 'reserved':
      return 'That Trade Tag is kept for X2F. Pick another.';
    case 'same':
      // COPY-UNSIGNED (owner demo note #199: "It must be different from your Login ID")
      return 'Your Trade Tag must be different from your Login ID.';
  }
}
