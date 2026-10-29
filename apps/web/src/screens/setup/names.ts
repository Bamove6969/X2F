/**
 * Name rules (spec 6.1, owner 2026-10-23): FU-A's `checkDisplayName`, `checkLoginName` and
 * `checkNames` from `@x2f/auth-client` (defined in `@x2f/accounts`, the same rules the API applies).
 * The server checks again; this is for the person's sake.
 *
 * Every account has a public **display name** (offers, profiles, chat; the board's "Username") and a
 * private **login name** (never shown; used to log in with a password or a security key). Both are
 * 5-20 ASCII letters, digits, dots, dashes and underscores, kept exactly as typed, and they must
 * differ, ignoring case. Reserved words and their look-alikes are refused for the display name only.
 */
import { checkNames } from '@x2f/auth-client';

export { checkDisplayName, checkLoginName, checkNames } from '@x2f/auth-client';

export type NamesCheck = ReturnType<typeof checkNames>;

/** The sentence for a refused pair of names. The board calls the display name "username". */
export function namesProblem(r: Extract<NamesCheck, { ok: false }>): string {
  const which = r.field === 'displayName' ? 'Your username' : 'Your login name';
  switch (r.reason) {
    case 'length':
      return `${which} needs 5 to 20 characters.`;
    case 'characters':
      return `${which} can use only letters, numbers, dots, dashes and underscores.`;
    case 'reserved':
      return 'That username is kept for X2F. Pick another.';
    case 'same':
      return 'Your login name must be different from your username.';
  }
}
