-- D-032 (owner G60, 7 Nov 2026): a staff member who loses their only key (and has no recovery code)
-- reaches the owner, who vets them and resets their security; they then set their methods up again.
-- "Build the owner's reset, tapped."
--
-- The reset reuses the invite pages: the owner's tapped reset (`reset-staff-security`, bound to the
-- person, the link's id, the token's hash and the expiry) deletes the person's login methods and
-- known devices, ends their sessions, disables the account and stores a row here of kind `reset`
-- for that existing account, with its role and hours. The link then works like an invite link from
-- the key step on (the names and the Terms are already theirs); its finish re-enables the account
-- (unless switched off) instead of adding a staff member. 540: numbers up to 500 are taken on main;
-- the lead renumbers if another branch of this round took it.
alter table staff_invites add column kind text not null default 'invite' check (kind in ('invite', 'reset'));
alter table staff_invites add constraint staff_invites_reset_account check (kind = 'invite' or account_id is not null);
-- An invite still makes one account; a person may be reset more than once, one open link at a time.
alter table staff_invites drop constraint staff_invites_account_id_key;
create unique index staff_invites_invite_account on staff_invites (account_id) where kind = 'invite';
create unique index staff_invites_open_reset on staff_invites (account_id)
  where kind = 'reset' and used_at is null and cancelled_at is null;
