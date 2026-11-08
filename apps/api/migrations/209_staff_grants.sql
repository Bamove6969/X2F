-- Owner Q60 (6 Nov 2026): reading feedback is a per-person checkbox for moderators and helpers
-- (senior moderators always read it, by role). `staff_members.grants` (202) may now also hold
-- `feedback.read`; still nothing else (RV5 m1: `can()` counts only GRANTABLE_PERMS in any case).
alter table staff_members drop constraint staff_members_grants_check;
alter table staff_members add constraint staff_members_grants_check check (grants <@ array['tickets.handle', 'feedback.read']::text[]);
