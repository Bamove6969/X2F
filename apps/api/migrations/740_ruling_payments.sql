-- Plan 4 Task 12, after-refund compliance (A6; NEEDS_TASK_12_TX_PROOF): the seller's proof that they
-- sent the buyer the trade's XMR, as a `seller-sends-xmr` ruling orders, within COMPLY_H.
-- Numbered 740: clear of the numbers other open branches use (550-701).
--
-- 1. ruling_payments: every tx a seller submitted for a dispute. The API checks it on X2F's own node
--    (monero check_tx_key against the trade's buyer payout address, for at least the trade's XMR) and
--    accepts it at 10 confirmations; with fewer it waits (`pending`) and the dispute timer checks it
--    again. `tx_hash` is the primary key: a tx proves one payment, once, whichever dispute it was
--    submitted for (a replay is refused). `refused`: a pending tx that later failed its check (dropped
--    from the pool, or a reorg); it can never be submitted again.
--    `tx_key` is kept only while the proof may still need checking, and only with its dispute: the
--    rows go with the dispute (on delete cascade, the dispute purge). Neither an address nor an
--    account id is stored.
-- 2. disputes.comply_lapsed_at: A6, the seller let COMPLY_H pass with no proof accepted or pending.
--    The dispute timer sets it once, logs `dispute.comply-lapsed` and alerts the owner; the case is
--    then listed for senior moderators and the owner (the queue), who decide the suspension.
create table ruling_payments (
  tx_hash text primary key check (tx_hash ~ '^[0-9a-f]{64}$'),
  code text not null,
  seq integer not null,
  tx_key text check (tx_key ~ '^([0-9a-f]{64}){1,17}$'),
  status text not null check (status in ('pending', 'accepted', 'refused')),
  submitted_at timestamptz not null,
  checked_at timestamptz not null,
  -- What check_tx_key showed the buyer's address received, at the last check.
  received_atomic numeric(30, 0) check (received_atomic >= 0),
  confirmations integer check (confirmations >= 0),
  decided_at timestamptz,
  -- A waiting tx the node no longer knows: when a check first missed it (cleared once the node knows
  -- it again). Refused once it has been lost this long without a break (review m1).
  lost_since timestamptz,
  foreign key (code, seq) references disputes (code, seq) on delete cascade,
  check ((status = 'pending') = (decided_at is null)),
  -- The key goes once the proof is decided: nothing needs it again.
  check (status = 'pending' or tx_key is null),
  check (status <> 'pending' or tx_key is not null)
);

-- One live proof per dispute: a second submission while one waits or after one was accepted is refused.
create unique index ruling_payments_one_live on ruling_payments (code, seq) where status in ('pending', 'accepted');
create index ruling_payments_pending on ruling_payments (checked_at) where status = 'pending';

alter table disputes add column comply_lapsed_at timestamptz;

-- 3. ruling_payment_attempts (re-review m3 follow-up; lead default for owner question RC-4): a proof
--    the seller sent in time that X2F's checker could not take (503: the node unavailable, or the
--    checker busy or stuck). Shown in the staff case view ("tried at ..., node unavailable") so a
--    senior deciding a lapse sees X2F's fault; complyBy never moves for it. Only the time and the
--    reason: no tx, no key. Goes with the dispute (the purge's cascade).
create table ruling_payment_attempts (
  code text not null,
  seq integer not null,
  at timestamptz not null,
  reason text not null check (reason in ('node-unavailable', 'busy')),
  foreign key (code, seq) references disputes (code, seq) on delete cascade
);
create index ruling_payment_attempts_case on ruling_payment_attempts (code, seq, at);
