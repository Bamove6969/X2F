-- Plan 3, Task 3: the owner's settings (spec 11.6, owner 2026-10-24), one row per setting so the
-- owner can change each in Settings (Plan 4 builds that screen and logs every change). Values are
-- whole numbers in the unit the key names. Read by the API; a missing or out-of-range row means
-- the default. Plan 3 Task 1's starter-limit settings (Revision 2026-10-24) belong here too.
create table owner_settings (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{0,62}$'),
  value bigint not null,
  updated_at timestamptz not null
);

insert into owner_settings (key, value, updated_at) values
  -- An exchange rate is stale once its source's last good fetch is older than this.
  ('fx_stale_after_min', 60, now()),
  -- A fetched exchange rate further than this from the currency's last good value is refused.
  ('fx_sanity_pct', 10, now());
