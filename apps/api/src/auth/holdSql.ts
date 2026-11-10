/**
 * SQL of the recovery-code hold for the listing queries (offers, take, chat), in a module with no
 * imports so those modules can build their query constants at load time whatever the import order
 * (from wip/lead-p2-recovery-rules, in the hold model v3 shape).
 */

/** SQL: true while `col`'s account is in a recovery-code hold: its offers are hidden from everyone else, like a trading hold, with no public notice. */
export const recoveryHoldHidesSql = (col: string): string =>
  `exists (select 1 from account_holds rh where rh.account_id = ${col} and rh.reason = 'recovery-code')`;
