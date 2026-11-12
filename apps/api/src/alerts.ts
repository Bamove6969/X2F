import type { Queryable } from './db/pool.js';

/** What an account is told about (shown in its alert list; Task 11). */
export type AlertKind =
  | 'new-login'
  | 'recovery-login'
  | 'recovery-hold-cancelled'
  | 'login-locked'
  | 'login-method-added'
  | 'login-method-removed'
  | 'login-name-set'
  | 'sessions-ended'
  | 'wallet-added'
  | 'wallet-removed'
  | 'device-key-added'
  // Task 16: new-device approval and "One device at a time".
  | 'login-approval'
  | 'login-blocked'
  | 'logged-out-by-new-device'
  | 'one-device-set'
  // Task 17: the 24-hour hold.
  | 'hold-started'
  | 'hold-ended'
  // Hold model v3 (owner 1-2 Nov 2026): a moderator moved the hold's end; a username-and-password session's
  // changes submitted, cancelled, discarded early or applied; the used recovery code replaced.
  | 'hold-extended'
  | 'hold-changes-submitted'
  | 'hold-changes-cancelled'
  | 'hold-changes-discarded'
  | 'hold-changes-applied'
  | 'recovery-code-renewed'
  // Plan 2 Task 18: to the account owner, about the team.
  | 'team-member-joined'
  | 'team-member-login'
  // Owner 2 Nov 2026: the account switched to a vendor account (detail: the confirm method).
  | 'became-vendor'
  // Owner only: price health (spec 11.6, Plan 3 Task 3).
  | 'price-source-failing'
  | 'price-source-recovered'
  | 'market-prices-paused'
  | 'market-prices-resumed'
  // Owner only: the vendor auto-close hit its per-run cap (lead vendor review item 4).
  | 'auto-close-capped'
  // Owner only: a seller's cancel refund landed after an escrow ruling was proposed or published
  // on the buyer's dispute; the case needs a person to re-rule (re-verify 43fbbb2f, R-I1).
  | 'dispute-refund-after-ruling'
  // Owner only: the fee wallet's sweep to the cold wallet (B-006, Plan 4 Task 9).
  | 'fee-sweep-due'
  | 'fee-sweep-failed'
  // Owner only (D-032 review S2): a staff member's security was reset, and the reset link was used.
  | 'staff-security-reset'
  | 'staff-security-reset-finished'
  // Owner only: an appeal nobody may review (every senior moderator and the owner was involved in
  // round 1, or none is switched on); it waits in the queue until one is added (D-011, Plan 4 Task 24).
  | 'appeal-no-reviewer';

/**
 * Records an alert for the account. `detail` must never carry an IP address, user agent, secret,
 * token or full wallet address. `now` is the server clock (`deps.clock()`), never the database's.
 */
export async function addAlert(db: Queryable, accountId: string, kind: AlertKind, detail: object, now: Date): Promise<void> {
  await db.query(`insert into alerts (account_id, kind, detail, created_at) values ($1, $2, $3, $4)`, [
    accountId, kind, JSON.stringify(detail), now,
  ]);
}

/**
 * Records an alert for the owner (in-app; the phone push joins through the Plan 3 push channel
 * later). Goes to the owner account if there is one and it is not disabled; `detail` follows the
 * same rules as `addAlert`.
 */
export async function addOwnerAlert(db: Queryable, kind: AlertKind, detail: object, now: Date): Promise<void> {
  await db.query(
    `insert into alerts (account_id, kind, detail, created_at)
     select id, $1, $2, $3 from accounts where kind = 'owner' and disabled_at is null`,
    [kind, JSON.stringify(detail), now],
  );
}
