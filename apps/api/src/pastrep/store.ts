/**
 * The moderator-verified dollar figure of a past-reputation claim (owner order 2 Nov 2026: imported
 * volume counts toward the traded total ONLY through it; migration 310).
 *
 * - `setVerifiedPastRepUsd` is the one writer of `verified_usd_cents`. Plan 4's moderator route calls
 *   it (tripwire NEEDS_P4_PASTREP_VERIFIED_USD); the staff perm check and the activity-log entry are
 *   that route's. Here: the setter must be an enabled staff account and the claim live (`signed` or
 *   `approved`), checked inside the one UPDATE, so a claim revoked meanwhile is never given a figure.
 *   `null` clears the figure. The table's trigger refuses a figure from anyone else as well.
 * - `verifiedPastRepUsdCents` is what the traded total ("Completed over $X") may add: the sum of the
 *   account's live claims with a figure. An unverified (null) or dead claim adds nothing.
 *   `verifiedPastRepUsdSql` is the same sum as an SQL fragment, so the traded total
 *   (`traders/tradedTotal.ts` `tradedTotalSql`) adds it for many accounts in one query; the column
 *   name stays in this file only.
 */
import type { Queryable } from '../db/pool.js';

const LIVE = ['signed', 'approved'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SetVerifiedUsdResult = { ok: true } | { ok: false; reason: 'not-found' | 'not-live' | 'not-staff' | 'bad-amount' };

/** Sets (or, with `null`, clears) a claim's verified dollar figure in whole US cents. */
export async function setVerifiedPastRepUsd(
  q: Queryable, claimId: string, cents: number | null, staffId: string, now: Date,
): Promise<SetVerifiedUsdResult> {
  if (cents !== null && !(Number.isSafeInteger(cents) && cents > 0)) return { ok: false, reason: 'bad-amount' };
  if (!UUID.test(claimId)) return { ok: false, reason: 'not-found' };
  if (!UUID.test(staffId)) return { ok: false, reason: 'not-staff' };
  const set = cents === null ? [null, null, null] : [cents, staffId, now];
  const { rows } = await q.query<{ id: string }>(
    `update past_reputation set verified_usd_cents = $2, verified_usd_by = $3, verified_usd_at = $4
      where id = $1 and status = any($6::text[])
        and exists (select 1 from accounts where id = $5 and kind = 'staff' and disabled_at is null)
      returning id`,
    [claimId, ...set, staffId, LIVE],
  );
  if (rows.length > 0) return { ok: true };
  const staff = await q.query("select 1 from accounts where id = $1 and kind = 'staff' and disabled_at is null", [staffId]);
  if (staff.rows.length === 0) return { ok: false, reason: 'not-staff' };
  const claim = await q.query('select 1 from past_reputation where id = $1', [claimId]);
  return { ok: false, reason: claim.rows.length === 0 ? 'not-found' : 'not-live' };
}

/**
 * SQL (bigint): the sum, in US cents, of the live past-reputation claims of the account `account` (an
 * SQL expression, never input) that carry a verified figure; 0 when none. Read live, so a claim
 * revoked, removed or rejected stops counting at once.
 */
export const verifiedPastRepUsdSql = (account: string): string =>
  `coalesce((select sum(pr.verified_usd_cents) from past_reputation pr
     where pr.account_id = ${account} and pr.status in (${LIVE.map((s) => `'${s}'`).join(', ')}) and pr.verified_usd_cents is not null), 0)::bigint`;

/** The sum, in US cents, of the account's live past-reputation claims with a verified figure (0 when none). */
export async function verifiedPastRepUsdCents(q: Queryable, accountId: string): Promise<number> {
  const { rows } = await q.query<{ total: string }>(`select ${verifiedPastRepUsdSql('$1::uuid')}::text as total`, [accountId]);
  return Number(rows[0]!.total);
}
