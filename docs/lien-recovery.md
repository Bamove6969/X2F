# Lien recovery (owner rules, 16 Nov 2026)

Status: design for `wip/third-lien-recovery` (on the lead's dispute stack). Lead security review
needed before liens are switched on (`site_flags.liens_enabled`).

## The owner's rules

1. Partial recovery: a trade recovers what its proceeds allow and the rest carries forward.
2. No double compensation: every amount recovered is tracked against the lien; the creditor never
   receives more than the moderator determined they were owed.
3. Option b: an active lien no longer blocks trading. The debtor is told their proceeds are deducted
   at a rate (default 50%) until the lien is paid. A moderator may propose another rate with a
   required reason; a senior moderator approves or rejects it; until approved the default applies.
4. Evidence before enforcement: a payment marked as sent is not proof money arrived.

## What a lien owes the creditor

A lien carries `amount_atomic` (owed to the creditor, the trade's XMR) and `fee_atomic` (the unpaid
1% owed to X2F, D-063). Recovery pays the creditor only, so:

- `remaining = amount_atomic − sum(lien_recoveries.amount_atomic)`, never negative (rule 2).
- The lien becomes `repaid` exactly when `remaining` reaches 0 **and** `fee_atomic = 0`. A lien that
  also carries X2F's 1% stops recovering at 0 but stays `active` (it no longer blocks trading):
  NEEDS_OWNER_LIEN_FEE_AFTER_COMPLY (review L2 option a: move the 1% into `fees_owed`, collected by
  NEEDS_FEE_OWED_COLLECTION). Tripwire in the API tests.

## Data (migration 560)

- `lien_recoveries` (add-only ledger): `lien_id`, `trade_code`, `amount_atomic > 0`, `at`; one row per
  lien and trade. A trigger refuses update, delete and truncate, and refuses an insert that would make
  the sum exceed the lien's `amount_atomic` (locks the lien row first).
- `lien_recovery_holds`: the amount a trade in progress has reserved at take (its signed terms carry
  it). `open` → `recovered` (the trade completed, a ledger row is written in the same transaction) or
  `released` (cancelled or refunded: nothing was recovered). Holds keep two concurrent trades from
  reserving the same remainder: at take `free = remaining − open holds` under the lien's row lock.
- `liens.recovery_rate_bps` (default 5000, 1..10000) and `lien_rate_requests`: `proposed_bps`,
  `reason` (required, 1..500 chars), `proposed_by`, `status` (`pending` → `approved` | `rejected`),
  `decided_by` (never the proposer), timestamps. Approving sets the lien's rate in the same transaction.
  One pending request per lien.

## Where proceeds come from (debtor is the buyer)

At take (or the poster-buyer's set-up), if the buyer has an active lien with a free remainder and the
creditor has a usable wallet (newest wallet past its `usable_from` cool-down, not removed: lead default,
owner may let the creditor choose), the API reserves

    recovery = min(floor(buyerProceeds × rate / 10000), free)

where `buyerProceeds` is what the release pays the buyer (amount, or amount − fee on a buyer's ad) at
take. The trade row keeps `lien_recovery_atomic`, `lien_recovery_address`, `lien_recovery_lien_id`.

**Signed terms.** `AttestedTerms` gains an optional `lienRecovery: { address, amountAtomic }` (absent
when nothing is recovered, so every existing trade's terms and bytes are unchanged). The moderation
service signs it; `payoutsFor` for `release` and `dispute-buyer` takes it from the terms and pays
`[buyer: proceeds − recovery, fee, creditor: recovery, seller: surplus]`. The seller's device, the
buyer's device and the moderation gate each build the set from the attested terms, so a recovery
output that is not in the signed terms (or differs by one atomic unit) is refused. The buyer's device
also checks the attested recovery equals the one the buyer confirmed at take (`ConfirmedDeal`), as for
`feeOwedAtomic`'s plan. A refund or full reversal never pays a recovery.

**Recorded only on evidence (rule 4).** The ledger row is written when the trade reaches `released`
through the chain-observed `settled` event, never on "I've paid" or a claim. A cancel or refund
releases the hold.

**Network fee (compatibility with `wip/third-netfee-split`).** Here the network fee stays on payout 0
(the buyer). If the equal-share rule lands, the creditor's output should be marked
`bearsNetworkFee` too (it is a receiving output); the ledger keeps recording the gross recovery (what
the debtor gave up), so the creditor receives slightly less than recorded and never more (rule 2).
Merge note: insert the recovery output after the fee output in both versions.

## Debtor is the seller (owner question)

A selling debtor receives fiat off-platform, so no XMR can be withheld. Not built; options:

- (a) the seller funds escrow with `amount + fee + recovery`, and the release pays the recovery out of
  the extra funding (needs the funding plan, the funding screens and the gate to carry it);
- (b) keep a lien blocking the debtor's **selling** only (buy side recovers);
- (c) nothing: a selling debtor repays only through buys.

As built: (c), with tripwire `NEEDS_OWNER_SELLER_DEBTOR` (API test).

## Staff flow

- `GET /v1/staff/liens/:id` (`disputes.handle`): the lien, recoveries, remaining, rate, requests.
- `POST /v1/staff/liens/:id/rate` (`disputes.handle`): `{ rateBps, reason }`; a rate other than 5000
  needs a reason; creates a pending request (logged `lien.rate-proposed`).
- `POST /v1/staff/liens/:id/rate/:req/approve|reject` (`rulings.approve`, a senior or the owner, never
  the proposer): logged `lien.rate-approved` / `lien.rate-rejected`. Changing a money rate is a
  money-affecting staff action; the key tap belongs on approve (NEEDS_LIEN_RATE_TAP: the gate does not
  know this tap kind yet, and the rate is enforced by the API at take, not by the gate).

## Trader view

`GET /v1/account/liens`: as debtor, each active lien's owed, recovered, remaining and current rate;
as creditor, the recoveries received. The web shows a notice (COPY-UNSIGNED) on the account screen.

## Owner questions

1. Seller-debtor case (above).
2. A lien that carries X2F's 1%: once the creditor is paid, move the 1% into `fees_owed` and end the
   lien?
3. Which creditor address receives recoveries (lead default: newest usable wallet)?
4. A lien voided or suspended (appeal) while a trade with a recovery is in flight: the signed terms
   still pay it; as built the ledger records it (the money moved). Should a later ruling owe it back?

## For the lead's security review

- The recovery address and amount come from the API into the moderation service's attestation; the
  seller's device cannot tell a creditor's address from an attacker's. The buyer confirms the amount
  at take but not whose address it is. A compromised API could divert up to `rate` of a buyer's
  proceeds. Mitigation options: the moderation service reads the lien and the creditor's wallet from
  its own records, or the creditor's address is bound by a signed lien statement.
- SQL guards (add-only ledger, sum ≤ owed) stop code bugs, not a compromised API role (as 015, M4).
