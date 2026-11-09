/**
 * Name rules (spec 6.1, owner 2026-10-23): FU-A's `checkDisplayName`, `checkLoginName` and
 * `checkNames` from `@x2f/auth-client` (defined in `@x2f/accounts`, the same rules the API applies).
 * The server checks again; this is for the person's sake.
 *
 * Every account has a private **username** (owner Q54: the login name, never shown, "as
 * confidential as your password"; the API calls it `loginName`) and a public **display name**
 * (offers, profiles, chat; `displayName`). Both are 5-20 ASCII letters, digits, dots, dashes and
 * underscores, kept exactly as typed, and they must differ, ignoring case. Reserved words and their
 * look-alikes are refused for the display name only.
 */
import { checkNames } from '@x2f/auth-client';

export { checkDisplayName, checkLoginName, checkNames } from '@x2f/auth-client';

export type NamesCheck = ReturnType<typeof checkNames>;

/** The sentence for a name of the wrong shape: `which` is "Your username" or "Your display name". */
export function nameShapeProblem(which: string, reason: 'length' | 'characters'): string {
  return reason === 'length' ? `${which} needs 5 to 20 characters.` : `${which} can use only letters, numbers, dots, dashes and underscores.`;
}

/** The sentence for a refused pair of names. */
export function namesProblem(r: Extract<NamesCheck, { ok: false }>): string {
  switch (r.reason) {
    case 'length':
    case 'characters':
      return nameShapeProblem(r.field === 'displayName' ? 'Your display name' : 'Your username', r.reason);
    case 'reserved':
      return 'That display name is kept for X2F. Pick another.';
    case 'same':
      return 'Your display name must be different from your username.';
  }
}
