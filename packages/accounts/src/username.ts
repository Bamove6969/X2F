/**
 * Username rules: 5–20 ASCII letters, digits, `.`, `-`, `_`; shown as typed;
 * unique case-insensitively through `key`.
 */

/** Account kinds. Separate from `@x2f/core`'s trade `Role`. */
export type AccountKind = 'trader' | 'staff' | 'owner';

export type UsernameCheck =
  | { ok: true; username: string; key: string }
  | { ok: false; reason: 'length' | 'characters' | 'reserved' };

const USERNAME_RE = /^[A-Za-z0-9._-]{5,20}$/;
/** UTF-16 code units; anything longer is refused before any other work. */
const MAX_RAW_LENGTH = 64;

const RESERVED_TOKENS = new Set([
  'admin',
  'administrator',
  'moderator',
  'mod',
  'support',
  'staff',
  'owner',
  'system',
  'root',
  'help',
  'x2f',
  'official',
]);

function isReserved(key: string): boolean {
  if (key.split(/[._-]/).some((t) => RESERVED_TOKENS.has(t))) return true;
  const flat = key.replace(/[._-]/g, '');
  return (
    flat.startsWith('admin') ||
    flat.startsWith('x2f') ||
    flat.startsWith('staff') ||
    flat.includes('moderator') ||
    flat.endsWith('support')
  );
}

export function checkUsername(input: string): UsernameCheck {
  if (typeof input !== 'string') return { ok: false, reason: 'characters' };
  // Refuse huge input before spreading it into code points.
  if (input.length > MAX_RAW_LENGTH) return { ok: false, reason: 'length' };
  // Length in code points, so an astral character counts once.
  const len = [...input].length;
  if (len < 5 || len > 20) return { ok: false, reason: 'length' };
  if (!USERNAME_RE.test(input)) return { ok: false, reason: 'characters' };
  const key = input.toLowerCase();
  if (isReserved(key)) return { ok: false, reason: 'reserved' };
  return { ok: true, username: input, key };
}
