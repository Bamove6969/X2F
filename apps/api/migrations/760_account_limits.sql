-- Plan 4 Task 26 (Revision 2026-10-29, owner): no automatic stage drop for a lost dispute. A
-- moderator recommends account limits for a habitual offender or an obvious hit-and-run case, with
-- a reason a senior moderator or the owner reads (staff only: never shown to the trader, never in
-- the activity log); a senior moderator or the owner, never the one who recommended them, approves
-- or declines with a security-key tap. An approved recommendation becomes an `account_limits` row,
-- which `tradeCap` reads: the account's cap is the lower of its stage's and the limit's.
-- Each limit is either a cap in whole US dollars or a stage (Starter or Building) the account is
-- held to, never both.
create table limit_recommendations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts (id),
  cap_usd integer check (cap_usd between 1 and 1000000),
  stage text check (stage in ('starter', 'building')),
  reason text not null check (char_length(reason) between 40 and 2000),
  -- The case the moderator recommended it from, if any (the ModCase action).
  from_code text,
  recommended_by uuid not null references accounts (id),
  created_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  decided_by uuid references accounts (id),
  decided_at timestamptz,
  check ((cap_usd is null) <> (stage is null)),
  check ((status = 'pending') = (decided_by is null) and (decided_by is null) = (decided_at is null)),
  check (decided_by is null or decided_by <> recommended_by),
  -- Review m6: `account_limits` names its recommendation together with the account.
  unique (id, account_id)
);
-- One recommendation waits per account at a time (lead default).
create unique index limit_recommendations_one_pending on limit_recommendations (account_id) where status = 'pending';

create table account_limits (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts (id),
  cap_usd integer check (cap_usd between 1 and 1000000),
  stage text check (stage in ('starter', 'building')),
  -- Lead default, owner question: no end time is set yet (null = until lifted), and no route lifts one yet.
  until timestamptz,
  set_by uuid not null references accounts (id),
  recommendation_id uuid not null unique,
  created_at timestamptz not null,
  check ((cap_usd is null) <> (stage is null)),
  foreign key (recommendation_id, account_id) references limit_recommendations (id, account_id)
);
create index account_limits_account on account_limits (account_id);

-- Review m6: a decided recommendation never changes (its decision is the record), and a limit
-- exists only for an approved recommendation, with exactly its cap or stage.
create function limit_recommendations_decided_fixed() returns trigger language plpgsql as $$
begin
  if old.status <> 'pending' then
    raise exception 'limit_recommendations: a decided recommendation cannot change' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger limit_recommendations_decided_fixed before update on limit_recommendations
  for each row execute function limit_recommendations_decided_fixed();

create function account_limits_match_recommendation() returns trigger language plpgsql as $$
declare r limit_recommendations%rowtype;
begin
  select * into r from limit_recommendations where id = new.recommendation_id;
  if not found or r.status <> 'approved' or r.account_id <> new.account_id
     or r.cap_usd is distinct from new.cap_usd or r.stage is distinct from new.stage or r.decided_by <> new.set_by then
    raise exception 'account_limits: the limit must match its approved recommendation' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger account_limits_match_recommendation before insert or update on account_limits
  for each row execute function account_limits_match_recommendation();

-- Owner rule p5-7: an approved limit is a change to the account, so it sends the account's Jabber
-- notice like a lien or a freeze (lead default, owner p11-119 pattern; owner may change). A pending
-- recommendation is staff-only and sends nothing (apps/api/src/jabber/changePaths.ts).
create trigger jabber_note_change after insert or update or delete on account_limits for each row
  execute function jabber_note_change('account_id');
