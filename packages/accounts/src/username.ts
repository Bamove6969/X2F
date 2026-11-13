/**
 * Name rules (spec 6.1, owner 2026-10-23). Every account has two names:
 * - the **display name**, public (offers, profiles, chat), and
 * - the **login name**, private: never shown to anyone, used only to log in with a password, a
 *   security key by name or a backup code.
 * Both are 5–20 ASCII letters, digits, `.`, `-`, `_`; kept as typed; unique case-insensitively
 * through `key`; and the two must differ case-insensitively.
 *
 * Look-alikes (F4, owner 2026-10-23): 0/o, 1/l/i and rn/m count as the same letters only when a
 * display name is compared against reserved words (here) and staff or owner names (the API, with
 * `lookAlikeKey`). Two traders' names that only look alike are both allowed.
 */

/**
 * Account kinds. Separate from `@x2f/core`'s trade `Role`. A `member` account is only a team
 * member's own login (Plan 2 Task 18): it acts for its team's trader account and owns nothing.
 */
export type AccountKind = 'trader' | 'staff' | 'owner' | 'member';

export type NameRefusal = 'length' | 'characters' | 'reserved';

export type NameCheck = { ok: true; name: string; key: string } | { ok: false; reason: NameRefusal };

export type NamesCheck =
  | { ok: true; display: { name: string; key: string }; login: { name: string; key: string } }
  | { ok: false; field: 'displayName' | 'loginName'; reason: NameRefusal | 'same' };

const NAME_RE = /^[A-Za-z0-9._-]{5,20}$/;
/** UTF-16 code units; anything longer is refused before any other work. */
const MAX_RAW_LENGTH = 64;

/**
 * Lower case, then 0→o, 1→l, i→l and rn→m. The letter substitutions neither make nor use `r`, `n`
 * or `m`, so the order of the two steps does not matter.
 */
export function lookAlikeKey(name: string): string {
  return name.toLowerCase().replace(/[01i]/g, (c) => (c === '0' ? 'o' : 'l')).replace(/rn/g, 'm');
}

const RESERVED_TOKENS = new Set(
  ['admin', 'administrator', 'moderator', 'mod', 'support', 'staff', 'owner', 'system', 'root', 'help', 'x2f', 'official'].map(lookAlikeKey),
);
/**
 * Whole names kept for the app's own example screens (lead, 12 Nov 2026: the first-trade tour's
 * pretend traders), so no real account can be shown as the model counterparty. Compared with
 * look-alikes folded and the separators `.`, `-`, `_` dropped.
 */
const RESERVED_NAMES = new Set(['example_seller', 'example_buyer'].map((n) => lookAlikeKey(n).replace(/[._-]/g, '')));
const F = { admin: lookAlikeKey('admin'), x2f: lookAlikeKey('x2f'), staff: lookAlikeKey('staff'), moderator: lookAlikeKey('moderator'), support: lookAlikeKey('support') };

/** Reserved words and their look-alikes, as whole tokens or by the prefix and suffix rules. */
function isReserved(key: string): boolean {
  const folded = lookAlikeKey(key);
  if (folded.split(/[._-]/).some((t) => RESERVED_TOKENS.has(t))) return true;
  const flat = folded.replace(/[._-]/g, '');
  if (RESERVED_NAMES.has(flat)) return true;
  return (
    flat.startsWith(F.admin) ||
    flat.startsWith(F.x2f) ||
    flat.startsWith(F.staff) ||
    flat.includes(F.moderator) ||
    flat.endsWith(F.support)
  );
}

function checkShape(input: string): NameCheck {
  if (typeof input !== 'string') return { ok: false, reason: 'characters' };
  // Refuse huge input before spreading it into code points.
  if (input.length > MAX_RAW_LENGTH) return { ok: false, reason: 'length' };
  // Length in code points, so an astral character counts once.
  const len = [...input].length;
  if (len < 5 || len > 20) return { ok: false, reason: 'length' };
  if (!NAME_RE.test(input)) return { ok: false, reason: 'characters' };
  return { ok: true, name: input, key: input.toLowerCase() };
}

/** A public display name: the shape rules, then reserved words and their look-alikes. */
export function checkDisplayName(input: string): NameCheck {
  const r = checkShape(input);
  if (r.ok && isReserved(r.key)) return { ok: false, reason: 'reserved' };
  return r;
}

/** A private login name: the shape rules only (it is never shown, so nobody can be misled by it). */
export function checkLoginName(input: string): NameCheck {
  return checkShape(input);
}

/** Both names of a new account: the display name first, then the login name, then that they differ. */
export function checkNames(displayName: string, loginName: string): NamesCheck {
  const display = checkDisplayName(displayName);
  if (!display.ok) return { ok: false, field: 'displayName', reason: display.reason };
  const login = checkLoginName(loginName);
  if (!login.ok) return { ok: false, field: 'loginName', reason: login.reason };
  if (display.key === login.key) return { ok: false, field: 'loginName', reason: 'same' };
  return { ok: true, display: { name: display.name, key: display.key }, login: { name: login.name, key: login.key } };
}
