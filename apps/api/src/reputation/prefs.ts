import { BADGES, type BadgeId, type BadgePrefs, type Visibility } from '@x2f/reputation';
import type { Queryable } from '../db/pool.js';

/**
 * Plan 5 Task 5: a trader's badge settings (303_badge_prefs.sql). Visibility only: badges are earned
 * from records on every read (@x2f/reputation earnedBadges) and nothing here can grant one.
 */

/** The spec 5.4 defaults, before a trader saves a first choice. */
export const NO_CHOICES: BadgePrefs = Object.freeze({ chosen: false, levels: {}, order: [] }) as BadgePrefs;

const LEVELS: ReadonlySet<string> = new Set<Visibility>(['featured', 'hover', 'hidden']);

/** True for an id the catalogue knows (or a past-reputation id), never anything else. */
export function isBadgeId(id: unknown): id is BadgeId {
  if (typeof id !== 'string' || id.length > 80) return false;
  if (id.startsWith('past-rep:')) return /^past-rep:[0-9a-f-]{36}$/.test(id);
  return Object.hasOwn(BADGES, id);
}

export function isVisibility(v: unknown): v is Visibility {
  return typeof v === 'string' && LEVELS.has(v);
}

/**
 * The prefs in a badge_prefs row (or the defaults for none). Anything the catalogue does not know
 * is dropped, so an old or hand-edited row can never break a read.
 */
export function prefsFromRow(row: { chosen: boolean | null; levels: unknown; featured_order: string[] | null } | null | undefined): BadgePrefs {
  if (!row || row.chosen === null) return NO_CHOICES;
  const levels: Partial<Record<BadgeId, Visibility>> = {};
  if (row.levels !== null && typeof row.levels === 'object' && !Array.isArray(row.levels)) {
    for (const [id, level] of Object.entries(row.levels as Record<string, unknown>)) {
      if (isBadgeId(id) && isVisibility(level)) levels[id] = level;
    }
  }
  const order = (row.featured_order ?? []).filter(isBadgeId);
  return { chosen: row.chosen, levels, order };
}

/** Several accounts' prefs in one query (no row: the defaults). */
export async function loadPrefs(q: Queryable, accountIds: readonly string[]): Promise<Map<string, BadgePrefs & { portablePublic: boolean }>> {
  const out = new Map<string, BadgePrefs & { portablePublic: boolean }>();
  if (accountIds.length === 0) return out;
  const { rows } = await q.query<{ account_id: string; chosen: boolean; levels: unknown; featured_order: string[]; portable_public: boolean }>(
    'select account_id, chosen, levels, featured_order, portable_public from badge_prefs where account_id = any($1::uuid[])',
    [[...accountIds]],
  );
  for (const r of rows) out.set(r.account_id, { ...prefsFromRow(r), portablePublic: r.portable_public });
  return out;
}

/** Saves the badge choices (creating the row on the first save); leaves `portable_public` as it is. */
export async function savePrefs(q: Queryable, accountId: string, prefs: BadgePrefs, now: Date): Promise<void> {
  await q.query(
    `insert into badge_prefs (account_id, chosen, levels, featured_order, updated_at) values ($1, $2, $3::jsonb, $4, $5)
     on conflict (account_id) do update set chosen = excluded.chosen, levels = excluded.levels, featured_order = excluded.featured_order, updated_at = excluded.updated_at`,
    [accountId, prefs.chosen, JSON.stringify(prefs.levels), prefs.order, now],
  );
}

/** Task 12: shows or hides the signed record on the public profile; leaves the badge choices as they are. */
export async function setRecordPublic(q: Queryable, accountId: string, on: boolean, now: Date): Promise<void> {
  await q.query(
    `insert into badge_prefs (account_id, portable_public, updated_at) values ($1, $2, $3)
     on conflict (account_id) do update set portable_public = excluded.portable_public, updated_at = excluded.updated_at`,
    [accountId, on, now],
  );
}
