-- Owner order 2 Nov 2026 (relayed by the lead): imported past reputation counts toward the traded
-- total ("Completed over $X") ONLY through a dollar figure a moderator verified. Null = not verified,
-- and an unverified or dead (rejected, removed, revoked) claim adds nothing.
--
-- `verified_usd_cents` is whole US cents. Only `setVerifiedPastRepUsd` (apps/api/src/pastrep/store.ts)
-- writes it; the moderator route and screen are Plan 4's (tripwire NEEDS_P4_PASTREP_VERIFIED_USD).
-- The traded total reads `verifiedPastRepUsdCents` (C12's tradedTotal.ts must add it). As a second
-- line, the trigger below refuses a figure not set by an enabled staff account or the owner, with a
-- time. Owner 2026-11-02: only senior moderators and the owner may enter it; staff roles are not in
-- the database on this branch (Plan 4 Task 4's staff_members), so the role check is the seam's
-- (PASTREP_VERIFY_ROLES), and Plan 4's staff route passes req.staff.role to it.
-- 310: 301-305 are named in Plan 5, 306-309 are taken on other branches.
alter table past_reputation
  add column verified_usd_cents bigint check (verified_usd_cents > 0),
  add column verified_usd_by uuid references accounts (id) on delete set null,
  add column verified_usd_at timestamptz,
  add constraint past_reputation_verified_usd_cleared
    check (verified_usd_cents is not null or (verified_usd_by is null and verified_usd_at is null)),
  add constraint past_reputation_verified_usd_dated
    check (verified_usd_cents is null or verified_usd_at is not null);

create function past_reputation_verified_usd_by_staff() returns trigger language plpgsql as $$
begin
  if new.verified_usd_cents is null then
    return new;
  end if;
  -- A staff account's deletion only nulls `verified_usd_by` (on delete set null): let that through.
  if tg_op = 'UPDATE' and new.verified_usd_cents is not distinct from old.verified_usd_cents
     and new.verified_usd_at is not distinct from old.verified_usd_at then
    return new;
  end if;
  if new.verified_usd_at is null or new.verified_usd_by is null or not exists (
    select 1 from accounts where id = new.verified_usd_by and kind in ('staff', 'owner') and disabled_at is null
  ) then
    raise exception 'past_reputation: a verified dollar figure is set only by a moderator or the owner'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

create trigger past_reputation_verified_usd_by_staff
  before insert or update of verified_usd_cents, verified_usd_by, verified_usd_at on past_reputation
  for each row execute function past_reputation_verified_usd_by_staff();
