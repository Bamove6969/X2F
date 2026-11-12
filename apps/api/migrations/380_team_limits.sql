-- J-20 (owner p7-4 / S-091, p7-11 / S-096, p11-27 / S-107; Plan 2 Task 18, Plan 3 Task 42): the
-- limits a team lead puts on each member, on top of the boxes (migration 360).
--
-- Trade-size band (p7-4: "this team member can deal with trades from this size to this size ...
-- that will have a lasting effect through all the other features you're giving them"): the
-- smallest and largest trade, in XMR atomic units (design TP4 option A; the unit is listed for the
-- owner's review), every effectful member action on a trade or an offer must fall inside
-- (team/limits.ts). Both null: no band (design TP4 A: "With no limit set, there's no cap").
alter table team_members
  add column band_min_atomic numeric(30, 0),
  add column band_max_atomic numeric(30, 0),
  add constraint team_members_band check (
    (band_min_atomic is null and band_max_atomic is null)
    or (band_min_atomic is not null and band_max_atomic is not null and band_min_atomic >= 0 and band_max_atomic > 0 and band_max_atomic >= band_min_atomic)
  );

-- Working hours (p7-11: "24 hours a day, 7 days a week, or ... days, hours, etc."): the staff app's
-- LoginHours (@x2f/staff, migration 202): the string "any" or { days, start, end, tz }, checked by
-- `validateHours` before every write and again on every read (an invalid stored value fails
-- closed: the member is outside their hours). New members start with "any" (design TP11 A).
alter table team_members
  add column hours jsonb not null default '"any"'::jsonb
    check (hours = '"any"'::jsonb or jsonb_typeof(hours) = 'object');

-- First login (p11-27, replacing p7-10's first-login approval): the lead is told when a member logs
-- in for the first time. Members who already joined have logged in (their join starts their first
-- session), so they are marked now and never raise the alert.
alter table team_members add column first_login_at timestamptz;

-- The secure Jabber notice of a first login (p11-27: "a notification and even a Jabber
-- notification"; review F4): a notice kind of its own through jabber-notices' outbox (migration
-- 331), queued by the login itself in its transaction (auth/sessions.ts), behind the same opt-in
-- (and so as dark as the rest of jabber-notices). Its fixed sentence names no member
-- (jabber/sender.ts TEAM_FIRST_LOGIN_TEXT). first_login_at is therefore bookkeeping for the
-- account-change trigger (jabber/changePaths.ts), so the first login is not also told as an
-- account change; the band and hours are changes, as every other column of team_members.
alter table jabber_outbox drop constraint jabber_outbox_kind_check;
alter table jabber_outbox add constraint jabber_outbox_kind_check
  check (kind in ('account-change', 'trade-attention', 'team-member-first-login'));
drop trigger jabber_note_change on team_members;
create trigger jabber_note_change after insert or update or delete on team_members for each row
  execute function jabber_note_change('account_id', 'first_login_at');

-- The backfill runs only now, after the trigger above treats first_login_at as bookkeeping
-- (review N1, 12 Nov): with 331's trigger still in place it told every team with Jabber on and a
-- joined member that "an account change was made", for a change nobody made.
update team_members set first_login_at = joined_at where joined_at is not null;
