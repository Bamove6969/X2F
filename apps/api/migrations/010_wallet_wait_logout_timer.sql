-- Plan 2 follow-ups (owner, 2026-10-23): the wallet wait by confirm method, and the logout timer.

-- 1. Each confirm token records the login method that earned it, set by the server route that
--    checked the proof (PGP code, WebAuthn assertion of a stored credential of that kind, or the
--    password, with its TOTP code when enrolled). A wallet confirmed with pgp, a passkey or a
--    security key is usable at once; with a password it waits 24 hours.
--    Tokens issued before this migration (each lives 5 minutes) are treated as password tokens:
--    the safe side, so a wallet added with one still waits.
alter table confirm_tokens add column method text;
update confirm_tokens set method = 'password';
alter table confirm_tokens
  alter column method set not null,
  add constraint confirm_tokens_method check (method in ('pgp', 'passkey', 'security-key', 'password'));

-- 2. The opt-in 24-hour wait setting is retired (PUT /v1/account/security/payout-wait is gone).
--    Existing wallets keep their usable_from: one still waiting under the old setting finishes its
--    wait, every other one stays usable. A scheduled switch-off has nothing left to switch off.
--    Old 'payout-wait-off-scheduled' alerts stay in the alert history as they were.
alter table accounts drop column payout_wait, drop column payout_wait_off_at;

-- 3. The logout timer: a trader's chosen idle time in hours (default 12). Staff and owner accounts
--    carry the column too but are fixed at 2 hours by sessionPolicy, whatever it holds.
alter table accounts
  add column idle_hours smallint not null default 12
  constraint accounts_idle_hours check (idle_hours in (2, 4, 6, 8, 10, 12));

-- Trader sessions used to idle out after 7 days; every account now starts at 12 hours, so live
-- full trader sessions get the shorter deadline (requireSession already enforces it on use; this
-- keeps expires_at right for purgeExpired).
update sessions s
   set expires_at = least(s.expires_at, s.last_seen_at + interval '12 hours')
  from accounts a
 where a.id = s.account_id and a.kind = 'trader' and s.level = 'full' and s.revoked_at is null;
