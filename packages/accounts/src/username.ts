/**
 * Name rules (spec 6.1, owner 2026-10-23). Every account has two names:
 * - the **display name**, public (offers, profiles, chat), and
 * - the **login name**, private: never shown to anyone, used only to log in with a password, a
 *   security key by name or a backup code.
 * Both are 5–20 characters, unique case-insensitively through `key`, and the two must differ
 * case-insensitively.
 * - The login name: ASCII letters, digits, `.`, `-`, `_`, kept as typed.
 * - The display name (signup round 3, lead call, 13 Nov 2026; owner: "allow the majority of major
 *   characters, just not weird ones"): printable letters of any script, digits, spaces and
 *   `$ & ! ? . , ' - _ @ # % * + ( ) :`. It is normalised to NFC, trimmed, and its runs of spaces
 *   collapsed. Refused: control, format (zero-width, bidi controls), private-use and unassigned
 *   characters, other spaces, letters of a right-to-left script (they change the text's
 *   direction), a combining mark not after a letter or more than two in a row, a name with no
 *   letter or digit, and Latin, Cyrillic and Greek letters mixed in one name (the usual look-alike
 *   spoof).
 *
 * Look-alikes (F4, owner 2026-10-23): 0/o, 1/l/i and rn/m count as the same letters only when a
 * display name is compared against reserved words (here) and staff or owner names (the API, with
 * `lookAlikeKey`). Two traders' names that only look alike are both allowed. Since signup round 3
 * the fold also drops accents, reads full-width forms as plain ones and Cyrillic or Greek
 * look-alike letters as Latin, and the reserved words are found between any non-letters.
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

/** Cyrillic and Greek lower-case letters that look like Latin ones (after NFKD and lower case). */
const HOMOGLYPHS: Readonly<Record<string, string>> = {
  а: 'a', в: 'b', е: 'e', ё: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x',
  ѕ: 's', і: 'i', ї: 'i', ј: 'j', һ: 'h', ԁ: 'd', ԛ: 'q', ԝ: 'w', ӏ: 'l',
  α: 'a', β: 'b', ε: 'e', η: 'n', ι: 'i', κ: 'k', ν: 'v', ο: 'o', ρ: 'p', τ: 't', υ: 'u', χ: 'x', ω: 'w', ϲ: 'c', ϳ: 'j',
};
const HOMOGLYPH_RE = new RegExp(`[${Object.keys(HOMOGLYPHS).join('')}]`, 'gu');

/**
 * The look-alike fold: NFKD without its combining marks (accents off, full-width forms plain), lower
 * case, Cyrillic and Greek look-alikes as Latin, then 0→o, 1→l, i→l and rn→m. The letter
 * substitutions neither make nor use `r`, `n` or `m`, so the order of the last two steps does not
 * matter.
 */
export function lookAlikeKey(name: string): string {
  const plain = name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(HOMOGLYPH_RE, (c) => HOMOGLYPHS[c]!);
  return plain.replace(/[01i]/g, (c) => (c === '0' ? 'o' : 'l')).replace(/rn/g, 'm');
}

const RESERVED_TOKENS = new Set(
  ['admin', 'administrator', 'moderator', 'mod', 'support', 'staff', 'owner', 'system', 'root', 'help', 'x2f', 'official'].map(lookAlikeKey),
);
const F = { admin: lookAlikeKey('admin'), x2f: lookAlikeKey('x2f'), staff: lookAlikeKey('staff'), moderator: lookAlikeKey('moderator'), support: lookAlikeKey('support') };

/** Reserved words and their look-alikes, as whole tokens or by the prefix and suffix rules. */
function isReserved(key: string): boolean {
  const folded = lookAlikeKey(key);
  if (folded.split(/[^\p{L}\p{N}]+/u).some((t) => RESERVED_TOKENS.has(t))) return true;
  const flat = folded.replace(/[^\p{L}\p{N}]+/gu, '');
  return (
    flat.startsWith(F.admin) ||
    flat.startsWith(F.x2f) ||
    flat.startsWith(F.staff) ||
    flat.includes(F.moderator) ||
    flat.endsWith(F.support)
  );
}

/** The length rule, in code points (an astral character counts once); huge input is refused first. */
function lengthOk(input: string): boolean {
  if (input.length > MAX_RAW_LENGTH) return false;
  const len = [...input].length;
  return len >= 5 && len <= 20;
}

function checkShape(input: string): NameCheck {
  if (typeof input !== 'string') return { ok: false, reason: 'characters' };
  if (!lengthOk(input)) return { ok: false, reason: 'length' };
  if (!NAME_RE.test(input)) return { ok: false, reason: 'characters' };
  return { ok: true, name: input, key: input.toLowerCase() };
}

/** Every character a display name may hold: letters, combining marks, decimal digits, the space and the listed symbols. */
const DISPLAY_CHARS = /^[\p{L}\p{M}\p{Nd} $&!?.,'\-_@#%*+():]+$/u;
/** Letters of the right-to-left scripts (Bidi classes R and AL): Hebrew, Arabic, Syriac, Thaana, N'Ko and the rest. */
const RTL = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u;
/** A combining mark at the start, after a non-letter, or a third one in a row. */
const BAD_MARK = /(?:^|[^\p{L}\p{M}])\p{M}|\p{M}{3}/u;
const LOOK_ALIKE_SCRIPTS = [/\p{Script=Latin}/u, /\p{Script=Cyrillic}/u, /\p{Script=Greek}/u];

/**
 * A public display name: normalised (NFC, trimmed, runs of spaces as one), then the length, the
 * characters (see the top of this file), then reserved words and their look-alikes.
 */
export function checkDisplayName(input: string): NameCheck {
  if (typeof input !== 'string') return { ok: false, reason: 'characters' };
  // Refuse huge input before normalising it.
  if (input.length > MAX_RAW_LENGTH) return { ok: false, reason: 'length' };
  const name = input.normalize('NFC').replace(/ {2,}/g, ' ').replace(/^ +| +$/g, '');
  if (!lengthOk(name)) return { ok: false, reason: 'length' };
  if (!DISPLAY_CHARS.test(name) || RTL.test(name) || BAD_MARK.test(name) || !/[\p{L}\p{Nd}]/u.test(name)) return { ok: false, reason: 'characters' };
  const letters = [...name].filter((c) => /\p{L}/u.test(c));
  if (LOOK_ALIKE_SCRIPTS.filter((re) => letters.some((c) => re.test(c))).length > 1) return { ok: false, reason: 'characters' };
  const key = name.toLowerCase();
  if (isReserved(key)) return { ok: false, reason: 'reserved' };
  return { ok: true, name, key };
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
