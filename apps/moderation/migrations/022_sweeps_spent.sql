-- Review lead-mod-purge 22 Nov M2 (Plan 7 Task 2 follow-up). Moderation number 022.
--
-- mod_sweeps_spent: one keyed tag per sweep tx a shredded trade had counted (mod_sweeps, 005), so
-- the rule "one tx counts for one trade only" outlives the trade shred: claimSweep refuses a tagged
-- tx for every trade. The tag is HMAC-SHA256 under the `sweeps` subkey of MOD_KEYSTORE_KEY of
-- 'x2f/mod/sweep-spent/v1|<tx hash>' (keystore.ts sweepTag), as the API's chat_purged_marks (123):
-- it names neither the tx nor the trade, so a database dump holds no list of the escrows' sweeps.
-- Written by the shred in the transaction that deletes the trade's mod_sweeps rows. Never deleted.
create table mod_sweeps_spent (
  tag bytea primary key check (length(tag) = 32)
);

revoke all on mod_sweeps_spent from public;
