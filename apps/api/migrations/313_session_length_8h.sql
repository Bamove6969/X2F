-- Session length choices (owner G23, 7 Nov 2026): traders choose 2, 4, 8 or 12 hours (8 replaces 6);
-- vendors keep 2, 6, 12 or 24. The column allows their union; the route checks the account type's
-- set (307's constraint, widened). A session that already chose 6 keeps it.
alter table sessions drop constraint sessions_length_hours;
alter table sessions
  add constraint sessions_length_hours check (length_hours is null or length_hours in (2, 4, 6, 8, 12, 24));
