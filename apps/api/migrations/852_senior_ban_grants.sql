-- Owner 26 Nov 2026: placing a ban and lifting one are two boxes per senior moderator (off unless
-- the owner ticks them); the owner holds both by role. The API counts them for a senior only.
alter table staff_members drop constraint staff_members_grants_check;
alter table staff_members add constraint staff_members_grants_check
  check (grants <@ array['tickets.handle', 'feedback.read', 'accounts.ban', 'accounts.unban']::text[]);
