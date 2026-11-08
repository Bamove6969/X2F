-- Plan 3, Task 10: the signals channel, the shadow trade and the guarded refunds.
--
-- signed_terms.seller_terms / buyer_terms: the trade.terms each trader's own identity signed on
--   the signals channel, kept only when its address and deal equal what this service attested:
--   { "address": "<the refund or payout address>", "envelope": <the sealed envelope as received> }.
--   The seller's is the ONLY refund address the moderator ever pays (recordedRefundAddress); the
--   API's trades.seller_refund is never read for it.
-- mod_trade_desk: per trade, the signals channel's ReplayGuard and the moderator's own seq, the
--   shadow Trade (fed only by this service's chain watcher and by signals it opened itself, through
--   @x2f/trade's apply), what the buyer signed (paid, cancel), and the refund this service armed or
--   escalated. JSON (bigints and dates tagged), written BEFORE anything is acted on or sent.
alter table signed_terms add column seller_terms jsonb;
alter table signed_terms add column buyer_terms jsonb;

create table mod_trade_desk (
  trade text primary key,
  record jsonb not null,
  updated_at timestamptz not null default now()
);

revoke all on mod_trade_desk from public;
