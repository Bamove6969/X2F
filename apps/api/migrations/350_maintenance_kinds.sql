-- J-04 (owner G19, 7 Nov 2026; register W-004). Numbers 350-354 are J-04's (owner-answers
-- assignments, section 1).
--
-- "Maintenance notices do not default to emergency ... that is only known internally." The two
-- kinds are planned and unplanned; "emergency" is no kind any more. A stored emergency, and a
-- maintenance switched on with no kind (Plan 3 code could set maintenance_since alone; 206 read
-- that as emergency), become unplanned: nobody announced them. From here a maintenance always has
-- its kind.
--
-- - maintenance_back_by: when it should be back. Unplanned: "our best guess as to when we hope to
--   have it back up" (optional). Planned: the plan's end. Only while maintenance is on.
-- - planned_start / planned_end / planned_message: a planned maintenance announced ahead ("we will
--   plan it and try and give 24-hour notice"), shown to every visitor with its start and end until
--   it ends or is switched on. The message has the maintenance message's 500 characters.
alter table site_flags drop constraint site_flags_maintenance_kind_check;

-- The old check allows only planned and emergency, so it goes first.
update site_flags set maintenance_kind = 'unplanned'
  where maintenance_kind = 'emergency' or (maintenance_since is not null and maintenance_kind is null);

alter table site_flags
  add constraint site_flags_maintenance_kind_check check (maintenance_kind in ('planned', 'unplanned')),
  add constraint site_flags_maintenance_has_kind check (maintenance_since is null or maintenance_kind is not null),
  add column maintenance_back_by timestamptz,
  add column planned_start timestamptz,
  add column planned_end timestamptz,
  add column planned_message text check (char_length(planned_message) between 1 and 500),
  add constraint site_flags_back_by check (maintenance_back_by is null or maintenance_since is not null),
  add constraint site_flags_planned_whole check (
    (planned_start is null) = (planned_end is null) and (planned_message is null or planned_start is not null)
  ),
  add constraint site_flags_planned_order check (planned_end > planned_start);
