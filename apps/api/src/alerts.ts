import type { Queryable } from './db/pool.js';

/** What an account is told about (shown in its alert list; Task 11). */
export type AlertKind =
  | 'new-login'
  | 'recovery-login'
  | 'recovery-hold-cancelled'
  | 'login-locked'
  | 'login-method-added'
  | 'login-method-removed'
  | 'sessions-ended'
  | 'wallet-added'
  | 'payout-wait-off-scheduled'
  | 'device-key-added';

/**
 * Records an alert for the account. `detail` must never carry an IP address, user agent, secret,
 * token or full wallet address. `now` is the server clock (`deps.clock()`), never the database's.
 */
export async function addAlert(db: Queryable, accountId: string, kind: AlertKind, detail: object, now: Date): Promise<void> {
  await db.query(`insert into alerts (account_id, kind, detail, created_at) values ($1, $2, $3, $4)`, [
    accountId, kind, JSON.stringify(detail), now,
  ]);
}
