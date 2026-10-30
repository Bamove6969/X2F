-- Plan 5, Task 4 (P5-A19, spec 5.2): platform feedback, the one-tap "How's X2F doing?" prompt
-- shown after a completed trade. A mood and an optional short note.
--
-- Unlinkable by design: NO account column, no session, no device, no address and no time of day.
-- Only the day the row arrived is kept, and the id is random (no sequence that orders rows), so a
-- row cannot be lined up with a session's activity. The per-account limit of 3 a day is counted in
-- the API process's memory only. Rows are deleted after 365 days (purgeFeedback).
-- Residuals (docs/coordination.md, Plan 5 Task 4): Postgres insertion order (xmin/ctid), and on a
-- quiet day the one account that reached its 1st or 10th completed trade can be guessed from the date.
create table platform_feedback (
  id uuid primary key default gen_random_uuid(),
  mood text not null check (mood in ('great', 'ok', 'needs-work')),
  note text check (char_length(note) between 1 and 500),
  created_on date not null
);

create index platform_feedback_created on platform_feedback (created_on);
