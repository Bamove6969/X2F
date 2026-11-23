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

---

## Re-review: wip/lead-p4t22-fix at a03297ef (23 Nov 2026)

Scope: `git diff origin/main...a03297ef`, 18 commits on d82d692c, 71 files. Worktree `.claude/worktrees/rev-p4t22b`, detached; the branch was not changed.

### Verdict: APPROVE WITH MINORS

All five findings are fixed, with tests. The rescue cannot be used by the proposer and cannot widen what the moderator key signs. The round-2 payout path cannot pay twice. There is one new Minor (N1), found while answering the lead's residual (c): it is a narrow stuck-coins case and should be fixed before launch, but it does not block this branch, which makes it no worse. There is also one small leftover from m2 (N2).

The full `npm run check` belongs to the cloud runner, and approval holds only if it is green.

### The fixes

- **M1: fixed.**
  - **One rule on both sides.** `@x2f/staff` now has `gateUsdCents` (round up; null for non-USD), `limitUsdCentsOf` and `twoPersonRule`. The gate calls them (`recordedTerms`, `gateNeedsSecond`, the registry's settings). The API's `needsSecond` must now be given the gate's inputs (`GateValue`: the trade row's XMR, its locked rate and the limit in force now). It ORs them with the snapshot rule, so it is never laxer than either.
  - **Each disagreement case is closed.** `disputeUsdCents` for USD now uses the gate's formula, which closes the one-cent case. The limit in force covers the lowered-limit case. A non-USD trade is null, which means two people (OQ1 lead default).
  - **Refusals reach staff.** `twoPersonAgreement.test` pins the cross-check. Refusals are reported (`ruling-refused`, logged `ruling.gate-refused`, deduplicated under the trade lock, enum-checked) and shown on the case view.
  - **Remaining edge.** A limit lowered *after* a ruling was published, but before it paid, is still refused by the gate. That is exactly what the rescue is for, and the case view now says so.
- **The rescue (M1 e): cannot be used by the proposer, and does not widen signing.** `POST …/rulings/:id/second-approval`:
  - **Who may use it.** It needs `rulings.approve` and the gate's latest report for this very ruling to be `needs-second`. The machine refuses the proposer (`same-person`), refuses a dispute whose payout already ran, and refuses an already-approved ruling. In round 2 it refuses the appeal's proposer, approver and assignee, and the rescuer joins round 1's `involved` list (R37).
  - **What gets tapped.** The tap is consumed only after the machine accepts. It is exactly the `approve` intent for that ruling: the same id, round 1, outcome, amount, and the published reason and evidence. So the key signs nothing a normal approval would not.
  - **What the gate checks again.** The gate re-verifies the tap with the same `same-person` and `approver-role` checks. A compromised API that skips the route's checks still needs a real senior's or the owner's tap for that exact ruling, which is the same power it had before.
  - **Nothing else changes.** It cannot publish an unpublished ruling, change an outcome, or reach a round-2 ruling.
- **M2: fixed.**
  - **The statement.** `AfterRefundStatement` has its own domain (`x2f/ruling-statement-after-refund/v1\0`), exact keys, and is bound to trade, round, ruling, amount and buyer address. It is signed only after `gateCheck` authorises the ruling in force, using the same taps and R37 against round 1 as the gate authorised it. The amount and address come from the moderation process's own attested terms and shadow trade.
  - **Storage and display.** The API verifies the statement against MOD_SIGNING_PUBLIC, checks it names the ruling in force with its round, and keeps the first one per ruling (migration 790). The seller's device shows the pay form only for a statement that verifies against the pinned key with its own accepted amount and attested address (`restitution` null otherwise).
- **m1: fixed.**
  - **The new rule.** A decided round 2 pays when no payout was recorded for the trade, after round 1 is authorised (not paid) so the gate knows its signers. `lienSteps` places the overturn lien only once round 1's payout is the one that ran (`executedRound === 1`), including when round 1 lands after the overturn. `rulingFee` follows the same rule.
  - **A nit (no effect).** When round 2 upholds round 1 and round 1 had already paid, the `settled` report's kind matches round 2, so `executedRound` records 2. Nothing reads it in the upheld case: no lien, and the fee is the same. Recording the ruling id the watcher settled would be exact.
- **m2: fixed, with N2 below.** Taps are now required for:
  - `maintenance-on` (kind, message hash, backBy as sent);
  - `news-publish` (id or null, title and body hashes as sent);
  - `banner-publish` (kind, text hash as sent).

  Each is consumed in the write's own transaction and bound to the session. The perm is `site.control`.
- **m3: fixed.** `threats-staff.md` and the plan now say what the gate enforces for round 2. It is also live code now (m1).

### The round-2 payout cannot pay twice

- **One record per trade.** The executor keeps at most one execution record per trade. It is written and saved before anything is handed or signed, and any later pass must match it (`mismatch` otherwise). `pay` is round 2 only when there is no record or the record is round 2's, so a round-1 payout already recorded (and perhaps handed) is always carried on and never swapped. This is pinned ("carried on, never swapped", with a restart).
- **One statement per trade.** Only one `RulingStatement` is ever signed per trade, from that record. The API keeps the first statement (`statement-conflict`).
- **The escrow itself.** Only one spend is possible.
- **What the device can't verify.** The device's `wrong-round` check now accepts 1 or 2. It cannot tell which round should pay, but it needs no such check: the moderation process never signs both.

### The builder's residuals

- **(a) A genuine round-1 after-refund statement, served after round 2 changed the outcome.**
  - **The round:** yes, the statement needs it, and it has it.
  - **The device can't fully know the latest round against an API that withholds:** this is the same class as the accepted residual "an appeal hidden for the whole window" (spec 6.6/T22). Accept it as that.
  - **Two cheap hardenings (Minor, recommended):**
    1. Sign an after-refund statement for **every** decided after-refund round, whatever its outcome. That means also `no-action` and `seller-returns-fiat` (a "decided, nothing to send" statement), so a round 2 that overrules is a signed fact and not just an absence.
    2. Have the seller's device persist the highest round it has verified for the trade, and never show a pay form for a lower round afterwards.
  - **Payment during the window is legitimate.** The 24 h comply window lies inside the 48 h appeal window, so paying on round 1 while an appeal may follow is the design. The lien rules already handle a later overrule (`compliedAt` → overturned lien on the buyer).
- **(b) No statement is signed when the moderation process has no recorded terms, and staff aren't told.**
  - **When it happens.** It should be rare for a refunded escrow, because the dispute holds off the shred. But it is silent, and the seller then sees no pay form while the lien and the comply deadline still run.
  - **Fix (Minor).** Report `no-terms` through the same `ruling-refused` channel (a reason outside the gate list, e.g. `GATE_REFUSALS` plus `no-terms` on the API side), so the case view shows it. Also hold `runComplyLapses` (no lapse, no freeze for `ignored-ruling`) while no statement exists for the ruling in force. A seller must not be penalised for a form their app was never allowed to show.
- **(c) A round 2 whose round 1 the gate refuses waits for the rescue.**
  - **When the refusal is `needs-second`:** acceptable. The rescue exists and the refusal is visible.
  - **When the refusal is not `needs-second`:** not acceptable. See N1.

### New findings

**N1 (Minor; liveness, stuck coins, narrow). Removing or switching off a moderator strands their published-but-unpaid round-1 rulings, and now also the appeal that overturns them.**

- **Where:**
  - `apps/moderation/src/gate/verify.ts:71-77`, :87-93: a removed, revoked or switched-off signer is `revoked`, judged at use time.
  - `apps/moderation/src/execute.ts`: for `pay === r2`, round 1 must be authorised first, otherwise the pass returns `refused-<reason>`.
- **The probe.** `probe-p4t22b-revoked.test.ts`, kept in the scratchpad:
  1. round 1 `release-to-buyer` by a moderator;
  2. round 2 `refund-to-seller` decided by an uninvolved senior;
  3. the moderator is removed;
  4. the executor returns `refused-revoked`, and nothing is settled.

  The probe passes, which confirms the finding.
- **The case.** The rescue does not apply, because it is only for `needs-second`. Nothing else can authorise round 1 again, so neither round can ever pay. This is the likely case, not a rare one: a moderator caught ruling for an accomplice is removed. Their ruling then rightly never pays, but the appeal meant to correct it can't pay either.
- **Round 1 alone, before this branch.** The same stranding already existed for round 1 alone. A removed moderator's unpaid ruling, with the winner offline, never paid and could not be re-ruled.
- **Fix (engineering; the lead decides the shape):**
  - (1) For the R37 signers check only (`round1-unseen`), not for authorisation, let the gate verify round 1's taps against the pinned credentials it keeps for removed or revoked staff. `remove-staff` keeps `creds`. Then record round 1 as seen with its signers, unpaid, and let round 2 pay.
  - (2) For a round 1 refused `revoked` with no appeal: let a senior or the owner re-propose round 1 under a new ruling id. The gate's `stale-round` allows it, because the old ruling was never authorised. Alternatively, show it on the case view so staff can steer the traders to appeal.
  - Test: the probe, plus the re-proposal.

**N2 (Minor, m2 leftover). The planned-maintenance announcement is still untapped, and a planned switch-on inherits its message.**

- **Where:** `PUT /staff/v1/site/maintenance/planned` (apps/api/src/staff/site.ts, after the maintenance route) stores `planned_message` without a tap. That message is shown to every visitor (`plannedMaintenance`).
- **The leak:** a planned switch-on with no message of its own binds `messageSha256: null` and then shows `planned_message`. So untapped text still reaches every user.
- **Fix:** tap the planned announcement with the same `maintenance-on`-style intent (start, end, message hash), and bind the inherited message into the switch-on tap.

### Tests run at a03297ef

All targeted vitest ran with nice -n 10, outside the lock.

| Project | Files | Result |
|---|---|---|
| packages/staff | all 14 | **377/377 passed** |
| packages/trade | afterRefundStatement, rulingStatement | **9/9 passed** |
| apps/moderation | afterRefund, execute, gate, internal, tradeShred | **143/143 passed** |
| apps/web | policy, attestation-flow, dispute, dispute-tripwires, disputeScreenProof | **302/302 passed** |
| apps/staff-web | moderator, ownerPages, screens, webauthnTripwire | **77/77 passed** |
| apps/api | 23 files: test/disputes/* (afterRefundStatement, gateRefusal and twoPersonAgreement included), finalOutcome, schema, site, staff content/pay/performance/keyTap/matrix/settings, watchReports | **608/608 passed** |

- **Probe** N1: passes (confirms it). Scratch only; deleted from the worktree.
- **Staff dispute regtest**, full, under ~/x2f-comms/check.lock: **12/15 passed** (39.2 min). All three failures are desktop rows whose phone twins passed.
  - **EUR row.** It is the first desktop row to fail. After the owner approved, the payout was recorded and handed (`ruling-signing`, `desk-ruling-recorded`), but the winner's co-sign did not complete within `PAYOUT_WAIT`. The moderation log has no `ruling-settled` for it, and a `ruling-settle-failed` at shutdown.
  - **Overturn row.** It then saw 28 unexpected incoming txs in the buyer wallet (its own tx among them). That is a stale `before` snapshot of the wallet, not a second payout.
  - **Winner-offline row.** It saw 1 unexpected incoming tx before the buyer reopened.
  - **No double payout.** The moderation log shows exactly one `ruling-signing` per ruling trade (10 for 10). Nothing points to two payouts on one trade.
  - **Rerun.** The same three desktop rows alone, under the lock: **3/3 passed** (6.3 min).
  - **Reading:** timing flakes in the desktop sequence, cascading from the slow EUR co-sign. They are not a security defect. A lead follow-up would make the `before` snapshots robust (refresh the wallet before snapshotting) and give the EUR row the same wait as the above-limit row.
