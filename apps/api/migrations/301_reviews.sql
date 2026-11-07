-- Plan 5, Task 3: reviews, Skip review, and the take-time USD value of a trade.
--
-- 1. trades.usd_cents: the trade's US-dollar value at take, in cents, the same number the take's
--    starter-limit check used (take.ts `usdCents`: the larger of the total and the XMR at market,
--    both converted at the take's market quote). Written once by the take and never changed; null
--    for trades taken before this migration or while the feed had no quote. It goes with the trade
--    when the trade is purged and is never returned by a route. Reviews do NOT use it (owner
--    2026-11-01: dollar amounts do not weight reviews); it is kept for the owner's opt-in "traded
--    to date" line (2026-11-01, same answer), the one thing that needs it.
alter table trades add column usd_cents bigint check (usd_cents is null or usd_cents >= 0);

create function trades_usd_fixed() returns trigger
  language plpgsql
  set search_path = pg_catalog
as $$
begin
  if new.usd_cents is distinct from old.usd_cents then
    raise exception 'a trade''s USD value never changes' using errcode = 'integrity_constraint_violation';
  end if;
  return new;
end
$$;

create trigger trades_set_once_usd
  before update on trades
  for each row execute function trades_usd_fixed();

-- 2. reviews: one per side per trade (spec 5.1). PERMANENT (owner 2026-10-29: reviews survive the
--    30-day trade delete), so a row holds everything it needs itself and has NO foreign key to
--    trades (Plan 5 Revision 2026-10-29; Task 20): the method and the review date. `trade_code` and
--    `reviewer_id` exist only for the rules that need them while the trade exists (one review per
--    side, the rate-first gate) and are nulled TOGETHER when the trade is purged (Revision
--    2026-10-29b: nothing may link a review to its reviewer or trade once the trade is gone). The
--    Plan 7 whole-trade purge must run `detachReviews` (apps/api/src/reviews/store.ts) as x2f_purge
--    before it deletes the trade row.
--
--    A review is stars + trade badges + pre-made phrases or a custom note, nothing else (owner
--    2026-11-01): no weight, no amount. It shows as soon as it is submitted (owner 2026-11-02: no
--    blind reveal), so no reveal anchor is stored either.
--
--    Names: no display name or login name is stored; the subject is an account id. Public readers
--    return stars, phrases, trade badges, the note, the method name and the month only.
create table reviews (
  id uuid primary key default gen_random_uuid(),
  -- No foreign key (see above). Unique per side while it is set.
  trade_code text check (trade_code is null or char_length(trade_code) between 1 and 64),
  reviewer_id uuid references accounts (id),
  subject_id uuid not null references accounts (id),
  -- The reviewer's side in the trade (from the trade row, never the request body).
  reviewer_role text not null check (reviewer_role in ('buyer', 'seller')),
  neutral boolean not null,
  stars smallint check (stars between 1 and 5),
  phrases text[] not null default '{}' check (cardinality(phrases) <= 8),
  trade_badges text[] not null default '{}' check (cardinality(trade_badges) <= 8),
  -- One line, at most 120 characters (P5-A6; @x2f/reputation REVIEW_NOTE_MAX).
  note text check (note is null or (char_length(note) between 1 and 120 and note !~ '[\n\r]')),
  method_id text not null check (char_length(method_id) between 1 and 64),
  created_at timestamptz not null,
  -- Neutral carries nothing else; a rated review has stars.
  check (case when neutral then stars is null and phrases = '{}' and trade_badges = '{}' and note is null else stars is not null end),
  -- Nulled together by the purge, never one without the other.
  check ((trade_code is null) = (reviewer_id is null)),
  check (reviewer_id is null or reviewer_id <> subject_id),
  unique (trade_code, reviewer_role)
);

create index reviews_subject on reviews (subject_id, created_at);
create index reviews_reviewer on reviews (reviewer_id) where reviewer_id is not null;

-- Reviews are final (P5-A6, owner 2026-10-29 "permanent"): UPDATE and DELETE are refused for every
-- role, including the table owner. x2f_purge alone may (a) detach a review when its trade is purged
-- (Plan 7 Task 2 / Plan 5 Task 20, `detachReviews` in apps/api/src/reviews/store.ts): null
-- trade_code and reviewer_id together and truncate created_at to its UTC month (owner 2026-11-01:
-- month and year after the self-destruct; review round 1 I2), changing nothing else, and (b) DELETE
-- (lead decision 2026-10-30; Task 19's review disputes keep a removed review's row with a mark of
-- their own and change this trigger in their migration). The comparison covers every other column,
-- so a column added later is protected too. A detached row (trade_code null) can never be updated.
create function reviews_final() returns trigger
  language plpgsql
  set search_path = pg_catalog
as $$
begin
  if current_user = 'x2f_purge' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    if old.trade_code is not null and new.trade_code is null and new.reviewer_id is null
       and new.created_at = date_trunc('month', old.created_at, 'UTC')
       and (to_jsonb(new) - 'trade_code' - 'reviewer_id' - 'created_at')
         = (to_jsonb(old) - 'trade_code' - 'reviewer_id' - 'created_at') then
      return new;
    end if;
  end if;
  raise exception 'reviews are final' using errcode = 'integrity_constraint_violation';
end
$$;

create trigger reviews_final
  before update or delete on reviews
  for each row execute function reviews_final();

create function reviews_no_truncate() returns trigger
  language plpgsql
  set search_path = pg_catalog
as $$
begin
  raise exception 'reviews are final' using errcode = 'integrity_constraint_violation';
end
$$;

create trigger reviews_no_truncate
  before truncate on reviews
  for each statement execute function reviews_no_truncate();

grant select, delete on reviews to x2f_purge;
grant update (trade_code, reviewer_id, created_at) on reviews to x2f_purge;

-- 3. review_skips: Skip review (owner 2026-11-01, item 28). A side that taps Skip is done with the
--    trade (the rate-first gate and the please-rate list leave it out) and leaves NO review: nothing
--    shows to anyone and nothing counts in a stat (owner 2026-11-02: Skip shows nothing). A row
--    names only the trade and the side, no account, and goes with the trade (on delete cascade), so
--    nothing of a skip outlives the 30-day trade delete.
create table review_skips (
  trade_code text not null references trades (code) on delete cascade,
  side text not null check (side in ('buyer', 'seller')),
  primary key (trade_code, side)
);

-- 4. The gate's cutoff (review round 1, M4): the time this migration was applied. A trade that
--    became reviewable before it never counts as a pending review (apps/api/src/reviews/gate.ts),
--    so traders with history are not blocked on deploy; such trades stay reviewable. The default is
--    evaluated once, for the existing single row.
alter table site_flags add column reviews_since timestamptz not null default now();
