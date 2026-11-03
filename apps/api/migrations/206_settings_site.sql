-- Plan 4, Task 8: the owner's settings and the site controls (emergency stop, banner, maintenance).
-- Numbers assigned by the coordinator 2026-11-02: Task 4 202, Task 5 203, Task 6 204, Task 7 205,
-- Task 8 206.
--
-- `settings` is the plan's one-row table of the settings that bind disputes and the moderation
-- gate. The plan's pay columns (pay_senior_case_usd, pay_mod_case_usd, pay_helper_month_usd) are
-- left out: Revision 2026-10-29c replaces them with Task 33's pay settings. Revision 2026-10-29
-- adds the moderator contact link (Matrix preferred, Telegram allowed) and the community links
-- (Task 29); unset means "not set", and the screens that show them leave the link out.
-- `limits_tap_id` is the security-key tap that authorised the current large-trade limit and appeal
-- window (null while both are the defaults); the moderation process can re-verify it (Task 13).
-- Plan 3's starter-limit and exchange-rate settings stay rows of owner_settings (109).
create table settings (
  id int primary key default 1 check (id = 1),
  large_trade_limit_usd int not null default 1000 check (large_trade_limit_usd between 1 and 1000000),
  first_response_h int not null default 4 check (first_response_h between 1 and 72),
  appeal_window_h int not null default 48 check (appeal_window_h between 12 and 168),
  limits_tap_id uuid references key_taps (id),
  moderator_contact_url text check (moderator_contact_url ~ '^https://[^\s]{1,190}$'),
  community_matrix_url text check (community_matrix_url ~ '^https://[^\s]{1,190}$'),
  community_telegram_url text check (community_telegram_url ~ '^https://[^\s]{1,190}$'),
  updated_at timestamptz
);

insert into settings default values;

-- The site controls on Plan 3's one-row site_flags (102): `trading_paused` stays the emergency
-- stop's switch and `maintenance_since` the maintenance switch that pauses every trade timer
-- (Plan 3 Task 9's timer loop; Task 10 shifts dispute deadlines, A7).
-- - banner_text / banner_kind: the 140-character banner at the top of every trader screen; both
--   set or both null.
-- - maintenance_message / maintenance_kind: the owner's message on the Maintenance screen and
--   which of the two versions it is (Revision 2026-10-29b: planned, announced ahead in News and the
--   banner; emergency, "back soon"); both only while maintenance is on.
-- - stopped_at: when the emergency stop went on (null while trading runs).
-- - log_alarm: set only by the moderation process when the activity log's checkpoints disagree
--   (Task 14); nothing in the API writes it.
alter table site_flags
  add column banner_text text check (char_length(banner_text) between 1 and 140),
  add column banner_kind text check (banner_kind in ('info', 'warning')),
  add column maintenance_message text check (char_length(maintenance_message) <= 500),
  add column maintenance_kind text check (maintenance_kind in ('planned', 'emergency')),
  add column stopped_at timestamptz,
  add column log_alarm timestamptz,
  add constraint site_flags_banner_whole check ((banner_text is null) = (banner_kind is null)),
  -- Plan 3 code and tests may set maintenance_since alone: a missing kind reads as emergency.
  add constraint site_flags_maintenance_whole check (
    maintenance_since is not null or (maintenance_kind is null and maintenance_message is null)
  ),
  add constraint site_flags_stopped check (stopped_at is null or trading_paused);
