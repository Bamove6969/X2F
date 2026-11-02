-- Owner, 2 Nov 2026 (docs/design-hold-model-2026-11-02.md, board BecomeVendor): Trader and Vendor
-- accounts. A trader (the default) takes offers; a vendor posts them, may have team members and
-- pays the 1% fee on completed trades (the fee is the poster's, packages/trade). Becoming a vendor
-- is the account holder's switch in Settings > Account type, which needs a passkey, security key
-- or PGP key on the account and a confirm with one of them (`PUT /v1/account/type`).
--
-- `account_type` is not `kind` ('trader' | 'staff' | 'owner' | 'member', who the row is): only a
-- `kind = 'trader'` account can be a vendor. This file comes after offers (102) and team members
-- (015, 199) because the backfill below reads both.
alter table accounts add column account_type text not null default 'trader' check (account_type in ('trader', 'vendor'));
alter table accounts add column vendor_since timestamptz;
alter table accounts add constraint accounts_vendor_kind
  check ((account_type = 'trader' and vendor_since is null) or (account_type = 'vendor' and kind = 'trader' and vendor_since is not null));

-- Existing accounts are traders, except an account that already has offers (live or paused) or
-- team members (joined or invited): it becomes a vendor only if it meets the requirement (a PGP
-- key, a passkey or a security key; it cannot confirm here). One that does not stays a trader:
-- its offers stay as they are (they can be paused, removed and keep being listed while live) but
-- it cannot post new ones or turn one back on, and its team stays but it cannot invite (OPEN,
-- owner: docs/vendor-ban-questions-2026-11-02.md). apps/api/test/vendor.test.ts re-runs it.
-- backfill:start
update accounts a set account_type = 'vendor', vendor_since = now()
 where a.kind = 'trader' and a.account_type = 'trader'
   and (exists (select 1 from offers o where o.account_id = a.id and o.status <> 'removed')
        or exists (select 1 from team_members t where t.account_id = a.id and t.removed_at is null))
   and (exists (select 1 from pgp_keys k where k.account_id = a.id)
        or exists (select 1 from webauthn_credentials w where w.account_id = a.id));
-- backfill:end
