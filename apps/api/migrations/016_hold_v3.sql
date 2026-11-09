-- The 24 h hold model v3 (owner 1-2 Nov 2026; apps/api/src/auth/hold.ts). Parts of the unlanded
-- wip/lead-p2-recovery-rules (its `hold_changes` queue, the trigger that ties a change to the session
-- that staged it) are reused here in the v3 shape.

-- 1. `account_holds` now starts only for a recovery-code login ('recovery-code'). The older reasons
-- stay valid so holds running at deploy settle as they always did (their `pending_change` applies
-- by time, a strong pre-existing method ends them).
alter table account_holds drop constraint account_holds_reason_check;
alter table account_holds add constraint account_holds_reason_check
  check (reason in ('weak-change', 'weak-new-device', 'weak-backup-login', 'recovery-code'));

-- 2. Changes made by a session whose login waits (a username and password, nothing stronger; a PGP
-- key login is strong since the owner's Q81, part 5 below): staged as drafts (`submitted_at` null) for the session to review, then
-- submitted together, then applied 24 h after the account's latest submission (`due_at`, one date
-- for every waiting change). Stored as the change's own table stores it (a password hash, a sealed
-- secret, a public key, code hashes, a removed wallet's label and address end): never a plain
-- secret. Any logged-in session of the account owner cancels them, all or one at a time (g65); a
-- strong login may approve them now (G58); `methods_before` records the account's methods at
-- submission.
create table hold_changes (
  id uuid primary key default gen_random_uuid(),
  -- The order the changes were made in (applied, listed and alerted in it).
  seq bigint generated always as identity,
  account_id uuid not null references accounts (id) on delete cascade,
  -- The session that staged it. A draft dies with it (the trigger below, and a purged session's
  -- cascade); a submitted change outlives it (null after a purge) and waits for its date.
  session_id uuid references sessions (id) on delete set null,
  change jsonb not null,
  created_at timestamptz not null,
  submitted_at timestamptz,
  due_at timestamptz,
  methods_before text[],
  check ((submitted_at is null) = (due_at is null) and (submitted_at is null) = (methods_before is null)),
  check (submitted_at is not null or session_id is not null)
);
create index hold_changes_account on hold_changes (account_id, seq);
create index hold_changes_drafts on hold_changes (session_id) where submitted_at is null;
create index hold_changes_due on hold_changes (due_at) where due_at is not null;

-- A draft dies in the transaction that revokes its session, whichever path does (a logout, Devices,
-- a recovery-code login, the owner's login, a password change). Search path pinned as migration 104's.
create function hold_change_drafts_die_with_session() returns trigger
  language plpgsql
  set search_path = public, pg_catalog
as $$
begin
  delete from hold_changes where session_id = new.id and submitted_at is null;
  return null;
end $$;

create trigger hold_change_drafts_die_with_session after update of revoked_at on sessions
  for each row when (old.revoked_at is null and new.revoked_at is not null)
  execute function hold_change_drafts_die_with_session();

-- A session deleted outright (the purge of expired sessions, an account's deletion) takes its
-- drafts first: the `set null` above would otherwise break the draft check and fail the whole
-- delete, so one trader's draft could stop the site-wide purge (lead hold v3 review, item 2).
create function hold_change_drafts_go_before_session() returns trigger
  language plpgsql
  set search_path = public, pg_catalog
as $$
begin
  delete from hold_changes where session_id = old.id and submitted_at is null;
  return old;
end $$;

create trigger hold_change_drafts_go_before_session before delete on sessions
  for each row execute function hold_change_drafts_go_before_session();

-- 3. The trades of an account in a recovery-code hold (one row per trade and held account):
-- `cancel` for a trade not yet funded, `pause` for one whose escrow is or may be funded. `paused`
-- records what this hold applied: the machine's `pause` (only those are resumed) or `system-cancel`. No
-- foreign key to `trades` on purpose: inserting one would take a key-share lock on the trade row
-- inside the login's account-locked transaction, the reverse of the trade routes' lock order
-- (trade row, then account). Rows go when the hold ends and the trade has been resumed.
create table held_trades (
  code text not null,
  account_id uuid not null references accounts (id) on delete cascade,
  action text not null check (action in ('cancel', 'pause')),
  held_at timestamptz not null,
  paused text not null default 'todo' check (paused in ('todo', 'paused', 'skipped', 'cancelled')),
  released_at timestamptz,
  -- Owner G7 (lead review 8 Nov I5): the partner's buyer-cancel asked for while the trade is held
  -- and its escrow holds coins. Recorded only; carried out when the trade's last row goes (no coins
  -- move during the hold); a moderator's decision (a dispute) takes its place.
  cancel_requested_at timestamptz,
  primary key (code, account_id)
);
create index held_trades_account on held_trades (account_id);

-- 4. The one recovery code (owner 2 Nov: ONE 16-character code, replaced after use): the code that
-- replaced a used one, sealed (the TOTP key store, its own context), until the account owner's next
-- login shows it once and it is deleted. Only its hash is in `recovery_codes`.
create table recovery_code_reveals (
  account_id uuid primary key references accounts (id) on delete cascade,
  code_enc bytea not null,
  created_at timestamptz not null
);

-- 5. Owner 6 Nov 2026 (Q81): "PGP will include a username and PGP, so it will be considered strong.
-- Therefore, it won't have a hold time." A PGP key login is strong (strength.ts `STRONG_COMBOS`):
-- the sessions and login approvals stored as 'pgp-single' (a PGP key alone, model of 10-29) become
-- 'strong', and 'pgp-single' is no longer a stored value, so every `strength = 'strong'` check and
-- `waits` agree.
update sessions set strength = 'strong' where strength = 'pgp-single';
alter table sessions drop constraint sessions_strength_check;
alter table sessions add constraint sessions_strength_check check (strength in ('strong', 'weak-single'));
update login_approvals set strength = 'strong' where strength = 'pgp-single';
alter table login_approvals drop constraint login_approvals_strength_check;
alter table login_approvals add constraint login_approvals_strength_check check (strength in ('strong', 'weak-single'));

-- 6. Owner p4-8 (7 Nov 2026): the "Holds and waiting changes" rights a lead may grant a member
-- (team/perms.ts `HOLD_RIGHTS`): see the waiting changes, untick or cancel them, end the wait.
-- (Owner p5-7 replaced G5: a removal by a username-and-password session waits 24 h like every
-- other change, so no member login is kept past a removal any more.)
alter table team_members drop constraint team_members_roles_check;
alter table team_members add constraint team_members_roles_check
  check (roles <@ '{offers,trades,hold-see,hold-cancel,hold-end}'::text[] and cardinality(roles) >= 1);
