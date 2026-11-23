-- Security review p4t22 (23 Nov), the dispute system.
--
-- m1 (lead default, owner question OQ2): an appeal can overturn round 1 before round 1's escrow
-- payout ran; round 2's outcome then pays instead and nobody is liened for coins they never
-- received. `executed_round` says whose ruling the payout carried out (1 or 2), set with
-- `executed_at`; every payout recorded before this migration was round 1's.
alter table disputes add column executed_round smallint check (executed_round in (1, 2));
update disputes set executed_round = 1 where executed_at is not null;
alter table disputes add constraint disputes_executed_round_with_at check ((executed_at is null) = (executed_round is null));

-- M2: the moderation service's signed statement of an after-refund `seller-sends-xmr` ruling its
-- gate authorised (the trade, the round, the ruling, the XMR and the buyer's attested address, from
-- the moderation process's own records). Posted over the signed internal listener
-- (`after-refund-statement`), checked against MOD_SIGNING_PUBLIC before it is stored, and served
-- to the two traders; the seller's app shows the pay form only once it verifies the statement
-- itself against the pinned key and its own amount and address. One per ruling: the first stays.
-- It goes with its dispute (the whole-trade purge deletes the dispute rows).
create table after_refund_statements (
  ruling_id uuid primary key,
  code text not null,
  seq integer not null,
  round smallint not null check (round in (1, 2)),
  statement jsonb not null,
  sig text not null,
  created_at timestamptz not null default now(),
  foreign key (code, seq) references disputes (code, seq) on delete cascade
);
create index after_refund_statements_code on after_refund_statements (code, seq);

-- M2: the moderation process lists the current after-refund disputes to sign their statements.
grant select (after_refund) on disputes to x2f_mod_reader;
