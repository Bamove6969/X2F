# Security review: wip/lead-launch-rules (9 Nov 2026)

- Branch: `wip/lead-launch-rules`, worktree /home/user/X2F/.claude/worktrees/launch-rules
- Head: `da5e82fa` (fix(moderation): shadow uses the trade's own time to pay from the attested terms)
- Base: `wip/lead-trade-rules-p1` `1801ffb5` (confirmed an ancestor of the head). Scope: `git diff 1801ffb5...HEAD`, 64 files, +1262/-93
- Context: the trade-rules review the brief names (`review-trade-rules-p1-2026-11-08.md`) is **not in the comms worktree** (no file matching `*trade-rules*`). I reviewed without it.
- Threat model: compromised API, real money; reviewer is read-only on the code.
- Tests run (single files, serialised runner): all passed.
  - @x2f/trade: packages/trade/test/attestation.test.ts + machine.test.ts: 2 files, 183/183 passed
  - @x2f/moderation: apps/moderation/test/shadow.test.ts + autoRefund.test.ts: 2 files, 35/35 passed
  - @x2f/api (Docker Postgres): apps/api/test/take.test.ts + identity.test.ts + disputes.test.ts: 3 files, 89/89 passed
  - @x2f/web: apps/web/test/attestation-flow.test.ts + disputeSlot.test.tsx: 2 files, 116/116 passed
  - Not run: offers.test.ts, profiles.test.ts, methodTime.test.tsx, schema.test.ts, typecheck, whole projects (capacity rule)

## Verdict

**APPROVED WITH MINOR**, with one Important finding (F1, the launch cap can be bypassed by trade growth) that should be fixed before the cap is relied on in production. Everything else is Minor, a follow-up, or an owner question. The money gap da5e82fa set out to close (the moderation shadow assuming 90 minutes to pay) is closed correctly on the moderator side: the attested key set is exact, every producer and consumer agrees, old attestations fail closed, and the shadow can no longer co-sign a seller's refund before the trade's own `payBy`.

## What was checked and holds

- **Attested terms (packages/trade/src/attestation.ts:74-84).** Exact key set `deal, payWindowMin, buyerPayout, sellerRefund`; the deal's own key set unchanged; `payWindowMin` must be a safe integer 1..1440 (a number, never a string; canonical JSON keeps it a number, and the bigint-as-decimal-string rule for the deal's fields is untouched). Producers and consumers all agree: API work list `termsOf` and `sameTerms` (apps/api/src/internal/routes.ts:99-118, 575: 409 `terms-mismatch` on any difference, including `payWindowMin`), the API's stored-attestation check (`isAttestedTerms`, 400 `bad-attestation`, :550), moderation `signAttestation` (attest.ts:53 refuses bad terms, :73 copies the field), `newShadow` (shadow.ts:33 refuses terms without a valid window instead of letting `newTrade` default to 90), `modParty` (modParty.ts:49), payouts' `sweepMinimums` (type only), and the web runtime's `verifyAttestation`. An attestation from before the field is refused everywhere (deny, not default). Good.
- **Shadow (apps/moderation/src/shadow.ts:29-50).** `payWindowMin` comes only from the signed terms; `payBy` = shadow's own secured moment + that window (machine.ts:351); pauses only move it later (machine.ts:421-444, desk.ts:533-536); extensions only add 30 minutes after `payBy`. A lying API can delay a refund, not bring it forward. The autoRefund test proves a 24 h trade's cancel at 91 minutes is not co-signed and is signed only after 24 h.
- **Stored once at take.** `take.ts:296-310` takes the window from `profileOrFallback(method)` (Custom's 180 min for any method without a profile); `insertTrade` writes it; the update path in store.ts never lists `pay_window_min`; migration 124's trigger refuses any change (`23000`), proven by take.test. `newTrade` refuses 0, negatives, fractions, NaN and >1440.
- **Timers.** Every reader of the time to pay goes through `payBy`: `request-refund` (machine.ts:603), `extend` (:591), `nextDeadline` (:680), maintenance shift (:438). The dispute wait after "I've paid" is `confirmBy` from `confirmWindowMin` (unchanged; the shadow uses `MAX_CONFIRM_WINDOW_MIN`, the conservative choice). The 15-minute final alert stays removed. Consistent.
- **Launch cap on take (take.ts:286-292).** Applied to every stage, after the starter caps, on the same USD value: the larger of the fiat total and the XMR amount at the live market price, both through `usdCentsOf` (rounds up, so rounding never lets $5,000.01 through; exactly $5,000 passes, `>` not `>=`). The rate is the server's quote at the take moment, the same one the trade locks. No quote (feed down, or no FX rate for the currency) gives 409 `price-unavailable`: fails closed, for fixed-price offers too. Buy and sell sides are treated the same (side is not read).
- **Launch cap on post (offers/routes.ts:471).** The offer's maximum in USD at the server's price; non-USD without a quote fails closed; USD needs no price. A band that is under the cap at post but over it later (FX move) is still refused at take, so it cannot become takeable above the cap by a take (but see F1 for growth).
- **p11-16 server side.** Seller dispute in `securing`/`secured` opens at once (pre-existing on the base); after it `mark-paid`, `buyer-cancel`, cancel proposals and `request-refund` are all `wrong-state`. Proven in machine.test and disputes.test (API returns 409 `wrong-state`, row unchanged).
- **Migration 124 / schema lists.** Adds the column with a temporary default of 90 for existing rows, then drops the default (every insert must name it), `check (1..1440)` matching `MAX_PAY_WINDOW_MIN`, set-once trigger with `search_path = pg_catalog`. Renumbered from 123 so it no longer clashes with chat-shred-2's `123_chat_shred.sql`; schema.test lists updated in all three places.
- **Jabber.** `git diff 0908d926 967ac03c` is empty: the merge of wip/lead-jabber-notices and its WIP commit are fully reverted. No file under the branch mentions jabber, xmpp, `jabber_outbox`, `X2F_XMPP_*`/`X2F_JABBER_*`, and there is no migration 331. Nothing of Jabber remains.

## Findings

### F1 (Important): trade growth bypasses the launch cap
- Where: packages/trade/src/machine.ts:373-395 (`grow`, the ceiling at :382 is `fiatFor(candidate, lockedRate) <= t.maxFiatCents`); apps/api/src/trades/take.ts:309-310 (the trade's `maxFiatCents` is the offer's maximum); apps/api/src/offers/routes.ts:489-528 (relisting does not re-check the cap).
- Scenario: the cap is checked once, on the take amount. Before "I've paid", any extra XMR the seller sends grows the trade up to the offer's maximum in fiat at the locked rate, with no USD or market-value check. Three ways past $5,000:
  1. An offer from before the cap (take.test itself has one: "an offer from before the cap") with, say, a $20,000 maximum, or a paused one relisted (relist and bulk status run `assertMayPost` but not the cap): take $4,999, the seller over-funds, the trade grows to $20,000 and the buyer pays $20,000. The cap is gone for any cooperating pair.
  2. A non-USD offer posted at exactly the cap: after an FX move the grown fiat total (still within the offer's maximum) is worth more than $5,000.
  3. A fixed-price offer far below market: take counts the XMR at market value (the larger of the two), growth only checks the fiat total, so a grown trade can move XMR worth well over $5,000.
- Fix (engineering, enforces the ruling as written): fix a growth ceiling at take, `min(offer max, the largest fiat total whose USD value by take's own rule (fiat and XMR at market) is within the cap)`, and use it as the trade's `maxFiatCents` (or a new set-once column the machine reads). It is in the attested and device-confirmed deal, so the take screen and the server must use the same clamped value. Also re-check the cap on relist (PATCH live and `/v1/account/offers/status`). At landing, pause or clamp any live offer whose maximum is above $5,000 (a data step for the lead). Add a machine test (grow stops at the clamp) and an API test (an over-funded trade on an above-cap offer).

### F2 (Minor, follow-up): the device's time-to-pay check is fail-open and checks the wrong field
- Where: apps/web/src/escrow/runtime.ts:550-568; apps/web/src/escrow/adapters.ts:70 (an absent or bad `payWindowMin` in the view becomes `null`); packages/trade/src/attestation.ts:267 (checked only when given).
- Scenario: (a) a compromised API leaves `payWindowMin` out of the trade view (or sends 0): the device treats it as an older API and checks the attested value for shape only. Web and API ship together, so the "older API" path only helps an attacker. (b) Even when the check runs, it compares the attested window with the view's `payWindowMin`, while the buyer's countdown is the view's `payBy` (payModel.ts:55-58), which nothing binds to the attested window. A lying API can attest and show 90 minutes in `payWindowMin` but show `payBy` 3 hours out; the moderator co-signs the seller's cancel at 90 minutes while the buyer's screen still says 1.5 h left. (c) The value is read again from the API on every start instead of being pinned in the device record.
- Impact: needs a compromised API plus a seller who cancels at the short deadline. The buyer can still dispute at once (settling `auto-refund`), but the refund usually lands first, so it goes on as an after-refund dispute against the attacker. The window between the fake and real deadlines is the loss. This existed before the branch (the API alone always drove the buyer's countdown), and da5e82fa did not make it worse.
- Fix: (1) now, cheap: fail closed when the view has no valid `payWindowMin` (`deal-mismatch`); pin the first value in the escrow record and require later views to match. (2) Follow-up: have the buyer's countdown checked against the verified window (warn or stop when `payBy - securedAt` is shorter than the attested window plus 30 min per extension), and bind `payWindowMin` into the device-confirmed deal (see Owner question 1).

### F3 (Minor): no rate limit on disputes opened before "I've paid" (griefing)
- Where: packages/trade/src/machine.ts:449-454; apps/api/src/disputes/routes.ts (no per-account limit).
- Scenario: a seller (or a seller-side taker of buy ads) takes many trades, funds each and disputes at once. Each buyer's trade is frozen until a moderator rules: the buyer cannot mark paid, cancel or accept a cancel; the trade stays open (`closed_at` null), so it counts against a Starter buyer's open-trade limit (take.ts:189-191) and the buyer is effectively locked out of trading. The cost to the griefer is their own XMR locked in escrow, the moderators' time and the dispute record; nothing automatic (no trading hold, no count) stops repeats. The moderator desk is the shared resource that can be flooded.
- Fix: owner decision (Owner question 2). Engineering options: a per-account limit on open disputes opened before "I've paid", or having those disputes not count toward the other party's open-trade limit.

### F4 (Minor, copy and state): "Don't send any payment" has no path for a buyer who already paid, and shows in one wrong case
- Where: apps/web/src/screens/dispute/DoNotPay.tsx:16-18, 27-29.
- Scenario: (a) a buyer who sent money and had not yet tapped "I've paid" when the seller disputed cannot record the payment: the server refuses `mark-paid` (correct per p11-16), and the sheet only says not to pay. Nothing is lost in code (the moderator rules on the evidence), but the buyer is not told to post their proof in the dispute, and `paidAt` stays null for the ruling. (b) `mustNotPay` is also true for a buyer who paid late and disputed the seller's cancel (`settling` `auto-refund`, `paidAt` null): they read "You opened a dispute… Don't send money… I've paid is paused", which is wrong for someone who has already paid.
- Fix: design adds a line such as "Already sent it? Tell the moderator in the dispute and attach your proof" (COPY-UNSIGNED). For (b), leave out the dispute opened from the seller's cancel refund (the view's settling kind) or give it its own line. Both change what users see: owner/design.

### F5 (Nit): an old desk record's shadow has no time to pay
- Where: apps/moderation/src/desk.ts:191-207 (`reviveShadow` does not fill `payWindowMin`).
- Scenario: a `mod_trade_desk` row written before this change holds a shadow with no `payWindowMin`; at `secured`, `payBy` becomes an Invalid Date, `past()` is always false, so no refund is ever co-signed. This fails safe (refund held, never early) and pre-launch there are no such rows. docs/coordination.md already says to wipe dev `signed_terms` and `mod_trade_desk` rows. Fix: none needed beyond that wipe; optionally `reviveShadow` refuses a shadow without a valid window.

### F6 (Nit): stale comment
- apps/api/src/trades/store.ts:43 says "Migration 123"; the file is 124.

## Tests: what they prove and miss

- Prove: exact attested key set and value bounds (attestation.test); the device's `wrong-terms` when the shown window differs (attestation.test, attestation-flow.test); the shadow's `payBy` from the attested window, and refusal of terms without it (shadow.test); the end-to-end moderator not co-signing a lying API's cancel at 91 minutes on a 24 h trade (autoRefund.test); API work item carries the record's window and 409s a mismatched attestation (identity.test); window and confirm window fixed at take and the trigger (take.test); the cap at post and take, USD and EUR, fixed and market, fails closed with no price (take.test, offers tests); p11-16 server refusal and the screen (disputes.test, disputeSlot.test).
- Miss: growth past the cap (F1); relisting an above-cap offer; a view without `payWindowMin` (the fail-open path, F2) and a `payBy` that disagrees with the attested window; a maintenance pause on a long-window trade in the shadow (covered by the generic pause logic, not by a 24 h case); seller disputing in `securing` from the API (machine only); the buyer-disputes-seller-cancel case of `mustNotPay` (F4b).

## Owner questions

1. **Bind the time to pay into what the devices confirm, now or later?** Today the API's view is the only source the trader devices see. Recommendation: before public launch (not a blocker for landing on the main line, since it needs a compromised API plus a colluding seller, and the cap limits the loss), show the time to pay on the take screen, keep it in the device-confirmed deal, and have the devices refuse an attestation or a countdown that differs. Land the cheap part of F2 (fail closed, pin the value) with this branch.
2. **Disputes opened before "I've paid" (p11-16) can freeze buyers.** Should the number of such disputes per account be limited, and should a trade frozen this way count against the buyer's open-trade limit? Recommendation: limit to a small number of open pre-payment disputes per account, and do not count those trades against the other side's limit.
3. **The do-not-pay sheet for a buyer who has already sent money** (F4): add an "Already sent it? Tell the moderator and attach proof" line? Recommendation: yes, design words it.
4. **The time-to-pay values are builder defaults** (90 min apps/instant, 3 h bank and Custom/unprofiled methods, 24 h cash by mail; SWIFT 3 h to send though it takes days to arrive), still waiting on the owner (page 11).
5. **Fixed-price offers cannot be taken while the price feed is down** (the cap fails closed on the XMR's market value). The PC lead flagged this; confirm it is acceptable.

## Landing notes

- Land after `wip/lead-trade-rules-p1` (`1801ffb5` is an ancestor). Migration is now `124_pay_window.sql`, so it no longer clashes with chat-shred-2's `123_chat_shred.sql`; keep the schema.test lists in order when both land.
- **Jabber revert:** this branch merged then reverted wip/lead-jabber-notices (`b9c97ec1` merge, `a30a7188` WIP, reverted by `b28b6291` and `967ac03c`). The tree is clean of Jabber. When Jabber lands later, **revert `967ac03c` (and `b28b6291` for the WIP notice) first**, or git will treat its commits up to `96a1182d` as already merged and drop them.
- Deploy order and data: API before moderation (as Task 8). Attestations, `signed_terms` and `mod_trade_desk` rows from before this change are refused or hold refunds for good: wipe them in dev and staging. Pre-launch, nothing to migrate in production.
- Before relying on the cap: fix F1 and pause or clamp any live offer whose maximum is above $5,000.
- Copy: the launch-cap refusals, the "can take up to" line and the do-not-pay sheet are COPY-UNSIGNED (design ea2a9ca8 for the sheet).
