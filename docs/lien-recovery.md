# Lien recovery (owner rules, 16 Nov 2026)

Status: built on `wip/third-lien-recovery` (on the lead's dispute stack), except where marked
NEEDS_*. Lead security review needed before liens are switched on (`site_flags.liens_enabled`).

Built: `@x2f/staff` lienRecovery.ts (arithmetic, rate request rules); `@x2f/trade` optional
`lienRecovery` in the attested terms and `payoutsFor`/`sweepMinimums`; migration 650; the API's
reserve at take, record on settle, staff rate routes (`lien-rate` key tap), `GET /v1/account/liens`;
the moderation service signs and pays it; the web devices verify it and Settings → What you owe.

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

## Data (migration 650)

- `lien_recoveries` (add-only ledger): `lien_id`, `trade_code`, `amount_atomic > 0`, `at`; one row per
  lien and trade. A trigger refuses update, delete and truncate, and refuses an insert that would make
  the sum exceed the lien's `amount_atomic` (locks the lien row first).
- `lien_recovery_holds`: the amount a trade in progress has reserved at take (its signed terms carry
  it). `open` → `recovered` (the trade completed, a ledger row is written in the same transaction) or
  `released` (cancelled or refunded: nothing was recovered). Holds keep two concurrent trades from
  reserving the same remainder: at take `free = remaining − open holds` under the lien's row lock.
- `liens.creditor_address` (review B1): bound at placement, never changed (650's guard).
- `liens.recovery_rate_bps` (default 5000, 1..10000 in SQL; requests and taps above 5000 are refused
  until NEEDS_GATE_LIEN_RATE) and `lien_rate_requests`: `proposed_bps`,
  `reason` (required, 1..500 chars), `proposed_by`, `status` (`pending` → `approved` | `rejected`),
  `decided_by` (never the proposer), timestamps. Approving sets the lien's rate in the same transaction.
  One pending request per lien.

## Where proceeds come from (debtor is the buyer)

At take, if the buyer has an active lien with a free remainder and the lien has a creditor address
that is none of the trade's own (review B2), the API reserves

    recovery = min(floor(buyerProceeds × min(rate, 50%) / 10000), free, lienRecoveryCap(buyerProceeds))

`lienRecoveryCap` (@x2f/trade) is half the proceeds, never leaving the buyer less than
`MAX_NETWORK_FEE` (review B3: wallet2 cannot take the network fee from an output not larger than it).
**The creditor's address (review B1, interim lead/helper build, owner question Q2):** the creditor's own
address from the disputed trade (its buyer payout or seller refund), bound to the lien when it is placed
(`liens.creditor_address`, never changed), not their newest wallet. It is the address the moderation
service signed in that trade, so the moderation service can check it. A poster-buyer's payout chosen
after the take that equals the hold's address releases the hold before anything is signed (review B2).

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
through the chain-observed `settled` event, never on "I've paid" or a claim. A refund seen on chain, or
a close before any escrow was set up, releases the hold. A trade that closed with an escrow keeps its
hold (review M2): late coins can still be escalated and ruled for the buyer, and that payout pays the
signed recovery. The hold stops counting once the trade has been closed without a coin for
`WATCH_CLOSED_DAYS` (30), as the moderation service's own count does; a recovery paid after that, past
what is still owed, records only what was owed and logs `lien.over-recovered` (owner question Q6).
`complied` refuses (409 `lien-recovery-in-flight`) while the lien has an open hold. The same rule for the lien code: `complied` (which repays a restitution lien) is
a system event only (tested), and its future route (NEEDS_TASK_12_TX_PROOF) must emit it only after
the tx proof is checked on chain: the seller's "sent" claim and uploaded evidence are not receipt.

**Network fee (review M5, merge with `wip/second-netfee-fixes`).** Here the network fee stays on
payout 0 (the buyer), and the buyer always keeps at least `MAX_NETWORK_FEE`. Merge note: insert the
recovery output after the fee output in both release lists (`payoutsFor`, `sweepMinimums`). Two
things to settle at that merge, not built here: (1) if the creditor's output is marked
`bearsNetworkFee`, wallet2 refuses it when it is not larger than its share, so either do not mark it or
never reserve less than `MAX_NETWORK_FEE` (owner question Q5: carry or forgive a smaller remainder);
(2) `feeWalletNetworkFee` there hard-codes two bearers (`networkFeeShares(fee, [true, true])[1]`) and
must take the trade's real bearer list once a third output can bear a share.

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
  money-affecting staff action, so approve takes a `lien-rate` key tap bound to the lien, the
  request and the rate (an API-only tap kind, like `set-grants`: the rate is applied by the API at
  take, not by the moderation gate). NEEDS_STAFF_WEB_LIEN_RATE: the staff site's screen and its
  KeyTapDialog caller are not built.

## Trader view

`GET /v1/account/liens`: as debtor, each active lien's owed, recovered, remaining and current rate;
as creditor, the recoveries received (no account ids or addresses). The web shows it at
`/settings/liens` (COPY-UNSIGNED, DESIGN: not drawn). NEEDS_DESIGN_LIEN_NOTICE: a line on the quote
and the trade room ("this purchase pays X to the person you owe"), and a link to the screen from
Settings; the buyer's trade view already carries `lienRecoveryAtomic`.

## Owner questions

1. Seller-debtor case (above).
2. A lien that carries X2F's 1%: once the creditor is paid, move the 1% into `fees_owed` and end the
   lien?
3. Which creditor address receives recoveries? Built (review B1): the creditor's own address from the
   disputed trade, bound at placement and kept for the lien's life (past the 90-day trade address
   purge). Recommended next: an address the creditor's device signs for this purpose.
4. A lien voided or suspended (appeal) while a trade with a recovery is in flight: the signed terms
   still pay it; as built the ledger records it (the money moved). Should a later ruling owe it back?

## Security (review B1, 16-17 Nov 2026)

Threat model of the review: the API and its database compromised; gate.bin, the MOD_* secrets and
honest staff keys not. What now holds:

- **The moderation service is the authority on what is signed** (apps/moderation `lienRecovery.ts`).
  A work item with a `lienRecovery` must name its source (`lienSource { fromCode, creditor }`). The
  service signs it only if: it attested `fromCode`; the rulings of that trade's dispute, each verified
  by its gate with the staff key taps (`gateCheck` with `verifyOnly`), make `creditor` a lien creditor
  (`lienCreditorsOf` in @x2f/staff, tested against `lienSteps`); the address is that side's own in the
  source trade's signed terms and none of this trade's or the fee wallet; the amount is at most
  `lienRecoveryCap`; and the recoveries it signed for that source and has not seen end without paying
  (`mod_lien_recoveries`, moderation migration 009) stay within the source trade's XMR. Otherwise it
  logs `lien-refused-<reason>` and skips the work (never a final refusal).
- **It frees a signed recovery only on what its watcher sees:** a sweep counted for a refund kind, or
  a watch that ended with no coin ever received.
- **Every device and the gate** refuse signed terms whose recovery is above `lienRecoveryCap` or to one
  of the trade's own addresses (`verifyAttestation`, `payoutsFor`, `sweepMinimums`).
- **The rate:** the API applies it, and the moderation service cannot yet check a senior's approval,
  so no rate above the 50% default can be proposed, tapped or applied (NEEDS_GATE_LIEN_RATE: a
  `lien-rate` tap kind the gate verifies, then a per-lien rate in the moderation check).

What a compromised API can still do (owner question Q7): attach a real lien to a buyer who does not
owe it. The money then still goes only to that lien's real creditor's own address, within the lien's
total and at most half of each purchase. The fix is the buyer seeing and accepting it before the take
(NEEDS_DESIGN_LIEN_NOTICE), or a long-term buyer key the moderation service can bind a lien to.
The SQL guards (add-only ledger, sum ≤ owed) stop code bugs, not a compromised API role (as 015, M4).
