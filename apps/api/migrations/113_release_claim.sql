-- Plan 3 Task 9 I/O, lead decision (b) of 2026-10-29: when the moderation service received a trade
-- party's sealed post-release info for the current settling episode (`release-claimed`). While set,
-- the signing window (settle_by) no longer returns the trade to settle_from; the trade stays
-- settling until the sweep is shown or the watcher's 6 h fallback escalates it. Numbered 113: 110
-- is reserved for disputes, 112 for Task 5's take.
alter table trades add column release_claimed_at timestamptz;
