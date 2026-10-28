-- Plan 3, Task 19: Web Push subscriptions (P3-I13). A row is the browser's push endpoint (a URL on
-- the browser vendor's push service) and the two public values needed to encrypt to it. Nothing
-- else: no user agent, no IP address, no device name. The endpoint and keys are never logged or
-- returned by any route. A push service answering 404 or 410 deletes the row (push/send.ts).
create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts (id) on delete cascade,
  -- The session that posted it. A trader's subscription lives only as long as that browser's
  -- session (deleted with it, below). The owner's belongs to the account: it outlives an idle
  -- expiry (the owner is away, and the price-health push must still reach them; re-review I3), so
  -- purging the expired session row only nulls this column. An explicit logout, endAllSessions or
  -- DELETE /v1/account/push still removes it.
  session_id uuid references sessions (id) on delete set null,
  endpoint text not null check (char_length(endpoint) <= 1024),
  -- base64url: the browser's P-256 public key (65 bytes) and auth secret (16 bytes).
  p256dh text not null check (char_length(p256dh) = 87),
  auth text not null check (char_length(auth) = 22),
  created_at timestamptz not null
);

-- One browser subscription belongs to one account: the last one to post it.
create unique index push_subscriptions_endpoint on push_subscriptions (endpoint);
create index push_subscriptions_account on push_subscriptions (account_id, created_at);
create index push_subscriptions_session on push_subscriptions (session_id);

-- When a session is revoked (logout, log out everywhere, password change, method removal,
-- recovery, disable), that browser's subscriptions go at once, whichever code path revoked it.
-- So do the account's orphaned rows (session_id null: an owner row whose session expired and was
-- purged), or a browser the owner logged out of by idling would keep getting pushes after "log out
-- everywhere" from another browser (round 3). A trader's expired-session rows are deleted by
-- push/send.ts at the next send and by the purge trigger below when the session row is purged;
-- an owner's stay, with session_id null, until a revoke, an unsubscribe or a disable.
create function push_subscriptions_session_ended() returns trigger language plpgsql as $$
begin
  delete from push_subscriptions
   where session_id = new.id or (session_id is null and account_id = new.account_id);
  return null;
end
$$;
create trigger sessions_end_push after update of revoked_at on sessions
  for each row when (old.revoked_at is null and new.revoked_at is not null)
  execute function push_subscriptions_session_ended();

-- A purged (expired) session row takes its non-owner subscriptions with it; the owner's keep
-- going with session_id null (the foreign key's `on delete set null`).
create function push_subscriptions_session_purged() returns trigger language plpgsql as $$
begin
  delete from push_subscriptions p using accounts a
   where p.session_id = old.id and a.id = p.account_id and a.kind <> 'owner';
  return old;
end
$$;
create trigger sessions_purge_push before delete on sessions
  for each row execute function push_subscriptions_session_purged();

-- Disabling an account drops its orphaned rows too (its live sessions' rows go with their revoke),
-- so a disable and re-enable never resumes pushes to a browser nobody is logged in on.
create function push_subscriptions_account_disabled() returns trigger language plpgsql as $$
begin
  delete from push_subscriptions where account_id = new.id and session_id is null;
  return null;
end
$$;
create trigger accounts_disable_push after update of disabled_at on accounts
  for each row when (old.disabled_at is null and new.disabled_at is not null)
  execute function push_subscriptions_account_disabled();

-- The buyer's final alert on request-refund (P3-I13): true only once the buyer's device has shown
-- it (the seen-receipt routes in trades/routes.ts). An open stream or a push service's 201 never
-- sets it. Null and false both mean "not seen": Task 10 must treat null as false and escalate.
alter table trades add column final_alert_delivered boolean;
-- When the first receipt landed (set once, coalesce). A push can be held by the push service for
-- up to its 15-minute TTL, so the buyer's 15 minutes run from this time, not from final_alert_at:
-- Task 10 auto-refunds only when now >= final_alert_seen_at + 15 min, and escalates otherwise.
-- The boolean stays for compatibility (true exactly when this is set).
alter table trades add column final_alert_seen_at timestamptz;
