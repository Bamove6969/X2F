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
  // Review of wip/third-trade-wallet 17 Nov (b) M1: a one-time wallet given back when its trade ended
  // in setup. Detail: app, label, addressEnd.
  | 'wallet-restored'
  // Owner demo note #226: a wallet renamed (PUT /v1/wallets/:id/label). Detail: app, from, label, addressEnd.
  | 'wallet-renamed'
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
  // J-20 (owner p11-27, S-107): a member logged in for the first time (no approval; the lead is told).
  | 'team-member-first-login'
  // Owner 2 Nov 2026: the account switched to a vendor account (detail: the confirm method).
  | 'became-vendor'
  // Owner only: price health (spec 11.6, Plan 3 Task 3).
  | 'price-source-failing'
  | 'price-source-recovered'
  | 'market-prices-paused'
  | 'market-prices-resumed'
  // Owner only, info (owner call OC6 b, awaiting confirmation): a currency moved to a backup price
  // route, and back to its first route. Detail: currencies, message. Not pushed.
  | 'price-route-backup'
  | 'price-route-primary'
  // Owner only: the vendor auto-close hit its per-run cap (lead vendor review item 4).
  | 'auto-close-capped'
  // Owner only: a seller's cancel refund landed after an escrow ruling was proposed or published
  // on the buyer's dispute; the case needs a person to re-rule (re-verify 43fbbb2f, R-I1).
  | 'dispute-refund-after-ruling'
  // Owner only: a ruling's payout was seen on chain after the case was closed (security review
  // 2026-11-12 I7); the trade stays disputed and needs a person.
  | 'ruling-payout-dispute-closed'
  // Owner only: the fee wallet's sweep to the cold wallet (B-006, Plan 4 Task 9).
  | 'fee-sweep-due'
  | 'fee-sweep-failed'
  // Owner only (owner 26 Nov): the payroll wallet's automatic staff payouts at clock-out. Refused:
  // nothing went out and it tries again (told once per payout); unknown: no answer, never resent by
  // itself; blocked: the payout's address no longer matches its key tap, so nothing was sent.
  | 'payroll-send-refused'
  | 'payroll-send-unknown'
  | 'payroll-send-blocked'
  // Owner only (D-032 review S2): a staff member's security was reset, and the reset link was used.
  | 'staff-security-reset'
  | 'staff-security-reset-finished'
  // Owner only: an appeal nobody may review (every senior moderator and the owner was involved in
  // round 1, or none is switched on); it waits in the queue until one is added (D-011, Plan 4 Task 24).
  | 'appeal-no-reviewer'
  // Owner only (re-review lead-mod-chat m5): the moderation service's dispute notice for a chat was
  // refused by this API for good (a 4xx other than 409/429); that dispute's chat gets no notice (T2).
  | 'chat-notice-refused'
  // Re-review 2 m3 (lead default, owner question): a staff device was certified to read disputed
  // chats; to the owner (pushed) and to the person.
  | 'staff-device-certified'
  // Owner only (Plan 4 Task 12, A6): a seller ordered to send the XMR let the comply time pass with no
  // proof; the case waits for a senior moderator or the owner to decide the suspension.
  | 'dispute-comply-lapsed'
  // Owner only (re-review m3 follow-up): the payment-proof checker gave up on a stuck wallet; once
  // per stuck episode. After three, proofs answer 503 until the API is restarted.
  | 'tx-proof-check-stuck'
  // Owner only (re-review w1): the checker gave up on its third stuck wallet; every proof answers 503
  // until the API is restarted. Once.
  | 'tx-proof-check-stopped';

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
