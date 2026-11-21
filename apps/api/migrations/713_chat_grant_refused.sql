-- Review F2 of tasks 3-6 (18 Nov): a grant the moderation service refused (its wrap does not open to
-- the key record's tkh, a signature that does not check out by moderation's own records, a chat it
-- never attested, another key than the one it already accepted) is marked here, set only by its
-- signed `chat-grant-refused` report naming that exact grant. The grant queue skips refused rows, so
-- garbage grants can never starve an honest one; the fallback still treats a refused grant as
-- unaccepted. API number 713.
alter table chat_members
  add column refused_at timestamptz,
  add column refused_reason text check (refused_reason is null or refused_reason ~ '^[a-z][a-z-]{0,40}$');
