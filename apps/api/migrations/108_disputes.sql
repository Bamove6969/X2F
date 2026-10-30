-- Plan 3, Task 27: trader-side disputes (spec 2.3, 6.6). Plan 3 writes `disputes` (when a trader
-- opens one) and `dispute_appeals`; Plan 4 writes `dispute_rulings`, `disputes.due_at`,
-- `disputes.status` past 'appealed', and the moderator's join (`moderator_name`,
-- `moderator_joined_at`). Names are PUBLIC display names only (FU-A), never a login name, and no
-- column holds an IP address (spec 4.1, also during disputes).
--
-- Reason codes are relative to whoever opened the dispute: for a buyer 'paid' is "I paid, but the
-- seller hasn't released"; for a seller it is "I haven't received the payment" (Plan 4 A8).
--
-- Each dispute on a trade has its own identity (code, seq): seq 1 is the trade's first dispute,
-- and a later system escalation (late funds after the trade settled) adds seq 2, 3, ... The
-- current dispute is the highest seq. Earlier disputes, their rulings, appeal and note are never
-- deleted or rewritten by a new one: who lost a dispute must survive (Plan 5's lost-dispute total;
-- it drops no stage, R38).
-- The foreign keys have no cascade: nothing in Plan 3 deletes a dispute, and a job that deletes a
-- trade must delete appeals, then rulings, then disputes first (Plan 7 Task 2 / Plan 4 Task 23).
create table disputes (
  code text not null references trades (code),
  seq smallint not null check (seq >= 1),
  opened_by text not null check (opened_by in ('buyer', 'seller')),
  reason text not null check (reason in ('paid', 'silent', 'terms', 'other')),
  -- For the moderator only; never returned to the other trader.
  note text not null default '' check (char_length(note) <= 1000),
  opened_at timestamptz not null,
  -- Opened on a trade that was already refunded (spec 2.3 "dispute after refund"): no escrow is left.
  after_refund boolean not null default false,
  -- The published ruling deadline (Plan 4, RULING_DEADLINE_H).
  due_at timestamptz,
  status text not null default 'open' check (status in ('open', 'ruled', 'appealed', 'final', 'closed')),
  moderator_name text check (char_length(moderator_name) between 1 and 64),
  moderator_joined_at timestamptz,
  check ((moderator_name is null) = (moderator_joined_at is null)),
  primary key (code, seq)
);

-- A ruling as the traders see it (Plan 4 writes it when a ruling is published). Round 1 can be
-- appealed until `appeal_until`; round 2 (the appeal's ruling) is final and has none.
create table dispute_rulings (
  code text not null,
  seq smallint not null,
  round smallint not null check (round in (1, 2)),
  outcome text not null check (outcome in ('release-to-buyer', 'refund-to-seller', 'seller-sends-xmr', 'seller-returns-fiat', 'no-action')),
  reason text not null check (char_length(reason) between 1 and 4000),
  -- What the moderator relied on, as short lines for the traders (strings only).
  evidence jsonb not null default '[]' check (jsonb_typeof(evidence) = 'array'),
  moderator_name text not null check (char_length(moderator_name) between 1 and 64),
  ruled_at timestamptz not null,
  appeal_until timestamptz,
  primary key (code, seq, round),
  foreign key (code, seq) references disputes (code, seq),
  check ((round = 1) = (appeal_until is not null))
);

-- At most one appeal per dispute (the primary key), from either side.
create table dispute_appeals (
  code text not null,
  seq smallint not null,
  by text not null check (by in ('buyer', 'seller')),
  why text not null check (char_length(why) between 10 and 1000),
  at timestamptz not null,
  primary key (code, seq),
  foreign key (code, seq) references disputes (code, seq)
);
