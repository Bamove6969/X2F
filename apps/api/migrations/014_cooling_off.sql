-- Plan 2 Task 17 (owner, 2026-10-29): the 24-hour cooling-off after a login with one weak way.
--
-- `cooling_from` / `cooling_until`: the account's cooling-off. While `cooling_until > now` the
-- account cannot start trades or post offers, change payout wallets, or approve new devices;
-- trades already open can still be finished. A strong login with a method the account held before
-- `cooling_from` ends it early.
alter table accounts
  add column cooling_from timestamptz,
  add column cooling_until timestamptz,
  add constraint accounts_cooling check ((cooling_from is null) = (cooling_until is null));

-- How strong the login behind each session was: 'strong' (two factors, or a PGP key, passkey or
-- security key) or 'weak' (one weak way: a password alone, an authenticator code alone, a recovery
-- code alone). A weak session that changes the password or login methods starts the cooling-off.
-- Sessions from before this migration have none and count as weak (the safe side).
alter table sessions add column strength text check (strength in ('strong', 'weak'));

-- An approved login keeps the strength of the login that waited for approval.
alter table login_approvals add column strength text not null default 'weak' check (strength in ('strong', 'weak'));
