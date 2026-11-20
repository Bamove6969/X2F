/**
 * The moderator-verified dollar figure of a past-reputation claim (owner order 2 Nov 2026: imported
 * volume counts toward the traded total ONLY through it; migration 310).
 *
 * - `setVerifiedPastRepUsd` is the one writer of `verified_usd_cents`. Plan 4's moderator route calls
 *   it (`PUT /staff/v1/past-rep/:id/verified-usd`, staff/pastrep.ts; its screen is staff-web's PastRep,
 *   Plan 5 Task 11, which retired the tripwire NEEDS_P4_PASTREP_VERIFIED_USD); the staff perm check and the activity-log entry are
 *   that route's, and it passes the signed-in staff member's real role (`req.staff.role`) as the actor.
 *   Here: the actor's role must be in `PASTREP_VERIFY_ROLES` (owner 2026-11-02: senior moderators and
 *   the owner only; else `forbidden`), the account must match it (an enabled `staff` account for
 *   `senior`, the enabled `owner` account for `owner`; else `not-staff`), and the claim live (`signed`
 *   or `approved`), checked inside the one UPDATE, so a claim revoked meanwhile is never given a
 *   figure. `null` clears the figure. The table's trigger refuses a figure from any account that is
 *   not enabled staff or the owner as well (roles are not in the database on this branch).
 * - `verifiedPastRepUsdCents` is the sum of the account's APPROVED claims with a figure (owner
 *   2026-11-02: a moderator may enter the figure on a `signed` claim before approving it, but it
 *   counts nothing until the claim is approved). An unverified (null), not-yet-approved or dead claim
 *   adds nothing; read at query time, so a claim revoked or a figure cleared stops counting at once.
 *   `verifiedPastRepUsdSql` is the same sum as an SQL fragment; the column name stays in this file
 *   only. No dollar figure is public (owner Q63, 6 Nov): the public traded line is in XMR and never
 *   includes imported volume, which shows per site (`verifiedPastRepBySite`, owner Q64; in US dollars,
 *   owner p4-1: `traders/tradedTotal.ts` `importedLines`).
 */
import type { StaffRole } from '@x2f/staff';
import type { Queryable } from '../db/pool.js';

const LIVE = ['signed', 'approved'];
/** The one status whose figure counts (owner 2026-11-02: "without some sort of backing it up", nothing). */
const COUNTS = 'approved';
/**
 * Who may enter a verified dollar figure: owner 2026-11-02, senior moderators and the owner only "for
 * the time being" (may extend to 'mod' later).
 */
export const PASTREP_VERIFY_ROLES: readonly StaffRole[] = ['owner', 'senior'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SetVerifiedUsdResult = { ok: true } | { ok: false; reason: 'not-found' | 'not-live' | 'not-staff' | 'forbidden' | 'bad-amount' };

/** The staff member entering the figure: their account and their role (Plan 4's `req.staff`). */
export type PastRepVerifier = { accountId: string; role: StaffRole };

/** Owner Q58 (6 Nov 2026): a verified imported figure is at most $100,000 (in cents). */
export const MAX_VERIFIED_USD_CENTS = 100_000 * 100;

/** Sets (or, with `null`, clears) a claim's verified dollar figure in whole US cents. */
export async function setVerifiedPastRepUsd(
  q: Queryable, claimId: string, cents: number | null, actor: PastRepVerifier, now: Date,
): Promise<SetVerifiedUsdResult> {
  if (!PASTREP_VERIFY_ROLES.includes(actor.role)) return { ok: false, reason: 'forbidden' };
  if (cents !== null && !(Number.isSafeInteger(cents) && cents > 0 && cents <= MAX_VERIFIED_USD_CENTS)) return { ok: false, reason: 'bad-amount' };
  const staffId = actor.accountId;
  // The account kind the role needs: the owner role is the owner account, every other role a staff account.
  const kind = actor.role === 'owner' ? 'owner' : 'staff';
  if (!UUID.test(claimId)) return { ok: false, reason: 'not-found' };
  if (!UUID.test(staffId)) return { ok: false, reason: 'not-staff' };
  const set = cents === null ? [null, null, null] : [cents, staffId, now];
  const { rows } = await q.query<{ id: string }>(
    `update past_reputation set verified_usd_cents = $2, verified_usd_by = $3, verified_usd_at = $4
      where id = $1 and status = any($6::text[])
        and exists (select 1 from accounts where id = $5 and kind = $7 and disabled_at is null)
      returning id`,
    [claimId, ...set, staffId, LIVE, kind],
  );
  if (rows.length > 0) return { ok: true };
  const staff = await q.query('select 1 from accounts where id = $1 and kind = $2 and disabled_at is null', [staffId, kind]);
  if (staff.rows.length === 0) return { ok: false, reason: 'not-staff' };
  const claim = await q.query('select 1 from past_reputation where id = $1', [claimId]);
  return { ok: false, reason: claim.rows.length === 0 ? 'not-found' : 'not-live' };
}

/**
 * SQL (bigint): the sum, in US cents, of the APPROVED past-reputation claims of the account `account`
 * (an SQL expression, never input) that carry a verified figure; 0 when none. Read at query time, so
 * a claim revoked, removed or rejected, or a figure cleared, stops counting at once.
 */
export const verifiedPastRepUsdSql = (account: string): string =>
  `coalesce((select sum(pr.verified_usd_cents) from past_reputation pr
     where pr.account_id = ${account} and pr.status = '${COUNTS}' and pr.verified_usd_cents is not null), 0)::bigint`;

/** The sum, in US cents, of the account's APPROVED past-reputation claims with a verified figure (0 when none). */
export async function verifiedPastRepUsdCents(q: Queryable, accountId: string): Promise<number> {
  const { rows } = await q.query<{ total: string }>(`select ${verifiedPastRepUsdSql('$1::uuid')}::text as total`, [accountId]);
  return Number(rows[0]!.total);
}

/** One site's verified imported volume: the site and its moderator-verified figure in US cents. */
export interface VerifiedSiteVolume {
  site: string;
  usdCents: bigint;
}

/**
 * Owner Q64 (6 Nov 2026): imported volume shows as a separate line per site with proof. The
 * APPROVED claims of `accountIds` that carry a verified figure, per account, ordered by site. Read
 * live: a claim revoked, removed or rejected, or a figure cleared, drops out at once.
 */
export async function verifiedPastRepBySite(q: Queryable, accountIds: readonly string[]): Promise<Map<string, VerifiedSiteVolume[]>> {
  const out = new Map<string, VerifiedSiteVolume[]>();
  if (accountIds.length === 0) return out;
  const { rows } = await q.query<{ account_id: string; site: string; cents: string }>(
    `select pr.account_id, pr.site, pr.verified_usd_cents::text as cents from past_reputation pr
      where pr.account_id = any($1::uuid[]) and pr.status = '${COUNTS}' and pr.verified_usd_cents is not null
      order by pr.account_id, pr.site`,
    [[...new Set(accountIds)]],
  );
  for (const r of rows) {
    const list = out.get(r.account_id) ?? [];
    list.push({ site: r.site, usdCents: BigInt(r.cents) });
    out.set(r.account_id, list);
  }
  return out;
}
