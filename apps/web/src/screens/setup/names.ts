/**
 * Name rules (spec 6.1, owner 2026-10-23), mirroring the lead's FU-A exports from `@x2f/accounts`
 * (`checkDisplayName`, `checkLoginName`, `checkNames`), which are not on the main line yet. When
 * FU-A lands, `task28-tripwires.test.ts` fails and this file should re-export them from
 * `@x2f/auth-client` instead. The server checks again; this is for the person's sake.
 *
 * Every account has a public **display name** (offers, profiles, chat; the board's "Username") and a
 * private **login name** (never shown; used to log in with a password or a security key). Both are
 * 5-20 ASCII letters, digits, dots, dashes and underscores, kept exactly as typed, and they must
 * differ, ignoring case. Reserved words and their look-alikes (0/o, 1/l/i, rn/m) are refused for the
 * display name only.
 */

export type NameRefusal = 'length' | 'characters' | 'reserved';
export type NameCheck = { ok: true; name: string; key: string } | { ok: false; reason: NameRefusal };
export type NamesCheck =
  | { ok: true; display: { name: string; key: string }; login: { name: string; key: string } }
  | { ok: false; field: 'displayName' | 'loginName'; reason: NameRefusal | 'same' };

const NAME_RE = /^[A-Za-z0-9._-]{5,20}$/;
const MAX_RAW_LENGTH = 64;

function lookAlikeKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[01i]/g, (c) => (c === '0' ? 'o' : 'l'))
    .replace(/rn/g, 'm');
}

const RESERVED_TOKENS = new Set(
  ['admin', 'administrator', 'moderator', 'mod', 'support', 'staff', 'owner', 'system', 'root', 'help', 'x2f', 'official'].map(lookAlikeKey),
);
const F = {
  admin: lookAlikeKey('admin'),
  x2f: lookAlikeKey('x2f'),
  staff: lookAlikeKey('staff'),
  moderator: lookAlikeKey('moderator'),
  support: lookAlikeKey('support'),
};

function isReserved(key: string): boolean {
  const folded = lookAlikeKey(key);
  if (folded.split(/[._-]/).some((t) => RESERVED_TOKENS.has(t))) return true;
  const flat = folded.replace(/[._-]/g, '');
  return flat.startsWith(F.admin) || flat.startsWith(F.x2f) || flat.startsWith(F.staff) || flat.includes(F.moderator) || flat.endsWith(F.support);
}

function checkShape(input: string): NameCheck {
  if (input.length > MAX_RAW_LENGTH) return { ok: false, reason: 'length' };
  const len = [...input].length;
  if (len < 5 || len > 20) return { ok: false, reason: 'length' };
  if (!NAME_RE.test(input)) return { ok: false, reason: 'characters' };
  return { ok: true, name: input, key: input.toLowerCase() };
}

export function checkDisplayName(input: string): NameCheck {
  const r = checkShape(input);
  if (r.ok && isReserved(r.key)) return { ok: false, reason: 'reserved' };
  return r;
}

export function checkLoginName(input: string): NameCheck {
  return checkShape(input);
}

export function checkNames(displayName: string, loginName: string): NamesCheck {
  const display = checkDisplayName(displayName);
  if (!display.ok) return { ok: false, field: 'displayName', reason: display.reason };
  const login = checkLoginName(loginName);
  if (!login.ok) return { ok: false, field: 'loginName', reason: login.reason };
  if (display.key === login.key) return { ok: false, field: 'loginName', reason: 'same' };
  return { ok: true, display: { name: display.name, key: display.key }, login: { name: login.name, key: login.key } };
}

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
