-- Plan 3, Task 19: Web Push subscriptions (P3-I13). A row is the browser's push endpoint (a URL on
-- the browser vendor's push service) and the two public values needed to encrypt to it. Nothing
-- else: no user agent, no IP address, no device name. The endpoint and keys are never logged or
-- returned by any route. A push service answering 404 or 410 deletes the row (push/send.ts).
create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts (id) on delete cascade,
  endpoint text not null check (char_length(endpoint) <= 1024),
  -- base64url: the browser's P-256 public key (65 bytes) and auth secret (16 bytes).
  p256dh text not null check (char_length(p256dh) = 87),
  auth text not null check (char_length(auth) = 22),
  created_at timestamptz not null
);

-- One browser subscription belongs to one account: the last one to post it.
create unique index push_subscriptions_endpoint on push_subscriptions (endpoint);
create index push_subscriptions_account on push_subscriptions (account_id, created_at);

-- The buyer's final alert on request-refund (P3-I13): true when a live stream was open or a push
-- service accepted the push; null until a refund is requested. Moderation (Task 10) escalates on false.
alter table trades add column final_alert_delivered boolean;
