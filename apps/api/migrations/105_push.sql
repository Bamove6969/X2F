-- Plan 3, Task 19: Web Push subscriptions (P3-I13). A row is the browser's push endpoint (a URL on
-- the browser vendor's push service) and the two public values needed to encrypt to it. Nothing
-- else: no user agent, no IP address, no device name. The endpoint and keys are never logged or
-- returned by any route. A push service answering 404 or 410 deletes the row (push/send.ts).
create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts (id) on delete cascade,
  -- The session that posted it: a subscription lives only as long as that browser's session.
  session_id uuid not null references sessions (id) on delete cascade,
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

-- When a session ends (logout, log out everywhere, disable, revoke), that browser's subscriptions
-- go at once, whichever code path revoked it. An expired session's rows are skipped and deleted
-- by push/send.ts at the next send, and by the cascade when the session row is purged.
create function push_subscriptions_session_ended() returns trigger language plpgsql as $$
begin
  delete from push_subscriptions where session_id = new.id;
  return null;
end
$$;
create trigger sessions_end_push after update of revoked_at on sessions
  for each row when (old.revoked_at is null and new.revoked_at is not null)
  execute function push_subscriptions_session_ended();

-- The buyer's final alert on request-refund (P3-I13): true only once the buyer's device has shown
-- it (the seen-receipt routes in trades/routes.ts). An open stream or a push service's 201 never
-- sets it. Null and false both mean "not seen": Task 10 must treat null as false and escalate.
alter table trades add column final_alert_delivered boolean;
