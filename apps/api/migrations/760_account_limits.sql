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
  check (decided_by is null or decided_by <> recommended_by)
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
  recommendation_id uuid not null unique references limit_recommendations (id),
  created_at timestamptz not null,
  check ((cap_usd is null) <> (stage is null))
);
create index account_limits_account on account_limits (account_id);
