// J-14 (D-059): SQL for the compromised-account lock, shared by the trade store, the timer loop and
// the moderation watch list (kept apart from lock.ts so the trade store imports no route code).

/** SQL: true when the account `col` names has a lock that has not been lifted. */
export const lockedSql = (col: string): string => `exists (select 1 from account_locks l where l.account_id = ${col} and l.unlocked_at is null)`;

/** SQL over a `trades` alias: true when the buyer's or the seller's account is locked. */
export const tradeHeldSql = (t = 't'): string =>
  `exists (select 1 from account_locks l where l.unlocked_at is null and l.account_id in (${t}.seller_account_id, ${t}.buyer_account_id))`;
