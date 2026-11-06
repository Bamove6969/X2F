-- Owner answer Q77, 6 Nov 2026 (comms owner-answers-page-2026-11-06.md): "If they haven't logged
-- into their account in 60 days, then it automatically closes. And if they want to switch to a
-- trader account, then they have to open a new account."
--
-- `last_login_at`: the account's latest login (any level; a team member's login is stamped on the
-- team account), set by `openSession`. Accounts from before this file start their 60 days now:
-- no account is closed on the day this ships.
-- `closed_at` / `closed_reason`: set with `disabled_at` by the retention job closeInactiveVendors
-- (src/vendorInactivity.ts), so every check of a disabled account applies to a closed one too.
alter table accounts add column last_login_at timestamptz;
update accounts set last_login_at = now();
alter table accounts add column closed_at timestamptz;
alter table accounts add column closed_reason text check (closed_reason in ('vendor-inactive'));
alter table accounts add constraint accounts_closed_check
  check ((closed_at is null) = (closed_reason is null) and (closed_at is null or disabled_at is not null));
create index accounts_vendor_last_login on accounts (last_login_at)
  where account_type = 'vendor' and disabled_at is null;
