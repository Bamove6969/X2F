-- The idle reminder (owner, Q75, 6 Nov 2026): in their own settings a person may turn on a reminder
-- after some minutes without activity, and pick the interval. Off (null) by default. A reminder
-- only: it never logs anyone out and never moves a session's end. A team member's is their own,
-- stored on their member login account. The route checks the choices (IDLE_REMINDER_MINUTES in
-- @x2f/accounts); the column allows the same set.
alter table accounts
  add column idle_reminder_minutes smallint
    constraint accounts_idle_reminder_minutes check (idle_reminder_minutes is null or idle_reminder_minutes in (10, 15, 30, 60, 120));
