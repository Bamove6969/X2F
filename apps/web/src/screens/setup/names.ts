/**
 * Name rules (spec 6.1, owner 2026-10-23): FU-A's `checkDisplayName`, `checkLoginName` and
 * `checkNames` from `@x2f/auth-client` (defined in `@x2f/accounts`, the same rules the API applies).
 * The server checks again; this is for the person's sake.
 *
 * Every account has a private **username** (owner Q54: the login name, never shown, "as
 * confidential as your password"; the API calls it `loginName`) and a public **display name**
 * (offers, profiles, chat; `displayName`). A new one of either is 8-20 characters (owner demo notes
 * #126 and #127, 23 Nov 2026; names stored before may be 5-7 and still work), and they must differ,
 * ignoring case.
 * The username is ASCII letters, digits, dots, dashes and underscores, kept exactly as typed; the
 * display name (signup round 3) takes letters of most scripts, digits and common symbols. Neither
 * a username, a display name nor a password may hold a space (owner demo note #108, 17 Nov 2026):
 * the screens say so inline as soon as one is typed (`spaceProblem`), and the API refuses them too.
 * Reserved words and their look-alikes are refused for the display name only.
 */
import { checkNames } from '@x2f/auth-client';

export { checkDisplayName, checkLoginName, checkNames, checkNewDisplayName, checkNewLoginName, hasPasswordSpace } from '@x2f/auth-client';

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
export type SpaceField = 'username' | 'display name' | 'password';

/** COPY-UNSIGNED (owner demo note #108): the inline line under a field that holds a space. */
export function spaceProblem(field: SpaceField): string {
  return `Remove the spaces. A ${field} has no spaces.`;
}

export type NamesCheck = ReturnType<typeof checkNames>;

/** The sentence for a name of the wrong shape: `which` is "Your username" or "Your display name". */
export function nameShapeProblem(which: string, reason: 'length' | 'characters' | 'spaces'): string {
  if (reason === 'spaces') return spaceProblem(which === 'Your display name' ? 'display name' : 'username');
  // COPY-UNSIGNED (owner demo notes #126 and #127: a new username or display name is 8 to 20 characters)
  if (reason === 'length') return `${which} needs 8 to 20 characters.`;
  // COPY-UNSIGNED (signup round 3: the display name's wider set; note #108: no spaces)
  if (which === 'Your display name') return `${which} can use letters, numbers and common symbols such as ${DISPLAY_SYMBOLS}, with no spaces.`;
  return `${which} can use only letters, numbers, dots, dashes and underscores.`;
}

/**
 * Some of the symbols a display name may hold, as the help and the refusal name them ("such as":
 * the full list is in @x2f/accounts; "!" is left out of the copy by the design rule on "!").
 */
export const DISPLAY_SYMBOLS = '$ & ? @ # % + ( )';

/** The sentence for a refused pair of names (shown on the display-name step only, so in its words: note #199). */
export function namesProblem(r: Extract<NamesCheck, { ok: false }>): string {
  switch (r.reason) {
    case 'length':
    case 'characters':
    case 'spaces':
      // Owner demo note #199 (25 Nov): the display-name step calls the private name "your Login ID".
      return nameShapeProblem(r.field === 'displayName' ? 'Your display name' : 'Your Login ID', r.reason);
    case 'reserved':
      return 'That display name is kept for X2F. Pick another.';
    case 'same':
      // COPY-UNSIGNED (owner demo note #199: "It must be different from your Login ID")
      return 'Your display name must be different from your Login ID.';
  }
}
