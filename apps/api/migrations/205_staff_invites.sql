-- Plan 4, Task 7: staff invites, removing a staff member, and the owner's protections.
-- (Numbers assigned by the coordinator 2026-11-02: Task 4 202, Task 5 203, Task 6 204, Task 7 205,
-- Task 8 206.)
--
-- An invite is created by the owner with a security-key tap (`create-invite`, Task 5) bound to its
-- id, role, token hash and expiry. The token itself is never stored: only its SHA-256 (hex), so the
-- link works only for whoever holds it. It works until it is used, cancelled or past `expires_at`
-- (24 hours). `account_id` is the invitee's login account once they pick their names; it stays
-- disabled until `finish` (used_at set), so a half-finished sign-up can never log in. No row holds
-- a name, an address or an IP address.
create table staff_invites (
  id uuid primary key,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  role text not null check (role in ('senior', 'mod', 'helper')),
  hours jsonb not null check (hours = '"any"'::jsonb or jsonb_typeof(hours) = 'object'),
  created_by uuid not null references accounts (id),
  created_at timestamptz not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  cancelled_at timestamptz,
  tap_id uuid not null unique references key_taps (id),
  account_id uuid unique references accounts (id),
  check (expires_at > created_at),
  check (used_at is null or cancelled_at is null),
  check (used_at is null or account_id is not null)
);

create index staff_invites_waiting on staff_invites (created_at) where used_at is null and cancelled_at is null;

-- A removed staff member (spec 6.6: the owner adds, removes and switches off staff). The row stays,
-- so their past log entries keep their author; a removed member is also switched off, and nothing
-- switches them on again. The owner is never removed.
alter table staff_members add column removed_at timestamptz;
alter table staff_members add constraint staff_members_removed_switched_off check (removed_at is null or switched_off_at is not null);
alter table staff_members add constraint staff_members_owner_not_removed check (role <> 'owner' or removed_at is null);
