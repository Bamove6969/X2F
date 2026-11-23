# Security review: Plan 4 Task 22, the dispute system on origin/main d82d692c

Reviewer: independent security reviewer (cloud helper), 22-23 Nov 2026. Times in this file are UTC; for the owner, BC time is UTC-7.

- **Worktree:** `.claude/worktrees/rev-p4t22`, detached at origin/main d82d692c. Read-only; no code was changed.
- **Probes:** they live in the scratchpad (`p4t22/probes/`). Each was copied into the worktree only for its run, then deleted. None is committed.
- **Scope:** T22's list (`packages/staff`, `apps/api/src/{staff,disputes,log,site}`, `apps/moderation`, `apps/staff-web`, the dispute screens and escrow runtime in `apps/web`). I read it against the brief's areas.

## How this review relates to the earlier ones

I did not redo the earlier reviews:

- review-lead-fix-ruling-pay (with its re-review);
- review-lead-ruling-committed;
- review-lead-bans-2;
- review-lead-mod-purge (with its re-review);
- review-disputes-stack-2026-11-16;
- review-mod-gate, review-ruling-payout, review-liens and lien-recovery;
- review-appeals, review-freeze;
- the mod-chat and staff-activity-log rounds;
- review-lead-ruling-compliance and re-review-lead-tx-proof-watchdog.

I checked that their fixes are on main (next section), and spent the time on the joins between the parts.

**Everything below is new.** Neither main finding was in any earlier review: both sit across a boundary (API with gate, dispute machine with executor) that each earlier review saw only one side of.

## Verdict

**Overall: CHANGES NEEDED before launch, for one Major (M1).** It is a liveness bug that strands escrow coins on ordinary trades. It is not a theft. Everything else is Minor, an owner question or an accepted residual.

I found no path by which the API alone, a relay, a stolen staff session, or one or both traders gets the moderator key to co-sign, or gets a winner's device to co-sign, anything but the payout the gate computes from its own recorded terms for a ruling that staff keys tapped.

| Area | Verdict |
|---|---|
| Dispute opening and evidence | PASS |
| Moderator case handling, chat join, moderator badge | PASS (chat needs a certified staff device, so a stolen session cannot read or post) |
| Rulings: proposal, owner/senior approval above the limit | **FAIL: M1** (the API and the gate disagree on who needs a second person) |
| Signed ruling statement, winner co-sign (web runtime and policy, 22 Nov) | PASS (the ruling-pay M1/M2 and ruling-committed fixes hold) |
| 48 h appeal, overturns | PASS WITH MINORS (m1: an overturn before the payout ran; m3: the gate's round-2 checks have no caller) |
| Moderation executor | PASS WITH MINOR (part of M1: a refusal staff never see) |
| After-refund restitution and tx proof | PASS WITH MAJOR-UNDER-COMPROMISED-API (M2) |
| Liens | PASS WITH MINOR (m1) |
| Freezes | PASS |
| Bans on rulings | PASS (a ruling never carries a ban, `account-action-unavailable`; bans are their own tapped act) |
| Emergency stop | PASS (gate refuses `stopped`; API refuses ruling work while paused). Residual: the gate learns of the stop only through the API (R3) |
| Staff login hours | PASS |
| Staff key taps, moderation gate and registry | PASS |
| Moderation trade shred, as it touches disputes | PASS (mod-purge fixes hold; the sweep tombstone, migration 022, is on main) |

## Earlier fixes: do they hold on main?

| Earlier item | On d82d692c |
|---|---|
| ruling-pay M1 (loser rule needs a verified `rulingLost`) | Holds. The web suites pass: attestation-flow, policy, dispute, dispute-tripwires, disputeScreenProof, 300/300. |
| ruling-pay M2 (`committedElsewhere`, prior kept and restored) | Holds (same suites). |
| ruling-pay m6 and G20 pins | Present (92802042). |
| ruling-committed m1/m3 (copy) and m2 (report timeout) | Present (261b8572, `RULING_WAIT_REPORT_MS`). |
| mod-purge M2 (sweep tombstone) | Present: `apps/moderation/migrations/022_sweeps_spent.sql`, watcher.ts/main.ts. tradeShred.test passes. |
| disputes-stack: staff.css brace, X3-1 (a)/(b), D-2 (link lifetime bound), D-3 (reset closes the person's own invite) | All present: staff.css has 166 `{` and 166 `}`; ModCase.tsx:75, :154; registry.ts:150-153, :301-304. |
| bans-2 m1/m2 pins | Present (e75fc8e0). |

## Findings

### M1 (Major, liveness: escrow coins stranded on a normal trade). The API publishes on one person's tap where the ruling gate demands two, so the payout never runs

**Where:**

- API side:
  - `packages/staff/src/dispute.ts:212-213` (`needsSecond`: `d.usdCents >= d.limitUsdCents`);
  - `apps/api/src/disputes/store.ts:166-171` (`disputeUsdCents`) and `:186` (the limit snapshot at opening);
  - `apps/api/src/disputes/rulings.ts`, the propose route (`decided` → `publishDecided` on one tap).
- Gate side:
  - `apps/moderation/src/gate/verify.ts:177` (`recordedTerms`: `usdCents` is null for any non-USD deal; for USD it rounds up);
  - `:225-227` (`gateNeedsSecond`: null, or the gate's *current* limit);
  - `:308` (`needs-second`).
- Executor: `apps/moderation/src/execute.ts:201-205` (logs `ruling-refused-needs-second` locally and returns; nothing reaches the API or staff).

**What happens.** The API decides "one person is enough" from the dispute's own USD value and its limit snapshot. The gate decides from its own value and its current limit. Whenever the API says one and the gate says two:

1. the API publishes the mod's round-1 ruling;
2. the traders see it with the 48 h window;
3. the gate refuses every pass with `needs-second`, so no statement is ever signed and the winner's device has nothing to co-sign.

No second tap can be added afterwards: the API's approve route needs `awaiting-approval`, and the dispute is `published`. The coins stay in the escrow. The dispute stays `published`, then `final`, never `closed`. Staff see nothing: the payout-wait line reports only `winner-committed` and `winner-offline`.

**Three ways it happens.**

1. **Any non-USD trade under the limit** (EUR, GBP, CAD, ... are offered: `TOP_CURRENCIES`). The API values it at the market quote, below the limit. The gate has no USD value for it (`usdCents: null`), so it always needs two people. **This is the common case.**
2. **The owner lowers the large-trade limit while a dispute is open.** The API keeps the snapshot from opening (`disputes.limit_usd_cents`). The gate applies the new limit from its next sync. A $700 USD trade disputed under a $1,000 limit, with the limit then lowered to $500, is published on one tap and refused by the gate.
3. **A USD trade within one cent of the limit.** The API uses `fiatCents` (half-up, money.ts:58); the gate rounds up (verify.ts:177). At a true value of 99,999.3 cents, the API has 99,999 (one person) and the gate 100,000 (two).

**Proof.** Probe `p4t22/probes/probe-p4t22-eur.test.ts`, run in the api project: **passes**, which confirms the finding.

- A EUR 50 trade at a quote: `disputeUsdCents` < limit, and `needsSecond(...)` is false (the API publishes on one tap).
- The same trade's `recordedTerms` gives `gateNeedsSecond(...) === true`.
- `gate.test.ts:246` and `execute.test.ts:182` already pin that the gate refuses a one-tap ruling in that state. The staff regtest uses USD trades only, so it cannot see this.

**Fix (engineering, plus one owner question):**

- **(a) The API must never be laxer than the gate.** In `needsSecond`, or in `startDispute`'s value, a non-USD trade always needs a second person. That matches the gate today and is fail-closed.
  - **Owner question OQ1:** is "every non-USD dispute needs a senior or the owner" acceptable at launch? The alternative is to give the gate its own USD value for non-USD deals: attest a USD rate at escrow setup, `deal.usdCentsPerXmr`, signed in the terms. That is a protocol change.
  - **I recommend (a) now and the attested rate later.**
- **(b)** Judge the limit as `min(snapshot, current settings)` at propose time, or snapshot the limit at escrow setup on both sides. Better: let the gate's limit only ever be raised for open disputes.
- **(c)** Compute the USD trade's value the gate's way (`ceil(amountAtomic × centsPerXmr / 1e12)`), not from `fiatCents`.
- **(d)** Defence in depth: report a gate refusal to the API as `ruling-wait` already reports its reasons (a new `gate-refused` reason with the refusal code), and show it on the staff case view. Then a future mismatch is visible instead of silent.
- **(e)** A recovery path for disputes already stuck. Today there is none: a published round 1 cannot get a second tap. Either let an approver add an approval tap to a published round 1 that the gate refused, or let staff re-propose round 1. Either needs a lead decision.

**Tests to add:**

- API, `rulings.test`: a EUR dispute under the limit goes to `awaiting-approval`; a limit lowered after opening is applied; a USD trade at 99,999.3 cents needs two people.
- Cross-check, preferably a single test that runs both: for a table of trades, `needsSecond(API) || !gateNeedsSecond(gate)` always holds.

### M2 (Major under a compromised API; information otherwise). After-refund rulings, `seller-sends-xmr` above all, are bound to no moderator key, yet the seller's app tells the seller to send XMR

**Where:**

- `apps/moderation/src/execute.ts:197`: a non-escrow outcome returns `none` before `gateCheck`, so the gate never sees an after-refund ruling, or any round-2 ruling (m3).
- The seller's pay form is driven by the API's dispute view:
  - `apps/web/src/screens/dispute/DisputeRuling.tsx:261` (`r.outcome === 'seller-sends-xmr' && trade.role === 'seller'`);
  - `DisputeScreen.tsx:103`, `DisputeSlot.tsx:62`.
- `packages/trade/src/rulingStatement.ts:28, :69` only signs `release-to-buyer` and `refund-to-seller`.

**The attack.** A compromised API, with a colluding buyer, invents a `seller-sends-xmr` ruling on a trade the auto-refund already returned to the seller. Everything is under a real moderator's public name:

- the ruling card;
- a 24 h comply deadline (`COMPLY_H`);
- a restitution lien that bars the seller from trading (the API runs the lien guard);
- a "your appeal is waiting" state if the seller appeals.

The seller's app then shows "Send exactly <amount> XMR to the buyer's address".

**What protects the seller today, and what doesn't.**

- **What holds:** the address and amount come from the attested terms and this device's own accepted amount (runtime.ts:474-477). That is good: the coins can only go to the trade's real buyer.
- **What doesn't:** nothing proves a moderator ruled this. The escrow rulings got exactly that protection in Haveno finding 2, and this is the one staff decision that makes a trader move coins by hand.

**Fix (engineering):**

- Extend the ruling statement to after-refund outcomes:
  1. the gate authorises the after-refund ruling's taps (the same `authorizeRuling`, with `settle: null`);
  2. the moderation process signs a statement `{v, trade, round, rulingId, outcome: 'seller-sends-xmr', amountAtomic, buyerPayout}` under the same key and a new domain;
  3. the API serves it, and the seller's app shows the pay form only for a verified statement whose amount and address equal its own attested values.
- `seller-returns-fiat` and `no-action` move no coins on the device. They can show an "unverified" mark until signed.
- **Severity:** Major for launch under the brief's threat model. It is not exploitable without an API compromise.

### m1 (Minor, owner question OQ2). An appeal that overturns round 1 before round 1's payout ran: the lien goes on someone who has received nothing, and the executor still pays them

**Where:**

- `packages/staff/src/lien.ts:152-159`: an overturn of an escrow outcome always liens the round-1 winner, "the coins moved under round 1". `executedAt` is not checked.
- `packages/staff/src/dispute.ts:353`: not after-refund, so the dispute waits in `final`, not `closed`, until executed.
- `apps/moderation/src/execute.ts:196`: round 1 still pays after any appeal.

**Proof.** Probe `probe-p4t22-overturn.test.ts`, in packages/staff, **passes**:

1. publish `release-to-buyer`;
2. the seller appeals;
3. an uninvolved senior rules `refund-to-seller`;
4. the result is `executedAt === null`, `status: 'final'`, and a `place … debtor: 'buyer', cause: 'overturned'` step.

**What this means.** The trade stays `disputed`, so the buyer's device still co-signs round 1 and the coins go to the person the appeal just ruled against. That person is liened at once for coins they don't have yet.

- If the round-1 payout never runs (the winner stays offline, M1's refusal, the winner-committed case), the lien binds someone who never got the coins, and the person the appeal favoured gets nothing.
- This follows D-009 and A1-dropped as written ("coins move at the ruling, a won appeal never moves the coins"). But those rules assumed the coins had already moved.

**Owner question OQ2:** when round 2 overturns an escrow ruling whose payout has **not** run, should the executor pay round 2 instead, with no lien?

- If yes, the gate must then authorise round-2 escrow payouts, and its R37 checks become live code (see m3).
- If no, the lien should at least wait for `executedAt` (be placed by the `executed` event), and the staff view should say the payout is still pending.

**I recommend yes.** It is the outcome the appeal decided, and it removes a lien that rests on a fiction.

### m2 (Minor, observation; owner question OQ3). A stolen owner or senior session (no key) still has untapped levers that matter around disputes

- **Owner (`site.control`):**
  - `PUT /staff/v1/site/maintenance` (staff/site.ts) puts the whole trader API on 503 and pauses every trade and dispute timer, without a tap. The emergency stop, which is milder, needs one.
  - `POST /staff/v1/news` (staff/news.ts) and `PUT /staff/v1/site/banner` publish text to every user, without a tap. News may be the only channel to users, so a phishing post ("moderators will ask you to send…") carries X2F's authority.
  - Login-hours changes take no tap (already observed in review-p4-staff-core).
- **Senior (`accounts.freeze`):** `POST /staff/v1/accounts/:id/hold/end` (staff/holds.ts) ends a recovery-code hold without a tap. Outside disputes, but the same threat.
- **Fix:** bind maintenance-on, news and banner publish, and hold-end to a tap intent (`site-maintenance`, `news-publish`, `hold-end`). That's cheap: the tap machinery and the staff-site dialog exist. Owner decides which, since it adds a key tap to routine owner work.
- **I recommend** maintenance-on and news publish at least.

### m3 (Minor, docs and dead code). The gate's round-2 checks (R37 `involved`, `round1-unseen`, `stale-round` for round 2) have no production caller

- **Where:** `apps/moderation/src/gate/verify.ts:313-321`.
- **The only caller:** `gateCheck`, from the executor, which passes round 1 only (execute.ts:196-201).
- **What that means:** "The ruling gate refuses a round-2 ruling whose proposer or approver is involved, even if the API asked for it" (Plan 4 Task 24) protects nothing in production. A round-2 ruling moves no coins, and the records it changes (liens, record fixes, pay clawback) are the API's alone.
- **Is it safe?** Yes, because round 2 never moves coins. But the security docs and Task 24 overstate it.
- **Fix:** say so in `docs/security/plan-4-review.md` as an accepted residual: "R37 is enforced by the API; a compromised API can let an involved person decide an appeal; the gate's checks become live only if OQ2 makes round 2 pay." Keep the code, and keep its tests as the ready path for OQ2.

### m4 (Minor). A debtor's appeal suspends their restitution lien, and an appeal with no eligible reviewer waits for ever

- **Where:** `packages/staff/src/lien.ts:125-128`, and the "no eligible reviewer → the appeal waits" rule (Task 24).
- **The case:** small staff, for example the owner plus one senior who both took part in round 1. The appeal waits indefinitely and the debtor trades freely the whole time. The owner is alerted.
- **Owner question OQ4:** after a set time with no eligible reviewer, should the suspended lien bind again? For example after `APPEAL_GOAL_H`, 48 h.
- **I recommend yes:** fail toward the ruling in force.

### Info

- **i1. One moderator alone can move a below-limit escrow to an accomplice.**
  - A single non-senior moderator rules any dispute under the limit alone, and the coins move at once (A1 dropped).
  - Recovery is a lien on the receiving account, which may be a throwaway.
  - This is the design the owner chose. The limit is the control.
  - Suggestion for the owner: a lower limit, or two-person rulings for a new moderator's first N cases.
- **i2. The gate trusts the API's `involved` list only to add people (good).** But it never sees round-2 rulings at all (m3), so a compromised API decides R37.
- **i3. The emergency stop reaches the gate only through the API's tap feed.** A compromised API can withhold the stop tap, so the gate keeps authorising rulings. Rulings still need real staff taps, so this only removes a brake from an attacker who already holds staff keys.

## Threat model

What each actor can and cannot do to coins, rulings and records.

| Actor | Coins | Rulings | Records |
|---|---|---|---|
| **A trader** | **Cannot:** get any escrow payout but the ruling's or a normal release; forge a statement (pinned `VITE_MOD_SIGNING_PUBLIC`, domain-separated, bound to trade, escrow, round 1 and winner). **Can:** stall as the winner by staying offline (staff see `winner-offline`). | **Cannot** propose, approve or influence the gate. **Can:** open a dispute when the machine allows; appeal within 48 h (exactly one appeal stored, at `appealEndsAt` refused); suspend their own restitution lien by appealing (m4). | **Can:** fill the case with evidence and chat. **Cannot** read staff-only drafts, notes or reasons before publish. |
| **Both traders colluding** | **Can:** move the escrow 2-of-3 without the moderator (inherent); avoid the 1% by doing so. **Cannot** get a ruling payout plus a release (one spend). | **Can:** stage disputes to farm the moderators' per-dispute pay only with a colluding senior (Task 33 clawback on overturn). | **Can:** create fake completed-trade records with each other (reputation, outside this scope). |
| **A non-senior moderator** | **Can:** alone, rule any escrow dispute **below the limit** either way; coins move at once (i1). **Cannot:** go at or above the limit, or rule on a non-USD trade (today the gate refuses, and M1 strands it); sign anything but `payoutsFor` on the gate's recorded terms. | **Can:** propose; send messages; request the unblurred proof; freeze under `freezeAllowed`'s rules; lift freezes on their case; recommend limits. **Cannot:** approve; ban; decide an appeal on a case they touched (API R37). | Every action logged in the hash-chained log; chat reads and sends logged in the moderation process (`mod_chat_access`). |
| **A senior moderator alone** | Same as a moderator, plus approve another person's proposal. **Cannot:** approve their own (`same-person` in the API and the gate); move at or above the limit alone. | **Can:** ban (tapped), decide appeals they are not involved in, end recovery holds (untapped, m2). | Same logging. |
| **A compromised API server** (DB included) | **Cannot:** make the gate co-sign without valid staff taps for that exact ruling, trade, amount, reason and evidence; change the payout addresses or amounts the gate and the devices compute (own attested terms); replay a ruling onto another trade or round. **Can:** strand coins by refusing to serve; choose which of a trade's tapped rulings to present; withhold a stop tap (i3); fake a `seller-sends-xmr` ruling that makes the seller pay the real buyer (**M2**). At escrow setup it controls the addresses and the USD snapshot (accepted residual). | **Can:** decide R37 (m3), hide appeals and involvement from the gate, fake every after-refund and round-2 outcome (no coins move from them except via M2). | **Can:** rewrite anything in its own database. The log's checkpoints in the moderation process detect a rewrite of checkpointed history, not new false entries. |
| **A compromised relay** | **Cannot:** forge or alter escrow messages (signed, replay-guarded); the statement comes through the API, not the relay. **Can:** drop or delay, so the payout waits (shown as `winner-offline`). | None. | None (no records on the relay). |
| **A stolen staff session without the key** | **Cannot:** produce a tap, so no ruling, approval, ban, settings change, stop or resume, device certification, invite or reset; cannot read or send chat (needs a certified staff device: the countersign key and the box key, which a stolen session cookie does not carry; malware in the staff browser itself would). | **Can:** take or reassign cases (stall), freeze or lift under the rules, send back a proposal (senior), recommend limits. | **Can:** owner session posts news and the banner, turns maintenance on and off, changes login hours; senior session ends recovery holds, all untapped (**m2**). Each is logged. |

## What I did not cover

- **Full `npm run check`:** not run. The cloud runner owns it.
- **Not re-reviewed:** the anonymizer and training curation, the activity log's hash chain, and checkpoint verification (the staff-activity-log rounds); staff invites, resets and owner setup, beyond the D-2/D-3 check; staff pay and clawback (Task 33); limits (Task 26); performance metrics.
- **Not covered:** helper tickets (Tasks 30/31), news content handling, the revenue ledger.
- **Not reviewed:** the 1% `fees_owed` collection, which is not built (NEEDS_FEE_OWED_COLLECTION), and the repayment trade (NEEDS_REPAYMENT_TRADE).
- **Not covered:** the trader-side dispute screens' copy and design.
- **Not repeated:** guard-revert sweeps. The earlier reviews' tables cover the code I re-checked.
- **Not checked:** the `escalate` (system-opened) dispute path in depth.
- **Not run:** the moderation-regtest and escrow-regtest projects.

## Tests run

All targeted vitest ran with nice -n 10, outside the lock, at d82d692c.

- **packages/staff:** all 12 files, **356/356 passed**.
- **apps/moderation, 12 files, 250/250 passed:** gate, execute, tradeShred, internal, gateDevices, checkpoint, checkpointBypass, autoRefund, buyerCancel, gateDeps, gateLock, grant.
- **apps/web, 300/300 passed:** policy, attestation-flow, dispute-tripwires, dispute, disputeScreenProof.
- **apps/api, 20 files, 569/569 passed:** test/disputes/* (9 files); staff keyTap, login, matrix, bans, holds, settings, ownerLockout, limits, members, activityLog.
- **Probes** (scratch only, deleted after the run):
  - `probe-p4t22-eur.test.ts` (api project): passes, which confirms M1;
  - `probe-p4t22-overturn.test.ts` (packages/staff): passes, which confirms m1.
- **Staff dispute regtest** (`apps/staff-web/e2e/playwright.regtest.config.ts`, under ~/x2f-comms/check.lock): **13/13 passed** (31.4 min). It covers both sizes and these rows: below the limit, above the limit, appeal overturns, winner offline, dispute after refund, emergency stop, login hours. All rows are USD and the payout runs before any appeal is decided, so none of them reaches M1 or m1.

## Owner questions

- **OQ1 (M1):** every non-USD dispute needs a senior or the owner at launch, or give the gate an attested USD rate? I recommend two people now and the attested rate later.
- **OQ2 (m1):** an overturn before round 1 paid: pay round 2 instead of a lien? I recommend yes.
- **OQ3 (m2):** which untapped owner and senior actions should take a key tap? I recommend maintenance-on and news publish at least.
- **OQ4 (m4):** re-bind a suspended lien when no eligible appeal reviewer exists after 48 h? I recommend yes.
