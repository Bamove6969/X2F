/**
 * The owner's Settings rules shared by the API and the staff site (spec 6.6 "Settings"), so a
 * value the page lets through is a value the API takes:
 *
 * - the moderator contact link (D-067: a matrix.to link to a Matrix identifier, or a t.me link)
 *   and the community links (Plan 4 Task 29: any https link without spaces, as migration 206 checks);
 * - the starter limits (spec 2.3, owner 2026-10-24: "The owner can change every number in
 *   Settings"), their defaults, bounds and the order between the stages.
 *
 * No I/O; it runs in the browser too.
 */

// ---------------------------------------------------------------------------------------------
// Links

/** An https link of at most 198 characters with no spaces (migration 206's check). */
const LINK = /^https:\/\/[^\s]{1,190}$/;

/**
 * D-067 (lead call 2026-10-29, owner confirmed 28 Oct notes): the moderator contact link takes a
 * Matrix or a Telegram link (Matrix preferred: no phone number) and nothing else. Read as a
 * matrix.to link to a Matrix identifier (`https://matrix.to/#/<sigil><localpart>:<server>`, sigil
 * @ ! # or +) or a t.me link (`https://t.me/<name>`, no query or fragment): exact host, no user info,
 * no port. Answers the normalised link (`URL.href`), which is what is stored (review F2), or null.
 */
const MATRIX_ID = /^#\/[@!#+][A-Za-z0-9._=\-/]+:[A-Za-z0-9.-]+(?::[0-9]{1,5})?$/;
export function moderatorContactLink(v: string): string | null {
  if (typeof v !== 'string' || !LINK.test(v) || !URL.canParse(v)) return null;
  const u = new URL(v);
  if (u.protocol !== 'https:' || u.username !== '' || u.password !== '' || u.port !== '') return null;
  // A bare "?" leaves `search` empty; the typed string must not carry one either.
  if (u.search !== '' || u.href.includes('?')) return null;
  if (u.hostname === 'matrix.to') return u.pathname === '/' && MATRIX_ID.test(u.hash) ? u.href : null;
  if (u.hostname === 't.me') return /^\/[A-Za-z0-9_+/-]+$/.test(u.pathname) && u.hash === '' && !u.href.includes('#') ? u.href : null;
  return null;
}

/** A community link (Task 29): an https link of at most 198 characters with no spaces, as typed. */
export function communityLink(v: string): string | null {
  return typeof v === 'string' && LINK.test(v) && URL.canParse(v) ? v : null;
}

// ---------------------------------------------------------------------------------------------
// Starter limits

export interface StarterSettings {
  /** Starter: the largest single trade, whole US dollars. */
  starterCapUsd: number;
  /** Building: the largest single trade, whole US dollars. */
  buildingCapUsd: number;
  /** Building from this many completed trades... */
  buildingMinTrades: number;
  /** ...and an account at least this many days old. */
  buildingMinDays: number;
  /** Graduated (no platform cap) from this many completed trades... */
  graduatedMinTrades: number;
  /** ...and an account at least this many days old. */
  graduatedMinDays: number;
  /** At most this many open trades at once while on Starter. */
  starterMaxOpenTrades: number;
}

export type StarterField = keyof StarterSettings;

/** Spec 2.3 (owner, 2026-10-24). */
export const STARTER_DEFAULTS: Readonly<StarterSettings> = Object.freeze({
  starterCapUsd: 200,
  buildingCapUsd: 1000,
  buildingMinTrades: 5,
  buildingMinDays: 7,
  graduatedMinTrades: 20,
  graduatedMinDays: 30,
  starterMaxOpenTrades: 3,
});

/** The fields in the order the page shows them and the tap signs them. */
export const STARTER_FIELDS: readonly StarterField[] = [
  'starterCapUsd',
  'starterMaxOpenTrades',
  'buildingCapUsd',
  'buildingMinTrades',
  'buildingMinDays',
  'graduatedMinTrades',
  'graduatedMinDays',
];

/** Whole-number bounds of each setting (a stored row outside them is ignored: the default applies). */
export const STARTER_BOUNDS: Readonly<Record<StarterField, readonly [number, number]>> = Object.freeze({
  starterCapUsd: [1, 1_000_000_000],
  buildingCapUsd: [1, 1_000_000_000],
  buildingMinTrades: [0, 100_000],
  buildingMinDays: [0, 3650],
  graduatedMinTrades: [0, 100_000],
  graduatedMinDays: [0, 3650],
  starterMaxOpenTrades: [1, 1000],
});

export function starterInBounds(field: StarterField, v: unknown): v is number {
  const [lo, hi] = STARTER_BOUNDS[field];
  return typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
}

/**
 * Why a full set of starter limits is not one the owner can save: the first field out of bounds,
 * or the stages out of order (Building's cap at least Starter's; Graduated's trades and days at
 * least Building's, so each stage comes after the one before). Null when it is fine.
 */
export function starterLimitsProblem(s: StarterSettings): { field: StarterField; why: 'bounds' | 'order' } | null {
  for (const f of STARTER_FIELDS) if (!starterInBounds(f, s[f])) return { field: f, why: 'bounds' };
  if (s.buildingCapUsd < s.starterCapUsd) return { field: 'buildingCapUsd', why: 'order' };
  if (s.graduatedMinTrades < s.buildingMinTrades) return { field: 'graduatedMinTrades', why: 'order' };
  if (s.graduatedMinDays < s.buildingMinDays) return { field: 'graduatedMinDays', why: 'order' };
  return null;
}
