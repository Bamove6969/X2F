-- Plan 4 Task 24, D-011 (lead default; lead call 12 Nov 2026): when an appeal has nobody who may
-- review it (every senior moderator and the owner was involved in round 1, or the last eligible one
-- was switched off, removed or disabled), the owner is alerted once per transition into that state.
-- Set when the owner is alerted (at filing, or by the dispute timer); cleared by the timer once an
-- eligible reviewer exists again, so a later loss alerts again. Never shown to anyone.
alter table disputes add column no_reviewer_alerted_at timestamptz;
