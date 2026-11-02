-- Session length chosen at every login, and "Stay logged in?" (owner, 2 Nov 2026; boards
-- SessionLength, SessionExtend, Devices). Replaces the account-wide logout timer of 010.

-- 1. Each session carries the length its person chose (null until chosen: the session then lasts
--    the shortest choice, 2 hours) and when its current period started (the login, or the last
--    "Stay logged in"). A full trader session ends at expires_at = period_started_at + its length;
--    using it never moves that, and there is no fixed maximum. The allowed hours depend on the
--    account type (traders 2, 4, 6, 12; vendors 2, 6, 12, 24), checked by the route; the column
--    allows their union.
alter table sessions
  add column length_hours smallint
    constraint sessions_length_hours check (length_hours is null or length_hours in (2, 4, 6, 12, 24)),
  add column period_started_at timestamptz;
update sessions set period_started_at = created_at;
-- openSession always sets it; the default only covers a row inserted by hand.
alter table sessions alter column period_started_at set not null, alter column period_started_at set default now();

-- 2. The logout timer is retired. Live sessions keep the deadline they have; from now on using
--    them no longer moves it. A logout-timer change waiting out a hold is dropped when it settles
--    (auth/hold.ts).
alter table accounts drop column idle_hours;
