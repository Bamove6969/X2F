-- RetoSwap/Haveno review 2026-11-12, finding 2 (lead call): the moderation service's signed ruling
-- statement for a round-1 escrow ruling its gate authorised: the trade, the escrow address, the
-- round, the ruling, the winner and the payouts the moderator worked out from its own attested
-- terms. Posted over the signed internal listener (`ruling-statement`), checked against
-- MOD_SIGNING_PUBLIC before it is stored, and served to the two traders only, whose devices verify
-- it again before they co-sign a dispute payout. One per trade: the first stays.
create table ruling_statements (
  code text primary key references trades (code),
  statement jsonb not null,
  sig text not null,
  created_at timestamptz not null default now()
);
