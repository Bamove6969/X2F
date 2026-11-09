# Plan 3: Offers and the trade flow (web app) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Revision 2026-10-29 (Task 10 as built, second, `wip/second-p3-task10`; not reviewed yet)

Authority: spec > `rulings-and-lessons.md` > earlier revisions > this note. Details: `docs/coordination.md`, "Plan 3 Task 10".
- **`escalate` from `refund_requested`** (Task 2): a system `escalate` with coins in the escrow is also allowed from `refund_requested`, for the moderation service's two new reports `alert-unseen { trade }` (no seen-receipt 15 min after the shadow's final alert) and `refund-unverified { trade }` (the API has shown `refund_requested` for 60 min and the moderator's own records do not allow the auto-refund: a `trade.paid` was opened, no seller-signed terms, the shadow is not `refund_requested`, or the guard refused). Both are internal reports applied as `escalate` (exact keys, attested trades only).
- **The watch list carries the receipt**: `GET /internal/v1/watch` items are `{ trade, state, finalAlertSeenAt }`, the last being `final_alert_seen_at` only while `final_alert_delivered` is true, else null.
- **Receipt younger than 15 min = wait** (decision for the lead, see coordination.md): the moderator signs only at `max(shadow.finalAlertAt, final_alert_seen_at) + 15 min`; it escalates only when no receipt exists at `shadow.finalAlertAt + 15 min`.
- **Superseded by the fix round of 2026-10-30 (lead decisions on the review of 2026-10-29):** the watch list also carries the API's pause-shifted `finalAlertAt`; the moderator signs only at `max(shadow.finalAlertAt, api.finalAlertAt) + 15 min + 60 s` and at `final_alert_seen_at + 15 min + 60 s`. A receipt more than 2 min after that alert escalates (`alert-late`, a new internal report applied as `escalate`), so a late-alerted buyer always gets a person, never a refund. A `trade.paid` with the API still in `refund_requested` 2 min later escalates `refund-unverified` at once. Buyer cancel (owner option B): never co-signed once the mod opened the buyer's `trade.paid`, nor for a cancel its shadow refused, nor unless the API shows funding/securing/secured/refund_requested or settling as `buyer-cancel`.
- **Fix round 2 (re-review of 2026-10-30, lead 03:00):** the `alert-late` check compares the receipt with the EARLIER of the shadow's and the API's alert + 2 min (the wait keeps the later one). An armed buyer cancel is rechecked every pass (`trade.paid` opened, or an API state it may not be signed in: not handed over again). A `409 wrong-state` answer to an escalation is logged `escalate-wrong-state`. The watcher proves a shown sweep against the API's refund kind (`auto-refund`, `buyer-cancel`, `lapse-refund`) only when the desk's own facts agree (`sweepKindAgrees`), else it stays unproven and the 6 h fallback escalates; `release` vs `mutual-cancel` stays owed under Task 9 R2-M1 (needs a seller-signed `trade.release` and a both-signed cancel accept). Deploy: NTP on the API and moderation hosts; trades in flight at the first deploy are delayed, not lost (coordination.md).
- **Fix round 3 (re-review of 2026-10-30, lead 07:13):** while a buyer cancel is armed and the API is not settling it as `buyer-cancel`, the desk also runs the auto-refund guard: on `sign` it re-arms as the seller-built `auto-refund` (identical payouts; the party replaces the uncommitted earlier outcome, a committed buyer-cancel tx is the mod's own and lands), on `escalate` it reports (R3-N1: a buyer could otherwise switch off the seller's auto-refund for good by never building the cancel). Documented limits: an outcome already handed to the party is not withdrawn when an armed cancel becomes blocked (R3-M1, only the buyer can build it and it pays the seller; withdraw owed to a later task); the `lapse-refund` veto can send an honest lapse to a person when funds land between the API's and the shadow's `fundBy` (R3-M2, fail safe). Details in coordination.md.
- **Signal schema in `@x2f/trade`** (`signals.ts`: `SIGNAL_TYPES`, `SIGNAL_SENDERS`, `signalPayloadOk`, `parseSignalDeal`, `signalAddressKey`), used by apps/web and apps/moderation. `trade.ack { of }` is sealed to the sender alone and `of` must name a signal type. The moderator acks every signal it accepts, including each copy of matching `trade.terms`; terms that differ from the attestation are never adopted and never acked.
- **Moderation**: migration `004_signals.sql` (`signed_terms.seller_terms` / `buyer_terms`: the address and the sealed envelope; `mod_trade_desk`: guard, seq, shadow trade, flags, armed refund). The desk (`desk.ts`) is opened with each party and stepped by the watcher after its reports were accepted. A refund once armed is kept and re-derived from the party's balance; buyer cancel is checked before the auto-refund and is not stopped by an earlier escalation (an armed buyer cancel may be re-armed as the auto-refund, fix round 3).

## Revision 2026-10-29 (lead decisions A and b, Task 9 I/O; Task 2 state machine)

- **`escalate` from `settling`** (Task 2): a system `escalate` is also allowed from `settling` while the escrow holds coins: the moderation watcher's `spend-unshown` (a settlement the moderator was not shown spending the escrow 6 h after it started, or after the release was claimed).
- **`release-claimed`** (Task 2, new system event; lead decision b): the moderation service received a trade party's sealed post-release info (`spend.info`, or `spend.claim` when the info is too big to send), imported or not. Only from `settling`, once per settling episode (else `wrong-state`); sets `releaseClaimedAt` (column `trades.release_claimed_at`, migration `113_release_claim.sql`). While set, the signing window does **not** return the trade to `settleFrom`: `tick` leaves it `settling` and `nextDeadline` is null; it ends only with `settled` (the sweep shown), the watcher's 6 h `escalate`, or a party's `open-dispute` after `settleBy` (unchanged). `startSettling` clears it, so a new episode starts unclaimed.
- **Fix round (review of 2026-10-29, M4, M5):** the machine accepts `release-claimed` once per settling episode, but the watcher reports a claim **once per trade** (a party sends its spend info once per trade, so a later episode never gets a second claim), and only on a pass that sees the trade `settling` (M1: an early claim waits for it). An escalation from `settling` (`spend-unshown`) leaves `settling`, `settleFrom`, `settleBy` and `releaseClaimedAt` set on the `disputed` trade, as `open-dispute` does; nothing reads them outside `settling` today, but Task 27 (disputes) and Plan 4 rulings must not take them as live. A sweep shown after such an escalation is `settle-kind-unknown` from `disputed` (the watcher backs off) and needs a moderator.
- **Fix round 2 (re-review of 2026-10-29), accepted residuals and owed items (review R2-M2, R2-M1):**
  - A release's proof minimums use the **take-time** amounts from `signed_terms`: the buyer of a trade that grew after the take can be shorted by the growth and the sweep still counts as proven.
  - The fee allowance on payout 0 (the network fee comes off it) lets the buyer be short by up to `MAX_NETWORK_FEE`.
  - A closed escrow with no shown sweep (or with coins no shown sweep took) keeps its relay channels registered past the watcher's 30 days, and the relay keeps registrations forever: **a relay-side expiry is owed** (Plan 4 or the relay task).
  - ~~**Owed (R2-M1):** … Take the kind from moderation's own shadow trade once Task 10 builds it.~~ **Corrected in fix round 3:** Task 10's shadow trade cannot close it (it has no release or mutual-cancel signal, so from `paid` it cannot tell the two kinds apart, and its watcher still passes the API's `settleKind`). R2-M1 (a compromised API naming the kind that pays the party who built a fresh decoy tx) is closed instead by the R3-I1 rule below: neither party alone can get a tx counted. *Task 10 fix round 2 (2026-10-30), defence in depth:* the watcher proves against an API refund kind (`auto-refund`, `buyer-cancel`, `lapse-refund`) only when the desk's own facts agree (`sweepKindAgrees`). **Still owed (follow-up task):** the shadow cannot check `release` vs `mutual-cancel` (no signal for either); that needs a seller-signed `trade.release` signal and a both-signed cancel accept on the signals channel, fed to the shadow.
- **Fix round 3 (re-review of 2026-10-30):**
  - **R3-I1 (security):** the ring binding assumes honest decoys, but the builder of a tx chooses them: a seller who builds trade B's release can put trade A's escrow output in a ring and forge mod A's partial key images, so trade A's proof passes for T_B and `mod_sweeps` counted whichever trade claimed first (A marked released, A's buyer paid fiat for nothing). **Rule (built):** a sweep the mod sees only through an import counts only when BOTH trade parties' sealed `spend.info` name its tx hash (one `txKey` may be `''`; a key must prove the minimums). Liveness cost (round-4 m2): EITHER party alone can push an honest release into a 6 h `spend-unshown` dispute against an innocent counterparty: by not sending `spend.info` (offline before it is acked, e.g. a paid buyer who never reopens the app, or a modified client), by an early `spend.info` naming a wrong tx (the mod keeps the first per sender), or by dusting the escrow so both exports exceed `SPEND_INFO_MAX_HEX` (only `spend.claim`, no hash). No coins are at risk. **Owed:** let the dispute desk (Plan 4) auto-close a `spend-unshown` dispute when the escrow is empty (or move `txHash` into `spend.claim`), and count these disputes separately on testnet to measure the rate. Accepted residual: a trade whose buyer and seller are one person (or collude) can still name another trade's tx on both sides and claim it first; that griefs the other trade (it escalates through its 6 h fallback) but pays nobody.
  - **R3-M1, owed to Plan 4 and a MAINNET PREREQUISITE:** `WatchState.channelsClosed` is never reset, so a coin that arrives after a full close escalates (`late-funds`) with both relay channels gone, and returning it needs a 2-of-3 signing over the escrow channel. Not contained in Task 9: the relay's close ends every socket with 4404 (`unknownTrade`), which `wsTransport` treats as fatal, so re-registering the channels must come with restarting the mod party on them and both clients rejoining; build it with Plan 4's late-funds handling, before the first mainnet deploy.

## Revision 2026-10-24 (Task 8 as built; updated 2026-10-28 after the Task 8-b review)

Deviations in the built Task 8 (review APPROVED 2026-10-28). Authority: spec > `rulings-and-lessons.md` > earlier revisions > this note.

- **`verifyAttestation` binds the trade, the exact channel set and both keys** (lead security finding on the first push): the signature is `verifyAttestation(a, sig, modSigningPublic, me: { trade: string; role: 'buyer'|'seller'; signPublic: string; boxPublic: string; context?: 'trade'|'chat'; deal?: ConfirmedDeal; ownAddress?: string })`. It throws `wrong-trade` unless `normalizeTradeCode(a.trade) === normalizeTradeCode(me.trade)` (a validly signed attestation for another trade is refused); `wrong-channel` unless the channel keys are EXACTLY `escrow`+`signals` for a trade (`context` default) or exactly `chat` for a chat, each equal to `channelFor(trade, kind)` (so `{}`, a missing or an extra channel is refused); `not-me` unless my slot holds BOTH my `signPublic` and my `boxPublic`; and `wrong-terms` (lead answer 4) unless a trade attestation carries `terms: { deal: { poster, takeAmountAtomic, currency, centsPerXmr, maxFiatCents }, buyerPayout, sellerRefund }` (exact keys, decimal strings) whose deal equals `me.deal` and whose own-role address equals `me.ownAddress` (both required for a trade; a chat attestation must carry no terms). Every caller passes the trade, deal and address from its own state, never from the attestation. `isAttestedTerms` checks the terms shape for the API and moderation.
- **`escrowCheckWords` is async** (`Promise<[string, string, string, string]>`), like `channelFor`: SHA-256 comes from WebCrypto so the same code runs in the browser. Words: the high 44 bits of SHA-256(`x2f/escrow-check/v1\0` + canonical JSON of the participants + `\0` + address) as four 11-bit indices into the bundled BIP-39 English list (`packages/trade/src/wordlist.ts`, pinned by its canonical sha256).
- **Task 8 builds on Task 6's `trades` table** (`103_trades.sql`, on the main line since 8ce8f80): Task 8's own migration is `apps/api/migrations/111_trade_identities.sql` (renumbered from 106 at the 2026-10-28 merge: 106 is reserved for Task 20's `106_chat.sql` and 110 is taken by the disputes branch) and holds `trade_identities`, `trade_attestations`, `trade_refusals` (moderation's terminal refusals) and `trade_work_served` (when each trade was last served as work; deleted once it is attested or refused), each with a foreign key to `trades(code)`. The role is the session account's slot in `trades` (`buyer_account_id` / `seller_account_id`). The internal work list serves only open trades in `setup` (`closed_at` null) with both identities and both addresses, no attestation and no refusal, never-served first, then least recently served, then `taken_at`; each item carries the trade record's terms (the amount at take is `coalesce(grown_from_atomic, amount_atomic)`). A posted attestation is stored only with exactly those terms (else 409 `terms-mismatch`; missing or malformed terms 400). `GET /v1/trades/:code/attestation` is 200, 202 while pending, or a final 409: `attestation-refused` (refused) or `trade-closed` (closed before any attestation); `POST /v1/trades/:code/identity` answers 409 `identity-exists` or the final `identity-conflict` (the other slot holds the key). A trade the caller is not in is 404 `not-found`. The routes are exported as `tradeIdentityRoutes` (Task 6 owns `tradeRoutes`). (The first push created its own `trades` table in `101_trades.sql`; that collided with Task 6 and was dropped.)
- **Shared formats in `@x2f/trade`**: `identityProofBytes`/`identityProofValid` (the registration proof, checked by the API and again by moderation) and `internalSignedBytes` (moderation-signed internal requests: `x2f/api-internal/v1\0` + method + `\0` + path + `\0` + at + `\0` + hex SHA-256 of the body, in headers `x2f-mod-at`/`x2f-mod-sig`; ±60 s and a replay cache, else 401). Moderation rebuilds the relay register message itself (it may not import `@x2f/relay`, which loads fastify).
- **Moderation**: work with malformed or missing terms is logged (`bad-terms`) and skipped, never refused for good (only bad proofs and equal keys are final refusals). `ModPartyArgs` (defined once in `@x2f/trade`) carries the attested `terms`, taken from moderation's own `signed_terms` record, never from a later API read. Deploy the API before moderation (docs/coordination.md).
- **Addresses never change once both are set (Tasks 5 and 19 must keep this).** A trade's `buyer_payout` and `seller_refund`, and the deal fixed at take, are written once (at take or accept) and never updated while the trade is open (only the 90-day purge nulls them after close). Moderation signs them once and caches that signed attestation; a later change would leave the trade looping on 409 `terms-mismatch`, and the devices check them against what their users confirmed.

## Revision 2026-10-25 (lead-approved deviation, Task 19 as built)

The final alert's delivery proof is stricter than the Task 19 interface text, approved by the lead. The Task 19 lines below are corrected to match. Authority: spec > `rulings-and-lessons.md` > earlier revisions > this note.

- **`final_alert_delivered` is set true only by the buyer's seen-receipt** (`POST /v1/trades/:code/final-alert-seen`, posted only by Task 25's `FinalAlert` while the alert is on screen; lead 2026-10-27: the live event reaching a tab and the service worker showing a push are not receipts, and the account-wide route was removed). Nothing else writes it: an open stream or a push service's 201 is not proof that the buyer saw it. Otherwise it stays null.
- **Task 10 treats null as false:** no auto-refund on a null or false proof; the refund escalates to a moderator instead.
- This is stricter than the earlier `delivered || pushAccepted` (an open SSE stream, or a push service accepting the push, counted as delivered).

## Revision 2026-10-23 (Task 7 as built)

Four deviations in the built Task 7, all accepted in its first review. The interface text below (Task 7 Interfaces, Global Constraints) is corrected to match. Authority: spec > `rulings-and-lessons.md` > earlier revisions > this note.

- **`channelFor` is async** (`channelFor(code, kind): Promise<string>`): it derives the channel ID with WebCrypto HKDF-SHA256, which is async and works the same in the browser and Node (it matches Node's `crypto.hkdfSync` vector). Every caller awaits it.
- **Unregistered-channel join closes with 4404, not 4401**: a client that joins a channel the relay has no registration for is closed with 4404 (the same "unknown channel" code used by the signed close), per R20 and the owner ruling of 2026-10-17, which outrank the plan's earlier 4401.
- **Admin replays are refused with 409 `replay`**: the admin listener remembers each moderator-signed message (by the hash of its signed bytes) for two freshness windows (2×60 s, capped at 10 000 entries, then 503) and refuses a duplicate with 409 `replay`, so a captured register or close call cannot be replayed (e.g. to reopen a closed trade). Registering a channel that already exists is 409 `exists`.
- **`buildRelay`'s admin argument and the admin listener's address**: `buildRelay(overrides, log, admin?: { modSigningPublic })` takes the admin options as its third argument and returns `relay.admin` (a Fastify instance, or `null` when built without admin options) for the caller to listen on; the private listener's host/port are set by `main.ts` from `RELAY_ADMIN_HOST`/`RELAY_ADMIN_PORT` (default `127.0.0.1:8788`), not a `buildRelay` `adminPort` field. The admin listener must stay on a private interface.

## Revision 2026-10-21 (owner)
- **Funding guard (spec 2.2):** Task 22 TradeFund: the "Open in <wallet>" funding control is a press-and-hold (1.5 s, the Task 14 `HoldButton`) that works once per trade view and then shows "Waiting for your payment…" (the QR/copy fallback stays visible until funded); once `receivedAtomic >= sellerFundsAtomic` is seen (any confirmations), TradeFund replaces the address, QR, copy button and wallet link with "Escrow funded" and never renders them again for that trade (the API's TradeView stops returning the funding URI/address to the seller once funded). Tests: a second hold does nothing; after funding the DOM contains no escrow address or `monero:` URI; reload after funding still shows none.

- **Gift cards (spec 11.8, owner 2026-10-21):** Tasks 3/4: methods in the "Gift cards & vouchers" group carry a `giftCard: true` flag; a gift-card offer requires the card's country and currency; Tasks 18/21/22/23 show one bold warning, exact copy: "When trading Monero for gift cards, you accept all risks and responsibilities that come with gift cards. Buyer beware." (owner, 2026-10-21; no per-card risk lists).

## Revision 2026-10-21 (lead decision)

Second review of Tasks 1–2, decided by the lead. Authority: spec > `rulings-and-lessons.md` > this revision > Revision 2026-10-20 > earlier text.

- **Growth only on releasable coins** (Task 2, I-A): extra XMR grows the trade only while the escrow is `releasable` (every coin unlocked, 10 confirmations). On every `chain` event in a growth state the size is worked out again from `grown.fromAtomic` (the amount at take) and the current balance, so a dropped or double-spent extra shrinks the trade back (`grown` returns to `null` when it is back at the take amount) and the trade never needs more than the escrow holds. While some coins are still locked the trade keeps at most its current size. The other growth rules of Revision 2026-10-20 are unchanged (no growth from `paid`, `refund_requested`, `settling` or `disputed`; any dust stays a seller output).
- **`settled` also from `funding` and `securing`** (Task 2, I-B): a buyer-cancel from either state can time out back there before its refund lands; the refund is then recorded as `refunded` with its `txHash` and `closedAt`, so the buyer keeps the 90-day dispute-after-refund window.
- **`mark-paid` carries the total the buyer confirmed** (Tasks 2, 6, 23, I-C): the event is `{ type: 'mark-paid'; fiatCents: bigint }` and is refused with the new rule code `total-changed` unless `fiatCents` equals the trade's current `fiatCents`, so a growth just before the tap can never record a bigger total than the buyer saw.
- **`lapsedAt` moves with a pause** (Task 2): on `resume`, `lapsedAt` shifts by the pause's length when the lapse co-sign window (`lapsedAt + lapseCosignMin`) was still open at the pause, like `finalAlertAt`.

## Revision 2026-10-20

Owner decision of 2026-10-20 (spec 11.1, item 1) and the Tasks 1–2 review fixes. Authority: spec > `rulings-and-lessons.md` > this revision > Revision 2026-10-18 > earlier text.

- **Extra XMR replaces "surplus to the ad poster"** (Tasks 1, 2, 7, 9, 10, 12, 31): (a) extra XMR that arrives before "I've paid" grows the trade when the grown fiat total, at the same locked rate, stays within the offer's minimum and maximum recorded at take (`newTrade` takes `minFiatCents`/`maxFiatCents`). Seller-poster: the new amount is the largest A' with A' + feeFor(A') <= received, any dust left goes to the seller; buyer-poster: A' = received. Amount, fee (exact feeFor(A')), seller funds and fiat total are recalculated; `trade.grown = { at, fromAtomic, fromFiatCents }` tells both apps to show the new totals ("Trade grew to 1.05 XMR, you now pay $X"). (b) Above the offer maximum, or arriving after "I've paid", the amount does not change and the surplus is its own output to the seller on release. (c) Every refund or cancel (mutual-cancel, buyer-cancel, auto-refund, lapse-refund) pays the whole balance to the seller's refund address. The open question "surplus on an automatic refund to a buyer-poster" is resolved: the seller. Every "surplus to the poster" in Tasks 1, 7, 9, 12 and 31 now reads "surplus to the seller"; `cosignPolicy` refuses a surplus paid to anyone but the seller.
- **`settled` is a chain fact** (Task 2): accepted from every open funded state (`secured`, `settling`, `disputed`, `paid`, `refund_requested`, `lapsed`); `release` → `released`, every other kind → `refunded`. `mark-paid` in `refund_requested` is refused `too-late` once `now >= finalAlertAt + 15 min` (frozen during a pause).
- **Maintenance** (Task 2): while `pausedAt !== null` every client event except `mark-paid` and `buyer-cancel` is refused `wrong-state`. `resume` shifts each deadline at or after `pausedAt` by `now − pausedAt`; deadlines set while paused count from the pause, so they run from the resume.
- **Smaller Task 1–2 fixes**: `escalate` needs `receivedAtomic > 0n`; a lapse with nothing received closes (`closedAt`), and `lapsedAt` is recorded; `rateFor` keeps the rate positive and caps the margin at ±50%; `payoutsFor` refuses duplicate addresses; `newTrade` refuses a zero fiat total and `confirmWindowMin > 1440`; `mark-paid` clears a seller's pending cancel proposal (a buyer's stays).
- **Task 22 (exact funding amount):** the `monero:` link, QR and copy button always carry exactly `sellerFundsAtomic` (re-read after a `grown` change), and the screen says "Send exactly this amount". Extra XMR is handled by the rule above; TradeFund shows the grown totals to both sides when `trade.grown.at` changes, and the buyer's screen offers Cancel if they cannot pay the new total.
- **Tasks 3 and 4 (currency decimals):** "cents" means the currency's ISO 4217 minor unit, which is 0 (JPY, KRW), 2 (most) or 3 (KWD, BHD, JOD, OMR, TND) places. Task 3 publishes each supported currency's exponent with the price; Task 4 validates `min_fiat_cents`/`max_fiat_cents` in those minor units, and `formatFiat` must take the exponent instead of assuming 2 before any non-2-decimal currency is enabled. Until then the offer form accepts only 2-decimal currencies.

## Revision 2026-10-18

Owner decisions of 2026-10-17 and the built Plan 1 code applied before building. Authority: spec > `rulings-and-lessons.md` > this revision > earlier text (including Revision 2026-10-15 below, which stays as history).

- **No buyer deposits** (spec 2.5, 11.4): `depositFor`, `DEPOSIT_RULE`, `depositReceived`, `toUsdCents`, subaddress 1, `depositAddress`, `depositBy`, `depositMin`, `deposit-missing`, `DepositFund`, the Deposit quote row, `depositRequired` and every deposit branch in `escrowPlan`, `payoutsFor`, the state machine and the tests are removed. P3-C3's deposit parts, P3-I7 and OD-3 are void (Tasks 1, 2, 4, 5, 7, 9, 18, 22, 31).
- **Buyer cancels alone** (spec 2.3): new client event `buyer-cancel` (buyer only, any state after funding; before funding the trade just ends) and `SettleKind` `'buyer-cancel'`. The buyer's app builds the refund and the moderation service co-signs it automatically, only to the seller-signed refund address, through a new pure guard `buyerCancelDecision` next to `autoRefundDecision`. One tap before I've paid, the strong warning after. The seller can never cancel alone after funding (Tasks 2, 6, 7, 10, 12, 23, 31). *2026-10-29b: no cancel after I've paid; the buyer's cancel after funding is OPEN (option A or B); see Revision 2026-10-29b.*
- **Surplus to the ad poster** (spec 11.1; rulings Task 5 I1; plan-1-review finding 3): payouts sweep the observed escrow balance; anything above `sellerFundsAtomic` goes to the poster as its own output, or is added to their payout when they receive; the fee output stays exact. Settlement and `secured` wait until balance == unlocked (10 confirmations), with no time cap; `settleBy` only runs while the escrow is fully unlocked (Tasks 1, 2, 7, 9, 12, 31).
- **Network fees** (spec 11.1): the seller pays the funding fee in their own wallet; the release or refund fee comes off payout index 0, which is always the party receiving the trade's XMR, never the fee output. A seller-poster funds amount + 1% (Tasks 1, 22; OD-4 decided).
- **A payout wallet before trading or posting** (spec 6.4): `POST /v1/offers`, `take` and the accepted sheet refuse an account with no usable wallet (409 `no-wallet`), and the app sends the user to Add a wallet with `returnTo`. The first wallet in setup skips confirm-it's-you (Plan 2 R12); later ones go through `ConfirmSheet` (Tasks 4, 5, 18, 19, 21, 28).
- **Terms of Service first** (spec 6.1 step 0; Plan 2 R10): Task 28 adds the Terms screen (scroll to the end, tick, I accept) before Username, and every register call sends `acceptedTerms`. The `api` client turns 403 `terms-required` into the same screen with `returnTo` (Tasks 13, 28, 30).
- **Starter limits for new accounts** (spec 2.3, owner 2026-10-24; see the revision at the end of this plan). The offer's "Minimum completed trades" (Anyone, 5+, 10+, 50+) also stays (Global Constraints, Task 4).
- **Offer pricing** (spec 2.2 step 5): offers are `market` (margin ± %, the default) or `fixed` (a price per XMR). PostOffer warns "A fixed price goes stale when the market moves." (Tasks 4, 21).
- **Relay keeps messages until the trade closes** (rulings Task 7, owner 2026-10-17): no retention timer; the relay admin listener gains a signed close call, and moderation closes both channels when the trade reaches `released`, `refunded` or `cancelled` (Tasks 7, 9).
- **No IP logging anywhere, including disputes** (spec 4.1; Plan 2 R5): stated in Global Constraints; `trustProxy` is never set on any Plan 3 server (Global Constraints, Tasks 7, 11).
- **Plan 1 as built** (rulings Tasks 7–8): `Outcome = { kind: 'release'; to; builder; cosigner }`; `settle` already waits for balance == unlocked == sum(payouts), runs a fresh export per attempt and keeps a counterpart's release messages per outcome tag until the local `settle` names that outcome. So Task 7 drops `address(index)`, `pending()` and `refresh()`; every party derives the outcome itself from `payoutsFor` and passes it to `settle`. `channelFor` returns a 16-character trade-code-shaped ID, because the relay keys trades by `normalizeTradeCode`. `requireTrader` = Plan 2's `requireSession({ kinds: ['trader'] })` (403 `wrong-account-kind`) (Tasks 7, 8, 10, 12; Plan 2 interface block).
- **Plan 1 security follow-ups** (rulings "Follow-ups for Plan 3", plan-1-review open items), all in Task 7 with tests: `txSeen` goes through monero-ts's daemon client via the node proxy and counts only a tx in a block; the builder accepts a DONE only once its own wallet sees the escrow spent by that tx hash; a submit refused for good stops retrying once the watcher sees the escrow's inputs spent; every daemon call gets a 15 s timeout; `from` is taken from `open()`'s result; the escrow wallet password is a random 32-byte secret stored apart from the saved session (R27, Tasks 8, 12). The timers send the final alert only after `payBy`, and moderation checks `finalAlertAt > payBy` before calling `autoRefundDecision` (Tasks 2, 10).

**Open questions for the owner** (built with the safe default shown):
- **Surplus on an automatic refund to a buyer-poster.** The moderator may only sign a payment to the seller's refund address (spec 3.3), so a no-show refund or buyer cancel on a buyer's ad pays the whole balance, surplus included, to the seller. Default: keep it that way; the other choice would widen the moderator's guard.
- **Spec 3.1 and 3.3 still list one automatic exception.** The buyer-cancel refund (spec 2.3) is a second one. Proposed edit: add "Buyer cancels (automatic) | moderator service + buyer, refund address only" to the 3.1 table and a matching bullet to 3.3.
- **Fixed-price offers while the price feed is down.** Default: a fixed-price offer can still be taken (its price does not use the feed); market offers show "Price unavailable right now".
- **Terms board.** The Terms screen is on the canvas (Getting started, screen 0) but not mirrored in `design/x2f-app/`; Task 28 mirrors it as a controller step. The Terms text itself waits for the lawyer.

## Revision 2026-10-15

This revision applies every Plan 3 finding and cross-plan item in `2026-10-15-plans-2-3-review.md`. Each line says how the item was resolved. "OD-n" means the plan builds a default and the owner confirms it (see Owner decisions).

- **P3-C1** The moderator party moves out of the API into `apps/moderation`, a separate process with no inbound network surface and its own database. It signs a participant attestation, and each trader's app verifies the attestation against a pinned key and checks its own slot. The seller's refund address comes from a seller-signed envelope. The moderator signs only a guarded auto-refund, and Plan 4 rulings through a verifier that refuses everything in this plan. Both trader apps show escrow-check words. Tests: a swapped participant list aborts setup, and a static separation check (Tasks 8, 10, 12; OD-1).
- **P3-C2** `chain`, `setup-done`, `settled`, `tick`, `pause`, `resume` and `escalate` require `by === 'system'`. The events route accepts only a whitelist, and `by` comes from the session (Tasks 2, 6).
- **P3-C3** Each side funds its own escrow subaddress. Payouts use `depositReceived`, and each side gets its own excess back. Tests cover a deposit that is unpaid, part paid and fully paid (Tasks 1, 7).
- **P3-C4** New Task 30: Log in, confirm-it's-you and Security settings.
- **P3-I1** The assumed block is replaced by "Plan 2 interface (consumed)" with Plan 2's real names. The "delete Task 16" clause is removed.
- **P3-I2** HMAC tickets are dropped. The relay gets a private admin listener that verifies a moderator-signed registration and calls `registerTrade`. Access uses Plan 1's join challenge, and channels are derived IDs, never the trade code (Tasks 7, 8).
- **P3-I3** The runner buffers one `release.txset` until the local `settle`. A fresh `state.export` round follows any abandoned tx set. `proposed` comes from `pending().payouts`, which is decoded by `describeMultisigTxSet`. There is a regtest test for refund, then paid, then release (Tasks 7, 10).
- **P3-I4** `secured` and `releasable` follow unlocked balances after the post-funding export round, not a confirmation count. A "Releasable in N min" chip is added, and tests mine 12 blocks (Tasks 2, 9, 23, 31).
- **P3-I5** Added `setupBy` (15 min, then `cancelled`) and `settleBy` (15 min, then back to the previous state, with dispute allowed). One test each (Task 2).
- **P3-I6** Option B: a lapse or late funds that the buyer's app does not co-sign within 30 min escalate to a human moderator (Plan 4). The watcher keeps watching closed escrows for 30 days (Tasks 2, 9; OD-2).
- **P3-I7** Task 22 adds the buyer's deposit funding (link, QR, chip, missed-deadline copy). `depositFor` takes USD cents from the price feed and has a configurable large-trade knob (Tasks 1, 22; OD-3).
- **P3-I8** `take` always requires the taker's `walletId`. The poster picks theirs on the "accepted your offer" sheet while the trade waits in `setup`. At most one trade awaits funding per buy ad and amount, tested with five concurrent sellers. Review Focus 4 is reworded (Tasks 5, 19).
- **P3-I9** D1 and D2 are promoted to real tasks: Buy browse (Task 17), BuyQuote (Task 18), and DisputeOpen, DisputeRoom and DisputeRuling for traders (Task 27). Moderator tools stay in Plan 4.
- **P3-I10** Default (a): the network fee comes off payout index 0, as in Plan 1. BuyQuote's "Paid by <seller>" copy changes on the canvas (Tasks 18, 31; OD-4).
- **P3-I11** The rate and fiat total lock at `take`. Test: the fiat total at funding equals the quote (Tasks 2, 5, 22; OD-5).
- **P3-I12** `trade_events` stores no addresses (only `addressEnd`). A purge role nulls `buyer_payout` and `seller_refund` 90 days after close, never while a dispute is open, and the purge is tested (Task 6).
- **P3-I13** Web Push is in Plan 3, with only the two generic payloads. An auto-refund needs proof that the final alert was delivered, otherwise it escalates (Tasks 10, 19).
- **P3-I14** Wallet copy is changed so it no longer claims a PGP backup. The escrow-key PGP backup is assigned to Plan 6, matching spec 10 phase 3 "PGP-encrypted backups". The lost-device test is in Task 10 (Tasks 29, 33).
- **P3-I15** Added `Referrer-Policy: no-referrer`, COOP and HSTS. Explorer links use `rel="noreferrer noopener"`. Request logging is off, and a log-grep test checks for trade codes (Tasks 6, 13).
- **P3-I16** Old Task 4 → Tasks 4–6. Old Task 6 → Tasks 7–10. Old Task 8 → Tasks 13–15. Old Task 16 → Tasks 28–29.
- **P3-I17** Pinned fake-indexeddb, happy-dom, @testing-library/react, @types/react, @types/react-dom, @types/qrcode, @fastify/static, web-push and @types/web-push. One audit gate, `npm audit --omit=dev`. vite is pinned to 8.3.1 (published 2026-09-24).
- **P3-I18** New Task 32: a stagenet smoke run and a 25-trade load check.
- **P3-I19** System `pause` and `resume` events shift every deadline, and the timer loop does not tick while paused. Tested (Tasks 2, 9).
- **P3-I20** Methods with `legalReview` are refused (`method-unavailable`) and hidden on PostOffer. Tested (Tasks 4, 21).
- **P3-I21** Added a chat identity route. Identities are bound to one device, and the guard is persisted per chat. Envelopes are capped at 16 KiB. Chat storage in the API is recorded as an owner spec edit (Task 20; OD-9).
- **P3-M1** Test commands use `npm test -- --project <name>`.
- **P3-M2** Chat notice uses the spec 6.6 text. The Desktop board fix is a controller step (Task 20).
- **P3-M3** Fiat in both parties' currencies (Task 18), "What is this?" (Task 14) and "Suggest a missing method" (Tasks 3, 16) are built. "Use your own Monero node" is deferred to Plan 6, because it needs a CSP `connect-src` change.
- **P3-M4** The fee sentence goes on PostOffer and the onboarding Welcome screen, pending owner sign-off (Tasks 21, 28; OD-7).
- **P3-M5** Silent nudge drops return the same `202`. Distinct codes are kept only for the sender's own limits (Task 26).
- **P3-M6** `support.js` capture is a controller step. Pixel diffs are reported, not blocking, and the structural checks block (Task 15).
- **P3-M7** Task 31 lists the expected first failure, and every fix names its owning task.
- **P3-M8** "Builds on" lists all four Plan 1 amendments. Vite aliases `net` and `tls` to empty modules (Task 13).
- **P3-M9** Tested: browse routes need no session, participants and attestation need a participant session, and SSE carries only the viewer's own events (Tasks 4, 8, 19).
- **P3-M10** `disputeAfterRefundDays: 90` and buyer disputes before paying (`securing` and `secured`) are built as defaults (Task 2; OD-8).
- **P3-M11** Roadmap update: Nudge moves to Plan 3 (Task 33).
- **P3-M12** Funding copy no longer promises "fast" for wallet-sent funding. Added a manual iOS check of Cake and Edge `monero:` links (Task 22).
- **X-1** Plan 2 names are used throughout (see Plan 2 interface block). Nudge settings live at `/v1/account/nudges`.
- **X-2** No default payout wallet: the taker picks at take and the poster picks on the accepted sheet, every trade (OD-11).
- **X-3** Take, post, release and every trade write require `kind = 'trader'` and a full session.
- **X-4** Wallet adds during a take go through Plan 2's action-bound confirm. Task 30's confirm sheet is the only UI for it.
- **X-5** Option (a)'s device signing key is not needed for P3-C1 as resolved here. TOFU is listed as Plan 6 hardening.
- **X-6** Owners assigned in the roadmap (Task 33): security-key tap to fund → Plan 6, escrow-key PGP backup → Plan 6, require a security key to log in → Plan 6, Web Push → Plan 3.
- **X-7** API→relay registration is defined (moderator-signed admin call, Task 7), and Plan 1's relay interface is amended.
- **X-8** Every Plan 3 refusal code joins Plan 2's `ApiErrorCode` and is thrown as `ApiError`.
- **X-9** One origin, `credentials: 'same-origin'`. Plan 3 passes a same-origin `fetch` to `createAuthApi`.
- **X-10** Plan 3 migrations are `1xx`, one per task that needs schema.
- **X-11** Every plan uses the same gates: `npm audit --omit=dev` and `npm test -- --project`.
- **X-12** One retention scheduler runs `purgeExpired`, `purgeChats` and `purgeTradeAddresses` (Task 6).

---

**Goal:** A phone-first web app and API in which a seller picks a payment method, takes a buyer's offer (or posts one), funds a 2-of-3 escrow from their own wallet with a `monero:` link, the buyer pays fiat and taps I've paid, and the seller presses and holds to release; with the Buy side, mutual cancel, buyer cancel, extend, buyer no-show auto-refund, trader-side disputes, login and security settings, encrypted chat, nudges and push, every screen matching its X2F App board.

**Architecture:** A pure package `@x2f/trade` holds quote and payout maths, the trade state machine, channel IDs, attestations and escrow-check words, shared by server, moderation service and browser. `apps/api` (Fastify + PostgreSQL, from Plan 2) owns offers, trades, chat, nudges, push and the server clock; it holds **no escrow key of any kind**. `apps/moderation` is a separate process with no listening socket and its own database: it holds the moderator key and the long-term moderation signing key, attests participants, registers relay channels, watches the chain, and signs only the guarded auto-refund and buyer-cancel refund, both paying only the seller's signed refund address (Plan 4 adds rulings). Browsers run their own `runParty` in a Web Worker against `apps/relay` and `apps/node-proxy`, verify the attestation, and resume from IndexedDB. `apps/web` (React + Vite) implements the canvas boards.

**Tech Stack:** Node 24.22.1, npm 11.21.0 (`npx -y npm@11.21.0`), TypeScript 7.0.2 strict, vitest 5.0.3, React 19.3.0, react-dom 19.3.0, @types/react 19.3.0, @types/react-dom 19.3.0, react-router 8.4.0, Vite 8.3.1, @vitejs/plugin-react 6.1.1, @playwright/test 1.63.0, happy-dom 20.14.5, @testing-library/react 16.3.3, fake-indexeddb 6.2.5, fastify 5.12.5, @fastify/static 10.1.5, pg 8.23.1, qrcode 1.5.4, @types/qrcode 1.5.6, web-push 3.6.7, @types/web-push 3.6.4, lucide-react 1.49.0, @fontsource/familjen-grotesk 5.3.0, @fontsource/atkinson-hyperlegible-next 5.3.0, @fontsource/atkinson-hyperlegible-mono 5.3.0, Semgrep 1.178.0. Plus Plan 1's and Plan 2's packages.

**Spec:** `docs/superpowers/specs/2026-10-14-x2f-design.md` — sections 1, 2 (all), 3 (all), 4, 6.1–6.6, 7, 8, 9, 11. Boards: Claude Design **X2F App** (https://claude.ai/artifact/NRhrWVvBrSwJ1Dt8oxp4eH), mirrored in `design/x2f-app/*.dc.html`; tokens `design/design-system/tokens.json`; rules `design/design-system/README.md`. Review: `docs/superpowers/plans/2026-10-15-plans-2-3-review.md`.

**Builds on:** Plan 1, consumed as finalised:
- `@x2f/core`: `Role = 'buyer' | 'seller' | 'mod'`, `ROLES`, `newTradeCode`, `normalizeTradeCode`, `feeFor`, `X2F_FEE_BPS`.
- `@x2f/protocol`: `generateIdentity(): Promise<Identity>` (`signPublic`, `boxPublic` hex; `signSecret`, `boxSecret`); `seal(a: { trade; from; seq; type; payload; to: Role[]; me; participants }): Promise<Envelope>`; `open(e, { me; myRole; participants; trade; guard }): Promise<{ type: string; payload: unknown }>`; `Envelope = { v: 1; trade; from; seq; slots: Record<Role, string>; nonce; kh; ct; ctNonce; sig }` (`type` is inside the ciphertext); `ProtocolError` codes `bad-signature | not-participant | wrong-trade | replay | not-for-me | too-large`; `ReplayGuard` with `toJSON(): { trade; seen }` and `ReplayGuard.from(json)`; `Participants = Record<Role, PublicKeys>`.
- `@x2f/escrow` (as built): `EscrowEngine.create/resume({ daemonUri, password })`; `EscrowSession` (`address()`, `sync(): { balance; unlocked }`, `buildRelease`, `cosign`, `checkRelease`, `signRelease`, `submit`, `txSeen`, `save`, `close`); `Payout = { address; amountAtomic }`; `checkTxSet` (one tx, sweeps the whole escrow, no change, no unlock time, network fee ≤ 0.01 XMR taken from payouts[0]); `runParty(a: PartyArgs): PartyHandle` with `ready(): Promise<string>` (escrow address once all three confirmed it), `settle(o: Outcome): Promise<string | null>` (tx hash for the co-signer; a later call with another outcome replaces it unless this party already signed), `stop()`; `Outcome = { kind: 'release'; to: Payout[]; builder: Role; cosigner: Role }`; `PartyStore { load; save }`; `wsTransport({ url, code, role, me })` (signs `joinMessage(code, role, challenge)`; `send` returns void); `autoRefundDecision(facts)`, `FINAL_ALERT_MS`. `settle` waits until balance == unlocked == sum(payouts) and starts each attempt with a fresh export (R26).
- `apps/relay` (as built): `buildRelay(options, log)` → `{ app, limits, registerTrade(code, signPublics), closeTrade(code), stats }`. Trades are keyed by `normalizeTradeCode`; queues never expire and are deleted by `closeTrade`.

Plan 3 makes these additive amendments to Plan 1 code, all in Task 7: (1) `EscrowSession.incoming()` (per-tx confirmations, for the chip and late funds) and `PartyHandle.funds()`; (2) `buyerCancelDecision` beside `autoRefundDecision`; (3) the security follow-ups (`txSeen`, DONE check, chain-watched submit, daemon timeouts, `from` from `open()`); (4) a relay admin listener that verifies moderator-signed registration and close calls and runs `registerTrade` / `closeTrade`.

## Plan 2 interface (consumed)

- `buildApi(deps: Deps): Promise<FastifyInstance>`, `Deps = { config; db: pg.Pool; clock: () => Date; leaked; addresses }`. Route plugins register with `app.register(plugin, { prefix: '/v1' })` and use `deps.db` and `deps.clock` (never `new Date()`). Migrations: `apps/api/migrations/NNN_*.sql` via `npm run migrate -w @x2f/api`; Plan 3 uses `101`–`199`.
- Table `accounts(id uuid, username, username_key, kind 'trader'|'staff'|'owner', disabled_at, …)`; foreign keys are `account_id`.
- `requireSession(opts?: { allowRecovery?: boolean; kinds?: AccountKind[]; allowStaleTerms?: boolean })` sets `req.auth = { sessionId, accountId, kind, level, confirmedAt }`; 401 `not-authenticated`; 403 `account-disabled` (P2-I9); 403 `wrong-account-kind`; 403 `terms-required` `{ version }` for a trader on a stale Terms version (R10). Plan 3's `requireTrader` = `requireSession({ kinds: ['trader'] })`. Terms: `GET /v1/terms` → `{ version }`, `POST /v1/account/terms { version }`, `me().termsCurrent`; register finishes take `acceptedTerms`.
- `usableWallets(db, accountId, now): Promise<Wallet[]>`; `GET /v1/wallets` → `{ id, app, label, address, addressEnd, usableFrom, usable }[]`; `WALLET_APPS = ['cake','edge','feather','monerujo','stack','monero-gui-cli','ledger-trezor','other']`; `POST /v1/wallets` behind Plan 2's action-bound confirm (`walletAction(address)` → `{ kind: 'add-wallet', addressHash, addressEnd }` → `confirmToken`); the account's first wallet, added by the creating session during setup, needs no token (R12).
- `class ApiError(status, code: ApiErrorCode, extra?)`; Plan 3 adds its codes to `ApiErrorCode`: `own-offer`, `out-of-range`, `not-enough-trades`, `trading-hold`, `trading-paused`, `price-unavailable`, `method-unavailable`, `no-wallet`, `already-waiting`, `ad-busy`, `wallet-not-ready`, `wrong-state`, `wrong-party`, `too-early`, `too-late`, `no-extensions-left`, `not-releasable`, `event-not-allowed`, `identity-exists`, `bad-proof`, `too-soon`, `no-shared-context`.
- Browser: `createAuthApi({ baseUrl, fetch })`, `withConfirm`, `AuthApiError`, `registerWithWebAuthn`, `loginWithPasskey`, `loginWithSecurityKey`, `confirmWithWebAuthn`, `walletAction`; `me()` → `GET /v1/account/me`. Plan 3's `useSession()` (`apps/web/src/session/useSession.ts`) is a thin hook over `me()`; Plan 3 passes `fetch = (u, i) => fetch(u, { ...i, credentials: 'same-origin' })`.
- Plan 2 builds no screens; Plan 3 builds all of them.

## Owner decisions (built with the default; owner confirms before Task 31)

- **OD-1 (P3-C1)** Separate moderation process + attestation + seller-signed refund address + escrow-check words. Account device keys with trust on first use are Plan 6 hardening.
- **OD-2 (P3-I6)** Lapse refunds the buyer doesn't co-sign, and late funds, go to a human moderator. The alternative, a second automatic case, needs a spec 3.3 change.
- **OD-3 (P3-I7)** Decided 2026-10-17: no buyer deposits (spec 2.5, 11.4). Nothing to build.
- **OD-4 (P3-I10)** Decided 2026-10-17 (spec 11.1): the release or refund network fee comes off payout index 0, the party receiving the trade's XMR; the seller pays the funding fee in their wallet. BuyQuote copy changes to "Network fee · about 0.0001 XMR, taken from the payout".
- **OD-5 (P3-I11)** The rate and fiat total lock at Trade. Spec 2.2 step 5 wording changes from "The price locks at this moment" to "The price was locked when the trade started".
- **OD-7 (P3-M4)** Fee sentence: "You pay X2F 1% of each completed trade from your own ads. Taking an offer is free."
- **OD-8 (P3-M10)** Dispute after refund within 90 days; either side may dispute in `securing` and `secured`.
- **OD-9 (P3-I21)** Spec 8 gets the line "Chat envelopes are stored by the API (ciphertext only); the relay carries escrow and signal messages."
- **OD-11 (X-2)** No default payout wallet; always ask.

## Global Constraints

- **Custody (spec 1, 3.1):** X2F's servers hold at most one key per trade, the moderator's, and only inside `apps/moderation`. Buyer and seller escrow keys and trade identities are generated and kept on their devices. No API route accepts, stores or returns a secret key, and no X2F component can produce two signatures on its own. The moderator signs only the no-show auto-refund guarded by `autoRefundDecision` and the buyer-cancel refund guarded by `buyerCancelDecision`, each paying only the refund address the seller's own identity signed (Plan 4 adds rulings verified inside `apps/moderation`). This assumes an honest client bundle; tamper defence (SRI, native builds) is Plan 6.
- Every dependency is pinned exactly and was published at least 14 days before 2026-10-15 (`npx -y npm@11.21.0 view <pkg> time --json`). `npm audit --omit=dev` reports 0. `npm run check` (typecheck, tests, audit, Semgrep 1.178.0, copy lint, separation check) passes at the end of every task. Tests run as `npm test -- --project <workspace>`.
- Monero amounts are `bigint` atomic units everywhere; fiat is `bigint` cents. Shown as XMR with 6 decimals and fiat beside it in `ink-muted`.
- Fee: 1% (`feeFor`), paid only by the ad poster (the person whose ad was taken, buy or sell side), on released trades and settled disputes (owner, 2026-10-29c); cancels pay nothing. The taker never sees a fee line anywhere (quote, fund, pay, released). The poster sees `X2F fee (1%, your ad) −0.012500 XMR` above `You receive` on the released screen.
- Money in the escrow (spec 2.5, 11.1): only the seller funds it; there are no buyer deposits. The seller pays the funding fee in their own wallet; the release or refund fee comes off payout index 0, the party receiving the trade's XMR, never the fee output. Any surplus above `sellerFundsAtomic` goes to the ad poster; the fee output is always exact. Payouts sweep the whole escrow once balance == unlocked, with no time cap.
- Who may cancel after funding: the buyer alone at any time (moderator co-signs, seller's signed refund address only), both together (mutual cancel), or the moderator service after a no-show. The seller never alone. *2026-10-29b: no cancel of any kind after "I've paid"; the seller never cancels after tapping "Fund escrow"; the buyer's cancel before "I've paid" is ~~OPEN (option A or B, Revision 2026-10-29b)~~ option B with the seller's "Confirm cancel" (owner, 2026-10-29c; Revision 2026-10-29c, Task 39).*
- Timers (server clock only): setup **15 min**; seller funds within **30 min**; escrow secured when the whole balance is unlocked (10 blocks for Monero, 12 in tests); buyer pays within **90 min** from secured; extend by **30 min, at most twice**; final alert **15 min**, sent only after the payment window ended; signing (`settling`) **15 min**, counted only while the escrow is fully unlocked; seller confirm window from the method profile (**120** min instant apps, up to **1440** wires); maintenance pauses all of them.
- Trade codes come from `newTradeCode()`. The code is the trade's ID in URLs, memos and the UI. Relay channels use `await channelFor(code, kind)` (async; Revision 2026-10-23), never the code.
- Who may trade: posting, taking, every trade write and every chat write need `requireTrader` (full session, `kind = 'trader'`, not disabled, current Terms). Posting and taking also need at least one usable payout wallet (409 `no-wallet`; spec 6.4). Starter limits apply (spec 2.3; revision 2026-10-24 below), plus the offer's own "Minimum completed trades". Browsing (`/v1/methods`, `/v1/offers`, `/v1/price`) needs no session.
- Privacy: no analytics and no third-party scripts, styles or fonts (fonts are self-hosted from @fontsource). OS notifications and push payloads are exactly "Someone nudged you on X2F" or "Something changed in a trade on X2F". `disableRequestLogging: true`, `trustProxy` never set. No IP address is stored or logged anywhere, including disputes (spec 4.1). Logs never contain trade codes, channel IDs, addresses, amounts or IPs. `trade_events` holds no addresses. The relay keeps a trade's queued messages until `closeTrade`, with no timer.
- Headers on every response: `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy: same-origin`, `Strict-Transport-Security: max-age=63072000; includeSubDomains`, `X-Content-Type-Options: nosniff`. On HTML responses, add this CSP: `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self' <RELAY_ORIGIN> <NODE_PROXY_ORIGIN>; img-src 'self' data:; style-src 'self'; font-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`. External links use `rel="noreferrer noopener"`.
- Design: night theme first. Monero orange fill only on the one primary action per screen (`data-primary`, exactly one). Amber `caution` = waiting, teal `escrow` = escrow or done, rose `danger` = disputes or scam warnings, violet only for the "X2F Moderator" badge; each always with a word and an icon. No emoji, no exclamation marks. Usernames are rendered exactly as set (no `text-transform`, no truncation without a full-name tooltip). Body text ≥ 16 px on phones.
- Visual parity: every screen task names its board and runs `expectParity` (Task 15) at 390×844; trade-room screens also at 1280×800 against the Desktop board. Structural checks block; pixel diffs are reported for a person to review. Never run Playwright with `--update-snapshots`.
- Copy comes from the boards verbatim; spec wording where no board exists; OD copy where an owner decision changes a board.

## Review Focus

1. **The page is backgrounded, reloaded or closed mid-setup, mid-funding or mid-release** (Phase 0 lesson): it resumes from IndexedDB and the trade settles exactly once. Tests owned by Tasks 12 and 31.
2. **The seller sends the wrong amount** (short, over, or extra coins late): a short seller stays at "Received X of Y, send the rest" and lapses with a full refund; a surplus goes to the ad poster and the fee output stays exact; coins arriving late hold the payout until every coin has 10 confirmations, then it sweeps everything. Tests owned by Tasks 1 and 9.
3. **The phone's clock is wrong by ±10 min:** countdowns and what buttons allow follow the server's deadlines, never the device clock. Tests owned by Tasks 2 and 22.
4. **Many people take one ad at once:** a sell ad serves every buyer concurrently (one waiting take per buyer); a buy ad has at most one trade awaiting funding per amount, so five sellers racing get one trade and four `ad-busy`. Test owned by Task 5.
5. **The price feed is down, stale (> 5 min) or sources disagree:** Trade on a market-priced offer is disabled with "Price unavailable right now" rather than quoting an old rate; a fixed-price offer keeps its own price (see Open questions). Test owned by Task 3.

---

### Task 1: Quote and payout maths (`@x2f/trade`)

**Files:**
- Create: `packages/trade/package.json`, `packages/trade/tsconfig.json`, `packages/trade/src/{money,payouts,moneroUri,index}.ts`
- Test: `packages/trade/test/{money,payouts,moneroUri}.test.ts`

**Interfaces:**
- Consumes: `feeFor`, `Role` from `@x2f/core`; `Payout` from `@x2f/escrow`.
- Produces:
  - `type Side = 'sell' | 'buy'` (what the ad poster does with XMR); `posterRole(side: Side): 'seller' | 'buyer'`
  - `interface Price { currency: string; centsPerXmr: bigint }`; `rateFor(market: Price, marginBps: number): Price` (round half up); `fiatCents(atomic: bigint, rate: Price): bigint` (half up); `atomicForFiat(cents: bigint, rate: Price): bigint` (floor)
  - `type Pricing = { mode: 'market'; marginBps: number } | { mode: 'fixed'; centsPerXmr: bigint }`; `offerRate(p: Pricing, currency: string, market: Price | null): Price | null` (market mode needs `market`, else `null`; fixed mode ignores it)
  - `formatXmr(atomic: bigint, decimals = 6): string`; `formatFiat(cents: bigint, currency: string): string`
  - `escrowPlan(a: { amountAtomic: bigint; poster: 'seller' | 'buyer' }): { sellerFundsAtomic: bigint; feeAtomic: bigint }`, where `sellerFundsAtomic = amount + (poster === 'seller' ? fee : 0n)`
  - `type SettleKind = 'release' | 'mutual-cancel' | 'buyer-cancel' | 'auto-refund' | 'lapse-refund'`
  - `payoutsFor(a: { kind: SettleKind; amountAtomic: bigint; feeAtomic: bigint; poster: 'seller' | 'buyer'; sellerFundsAtomic: bigint; balanceAtomic: bigint; buyerPayout: string; sellerRefund: string; feeWallet: string }): Payout[]`. `balanceAtomic` is the escrow's whole balance, taken only when balance == unlocked, so the payouts sweep it (Plan 1). Index 0 is the party receiving the trade's XMR and bears the network fee (spec 11.1). Let `surplus = max(0, balance − sellerFunds)`, which goes to the poster (spec 11.1):
    - release, poster seller: `[buyer: amount, fee: fee, seller: surplus?]`
    - release, poster buyer: `[buyer: amount − fee + surplus, fee: fee]`
    - mutual-cancel, poster seller: `[seller: balance]`; poster buyer: `[seller: balance − surplus, buyer: surplus?]`
    - buyer-cancel, auto-refund and lapse-refund: `[seller: balance]` (exactly one payout, the seller's signed refund address; the moderator may sign nothing else, spec 3.3)
    - zero outputs are omitted; release throws `RangeError('underfunded')` when `balance < sellerFunds`.
  - `moneroUri(address: string, amountAtomic: bigint): string` → `monero:<address>?tx_amount=<decimal, trailing zeros trimmed>`

- [ ] **Step 1: Write the failing tests.**
  - `rateFor({currency:'USD',centsPerXmr:32990n}, 40)` → `33122n`; `fiatCents(1_250_000_000_000n, {currency:'USD',centsPerXmr:33000n}) === 41250n`; `formatXmr(1_237_500_000_000n) === '1.237500'`; `formatFiat(41250n,'USD') === '$412.50'`.
  - `offerRate({mode:'fixed', centsPerXmr: 34000n}, 'USD', null)` → `34000n`; `offerRate({mode:'market', marginBps: 40}, 'USD', null)` → `null`.
  - `escrowPlan(1.25 XMR, poster seller).sellerFundsAtomic === 1_262_500_000_000n`; for poster buyer it is `1_250_000_000_000n`.
  - Release, poster buyer, exact funding: `[{buyer,1_237_500_000_000n},{fee,12_500_000_000n}]`. Short by 1 atomic unit throws `underfunded`.
  - **Surplus to the poster:** poster seller, balance 1.2626 XMR → release `[{buyer,1.25},{fee,0.0125},{seller,0.0001}]`; poster buyer, balance 1.2501 → release `[{buyer,1.2376},{fee,0.0125}]`; mutual cancel, poster buyer, balance 1.2501 → `[{seller,1.25},{buyer,0.0001}]`. In every case the fee output is exactly `feeFor(amount)` and the outputs sum to the balance.
  - Buyer-cancel, auto-refund and lapse-refund are always one payout of the whole balance to `sellerRefund`, surplus included, for both posters.
  - No payout list contains a zero amount.
  - `moneroUri('4Abc', 1_250_000_000_000n) === 'monero:4Abc?tx_amount=1.25'`; for `1n` it ends `tx_amount=0.000000000001`.
- [ ] **Step 2:** `npm test -- --project @x2f/trade`; expect FAIL (modules missing).
- [ ] **Step 3:** Implement the files above and export them from `src/index.ts`.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(trade): quote, fee placement, payouts with surplus to the poster`.

### Task 2: Trade state machine (`@x2f/trade`)

**Files:**
- Create: `packages/trade/src/machine.ts`, `packages/trade/src/timers.ts`
- Test: `packages/trade/test/machine.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `TIMERS = { setupMin: 15, fundMin: 30, payMin: 90, extendMin: 30, maxExtensions: 2, finalAlertMin: 15, settleMin: 15, lapseCosignMin: 30, disputeAfterRefundDays: 90 }`
  - `type TradeState = 'setup' | 'funding' | 'securing' | 'secured' | 'paid' | 'refund_requested' | 'settling' | 'released' | 'refunded' | 'lapsed' | 'cancelled' | 'disputed'` (*2026-10-29c: gains `'cancelling'`; new events `fund-started`, `walk-away`, `confirm-cancel`, `return-confirmed`, `cancel-timeout`; see Revision 2026-10-29c*)
  - `interface Trade { code; offerId; poster: 'seller'|'buyer'; sellerId; buyerId; methodId; amountAtomic; feeAtomic; sellerFundsAtomic; lockedRate: Price; fiatCents: bigint; confirmWindowMin: number; state: TradeState; escrowAddress: string | null; receivedAtomic: bigint; unlockedAtomic: bigint; confirmations: number; releasable: boolean; takenAt: Date; setupBy: Date | null; fundBy: Date | null; fundingSeenAt: Date | null; securedAt: Date | null; payBy: Date | null; extensions: number; paidAt: Date | null; confirmBy: Date | null; finalAlertAt: Date | null; cancelProposedBy: 'buyer'|'seller'|null; settling: SettleKind | null; settleFrom: TradeState | null; settleBy: Date | null; pausedAt: Date | null; txHash: string | null; dispute: { by: 'buyer'|'seller'|'system'; at: Date } | null; closedAt: Date | null }`. `lockedRate` and `fiatCents` are fixed at take (OD-5). `receivedAtomic` is the escrow's whole balance; `confirmations` is the lowest count among its incoming transactions.
  - `type TradeEvent = { type: 'setup-done'; escrowAddress: string } | { type: 'chain'; receivedAtomic: bigint; unlockedAtomic: bigint; confirmations: number } | { type: 'mark-paid'; fiatCents: bigint } | { type: 'extend' } | { type: 'request-refund' } | { type: 'buyer-cancel' } | { type: 'propose-cancel' } | { type: 'accept-cancel' } | { type: 'withdraw-cancel' } | { type: 'release-started' } | { type: 'settled'; kind: SettleKind; txHash: string } | { type: 'open-dispute' } | { type: 'escalate' } | { type: 'pause' } | { type: 'resume' } | { type: 'tick' }`
  - `SYSTEM_EVENTS = ['setup-done','chain','settled','escalate','pause','resume','tick'] as const`; `CLIENT_EVENTS = ['mark-paid','extend','request-refund','buyer-cancel','propose-cancel','accept-cancel','withdraw-cancel','release-started','open-dispute'] as const`
  - `apply(t: Trade, e: TradeEvent, by: 'buyer' | 'seller' | 'system', now: Date): Trade` is pure and throws `TradeRuleError { code: 'wrong-state' | 'wrong-party' | 'too-early' | 'too-late' | 'no-extensions-left' | 'not-releasable' | 'total-changed' }`
  - `nextDeadline(t: Trade): Date | null`; `releasableEta(t: Trade, blockSeconds = 120): number | null` (minutes)

Rules the tests pin (one test each):
- **System-only (P3-C2):** each of `SYSTEM_EVENTS` with `by` buyer or seller → `wrong-party`; each of `CLIENT_EVENTS` with `by: 'system'` → `wrong-party`.
- Take → `setup` with `setupBy = takenAt + 15 min`; `tick` past `setupBy` → `cancelled`, no penalty (P3-I5). `setup-done` → `funding`, `fundBy = now + 30 min`.
- `tick` after `fundBy` with `received < sellerFunds` → `lapsed`.
- `chain` with `received ≥ sellerFunds` → `securing`, `fundingSeenAt = now`. `lockedRate` never changes after take.
- `chain` sets `releasable = received > 0 && unlocked === received` (every coin has 10 confirmations, spec 11.1). `secured` requires `releasable && received ≥ sellerFunds`; then `payBy = now + 90 min` (P3-I4). A later `chain` with more coins (a late surplus) clears `releasable` until they unlock; no deadline caps that wait.
- `mark-paid` (buyer) in `securing`, `secured`, `refund_requested`; sets `paidAt`, `confirmBy = now + confirmWindowMin`, clears `finalAlertAt`.
- `extend` (seller) only in `secured` with `now ≥ payBy` and `extensions < 2`; then `payBy = now + 30 min`. A third time → `no-extensions-left`.
- `request-refund` (seller) only when unpaid and `now > payBy` strictly (`too-early` at exactly `payBy`) → `refund_requested`, `finalAlertAt = now`, so `finalAlertAt > payBy` always holds (rulings Task 9).
- `buyer-cancel` (buyer only; the seller → `wrong-party`) in `setup`, or `funding` with nothing received → `cancelled`; in `funding` with part received, `securing`, `secured`, ~~`paid`~~ or `refund_requested` → `settling`/`buyer-cancel` (spec 2.3). *2026-10-29b: refused in `paid` (no cancel after I've paid); option A would drop the post-funding path entirely (Task 39).* It is accepted before the escrow unlocks; `settleBy` starts when it does.
- `propose-cancel` by either side in `funding` … `paid` (*2026-10-29b:* except `paid` itself; no cancel after I've paid, Task 39). `accept-cancel` by the other side → `settling`/`mutual-cancel` only when `releasable` (`not-releasable` otherwise), or straight to `cancelled` when nothing was ever received. A proposer cannot accept their own.
- `release-started` (seller) in `secured` or `paid`, only when `releasable` → `settling`/`release`, `settleFrom` = previous state, `settleBy = now + 15 min`. In `settling`, a `chain` that clears `releasable` clears `settleBy`, and the next releasable `chain` sets `settleBy = now + 15 min`. `tick` past `settleBy` returns to `settleFrom` (P3-I5).
- `open-dispute`: either side in `securing` or `secured` (OD-8); seller in `paid` any time; buyer in `paid` only after `confirmBy` (`too-early` before); either side in `settling` after `settleBy`; buyer in `refunded` within 90 days → `disputed`. In `disputed`, `tick` changes nothing.
- `escalate` (system) from `lapsed` with funds, or from `released`, `refunded` or `cancelled` (late funds) → `disputed` with `dispute.by = 'system'`.
- `pause` sets `pausedAt`; `tick` while paused changes nothing; `resume` moves every non-null future deadline by `now − pausedAt` (P3-I19).
- `settled` → `released` or `refunded`, `closedAt = now`.

- [ ] **Step 1:** Write the failing tests above, plus the clock-skew test (Review Focus 3): `apply` is only ever given the server's `now`, and a `mark-paid` 1 ms after a lapsed `fundBy` is refused with `wrong-state`. Also: `buyer-cancel` by the seller in every state → `wrong-party`; a seller has no event that ends a funded trade alone; `buyer-cancel` in `paid` → `settling`/`buyer-cancel`; a late-surplus `chain` during `settling` holds `settleBy` at `null` for 25 min without returning to `settleFrom`.
- [ ] **Step 2:** `npm test -- --project @x2f/trade`; expect FAIL.
- [ ] **Step 3:** Implement `apply` as a `switch` on `e.type`, guarded by `SYSTEM_EVENTS` membership, state and party. No I/O.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(trade): trade state machine with system-only events, buyer cancel, timeouts and pause`.

### Task 3: Payment method profiles, method lists, suggestions and the price feed (`apps/api`)

**Files:**
- Create: `data/payment-method-profiles.json`, `apps/api/migrations/101_method_suggestions.sql`, `apps/api/src/methods/{profiles,routes}.ts`, `apps/api/src/price/{feed,routes}.ts`
- Test: `apps/api/test/profiles.test.ts`, `apps/api/test/price.test.ts`

**Interfaces:**
- Produces:
  - `interface MethodProfile { id; whatItIs; landsIn; checkPrompt; arrival: 'instant' | 'same-day' | 'days'; confirmWindowMin: number; fields: { key; label; kind: 'email-or-phone' | 'iban' | 'account' | 'postal' | 'text' }[] }`. Launch profiles: Zelle, Cash App, Revolut, Wise, Bank transfer (ACH), SEPA, Cash by mail, Custom method. Zelle: `whatItIs: "Zelle: a US bank-to-bank instant transfer built into most US banking apps."`, `landsIn: "your bank account, checked in your bank's app"`, `confirmWindowMin: 120`. Wires: `1440`.
  - `getProfile(id): MethodProfile | null`; `isAvailable(id): boolean`, which is false when the catalog entry has `legalReview` (P3-I20).
  - `GET /v1/methods?side&currency&sort=buyers|rate|az` (no session) → `{ live: MethodRow[]; all: MethodRow[] }`, `MethodRow = { id; name; group; offers; bestRate: string | null }`. Unavailable methods are excluded.
  - `POST /v1/method-suggestions { name: string (1–60), country?: string }` (`requireTrader`) → 202. Stored without the account id (P3-M3).
  - `createPriceFeed(sources: PriceSource[], o: { minSources: 2; maxAgeMs: 300_000; pollMs: 60_000 })`, `current(currency): Price | null`. It returns the median of the sources that answered the last poll, or `null` when fewer than 2 answered or the median is older than 5 min. `PRICE_SOURCES` env (spec 11.6). `GET /v1/price?currency` (no session) → `{ centsPerXmr: string; at: string }` or 503 `price-unavailable`.

- [ ] **Step 1: Write the failing tests:**
  - Every profile id exists in the catalog and has a non-empty `landsIn`, and no `landsIn` contains the method name.
  - The median of `[32900, 33000, 39000]` → `33000`. One source → `null`. A median 5 min + 1 ms old → `null` and a 503 (Review Focus 5).
  - `GET /v1/methods` with one live Zelle USD offer lists Zelle in `live`; SBP, Mir and YooMoney appear in neither list.
  - `/v1/methods` and `/v1/price` answer with no cookie (P3-M9).
  - A suggestion row has no account column.
- [ ] **Step 2:** Run `npm test -- --project @x2f/api`; expect FAIL.
- [ ] **Step 3:** Implement. Sources use `fetch` with a 5 s timeout, and no source failure throws past the feed.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(api): method profiles, live lists, suggestions, median price feed`.

### Task 4: Offers (`apps/api`)

**Files:**
- Create: `apps/api/migrations/102_offers.sql`, `apps/api/src/offers/routes.ts`, `apps/api/src/traders/summary.ts`
- Test: `apps/api/test/offers.test.ts`

**Interfaces:**
- Consumes: Task 3; `requireTrader`.
- Produces:
  - Tables: `offers(id, account_id, side, method_id, currency, price_mode 'market'|'fixed', margin_bps, fixed_cents_per_xmr, min_fiat_cents, max_fiat_cents, min_trades, terms, status, created_at)` (a check constraint: `margin_bps` set only for `market`, `fixed_cents_per_xmr` only for `fixed`); `trading_holds(account_id, created_at, lifted_at)` and `site_flags(trading_paused boolean default false, maintenance_since timestamptz)`, written by Plan 4 and enforced here.
  - `POST /v1/offers { side, methodId, currency, pricing: Pricing, minFiatCents, maxFiatCents, minTrades: 0|5|10|50, terms }` (`Pricing` from Task 1; spec 2.2 step 5). Refusals: `method-unavailable` (P3-I20), `no-wallet` (no usable payout wallet, spec 6.4), `trading-hold`, `trading-paused`. `PATCH /v1/offers/:id { status: 'live'|'paused'|'removed' }` (poster only). `minTrades` is the only experience rule; there are no platform limits for new accounts (spec 2.3).
  - `GET /v1/offers?side&method&currency&sort=best|online|trades` (no session) → `OfferCard[]`, `OfferCard = { id; poster: TraderSummary; rate: string | null; pricing: Pricing; minFiatCents; maxFiatCents; minTrades }`. `rate` comes from `offerRate` (`null` for a market offer while the feed is down).
  - `TraderSummary = { username; completedTrades; online; lastSeenAt; typicalMinutes: number | null; positivePct: number | null; badges: string[] }` (Plan 5 fills the last two).

- [ ] **Step 1: Write the failing tests:**
  - Post and list an offer, logged out (P3-M9).
  - A staff account cannot post (`wrong-account-kind`).
  - SBP → 409 `method-unavailable`.
  - A held account and a paused site cannot post.
  - An account with no usable wallet → 409 `no-wallet`; with one waiting (24-hour) wallet only → `no-wallet`.
  - A fixed-price offer lists its own rate while the feed is down; a market offer lists `rate: null`. A body with both `marginBps` and `centsPerXmr` → 400.
  - Only the poster can PATCH.
- [ ] **Step 2:** Run `npm test -- --project @x2f/api`; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(api): offers with method and hold guards`.

**Revision 2026-10-26 (lead, from the Task 16 review):** `TraderSummary` in `/v1/offers` and `/v1/offers/:id` carries `stage` (the starter-limit stage the web screens grey cards by; the same field `GET /v1/me` returns). Tasks 16 and 17 already parse it; the API builder owes it.

**Revision 2026-10-27 (lead):** offers for gift-card methods carry `country` (ISO 3166-1 alpha-2); the API refuses a gift-card offer without it.

**Revision 2026-10-29 (owner):** the offer caps change to 2 per side per currency and 20 in total when flexible offers land (new Task 34); until then the built 3 per (side, method, currency) and 20 stay. Pause and resume of all offers is new Task 36. See "Revision 2026-10-29 (owner)" at the end.

### Task 5: Taking an offer (`apps/api`)

**Files:**
- Create: `apps/api/migrations/103_trades.sql`, `apps/api/src/trades/take.ts`
- Test: `apps/api/test/take.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4; `newTradeCode`; `usableWallets`.
- Produces:
  - Tables: `trades(code primary key, …every Trade field…, buyer_payout text, seller_refund text, seller_wallet_app text)`; `trade_events(id bigserial, code, at, by, event jsonb)`.
  - `POST /v1/offers/:id/take { amountAtomic: string; walletId: string }` (`requireTrader`) → `{ code }`. `walletId` is required every time. It is the buyer's payout wallet when the taker buys, and the seller's refund and funding wallet when the taker sells. The rate and the fiat total lock here (OD-5). The trade starts in `setup` with the poster's wallet unset.
  - `POST /v1/trades/:code/wallet { walletId }` (poster only, in `setup`, once) sets the poster's side. This backs the "accepted your offer" sheet (Task 19).
  - Refusals (409): `own-offer`, `out-of-range`, `not-enough-trades`, `trading-hold`, `trading-paused`, `price-unavailable` (market offers only; a fixed-price offer locks its own price), `method-unavailable`, `no-wallet` (the taker has no usable wallet at all, spec 6.4; also from the poster's wallet route), `wallet-not-ready` (wallet not in `usableWallets`), `already-waiting` (one trade in `setup`/`funding` per taker per sell ad), `ad-busy` (one trade in `setup`/`funding` per buy ad and amount; spec 2.2 step 4). Both limits are enforced by partial unique indexes.

- [ ] **Step 1: Write the failing tests:**
  - A poster cannot take their own offer.
  - Out-of-range and `minTrades` refusals.
  - A waiting wallet → `wallet-not-ready`; no usable wallet at all → `no-wallet`.
  - A new account with 0 completed trades can take a large amount from an offer with `minTrades: 0` (no platform limit).
  - **Five concurrent seller takes of the same amount on one buy ad (`Promise.all`, real Postgres) → exactly one `{code}`, four `ad-busy`.**
  - Three different buyers take one sell ad at once → three codes; the same buyer twice → `already-waiting` (Review Focus 4).
  - `lockedRate` and `fiatCents` are stored at take.
  - The poster's wallet route refuses the taker and a second call.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(api): take with wallet choice and race-safe limits`.

Revision 2026-10-27 (lead): `POST /v1/offers/:id/take` accepts the quoted `centsPerXmr` and `fiatCents`; it refuses with 409 `price-changed` when the offer's rate now (`offerRate`, market plus the offer's margin) differs from the quote by more than 0.5%; fixed-price offers compare exactly. ~~When it accepts, it locks exactly the quoted `centsPerXmr` and `fiatCents` (never its own fresh rate), because the attested `deal.centsPerXmr` must equal the taker's `confirmed.deal.centsPerXmr` or the trade fails `deal-mismatch` (Task 18 re-review, 2026-10-27).~~ *Superseded by the lead, 2026-10-29 07:39:* the take locks the server's live price; the quoted price only detects a move (Revision 2026-10-29b).

Revision 2026-10-29 (lead decision, Task 5 review I2; supersedes "locks exactly the quoted" above): the client's rate is never locked. The take always locks the server's own rate now (`offerRate`: market plus margin, or the fixed price) and that rate's total, and answers `{ code, centsPerXmr, fiatCents }` with them. The client's `centsPerXmr` only detects a move: more than 0.5% from the server's rate (fixed: any difference) → 409 `price-changed`. So the taker gets the live price within 0.5% of what they saw and can never pick a better one. The device records its confirmed deal at the rate in the answer, after checking it is within 0.5% of the quote it showed (else it records nothing), so the attested `deal.centsPerXmr` still equals `confirmed.deal.centsPerXmr`. Also (lead decisions, same review): the Starter cap counts the larger of the fiat total and the XMR amount at the live market price (M5); the poster's open-trade limit refuses with a generic 409 `offer-busy` (M6); a blocked pair (either way) gets 404 `not-found` before any other refusal (M3, Task 37).

### Task 6: Trade store, view, events route, retention and log hygiene (`apps/api`)

**Files:**
- Create: `apps/api/migrations/104_trade_retention.sql`, `apps/api/src/trades/{store,view,routes,purge}.ts`, `apps/api/src/retention/scheduler.ts`
- Test: `apps/api/test/{store,view,events-route,purge,logs}.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 5.
- Produces:
  - `applyEvent(db, code, e: TradeEvent, by): Promise<Trade>`: `SELECT … FOR UPDATE`, then `apply`, update the row, insert into `trade_events` with addresses replaced by `addressEnd` (last 6), then `publish` (Task 19).
  - `POST /v1/trades/:code/events { type, fiatCents? }` (`requireTrader`, participant). It accepts only `CLIENT_EVENTS` (anything else → 400 `event-not-allowed`). `by` comes from the session's role in the trade; a body `by` is ignored. `mark-paid` must carry `fiatCents`, the total the buyer confirmed, as a decimal string in the currency's minor units (missing or malformed → 400); one that is not the trade's current `fiatCents` → 409 `total-changed` and nothing changes (Revision 2026-10-21).
  - `toTradeView(t, viewerId, serverNow): TradeView` is the single serializer for `GET /v1/trades/:code`. It includes `role`, `counterparty: TraderSummary`, `profile`, deadlines as ISO strings, `serverNow`, `releasableEtaMin`, `confirmations`, and `fee` **only for the poster**. Non-participants get 404.
  - `trade_events` trigger: UPDATE and DELETE are refused, except DELETE by role `x2f_purge`. `purgeTradeAddresses(db, now)`, running as `x2f_purge`, nulls `buyer_payout` and `seller_refund` 90 days after `closed_at`, never while a dispute is open (P3-I12).
  - `startRetention(deps)`: every 10 min runs Plan 2's `purgeExpired`, `purgeChats` (Task 20) and `purgeTradeAddresses` (X-12).

- [ ] **Step 1: Write the failing tests:**
  - Each of `chain`, `setup-done`, `settled`, `tick`, `escalate`, `pause`, `resume` posted by a participant → 400 `event-not-allowed`, and the state is unchanged (P3-C2).
  - A body `{type:'mark-paid', fiatCents:'41250', by:'seller'}` from the buyer is applied as the buyer; `{type:'buyer-cancel'}` from the seller → 409 `wrong-party`.
  - `mark-paid` with no `fiatCents` → 400; with a total other than the trade's current one (e.g. the total before a growth) → 409 `total-changed`, and the state is unchanged.
  - The taker view has no `fee` key in any state; the poster view has `fee.atomic === '12500000000'`; a third user gets 404.
  - No `trade_events.event` contains a full address.
  - Purge nulls addresses at +90 days, keeps them on a disputed trade, and the app role cannot UPDATE `trade_events`.
  - **Logs:** a full trade lifecycle against a captured logger contains no trade code, address or IP (P3-I15).
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(api): trade store, role-aware view, guarded events, retention`.

**Revision 2026-10-29 (owner):** retention changes: an undisputed trade is deleted whole 30 days after it ends; a disputed trade is kept 90 days from the dispute button. `purgeTradeAddresses` moves from 90 to 30 days now; the whole-trade delete is Plan 7 Task 2. See "Revision 2026-10-29 (owner)" at the end.

### Task 7: Plan 1 amendments — incoming funds, buyer-cancel guard, security follow-ups, relay registration and close

**Files:**
- Modify: `packages/escrow/src/{engine,monero,party,autoRefund,index}.ts`, `apps/relay/src/server.ts`, `apps/relay/src/main.ts`
- Create: `packages/trade/src/channels.ts`, `apps/relay/src/admin.ts`
- Test: `packages/escrow/test/{incoming,followups,buyerCancel}.test.ts`, `apps/relay/test/admin.test.ts`, `packages/trade/test/channels.test.ts`

**Interfaces:**
- Produces:
  - `EscrowSession.incoming(): Promise<{ txHash; amountAtomic; confirmations: number; unlocked: boolean }[]>` (monero-ts `getTransfers({ isIncoming: true })` including the pool). There is one escrow address; only the seller funds it (spec 2.5).
  - `PartyHandle.funds(): Promise<{ balance: bigint; unlocked: bigint; incoming: Incoming[] }>`, run inside the party's serialised work chain so session calls never interleave. Watchers and apps read the escrow only through it.
  - No runner change for buffering: as built, `runParty` keeps a counterpart's release messages per outcome tag until the local `settle` names the same outcome, waits for balance == unlocked == sum(payouts), and starts each attempt with a fresh export (R26). Every party derives the outcome itself (`payoutsFor` over its own `funds().balance`, Task 1) and calls `settle` again when the balance changes before it has signed (a late surplus, spec 11.1).
  - `buyerCancelDecision(f: { cancelSignedByBuyer: boolean; recordedRefundAddress: string; balance: bigint; proposed: Payout[] }): { ok: true } | { ok: false; reason: 'no-buyer-signal' | 'wrong-destination' }` in `autoRefund.ts`: pure; ok only when the buyer's own identity signed a `trade.cancel` signal and `proposed` is exactly one payout, to the recorded refund address (exact string equality), of exactly `balance` (spec 2.3, 3.3).
  - Security follow-ups (rulings "Follow-ups for Plan 3"; plan-1-review open items):
    - `txSeen(txHash)` uses monero-ts's daemon client (`MoneroDaemonRpc.getTx`) over the node proxy instead of a raw `fetch`, and is true only for a tx in a block, never one in the pool.
    - The builder treats a `release.done` as done only after its own `sync()` shows the escrow empty and `txSeen(reported hash)` is true; until then it keeps waiting and resending.
    - A submit refused for good stops retrying once `funds()` shows the escrow's inputs spent (balance 0); the party then reports the outcome as settled by another tx, never rebuilds or resends.
    - Every daemon call (wallet sync, `getTx`, submit) has a 15 s timeout; a timeout is a retryable error, never a crash.
    - The party takes `from` from `open()`'s result, not the raw frame.
  - `channelFor(code: string, kind: 'escrow' | 'signals' | 'chat'): Promise<string>` = the first 10 bytes of HKDF-SHA256(ikm = normalized code, info = `x2f/relay-channel/v1/<kind>`) as 16 Crockford base32 characters grouped like a trade code, so the relay's `normalizeTradeCode` accepts it. It is the `trade` string in every Envelope and relay path. Async because it uses WebCrypto (Revision 2026-10-23).
  - Relay: `buildRelay(overrides, log, admin?: { modSigningPublic })` takes the admin options as its third argument and returns `relay.admin`, a Fastify instance (or `null` without admin options) that `main.ts` listens on at `RELAY_ADMIN_HOST`/`RELAY_ADMIN_PORT` (default `127.0.0.1:8788`), bound to the private interface. It serves `POST /v1/admin/trades { channel, signPublics: Record<Role,string>, at, sig }` → `registerTrade`, and `POST /v1/admin/trades/close { channel, at, sig }` → `closeTrade` (queues are kept until then, no timer). Each verifies the Ed25519 `sig` over `x2f/relay-register/v1\0` or `x2f/relay-close/v1\0` + canonical JSON with `modSigningPublic` and refuses `at` older than 60 s; a replayed signed call → 409 `replay`, and registering an existing channel → 409 `exists` (Revision 2026-10-23). The public listener has no admin route. No `trustProxy`, no IPs in logs.

- [ ] **Step 1: Write the failing tests** (regtest):
  - The seller pays the escrow in two transfers → `incoming()` reports both, and `unlocked` turns true after 12 blocks; `funds()` during a `settle` does not interleave session calls (spy).
  - A seller-built set reaching the mod before its own `settle` is signed once the mod settles the same outcome; a set for a different outcome is never signed.
  - Late surplus: 0.0001 XMR arrives after both sides called `settle` but before signing → both re-derive and settle again, the broadcast tx sweeps everything with the surplus to the poster, after 12 more blocks.
  - `buyerCancelDecision`: no buyer signal → `no-buyer-signal`; two outputs, another address, or an amount 1 atomic unit off `balance` → `wrong-destination`; one exact payout → ok. Mutation check that each condition bites.
  - Follow-ups: `txSeen` is false for a pool-only tx and true after one block; a co-signer reporting a made-up DONE hash leaves the builder waiting; a submit refused because another approved set spent the inputs stops after the watcher sees balance 0; a daemon that never answers times out at 15 s and the party retries; a frame whose raw `from` differs from the signed one is attributed to the signed sender.
  - Relay admin: a valid signed registration lets a joined client in; a valid signed close deletes the queue and closes the sockets with 4404. A bad signature, a stale `at`, a replayed call, or an admin path on the public port → refused (replay → 409 `replay`, Revision 2026-10-23). The join challenge for an unregistered channel closes the socket with 4404 (Revision 2026-10-23; was 4401).
  - `channelFor` is deterministic, differs per kind, passes `normalizeTradeCode`, and never equals or contains the code.
  - Plan 1's relay and party tests pass with registration added to their fixtures.
- [ ] **Step 2:** Run `npm test -- --project @x2f/escrow --project @x2f/relay --project @x2f/trade`; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(escrow,relay): incoming funds, buyer-cancel guard, Plan 1 follow-ups, signed channel registration and close`.

### Task 8: Moderation service — separate process, identities and attestation (P3-C1)

**Files:**
- Create: `apps/moderation/{package.json,src/main.ts,src/keystore.ts,src/link.ts,src/attest.ts}`, `apps/moderation/migrations/001_mod.sql`, `apps/api/src/internal/routes.ts`, `apps/api/src/trades/identity.ts`, `packages/trade/src/{attestation,checkWords}.ts`, `tools/separation-check.ts`
- Modify: root `package.json` (`check` runs `separation-check`)
- Test: `apps/moderation/test/attest.test.ts`, `apps/api/test/identity.test.ts`, `packages/trade/test/attestation.test.ts`, `tools/test/separation.test.ts`

**Interfaces:**
- Consumes: `generateIdentity`, `Participants`; Task 7 (`channelFor`, relay admin).
- Produces:
  - `POST /v1/trades/:code/identity { signPublic, boxPublic, proof }` (`requireTrader`, role from the session, once per role → 409 `identity-exists`). The schema has `additionalProperties: false`. `proof` = Ed25519 signature by the identity over `x2f/trade-identity/v1\0` + code + `\0` + role + `\0` + signPublic + boxPublic (400 `bad-proof`).
  - `interface Attestation { v: 1; trade: string; channels: Partial<Record<'escrow' | 'signals' | 'chat', string>>; participants: Participants; issuedAt: string }` (a trade gets `escrow` and `signals`; a chat gets `chat`; each must equal `channelFor(trade, kind)`); `attestationBytes(a): Uint8Array` (domain `x2f/attestation/v1\0` + canonical JSON); `verifyAttestation(a, sig, modSigningPublic, me: { role: 'buyer'|'seller'; signPublic: string }): void`. It throws `AttestationError('bad-signature' | 'not-me' | 'wrong-trade' | 'wrong-channel')`.
  - `GET /v1/trades/:code/attestation` (participant only) → `{ attestation, sig }` or 202.
  - `escrowCheckWords(participants: Participants, escrowAddress: string): [string, string, string, string]`, from SHA-256 over both, indexed into a bundled 2048-word list.
  - `apps/moderation`: `startModeration(o: { apiInternalUrl: string; relayAdminUrl: string; daemonUri: string; db: pg.Pool; keystoreKey: Uint8Array; signingSecret: Uint8Array; feeWallet: string })`. It opens **no listening socket** and depends on neither fastify nor `@x2f/api`. Its database `x2f_moderation` holds `mod_party_state` (AES-256-GCM under `MOD_KEYSTORE_KEY`), `mod_wallet_secrets` (each trade's escrow wallet password: 32 random bytes from the OS CSPRNG, AES-256-GCM under a separate subkey of `MOD_KEYSTORE_KEY`, in its own table apart from the saved session, R27) and `signed_terms`; the API's DB role has no grant on it. Each loop it pulls `GET <api-internal>/internal/v1/work` and posts `POST /internal/v1/reports`. Both are signed with the moderation key, and the API verifies them with `MOD_SIGNING_PUBLIC`. For each trade with buyer and seller registered, it verifies both proofs, generates the mod identity, signs the `Attestation`, posts it, and registers both channels with the relay.
  - API internal listener: a separate port on the private interface, serving only `/internal/v1/*`. It holds no secrets beyond `MOD_SIGNING_PUBLIC`.
  - `separation-check.ts` fails when `apps/api` or `apps/web` reference `MOD_KEYSTORE_KEY`, `MOD_SIGNING_SECRET`, `@x2f/moderation` or `generateIdentity`, or when `apps/moderation` imports `fastify` or `node:http` servers.

- [ ] **Step 1: Write the failing tests:**
  - Attestation appears only after both traders registered.
  - A buyer cannot register as seller.
  - A body with `signSecret` → 400.
  - A bad proof → `bad-proof`.
  - `verifyAttestation` throws `not-me` when the buyer slot holds another key and `bad-signature` for a re-signed copy.
  - **Swapped list:** the API stores a second buyer identity it generated itself → the real buyer's verification throws `not-me` (setup aborts), and no attestation exists that lists both the real seller and an API-chosen mod.
  - An unsigned or wrongly signed report to `/internal/v1/reports` → 401.
  - `separation-check` flags a planted `process.env.MOD_KEYSTORE_KEY` in `apps/api`.
  - The API role's `SELECT` on `x2f_moderation.mod_party_state` and `mod_wallet_secrets` fails.
  - **R27:** the password passed to `runParty` is 32 random bytes, two trades get different ones, and no `mod_party_state` row contains it.
  - Check words are equal for equal inputs and differ when one key changes.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(moderation): separate moderation process, signed participant attestation`.

### Task 9: Moderator party, chain watcher and timer loop

**Files:**
- Create: `apps/moderation/src/{party,watcher}.ts`, `apps/api/src/trades/timers.ts`
- Test: `apps/moderation/test/watcher.test.ts` (regtest), `apps/api/test/timers.test.ts`

**Interfaces:**
- Consumes: `runParty`, `PartyHandle.funds`, `incoming` (Task 7); `applyEvent` (Task 6).
- Produces:
  - Moderation runs `runParty` as `mod` on `channelFor(code,'escrow')` with the attested participants and its R27 wallet secret (Task 8). On `ready()` it reports `setup-done { escrowAddress }`.
  - Watcher: every 15 s per open escrow, `funds()` → reports `chain { receivedAtomic: balance, unlockedAtomic: unlocked, confirmations: lowest among incoming }`. The escrow emptied by a tx in a block (`txSeen`) → `settled` with the tx hash; a pool-only tx is not settled. On `released`, `refunded` or `cancelled` it sends the signed relay close for both channels (`closeTrade`, Task 7). Closed escrows stay watched for 30 days; funds arriving after close → report `late-funds`, which the API turns into `escalate` (P3-I6, OD-2).
  - API timer loop (`startTimers(deps)`): every 5 s, `tick` for trades whose `nextDeadline` passed. When `site_flags.maintenance_since` is set or cleared, it applies `pause`/`resume` to all open trades and skips ticks meanwhile. A `lapsed` trade with funds whose lapse refund is not co-signed within `lapseCosignMin` → `escalate`.

- [ ] **Step 1: Write the failing tests** (regtest, real relay, Node buyer and seller parties):
  - Setup reaches `funding`.
  - Short by 0.1 XMR stays `funding` and lapses at `fundBy` (fake clock).
  - Overfunded by 0.0001 XMR → `securing`, then `secured` with `receivedAtomic` including the surplus.
  - 10 blocks: still `securing` (not unlocked in practice). 12 blocks → `secured` (P3-I4).
  - A second funding tx after `secured` clears `releasable` until it has 12 blocks; no timer fires meanwhile (no cap, spec 11.1).
  - The release tx in the pool does not report `settled`; one block later it does, and the relay queues for both channels are gone.
  - Funds sent after `released` → `late-funds` → `disputed`.
  - Timers: maintenance on for 20 min moves `payBy` by 20 min and no tick fires meanwhile.
  - Restarting the moderation process mid-setup resumes from `mod_party_state`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(moderation): mod party, chain watcher, timers with pause`.

### Task 10: Guarded auto-refund, buyer-cancel refund, signed terms and signals

**Files:**
- Create: `apps/moderation/src/{signals,autoRefund,buyerCancel,rulings}.ts`
- Test: `apps/moderation/test/{autoRefund,buyerCancel}.test.ts` (regtest)

**Interfaces:**
- Consumes: `seal`/`open`/`ReplayGuard`; `PartyHandle.settle`, `funds()`; `autoRefundDecision`, `buyerCancelDecision`; `payoutsFor`; `apply`.
- Produces:
  - Signals channel (`channelFor(code,'signals')`, sealed to all three roles, own `ReplayGuard` persisted as `{trade, seen}`). Types: `trade.terms` (seller: `{ refundAddress }`; buyer: `{ payoutAddress }`; sent once at setup), `trade.paid` and `trade.cancel` (buyer), `trade.extend` and `trade.refund-request` (seller), and `trade.ack` (mod → sender).
  - The moderation service keeps its own shadow `Trade`, fed only by its chain watcher and by signals it opened itself, through the same `apply`. `recordedRefundAddress` = the seller-signed `trade.terms`, stored in `signed_terms`, **never** the API's `seller_refund`.
  - The mod never takes payouts from a tx set or the API: it derives `proposed = payoutsFor({ kind, …, balanceAtomic: funds().balance, sellerRefund: recordedRefundAddress })` (one payout of the whole balance) and passes exactly that to `settle({ kind:'release', to: proposed, builder, cosigner:'mod' })`. `settle` co-signs only a set that matches it (Plan 1).
  - Auto-refund: when the shadow trade is `refund_requested` and the API reports the buyer's seen-receipt for the final alert (`final_alert_delivered` true and `final_alert_seen_at` set, posted only by Task 25's `FinalAlert`; null = false → escalate; Task 19 review 2026-10-27), the service first checks `shadow.finalAlertAt > shadow.payBy` (rulings Task 9; refuse and report otherwise) and requires `now >= final_alert_seen_at + 15 min` (a push can be held by the push service for up to its 15-minute TTL, so the buyer's 15 minutes run from the receipt, not from `finalAlertAt`), then calls `autoRefundDecision({ paymentDeadline: shadow.payBy, markedPaidAt: shadow.paidAt, finalAlertAt: shadow.finalAlertAt, now, recordedRefundAddress, proposed })`. On `ok` it settles with `builder:'seller'`. With no seen-receipt after 15 min, or a receipt younger than 15 min, it reports `escalate`. Every `ok:false` is reported with its reason only.
  - Buyer cancel (spec 2.3): when the mod has opened a valid `trade.cancel` from the buyer's identity, the service calls `buyerCancelDecision({ cancelSignedByBuyer: true, recordedRefundAddress, balance, proposed })` and on `ok` settles with `builder:'buyer'`. No final alert and no delivery proof are needed: the buyer chose it, and only the seller's signed address is paid. A `trade.cancel` from any other identity is ignored.
  - `rulings.ts`: `verifyRuling(r: unknown): false`. It is the only other path to `settle` as mod; Plan 4 replaces it with staff hardware-key verification.

- [ ] **Step 1: Write the failing tests:**
  - The buyer never pays and the seller requests a refund: at `finalAlertAt + 15 min − 1 ms` nothing is signed; at `+15 min + 1 ms` the seller's signed refund address receives the balance minus the network fee.
  - **The API's `seller_refund` is overwritten with an attacker address → the refund still goes only to the seller-signed address.**
  - **The API reports `refund_requested` while the mod received a valid `trade.paid` → nothing is signed.**
  - A seller-built refund paying another address is never co-signed, nothing broadcast.
  - **P3-I3:** refund requested → buyer marks paid in the final alert → seller releases → exactly one tx is broadcast, paying the buyer, built on a fresh export.
  - No delivery proof → `escalate`. A shadow trade with `finalAlertAt ≤ payBy` → nothing signed.
  - **Buyer cancel:** the buyer cancels after funding with the seller's page closed → the seller's signed address receives the balance minus the network fee, with no final alert. **With the API's `seller_refund` overwritten → still only the seller-signed address.** A `trade.cancel` sealed by the seller's identity → nothing signed. A buyer-built set paying the buyer → never co-signed.
  - `verifyRuling` refuses every input.
  - **Lost device (spec 9):** the buyer's store is deleted after funding → mutual cancel and buyer cancel are impossible and the trade can only end by auto-refund or escalation (the ruling path is Plan 4).
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(moderation): auto-refund and buyer-cancel refund from signed terms and signals only`.

**Notes from Task 12 (lead, 2026-10-24):** Task 10 must accept `deal` in `trade.terms` (the seller's `{ refundAddress, deal }`, the buyer's `{ payoutAddress, deal }`, with `deal = { poster, takeAmountAtomic, currency, centsPerXmr, maxFiatCents }` as bigints) and `trade.ack` as `{ of: '<signal type>' }`. It must also accept `trade.paid` as `{ amountAtomic, fiatCents }` (bigints, the amount the buyer's device fixed and the total the buyer confirmed; the Task 12 security fix of 2026-10-24). The trader apps ignore a `trade.paid` without them. Details: `docs/coordination.md`, "Plan 3 Task 12".

### Task 11: Node proxy (`apps/node-proxy`)

**Files:**
- Create: `apps/node-proxy/{package.json,src/server.ts,src/main.ts}`
- Test: `apps/node-proxy/test/proxy.test.ts`

**Interfaces:**
- Produces: `buildNodeProxy(o: { upstream: string; webOrigin: string }): FastifyInstance`. It serves Monero's own paths **at its root**. POST `/json_rpc` allows only `get_info`, `get_last_block_header`, `get_block_header_by_height`, `get_block_headers_range`, `get_fee_estimate`, `get_version`, `get_output_distribution` and `hard_fork_info`. The other paths are `/getblocks.bin`, `/getblocks_by_height.bin`, `/gethashes.bin`, `/get_o_indexes.bin`, `/getouts.bin`, `/get_transaction_pool_hashes.bin`, `/get_transactions`, `/sendrawtransaction`, `/get_height`, `/get_info`, `/is_key_image_spent` and `/get_transaction_pool`. Everything else → 404. CORS only for `webOrigin`; `disableRequestLogging`; no `trustProxy`, no IPs in logs.

- [ ] **Step 1: Write the failing tests:** an allowlisted `json_rpc` call and `/getblocks.bin` are forwarded; `stop_daemon` is refused; `/daemon/json_rpc` → 404; another origin gets no CORS header.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(node-proxy): allowlisted node proxy at root paths`.

### Task 12: Browser escrow runtime

**Files:**
- Create: `apps/web/src/escrow/{worker,store,policy,useEscrow,signals}.ts`
- Test: `apps/web/test/{escrow-store,policy,attestation-flow}.test.ts` (vitest `happy-dom` + `fake-indexeddb`)

**Interfaces:**
- Consumes: `runParty`, `wsTransport`, `generateIdentity`, `seal`/`open`; Tasks 7, 8, 10.
- Produces:
  - `escrowStore`: IndexedDB `x2f-escrow`, one record per trade code `{ identity (secrets wrapped), partyState, signalGuard, signalSeq }`, wrapped by a non-extractable AES-GCM `CryptoKey`. The escrow wallet password is 32 random bytes from `crypto.getRandomValues`, never a user password, wrapped by the same key and kept in a separate object store `x2f-escrow-secrets`, apart from `partyState` (R27). Both records are deleted when the trade closes. Secrets never leave the worker except wrapped.
  - `cosignPolicy(ctx: { role; own: { payout?: string; refund?: string }; balance: bigint; trade: TradeView; signedTerms: { payout: string; refund: string } }, outcome: Outcome): boolean` gates every `settle` call the app makes. `balance` comes from the device's **own** `funds()`, never the API, and only when balance == unlocked. The buyer settles only (a) a seller-built release equal to `payoutsFor('release')` with index 0 its own payout address, (b) a seller-built lapse refund equal to `payoutsFor('lapse-refund')`, or (c) its own buyer-built `payoutsFor('buyer-cancel')` with the mod as co-signer. The seller settles only a buyer-built mutual cancel equal to `payoutsFor('mutual-cancel')`, and builds release, lapse refund and the no-show refund. Either side co-signs a mod-built tx only when every output to that side goes to its own address (Plan 4 rulings). When `funds().balance` changes before this side has signed (a late surplus), the app re-derives and settles again.
  - `useEscrow(code): { phase: 'idle'|'registering'|'verifying'|'setting-up'|'ready'|'signing'|'done'|'error'; error: 'participants-mismatch' | null; checkWords: string[] | null; keepOpen: boolean; release(); buildRefund(); buyerCancel(); proposeCancelSign(); signal(type) }`. `buyerCancel()` (buyer only) sends the `trade.cancel` signal and settles `payoutsFor('buyer-cancel')` with `builder:'buyer', cosigner:'mod'`. It generates the identity in the worker, registers it with its proof, polls the attestation, runs `verifyAttestation` against `VITE_MOD_SIGNING_PUBLIC` (on failure: `participants-mismatch`, stop, no funding address shown), sends `trade.terms`, then runs `runParty` with the attested participants. It resumes every stored trade on page load. On `lapsed` with funds received, the seller's app builds the lapse refund automatically, and the buyer's app co-signs it through `cosignPolicy`.

- [ ] **Step 1: Write the failing tests:**
  - The store round-trips and no stored value contains the plaintext secret; the wallet password is not in the `partyState` record and differs per trade (R27).
  - `cosignPolicy` accepts the allowed shapes and refuses: a lapse refund to another address, any extra output, a release whose buyer output differs by one atomic unit, a surplus paid to the taker instead of the poster, a buyer-cancel outcome from the seller's app, and a mod-built tx paying the counterparty from this side's share.
  - **A stubbed API returning an attestation without this device's key → `phase 'error'`, `participants-mismatch`, `runParty` never called.**
  - `checkWords` match between two stubbed devices.
- [ ] **Step 2:** Run `npm test -- --project @x2f/web`; expect FAIL.
- [ ] **Step 3:** Implement. monero-ts runs in the worker (`'wasm-unsafe-eval'` is in the CSP).
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(web): resumable escrow runtime with attestation check`.

### Task 13: Web shell, tokens, fonts, CSP and security headers

**Files:**
- Create: `apps/web/{package.json,vite.config.ts,index.html}`, `apps/web/src/{main,App}.tsx`, `apps/web/src/theme/{tokens.css,fonts.css}`, `apps/web/src/api/client.ts`, `tools/tokens-to-css.ts`, `apps/api/src/static/serve.ts`, `apps/web/e2e/{playwright.config.ts,shell.spec.ts}`
- Test: `apps/api/test/headers.test.ts`

**Interfaces:**
- Produces:
  - `tokens.css`: every `tokens.json` colour as `--x2f-<name>` under `:root[data-theme=night]` (the default) and `[data-theme=day]`, plus spacing, radius and type tokens. Generated by `npm run tokens`; a stale-file test.
  - `api(path, init?)`: `credentials: 'same-origin'`, bigints as strings, throws `AuthApiError`-shaped errors. A 403 `terms-required` from any call navigates to `/terms?returnTo=<current>` (Plan 2 R10); a 409 `no-wallet` navigates to `/wallets?add=1&returnTo=<current>` (spec 6.4). `useServerClock(serverNow): () => Date`.
  - Routes: `/sell`, `/sell/:methodId`, `/buy`, `/buy/:methodId`, `/post`, `/trade/:code`, `/trade/:code/dispute`, `/wallets`, `/setup/*`, `/terms`, `/login`, `/settings/security`. Phones get `BottomNav`; ≥ 1024 px gets `DesktopShell`.
  - Vite: `resolve.alias` maps `net` and `tls` to an empty module (research §3, P3-M8). The fixture mode `VITE_FIXTURES=1` is excluded from production builds.
  - `serveWeb(app)` (@fastify/static) sends the CSP and the Global Constraints headers. API responses get the non-CSP headers.

- [ ] **Step 1: Write the failing tests:**
  - `shell.spec.ts` loads `/sell` with zero CSP violations and zero requests to other origins.
  - Tokens are fresh.
  - The production bundle contains none of `satoshi_ghost`, `mira.k`, `fixture`.
  - `headers.test.ts`: `Referrer-Policy: no-referrer`, COOP, HSTS and nosniff on an API route and on `index.html`.
  - `shell.spec.ts`: a stubbed `terms-required` sends the page to `/terms` with `returnTo`; a stubbed `no-wallet` sends it to `/wallets?add=1` with `returnTo`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check` and `npx playwright test -c apps/web/e2e/playwright.config.ts shell`; expect PASS.
- [ ] **Step 5:** Commit `feat(web): app shell, tokens, CSP and security headers`.

### Task 14: UI kit

**Files:**
- Create: `apps/web/src/ui/{Button,StatusChip,Countdown,Amount,TradeHeader,MethodExplainer,BottomNav,DesktopShell,Sheet,BadgePill,EscrowDots,HoldButton,ModeratorBadge,ExternalLink}.tsx`
- Test: `apps/web/test/ui.test.tsx`, `apps/web/test/HoldButton.test.tsx`

**Interfaces:**
- Produces:
  - `<Button variant="primary">` renders the orange fill and `data-primary`. `<StatusChip tone="caution|escrow|danger" icon label>` is a type error without `label`. `<Countdown deadline serverClock>` renders `data-mask=clock`.
  - `<TradeHeader>`: tapping the method name opens `MethodExplainer` with `whatItIs` (spec 2.6, P3-M3).
  - `HoldButton({ holdMs = 1500, disabled, onComplete, label, holdingLabel })`: pointer and keyboard (Space/Enter) hold. The fill goes 0→100% over 1.5 s, an early release resets it, and `onComplete` fires once. Under reduced motion it shows the text "Keep holding… 1.0 s".
  - `<ModeratorBadge>`: violet shield and "X2F Moderator". `<ExternalLink>` always sets `rel="noreferrer noopener"` and `target="_blank"`.

- [ ] **Step 1: Write the failing tests:**
  - HoldButton: 1,499 ms does not complete; 1,500 ms completes once; disabled ignores holds; a keyboard hold works.
  - The method name opens the explainer.
  - `ExternalLink` has `noreferrer`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(web): UI kit`.

### Task 15: Parity harness, board references and copy-lint

**Files:**
- Create: `apps/web/e2e/parity.ts`, `tools/parity/serve-boards.ts`, `tools/parity/capture-refs.ts`, `design/x2f-app/refs/*.png`, `tools/copy-lint.ts`, `apps/web/src/fixtures/boards.ts`
- Modify: root `package.json` (`check` runs `copy-lint`)

**Interfaces:**
- Produces:
  - **Controller step (not a script):** the controller fetches the canvas runtime with the Artifact tool (`action: read`, url = X2F App, `path: 'support.js'`) into `design/x2f-app/support.js`. If the canvas has none, the controller asks the owner for exported board PNGs.
  - `capture-refs.ts`: serves `design/x2f-app/` and screenshots each board at its `canvas.json` size into `refs/<Board>.png`.
  - `expectParity(page, board, o?: { masks?: Locator[]; viewport?: '390x844' | '1280x800' })`. Blocking: exactly one `[data-primary]`, no horizontal scroll, no `text-transform` on `[data-username]`, and every board text node (minus `[data-mask]` regions) present verbatim. Reported, not blocking: a `toHaveScreenshot` diff at `maxDiffPixelRatio: 0.03`, attached to the report for a person to review (P3-M6).
  - `copy-lint.ts`: fails on `!` in JSX text or string literals under `apps/web/src/` (code operators excluded) and on any emoji code point.

- [ ] **Step 1: Write the failing tests:** copy-lint flags a planted `"Done!"` and an emoji; `expectParity` fails a page with two `[data-primary]`; the 1280×800 header text matches the Desktop board.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement, then run the controller step and `capture-refs.ts` and commit the PNGs.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(web): board parity harness and copy-lint`.

### Task 16: Sell browse — Main and SellOffers

**Boards:** `Main.dc.html`, `SellOffers.dc.html`.

**Files:**
- Create: `apps/web/src/screens/browse/{MethodList,OfferList,OfferCard,SuggestMethodSheet}.tsx`
- Test: `apps/web/e2e/browse-sell.spec.ts`

**Interfaces:**
- Consumes: `GET /v1/methods`, `/v1/offers`, `/v1/price`, `POST /v1/method-suggestions`.
- Produces: `/sell` shows "Buyers paying in USD", then "All payment methods" A–Z, currency chips, search, Sort (Most buyers, Best rate, A–Z), and the board's empty-search copy with a "Suggest it" link (P3-M3). `/sell/:methodId` shows offer cards with Trade (online, eligible) or Message / Nudge (offline), the market price line, Sort, and badges (at most 2 featured, `+N` popover). `MethodList` and `OfferList` take a `side` prop that Task 17 reuses.

- [ ] **Step 1: Write the failing tests:** parity for both boards; EUR shows only EUR offers; logged out, the list renders with no session request failing; a suggestion posts and shows the board-style confirmation.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the spec and `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(web): sell browse`.

### Task 17: Buy browse — BuyMain and BuyOffers

**Boards:** `BuyMain.dc.html`, `BuyOffers.dc.html`.

**Files:**
- Create: `apps/web/src/screens/browse/BuyCopy.ts`
- Test: `apps/web/e2e/browse-buy.spec.ts`

**Interfaces:**
- Consumes: Task 16 components with `side="buy"`.
- Produces: `/buy` ("How do you want to pay?") and `/buy/:methodId` ("Buy XMR via Zelle", "Releases in ~N min", footer "You pay no X2F fee when you take an offer.").

- [ ] **Step 1: Write the failing tests:** parity for both boards; offers sort by Best price ascending.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the spec and `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(web): buy browse`.

### Task 18: Quotes and the Trade button — BuyQuote and the seller quote

**Boards:** `BuyQuote.dc.html`. The seller quote has no board; it mirrors BuyQuote's parts.

**Files:**
- Create: `apps/web/src/screens/quote/{BuyQuote,SellQuote,WalletPicker,useTake}.tsx`
- Test: `apps/web/e2e/quote.spec.ts`, `apps/web/test/quote.test.ts`

**Interfaces:**
- Consumes: `POST /v1/offers/:id/take`, `GET /v1/wallets`, `withConfirm` (via Task 30's sheet), Task 1 maths.
- Produces:
  - BuyQuote: You pay (fiat) or XMR, the board's range help, "Which wallet gets paid?" (`WalletPicker` over `usable` wallets; "Add another wallet" goes through confirm-it's-you, X-4; with no usable wallet, Trade becomes "Add a wallet" and opens Add a wallet with `returnTo`, spec 6.4), You receive, Rate, Network fee (OD-4 copy), the fiat total in both parties' currencies when they differ (P3-M3), "Nothing changes after you tap Trade…", and the primary **Trade**. No X2F fee line.
  - SellQuote: amount or **Max**, the funding and refund wallet picker, the same rows; no fee line.
  - `useTake`: logged out → `/setup` with `returnTo`, resuming the take after setup; logged in → `take` → `/trade/:code`.

- [ ] **Step 1: Write the failing tests:**
  - Parity BuyQuote.
  - A taker's quote never contains "X2F fee" or "1%".
  - Trade on a market offer is disabled with "Price unavailable right now" on a 503; a fixed-price offer still quotes.
  - Trade is disabled until a usable wallet is picked; with no wallets, the primary goes to Add a wallet and the take resumes after it.
  - The quote has no Deposit row.
  - Logged-out Trade → `/setup/terms`, then `/trade/<code>` after a stubbed setup.
  - The quote's fiat total equals the `fiatCents` the trade stores (OD-5).
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the specs and `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(web): quotes with wallet picker and Trade`.

### Task 19: Live events, Web Push and the accepted-offer sheet

**Files:**
- Create: `apps/api/migrations/105_push.sql`, `apps/api/src/events/{bus,routes}.ts`, `apps/api/src/push/{routes,send}.ts`, `apps/web/src/api/events.ts`, `apps/web/public/sw.js`, `apps/web/src/push/usePush.ts`, `apps/web/src/screens/AcceptedSheet.tsx`
- Test: `apps/api/test/{events,push}.test.ts`, `apps/web/e2e/accepted.spec.ts`

**Interfaces:**
- Produces:
  - `GET /v1/events` (SSE, `requireTrader`): `{type:'trade', code, state}`, `{type:'accepted', code, by}`, `{type:'chat', chat}`, `{type:'nudge', from, context}`. `publish(accountId, ev)` delivers only to that account's streams. `delivered(accountId): boolean` (any open stream).
  - `POST /v1/account/push { endpoint, keys }` and `DELETE`. `sendPush(accountId, kind: 'nudge' | 'trade')` uses web-push with VAPID (`VAPID_PUBLIC`, `VAPID_PRIVATE`). The payload is exactly "Someone nudged you on X2F" or "Something changed in a trade on X2F", with no code and no URL beyond `/`. It returns true when a push service answered 201.
  - Final-alert delivery: on `request-refund`, the API publishes and pushes to the buyer (after the actor's request, `setImmediate`); `final_alert_delivered` is set true only by the buyer's seen-receipt and is otherwise null, which moderation (Task 10) treats as false (Revision 2026-10-25; was `delivered || pushAccepted`). The receipt is posted only by Task 25's `FinalAlert` (once per `finalAlertAt`, while the alert is on screen); never by the events client or the service worker (a notification in the tray is not proof it was read). `final_alert_seen_at` keeps the first receipt's time (trade view `finalAlertSeenAt`); Task 10 counts 15 min from it (review 2026-10-27).
  - `GET /v1/events` checks the session read-only (`requireSession({ touch: false })`): a stream never refreshes `last_seen_at` / `expires_at`, and ends at the session's deadline when sooner than `maxStreamMs`.
  - Push: `kinds: ['trader', 'owner']`; a third fixed payload `alert` ("Something needs your attention") goes to the owner's subscriptions for `market-prices-paused` and `price-source-failing` (`push/ownerAlert.ts`, wired where `main.ts` passes `onAlert`).
  - `AcceptedSheet`: on `accepted`, the poster sees "<username> accepted your offer" and picks their wallet (`POST /v1/trades/:code/wallet`). Setup starts after that. A poster with no usable wallet left gets "Add a wallet" through `ConfirmSheet` (spec 6.4); the trade waits in `setup` until `setupBy`.

- [ ] **Step 1: Write the failing tests:**
  - SSE delivers `accepted` to the poster within 1 s and never to a third account (P3-M9).
  - The push payload for each kind is exactly the generic string.
  - `final_alert_delivered` stays null with no seen-receipt, even with an open stream or an accepted push (Revision 2026-10-25).
  - The accepted sheet posts the wallet and the room moves to "Setting up escrow".
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat: live events, generic Web Push, accepted-offer sheet`.

### Task 20: Encrypted chat

**Files:**
- Create: `apps/api/migrations/106_chat.sql`, `apps/api/src/chat/{routes,retention}.ts`, `apps/web/src/chat/{chatCrypto,ChatPanel}.tsx`
- Test: `apps/api/test/chat.test.ts`, `apps/web/test/chatCrypto.test.ts`

**Interfaces:**
- Consumes: `seal`, `open`, `ReplayGuard`, `generateIdentity`; moderation (chat mod identity via the Task 8 attestation flow, `channels.chat`).
- Produces:
  - `POST /v1/chats { offerId }` → `{ chat }` (a code from `newTradeCode`; roles fixed by the offer side). A take reuses the chat. `POST /v1/chats/:chat/identity` has the same proof rule and one per role (P3-I21). `GET /v1/chats/:chat/attestation`.
  - `POST /v1/chats/:chat/envelopes` takes an `Envelope` with `trade = channelFor(chat,'chat')`, sealed to buyer, seller and mod (`type: 'chat.msg'` inside). The body is at most 16 KiB (413 above). `GET …/envelopes?after=<id>`. The server stores ciphertext only.
  - Device binding: the chat identity lives on the device that created it. The sender's `seq` is a persisted per-chat counter. Each reader persists its `ReplayGuard` JSON per chat. Another device of the same account shows "This conversation is open on another device" read-only.
  - `purgeChats(now)`: envelopes are deleted 90 days after the linked trade closes (never while disputed); pre-trade chats after 7 days without a message.
  - `ChatPanel` always shows "Chats are encrypted. If a dispute is opened, a moderator can read this conversation." (spec 6.6, P3-M2), plus system cards for trade events.
  - **Controller step:** change the Desktop board's notice to the spec text on the canvas and in `design/x2f-app/Desktop.dc.html`, then re-capture `Desktop.png`.

- [ ] **Step 1: Write the failing tests:**
  - An envelope from the buyer opens for the seller and the mod identity, and for nobody else.
  - A non-participant gets 404.
  - A replay is rejected after a reload (the persisted guard).
  - 16 KiB + 1 → 413.
  - Retention keeps a disputed chat past 90 days.
  - The notice text is exact.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat: end-to-end encrypted chat`.

**Revision 2026-10-29 (owner):** `purgeChats` deletes envelopes 30 days after the trade closes (`TRADE_KEEP_DAYS`), or 90 days after the dispute button for a disputed trade, not 90 days after close. See "Revision 2026-10-29 (owner)" at the end.

### Task 21: PostOffer

**Board:** `PostOffer.dc.html`.

**Files:**
- Create: `apps/web/src/screens/PostOffer.tsx`
- Test: `apps/web/e2e/post.spec.ts`

**Interfaces:**
- Consumes: `POST /v1/offers`, `GET /v1/price`, profiles.
- Produces: the board form (I want to, payment method (unavailable methods hidden, P3-I20), currency, price, smallest and largest trade, terms, minimum completed trades (Anyone, 5+, 10+, 50+; shown openly to takers), the "How others will see it" line). Price is **Market ± %** (the default, the board's margin −/+ with today's price) or **Fixed price per XMR** (spec 2.2 step 5); choosing Fixed shows the caution line "A fixed price goes stale when the market moves." The pricing choice is also added to the canvas as a controller step, with `PostOffer.png` re-captured. Primary **Post offer**. The OD-7 fee sentence sits under the preview. Logged out → setup, then back with the form intact. No usable wallet → Add a wallet with `returnTo`, then back with the form intact (spec 6.4).

- [ ] **Step 1: Write the failing tests:** parity; min > max is refused inline; margin steps by 0.1%; Fixed shows the stale-price warning and posts `pricing.mode = 'fixed'`; posting returns to `/sell/:methodId` with the offer visible; SBP is absent from the picker; a held user sees the API refusal as text; an account with no wallet lands on Add a wallet and returns to the filled form.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the spec and `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(web): post an offer`.

### Task 22: TradeFund and the escrow check

**Board:** `TradeFund.dc.html`.

**Files:**
- Create: `apps/web/src/screens/trade/{TradeRoom,TradeFund,FundFallback,SetupStatus}.tsx`
- Test: `apps/web/e2e/fund.spec.ts`

**Interfaces:**
- Consumes: `TradeView`, `useEscrow`, `moneroUri`, `qrcode`.
- Produces:
  - `TradeRoom` routes role × state to a screen.
  - `SetupStatus`: "Setting up escrow", `EscrowDots`, the keep-open bar, the escrow-check words once ready ("Escrow check: four words. They match on <counterparty>'s screen."), and on `participants-mismatch` a danger state, "Security check failed. Don't fund this trade.", with Cancel.
  - TradeFund (seller): the board's header, chip, explainer and amounts. **Primary "Open in <wallet app>"** → `moneroUri(escrowAddress, sellerFundsAtomic)` on Android and iOS only; desktop gets QR and copy as the main content. The network-fee row reads "Network fee · set in your wallet" (P3-M12; the seller pays the funding fee, spec 11.1). The poster-seller funds amount + 1% and sees "Includes X2F fee (1%, your ad) 0.012500 XMR". When short: "Received 1.000000 of 1.250000 XMR, send the rest".
  - Before funding, the buyer sees "Waiting for <seller> to fund". The buyer never funds anything (no deposits, spec 2.5).
  - **Manual check (P3-M12):** on an iPhone, Cake Wallet and Edge open a `monero:` link with the address and amount filled in. Record the result in `docs/manual-checks.md`.

- [ ] **Step 1: Write the failing tests:**
  - Parity.
  - The link href equals `moneroUri(...)`.
  - On a desktop UA the primary is Copy.
  - The countdown follows `serverNow` with the browser clock 10 min ahead (`page.clock`, Review Focus 3).
  - The taker seller sees no "X2F fee".
  - The buyer's room before funding shows "Waiting for <seller> to fund" and no address, QR or wallet link.
  - `participants-mismatch` → no address on screen.
  - The fiat total equals the quote's.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the spec and `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(web): fund escrow, escrow check`.

### Task 23: BuyerPay and the desktop trade room

**Boards:** `BuyerPay.dc.html`, `Desktop.dc.html`.

**Files:**
- Create: `apps/web/src/screens/trade/{BuyerPay,PaidConfirmSheet,CancelSheet,TradeTimeline}.tsx`
- Test: `apps/web/e2e/pay.spec.ts`

**Interfaces:**
- Consumes: `POST /v1/trades/:code/events`; `useEscrow().signal('trade.paid')`, `useEscrow().buyerCancel()`; `ChatPanel`.
- Produces:
  - Escrow chips: amber "Securing escrow" with "Confirmations 3 of 10 · about 14 min"; amber "Releasable in N min" while funds are confirmed but not yet unlocked (spec 7, P3-I4); teal "Escrow secured". "Time to pay 90 min / Clock starts when escrow settles…", then the countdown.
  - Payment details from the profile `fields`, Memo = trade code, the own-name warning. The proof slot (Plan 5) is masked.
  - **I've paid** opens `PaidConfirmSheet` (checkbox "I sent exactly $412.50 via Zelle with K7M2-9QXA-4FTR-8WPN in the memo", **Yes, I've paid** / **Not yet**, plus "Sending without proof makes disputes harder."). Yes posts `mark-paid` with `fiatCents` = the total the sheet showed **and** sends the `trade.paid` signal, and shows "Marked as paid" only after the mod's `trade.ack`. On 409 `total-changed` (the trade grew while the sheet was open) nothing is sent: the sheet re-reads the trade and asks again with the new total (Revision 2026-10-21).
  - Buyer **Cancel** (spec 2.3): before I've paid it is one tap, posting `buyer-cancel` and calling `buyerCancel()`; the XMR goes back to the seller with no agreement needed. ~~After I've paid, `CancelSheet` first shows the danger warning "Only cancel if your payment was never sent or was returned. Scammers try to talk buyers into cancelling after they've paid." and cancels only on its confirm button.~~ *2026-10-29b: no cancel after I've paid; the buyer's cancel before it is OPEN (A or B); Task 39.* The seller's room has no cancel-alone action after funding, only **Propose cancel** (mutual cancel), which gives the buyer an accept/decline card.
  - Desktop: `TradeTimeline`, counterparty card and `ChatPanel` per the Desktop board.

- [ ] **Step 1: Write the failing tests:**
  - Parity BuyerPay at 390×844 and Desktop at 1280×800.
  - The box unticked → nothing happens. Not yet → state stays `secured`. Yes → `paid`, the seller gets the system card, and the signal is sent.
  - A growth while the sheet is open → Yes gets `total-changed`, no signal is sent, the state stays `secured`, and the sheet shows the new total.
  - Before paid, one tap on Cancel → `settling`/`buyer-cancel` and the `trade.cancel` signal is sent. ~~The post-paid cancel shows the warning first and does nothing until confirmed.~~ *2026-10-29b: after I've paid no cancel is offered (Task 39).*
  - The seller's funded room offers no cancel-alone control in any state.
  - "Releasable in N min" shows at 10 confirmations before unlock.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the spec and `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(web): buyer pays, confirm step, buyer cancel, desktop room`.

### Task 24: SellerConfirm and Released

**Boards:** `SellerConfirm.dc.html`, `Review.dc.html` (the released part; the rating cards are Plan 5 and masked).

**Files:**
- Create: `apps/web/src/screens/trade/{SellerConfirm,Released}.tsx`; add `GET /v1/trades/:code/confirmations` to `apps/api/src/trades/routes.ts`
- Test: `apps/web/e2e/release.spec.ts`

**Interfaces:**
- Consumes: `HoldButton`, `useEscrow().release()`, the profile `checkPrompt`.
- Produces:
  - SellerConfirm: "<buyer>: Payment sent", confirm countdown, "Check your bank account for $412.50 sent via Zelle" (from the profile), the screenshot reminder (smart proof card masked), the checkbox, and HoldButton with the board's three lines. HoldButton is disabled with "Releasable in N min" until `releasable`. "Payment not received" → DisputeOpen (Task 27).
  - On complete: `release-started`, then `release()`; the buyer's app co-signs via `cosignPolicy`; `settling` → `released`.
  - Released: the board copy, the destination ending, confirmations "1 of 10" from `/confirmations`, and "View on the Monero blockchain" as an `ExternalLink` with the explorer note. **Poster only:** Trade amount, `X2F fee (1%, your ad) −0.012500 XMR`, You receive.

- [ ] **Step 1: Write the failing tests:** parity for both boards; release is disabled until the checkbox is ticked and while not releasable; the poster-buyer view shows the fee row and the taker view has none; the explorer link has `rel="noreferrer noopener"`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the spec and `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(web): press-and-hold release and released screen`.

### Task 25: SellerRefund, extend and the buyer's final alert

**Board:** `SellerRefund.dc.html`.

**Files:**
- Create: `apps/web/src/screens/trade/{SellerRefund,FinalAlert}.tsx`
- Test: `apps/web/e2e/refund.spec.ts`

**Interfaces:**
- Consumes: the events route; `useEscrow().buildRefund()` and `signal('trade.refund-request' | 'trade.extend')`.
- Produces: SellerRefund (seller, `secured` past `payBy`, unpaid). It shows the board copy and the dispute-after-refund warning before the tap. Primary **Cancel & get refund**: `request-refund`, then the signal, then `buildRefund()` settles `payoutsFor('auto-refund')` with `builder:'seller', cosigner:'mod'`; the mod signs only once its own guard allows (Task 10). The screen appears only after `payBy` has passed by the server clock, so the final alert always starts after the payment window. **Give 30 more min** (`extend` + signal; hidden after 2). **Nudge <buyer>**. `FinalAlert` (buyer, `refund_requested`): danger chip "The seller is cancelling. If you already paid, tap I've paid now.", the 15-minute countdown, and I've paid as the primary.

- [ ] **Step 1: Write the failing tests:** parity; Give 30 more min twice, then hidden; Cancel & get refund sends exactly one tx set and one signal; the buyer sees FinalAlert with the server-clock countdown.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the spec and `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(web): seller refund, extend, final alert`.

**Revision 2026-10-29 (owner):** every refund path records its reason on the trade for Task 27's buyer refunded screen. See "Revision 2026-10-29 (owner)" at the end.

### Task 26: Nudges

**Board:** Nudge on `SellOffers.dc.html`.

**Files:**
- Create: `apps/api/migrations/107_nudge.sql`, `apps/api/src/nudge/routes.ts`, `apps/web/src/nudge/{useNudge,buzz}.ts`
- Test: `apps/api/test/nudge.test.ts`, `apps/web/e2e/nudge.spec.ts`

**Interfaces:**
- Produces:
  - `POST /v1/nudges { to: username, context: chat | code }`. Sender-own refusals: `no-shared-context`, `too-soon` (one per sender per 10 min). Silent drops (`recipient-busy` 3/hour, blocked, quiet hours, nudges off) all return the same `202` as a delivered nudge (P3-M5).
  - `PUT /v1/account/nudges { enabled, quietFrom, quietTo, tz }` (enabled by default); `POST /v1/account/blocks { displayName }`.
  - Delivery: SSE `nudge` → "Wake up, <name> wants to trade" and a WebAudio buzz while the tab is open. A hidden tab gets a `Notification` "Someone nudged you on X2F". A closed tab gets Web Push `nudge` (Task 19).

- [ ] **Step 1: Write the failing tests:**
  - `no-shared-context` and `too-soon`.
  - Blocked, quiet-hours, nudges-off and 4th-in-an-hour each return a 202 indistinguishable from a delivered one (same body, same headers).
  - Quiet hours apply in the recipient's time zone.
  - A hidden-tab Notification contains neither username nor amount.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat: nudges with private limits`.

### Task 27: Trader-side disputes — DisputeOpen, DisputeRoom, DisputeRuling

**Boards:** `DisputeOpen.dc.html`, `DisputeRoom.dc.html`, `DisputeRuling.dc.html`.

**Files:**
- Create: `apps/api/migrations/108_disputes.sql`, `apps/api/src/disputes/routes.ts`, `apps/web/src/screens/dispute/{DisputeOpen,DisputeRoom,DisputeRuling}.tsx`
- Test: `apps/api/test/disputes.test.ts`, `apps/web/e2e/dispute.spec.ts`

**Interfaces:**
- Consumes: `open-dispute`; `ChatPanel`; `cosignPolicy` (mod-built branch).
- Produces:
  - Tables `disputes(code, opened_by, reason, note, opened_at, due_at, status)`, `dispute_rulings(code, outcome, reason, evidence jsonb, moderator_username, ruled_at, appeal_until)` and `dispute_appeals(code, by, why, at)`. Plan 3 writes disputes and appeals; Plan 4 writes rulings, `due_at` and moderator joins.
  - `POST /v1/trades/:code/dispute { reason: 'paid'|'silent'|'terms'|'other', note }` → `open-dispute`. When not yet allowed, the screen explains when ("You can open a dispute if the seller hasn't confirmed within 2 h of your payment.") and sends nothing. `POST /v1/trades/:code/appeal { why }` is accepted only before `appeal_until`.
  - DisputeOpen: the board's reasons, note and the "moderator will read this trade's chat" line. The evidence region is masked (Plan 5).
  - DisputeRoom: "In dispute" rose chip, "<amount> XMR locked in escrow", the deadline line, and `ModeratorBadge` with the join banner when a moderator has joined (from server records only). The unblurred-proof request is masked (Plan 5).
  - DisputeRuling: the ruling card, the destination ending, evidence, the appeal window and the appeal sheet. When the mod-built tx arrives, the app co-signs only through `cosignPolicy`.
  - Dispute after refund: a `refunded` trade within 90 days shows "Open a dispute" for the buyer.

- [ ] **Step 1: Write the failing tests:**
  - Parity for all three boards (fixtures for the moderator and ruling records).
  - Open before `confirmBy` shows the explanation and sends nothing.
  - An appeal after the window → 409 `too-late`.
  - A mod-built tx paying the counterparty from this side's share is refused.
  - The violet badge renders only inside a disputed trade.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the specs and `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat: trader-side disputes`.

**Revision 2026-10-29 (owner):** the buyer's refunded screen shows every refund reason; a settled dispute counts as a completed trade whoever won, with no stage drop; the appeal window is ~~72~~ **48** hours (owner, 2026-10-29c). See "Revision 2026-10-29 (owner)" and "Revision 2026-10-29c (owner)" at the end.

### Task 28: Getting started (onboarding)

**Boards:** `SetupTerms` (Getting started screen 0; on the canvas but not yet in `design/x2f-app/`, so a controller step mirrors it and captures `SetupTerms.png` first), `SetupWelcome`, `SetupUsername`, `SetupLogin`, `SetupPgpKey`, `SetupPgpChallenge`, `SetupPassword`, `SetupBackup`, `SetupWallet` (and `SetupWelcome` as the end screen).

**Files:**
- Create: `apps/web/src/screens/setup/{SetupFlow,Terms,Username,Login,PgpKey,PgpChallenge,Password,Backup,Wallet,Welcome}.tsx`, `apps/web/src/session/useSession.ts`
- Test: `apps/web/e2e/setup.spec.ts`

**Interfaces:**
- Consumes: Plan 2 `createAuthApi`, the register routes, `GET /v1/terms`, `POST /v1/account/terms`; `returnTo` (Tasks 18, 21).
- Produces: the setup flow in board order, starting with **Terms** (spec 6.1 step 0, Plan 2 R10): the Terms text in a scroll box, a tick box that enables only after scrolling to the end, and **I accept**; the accepted version from `GET /v1/terms` is sent as `acceptedTerms` with the register call. The same `Terms` screen, mounted at `/terms`, handles a `terms-required` refusal for a logged-in trader: I accept posts `POST /v1/account/terms`, then returns to `returnTo`. Username is 5–20 characters, shown as typed. Login method has PGP first. Backup has "Skip for now". Link a wallet uses the first-wallet path (no confirm-it's-you, Plan 2 R12). Welcome has **Start trading** → `returnTo`, and the OD-7 fee sentence (P3-M4). A user who reaches `returnTo` (a take or a post) with no usable wallet is sent to Add a wallet first (spec 6.4).

- [ ] **Step 1: Write the failing tests:** parity for every Setup board; I accept stays disabled until the Terms box is scrolled to the end and ticked; the register call carries `acceptedTerms`; raising the stubbed Terms version sends a logged-in trader to `/terms` and back to the same screen after accepting; `Mira.K_` shows as `Mira.K_` after setup; the first wallet is added without a confirm prompt; the take resumes after Welcome.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the spec and `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(web): getting started`.

### Task 29: Your wallets

**Board:** `Wallet.dc.html`.

**Files:**
- Create: `apps/web/src/screens/Wallets.tsx`
- Test: `apps/web/e2e/wallets.spec.ts`

**Interfaces:**
- Consumes: `GET/POST/DELETE /v1/wallets` (via the confirm sheet, Task 30), `escrowStore`.
- Produces: the wallet list (name, address end, status, never a balance), Add a wallet with the app picker, the Edge Full Sync tip, the optional fresh-address tip, and the per-trade escrow key row from `escrowStore`. `/wallets?add=1&returnTo=…` opens Add a wallet directly and returns after the add (the `no-wallet` path, spec 6.4). The board's "is backed up to your PGP key" changes to "It stays on this device and is deleted when the trade closes." (P3-I14). That change is also made on the canvas as a controller step, with `Wallet.png` re-captured.

- [ ] **Step 1: Write the failing tests:** parity; no "backed up" text; the escrow key row appears while a trade is open and disappears after; a waiting wallet shows its status and is absent from the take picker.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the spec and `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(web): your wallets`.

### Task 30: Log in, confirm-it's-you and Security settings (P3-C4)

**Boards:** `SetupLogin` and `SetupBackup` (reused); everything else from design-system parts.

**Files:**
- Create: `apps/web/src/screens/auth/{Login,BackupLogin,ConfirmSheet}.tsx`, `apps/web/src/screens/settings/{Security,Methods,Totp,RecoveryCodes,LogoutTimer,Devices,Alerts}.tsx` (LogoutTimer replaces the retired PayoutWait screen, owner 2026-10-23: `GET`/`PUT /v1/account/security/logout-timer` `{ idleHours }`, choices 2-12 hours, read-only for staff and owner)
- Test: `apps/web/e2e/login.spec.ts`, `apps/web/e2e/security.spec.ts`

**Interfaces:**
- Consumes: Plan 2 `createAuthApi`, `withConfirm`, `loginWithPasskey`, `loginWithSecurityKey`, `confirmWithWebAuthn`, `registerWithWebAuthn`; the soft authenticator from Plan 2 Task 7 in tests.
- Produces:
  - `/login`: PGP (copy message, paste code), passkey, security key, password (+ TOTP when asked), and a "Use a backup" link → `BackupLogin` (recovery code or TOTP per Plan 2's rules). An expired session anywhere routes here with `returnTo`. A login whose `me().termsCurrent` is false goes to `/terms` before `returnTo` (Plan 2 R10).
  - `ConfirmSheet({ action })`: the `prove` callback for `withConfirm`, offering the account's methods. It is the only UI for Plan 2's action-bound confirm (X-4).
  - `/settings/security`: login methods (list, add, remove; last-method guard), TOTP enrolment with QR, recovery codes (show once), "Make new payout addresses wait 24 hours" (spec 6.3), devices with remote log-out, and the alerts list (spec 6.4).

- [ ] **Step 1: Write the failing tests:** one e2e login per method (PGP via a test key, passkey and security key via the soft authenticator, password + TOTP, recovery code); an expired session returns to the same screen after login; a login on a stale Terms version shows the Terms screen first; adding a wallet opens ConfirmSheet exactly once; removing the last method is refused with Plan 2's message; ending another device's session logs it out.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the specs and `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(web): log in, confirm-it's-you, security settings`.

### Task 31: End-to-end trades between two browsers on regtest

**Files:**
- Create: `apps/web/e2e/stack.ts` (regtest, relay with admin port, node proxy, API with internal port, moderation process, Vite preview), `apps/web/e2e/trade.e2e.spec.ts`

**Interfaces:**
- Consumes: everything above; Plan 1's regtest harness. Funding uses a regtest wallet paying the address and amount parsed from the Open in … link or the copy button. Tests mine **12** blocks after funding.

- [ ] **Step 1: Write the failing tests**, each at 390×844 and 1280×800, with two browser contexts:
  - Taker seller, poster buyer: browse → Trade → accepted sheet → fund → 12 blocks → I've paid → hold → the buyer's wallet receives amount − 1% − network fee; the fee wallet receives exactly 1%; only the buyer sees the fee row.
  - Taker buyer, poster seller: the seller funds amount + 1%; the buyer receives within the network fee of the full amount and never sees a fee.
  - Surplus: the taker seller on a buyer's ad overpays by 0.0001 XMR → the buyer-poster receives amount − 1% + 0.0001 − network fee; the fee wallet receives exactly 1%. Extra coins sent after `secured` hold the release until they have 12 blocks, then everything is swept.
  - Mutual cancel after funding: no fee output.
  - Buyer cancel: before I've paid, one tap → the seller's signed refund address receives the balance minus the network fee **with the seller's page closed**; ~~after I've paid, the warning shows first~~ after I've paid, no cancel is offered (2026-10-29b). *If the owner picks option A, this case becomes "Ask to cancel" + the seller's Cancel (Task 39 Step 0).* The seller's room never offers a cancel-alone action.
  - Buyer no-show: clock past `payBy`; Cancel & get refund; buyer silent with an open SSE stream; after 15 min the refund lands **with the seller's page closed**.
  - Lapse: the seller never funds; the buyer's room says the trade ended with no penalty.
  - **Reload the seller's page during signing and the buyer's page during co-signing:** both resume, exactly one release tx, ending `released` (Review Focus 1).
  - **Swapped participants:** the API test hook replaces the buyer identity → the buyer's room shows "Security check failed" and the seller's check words differ from the buyer's.
- [ ] **Step 2:** Run. The expected first failure is `stack.ts` timing out waiting for the moderation process's first `/internal/v1/work` poll, until the internal port is wired into the stack.
- [ ] **Step 3:** For each failure, fix it in the owning task's files with a unit test in that task's test file, and name the task in the commit message (`fix(task-N): …`).
- [ ] **Step 4:** `npx playwright test -c apps/web/e2e/playwright.config.ts` and `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `test: end-to-end trades on regtest at phone and desktop sizes`.

### Task 32: Stagenet smoke run and load check (P3-I18)

**Files:**
- Create: `tools/stagenet/smoke.ts`, `tools/load/trades.ts`, `docs/perf/plan-3-load.md`

- [ ] **Step 1:** `smoke.ts` runs one full release and one auto-refund between two Node trader parties and the real moderation process on stagenet with real block times. Expected: both settle, and the measured times are recorded.
- [ ] **Step 2:** `trades.ts` opens 25 concurrent trades on regtest (12-block mining every 2 min). Record the moderation process's RSS, the per-trade sync lag and the time to `secured`. Pass: lag < 60 s and no OOM.
- [ ] **Step 3:** Write the numbers and any limit (for example, max open trades per moderation process) in `docs/perf/plan-3-load.md`.
- [ ] **Step 4:** Commit `test: stagenet smoke and 25-trade load check`.

### Task 33: Security review, roadmap and follow-ups

**Files:**
- Create: `docs/security/plan-3-review.md`
- Modify: `docs/superpowers/plans/2026-10-15-roadmap.md`

- [ ] **Step 1:** Run the Claude Security scan over `packages/trade`, `apps/api`, `apps/moderation`, `apps/web`, `apps/relay` and `apps/node-proxy`; run Semgrep 1.178.0 and `npm audit --omit=dev`.
- [ ] **Step 2:** Fix every confirmed finding in the owning task's files with a test that would have caught it, then re-run `npm run check`.
- [ ] **Step 3:** Record in `docs/security/plan-3-review.md`: the findings and fixes; the P3-C1 design and its residual risks (the API can register a fake identity, but that holds one key at most; a compromised API can delay or prompt a refund that still pays only the seller's signed address; buyer-cancel refunds need the buyer identity's own signal and pay only that address; client-bundle tamper is Plan 6); how each Plan 1 follow-up was closed (Task 7, R27); and every OD with the owner's answer.
- [ ] **Step 4:** Update the roadmap: Nudge and Web Push are in Plan 3 (P3-M11); buyer deposits were dropped (spec 2.5); buyer cancel, surplus to the poster, the Terms screen and the wallet-before-trading rule are built in Plan 3. Record the Revision 2026-10-18 open questions with the owner's answers. Plan 6 gets the security-key tap to fund, the escrow-key PGP backup (spec 6.4), "require a security key to log in", "use your own Monero node", device-key TOFU (OD-1) and SRI. Plan 4 gets rulings via `verifyRuling`, the moderator join records, and the lost-device ruling test.
- [ ] **Step 5:** Commit `docs: plan 3 security review and roadmap`.

## Revision 2026-10-24 (lead, from the owner's starter-limits decision)

The owner replaced "no trade limits for new accounts" with starter limits (spec 2.3).
- **Task 1 (schema):** a new migration adds the owner settings `starter_cap_usd` (200), `building_cap_usd` (1000), `building_min_trades` (5), `building_min_days` (7), `graduated_min_trades` (20), `graduated_min_days` (30) and `starter_max_open_trades` (3). Each is stored as a row the owner can change, and every change is logged.
- **Shared helper:** `tradeCap(deps, accountId, now)` returns `{ stage, capUsd | null, maxOpen | null }`. "Completed" means released trades plus trades whose dispute settled, whoever won (R38; `COMPLETED_TRADES_SQL`: `state = 'released' or (state = 'refunded' and dispute_by is not null)`); a lost dispute drops no stage (owner 2026-10-29, replacing "completed with no lost dispute; each lost dispute drops one stage").
- **Task 4 (offers):** an offer list for a signed-in viewer marks offers whose minimum exceeds the viewer's cap (`opensAt: 'building' | 'graduated'`). Posting an offer clamps nothing; the cap is checked per trade.
- **Task 5 (taking an offer):** the USD equivalent of the trade amount at the locked rate must be within both sides' caps (409 `starter-limit`, naming only the caller's own stage, never the other side's). The Starter open-trade count is enforced in the same transaction as the trade insert.
- **Escrow growth (overfunding):** growth may not push the trade above either side's cap. Otherwise the trade amount stays fixed and the extra returns to the seller, as for "above the offer's maximum".
- Tests cover each stage boundary, the day thresholds, a lost dispute that still counts and drops no stage (owner 2026-10-29), the open-trade count, and a cap error that never reveals the other side's stage.


## Revision 2026-10-28 (lead, from the owner's decisions of 2026-10-27)

Authority: spec > `rulings-and-lessons.md` > earlier revisions > this note. Source: `HANDOFF.md` "Decided 2026-10-27 (owner)".
- **No guest buying (owner).** There is no buy path without an account; disputes need one. Nothing to remove: setup already starts on the first Trade tap or ad post (spec 6.1). **Task 28 (Getting started)** gains one test: from a Trade tap by a visitor, the shortest route (Terms, username, PGP or passkey, first wallet) returns to the same quote with the amount kept, in no more than the board's screens, with no dead end. Any extra step added later must keep that test green.
- **Chat keys unchanged (owner).** Task 20 is built as written: chats sealed to buyer, seller and the moderator chat identity; the moderator may read once a dispute opens, enforced by rules and the activity log (spec 6.6).
- **Task 20 must store each envelope's sender role** (`sender_role 'buyer'|'seller'|'mod'|'system'`, taken from the session's role as `checkChatEnvelope(body, channel, sessionRole)` already checks it), and `purgeChats` must take its due-time from a function so Plan 7's self-delete (per-side hide and destroy times) can plug in without a schema change. Add a test that the stored role equals the session role, never a body field.
- **Task 19 push stays as built.** Plan 7 Task 5 wraps `sendPush` in a `notify()` fan-out for the new Nostr and email channels; the push payloads do not change.
- **Comparison gaps the owner has not decided** ("Full block" extending Task 26's `blocks`, "Pause all my offers" on Task 4's per-offer pause) are listed with costs in Plan 7's "Owner questions". Nothing is built for them until the owner says yes.


## Revision 2026-10-29 (owner)

Authority: spec (Revision 2026-10-29) > `rulings-and-lessons.md` > earlier revisions > this note. Source: the owner's answers of 2026-10-29 (`~/x2f-comms/owner-answers-2026-10-28.md`), recorded in the spec's "Revision 2026-10-29 (owner)" and `HANDOFF.md` "Decided 2026-10-29 (owner)".

- **Task 4 (offers).**
  - **Caps.** The owner set **2 offers per side (buy or sell) per currency, and 20 in total**, as part of flexible offers (one offer can carry several methods and price tiers). The built cap of 3 per (side, method, currency) and 20 in total stays until new Task 34 lands; Task 34 changes the count to (side, currency) and the default `offers_max_per_market` to 2. Plan 4's Settings screen shows both numbers.
  - **The cap refusal** (409 `too-many-offers`) is a "can't do that" case: the web shows "Sorry, you're limited to 2 offers per side ..." `// COPY-UNSIGNED` with the feedback link (Plan 5 new Task 21).
  - **Pause and resume all offers** is new Task 36, built on the existing per-offer `PATCH status`.
- **Task 6 (retention).**
  - **An undisputed trade self-destructs 30 days after it ends** (`closed_at`). This is the advertised self-destruct. There are no user-chosen delete times and no early or manual delete.
  - **A disputed trade is kept 90 days from the moment the dispute button was pressed** (`disputes.opened_at`), then deleted (Plan 4 Task 23).
  - `purgeTradeAddresses` changes from 90 to 30 days after `closed_at` (constant `TRADE_KEEP_DAYS = 30`), still skipping a trade with a dispute. Task 20's `chatPurgeDue` takes the same 30 days.
  - **No per-trade stub.** Plan 7 Task 2 deletes the trade row itself, with its events, identities, attestations and chat, after first adding the trade to the account's running totals (completed trades and so on). So every table with a foreign key to `trades(code)` needs `on delete cascade`, or the purge deletes children first; the `trade_events` trigger already lets `x2f_purge` delete.
  - **Open (not decided here):** P3-M10 `disputeAfterRefundDays: 90` is longer than the 30-day delete. Either the window shrinks to 30 days or less, or a refunded trade is kept until its window closes. The lead or the owner decides; until then Plan 7 Task 2 skips a refunded trade still inside that window.
- **Tasks 25 and 27 (refund reasons).** Decision 7 (approved): Task 27 owns the buyer's `refunded` screen. It covers **every refund reason** and shows it:
  - payment time ran out and the seller cancelled (no-show auto-refund): "Payment time ran out, the seller cancelled; everything in escrow went back to the original owner." (owner wording; final copy `// COPY-UNSIGNED`);
  - the buyer cancelled; a mutual cancel; a ruling that refunded the seller; a setup or funding lapse.
  - Each refund path (Tasks 10, 23, 25 and the ruling path) records `refund_reason` on the trade when it starts the refund (`'no-show' | 'buyer-cancel' | 'mutual-cancel' | 'ruling' | 'lapse'`), and `toTradeView` returns it. Tests: each path stores its reason and the screen shows the matching line.
- **Task 27 (dispute counting).**
  - **A settled dispute counts toward completed trades, whoever won** (owner: money likely changed hands, and disputes are common). There is **no automatic stage drop**. This supersedes "Completed means completed with no lost dispute; each lost dispute drops one stage" in Revision 2026-10-24 and Task 4's `tradeCap`. Lost disputes are still counted (a running total, for Plan 5's Clean record badge and for staff).
  - A moderator can recommend account limits to a senior moderator instead (Plan 4 new Task 26).
  - **Appeals:** `appeal_until` holds Plan 4's `appealEndsAt` = the ruling's publish time + **48 hours** (setting `appeal_window_h`, default 48; owner, 2026-10-29c, replacing 72). The dispute outcome notice, the File appeal button and the reviewer rule are Plan 4 new Task 24.
  - **Disputes are settled within 48 hours, goal 24 hours** (Plan 4 A2). The DisputeRoom deadline line uses the 48-hour deadline.
- **Lead decisions approved by the owner (recorded, no change needed):** decision 1, a trade waits until both addresses are in and they are locked after (Revision 2026-10-24, Task 8); decision 2, Task 8 uses migration 111; decision 3, `trade-closed` returns the escrow runtime to `idle`; decision 4, Task 23's `paidRecorded` field; decision 5, the 44px `.x2f-method-name` goes to Claude Design with the canvas copy fixes; decision 6, `PHONE_VIEWPORTS` is the single phone-size standard; decision 7, Task 27 owns the buyer's `refunded` screen.
- **Revision 2026-10-28 corrections.** Plan 7's `notify()` fan-out now adds only OMEMO Jabber (no Nostr, no email). "Full block" and "Pause all my offers" are now decided: new Tasks 37 and 36.
- **Shared "can't do that" popup.** Every refusal shown to a trader as "you can't do this" (caps, starter limit, trading hold, review pending, and so on) uses Plan 5 new Task 21's `CantDoThat` popup, which carries the feedback link. Tasks already built adopt it when Task 21 lands.

### Task 34: Flexible offers — tiers, several methods and the new cap (`@x2f/trade`, `apps/api`) — NEW 2026-10-29

**Scope:** the owner's flexible offers, API and rules. Built right after Tasks 4 and 5 are merged.

**Files:**
- Create: `packages/trade/src/flexOffer.ts`, `apps/api/migrations/1xx_flex_offers.sql` (next free 1xx number)
- Modify: `apps/api/src/offers/routes.ts`, `apps/api/src/trades/take.ts`, the Task 8 signed terms (`terms.deal` gains `methodId`)
- Test: `packages/trade/test/flexOffer.test.ts`, `apps/api/test/flexOffers.test.ts`

**Interfaces:**
- Produces:
  - `type Tier = { minFiatCents: string; maxFiatCents: string; marginBps: number; minTrades: 0|5|10|50 }` (*lead default (2026-10-29), owner may change:* the owner said "buyer must have X completed trades"; the four values match the existing offer rule); `type OfferMethod = { methodId: string; instructions: string; adjustBps: number }`.
  - `tiersValid(tiers)`: ranges never overlap; gaps are allowed; at least one tier. `tierFor(tiers, fiatCents)` → the tier or `null` (a gap).
  - `finalRate(offer, fiatCents, methodId, marketRate)` = market + the tier's margin + the method's adjustment (fixed-price offers: the fixed price + the method's adjustment).
  - Tables `offer_tiers(offer_id, min_fiat_cents, max_fiat_cents, margin_bps, min_trades)` and `offer_methods(offer_id, method_id, instructions, adjust_bps)`; the old single `method_id`, margin and range become the first rows (migration copies them).
  - `POST /v1/offers` accepts `tiers` and `methods`; `GET /v1/offers?amount&method` returns each card's final rate for that amount and method (`null` when the amount falls in a gap).
  - `POST /v1/offers/:id/take` requires `methodId` (one of the offer's methods); the chosen method, its instructions and the final rate are **locked into the signed trade terms**.
  - **Cap:** 2 per (side, currency) and 20 in total (`offers_max_per_market` default 2, counted per side and currency). Refusal 409 `too-many-offers`.
- [ ] **Step 1: Write the failing tests:** overlapping tiers → 400; a gap amount gets no rate and a take in a gap → 409 `out-of-range`; a tier rule (`minTrades`) refuses a taker below it; the take locks the chosen method and the attested terms carry it; a method not on the offer → 400; the third offer on one side and currency → `too-many-offers`; the 21st offer → `too-many-offers`; an old single-method offer still lists and takes after the migration.
- [ ] **Step 2:** Run `flock ~/x2f-comms/check.lock npm test -- --project @x2f/trade` and `--project @x2f/api`; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat: flexible offers with tiers and several methods`.

### Task 35: Flexible offers — PostOffer tiers and methods, final prices and the method dropdown (`apps/web`) — NEW 2026-10-29

**Scope:** the screens for Task 34. **Controller step (design):** the PostOffer board gains the "+" tier rows and the method list; the quote gains the method dropdown; owner signs off the copy.

**Files:**
- Modify: `apps/web/src/screens/PostOffer.tsx`, the browse lists (Tasks 16–17), the quotes (Task 18)
- Test: `apps/web/e2e/flexOffer.spec.ts`

**Interfaces:**
- Produces: PostOffer "+" adds a tier (amount range, margin, optional "buyer must have X completed trades"), with overlap shown inline; "Add payment method" adds a method with its own instructions and optional price adjustment. *2026-10-29b (design reports the owner's answer):* the adjustment is a percent only; on the quote, a method outside the buyer's amount is greyed out with the reason ("PayPal: up to $500"), never hidden. The offer lists show each offer's final price for the buyer's amount and method. The quote has a method dropdown when the offer has more than one method. Hitting the cap shows the `CantDoThat` popup: "Sorry, you're limited to 2 offers per side ..." `// COPY-UNSIGNED` with the feedback link (Plan 5 Task 21).
- [ ] **Step 1: Write the failing tests:** parity at 390×844; an overlapping tier is refused inline; the list price changes with the amount and the method; the take sends the chosen method; the cap popup has the feedback link.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(web): flexible offers on PostOffer and the quotes`.

### Task 36: My offers — on/off per offer and "Select all" (`apps/api`, `apps/web`) — NEW 2026-10-29

**Scope:** a list of all my offers, each with an on/off toggle, plus "Select all" to turn all on or all off.

**Files:**
- Create: `apps/web/src/screens/MyOffers.tsx`
- Modify: `apps/api/src/offers/routes.ts`
- Test: `apps/api/test/offersBulk.test.ts`, `apps/web/e2e/myOffers.spec.ts`

**Interfaces:**
- Produces: `GET /v1/account/offers` (`requireTrader`) → my live and paused offers; `POST /v1/account/offers/status { ids: string[] | 'all', status: 'live'|'paused' }` in one transaction (only my own offers; removed offers untouched). Turning an offer on still runs every posting guard (hold, paused site, wallet, caps); refused offers stay off and are named in the reply. The screen shows each offer with a toggle, a "Select all" checkbox and "Turn on" / "Turn off" for the selection. **Controller step (design):** a My offers board.
- [ ] **Step 1: Write the failing tests:** "all" pauses every own offer and none of another account's; turning all on while held → every offer stays off and the reply says why; the list and toggles round-trip; parity.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat: my offers with pause and resume for all`.

### Task 37: Trader-to-trader block (`apps/api`, `apps/web`) — NEW 2026-10-29

**Scope:** the owner's full block ("right to do business with who you choose, safe from bullying"). Extends Task 26's `blocks` table.

**Files:**
- Modify: `apps/api/src/nudge/routes.ts` (blocks), `apps/api/src/offers/routes.ts`, `apps/api/src/trades/take.ts`, the chat routes (Task 20), `apps/api/src/traders/summary.ts`, the profile and offer card (block / unblock)
- Create: `apps/web/src/screens/settings/Blocked.tsx`
- Test: `apps/api/test/blocks.test.ts`, `apps/web/e2e/block.spec.ts`

**Interfaces:**
- Produces: `POST /v1/account/blocks { displayName }`, `DELETE /v1/account/blocks/:displayName`, `GET /v1/account/blocks`. While A blocks B (either direction counts for B's actions toward A):
  - B's `GET /v1/offers` leaves out A's offers; *lead default (2026-10-29), owner may change:* `GET /v1/traders/:name` for A answers 404 to B;
  - B's take of A's offer → 404 `not-found` (as if it does not exist); *lead default (2026-10-29), owner may change:* A's take of B's offer is also refused;
  - B can't open a chat with A or send to an existing one; nudges stay silently dropped (P3-M5);
  - **B never sees A online:** `online` and `lastSeenAt` are left out for B.
  - Trades already open continue to the end (escrow must finish); blocking never touches coins.
  - Nothing tells B they are blocked. Blocks are private. *Lead default (2026-10-29), owner may change:* staff see them only in a dispute between the two.
- [ ] **Step 1: Write the failing tests:** each bullet above as a route test; an open trade still completes after a block; unblock restores everything; parity for the Blocked screen.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat: trader-to-trader block`.

### Task 38: Warning popups before "I've paid" and before release (`apps/web`) — NEW 2026-10-29

**Scope:** the owner's two warnings before the big actions. A new task so Tasks 23 and 24 (in review) are not reopened.

**Files:**
- Create: `apps/web/src/screens/trade/{PayWarning,ReleaseWarning}.tsx`
- Modify: `BuyerPay` (Task 23), `SellerConfirm` (Task 24), the proof upload entry (Plan 5 Task 15 when built)
- Test: `apps/web/e2e/warnings.spec.ts`

**Interfaces:**
- Produces:
  - **Buyer, before "I've paid" or a proof upload:** "We strongly recommend that you do not send payment until all confirmations are complete and you've received confirmation that the XMR is fully in escrow. The way our system is designed, we can help you get back the XMR you were trading for if anyone tries to scam you, but recovering a payment you've sent is much harder and sometimes impossible." (owner wording). It reads the escrow state from `TradeView` (the app already blocks paying until funded and confirmed); it shows once per trade, before the payment details.
  - **Seller, before the release hold:** don't release until the money is really in your account; check your own bank or app, not a screenshot; once released, the XMR can't be taken back. `// COPY-UNSIGNED` (owner gave the meaning, not the words).
  - **Controller step (design):** both popups on the canvas; owner signs off the seller wording.
- [ ] **Step 1: Write the failing tests:** the buyer sees the warning before the payment details and I've paid; the seller sees the release warning before the hold works; each shows once per trade (survives reload; *lead default (2026-10-29), owner may change:* the owner said "before major actions" and gave no frequency); parity.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(web): warnings before paying and releasing`.

## Revision 2026-10-29b (owner + design)

Authority: spec (Revision 2026-10-29b) > `rulings-and-lessons.md` > earlier revisions > this note. Sources: the owner's words of 2026-10-29 07:55–08:03 (`~/x2f-comms/owner-answers-2026-10-28.md`), the lead's calls of 2026-10-29 (`~/x2f-comms/owner-answers-2026-10-29-lead-calls.md`) and Claude Design's update (`origin/wip/design-brief`: `docs/design-update-2026-10-29-for-lead.md`, `docs/design-brief-2026-10-29-response.md`). The owner's words win over the design's summary. Built and in-review tasks are not reopened; the changes are new Tasks 39–41 and the notes below.

- **Cancelling (Tasks 2, 7, 10, 12, 22, 23, 27, 31).** Decided: before funding either side can walk away; **the seller can never cancel after tapping "Fund escrow"**; **no cancel of any kind after "I've paid"**. ~~**OPEN (owner choosing; lead recommends B):**~~ the buyer's cancel after funding and before "I've paid": *decided 2026-10-29c (owner): option B, with the seller's "Confirm cancel"; see Revision 2026-10-29c. Option A below is history.*
  - **Option A (the design's):** the buyer's link becomes **"Ask to cancel"** and posts `propose-cancel`; the cancel happens only when the seller taps Cancel (`accept-cancel`, the existing mutual cancel, co-signed by both apps). Then drop the `buyer-cancel` event, `SettleKind 'buyer-cancel'`, `buyerCancelDecision` (Task 7), the moderation co-sign for it (Task 10, `apps/moderation/src/buyerCancel.ts`), `useEscrow().buyerCancel()` and its `cosignPolicy` branch (Task 12), and `refund_reason 'buyer-cancel'`; the moderator's automatic signature stays only for the no-show refund (spec 3.3).
  - **Option B (lead's recommendation):** keep the built `buyer-cancel` path (one tap, the buyer's app plus the moderation service's automatic signature, only to the seller-signed refund address; the seller need not tap or be online), but refuse it in `paid`, in the API **and** in the moderation service: Task 10's buyer-cancel co-sign refuses once the mod holds a valid `trade.paid` from the buyer (as the auto-refund already does). "Cancelled" shows only once the returned XMR has all confirmations (10) (owner's description of B). *Lead default:* the link stays "Cancel trade".
  - Under option A, "Cancelled" only once the returned XMR has all confirmations is a *lead default* (the owner described it for B), and the "Ask to cancel" name is the design's.
  - ~~Until the owner picks, nothing option-specific is built; new Task 39 builds only the decided parts, and its option step waits.~~ *2026-10-29c: Task 39 Step 0 builds B.*
- **Two-step "I've paid" (Task 23's `PaidConfirmSheet`, built).** The owner wants two steps to avoid accidental taps; Task 23 already has a confirm sheet with a tick. New Task 39 changes it to the owner's and the design's sheet: the owner's question "Are you sure you want to tell the seller you've sent their payment in the requested format?" (final words by Claude Design), the title "Mark this trade as paid?", the **required** tick "I sent exactly $412.50 by Zelle with the memo K7M2-…", "After this you can't cancel the trade. If something goes wrong, open a dispute.", **Yes, mark as paid** (disabled until ticked) and **Not yet**. Task 23's post-paid `CancelSheet` warning goes (there is no cancel after "I've paid").
- **Task 2 (state machine), as decided:** `buyer-cancel`, `propose-cancel` and `accept-cancel` in `paid` → `wrong-state`; a cancel proposal still open when the buyer marks paid is withdrawn in the same transition. New seller event `walk-away` (seller only) in `setup`, or in `funding` with nothing received and before the seller tapped "Fund escrow" → `cancelled`. *Lead default (2026-10-29b):* "tapped Fund escrow" is recorded by a new client event `fund-started` (seller, `funding`, once), posted when TradeFund's press-and-hold completes; after it, `walk-away` → `wrong-state`. The buyer's walk-away before funding is the existing `buyer-cancel` in `setup` or `funding` with nothing received.
- ~~**Task 27 (refunded screen, built):** for `refund_reason` `buyer-cancel` or `mutual-cancel`, the screen adds "Did you pay before you cancelled? Open a dispute." (inside the dispute-after-refund window). Built in new Task 39.~~ *Dropped 2026-10-29c (owner): a cancel can't be disputed.*
- **Task 38 (warnings):** the buyer's "don't pay until escrow is complete" warning (the design's title "Wait until the XMR is fully in escrow", with the confirmations bar) also shows **when the pay screen opens while the escrow is still confirming** (`securing`, or `secured` before every coin is unlocked), not only before "I've paid" or a proof.
- **Task 36 (My offers):** tick offers one by one, or tap **Select all**, which **only selects**; a bar with **Turn on** and **Turn off** applies to the ticked offers. An offer turned off stays off until its owner turns it on (nothing turns it back on by itself). *Lead:* turning off works with stale Terms (`allowStaleTerms`); turning on needs the current Terms (`terms-required`). Board: MyOffers (the design has not checked it in a real browser yet).
- **Task 37 (block):** blocking is **silent** (owner): no alert, push or chat card ever tells the blocked person, and open trades finish normally (already the task's rule; now the owner's). *Lead call 2026-10-29:* Task 5 already refuses a blocked user's take of the blocker's offers (404 `not-found`), so Task 37 reuses that check instead of adding its own.
- **Task 5 (lead calls 2026-10-29; Task 5 in review on `wip/lead-p3-task5`):**
  - **The take locks the server's live price,** never the quoted one. The quoted `centsPerXmr` only detects a move: more than 0.5% for a market offer, any change for a fixed one → 409 `price-changed`. A taker can no longer lock a price up to 0.5% better for themselves. This supersedes "locks exactly the quoted `centsPerXmr` and `fiatCents`" in Task 5's Revision 2026-10-27; the app takes the locked price from the attested terms (`deal-mismatch` handling in Tasks 12 and 18 follows that).
  - **The Starter cap counts the larger of** the trade's cash value (USD at the locked rate) and its XMR amount at the market price, so a below-market fixed-price offer can't move extra XMR.
- **Completed trades (R38, lead call):** released trades plus refunded trades that had a dispute; a settled dispute counts whoever won.
- **News (Plan 4 Task 28):** the menu-link question is settled by the design's **Site news** bell beside the logo on Main and BuyMain (Plan 4 Revision 2026-10-29b). The browse screens (Tasks 16–17) host the bell.
- **Foldable phones (owner):** new Task 40, on the Task 13 web shell.
- **New-device approval and the backup-login cooling-off (Plan 2 new Tasks 16–17):** their screens are new Task 41, on top of Task 30.
- ~~**Team members: OPEN** (owner has not confirmed; lawyer item 2). Nothing is planned.~~ *Decided 2026-10-29c (owner): yes, at launch if possible; Plan 2 new Task 18 and new Task 42.*
- **The design session reports that the owner answered these later on 2026-10-29** (`docs/design-brief-2026-10-29-response.md` @b0190d5, "Remaining open questions, answered"). They don't conflict with the owner's words to the lead, so they are recorded as decided:
  - **Tasks 34–35 (flexible offers):** a method's price adjustment is a **percent of the market rate only** (`adjustBps`), never a fixed amount. A method whose range doesn't cover the buyer's amount is **greyed out with the reason** (for example "PayPal: up to $500"), never hidden. The whole-offer fixed price is unchanged.
  - **Maintenance:** the emergency version pauses all trade timers (Task 2's `pause` already does).
- **OPEN conflict (Task 27, dispute after refund):** the design reports the owner said either side can open a dispute for **48 hours after a trade ends**. The lead's question A (the refund-dispute window, 90 days in Task 27, longer than the 30-day delete) recommends 30 days. Not picked here; `disputeAfterRefundDays` stays until the owner answers.
- ~~**OPEN conflict (appeal window):** owner to the lead 72 hours (Task 27's `appeal_until`, Plan 4 Task 24); the design reports 48 hours. Unchanged until settled.~~ *Settled 2026-10-29c (owner): 48 hours.*

### Task 39: Cancel rules of 2026-10-29b and the two-step "I've paid" (`@x2f/trade`, `apps/api`, `apps/web`) — NEW 2026-10-29b

**Scope:** Revision 2026-10-29b's cancelling rules, the owner's two-step "I've paid", and the buyer's cancel as decided 2026-10-29c (option B with the seller's "Confirm cancel"). ~~Step 0 waits for the owner's A/B choice; Steps 1–5 do not.~~ *2026-10-29c: Step 0 is decided (B) and is built with Steps 1–5.*

**Files:**
- Modify: `packages/trade/src/machine.ts` (Task 2), `apps/api/src/trades/events.ts` (Task 6), `apps/moderation/src/buyerCancel.ts` (Task 10), `apps/web/src/screens/trade/{PaidConfirmSheet,CancelSheet,BuyerPay,TradeFund}.tsx` (Tasks 22–23), the seller's room and the Active trades list, the room's settling view
- Test: `packages/trade/test/machine.test.ts`, `apps/api/test/tradeEvents.test.ts`, `apps/web/e2e/{pay,fund,cancel}.spec.ts`

**Interfaces:**
- Produces:
  - Task 2 rules as in Revision 2026-10-29b: no cancel events in `paid`; `walk-away` and `fund-started` for the seller.
  - `PaidConfirmSheet`: the sheet of Revision 2026-10-29b (owner's question, required tick, the can't-cancel line, **Yes, mark as paid** disabled until ticked, **Not yet**). `// COPY-UNSIGNED` until Claude Design gives the final words.
  - ~~The refunded screen: "Did you pay before you cancelled? Open a dispute." for `refund_reason` `buyer-cancel` or `mutual-cancel`, linking to DisputeOpen.~~ *Dropped 2026-10-29c (owner): a cancel can't be disputed.*
  - **Step 0, decided 2026-10-29c (owner): option B with the seller's confirm.** Keep the built `buyer-cancel` path; the link stays **Cancel trade**. Task 10's moderation guard refuses a buyer `trade.cancel` once it holds a valid `trade.paid` (test: mod opened `trade.paid`, then `trade.cancel` → nothing signed). After the buyer's cancel the refund is signed and sent at once (`settling`/`buyer-cancel`), and its `settled` moves the trade to `cancelling` (Task 2 transitions in Revision 2026-10-29c). `TradeView.returnConfirmations: number | null` (from the Task 9 chain watcher) drives "Sending the XMR back to <seller> · 3 of 10" `// COPY-UNSIGNED`. At 10 confirmations the system event `return-confirmed` sets `confirmCancelAvailableAt` (`returnConfirmedAt`); the seller's **Confirm cancel** button is shown greyed out until then and enabled after. New seller event `confirm-cancel` (seller only, only when `confirmCancelAvailableAt` is set) → `cancelled`. While it waits, the trade stays in the seller's **Active trades** with "Your input is needed to cancel this trade." `// COPY-UNSIGNED` (an alert and a push when the button becomes available). A system event `cancel-timeout` at `confirmCancelAvailableAt + SELLER_CONFIRM_CANCEL_TIMEOUT_H` (48 h; maintenance pauses it like every timer) → `cancelled`. *The anchor (48 h from when the button became available) is a lead reading; the owner said it "drops off within 48 hours"; the other possible anchor is the buyer's cancel tap.* A buyer's cancel pays no fee (unchanged: one payout of the whole balance to the seller's refund address). Remove the 29b "Option A" items from this task. *Was:* ~~Step 0 (waits for the owner): option A or B, as listed in Revision 2026-10-29b. ~~A: rename the link "Ask to cancel", route it to `propose-cancel`, drop the buyer-cancel path and its moderator co-sign (Tasks 7, 10, 12), and remove the buyer-cancel row from Task 31's e2e list.~~ B: as above. *Proposed by the docs pass, lead to confirm:* a `mutual-cancel` also shows `returnConfirmations` ("Sending the XMR back … 3 of 10") and needs no seller confirm, since the seller already agreed.
- [ ] **Step 1: Write the failing tests:** (Step 0) after `buyer-cancel`, `confirm-cancel` before 10 confirmations → `wrong-state` and the button is disabled; at 10 it is enabled and the seller's tap → `cancelled`; with no tap, at `confirmCancelAvailableAt + 48 h − 1 ms` still `cancelling` and in the seller's Active trades with the notice, at `+ 48 h` → `cancelled`; the buyer's `confirm-cancel` → `forbidden`; `settled`/`buyer-cancel` → `cancelling`, not `refunded`; `open-dispute` in `cancelling` → `wrong-state`; the mod guard refuses a cancel after `trade.paid`; the buyer's link reads "Cancel trade"; `buyer-cancel`, `propose-cancel` and `accept-cancel` in `paid` → `wrong-state`; an open proposal is withdrawn by `mark-paid`; the seller's `walk-away` in `setup` → `cancelled`, after `fund-started` → `wrong-state`, after any coins are seen → `wrong-state`; `fund-started` twice → `wrong-state`; the buyer's room after "I've paid" has no cancel control; "Yes, mark as paid" is disabled until the tick; the refunded screen shows no dispute line for a cancel ~~shows the dispute line for a cancel and not for a no-show refund~~; parity for BuyerPay.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat: buyer cancel with the seller's confirm, no cancel after I've paid, seller walk-away, two-step I've paid`.

### Task 40: Foldable phones — panes at the hinge, tabletop and the cover screen (`apps/web`) — NEW 2026-10-29b

**Scope:** the owner's foldables requirement (spec 1 and Revision 2026-10-29b) in the web app shell (Task 13), so the installable web app and the native wrappers (Plan 6 Task 20) both get it.

**Boards:** Fold-Notes, Fold-Offers, Fold-Trade, Fold-Tabletop, Fold-Cover, Fold-TriFold ("Foldables" row; **controller step (design):** the design checks them in a real browser and adds the fold rules to the existing boards first).

**Files:**
- Create: `apps/web/src/ui/fold.ts` (posture and segment reader), `apps/web/src/ui/Panes.tsx`, `apps/web/src/styles/fold.css`
- Modify: the shell layout (Task 13), the browse lists (Tasks 16–17), the trade room (Task 22), sheets and dialogs (Task 14's UI kit), `apps/web/e2e/viewports.ts` (`PHONE_VIEWPORTS` stays the phone standard; add `FOLD_VIEWPORTS`)
- Test: `apps/web/test/fold.test.ts`, `apps/web/e2e/fold.spec.ts`

**Interfaces:**
- Produces:
  - Layout by width: under 600 px (and the cover screen) the phone layout; 600–999 px two panes split at the hinge; 1000 px and over the wide layout, or three panes on a tri-fold.
  - Where supported (Chrome on Android): `@media (horizontal-viewport-segments: 2)` / `(vertical-viewport-segments: 2)` and `env(viewport-segment-left 0 0)` … `env(viewport-segment-right 1 0)` place the panes on either side of the hinge. Elsewhere (Safari on the iPhone Fold): width-only breakpoints.
  - **Tabletop** (`vertical-viewport-segments: 2`): turns on by itself when half-folded and off when flat, with no setting; the top half shows information only, the bottom half every control and the chat.
  - **Flip cover screen:** the most urgent trade as a small card, plus "+2 more trades" when there are others.
  - **Rules:** nothing is drawn across the hinge (no text, control or dialog crosses the segment gap); dialogs and sheets open inside one pane; folding or unfolding keeps the route, the scroll position and any typed text (form state lives above the layout switch, not in the pane); folded mid-trade, the chat moves behind the header's Chat link with its draft kept; the unfolded quote button says "Trade".
- [ ] **Step 1: Write the failing tests:** at 390, 700 and 1100 px wide the layout is phone, two panes and wide; with emulated two segments no element's box crosses the hinge gap and a sheet stays in one pane; a resize from 840 to 390 px mid-trade keeps the route, the scroll position, the chat draft and a half-typed amount; the tabletop layout puts every control in the bottom segment; parity for the six Fold boards. (Playwright emulates segments through the CDP `Emulation.setDisplayFeaturesOverride`; *lead default:* if the pinned Chromium lacks it, the segment tests skip with a reason and the width tests still run.)
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(web): foldable layouts with panes at the hinge`.

**Built 2026-10-29 (`wip/lead-p3-task40`), the shell and the trade room first.** Notes from the build and its review (`~/x2f-comms/review-task40-2026-10-29.md`):
- Hinge emulation: the pinned Chromium reports segments only under CDP `Emulation.setDeviceMetricsOverride` with `displayFeature` (`setDisplayFeaturesOverride` alone reports none), and a folded posture with `devicePosture`; `e2e/fold.spec.ts` uses those, and its skip-with-a-reason path never fires there.
- *Lead default (review I2):* the flip cover layout turns on only when the browser reports a folded posture (`(device-posture: folded)`) on a screen under 600x480 with no segments, never from size alone (split screen, a small window and an open keyboard are the same size), and even then the room stays under the glance card, so a wrong guess costs nothing and the screen's own alerts always show.
- *Lead default (review I3):* sheets keep to one pane only where a hinge is reported; with the width rules alone (iPad, a narrow window, the iPhone Fold) a sheet and its backdrop cover the whole screen. The backdrop always covers the whole screen.
- The unfolded quote button already says "Trade".
- **Follow-ups (not built):**
  - Browse lists (Tasks 16–17) as list + detail panes (Fold-Offers board); until then a screen without panes keeps to the first pane only when a hinge is reported, and spans the width with the width rules alone.
  - The tri-fold's third pane (list, detail, chat; Fold-TriFold): `three` puts the room in segment 1 and the chat in segment 2 and leaves segment 3 empty, for the My trades list (not built).
  - The app-wide flip cover card for the most urgent trade, with "+N more trades" (Fold-Cover): needs an open-trades list API; today only the open trade room shows its own card.
  - Tabletop for the screens other than the trade room (content still crosses the horizontal hinge there), and the dispute room's panes (its own chat; `disputed` gets no chat pane).
  - Parity for the six Fold boards, after the design's controller step puts them in `design/x2f-app/` with references.
  - A 1000x800 sideways-scroll check over the other wide rooms (release, fund, refund, dispute) at 1000–1023 px, which the wide layout reaches since the breakpoint moved from 1024 to 1000.
  - Task 20's chat panel must keep its draft in `useKeptText("chat:" + code)` (src/ui/fold.ts), as the fixture chat does.
  - Claude Design (round-2 review m5; tripwire NEEDS_DESIGN_FOLD_GLANCE, `apps/web/test/fold.test.tsx`): the glance has no status pill (Fold-Tabletop.dc.html:25-27; the API escrow chip that filled it was review I1) and no "Open your phone to keep going." (Fold-Cover.dc.html:43; the room now stays under the card). Ask the design for a pill from `view.state` and the role, never the escrow chip, and for the cover card's wording with the room below it.
  - Flip-phone posture: `(device-posture: folded)` is defined for a partly folded device; a closed flip's outer screen very likely reports `continuous` in Chrome on Android, so `cover` may never turn on (it fails safe to `phone`). The app-wide flip cover card above starts from a real-device check.
  - An e2e at ≥ 1000 px with a hinge (1000x840, vertical hinge) asserting `[data-primary]` stays in the viewport (review M2's paned phone scroll, trade.css `data-fold='two'|'three'`): not pinned yet.

### Task 41: LoginApprove, Devices and Login-Backup screens (`apps/web`) — NEW 2026-10-29b

**Scope:** the screens for Plan 2 new Tasks 16 (new-device approval, 3 devices, "One device at a time") and 17 (backup-login cooling-off), on top of Task 30.

**Boards:** LoginApprove, Devices, Login-Backup (each with a -Wide version).

**Files:**
- Create: `apps/web/src/screens/auth/{ApproveWaiting,ApproveSheet}.tsx`
- Modify: `apps/web/src/screens/auth/{Login,BackupLogin}.tsx`, `apps/web/src/screens/settings/{Devices,Security}.tsx` (Task 30), the live-events listener (Task 19)
- Test: `apps/web/e2e/{loginApprove,devices,backupLogin}.spec.ts`

**Interfaces:**
- Produces:
  - **New device:** after `approve-on-device`, "Approve this login on your other device" with the 2-digit number large, polling Plan 2's `/v1/login/approval/:id/poll` until `ok`, `blocked` or `expired`.
  - **Logged-in device:** the `login-approval` event opens `ApproveSheet`: "Someone is logging in on <browser, OS>. Is this you?", the three numbers, **Yes, let them in** (taps the chosen number) and **No, block it**. After "No": the login is blocked and the sheet suggests changing the login method (link to Security).
  - **Devices:** the session list (Task 30) with "3 of 3 devices" when full, remote log-out, and the **One device at a time** toggle (confirm-it's-you).
  - **Login-Backup:** says before the user chooses which ways get in at once (two factors, a passkey or a security key) and which start the 24-hour hold (one weak way: a password, an authenticator code or a recovery code alone, when it changes the password or security, or on a new device with nothing logged in to approve it; Plan 2 Task 17 as decided 2026-10-29c); during the cooling-off a banner names the end time and what still works ("You can finish your open trades").
- [ ] **Step 1: Write the failing tests:** the number shown on the new device equals the one the approving device must tap; "No, block it" ends the new device's wait with the blocked message; the 4th device shows the "Log out a device first" popup with the feedback link; the cooling-off banner shows the exact end time and the open trade's Release still works; parity for the three boards at 390×844 and their -Wide versions.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat(web): new-device approval, devices and the backup-login wait`.

## Revision 2026-10-29c (owner)

Authority: spec (Revision 2026-10-29c) > `rulings-and-lessons.md` (R39–R41) > earlier revisions > this note. Source: the owner's words of 2026-10-29 12:30–13:34 (`~/x2f-comms/owner-answers-2026-10-28.md`, from "OWNER 12:30"). Built and in-review tasks are not reopened; the changes go into Task 39 (cancel), the notes below and Plan 4.

- **Buyer's cancel: option B with the seller's "Confirm cancel"** (Tasks 2, 10, 12, 22, 23, 31, 39). The buyer taps **Cancel trade** (name unchanged); the XMR goes back at once (the buyer's app plus the moderation service's automatic signature, only to the seller's locked refund address). The seller's **Confirm cancel** is greyed out until the return has all 10 confirmations; the seller's tap officially cancels. Ignored, the trade stays in the seller's Active trades with "Your input is needed to cancel this trade." and closes as cancelled 48 hours after the button became available (anchor: lead reading) (`SELLER_CONFIRM_CANCEL_TIMEOUT_H = 48`). Built in Task 39 Step 0 (now decided). The 29b Option A list (drop `buyer-cancel`, its co-sign and `refund_reason 'buyer-cancel'`) is void. Task 31's e2e buyer-cancel row adds the seller's confirm and the 48-hour auto-close.
- **A cancel can't be disputed** (owner; Task 27): a cancelled trade has no wrong-amount risk, since the escrow returns everything. Task 39's refunded-screen line "Did you pay before you cancelled? Open a dispute." is dropped, and `POST /v1/trades/:code/dispute` on a trade ended by a cancel (`buyer-cancel`, `mutual-cancel`, seller `walk-away`) → 409 `wrong-state`. There is **no `refund-amount` reason** (owner, later 2026-10-29: dropped).
- **Underpaid restitution is an appeal** (owner, later 2026-10-29): in a disputed trade a party may be ordered to pay back or complete the payment through the payment method; if they send too little or nothing, the person owed files an **appeal** within 48 hours from when the dispute is finalized (Plan 4 Tasks 24–25). The owner's earlier "a refund can be disputed if the amount was wrong" means this case.
- ~~**OPEN (lead asking the owner):** after a no-show refund (the buyer paid but never tapped "I've paid"), can the buyer open a dispute within 48 hours? *Lead recommends yes.* `disputeAfterRefundDays` stays until answered.~~ **Decided (owner, 2026-10-29c 14:05):** yes, the buyer can open a dispute within 48 hours of a no-show refund to prove they paid. Built on `wip/lead-p3-task38`: `TIMERS.disputeAfterRefundHours = 48` replaces `disputeAfterRefundDays: 90`.
- **Appeal window: 48 hours** (Task 27's `appeal_until` = Plan 4's `appealEndsAt` = publish time + 48 h; `appeal_window_h` default 48). The 72 hours of Revision 2026-10-29 and the 29b OPEN conflict are gone.
- **Fees** (Tasks 1, 7, 24, 31; spec 11.1). The poster pays the 1%, buy or sell side (unchanged; accepting a reply to your ad means accepting the 1% market fee). **Cancels pay nothing:** `buyer-cancel`, `walk-away`, `mutual-cancel`, `auto-refund` and `lapse-refund` have no fee output (as built). **Settled disputes pay the 1%:** Task 1's `payoutsFor` (as Plan 4 extends it) gives `dispute-buyer` the release outputs (fee output exact) and `dispute-seller` with poster seller `[seller: balance − fee, fee: fee]` (the fee the seller added at funding). `dispute-seller` with poster buyer has no fee in the escrow, so it stays `[seller: balance]`, and **the poster still owes the 1% of the trade total** (owner, later 2026-10-29; replaces the OPEN point): Plan 4 records it in `fees_owed` and the ruling screen says "This also means you still owe the 1% fee for this trade, equal to <amount>, which will be deducted automatically from your future trades." `// COPY-UNSIGNED`. *Lead default:* collected from the account's next settled trade(s) until paid. Task 5's take writes the account's owed amount into the signed terms (`terms.deal.feeOwedAtomic`); Task 1's `escrowPlan` and `payoutsFor` add it to the fee output (deducted from the account's payout when it receives, added to `sellerFundsAtomic` when it funds as seller); Tasks 12 and 18 show it to that account only ("Includes 0.0040 XMR owed from an earlier trade" `// COPY-UNSIGNED`); the trade's other party never sees it. Cancels and refunds pay no fee output and collect nothing; a cancelled trade leaves the debt in place. The released screen's poster fee row also shows on a settled dispute the poster won.
- **Task 2 types and transitions for the 2026-10-29b/c cancel rules** (machine and Task 6 store; built in Task 39):
  - `TradeState` gains `'cancelling'`. `Trade` gains `fundStartedAt: Date | null`, `returnConfirmedAt: Date | null` (= `confirmCancelAvailableAt`) and `cancelledBy: 'buyer-confirm' | 'seller-confirm' | 'timeout' | null`.
  - `CLIENT_EVENTS` gains `'fund-started'` (seller, `funding`, once), `'walk-away'` (seller, `setup` or `funding` with nothing received and no `fundStartedAt`) and `'confirm-cancel'` (seller only). `SYSTEM_EVENTS` gains `'return-confirmed'` (the Task 9 chain watcher, when the refund transaction reaches 10 confirmations) and `'cancel-timeout'` (the timer job). Each new system event from a client → `wrong-party`; each new client event from the system → `wrong-party`.
  - **Buyer cancel path:** `buyer-cancel` after funding → `settling`/`buyer-cancel` (as built). `settled` with kind `buyer-cancel` → **`cancelling`** (no longer `refunded`). `return-confirmed` in `cancelling` sets `returnConfirmedAt = now`; in any other state → `wrong-state`. `confirm-cancel` in `cancelling` with `returnConfirmedAt` set → `cancelled` (`closedAt = now`); before it → `too-early`. `cancel-timeout` in `cancelling` only when `now ≥ returnConfirmedAt + SELLER_CONFIRM_CANCEL_TIMEOUT_H` → `cancelled`; earlier → `too-early`. A pause shifts `returnConfirmedAt` like every deadline. `open-dispute` in `cancelling` or in a `cancelled` trade that was funded → `wrong-state` (a cancel can't be disputed).
  - `settled` keeps its other kinds: `release` → `released`; `mutual-cancel`, `auto-refund`, `lapse-refund` and the ruling kinds → `refunded` (unchanged).
  - `refund_reason 'buyer-cancel'` is still written when the refund starts (Task 23); the buyer's screen for that reason (Task 27) shows on a `cancelling` or `cancelled` trade instead of a `refunded` one, without the dropped dispute line. `addToTotals` (Plan 5 Task 20) counts it once, as a cancel, when it reaches `cancelled`.
- **Tasks 34–35 (flexible offers):** no change. The fee stays on the poster for every tier and method, and the final price shown to a taker never includes an X2F fee line.
- **Profiles show "Disputes: N won, M lost"** (Plan 5; *lead recommendation, owner leaning yes*); Task 27's footer "It appears on your profile as a lost dispute" stays (*lead recommendation, owner leaning yes*).
- **Liens** (Plan 4 Task 25, rewritten there): Task 4's offer routes and Task 5's take refuse an account with an active lien (409 `lien`, through `CantDoThat`), from the moment a dispute it lost that requires restitution is ruled, except while its appeal is pending.
- **The 24-hour hold** (Plan 2 Task 17, decided): Task 41's Login-Backup copy and cooling-off banner follow it; the banner also shows when the hold started from a weak change on another device.
- **Team members: YES, at launch if possible** (owner, later on 2026-10-29). Up to 3 members per account, roles Offers and Trades. Accounts, roles and the owner's audit log are Plan 2 new Task 18; the trade side is new Task 42. Chat messages from a member are labelled "Message from Team <account display name> member: <member name>" (replaces the design's "replied by a team member", never which member).

### Task 42: Team members in trades — member actions, chat labels and the escrow-key question (`apps/api`, `apps/web`) — NEW 2026-10-29c (launch scope)

**Scope:** the trade side of team members (spec 6.7; Plan 2 Task 18). A member with the **Trades** role works the account's trades (take or accept, chat, upload proof, mark money sent, complete); a member with **Offers** manages its offers (Tasks 4, 34–36). Every effectful action writes Plan 2's `team_audit`. **OPEN (design item), blocks release by members:** releasing (and any signing step) needs that trade's escrow party key on the member's device; today it lives only on the device that set up the trade, the account owner's. A per-member key scheme must be designed (and reviewed against spec 3.1: X2F holds at most one key, the moderator's) before a member can release. Until then a member's Release shows `CantDoThat` "Only <account owner> can release this trade for now." `// COPY-UNSIGNED` and the owner's device releases.

**Files:**
- Modify: `apps/api/src/trades/{take,events}.ts` (role guard, audit), `apps/api/src/offers/routes.ts` (Offers guard), the chat envelope sender metadata (Task 20), `apps/web/src/screens/trade/*` (label, member gating), the Active trades list
- Test: `apps/api/test/teamTrades.test.ts`, `apps/web/e2e/teamTrade.spec.ts`

**Interfaces:**
- Produces:
  - **Chat label:** every chat message records the sending `memberId` (or none for the account owner) in the server-side envelope metadata; the partner's app shows "Message from Team <account display name> member: <member name>" `// COPY-UNSIGNED` above it, for example "Team Calcium member: Aurora". The account owner's own messages show no label.
  - **Trades role:** `take`, `mark-paid`, proof upload, `open-dispute`, chat send, and the buyer's cancel before "I've paid" pass `requireMember('trades')`; Offers-only members get `forbidden`.
  - **Release and signing:** refused for members (`member-cannot-sign`) until the OPEN key scheme lands; *lead default:* funding as seller is refused the same way (it also needs the party key).
  - The account's Active trades list shows which member last acted on each trade (from `team_audit`), visible to the account owner only.
  - One reputation: reviews, stats and badges stay on the account; partners never see a member's own account (a member has none).
- [ ] **Step 1: Write the failing tests:** a Trades member's chat message reaches the partner with the exact label; the owner's message has none; a Trades member marks paid and uploads proof, each writing one audit row; an Offers-only member's `take` → `forbidden`; a member's release → `member-cannot-sign` with the popup; the owner's device can still release the same trade; parity of the labelled chat bubble at 390×844.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run check`; expect PASS.
- [ ] **Step 5:** Commit `feat: team members in trades, chat labels, owner-only signing until the key scheme`.
