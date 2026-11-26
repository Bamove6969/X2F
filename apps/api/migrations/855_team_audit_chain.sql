-- Team audit v2 (owner 26 Nov 2026: "the ability for them to audit what a team member has done, so
-- do a really good job at the audit tools"). Three things on top of migration 015's append-only log:
--
-- 1. Tamper-evident. Every row of an account's log is hash-chained to the row before it, per
--    account: hash = SHA-256(prev_hash || utf8(team_audit_line(row))). The database computes it
--    (the trigger below), so no code path can write a row outside the chain, and
--    `team_audit_verify` re-computes the whole chain. A changed, removed or inserted row breaks it
--    from that point. The account owner can keep a fingerprint (an entry id and its hash, or the
--    whole export) outside X2F and check later that it is still in the chain unchanged: that holds
--    even against someone who can disable this table's triggers, which no trigger alone can do
--    (migration 015's review M4).
--    A trade's code is still cleared when the trade is deleted (R36, migration 199). The chain
--    covers `trade_commit` (SHA-256 of the code, kept) instead of the code itself, so clearing the
--    code never breaks the chain, and a reader who still has the code can check it was this trade.
--
-- 2. Complete. The log also records, by triggers so no route can forget them:
--    - the team's own changes (category 'team'): a member invited, joined, their boxes changed (the
--      boxes added and removed), their trade-size band or working hours changed, removed, or an
--      invite that ran out;
--    - access (category 'access'): each member login (the session's device label, chosen by the
--      member's own browser) and each end of a member session;
--    - refused attempts (category 'access', action 'attempt-refused'), written by the API when a
--      member's request is refused for lack of a box, outside their hours or outside their band.
--    Member work (category 'work') is what migration 015 already logged.
--
-- 3. Who acted: `actor_kind` 'member' (member_id is the member), 'lead' (the account owner) or
--    'system' (X2F itself: an expired invite, a session that ended). `subject_id` is the member a
--    team or access row is about.
--
-- Nothing here holds an IP address, user agent, wallet address, key or payment detail.

alter table team_audit
  add column actor_kind text,
  -- No foreign key: a member row is never deleted while its account lives, and the log must outlast one anyway.
  add column subject_id uuid,
  add column category text,
  add column trade_commit bytea,
  add column prev_hash bytea,
  add column hash bytea;

update team_audit set actor_kind = case when member_id is null then 'lead' else 'member' end;
update team_audit set category = 'work';
update team_audit set subject_id = member_id where member_id is not null;
update team_audit set trade_commit = sha256(convert_to(trade_code, 'UTF8')) where trade_code is not null;

alter table team_audit drop constraint team_audit_lead_actions;
alter table team_audit
  alter column actor_kind set not null,
  alter column category set not null,
  add constraint team_audit_actor_kind check (actor_kind in ('member', 'lead', 'system')),
  add constraint team_audit_actor_member check ((actor_kind = 'member') = (member_id is not null)),
  add constraint team_audit_category check (category in ('work', 'team', 'access')),
  add constraint team_audit_commit check (trade_commit is null or octet_length(trade_commit) = 32),
  add constraint team_audit_hash check (hash is null or octet_length(hash) = 32);

create index team_audit_subject on team_audit (subject_id, at) where subject_id is not null;
create index team_audit_account_id on team_audit (account_id, id);

-- The text a row's hash covers: id | at (UTC, milliseconds) | actor_kind | member_id | subject_id |
-- category | action | hex(trade_commit) | detail (jsonb's own text, which is canonical: keys
-- sorted). Nulls are empty strings. The export hands each row's line out, so anyone can re-check
-- sha256(prev_hash || line) = hash without X2F's code.
create function team_audit_line(r team_audit) returns text
  language sql immutable
  set search_path = pg_catalog
as $$
  select r.id::text || '|' ||
    to_char(r.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || '|' ||
    r.actor_kind || '|' ||
    coalesce(r.member_id::text, '') || '|' ||
    coalesce(r.subject_id::text, '') || '|' ||
    r.category || '|' ||
    r.action || '|' ||
    coalesce(encode(r.trade_commit, 'hex'), '') || '|' ||
    r.detail::text
$$;

-- Backfill the chain for the rows already there, account by account in id order. The append-only
-- trigger is off only inside this migration's transaction.
alter table team_audit disable trigger team_audit_append_only;
do $$
declare
  r team_audit;
  last_account uuid := null;
  prev bytea := null;
begin
  for r in select * from team_audit order by account_id, id loop
    if last_account is distinct from r.account_id then
      prev := null;
      last_account := r.account_id;
    end if;
    update team_audit set prev_hash = prev, hash = sha256(coalesce(prev, ''::bytea) || convert_to(team_audit_line(r), 'UTF8'))
     where id = r.id
     returning hash into prev;
  end loop;
end
$$;
alter table team_audit enable trigger team_audit_append_only;
alter table team_audit alter column hash set not null;

-- One child per row per account, and one first row per account: two inserts can never both
-- extend the same head (a fork), even outside the trigger's lock.
create unique index team_audit_one_child on team_audit (account_id, (coalesce(prev_hash, '\x'::bytea)));

-- Fills in the derived columns and links the new row to its account's head. The account's
-- advisory lock serialises appends per account; under any isolation level other than READ
-- COMMITTED the head read could be stale, and the unique index above refuses the fork.
create function team_audit_chain() returns trigger
  language plpgsql
  set search_path = pg_catalog, public
as $$
declare
  head bytea;
begin
  if new.actor_kind is null then
    new.actor_kind := case when new.member_id is null then 'lead' else 'member' end;
  end if;
  if new.category is null then
    new.category := 'work';
  end if;
  if new.subject_id is null and new.member_id is not null then
    new.subject_id := new.member_id;
  end if;
  new.at := date_trunc('milliseconds', new.at);
  new.trade_commit := case when new.trade_code is null then null else sha256(convert_to(new.trade_code, 'UTF8')) end;
  perform pg_advisory_xact_lock(7240002, hashtext(new.account_id::text));
  select l.hash into head from team_audit l where l.account_id = new.account_id order by l.id desc limit 1;
  new.prev_hash := head;
  new.hash := sha256(coalesce(head, ''::bytea) || convert_to(team_audit_line(new), 'UTF8'));
  return new;
end
$$;

create trigger team_audit_chain
  before insert on team_audit
  for each row execute function team_audit_chain();

-- The one update still allowed: clearing trade_code (R36), every other column unchanged.
create or replace function team_audit_append_only() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    -- The cascade from deleting the account has already removed the account row.
    if exists (select 1 from accounts where id = old.account_id) then
      raise exception 'team_audit is append-only';
    end if;
    return old;
  end if;
  if new.trade_code is null and old.trade_code is not null
     and new.id = old.id and new.account_id = old.account_id and new.member_id is not distinct from old.member_id
     and new.at = old.at and new.action = old.action and new.detail = old.detail
     and new.actor_kind = old.actor_kind and new.subject_id is not distinct from old.subject_id
     and new.category = old.category and new.trade_commit is not distinct from old.trade_commit
     and new.prev_hash is not distinct from old.prev_hash and new.hash = old.hash then
    return new;
  end if;
  raise exception 'team_audit is append-only';
end
$$;

-- Re-computes an account's chain. ok is false at the first row whose link or hash is wrong
-- (`broken_at`); `entries` counts the rows checked, and the head is the last good row.
create function team_audit_verify(acct uuid)
  returns table (ok boolean, entries bigint, broken_at bigint, head_id bigint, head_hash bytea)
  language plpgsql stable
  set search_path = pg_catalog, public
as $$
declare
  r team_audit;
  prev bytea := null;
  n bigint := 0;
  last_id bigint := null;
begin
  for r in select * from team_audit l where l.account_id = acct order by l.id loop
    if r.prev_hash is distinct from prev
       or r.hash is distinct from sha256(coalesce(prev, ''::bytea) || convert_to(team_audit_line(r), 'UTF8')) then
      return query select false, n, r.id, last_id, prev;
      return;
    end if;
    n := n + 1;
    prev := r.hash;
    last_id := r.id;
  end loop;
  return query select true, n, null::bigint, last_id, prev;
end
$$;

-- No foreign key from the log to accounts. A key check takes a KEY SHARE lock on the account
-- row, and a trigger below writes the log while holding a team_members row lock; a member action
-- that holds the account row FOR UPDATE (posting an offer) and then reads its member row FOR SHARE
-- would deadlock with it. The account's rows go with the account through the trigger below
-- instead, exactly as the cascade did (the append-only rule lets a row go once its account is gone).
alter table team_audit drop constraint team_audit_account_id_fkey;

create function team_audit_account_gone() returns trigger
  language plpgsql
  set search_path = pg_catalog, public
as $$
begin
  delete from team_audit where account_id = old.id;
  return old;
end
$$;

create trigger team_audit_account_gone
  after delete on accounts
  for each row execute function team_audit_account_gone();

-- ---- The team's own changes, logged by the database (category 'team') ----

create function team_audit_member_change() returns trigger
  language plpgsql
  set search_path = pg_catalog, public
as $$
declare
  t timestamptz := clock_timestamp();
  added text[];
  removed text[];
begin
  -- The account is being deleted (cascade): its log goes with it.
  if not exists (select 1 from accounts where id = new.account_id) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    insert into team_audit (account_id, member_id, actor_kind, subject_id, category, at, action, detail)
    values (new.account_id, null, 'lead', new.id, 'team', t, 'member-invited',
            jsonb_build_object('name', new.display_name, 'abilities', to_jsonb(new.abilities),
                               'assistantNo', new.assistant_no, 'inviteExpiresAt', new.invite_expires_at));
    return new;
  end if;
  if old.joined_at is null and new.joined_at is not null then
    insert into team_audit (account_id, member_id, actor_kind, subject_id, category, at, action, detail)
    values (new.account_id, new.id, 'member', new.id, 'team', t, 'member-joined', jsonb_build_object('name', new.display_name));
  end if;
  if old.abilities is distinct from new.abilities then
    added := array(select unnest(new.abilities) except select unnest(old.abilities) order by 1);
    removed := array(select unnest(old.abilities) except select unnest(new.abilities) order by 1);
    insert into team_audit (account_id, member_id, actor_kind, subject_id, category, at, action, detail)
    values (new.account_id, null, 'lead', new.id, 'team', t, 'abilities-changed',
            jsonb_build_object('added', to_jsonb(added), 'removed', to_jsonb(removed), 'abilities', to_jsonb(new.abilities)));
  end if;
  if old.band_min_atomic is distinct from new.band_min_atomic or old.band_max_atomic is distinct from new.band_max_atomic
     or old.hours is distinct from new.hours then
    insert into team_audit (account_id, member_id, actor_kind, subject_id, category, at, action, detail)
    values (new.account_id, null, 'lead', new.id, 'team', t, 'limits-changed',
            jsonb_build_object(
              'before', jsonb_build_object('bandMinAtomic', old.band_min_atomic::text, 'bandMaxAtomic', old.band_max_atomic::text, 'hours', old.hours),
              'after', jsonb_build_object('bandMinAtomic', new.band_min_atomic::text, 'bandMaxAtomic', new.band_max_atomic::text, 'hours', new.hours)));
  end if;
  if old.removed_at is null and new.removed_at is not null then
    insert into team_audit (account_id, member_id, actor_kind, subject_id, category, at, action, detail)
    values (new.account_id, null,
            -- An invite nobody used, closed by the leftovers job, is X2F's doing, not the lead's.
            case when new.joined_at is null and new.invite_expires_at <= new.removed_at then 'system' else 'lead' end,
            new.id, 'team', t,
            case when new.joined_at is null then 'invite-closed' else 'member-removed' end,
            jsonb_build_object('name', new.display_name));
  end if;
  return new;
end
$$;

create trigger team_audit_member_change
  after insert or update on team_members
  for each row execute function team_audit_member_change();

-- ---- Member access, logged by the database (category 'access') ----

create function team_audit_session_change() returns trigger
  language plpgsql
  set search_path = pg_catalog, public
as $$
begin
  if new.member_id is null or not exists (select 1 from accounts where id = new.account_id) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    insert into team_audit (account_id, member_id, actor_kind, subject_id, category, at, action, detail)
    values (new.account_id, new.member_id, 'member', new.member_id, 'access', new.created_at, 'member-login',
            jsonb_build_object('session', left(new.id::text, 8), 'device', new.device_label));
  elsif old.revoked_at is null and new.revoked_at is not null then
    insert into team_audit (account_id, member_id, actor_kind, subject_id, category, at, action, detail)
    values (new.account_id, null, 'system', new.member_id, 'access', new.revoked_at, 'session-ended',
            jsonb_build_object('session', left(new.id::text, 8), 'device', new.device_label));
  end if;
  return new;
end
$$;

create trigger team_audit_session_change
  after insert or update of revoked_at on sessions
  for each row execute function team_audit_session_change();
