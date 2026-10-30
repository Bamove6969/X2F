-- Plan 4, Task 3: the append-only, hash-chained activity log (spec 6.6).
--
-- Every row's hash covers the previous row's hash, so a changed, removed or inserted row breaks
-- the chain from that point (`verifyLogChain`, and the moderation process's checkpoints, Task 14).
-- `detail` is the canonical JSON exactly as hashed. Entries never hold chat text, ruling reasons,
-- staff notes, addresses or IP addresses (the app checks each detail against its action's schema).
-- The log is never purged: a trade's 90-day delete (R36) leaves its entries, which hold only ids.
create table activity_log (
  id bigserial primary key,
  at timestamptz not null,
  actor_kind text not null check (actor_kind in ('staff', 'trader', 'system')),
  actor_id uuid,
  actor_role text check (actor_role in ('owner', 'senior', 'mod', 'helper', 'buyer', 'seller')),
  trade_code text check (trade_code ~ '^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$'),
  action text not null check (action ~ '^[a-z]+(\.[a-z-]+)+$' and char_length(action) <= 64),
  detail text not null check (char_length(detail) <= 4096),
  prev_hash bytea,
  hash bytea not null check (octet_length(hash) = 32),
  check (actor_kind = 'system' or actor_role is not null),
  check (actor_kind <> 'system' or (actor_id is null and actor_role is null)),
  check (actor_kind <> 'staff' or actor_id is not null)
);

create index activity_log_trade on activity_log (trade_code, id) where trade_code is not null;
create index activity_log_actor on activity_log (actor_id, at) where actor_id is not null;

-- Append-only for every role: UPDATE, DELETE and TRUNCATE are always refused.
create function activity_log_append_only() returns trigger
  language plpgsql
  set search_path = pg_catalog
as $$
begin
  raise exception 'activity_log is append-only' using errcode = 'insufficient_privilege';
end
$$;

create trigger activity_log_append_only
  before update or delete on activity_log
  for each row execute function activity_log_append_only();

create trigger activity_log_no_truncate
  before truncate on activity_log
  for each statement execute function activity_log_append_only();

-- Each new row must extend the current head: its prev_hash is the head's hash (null only for the
-- first row), its id comes after the head's, `at` has millisecond precision, and its hash is the
-- chain hash `appendLog` computes. The same advisory lock as `appendLog` serialises inserts, so two
-- inserts can never both extend the same head (a fork) even if one bypasses `appendLog`.
create function activity_log_chain() returns trigger
  language plpgsql
  set search_path = pg_catalog, public
as $$
declare
  head_id bigint;
  head_hash bytea;
  expected bytea;
begin
  perform pg_advisory_xact_lock(7240001);
  select l.id, l.hash into head_id, head_hash from activity_log l order by l.id desc limit 1;
  if head_id is null then
    if new.prev_hash is not null then
      raise exception 'activity_log: the first row has no prev_hash' using errcode = 'check_violation';
    end if;
  else
    if new.prev_hash is distinct from head_hash then
      raise exception 'activity_log: prev_hash is not the head (fork)' using errcode = 'check_violation';
    end if;
    if new.id <= head_id then
      raise exception 'activity_log: id is not after the head' using errcode = 'check_violation';
    end if;
  end if;
  if new.at <> date_trunc('milliseconds', new.at) then
    raise exception 'activity_log: at must have millisecond precision' using errcode = 'check_violation';
  end if;
  expected := sha256(coalesce(new.prev_hash, ''::bytea) || convert_to(
    new.id::text || '|' ||
    to_char(new.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || '|' ||
    new.actor_kind || '|' ||
    coalesce(new.actor_id::text, '') || '|' ||
    coalesce(new.actor_role, '') || '|' ||
    coalesce(new.trade_code, '') || '|' ||
    new.action || '|' ||
    new.detail, 'UTF8'));
  if new.hash <> expected then
    raise exception 'activity_log: hash does not match the row' using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger activity_log_chain
  before insert on activity_log
  for each row execute function activity_log_chain();
