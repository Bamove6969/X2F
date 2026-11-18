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
 * `lookAlikeKey`). Two traders' names that only look alike are both allowed. Since the review of
 * second-signup-r3 (ported 18 Nov) the fold also drops invisible characters and folds Latin
 * look-alikes (LOOK_ALIKE_LETTERS), and staff names are compared without punctuation (`staffNameKey`).
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
 * Review of second-signup-r3 (16 Nov 2026), M1, ported to main (lead, 18 Nov): lower-case Latin
 * letters that NFKD leaves alone but that are drawn like a plain a-z letter. Main's display names
 * are ASCII, so none passes `checkDisplayName`; the fold is defence in depth for the reserved-word
 * and staff checks (two traders' names may still look alike, F4). A reviewed list, not UTS #39:
 * add an entry only with a test in username.test.ts ("LOOK_ALIKE_LETTERS"). Capitals (Ɑ Ɡ Ɪ Ł ...)
 * arrive here lower-cased.
 */
export const LOOK_ALIKE_LETTERS: Readonly<Record<string, string>> = {
  // Dotless and IPA letters.
  ı: 'i', ȷ: 'j', ɑ: 'a', ɡ: 'g', ɩ: 'i', ɛ: 'e', ɪ: 'i', ʟ: 'l', ɴ: 'n', ʀ: 'r', ʏ: 'y', ʙ: 'b', ɢ: 'g', ʜ: 'h',
  // Small capitals (Phonetic Extensions U+1D00 and Latin Extended-D).
  ᴀ: 'a', ᴄ: 'c', ᴅ: 'd', ᴇ: 'e', ᴊ: 'j', ᴋ: 'k', ᴌ: 'l', ᴍ: 'm', ᴏ: 'o', ᴘ: 'p', ᴛ: 't', ᴜ: 'u', ᴠ: 'v', ᴡ: 'w', ᴢ: 'z',
  ꜰ: 'f', ꜱ: 's', ꞯ: 'q',
  // Letters with a stroke or bar (NFKD does not split them).
  ł: 'l', ƚ: 'l', đ: 'd', ø: 'o', ħ: 'h', ŧ: 't', ƀ: 'b', ɨ: 'i', ʉ: 'u', ꞵ: 'b', ɭ: 'l',
};
const LOOK_ALIKE_RE = new RegExp(`[${Object.keys(LOOK_ALIKE_LETTERS).join('')}]`, 'gu');

/**
 * Invisible characters (Unicode Default_Ignorable_Code_Point: zero-width, joiners, variation
 * selectors, Hangul fillers, soft hyphen), and the Hangul fillers by name as well (review B1),
 * whatever the engine's Unicode version says.
 */
const INVISIBLE = /[\p{Default_Ignorable_Code_Point}\u115F\u1160\u3164\uFFA0]/gu;

/**
 * The look-alike fold: invisible characters dropped (review B1), lower case, the Latin look-alikes
 * of LOOK_ALIKE_LETTERS as a-z (review M1), then 0→o, 1→l, i→l and rn→m. The letter substitutions
 * neither make nor use `r`, `n` or `m` except ʀ→r and ɴ→n, which run before rn→m, so ʀɴ folds like rn.
 */
export function lookAlikeKey(name: string): string {
  const plain = name.replace(INVISIBLE, '').toLowerCase().replace(LOOK_ALIKE_RE, (c) => LOOK_ALIKE_LETTERS[c]!);
  return plain.replace(/[01i]/g, (c) => (c === '0' ? 'o' : 'l')).replace(/rn/g, 'm');
}

/**
 * The key a display name is compared with staff and owner display names by (F4; review of
 * second-signup-r3, M2): the look-alike fold with every non-letter and non-digit removed, as the
 * reserved-word check does, so `Mira_K` and `MiraK` match the staff name `Mira.K`.
 */
export function staffNameKey(name: string): string {
  return lookAlikeKey(name).replace(/[^\p{L}\p{N}]+/gu, '');
}

const RESERVED_TOKENS = new Set(
  ['admin', 'administrator', 'moderator', 'mod', 'support', 'staff', 'owner', 'system', 'root', 'help', 'x2f', 'official'].map(lookAlikeKey),
);
const F = { admin: lookAlikeKey('admin'), x2f: lookAlikeKey('x2f'), staff: lookAlikeKey('staff'), moderator: lookAlikeKey('moderator'), support: lookAlikeKey('support') };

/** Reserved words and their look-alikes, as whole tokens or by the prefix and suffix rules. */
function isReserved(key: string): boolean {
  const folded = lookAlikeKey(key);
  if (folded.split(/[._-]/).some((t) => RESERVED_TOKENS.has(t))) return true;
  const flat = folded.replace(/[._-]/g, '');
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
