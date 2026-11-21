-- Plan 5 Task 5: badge settings, and Task 12's "Show on my profile" for the signed record.
--
-- Badges are EARNED, never set (spec 5.4): they are computed from records on every read
-- (@x2f/reputation earnedBadges). No row here can grant one. The only badge write is visibility:
-- which earned badges are Featured (at most 2, New taking one while it shows), On hover (the "+N"
-- list) or Hidden. New can't be hidden or moved; the readers enforce that whatever a row says
-- (@x2f/reputation resolveVisibility), so a forced `{"new": "hidden"}` changes nothing.
--
-- - chosen: false until the trader saves a first choice; until then the spec 5.4 defaults apply.
-- - levels: badge id -> 'featured' | 'hover' | 'hidden'. Ids the catalogue no longer knows are
--   ignored by the readers.
-- - featured_order: the Featured badges, oldest first (featuring a third bumps the oldest).
-- - portable_public: Task 12's signed reputation record is private by default (P5-A18); true shows
--   it at GET /v1/traders/:name/record (never with PGP fingerprints, P5-A35).
-- - updated_at: when the row last changed. Never returned by a route.
--
-- A row holds no badge, number, name or link; one row per account, created on the first save.
create table badge_prefs (
  account_id uuid primary key references accounts (id) on delete cascade,
  chosen boolean not null default false,
  levels jsonb not null default '{}' check (jsonb_typeof(levels) = 'object'),
  featured_order text[] not null default '{}' check (cardinality(featured_order) <= 16),
  portable_public boolean not null default false,
  updated_at timestamptz not null
);
