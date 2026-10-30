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
  // Owner only: price health (spec 11.6, Plan 3 Task 3).
  | 'price-source-failing'
  | 'price-source-recovered'
  | 'market-prices-paused'
  | 'market-prices-resumed';

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
