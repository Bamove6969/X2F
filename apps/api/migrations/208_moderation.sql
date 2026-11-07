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

-- G37 (owner 7 Nov): every dispute has an incident ID, shown to both traders at the top of the trade
-- and to the moderator. Nine characters of Crockford base32 (no I, L, O or U): eight random
-- (40 bits from gen_random_uuid, a strong random source) and a Luhn mod 32 check character, so a
-- mistyped ID is caught when a trader quotes it. `isIncidentId` in @x2f/staff checks the same.
-- Random, never a counter: an ID says nothing about how many disputes there are.
create function x2f_incident_id() returns text
  language plpgsql volatile
  set search_path = pg_catalog
as $$
declare
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v bigint;
  out text;
  cp int;
  factor int;
  addend int;
  total int;
  i int;
begin
  loop
    v := ('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))::bit(40)::bigint;
    out := '';
    for i in reverse 7..0 loop
      out := out || substr(alphabet, ((v >> (5 * i)) & 31)::int + 1, 1);
    end loop;
    -- Luhn mod 32: from the right, the payload's last character is doubled.
    total := 0;
    factor := 2;
    for i in reverse 8..1 loop
      cp := strpos(alphabet, substr(out, i, 1)) - 1;
      addend := factor * cp;
      total := total + (addend / 32) + (addend % 32);
      factor := 3 - factor;
    end loop;
    out := out || substr(alphabet, ((32 - (total % 32)) % 32) + 1, 1);
    exit when not exists (select 1 from public.disputes where incident_id = out);
  end loop;
  return out;
end
$$;

alter table disputes add column incident_id text;
update disputes set incident_id = x2f_incident_id() where incident_id is null;
alter table disputes
  alter column incident_id set default x2f_incident_id(),
  alter column incident_id set not null,
  add constraint disputes_incident_id_format check (incident_id ~ '^[0-9A-HJKMNP-TV-Z]{9}$');
create unique index disputes_incident_id on disputes (incident_id);

-- The moderator's latest request for the unblurred proof (Task 11), so the trader named sees it in
-- the dispute view even if they were offline for the live event. The name is the moderator's
-- public display name, as `moderator_name` (108) holds it.
alter table disputes
  add column proof_request_side text check (proof_request_side in ('buyer', 'seller')),
  add column proof_requested_at timestamptz,
  add column proof_requested_by text,
  add constraint disputes_proof_request_complete check (
    (proof_request_side is null) = (proof_requested_at is null) and (proof_request_side is null) = (proof_requested_by is null)
  );
