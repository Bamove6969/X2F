# Lien recovery (owner rules, 16 Nov 2026)

Status: built on `wip/third-lien-recovery` (on the lead's dispute stack), merged onto main on
`merge/lien` (26 Nov 2026; see "Merged onto main" at the end), except where marked NEEDS_*. Lead security review needed before liens are switched on. Recovery needs two switches, and
both are off by default: the API's `site_flags.liens_enabled` (a database row, so a compromised API
holds it) and the moderation service's own `MOD_LIEN_RECOVERY=on` (re-review N1, below). Keep the
moderation switch off until the owner has confirmed Q2-Q6, the copy and the design (Q1 answered
26 Nov 2026).

Built: `@x2f/staff` lienRecovery.ts (rate request rules); `@x2f/trade` optional `lienRecovery` in
the attested terms, `expectedRecovery`, the limits, `payoutsFor`/`sweepMinimums`, the signed
`LienStatement` and `RecoveryAddressStatement`; migration 820; the API's reserve at take (with the
buyer's accepted figure), record on settle, staff rate routes (`lien-rate` key tap),
`GET /v1/account/liens`, its preview and the creditor's recovery address route; the moderation
service checks, signs and pays it; the web quote shows it before the take, the devices verify it, and
Settings → What you owe. Provisional owner answers of 17 Nov below; Q1/OQ1 (the rate) answered by
the owner on 26 Nov 2026: 100%, default and ceiling (migration 890). Owner decision 26 Nov 2026
(5:43, 5:51 and 5:53 PM), built on `feat/lien-grace` (migration 900): the ruling chooses how the lien
is paid, "Collect now" (with a share, default 100%) or "7 days to pay the agreed way" (see "Grace"
below), and a senior approves a lower share without a key tap.

## The owner's rules

1. Partial recovery: a trade recovers what its proceeds allow and the rest carries forward.
2. No double compensation: every amount recovered is tracked against the lien; the creditor never
   receives more than the moderator determined they were owed.
3. Option b: an active lien no longer blocks trading (owner 26 Nov 2026: a vendor at fault may still
   accept new trades). The debtor is told their proceeds are deducted at a rate until the lien is
   paid: by default 100% (owner 26 Nov 2026: "100% of their earnings are pulled until they pay back
   in full"), less only what the buyer's payout must keep to work (Q1 below). A moderator may propose
   a lower rate with a required reason; a senior moderator approves or rejects it; until approved
   the current rate applies.
4. Evidence before enforcement: a payment marked as sent is not proof money arrived.

## What a lien owes the creditor

A lien carries `amount_atomic` (owed to the creditor, the trade's XMR) and `fee_atomic` (the unpaid
1% owed to X2F, D-063). Recovery pays the creditor only, so:

- `remaining = amount_atomic − sum(lien_recoveries.amount_atomic)`, never negative (rule 2).
- The lien becomes `repaid` exactly when `remaining` reaches 0 **and** `fee_atomic = 0`. A lien that
  also carries X2F's 1% stops recovering at 0 but stays `active` (it no longer blocks trading):
  NEEDS_OWNER_LIEN_FEE_AFTER_COMPLY (review L2 option a: move the 1% into `fees_owed`, collected by
  NEEDS_FEE_OWED_COLLECTION). Tripwire in the API tests.

## Data (migration 820)

- `lien_recoveries` (add-only ledger): `lien_id`, `trade_code`, `amount_atomic > 0`, `at`; one row per
  lien and trade. A trigger refuses update, delete and truncate, and refuses an insert that would make
  the sum exceed the lien's `amount_atomic` (locks the lien row first).
- `lien_recovery_holds`: the amount a trade in progress has reserved at take (its signed terms carry
  it), with the lien's rate and the creditor's signed address statement as they were then (what the
  buyer accepted: a rate approved or an address signed after the take changes nothing this trade
  carries). `open` → `recovered` (the trade completed, a ledger row is written in the same transaction) or
  `released` (cancelled or refunded: nothing was recovered). Holds keep two concurrent trades from
  reserving the same remainder: at take `free = remaining − open holds` under the lien's row lock.
- `liens.creditor_address` with `creditor_address_statement` and `_sig` (Q2): the address the
  creditor's own device signed for its recoveries (null until it does; SQL keeps the three together).
- `lien_statements` (review B1): the moderation service's latest signed LienStatement per lien.
- `liens.recovery_rate_bps` (default 10000, 1..10000 in SQL since migration 890, Q1) and `lien_rate_requests`: `proposed_bps`,
  `reason` (required, 1..500 chars), `proposed_by`, `status` (`pending` → `approved` | `rejected`),
  `decided_by` (never the proposer), timestamps. Approving sets the lien's rate in the same transaction.
  One pending request per lien.

## Where proceeds come from (debtor is the buyer)

At take (or the poster-buyer's set-up), if the buyer has an active lien with something left, the
creditor has signed a recovery address (Q2) that is none of the trade's own addresses, not X2F's fee
wallet (`X2F_FEE_WALLET`) and no other account's wallet (review B2), the API reserves exactly

    recovery = expectedRecovery(proceeds, rate, left)
             = min(floor(proceeds × rate / 10000), left, lienRecoveryCap(proceeds)), or 0 when under 0.01 XMR

(@x2f/trade `expectedRecovery`), where `proceeds` is what the release pays the buyer (amount, or
amount − fee on a buyer's ad), `rate` the lien's (default 100%, at most 100%: Q1), `left` the lien's
amount less what is recovered and less the holds of other trades that still count, and
`lienRecoveryCap` all of the proceeds except `LIEN_BUYER_KEEPS_ATOMIC` = `MAX_NETWORK_FEE` + 1 atomic
unit, which the buyer's output keeps so the payout works (Q1, review B3). A figure under 0.01 XMR is
not reserved: the remainder carries forward (Q5).

**The buyer sees and accepts it before the take (review B1).** The quote reads
`GET /v1/account/liens/preview` for the amount and wallet and shows "Paid to the person you owe" and
what the buyer receives; Trade waits until it is read. The take sends the figure
(`lienRecoveryAtomic`); the API refuses any other reserve with 409 `lien-recovery-changed` and keeps
nothing, and the quote reads the figure again. The device keeps the accepted figure
(`ConfirmedTrade.lienRecoveryAtomic`), accepts only signed terms that carry exactly it
(`verifyAttestation`), and its co-sign policy refuses any set whose signed recovery differs
(`cosignPolicy`). A poster who buys sees it on the accepted sheet and accepts it with the wallet.

**Signed terms.** `AttestedTerms` gains an optional `lienRecovery: { address, amountAtomic }` (absent
when nothing is recovered, so every existing trade's terms and bytes are unchanged). The moderation
service signs it only as below (Security); `payoutsFor` for `release` and `dispute-buyer` takes it
from the terms and pays `[buyer: proceeds − recovery, fee, creditor: recovery, seller: surplus]`. The
seller's device, the buyer's device and the moderation gate each build the set from the attested
terms through the shared `recoveryOf`, which refuses a recovery above `lienRecoveryCap`, under
0.01 XMR or to one of the trade's own addresses, so a forged set is refused by every co-signer. A
refund or full reversal never pays a recovery.

**Recorded only on evidence (rule 4).** The ledger row is written when the trade reaches `released`
through the chain-observed `settled` event, never on "I've paid" or a claim. A refund seen on chain, or
a close before any escrow was set up, releases the hold. A trade that closed with an escrow keeps its
hold (review M2): late coins can still be escalated and ruled for the buyer, and that payout pays the
signed recovery. The hold stops counting once the trade has been closed without a coin for
`WATCH_CLOSED_DAYS` (30), as the moderation service's own count does, and is then released
(re-review N3: the retention job `releaseStaleRecoveryHolds`, and `complied` itself first; logged
`lien.recovery-released`). A recovery paid after that (late coins ruled for the buyer) is still
recorded when the trade's attested terms carry exactly that hold's figure; past what is still owed it
records only what was owed and logs `lien.over-recovered`.
`complied` refuses (409 `lien-recovery-in-flight`) while the lien has an open hold that still counts. The same rule for the lien code: `complied` (which repays a restitution lien) is
a system event only (tested), and its future route (NEEDS_TASK_12_TX_PROOF) must emit it only after
the tx proof is checked on chain: the seller's "sent" claim and uploaded evidence are not receipt.

**Network fee (review M5, merge with `wip/second-netfee-fixes`).** Not built here: the network fee
stays on payout 0 (the buyer) and X2F's fee outputs, and the buyer's output always keeps at least
`MAX_NETWORK_FEE` + 1 atomic unit (`LIEN_BUYER_KEEPS_ATOMIC`, Q1). Under
the owner's rule "each receiver pays its own payout network-fee share", the creditor's output is a
receiving output and pays its own share at that merge: mark it `bearsNetworkFee: true` in both
release lists (`payoutsFor`, `sweepMinimums`; insert the recovery output after the fee output). It is
safe to mark: Q5 never reserves less than 0.01 XMR (= `MAX_NETWORK_FEE`, the most any share can be),
so wallet2 never sees a bearer not larger than its share. The ledger keeps recording the gross
recovery (what the debtor gave up); the creditor receives that less its share, never more (rule 2).
`feeWalletNetworkFee` there hard-codes two bearers (`networkFeeShares(fee, [true, true])[1]`) and must
take the trade's real bearer list (and the tx-order permutation) once a third output bears a share.

## Debtor is the seller (owner question)

A selling debtor receives fiat off-platform, so no XMR can be withheld. Not built; options:

- (a) the seller funds escrow with `amount + fee + recovery`, and the release pays the recovery out of
  the extra funding (needs the funding plan, the funding screens and the gate to carry it);
- (b) keep a lien blocking the debtor's **selling** only (buy side recovers);
- (c) nothing: a selling debtor repays only through buys.

As built: (c), with tripwire `NEEDS_OWNER_SELLER_DEBTOR` (API test).

## Staff flow

- `GET /v1/staff/liens/:id` (`disputes.handle`): the lien, recoveries, remaining, rate, requests.
- `POST /v1/staff/liens/:id/rate` (`disputes.handle`): `{ rateBps, reason }` (1..10000); every
  request needs a reason, so any rate other than the 10000 default does, and so does going back to
  it; creates a pending request (logged `lien.rate-proposed`).
- `POST /v1/staff/liens/:id/rate/:req/approve|reject` (`rulings.approve`, a senior or the owner, never
  the proposer): logged `lien.rate-approved` / `lien.rate-rejected`. Owner change 26 Nov 2026
  (5:53 PM): approve takes **no key tap** any more (body `{}`; a `tapId` is refused as a bad request).
  The senior reads the dispute's chat first: `GET /staff/v1/liens/:id` returns the source trade's
  code and whether its dispute is still open, the senior opens the case chat with the existing
  `POST /staff/v1/disputes/:code/chat` (seniors and the owner may join any disputed case; logged as
  every staff chat read is), and opening a pending request they may decide is logged once per request
  and person (`lien.rate-review-opened { lienId, requestId }`). The moderation service still refuses a
  chat read once the dispute is closed (OWNER p12-1), so a request on a closed dispute is decided
  without the chat (owner question below). The moderation service accepts an approved request as the
  API records it (`lienRateRequestApprovals`, read through `x2f_mod_reader`, migration 900's grant):
  rate 1..10000, decided by the owner or a senior moderator in its own gate registry (joined, not
  switched off, not removed), never by the proposer; refusals log `gate.refused.lien-rate-self` /
  `gate.refused.lien-rate-role`. Each request counts once for the lien (`req:<lienId>:<id>`, spent in
  `mod_lien_rate_taps` like a tap). A `lien-rate` tap stored before this change is still verified as
  before. The rate just replaced stays good for `LIEN_RATE_GRACE_HOURS` (24), for a trade whose
  buyer accepted the figure before the change. A lien it pinned before migration 890 keeps the 50% it
  applied (see Q1). See Security for what this costs.
- Staff site (built, replaces NEEDS_STAFF_WEB_LIEN_RATE): the case page's lien panel
  (apps/staff-web `LienPlan.tsx`) shows each lien's grace, a pending lower share with "Review the
  request" (loads the lien, links the case chat), then "Approve the lower share" / "Turn down the
  request", with no tap.

## Grace: 7 days to pay the agreed way (owner decision 26 Nov 2026, 5:43 PM)

When a moderator rules a case that may place a lien (`rulingMayPlaceLien`, @x2f/staff), the ruling
form asks how it is paid:

- **Collect now** (today's behaviour): later trades of the person at fault pay it. With a share,
  1..100%, default 100% (owner 5:51 PM). A share under 100% needs a reason and is **not** applied by
  the ruling. It becomes a pending rate request proposed by the ruling moderator, with the reason
  they keep or edit (the form pre-fills `LIEN_RATE_REASON_PREFILL`), for a senior to approve (above). Until
  then 100% applies. The moderation service cannot verify a share chosen inside a ruling without a
  senior, so this keeps one rule for every rate below 100%.
- **7 days to pay the agreed way**: the moderator writes how the two traders agreed it is paid (1..500
  characters, e.g. "New PayPal payment of $120"). `grace_until` is the ruling time plus
  `LIEN_GRACE_DAYS` (7). Nothing is reserved meanwhile: recovery's `pickRecovery` skips a lien unless
  `LIEN_COLLECTING_SQL` holds (never in grace, or switched to collecting, and never paid off the
  platform).

The plan rides with the proposal (`lienPlan` on `POST .../rulings` and re-propose; stored on the
`ruling_drafts` row: `lien_grace_method`, `lien_rate_bps`, `lien_rate_reason`). It is not part of the
ruling's signed intent, because the gate verifies that intent as it stands. The approver sees it, and
the lien step reads it from the approved ruling's draft when it places the lien (`liens.ruled_by`,
`grace_method`, `grace_until`; logged `lien.grace-started { lienId, graceUntil }`).

- **The person owed signs off.** `POST /v1/account/liens/:id/paid` (the creditor's own trader
  session, the owner device, a live session checked in the transaction, never during a hold; anyone
  else gets 404). Allowed while the lien waits in grace, before or after the deadline, until it is
  switched to collecting. It sets `repaid_off_platform_at`, ends the lien as repaid (when it carries
  no fee, see NEEDS_OWNER_LIEN_FEE_AFTER_COMPLY) and logs `lien.repaid-off-platform`. The account
  view then shows nothing left.
- **The debtor's view** (`GET /v1/account/liens`, `grace { mode, method, graceUntil, lapsed,
  paidOffPlatform }`, present only on a lien given grace): the deadline in their own time zone, the
  agreed way, and that the person owed must confirm. The creditor sees the same, with "I've been
  paid" behind a confirm step (apps/web `GraceOwedTo`, COPY-UNSIGNED).
- **The lapse.** The dispute timers (`runLienGraceLapses`, after the comply lapses) mark a lien whose
  7 days passed without a sign-off once (`grace_lapsed_at`, logged `lien.grace-lapsed`). They alert
  and push the moderator who ruled it (`lien-grace-lapsed`), and the case shows in their queue ("7
  days to pay passed"). Nothing is collected yet: `LIEN_LAPSE_STARTS_COLLECTING` is `false` (the
  lead's reading of the decision; one switch in @x2f/staff turns a lapse into collecting at 100%).
  The moderator (or a senior / the owner) then either:
  - switches it to Collect now: `POST /staff/v1/liens/:id/collect { tapId, rateBps?, rateReason? }`,
    a `lien-collect` key tap bound to the lien and the share (`disputes.handle`), logged
    `lien.collect-started { lienId, lapsed }`; a share under 100% becomes a pending request as above
    (409 `request-pending` if one is already pending). This is allowed before the 7 days are up too.
  - or sends it to a senior moderator: `POST /staff/v1/liens/:id/escalate {}` (only after the lapse),
    logged `lien.grace-escalated`, an owner alert (`lien-grace-escalated`, pushed), and the case shows
    in the seniors' queue.
- Migration 900's checks: a method and a deadline come together, an escalation needs a lapse, a
  switch to collecting and a sign-off exclude each other, and a switch names its tap when it names
  its staff member. The timers skip during maintenance, but the deadline does not move.

## Trader view

`GET /v1/account/liens`: as debtor, each active lien's owed, recovered, remaining and current rate;
as creditor, totals only (owed, received, still to come; review M4, Q4), the source trade and whether
a recovery address is set; never the debtor's purchases (no per-trade rows, no times, no rate), no
account ids or addresses. The web shows it at `/settings/liens` (COPY-UNSIGNED, DESIGN: not drawn).
The creditor picks a wallet there (the ending shown is cut from the full address the device signs,
never the API's `addressEnd`: re-review B1-new); the escrow worker signs "pay my recoveries to this wallet" with the
device's own identity from the disputed trade (`signRecoveryAddress`) and the page posts it to
`POST /v1/account/liens/:id/recovery-address` (the owner's device, a live session checked in the
transaction, never during a hold; refused for another account's wallet or X2F's fee wallet). A device without that trade's record (another
device, or past the 30-day keep) cannot sign and says so (NEEDS_OWNER_RECOVERY_ADDRESS_DEVICE: no
other way to set it, see Q2 below). The buyer's quote and the poster-buyer's accepted sheet show each
purchase's recovery before the take (NEEDS_DESIGN_LIEN_NOTICE: placed as a quote row and a note until
design draws it; a link to the screen from Settings is still missing).

## Owner questions

1. Seller-debtor case (above).
2. A lien that carries X2F's 1%: once the creditor is paid, move the 1% into `fees_owed` and end the
   lien?
3. Q2 to Q6 of the review: answered provisionally below, not yet confirmed. Q1 answered by the owner
   (26 Nov 2026).
4. Debtor binding: a compromised API can still name a real lien against a buyer who does not owe it
   (account ids are its word). See Security.
5. ~~OQ1 (re-review 17 Nov): the highest rate.~~ Answered by the owner, 26 Nov 2026: 100%, as the
   default and the ceiling (Q1 below; migration 890).
6. Moderation switch (re-review OQ3): keep `MOD_LIEN_RECOVERY` off until the owner signs the copy,
   the design and Q2-Q6 (Q1 answered 26 Nov 2026).
7. Grace (26 Nov 2026, as built on the lead's reading; see "Grace"): (a) a lapse alone does not
   start collecting (`LIEN_LAPSE_STARTS_COLLECTING`); (b) the plan is not in the ruling's signed
   intent, only in the tapped request; (c) the person owed may sign off after the lapse but not once
   collecting started; (d) a lien carrying a fee stays active at nothing left after a sign-off
   (NEEDS_OWNER_LIEN_FEE_AFTER_COMPLY); (e) the deadline does not move for maintenance; (f) a senior
   reviewing a rate request on a closed dispute cannot read its chat (OWNER p12-1).

## Owner answers

The review's owner questions. Q1 is the owner's answer (26 Nov 2026); Q2 to Q6 are still the
provisional answers of 17 Nov (the strict choices until the owner rules), not yet confirmed. Each is
one constant or one rule, so a different answer changes one place (plus its tests).

- **Q1, the rate (owner, 26 Nov 2026, answering OQ1):** "When a lien is decided as the outcome of the
  dispute that status gets applied to the trader that it was decided at fault. If they are a vendor
  they are allowed to accept new trades. 100% of their earnings are pulled until they pay back in
  full." So the default and the ceiling are both 100%: `LIEN_DEFAULT_RATE_BPS` =
  `LIEN_RECOVERY_MAX_BPS` = 10000 in @x2f/trade (the one constant for the cap: the API passes it to
  @x2f/staff `rateRequestRefusal` and the `lien-rate` tap check, the devices, the gate and the
  moderation service read it), @x2f/staff `DEFAULT_RECOVERY_RATE_BPS` = 10000, and the SQL checks
  `between 1 and 10000` (API and moderation migrations 890, replacing 820's and 023's 1..9000;
  apps/moderation lienCap.test.ts keeps them equal to the constant). A moderator may still propose a
  lower rate, with a reason, for a senior's `lien-rate` key tap (verified by the moderation service).
  - **What the buyer keeps:** `lienRecoveryCap` takes all of the buyer's proceeds except
    `LIEN_BUYER_KEEPS_ATOMIC` = `MAX_NETWORK_FEE` (0.01 XMR) + `LIEN_BUYER_MARGIN_ATOMIC` (now 1 atomic
    unit; it was 0.01 XMR). The old 0.01 XMR margin only kept the buyer 0.01 XMR net, a policy the
    owner's 100% replaces, so it is gone. `MAX_NETWORK_FEE` itself stays because the payout set needs
    it: the buyer's output is index 0 and the first network-fee bearer, so it must stay in the set
    (an output of 0 is dropped, and then X2F's outputs would bear the whole fee and
    `feeWalletNetworkFee` would book the wrong share); wallet2 cannot take a fee share off an output
    not larger than it (a share is at most `MAX_NETWORK_FEE`); and the key proofs need every payout
    to receive more than 0. The buyer therefore receives at most 0.01 XMR + 1 atomic unit less its
    share of the network fee. A recovery is reduced to fit, or skipped when nothing fits.
  - **Existing liens (migration 890):** an active or suspended lien whose rate is the old 5000 default
    moves to 10000, unless a senior approved a rate request for it (its rate was chosen) or the
    moderation service already signed a lien statement for it (it pinned 5000 in `mod_liens`, and
    would refuse 10000 without a tap: `lien-refused-rate-unverified`). Those keep their stored rate and
    reach 100% only through a rate request and a senior's tap. Open holds keep the rate their buyer
    accepted. Over liens never change. Known edge, theoretical while `MOD_LIEN_RECOVERY` has never
    been on: a hold reserved at 5000 for a lien the moderation service never pinned is now refused
    (`rate-unverified`) once the switch is on; the trade waits unsigned, as any refusal.
- **Q2, where recoveries go:** only to an address the CREDITOR's device signed for this purpose
  (@x2f/trade `RecoveryAddressStatement`, signed with its trade identity from the disputed trade),
  verified by the API and again by the moderation service against that identity as it attested it;
  never "newest wallet", never an address another account holds as a wallet (review B2). Until the
  creditor signs one nothing is reserved: the lien stays, recovery waits, and the creditor's screen
  asks for a wallet. A newer signed statement replaces it; trades already reserved keep theirs.
- **Q3, the seller:** not shown the lien or the creditor's address in the UI (the seller's TradeView
  never carries `lienRecoveryAtomic`; no seller screen reads `lienRecovery`). Review M3: the seller's
  device still holds both in the attested terms (one attestation for both parties, the co-signer needs
  the payout set to verify the release), so a seller who reads their own device's data learns that
  the buyer owes a lien, this recovery and the creditor's address. NEEDS_PRIVACY_LIEN_DISCLOSURE: say so
  in the privacy notes (public crypto spec, section 3.2) before liens are switched on.
- **Q4, what the creditor sees:** totals only (received, still to come), never the debtor's
  individual purchases (`GET /v1/account/liens`, review M4).
- **Q5, small remainders:** a recovery under `LIEN_RECOVERY_MIN_ATOMIC` (0.01 XMR) is never reserved,
  signed or co-signed; the remainder carries forward to a trade that can pay at least that much. A
  lien whose remainder stays under it is never paid off by recoveries. Forgiving it needs a senior with
  a key tap: no forgive path exists, none is built (NEEDS_OWNER_LIEN_FORGIVE).
- **Q6, a lien voided or overturned while a recovery is reserved:** `applyLienVoid` releases the holds
  of the debtor's trades whose terms are not signed yet (they pay nothing); a trade already attested
  pays what its signed terms carry (nothing can change them), and when that payout is seen on chain
  the ledger records it and logs `lien.recovered-after-end` for staff (also for a suspended lien). No
  automatic clawback. Known edge: a buyer who accepted a figure on the quote while the lien was voided
  before the attestation gets terms without it and its device refuses them; that trade does not start.

## Security (review B1, 16-17 Nov 2026)

Threat model of the review: the API and its database compromised; gate.bin, the MOD_* secrets and
honest staff keys not. What now holds:

- **The moderation service has its own switch** (re-review N1): `MOD_LIEN_RECOVERY` (apps/moderation
  `lienRecoveryFromEnv`, docs/dev-setup.md). Unset, empty or `off` (the default): every work item
  whose terms carry a `lienRecovery` is refused (`lien-refused-off`, the trade waits unsigned, as any
  refusal) and no lien statement is signed. `on`: the checks below. Any other value refuses the
  start. The API's `site_flags.liens_enabled` alone can no longer turn recovery on.
  Off is not an emergency stop: it stops new recoveries from being signed, but a trade already
  attested with a `lienRecovery` keeps its signed terms and pays it at release. Every start logs
  `lien-recovery-on` or `lien-recovery-off`.

- **The moderation service is the authority on what is signed** (apps/moderation `lienRecovery.ts`).
  A work item with a `lienRecovery` must name its source and lien (`lienSource { fromCode, creditor,
  lienId, debtorAccount, creditorAccount, buyerAccount, rateBps, address }`). The service signs it only
  if: it attested `fromCode`; the rulings of that trade's dispute, each verified by its gate with the
  staff key taps (`gateCheck` with `verifyOnly`), make `creditor` a lien creditor (`lienCreditorsOf`),
  and none is a round-2 ruling the gate has seen but the API left out (re-review N2);
  the address is the one the creditor's device signed (`recoveryAddressValid` against that side's
  identity in its own attestation of `fromCode`) and none of this trade's or the fee wallet; the lien's
  debtor is this trade's buyer, and the lien's source, side, parties and amount are those it pinned
  the first time (`mod_liens`); the rate is the one it last applied to the lien (the default until
  then), or one a senior's tap approved (gate-verified, at most 100%) that it has not applied before
  (applying spends every new tap for the lien, `mod_lien_rate_taps`; the rate just replaced stays
  good for 24 hours); and the amount is exactly `expectedRecovery` on what is left after every recovery it
  signed for the lien and has not seen end without paying, never more in total than the source
  trade's XMR (`mod_lien_recoveries`, moderation migration 023, under an advisory lock). Otherwise it
  logs `lien-refused-<reason>` and skips the work (never a final refusal). It then signs a
  `LienStatement` ({ lienId, fromCode, creditorSide, debtor, creditor, amountAtomic, rateBps }), keeps
  it and posts it to the API (`lien-statement`, stored in `lien_statements` only when signed by it and
  naming the lien's own source, parties and amount).
- **It frees a signed recovery only on what its watcher sees:** a sweep counted for a refund kind, or
  a watch that ended with no coin ever received. A sweep counted later for a kind that pays it (late
  coins on a refunded trade, ruled for the buyer) makes it count again (review M2).
- **Every device and the gate** refuse signed terms whose recovery is above `lienRecoveryCap`, under
  0.01 XMR or to one of the trade's own addresses (`verifyAttestation`, `payoutsFor`, `sweepMinimums`),
  and the buyer's device refuses any figure it did not accept before the take (`verifyAttestation`,
  `cosignPolicy`). Tested as a compromised API (apps/moderation attest.test.ts, packages/trade
  attestation.test.ts, apps/web policy.test.ts): an injected recovery, an inflated one by one atomic
  unit, one to an address the creditor did not sign, at an unverified rate or for a buyer who is not the
  debtor is refused by moderation, and a buyer who accepted none or another figure refuses it too.

- **The rate is now the API's word** (owner change 26 Nov 2026, 5:53 PM). A senior approves a lower
  share without a key tap, so the moderation service trusts the API's record of an approved request
  (it still checks the range, that a senior or the owner in its own registry decided it, and never
  the proposer). A compromised API can therefore write an "approved" request of its own. A lower rate
  only slows the creditor's recovery, and a fabricated request can at most put a lowered rate back to
  100%. It can never raise the rate above 100% (`LIEN_RECOVERY_MAX_BPS`, checked by the moderation
  service and every device), never redirect the money (the address is the one the creditor's device
  signed), and never take more than the lien's remaining amount.
- **Grace is the API's word too.** The moderation service does not know a lien is in grace; it
  simply sees no recovery reserved. A compromised API could collect during the 7 days, or treat a
  lien as paid off the platform. The debtor still sees and accepts each deduction on the quote before
  the take, as for any recovery.

What a compromised API can still do: delay a rate change a senior approved (by withholding the
request or naming the rate it replaced within the 24 hours) or set any rate from 1% to 100% (above);
and name a real lien (one a verified ruling placed, with the
creditor's own signed address) against a buyer who does not owe it, since account ids are its word
(pinned on first sight only). The money then goes to an address signed by the device of a side
that a gate-verified ruling made a creditor, within that side's total and at a verified rate, and
only if the buyer accepts the shown deduction on the quote. That is not always the lien's real
creditor (re-review N2): the API can hide an appeal and present round 1 alone, so round 1's creditor
is named after the appeal changed it. Partly closed: the moderation service refuses when its gate
has seen a round-2 ruling for the source trade that the API did not present
(`lienRulingVerifier`). The gate sees a round-2 ruling only through an earlier lien check that the
API chose to present it to, so an API that hides the appeal from the start is not caught at all
(re-review 17 Nov b, M1); the residual is the same as before this check. The per-source total is per
(source, side), so across both sides at most twice the source trade's XMR. Staging a dispute between
two accounts of one person needs that person's own device to sign the address. A long-term buyer key the moderation service can bind a lien to would close
it (owner question 4). The SQL guards (add-only ledger, sum ≤ owed) stop code bugs, not a compromised
API role (as 015, M4).

## Merged onto main (26 Nov 2026, `merge/lien`)

What changed in the merge, and what main's later work means for recovery. None of it changes
anything while the two switches are off.

- **Migrations renumbered** so they apply after everything main already has, on fresh and existing
  databases: the API's 650 is now `820_lien_recovery.sql`, moderation's 009 is now
  `023_lien_recoveries.sql`.
- **Option b on main's new guards:** main's ban checks (Plan 4 Task 27) stay next to the lien
  checks, which read `LIEN_BLOCKS_SQL` / `lienBlocksTrading` (never) as before.
- **Moderation trade shred (Plan 7 Task 2):** `mod_lien_recoveries` and `mod_lien_rate_taps` no
  longer reference `signed_terms`. The shred keeps their rows and blanks the trade code
  (`TRADE_SHRED_KEPT`), so a signed recovery keeps counting against its lien (rule 2) and a spent
  rate tap stays spent. `mod_lien_recoveries` has its own id. One row per trade still holds while
  the code is kept (a partial unique index). Tested in tradeShred.test.ts.
- **API trade purge:** a hold whose trade the purge deleted no longer counts (`HOLD_COUNTS_SQL`
  requires the trade row), and `releaseStaleHolds` releases it, so `complied` is never blocked by a
  purged trade.
- **Comply route (Plan 4 Task 12, on main):** `complied` now comes from the seller's accepted tx
  proof (disputes/comply.ts). While the debtor has an open hold that still counts, `applyLienRules`
  refuses `repaid` (409 `lien-recovery-in-flight`, review M2), and that rolls back the proof's
  acceptance. On the timer (`runPendingProofs`) the proof stays waiting and is tried again next pass.
  On `POST /v1/trades/:code/payment-proof` with enough confirmations, the seller gets the 409, and
  the web has no wording for it. NEEDS_LIEN_COMPLY_IN_FLIGHT, a lead call before liens are switched
  on: either accept the proof and leave the in-flight recovery to `lien.over-recovered`, or keep the
  proof waiting (202) until the hold ends. Until that is decided, the comply deadline could lapse for
  a seller who has paid.
- **Retention (NEEDS_RETENTION_LIEN_SOURCE, owner and lead):** main's trade purge deletes a disputed
  trade 90 days after its last dispute closed (its dispute rulings too). The moderation shred then
  deletes its `signed_terms` and the gate forgets its rulings. From then on the moderation service
  can no longer verify the lien's source (`attested fromCode`, `lienRulingVerifier`, the creditor's
  identity for the recovery address), so every later recovery for that lien is refused
  (`lien-refused-*`). The lien stays, and recovery stops. Closing this means pinning, at first sight in
  `mod_liens`, what the checks need: the creditor side's identity and the gate-verified creditor
  sides. Or keeping a lien's source trade while the lien is active, which touches the owner's
  30/90-day purge statements. The API's `lien_recoveries` and `lien_recovery_holds` keep the trade
  code of every recovering trade after the purge, as `liens.from_code` and the activity log do.
  NEEDS_PRIVACY_LIEN_DISCLOSURE should say so.
