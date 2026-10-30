-- Plan 5, Task 3: reviews with blind reveal, and the take-time USD value their weight comes from.
--
-- 1. trades.usd_cents: the trade's US-dollar value at take, in cents, the same number the take's
--    starter-limit check used (take.ts `usdCents`: the larger of the total and the XMR at market,
--    both converted at the take's market quote). Written once by the take and never changed; null
--    for trades taken before this migration or while the feed had no quote (their reviews weigh the
--    floor, @x2f/reputation `reviewWeight(null)`). It goes with the trade when the trade is purged.
--    It is read only to compute a review's weight at review time and is never returned by a route.
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

-- 2. reviews: one per side per trade (spec 5.1, 5.3). PERMANENT (owner 2026-10-29: reviews survive
--    the 30-day trade delete), so a row holds everything it needs itself and has NO foreign key to
--    trades (Plan 5 Revision 2026-10-29; Task 20): the method, the weight, when the trade became
--    reviewable and the review date. `trade_code` and `reviewer_id` exist only for the rules that
--    need them while the trade exists (blind reveal, one review per side, the rate-first gate) and
--    are nulled TOGETHER when the trade is purged (Revision 2026-10-29b: nothing may link a review
--    to its reviewer or trade once the trade is gone). The Plan 7 whole-trade purge must run
--    `detachReviews` (apps/api/src/reviews/store.ts) as x2f_purge before it deletes the trade row.
--
--    A review stores ONLY its weight (@x2f/reputation `reviewWeight` of trades.usd_cents at review
--    time; lead decision 2026-10-30, reputation review M1), never a USD amount: no column here holds
--    money. Switching the weight mode later applies to new reviews only.
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
  weight bigint not null check (weight >= 1),
  method_id text not null check (char_length(method_id) between 1 and 64),
  -- When the trade became reviewable (the release, or the dispute's close): the blind reveal's anchor.
  reviewable_since timestamptz not null,
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
-- trade_code and reviewer_id together and coarsen the two times (review round 1, I2), changing
-- nothing else, and (b) DELETE (lead decision 2026-10-30; Task 19's review disputes keep a removed
-- review's row with a mark of their own and change this trigger in their migration). The comparison
-- covers every other column, so a column added later is protected too.
--
-- Coarsening, for one unit u of day, week or month (UTC; the app's REVIEW_DETACH_GRANULARITY):
-- created_at becomes date_trunc(u, created_at); reviewable_since becomes date_trunc(u, ...) only
-- once its 7-day reveal deadline (@x2f/reputation REVEAL_AFTER_DAYS) has passed, otherwise it is
-- rounded UP to a unit start, so the reveal is never brought forward. A detached row (trade_code
-- null) can never be updated again.
create function reviews_final() returns trigger
  language plpgsql
  set search_path = pg_catalog
as $$
declare
  u text;
  down timestamptz;
begin
  if current_user = 'x2f_purge' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    if old.trade_code is not null and new.trade_code is null and new.reviewer_id is null
       and (to_jsonb(new) - 'trade_code' - 'reviewer_id' - 'created_at' - 'reviewable_since')
         = (to_jsonb(old) - 'trade_code' - 'reviewer_id' - 'created_at' - 'reviewable_since') then
      foreach u in array array['day', 'week', 'month'] loop
        down := date_trunc(u, old.reviewable_since, 'UTC');
        if new.created_at = date_trunc(u, old.created_at, 'UTC')
           and (case
                  when old.reviewable_since + interval '7 days' <= now() then new.reviewable_since = down
                  when down = old.reviewable_since then new.reviewable_since = old.reviewable_since
                  else new.reviewable_since = down + ('1 ' || u)::interval
                end) then
          return new;
        end if;
      end loop;
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
grant update (trade_code, reviewer_id, created_at, reviewable_since) on reviews to x2f_purge;

-- 3. The gate's cutoff (review round 1, M4): the time this migration was applied. A trade that
--    became reviewable before it never counts as a pending review (apps/api/src/reviews/gate.ts),
--    so traders with history are not blocked on deploy; such trades stay reviewable. The default is
--    evaluated once, for the existing single row.
alter table site_flags add column reviews_since timestamptz not null default now();
