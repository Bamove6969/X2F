-- Owner, 26 Nov 2026: no passwords, and no 24-hour holds of any kind. A trader account holds at
-- least two kinds of login method from passkey, security key, PGP key and authenticator app
-- (@x2f/accounts enoughMethods); a recovery-code login is a full session that may change
-- everything for an hour (sessions.recovery_until). Nothing has launched, so no account needs
-- moving: the password, hold and staged-change tables simply go.

drop table if exists passwords;
drop trigger if exists hold_change_drafts_die_with_session on sessions;
drop trigger if exists hold_change_drafts_go_before_session on sessions;
drop function if exists hold_change_drafts_die_with_session();
drop function if exists hold_change_drafts_go_before_session();
drop table if exists hold_changes;
drop table if exists held_trades;
drop table if exists account_holds;

-- Every session is a full one; a recovery-code login's carries its window instead of a hold. An
-- old recovery-level session ends here (and is relabelled, so the new check holds).
update sessions set revoked_at = coalesce(revoked_at, now()), level = 'full' where level = 'recovery';
alter table sessions drop constraint if exists sessions_level_check;
alter table sessions add constraint sessions_level_check check (level = 'full');
alter table sessions drop column if exists hold_until;
alter table sessions drop column if exists strength;
alter table sessions add column recovery_until timestamptz;
alter table login_approvals drop column if exists strength;

-- Confirms and approvals are never made with a password.
delete from confirm_tokens where method = 'password';
alter table confirm_tokens drop constraint confirm_tokens_method;
alter table confirm_tokens add constraint confirm_tokens_method check (method in ('pgp', 'passkey', 'security-key', 'recovery-code'));
update login_approvals set outcome = 'expired', decided_at = coalesce(decided_at, now()) where method = 'password' and outcome is null;
delete from login_approvals where method = 'password';
alter table login_approvals drop constraint if exists login_approvals_method_check;
alter table login_approvals add constraint login_approvals_method_check check (method in ('pgp', 'passkey', 'security-key'));

-- No payout wallet waits: a wallet is usable from when it was added.
update wallets set usable_from = created_at where usable_from > created_at;

-- The team's hold boxes go with the holds (team/abilities.ts); a member left with no box keeps
-- the lowest one, seeing active trades.
update team_members
   set abilities = coalesce(nullif(array_remove(array_remove(array_remove(abilities, 'hold-see'), 'hold-cancel'), 'hold-end'), '{}'), '{trades-see-active}')
 where abilities && '{hold-see,hold-cancel,hold-end}'::text[];
