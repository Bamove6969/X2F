-- Plan 2 Task 17 (owner, 2026-10-29c and 14:12; R42): the 24-hour hold by login strength.
--
-- How strong the login behind each session was (`loginStrength`, strength.ts): 'strong' only for
-- the owner's no-wait combinations (a passkey or security key alone; a password with an
-- authenticator code, a passkey or a security key; a PGP key with a passkey or security key);
-- 'pgp-single' for a PGP key alone and 'weak-single' for any other single way. Both single kinds
-- wait (owner 14:12: "everything else, PGP alone included, waits 24 hours"). Sessions from before
-- this migration have none and count as weak (the safe side; deploy note).
alter table sessions add column strength text check (strength in ('strong', 'weak-single', 'pgp-single'));

-- An approved login keeps the strength of the login that waited for approval.
alter table login_approvals add column strength text not null default 'weak-single'
  check (strength in ('strong', 'weak-single', 'pgp-single'));

-- The account's hold: while `hold_until > now` the account cannot start trades, post or turn on
-- offers, change payout wallets, approve new logins or change how it logs in (accepting new Terms stays allowed);
-- trades already open can still be finished.
create table account_holds (
  account_id uuid primary key references accounts (id) on delete cascade,
  started_at timestamptz not null,
  hold_until timestamptz not null check (hold_until > started_at),
  -- 'weak-change': a weak session changed the password or a security setting (the change waits in
  -- `pending_change`); 'weak-new-device': a weak login on a device not trusted for the account
  -- while nothing was logged in to approve it; 'weak-backup-login': a backup login with one weak
  -- way (Task 9's recovery session; lead default).
  reason text not null check (reason in ('weak-change', 'weak-new-device', 'weak-backup-login')),
  -- The change that started the hold, applied only when the hold ends by time; a strong login with
  -- a method in `started_methods` discards it. Holds secrets only in the form their table stores
  -- them (a password hash, a sealed key or secret, code hashes).
  pending_change jsonb,
  -- The login methods the account held when the hold started ('password', 'totp',
  -- 'pgp:<fingerprint>', 'webauthn:<credential id>'): only a strong login with these ends it early.
  started_methods text[] not null,
  -- The session whose login or change started it (a full session may cancel a backup session
  -- that started one, and that ends the hold too).
  started_by uuid references sessions (id) on delete set null
);
