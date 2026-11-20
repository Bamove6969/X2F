-- Plan 5 Task 19 (Revision 2026-10-29b, owner): review disputes. The person a review is about can
-- dispute it with a required free-text reason (no reason list for now); from that moment it shows
-- "Under review" and counts in no figure (lead default, benefit of the doubt) until a moderator
-- (perm reputation.review) decides one of the owner's three outcomes:
--   - stands: the review counts again, as it was;
--   - comments-removed: the moderator removes the note, some phrases or some trade badges; the stars stay;
--   - removed: the review no longer shows or counts anywhere. Its row is kept, with `removed_at`, so
--     the decision can be checked (plan Task 19).
--
-- 1. reviews gains the two marks. 301's reviews_final trigger is replaced below so the API may set
--    them, and only as a decided dispute says.
alter table reviews
  add column removed_at timestamptz,
  add column comments_removed_at timestamptz;

-- 2. review_disputes: no trade code, no account name, so it survives the 30-day trade delete with its
--    review (reviews are permanent; 301 has no foreign key to trades). It goes only with its review
--    (an overturned trade's reviews are erased, R-011, and their disputes with them).
--    - reason_text: the subject's words (<= 1000). Shown to moderators only, never logged (plan
--      Task 19: "each step is logged without the note text").
--    - decision_reason: the moderator's reason (>= 20 characters, plan Task 19), moderators only.
--    - Lead default, owner question: ONE dispute per review, ever (unique review_id), not only one open
--      one. Otherwise a review a moderator let stand could be disputed again at once and be back
--      "Under review" for as long as the subject keeps disputing it.
create table review_disputes (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null unique references reviews (id) on delete cascade,
  reason_text text not null check (char_length(reason_text) between 1 and 1000),
  status text not null default 'open' check (status in ('open', 'stands', 'comments-removed', 'removed')),
  opened_at timestamptz not null,
  decided_by uuid references accounts (id),
  decided_at timestamptz,
  decision_reason text check (decision_reason is null or char_length(decision_reason) between 20 and 1000),
  check ((status = 'open') = (decided_at is null)),
  check ((decided_at is null) = (decided_by is null)),
  check ((decided_at is null) = (decision_reason is null))
);

create index review_disputes_open on review_disputes (opened_at, id) where status = 'open';

-- A decision is final: an open dispute may be decided once; a decided one never changes.
create function review_disputes_decide_once() returns trigger
  language plpgsql
  set search_path = pg_catalog
as $$
begin
  if old.status <> 'open' or new.status = 'open'
     or new.id <> old.id or new.review_id <> old.review_id or new.reason_text <> old.reason_text or new.opened_at <> old.opened_at then
    raise exception 'a review dispute is decided once' using errcode = 'integrity_constraint_violation';
  end if;
  return new;
end
$$;

create trigger review_disputes_decide_once
  before update on review_disputes
  for each row execute function review_disputes_decide_once();

-- The x2f_purge role deletes reviews (R-011 erase); the cascade to review_disputes runs as the
-- constraint's owner, so it needs no grant here.

-- 3. reviews_final, as 301 wrote it, plus the moderator's two writes (any role but x2f_purge, which
--    keeps exactly its 301 allowance):
--    - remove: removed_at from null to a time, nothing else changed, and the review's dispute is
--      decided `removed`;
--    - remove comments: comments_removed_at from null to a time; the note may become null, the phrases
--      and trade badges may each lose items (never gain or reorder one), at least one thing goes, the
--      stars and everything else stay, and the review's dispute is decided `comments-removed`.
--    The dispute row is written first, in the same transaction (apps/api/src/reviews/disputes.ts).
create or replace function reviews_final() returns trigger
  language plpgsql
  set search_path = pg_catalog
as $$
declare
  rest_old jsonb;
  rest_new jsonb;
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
    raise exception 'reviews are final' using errcode = 'integrity_constraint_violation';
  end if;
  if tg_op = 'UPDATE' then
    if old.removed_at is null and new.removed_at is not null
       and (to_jsonb(new) - 'removed_at') = (to_jsonb(old) - 'removed_at')
       and exists (select 1 from public.review_disputes d where d.review_id = old.id and d.status = 'removed') then
      return new;
    end if;
    rest_old := to_jsonb(old) - 'note' - 'phrases' - 'trade_badges' - 'comments_removed_at';
    rest_new := to_jsonb(new) - 'note' - 'phrases' - 'trade_badges' - 'comments_removed_at';
    if old.comments_removed_at is null and new.comments_removed_at is not null and old.removed_at is null
       and rest_new = rest_old
       and (new.note is null or new.note = old.note)
       and new.phrases <@ old.phrases and new.trade_badges <@ old.trade_badges
       and new.phrases = array(select p from unnest(old.phrases) with ordinality u (p, i) where p = any (new.phrases) order by i)
       and new.trade_badges = array(select b from unnest(old.trade_badges) with ordinality u (b, i) where b = any (new.trade_badges) order by i)
       and ((old.note is not null and new.note is null)
         or cardinality(new.phrases) < cardinality(old.phrases)
         or cardinality(new.trade_badges) < cardinality(old.trade_badges))
       and exists (select 1 from public.review_disputes d where d.review_id = old.id and d.status = 'comments-removed') then
      return new;
    end if;
  end if;
  raise exception 'reviews are final' using errcode = 'integrity_constraint_violation';
end
$$;
