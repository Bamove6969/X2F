-- Plan 5 Task 11 (review m3, 20 Nov 2026): a revoke keeps the approval on the row. `reviewer_id` and
-- `decided_at` stay the moderator who approved (or rejected) and when; a senior moderator's or the
-- owner's revoke is recorded in its own columns. Both are set together or not at all.
-- 751: after main's highest (750_training_curation.sql).
alter table past_reputation
  add column revoked_by uuid references accounts (id) on delete set null,
  add column revoked_at timestamptz,
  add constraint past_reputation_revoked_dated check (revoked_by is null or revoked_at is not null),
  add constraint past_reputation_revoked_status check (revoked_at is null or status = 'revoked');
