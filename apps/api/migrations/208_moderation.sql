-- Plan 4 Task 11: the moderator's freeze, and the moderation process's read-only view.
--
-- Owner 2026-11-02 (binding): a dispute alone never blocks trading and places no hold. A moderator
-- FREEZES an account as a separate later action, only when a party ignores the dispute (about 48 h
-- with no reply) or ignores a ruling; the freeze has NO end time and is lifted only by a moderator
-- after checking that the person did what the dispute asks. So the plan's `kind 'dispute'` hold is
-- not built: `trading_holds` (102) gains only the freeze. An active row (no `lifted_at`) refuses
-- posting, relisting and taking (102's rule); an open escrow trade still finishes.
--
-- `dispute_code` carries no foreign key: a trade's whole-record delete (R36) must not be blocked by
-- a freeze, which is an account record and outlives the trade.
alter table trading_holds
  add column kind text not null default 'freeze' check (kind = 'freeze'),
  add column dispute_code text,
  add column dispute_seq integer,
  add column side text check (side in ('buyer', 'seller')),
  add column reason text check (reason in ('no-reply', 'ignored-ruling')),
  add column placed_by uuid,
  add column lifted_by uuid,
  add constraint trading_holds_freeze_complete check (
    (dispute_code is null and dispute_seq is null and side is null and reason is null and placed_by is null)
    or (dispute_code is not null and dispute_seq is not null and side is not null and reason is not null and placed_by is not null)
  ),
  add constraint trading_holds_lifted_by check (lifted_by is null or lifted_at is not null);

-- One active freeze per account and dispute.
create unique index trading_holds_one_freeze on trading_holds (account_id, dispute_code, dispute_seq)
  where lifted_at is null and dispute_code is not null;

-- The moderation process's own login role (Plan 6 deploys it as a login role that is a member of
-- this one) reads only what its internal API checks before it opens a chat or a proof: the log
-- entry the API wrote for the read (`activity_log`), the trade's current dispute (`disputes`), the
-- trade's chat and its ciphertext envelopes. It writes nothing here.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'x2f_mod_reader') then
    create role x2f_mod_reader nologin;
  end if;
end
$$;

grant select (id, at, action, trade_code) on activity_log to x2f_mod_reader;
grant select (code, seq, status) on disputes to x2f_mod_reader;
grant select (code, trade_code) on chats to x2f_mod_reader;
grant select (id, chat, sender_role, envelope, created_at) on chat_envelopes to x2f_mod_reader;
