# Owner answers: assignment plan (9 Nov 2026, cloud lead planning helper)

The owner's order (8 Nov): "I want all my answers to every question moved and dispersed and disseminated amongst the team and worked on."

**Status note, 10 Nov 2026:** this plan was written on 9 Nov when 131 rows were "not started". Since then batch 3 (main 58f3d186) and batch 4 (main d421706c) landed. Current counts over all 534 register rows: landed 273, in flight 40, not started 83, waiting 53, superseded 85 (the register is the source of truth; section 6 has the per-job table and every indexed row's status). The text below is the 9 Nov plan.

This file turns the 131 "not started" rows of `owner-answers-register.md` into jobs. Every one of the 131 is in exactly one job below (index at the end). The 57 "waiting on ..." rows cannot be assigned yet. They are listed in section 4 by owner page id. The 19 lead defaults the owner has to confirm are in section 5.

Base facts used (checked 9 Nov 04:17 UTC): main = `origin/main` 0c6f3f16. On main, `packages/trade/src/payouts.ts:72-77` sends surplus to the seller's refund address. `apps/api/src/offers/routes.ts:42,133` has `mode: 'fixed'` and `OFFER_CAP_DEFAULTS { perMarket: 3, total: 20 }`. `apps/api/src/price/feed.ts:43` has `maxSpreadBps: 500`. `packages/trade/src/timers.ts:3` has `setupMin: 15`. On `wip/second-p3-task34` (c2d1006c, untouched since 2 Nov), `packages/trade/src/flexOffer.ts:60` has `MAX_METHODS = 10`.

Priority: **P1** = main (or the branch about to land) contradicts the owner, or the row touches money, keys, logins or security. **P2** = needed for launch. **P3** = later. "Top-ten #n" refers to the register's own "Ten most important not-started rows".

Owner codes: **LH** = lead helper (an Opus subagent the lead spawns: one worktree, one branch, single test files only). **c3** = claude3. **c2** = claude2. **design** = Claude Design (draws and words; cannot build code).

---

## 1. Jobs

Rules for every builder (they go in every brief):
- Red test first. Push every commit (R30). Use `READY:` or `BLOCKED:` subjects.
- Single test files only, through the serialised runner.
- Never weaken, skip or quarantine a test.
- New user-facing strings get `COPY-UNSIGNED`.
- No product calls: anything that picks a behaviour becomes a `BLOCKED:` note with a recommendation.
- Money, keys, logins and disputes get a security review, then a re-verify, before landing.

**Migration numbers reserved (lead's engineering call; check section 5 of LEAD-START-HERE before use):**

| Job | API migrations | Moderation migrations |
|---|---|---|
| J-01 | 340-344 | 010-011 |
| J-02 | 345-349 | |
| J-04 | 350-354 | |
| J-06 | 400-409 | 012-015 |
| J-08 | 370-374 | |
| J-09 | 375-379 | |
| J-10 | 360-369 | |
| J-11 | 460-469 | |
| J-12 | 420-429 | |
| J-13 | 430-439 | |
| J-14 | 450-459 | |
| J-15 | 410-419 | |
| J-17 | 355-359 | |
| J-20 | 380-384 | |
| J-21 | 470-479 | |
| J-23 | 385-389 (unused) and 500-509 (used: 500_chat_key_envelopes) | |
| J-24 | 390-394 | |
| J-27 | 480-489 | |
| J-07 | 440-449 | |
| J-16 | 490-499 | |

Main uses up to 113, 119 and 122. The branches use 016, 017, 120, 121, 123 (clash), 198, 200, 204, 208, 210, 307-325, 331, and moderation 007 (clash).

### Money and escrow (kept apart from wording)

**J-01: Surplus stays in escrow; payouts pay only the set amounts** · P1 (top-ten #1; main does the opposite) · LH (Opus)
- **Rows:** T-023, T-024, T-025, T-026
- **Plan tasks:** Plan 3 Task 1 (quote and payout maths), Plan 3 Task 10 (guarded auto-refund, signed terms), Plan 1 Task 9 (moderator auto-refund guard). The attested terms are shared with launch-rules' `payWindowMin` fix.
- **Branch:** `wip/lead-surplus-escrow`, from `origin/wip/lead-trade-rules-p1` 1801ffb5 (batch 3, which touches refunds). Merge main after batch 3 lands.
- **Depends on:** none to start. Coordinate with the launch-rules money-gap fix, which also edits the moderation service's attested terms.
- **Brief:**
  - Every automatic release and refund (`payoutsFor`, web `escrow/policy.ts`, the moderation guard) pays exactly the amounts fixed at take. Any surplus stays in the escrow, and the watcher keeps watching a closed escrow that still holds surplus. A seller's dispute plus the moderator key sends it; a seller top-up handles dust.
  - Funding includes the payout-fee estimate (option B).
  - STOP and report if main still has T-022's "extra XMR grows the trade" path (owner question; see section 5, "new questions").

**J-06: Ruling payout and liens** · P1 (money) · c3
- **Rows:** D-006, D-008, D-009, D-062, D-063
- **Plan tasks:** Plan 4 Task 12 (rulings), Task 14 (ruling execution; regtest, so avoid monerod suites on the shared box), Task 25 (liens and the repayment trade).
- **Branch:** `wip/third-ruling-payout`, from main after batch 3 (T11 + T16) lands. Until then, from `origin/wip/third-p4-task16` 169fa1d6.
- **Depends on:** batch 3. Clears the `NEEDS_PLAN_4_RULING_PAYOUT` tripwire.
- **Brief:**
  - Coins move as soon as a ruling is made. A lost dispute that needs restitution puts an immediate lien on the loser. The lien lifts while an appeal is pending and is re-applied on an overturn, whoever got the coins. A won appeal liens the other side until a repayment trade covers the loss.
  - Unpaid 1% fee: a loser with no escrow money still owes 1%, taken from their next settled trades (lead default, section 5). The lien includes the fee only if the lien holder owed it. The repayment trade charges no fee.

**J-12: Staff shifts, clock-out pay, senior pay, clawback A** · P1 (top-ten #8; money) · c3
- **Rows:** D-041, D-042, D-043, D-044, D-045
- **Plan tasks:** Plan 4 Task 33, Task 9 (earnings from a view-only fee wallet).
- **Branch:** `wip/third-staff-pay`, from main after batch 3.
- **Depends on:** J-13 (revenue ledger) for the senior large-trade %. The pay schedule can start first. Design draws the clock-out sheet and the first-login explainer (J-33 D-046) and removes the "hold the bonus 48 h" option from the StaffSettings board.
- **Brief:**
  - Pay per completed dispute, calculated at a correct clock-out since the last paid clock-out. Closing the app is not a clock-out; an automatic logout is recorded as information only. Show a clear total and a thank-you, and pay to a pre-approved address (adding one needs a strong login).
  - Pay kinds stay open to new kinds later. Seniors also get a % of large-trade revenue, set aside when the dispute completes. The threshold and % are owner numbers: leave them as settings with no default.
  - Clawback option A: pay goes out at clock-out, and an overruled decision reduces future pay (recorded as owed if they leave).

**J-13: Internal revenue ledger and fee-wallet sweep** · P1 (money) · LH (Opus)
- **Rows:** B-004, B-006
- **Plan tasks:** Plan 4 Task 32 (internal revenue ledger), Task 9 (fee wallet view).
- **Branch:** `wip/lead-revenue-ledger`, from main.
- **Depends on:** none. J-12 reads from it. Design adds a "Fee wallet" section to the StaffSettings board (B-006 is NOT DRAWN).
- **Brief:**
  - Keep an aggregate ledger of the 1% from completed trades, for revenue, payroll and treasury. It holds no per-trader detail beyond what the retention rules allow.
  - The fee wallet stays hot. At a threshold the owner sets, the excess moves automatically to his cold wallet. It always leaves one day plus one night of staff pay, and the owner is notified.
  - Ship the threshold unset (sweep off) until he sets it. The move is a money path, so it needs a security review.

### Offers and prices (claude2's area)

**J-02: Offer rules on main that contradict the owner** · P1 (top-ten #2, #3) · c2
- **Rows:** O-001, O-025, O-028
- **Plan tasks:** Plan 3 Task 4 (offers), Task 21 (PostOffer), Task 34 (the new cap).
- **Branch:** `wip/second-offer-rules`, from `origin/wip/lead-land` f89233af (batch 2 head: vendor-only posting and offer-units already merged). Merge main once batch 2 lands.
- **Depends on:** none. J-16 merges this later. Tell the lead whether launch-rules' "fixed-price offer can't be taken while the feed is down" still has any code path once fixed pricing is gone; that makes owner question N5 moot.
- **Brief:**
  - Remove fixed-price offers end to end: API `mode: 'fixed'`, `price_mode`, `fixed_cents_per_xmr`, and the PostOffer fixed option. Existing rows need a migration decision; pre-launch, so stop and report rather than deleting data.
  - Replace the 3-per-market / 20-total cap with 3 buy + 3 sell per vendor, with no on-hold 7th, in settings and the ad builder.
  - The limit pop-up uses the owner's text ("Sorry, you're limited to N offers per side..."), with the feedback link and the thank-you, marked `COPY-UNSIGNED`.

**J-03: Price sources may differ by at most 3%** · P1 (top-ten #4) · c2
- **Rows:** O-037
- **Plan tasks:** Plan 3 Task 3 (price feed).
- **Branch:** `wip/second-price-gap`, from main.
- **Depends on:** none. In the same session, also rebase your stale `wip/second-price-feeds` f1dea13d (the 4th source, O-036, in flight) and test it over Tor, as its own READY.
- **Brief:**
  - `PRICE_FEED_DEFAULTS.maxSpreadBps` goes from 500 to 300.
  - Prove with a red test that a 3.1% spread gives "no price" and 2.9% does not.
  - Check that `pairSpreadBps` and the owner alerts still behave, and report any other 5% constants you find.

**J-04: Poster's 60 minutes to answer; planned/unplanned maintenance** · P1 (main has 15 min and an "emergency" default) · c2
- **Rows:** T-061, W-004
- **Plan tasks:** Plan 3 Task 2 (timers / state machine); Plan 4 Task 8 (site controls), Task 29 (emergency-stop message).
- **Branch:** `wip/second-timers-maint`, from main after batch 3 (trade-rules-p1 changes timers).
- **Depends on:** batch 3. Design renames the chip to "Unplanned maintenance" (design CONFLICT on W-004).
- **Brief:**
  - `TIMERS.setupMin` goes from 15 to 60: the poster has 60 minutes to respond to a trade request before it closes automatically.
  - Maintenance never defaults to "emergency", which becomes an internal word only. The choices are planned (about 24 h notice, start and end) and unplanned (minimal info and a best guess). The message is up to 500 characters in a big bright banner, and timers freeze as already built (G62).

**J-16: Flexible offers (Task 34/35) revived with the owner's numbers** · P2 (top-ten #5) · LH (Opus)
- **Rows:** O-009, O-010, O-015, O-019, O-020
- **Plan tasks:** Plan 3 Task 34 (tiers, several methods, the cap), Task 35 (PostOffer tiers, methods, method dropdown).
- **Branch:** `wip/lead-flex-offers`. Rebuild `wip/second-p3-task34` c2d1006c and `wip/second-p3-task34-web` 488a5a71 onto main after batch 2 and J-02 land. This takes Task 34 off claude2, as the register asks.
- **Depends on:** batch 2 and J-02 landed. J-18 research (O-016) for the "bands must differ" list. Design picks for the currency select and the no-rate tag (J-32).
- **Brief:**
  - Rebuild Task 34/35 on current main with at most 3 bands per currency (`MAX_BANDS` 5 to 3; the board changes too) and at most 5 payment types (`MAX_METHODS` 10 to 5).
  - A second band needs differentiating conditions (no same-amount bands without modifiers), from J-18's list.
  - Currency select: top 5-6 most common first, then A-Z, all with flags.
  - A currency with no rate gets design's tag-or-hide treatment and comes back the instant its rate returns.
  - Carry the in-flight rows O-003..O-018 and O-047 along. Verify O-012's default line and O-017's chips.

**J-17: Gift-card rules** · P2 · c2
- **Rows:** T-055, T-056, T-057, T-081
- **Plan tasks:** Plan 3 Task 3 (payment method profiles), Task 18 (quote lines).
- **Branch:** `wip/second-gift-cards`, from `origin/wip/lead-design-results` 3e70488e (it has the 45-minute gift-card window). Merge main after batch 3.
- **Depends on:** batch 3. Design's in-app gift-card rules text (J-31 T-058) and the final GiftCardBrand board. Video proof (T-054, in flight) stays with the lead.
- **Brief:**
  - The card must have been bought within the last 30 days. Full written value only, except range cards (e.g. Visa 200-500), which need video proof.
  - Brand list: the top 30 + Home Hardware + Canadian Tire + Other. The list is in owner-decisions p5-6; Razer Gold is dropped.
  - The card's currency follows its country. Add a short window, an evidence checklist and tick-box terms in the quote lines. All wording `COPY-UNSIGNED`.

**J-29: Payment types and currencies expansion (later)** · P3 · LH
- **Rows:** O-030, O-052, B-009
- **Plan tasks:** Plan 3 Task 3 (method lists); legal list in `lawyer-questions.md`.
- **Branch:** `wip/lead-methods-expand`, after J-16 lands.
- **Depends on:** J-16. The lawyer (B-007).
- **Brief:**
  - Expand the 109 payment types, each with a legal check. Data-check the method and currency lists for sanctioned rails (SBP, Mir, YooMoney) and currencies (RUB first), and add those items to the lawyer list.
  - After launch, add currencies that both Coinbase and BitPay quote, sanctions checked first.

### Trade room, proofs, chat

**J-08: Payment detail boxes in the payer's chat** · P2 (top-ten #7; closes the paySeams.ts GAP) · LH (Opus)
- **Rows:** S-090
- **Plan tasks:** Plan 3 Task 20 (encrypted chat), Task 23 (BuyerPay and the trade room).
- **Branch:** `wip/lead-pay-details`, from main after batch 3 (BuyerPay changed by trade-rules and design-results).
- **Depends on:** J-18's per-method required-fields table (or do that step first inside this job).
- **Brief:**
  - Per payment method, the payment sender's side of the chat shows that method's required fields. For example, Interac needs full name plus email OR phone. The owner's words (p7-3): "those boxes can appear in the chat window on the person's side who is sending that payment type ... they just have to click send, and it sends it all nicely packaged over to the other person."
  - The packaged message goes through the existing end-to-end chat, never the API in plaintext. Close the paySeams.ts GAP.

**J-19: Trade-room pop-ups and copy drop-ins** · P2 · LH (Sonnet for drop-ins, Opus for BuyerPay)
- **Rows:** T-079
- **Also builds, once design signs the words:** T-034, T-039, T-044, T-049, T-080 (from J-31); D-016, D-020, S-025, S-043, G-013 (from J-33); O-035 (from J-32); and plays the nudge sound once J-18 clears its licence (T-031).
- **Plan tasks:** Plan 3 Task 23 (BuyerPay), Task 26 (nudges), Task 38 (warning pop-ups).
- **Branch:** `wip/lead-trade-copy`, from main after batch 3.
- **Depends on:** batch 3, and design's words from J-31, J-32 and J-33. Ship each line only once design delivers it, marked `COPY-UNSIGNED` until the owner signs it on the wording pages (J-26).
- **Brief:**
  - No-proof warning: tapping "I've paid" with no proof asks "are you sure?" and says proof can win a dispute. It always shows (lead default, section 5).
  - Per-reader trade terms: each side sees only the lines that apply to them, with no "poster pays 1%" line for the taker. Add the nudge line, the "close your other trades" rule and the own-name recommendation.
  - Then the string drop-ins listed above.

**J-07: "Was this blurred correctly?" for both parties** · P2 (top-ten #6; privacy) · c3
- **Rows:** P-012, P-013, P-014, P-015, P-020
- **Plan tasks:** Plan 5 Task 15 (proof screens), Task 16 (smart proof card), Task 4 (platform feedback, where the answers go).
- **Branch:** `wip/third-blur-check`, from main.
- **Depends on:** FIRST rebase your own stale proof branches as separate READYs: `wip/third-p5-proof-popups` e5780990 (P-007, P-008, P-010) and `wip/third-proof-owner-g16` 7b50096d (P-018). The lead writes the question's wording (owner p9-8: "get the lead to work on the wording"); use a `COPY-UNSIGNED` placeholder until then.
- **Brief:**
  - For the first month, ask BOTH parties on every proof whether the blur removed private information and kept the trade information. After that, ask on a sample (every 10th/20th, as a setting).
  - "No" asks for a comment, which goes to the feedback readers and records whether the blur was automatic or manual.
  - Keep a database of foreign-language name labels.
  - If the payer's own blur hides the trade code, post a system heads-up in the chat. Posting is still allowed.

**J-22: Receiver-side proof check (no server antivirus)** · P2 (security) · LH (Opus)
- **Rows:** P-031
- **Plan tasks:** Plan 5 Task 13 (on-device image pipeline), Task 15.
- **Branch:** `wip/lead-proof-receive`, from main.
- **Depends on:** none. This is a lead default (section 5); build it, and the owner can overrule.
- **Brief:**
  - On the receiving device, decode the proof image, re-render it to a fresh bitmap, and refuse it if either step fails.
  - No VirusTotal and no server-side antivirus.
  - Fuzz test with malformed PNG, JPEG and WebP inputs.

**J-28: OCR label reading and the proof template store (later)** · P3 · LH
- **Rows:** P-016, P-019, P-022
- **Plan tasks:** Plan 5 Task 7 (sensitive-text detection), Task 13 (OCR).
- **Branch:** `wip/lead-proof-ocr`, after J-07.
- **Depends on:** J-07. A research spike first.
- **Brief:**
  - OCR reads the label before a number (phone, account, "Trade code", "Amount") to decide what to blur. Card last-4 that matches the amount stays clear only under a trade-code or amount label.
  - Design a template store (field names, data blank) that is purged once auto-blur is good. Proofs kept 30 days teach per payment type, inside the retention rules.

### Accounts, logins, teams

**J-09: Signup login rules and the recovery code** · P1 (logins) · LH (Opus) (register said claude2; moved because the branch is the lead's and claude2 is often out on limits)
- **Rows:** S-012, S-013, S-014, S-017, S-019
- **Plan tasks:** Plan 2 Task 6 (password sign-up), Task 9 (recovery codes and the backup hold), Task 17 (24-hour hold by strength); Plan 3 Task 28 (onboarding).
- **Branch:** `wip/lead-signup-rules`, from `origin/wip/lead-signup-team` 08d96d4d.
- **Depends on:** the signup-team security review. S-019's FORMAT (one 16-character code, per S-018, versus about 5 mnemonic words) and its "team lead or moderator only" part need an owner answer (section 5, new questions). Build everything else.
- **Brief:**
  - Verify with tests, and fix if needed: signup refuses username + authenticator code alone, and username alone.
  - Only "strong" passwords are accepted, with a live meter.
  - The recovery code is required at signup: tick "I've written it down", then type it back. It is an emergency login only and never overwrites the username/password or the 24 h hold.

**J-10: Team permission model (Job 1c)** · P1 (T-076: members never release XMR) · LH (Opus)
- **Rows:** S-087, S-092, S-094, S-097, T-076, D-066, C-019
- **Plan tasks:** Plan 2 Task 18 (team members, roles, audit log); Plan 3 Task 42 (team members in trades).
- **Branch:** `wip/lead-team-perms`, from `origin/wip/lead-signup-team` 08d96d4d. Merge `wip/lead-hold-v3` after its re-verify (team hold rights, S-102).
- **Depends on:** signup-team review. Design's team-permissions-review on `wip/design-brief` is the starting set.
- **Brief:**
  - Granular member types: 3-4 types, 7-10 boxes each, and a member may hold several. A "Manager" preset ticks a recommended set that can be unticked. Add "can view notes on traders" and "can add notes" (logged, no delete).
  - Members never release XMR on the vendor's sell trades. Every release is logged with name and amount.
  - A "disputes" box lets a member see everything in a dispute and answer the moderator, but only trade parties open disputes.
  - Team chat replies stay hidden until a team-member key path exists (lead default).
  - Blocked by the owner: the chat label (N2) and O-051.

**J-20: Member trade-size band, working hours, first-login approval** · P2 · LH
- **Rows:** S-091, S-095, S-096
- **Plan tasks:** Plan 2 Task 18; Plan 3 Task 42.
- **Branch:** `wip/lead-team-limits`, from J-10's branch.
- **Depends on:** J-10. S-095's password-only member part waits on N3 (section 4). Build the first-login approval (design B) now.
- **Brief:**
  - Each member gets a trade-size band that limits every permission it touches.
  - Hours: "any time" or a days-and-hours schedule (carry the sessions note S-m4).
  - The lead approves only a member's first login. After that, the granular boxes are the protection.

**J-23: Full abilities on every strongly logged-in device** · P2 (security) · LH (Opus)
- **Rows:** S-075
- **Plan tasks:** Plan 2 Task 16 (new-device approval); Plan 3 Task 41 (LoginApprove and Devices).
- **Branch:** `wip/lead-multi-device`. Write a security note first (a docs commit), then build.
- **Depends on:** the note's code-matching step waits on p12-5 (6-digit code on both screens, section 4). Design adds the Jabber line to the wide twin. Jabber-notices must land first for the notification part.
- **Brief:**
  - Every extra device that logs in strongly gets full abilities, including chat.
  - A new login can be approved from a notification on a device that is already logged in, with no 24 h hold. That notice also goes out as a Jabber notice.
  - The owner said to check this security change in design before building, so the note goes to the lead first.

**J-24: Staff Jabber line, contact channels, recovery-hold contact** · P2 · LH
- **Rows:** W-016, S-026, D-064, D-067
- **Plan tasks:** Plan 7 Task 6 (OMEMO Jabber); Plan 4 Task 8 (settings: contact link), Task 11 (holds).
- **Branch:** `wip/lead-staff-jabber`, after `wip/lead-jabber-notices` lands.
- **Depends on:** jabber-notices review and landing, and N6 (OMEMO only over Tor?). S-026 also needs the owner to confirm what happens to trades in motion (section 5, new questions).
- **Brief:**
  - An optional secure Jabber account for staff to reach the owner. Staff who reach him there may end a recovery hold.
  - During a recovery hold, contact is offered only via Matrix, Telegram or secure Jabber.
  - The moderator contact-link setting takes Matrix or Telegram, Matrix preferred (lead default; verify whether it exists on main). Real addresses come later (W-015, the lead).

**J-05: Terms text 30/90 days, and apply the signature answers** · P1 (Terms contradict the owner; blocks the terms-signature landing; top-ten #10) · LH (Opus)
- **Rows:** C-013
- **Also applies (in-flight rows on the same branch):** B-012, B-013 and G-022.
- **Plan tasks:** Plan 7 Task 1 (retention rule; Terms text); Plan 2 (signup Terms gate).
- **Branch:** `wip/lead-terms-signature` (continue 909f87fb with a fresh helper).
- **Depends on:** none. The typed-box wording is design's ea2a9ca8. Members and staff sign at first login: that hooks into front-door's members-accept-Terms work, so merge `wip/lead-front-door` 6a5949a6 or coordinate at landing.
- **Brief:**
  - `termsText.ts:31,84`: completed trades are destroyed on the 30th day, and disputes are kept up to 90 days from close (privacy-scrubbed, for training).
  - Erase the signature when the account closes. Everyone who gets a login signs (traders, team members, staff).
  - Bump the Terms version, then re-verify.

**J-27: Dispute and training-copy purges; staff access revocation log (held)** · P2 · LH
- **Rows:** C-015, C-016
- **Plan tasks:** Plan 4 Task 23 (dispute and training-copy purges), Task 3 (activity log), Task 19 (training library).
- **Branch:** `wip/lead-dispute-purge`. Start only after page 12 is answered.
- **Depends on:** C-015 needs p12-12 (where scrubbed copies are made and kept). C-016 needs p12-7, p12-8 and p12-11 (audit-log life, permanent staff log, who sees it). Section 4.
- **Brief:**
  - Disputes are kept 90 days with personal details removed and the dialogue intact. Unedited proof is kept 90 days for training, then purged.
  - Revoking a removed staff member's chat access writes an audit event ("any event is logged").

### Staff site and support (claude3's area)

**J-11: Owner and staff lost-key recovery** · P1 (security) · c3
- **Rows:** D-029, D-030, D-032
- **Plan tasks:** Plan 4 Task 6 (owner first-run setup), Task 7 (staff management), Task 16 (staff web, OwnerSetup).
- **Branch:** `wip/third-staff-recovery`, from `origin/wip/third-p4-task16` 169fa1d6. Merge main after batch 3.
- **Depends on:** batch 2's page3 (2213ae8a: both owner keys for owner-account changes). STOP with `BLOCKED:` if D-029 ("one security key is enough" for the owner's backup login) conflicts with the two-owner-key rule. That is an owner question; see section 5.
- **Brief:**
  - The owner's backup login needs one of his two backup security keys plus its PIN. He can also use passkeys, PGP and a recovery key, and an owner who loses every PGP key gets back in this way.
  - A moderator who loses their only key uses a recovery code. Failing that, the owner vets them and resets their security (gives a username and password, then they add methods). The reset is audited.

**J-14: Support tickets and "My account has been compromised"** · P1 (top-ten #9; security) · LH (Opus) (register said claude3; moved for claude3's capacity before 21 Nov)
- **Rows:** D-055, D-057, D-059
- **Plan tasks:** Plan 4 Task 30 (helper support tickets API), Task 31 (ticket screens).
- **Branch:** `wip/lead-support-tickets`, from main after batch 3.
- **Depends on:** batch 3 (staff web). Contact channels use `COPY-UNSIGNED` placeholders until W-015 and W-016.
- **Brief:**
  - One open ticket per person until it is resolved. The 10-a-day ticket limit is shared across a team; feedback stays per member (verify what landed).
  - The "My account has been compromised" ticket takes a username, any credentials the person has, and a comment. It freezes the account at once (full lockout) and pauses its open trades. Staff then talk with the person on Matrix or Jabber.

**J-21: Staff site pages and moderator-only figures** · P2 · LH
- **Rows:** O-044, D-036, T-017, D-049, R-028
- **Plan tasks:** Plan 4 Task 1 (roles and permissions), Task 17 (owner pages), Task 18 (ModQueue/ModCase); Plan 5 Task 11 (past-rep review).
- **Branch:** `wip/lead-staff-pages`, from main after batch 3.
- **Depends on:** batch 3. Design draws the staff Prices page and the role checkboxes plus a Feedback rail item (both NOT DRAWN).
- **Brief:**
  - The price-health page moves to the staff site.
  - Granular moderator and helper permissions; a senior always has Feedback.
  - Every cancel type is folded into ONE cancel figure, shown only to moderators in the case view. Check that the public cancel rate is gone.
  - Profiles show "Disputes: N won, M lost" (lead default; the owner was leaning yes).
  - Verify that a different account can claim a revoked PGP key if it proves it.

**J-15: Appeals and the dispute-room hourglass** · P2 · c3 (hand over to a lead helper on 19 Nov if not READY)
- **Rows:** D-002, D-005, D-010, D-011, R-011, R-012
- **Plan tasks:** Plan 4 Task 24 (appeals: 48 h window, File appeal button, reviewer rule), Task 15 (trader dispute screens), Task 12 (appeal review); Plan 5 Task 20 (permanent reviews and running totals).
- **Branch:** `wip/third-appeals`, from J-06's branch.
- **Depends on:** J-06. Design redraws the 72 h boards to 48 h (D-004 CONFLICT) and adds File appeal to MyTrades.
- **Brief:**
  - One appeal, filed within 48 h of the ruling and decided within about 48 h; it is final. The File appeal button sits on the completed-trades list and the trade page and disappears at the deadline.
  - If no eligible reviewer exists, the appeal waits, the owner is alerted and the trader is told (lead default).
  - Feedback and totals follow the final binding outcome (reversed: none; settled: stays; appeal: held, then decided).
  - The dispute room shows an hourglass counting down from 24 h: "the maximum before a moderator steps in; usually quicker".

### Writing, research, pages (no test runs: these don't use the 3 test slots)

**J-18: Research pack** · P2 · LH (Sonnet is fine; no code)
- **Rows:** O-016, T-031
- **Plan tasks:** inputs to Plan 3 Task 34 (bands), Task 26 (nudges), Task 23 (pay fields).
- **Branch:** `wip/lead-research-1109` (a notes file only).
- **Depends on:** none.
- **Brief:**
  - (1) Collect the LocalMonero, LocalCoinSwap and Paxful listing conditions into one list, for the owner's page and for J-16.
  - (2) Gather the required payee fields per payment method for J-08, starting with the 10 profile methods.
  - (3) Licence check of the ICQ "Model T horn" clip the owner approved. If it can't be licensed, write a brief for an original sound in that style; design picks it and J-19 wires it.
  - Read the companies' actual terms, not forum summaries.

**J-25: Public crypto spec and grant drafts** · P2 · LH (Opus)
- **Rows:** X-006, X-008
- **Plan tasks:** Plan 6 Task 23/24 groundwork (audit, bug bounty).
- **Branch:** `wip/lead-crypto-spec` (docs only).
- **Depends on:** the membership-key parts mark page-12 items as pending.
- **Brief:**
  - A 2-4 page public spec of X2F's chat and escrow cryptography for community review. Say plainly that "moderators read only after a dispute" is enforced only once Plan 4's membership keys exist, and include the web-delivered-code caveat.
  - Drafts for Monero CCS, OTF Red Team Lab and NLnet. Nothing is sent without his yes.

**J-26: Wording sign-off pages (drafts for the lead to publish)** · P2 · LH (Sonnet)
- **Rows:** G-012
- **Plan tasks:** none (copy sign-off; feeds every `COPY-UNSIGNED` line).
- **Branch:** `wip/lead-wording-pages` (page HTML sources only; the lead publishes).
- **Depends on:** `origin/wip/design-brief:docs/copy-unsigned-by-screen.md` (86 screens, about 1,180 lines). Fold in the re-asks G-014 (p5-5) and G-023 (unsigned page names).
- **Brief:**
  - Draft question pages in the page11 format (stable ids, a plain one-line context per screen, sign / change / free text), grouped by screen, in batches of about 10 screens, so the owner can sign every line.
  - The lead reviews and publishes; helpers never publish.

**J-30: Native app and device-bound sessions (later)** · P3 (S-085 is "before mainnet") · LH
- **Rows:** W-009, W-010, S-085
- **Plan tasks:** Plan 6 Tasks 19-22 (native shell and apps); Plan 7 Task 13 (download page), Task 17 (battery opt-in).
- **Branch:** `wip/lead-native`, after launch-critical work.
- **Depends on:** Plan 6 Task 19 spike.
- **Brief:**
  - Android APK from the site plus our own F-Droid repo; the web app stays the main path. Optional unrestricted battery on Android, explained in setup.
  - Device-bound sessions (a non-copyable browser key) before mainnet.

### Design (draws and words; never decides what the app does)

Design jobs carry no branch for code. Design pushes boards and notes on `wip/design-brief`, as now. The owner delegated some look-and-feel calls to design by name (G42-G45 "design decides"; F5 "run it by design" for the vote). For those, design picks and the lead records it. Everything else design drafts, and it goes to the owner on the wording pages.

**J-31: Trade-room words and states** · P2 · design
- **Rows:** T-034, T-039, T-044, T-049, T-058, T-080, D-069, P-011, P-030
- **Plan tasks:** Plan 3 Tasks 23-27 boards; Plan 5 Task 15.
- **Branch:** `wip/design-brief`.
- **Depends on:** none. J-19 builds these lines.
- **Brief:** the per-reader trade terms list (nudge line, "close your other trades", own-name recommendation, cooperate-with-the-moderator line); CancelFinalSheet wording; the in-app gift-card rules; the proof disclaimer; the buyer-paid-less state; the no-proof warning's words.

**J-32: Offers and My offers boards** · P2 · design
- **Rows:** O-021, O-022, O-023, O-024, O-035
- **Plan tasks:** Plan 3 Tasks 17, 18, 21, 35, 36 boards.
- **Branch:** `wip/design-brief`.
- **Depends on:** none. J-16 and J-19 build them.
- **Brief:**
  - The no-rate pop-up and the no-rate tag versus hide choice.
  - The My offers flag for a currency with no price.
  - The screen-name vote.
  - The payment-type dropdown on My offers.
  - "Request to buy XMR" (and the sell equivalent) on BuyQuote and SellQuote.
  - Also redraw the bands board to 3 (O-009 CONFLICT).

**J-33: Accounts, staff and notice words** · P2 · design
- **Rows:** S-015, S-025, S-043, D-016, D-020, D-046, G-013
- **Plan tasks:** Plan 2 Task 14 / Plan 3 Task 28 (signup); Plan 4 Tasks 15-17 boards.
- **Branch:** `wip/design-brief`.
- **Depends on:** none.
- **Brief:**
  - The login-strength chart at signup (owner's draft copy per row).
  - The recovery-session change message.
  - The 60-day rule line at signup.
  - The frozen-account and ban notices.
  - The first staff login explainer and the clock-out sheet. Remove the "hold the bonus 48 h" option (D-044).
  - The Support headline.

**J-34: Look-and-feel calls the owner gave to design** · P3 · design
- **Rows:** G-003, G-004, G-005, G-006, G-007, G-008
- **Plan tasks:** Plan 3 Task 14 (UI kit), Task 40 (foldables).
- **Branch:** `wip/design-brief`.
- **Depends on:** none.
- **Brief:**
  - Look calls: the active-tab border, the disabled-button and sheet-title look, the blue info note and rounder icon buttons.
  - Unbuilt board items: order and look, but drop the Deposit row (no deposits, T-021).
  - The five Devices wording items.
  - Folding-phone research and per-device boards.

### Lead's own rows (process, accounts, later; no builder)

| row | what | when |
|---|---|---|
| X-017 | Scheduled tasks that wake claude2/claude3 from comms every 30 min until 21 Nov | tonight |
| X-019 | 19-20 Nov: all claude2/3 work pushed, final handoffs, queues to lead helpers | schedule now for 19 Nov |
| G-018 | Phone screenshot pack + "what changed" to design after each landing batch | after batch 2 |
| W-015 | Real Matrix and Telegram addresses; fill the placeholders | before launch |
| X-002, X-003, X-021 | SonarQube Cloud and the 1Password service account; wait on the owner's three steps (an owner action, not a page answer) | when the token exists |
| B-007 | Crypto lawyer before mainnet; Terms text from the lawyer | before mainnet |
| W-013, X-005, X-007 | Not open source for now; audit from early revenue; bug bounty after launch | after launch |

---

## 2. Dispatch order

**What the box can take.** Only lead helpers run on this 4-core box. claude2, claude3 and design run on their own cloud machines, so their jobs cost nothing here. At most 3 lead helpers that run tests at once. Reviews and writing jobs are cheap and can run alongside.

**The 3 test slots are already partly taken by in-flight work that comes before any new job:**
1. The batch 2 fixer (25 failures; `pc/lead-land-fixer-wip` holds partial unchecked edits).
2. The hold-v3 R-C1 fix and re-verify.
3. The launch-rules money gap (`payWindowMin` into attested terms) and its review.

Any `npm run check` the lead runs to land something takes the whole box: start no new test-running helper while a landing check runs.

**Start tonight (first eight):**

| # | Job | Who | Uses a test slot here? |
|---|---|---|---|
| 1 | J-01 surplus stays in escrow (P1 money) | LH Opus | yes: the first slot that frees (or now, if launch-rules waits for its review) |
| 2 | J-05 terms text + signature answers (P1, unblocks a landing) | LH Opus | yes: next slot, small job |
| 3 | J-18 research pack | LH Sonnet | no |
| 4 | J-26 wording sign-off page drafts | LH Sonnet | no |
| 5 | J-02 offer rules contradicting main | c2 | off-box |
| 6 | J-03 price gap 3% (+ rebase the 4th-source branch) | c2 | off-box |
| 7 | J-06 ruling payout and liens | c3 | off-box |
| 8 | J-07 blur check (after rebasing its stale proof branches) | c3 | off-box |

Send design J-31 to J-34 in the same hour. They are off-box and unblock J-16, J-19 and J-21.

**Queue (in order):**
- **Lead helpers, as test slots free:** J-09 → J-10 → J-13 → J-14 → J-08 → J-19 → J-16 (after batch 2 + J-02) → J-20 → J-22 → J-21 → J-23 → J-24 (after jabber lands) → J-27 (after page 12) → J-28 → J-29 → J-30. Writing job J-25 can start any time without a test slot.
- **claude3 (cap 3 helpers on its own box):** J-06, J-07, J-11 in parallel; then J-12; then J-15. Final handoff on 19 Nov; anything not READY goes to a lead helper.
- **claude2 (often out on limits; keep jobs small):** J-02, J-03; then J-04 (after batch 3); then J-17 (after batch 3). Final handoff on 19 Nov.

**Reviews to plan for (cheap, but never skip):**
- Security review and re-verify: J-01, J-06, J-09, J-10, J-11, J-12, J-13, J-14, J-22, J-23.
- Ordinary review: everything else that changes code.

---

## 3. Ready-to-paste messages

### 3a. `to-third.log` (append; replace TIME with `date -u +%T`)

```
[2026-11-09 TIME] lead: Sent by the X2F lead, not the owner. NEW QUEUE from the owner's order "all my answers ... disseminated amongst the team and worked on". Full plan: origin/comms:owner-answers-assignments.md; rows are ids in origin/comms:owner-answers-register.md. Rules for every job: red test first; push EVERY commit (R30); report only by commit subjects READY: <job> <what> or BLOCKED: <job> <question + your recommendation>; single test files only; never weaken/skip a test; new strings marked COPY-UNSIGNED; no product calls (stop and BLOCKED: instead); cap 3 helpers; your account closes 21 Nov, so final pushed handoff by 19 Nov. Migration numbers reserved for you are in the plan's section 1 table.
[2026-11-09 TIME] lead: FIRST, housekeeping: rebase wip/third-p5-proof-popups e5780990 and wip/third-proof-owner-g16 7b50096d onto main 0c6f3f16, run their own test files, push each as READY: (rows P-007 P-008 P-010 P-018).
[2026-11-09 TIME] lead: J-06 branch wip/third-ruling-payout (from wip/third-p4-task16 169fa1d6; merge main after batch 3) rows D-006 D-008 D-009 D-062 D-063 (Plan 4 Tasks 12, 14, 25): coins move at the ruling; lost dispute needing restitution = immediate lien, lifted while an appeal is pending, re-applied on overturn whoever got the coins; won appeal liens the other side until a repayment trade; unpaid 1% taken from the loser's next settled trades (lead default), lien includes the fee only if the holder owed it, repayment trade has no fee. Clears NEEDS_PLAN_4_RULING_PAYOUT. Money: security review follows. No monerod suites on the lead's box concern you, but keep regtest runs to single files.
[2026-11-09 TIME] lead: J-07 branch wip/third-blur-check (from main) rows P-012 P-013 P-014 P-015 P-020 (Plan 5 Tasks 15, 16, 4): first month ask BOTH parties on every proof whether the blur removed private info and kept the trade info, then a sampled setting (every 10th/20th); "No" asks a comment to the feedback readers and records auto vs manual blur; foreign-language name-label store; payer's own blur over the trade code posts a system heads-up in chat (still allowed). The lead writes the question wording: use a COPY-UNSIGNED placeholder.
[2026-11-09 TIME] lead: J-11 branch wip/third-staff-recovery (from wip/third-p4-task16 169fa1d6) rows D-029 D-030 D-032 (Plan 4 Tasks 6, 7, 16): owner backup login with one of his two backup security keys plus its PIN (also covers losing every PGP key); moderator who loses the only key: recovery code, else owner vets and resets (username + password, then they add methods), audited. If one-key backup login conflicts with page3's both-owner-keys rule (batch 2, 2213ae8a), STOP: BLOCKED: with your recommendation.
[2026-11-09 TIME] lead: J-12 (after J-06) branch wip/third-staff-pay (from main after batch 3) rows D-041 D-042 D-043 D-044 D-045 (Plan 4 Tasks 33, 9): pay per completed dispute at a correct clock-out since the last paid one; closing the app is no clock-out, auto-logout recorded as info; transparent total + thank-you; pre-approved payout address (adding one needs a strong login); pay kinds extensible; senior % of large-trade revenue as settings with no default (owner numbers); clawback option A (pay at clock-out, overruled decisions reduce future pay, owed if they leave). The senior % reads the revenue ledger a lead helper builds on wip/lead-revenue-ledger.
[2026-11-09 TIME] lead: J-15 (after J-06) branch wip/third-appeals (from wip/third-ruling-payout) rows D-002 D-005 D-010 D-011 R-011 R-012 (Plan 4 Tasks 24, 15, 12; Plan 5 Task 20): one appeal within 48 h of the ruling, decided ~48 h, final; File appeal button on the completed list and trade page, gone at the deadline; no eligible reviewer = appeal waits, owner alerted, trader told (lead default); feedback and totals follow the final outcome; dispute room hourglass from 24 h ("the maximum before a moderator steps in; usually quicker"). If not READY by 19 Nov, push WIP and say so; a lead helper takes it.
```

### 3b. `to-second.log` (append; replace TIME with `date -u +%T`)

```
[2026-11-09 TIME] lead: Sent by the X2F lead, not the owner. NEW QUEUE from the owner's order "all my answers ... disseminated amongst the team and worked on". Full plan: origin/comms:owner-answers-assignments.md; rows are ids in origin/comms:owner-answers-register.md. Rules for every job: red test first; push EVERY commit (R30); report only by commit subjects READY: <job> <what> or BLOCKED: <job> <question + your recommendation>; single test files only; never weaken/skip a test; new strings marked COPY-UNSIGNED; no product calls; cap 3 helpers; push WIP before any limit pause; your account closes 21 Nov, so final pushed handoff by 19 Nov. Task 34/35 (wip/second-p3-task34, -web) moves to a lead helper: leave those branches as they are. Migration numbers reserved for you are in the plan's section 1 table.
[2026-11-09 TIME] lead: J-02 branch wip/second-offer-rules (from origin/wip/lead-land f89233af = batch 2 head; merge main when batch 2 lands) rows O-001 O-025 O-028 (Plan 3 Tasks 4, 21, 34): MAIN CONTRADICTS THE OWNER. Remove fixed-price offers end to end (API mode 'fixed', price_mode, fixed_cents_per_xmr, PostOffer option; existing rows: BLOCKED: with a recommendation, don't delete data); cap = 3 buy + 3 sell per vendor, no on-hold 7th, in settings and the ad builder (replaces OFFER_CAP_DEFAULTS perMarket 3 / total 20); limit pop-up in the owner's words "Sorry, you're limited to N offers per side..." + feedback link + thank-you, COPY-UNSIGNED. Tell me if launch-rules' "fixed offer can't be taken while the feed is down" path is now dead.
[2026-11-09 TIME] lead: J-03 branch wip/second-price-gap (from main) row O-037 (Plan 3 Task 3): MAIN CONTRADICTS THE OWNER. PRICE_FEED_DEFAULTS.maxSpreadBps 500 -> 300 (3%); red tests at 3.1% (no price) and 2.9% (price); report any other 5% constants. Same session: rebase wip/second-price-feeds f1dea13d (4th source, O-036) on main, test it over Tor, READY: separately.
[2026-11-09 TIME] lead: J-04 (after batch 3 lands) branch wip/second-timers-maint rows T-061 W-004 (Plan 3 Task 2; Plan 4 Tasks 8, 29): MAIN CONTRADICTS THE OWNER. TIMERS.setupMin 15 -> 60 (the poster has 60 min to answer a trade request); maintenance never defaults to "emergency" (internal word only): planned (~24 h notice, start/end) and unplanned (minimal info + best guess), message up to 500 chars in a big bright banner; timers freeze as built (G62).
[2026-11-09 TIME] lead: J-17 (after batch 3 lands) branch wip/second-gift-cards (from origin/wip/lead-design-results 3e70488e) rows T-055 T-056 T-057 T-081 (Plan 3 Tasks 3, 18): card bought within the last 30 days; full written value only, except range cards (e.g. Visa 200-500) which need video proof; brand list = top 30 + Home Hardware + Canadian Tire + Other (list in owner-decisions p5-6, Razer Gold dropped); card currency follows its country, short window, evidence checklist, tick-box terms; all wording COPY-UNSIGNED (design is writing the rules text). Video proof itself stays with the lead.
```

### 3c. Message for design (send with `send_message` to `session_01XZAz2tn1YbpoyEtNYuAJim`)

```
Sent by the X2F lead, not the owner. The owner ordered: "I want all my answers to every question moved and dispersed and disseminated amongst the team and worked on." Below are his answers that are yours to draw or word. His own words are quoted where we have them; you draw and word, you do not decide what the app does. Where he handed a look-and-feel call to you by name (G42-G45, F5), pick and tell me; everything else comes back to me as drafts and goes to him on the wording pages. Please push boards and a note per group on wip/design-brief with READY: subjects, and tell me in docs/to-lead.md. Full plan: origin/comms:owner-answers-assignments.md (jobs J-31 to J-34); row ids are in owner-answers-register.md.

J-31 TRADE ROOM (please first)
- T-034 nudge line in the per-trade rules list. Owner (p6-1): "the trade window that lists all the things that are specific to the seller or the buyer ... it'll be one of those things that is going to tell them about the nudge feature and encourage them to use it if they do have an unresponsive partner."
- T-039 rule pop-up when opening a trade. Owner (p9-3): "If you are opening multiple trades with multiple people to see who responds first, please out of respect close out the other trades so at least the other people know that the trade is done and they're not waiting on you ... So find some way to word that better through design."
- T-044 own-name line on the pay screen. Owner (p9-9): "We are going to recommend that they always pay from an account with their own name on it because we protect their identity anyway ... It's just a recommendation, and we give them that reassurance that we protect their identity anyway."
- T-049 buyer's Cancel confirmation (CancelFinalSheet; it still names the seller before a cancel). Owner (p5-2): "Send to design for wording". Background G56: "before they pay, they need to realise that this is likely a final decision ... Please turn to design for wording on this."
- T-080 per-reader trade terms. Owner (8 Nov prototype comments, as recorded): show each reader only what applies to them, line by line: responsibilities, what affects them, their options (nudge every 15 min, etc.); no "poster pays 1%" to the taker.
- T-058 in-app gift-card rules. Owner (F13): "If you can gather as much evidence as Paxful and LocalMonero used for their rules ... put that into some really easy-to-understand and clear information for gift card purchasers and sellers". Rules to reflect: bought within 30 days; full value except range cards with video proof; 45 min to check; brand list per p5-6.
- D-069 dispute room. Owner (p9-5): "They're going to be able to ask questions of both parties, and both parties need to cooperate, otherwise they risk having a ruling against them."
- P-011 proof disclaimer. Owner (Q46): "Let design come up with the wording and the placement and the button. That is their job."
- P-030 buyer paid less: no prompt; the seller accepts or disputes; encourage talking first (C3 Q20, as recorded). NOT DRAWN yet.
- T-079 no-proof warning words. Owner (8 Nov, as recorded): tapping "I've paid" with no proof asks if they are sure, says proof can be instrumental in winning a dispute, and leaves it to them.

J-32 OFFERS
- O-021 no-rate pop-up. Owner (Q25): "Run it by design". Also pick tag vs hide in the currency dropdown (O-020), and the currency select: top 5-6 most common, then A-Z, all with flags (O-019).
- O-022 My offers flag. Owner (F4): "come up with a creative solution that is both explanatory to the ad poster and obvious at the same time. It shouldn't need a lot of reading ... Just tell them that we can't get a read on the currency they're choosing for that ad, so therefore that ad can't go live. Or, if it's an ad that has a dropdown with multiple currencies ... it'll be displayed saying "not available" or something like that."
- O-023 screen name. Owner (F5): "Run it by design. I'm putting up for a vote my offers, my listings, my ads, my posts." (Wide-shell uses "My offers" for now.)
- O-024 payment types on My offers. Owner (F6): "I'm for a drop down that would display each payment type that they are willing to perform".
- O-035 ad button. Owner (2 Nov): "Request to buy XMR" (and the sell-side equivalent) on BuyQuote/SellQuote.
- Also: bands board to at most 3 per currency (Q23; your board says 5).

J-33 ACCOUNTS, STAFF, NOTICES
- S-015 signup strength chart. Owner (1 Nov, his draft copy per row, "let the design team weigh in"): row 1 user+pass WEAK "weak by industry standards; after a breach, proving ownership is harder and longer; mandatory 24 h cooling-off stops the intruder but also applies to you while we vet you; harden with modern methods"; strong combos "stops simple username/password guessing, gives you immediate decisive actions"; top tier "Armored vault!"; recovery code stored apart from everything, humour OK ("buried in the back yard, written down in a fake rock").
- S-025 recovery-session change message (N50): "a 24 h hold... security team reviews... Matrix/Telegram... Jabber" (as recorded); addresses are placeholders.
- S-043 60-day rule line at signup. Owner (p4-6): "if they don't sign in at least once every 60 days their account will be terminated ... this is not a you know Fly by Night site it's generally designed for active Traders ... explain it a little bit more elegantly".
- D-016 frozen account. Owner (Q39): "A moderator has frozen your account. Open your dispute to see what you need to do to get it back ... Speak to design to find out the best wording."
- D-020 ban notice. Owner (G39): "We're sorry, but your account has been banned. If you feel this has been done in error, please reach out to a moderator at [Matrix Channel] [Telegram Channel] and ask to speak to a moderator for further details. Please refer to Design for the best wording here."
- D-046 first staff login. Owner (28 Oct): "First login: explain their position, pay structure, and that an unhappy trader can appeal." Plus the clock-out sheet (D-041: "Staff are paid right at the end of their shift WHEN THEY CLOCK OUT CORRECTLY ... Just closing the app does not clock out"), and remove "hold the bonus 48 h" from StaffSettings (clawback A, 28 Oct 13:24).
- G-013 Support headline. Owner (p5-4): "Ask an X2F staff member".

J-34 LOOK AND FEEL (yours by his words)
- G-003 active Buy/Sell tab 2 px dark border. Owner (G42): "I'm going to say yes, but I want it brought to design for review".
- G-004 disabled button and sheet title. Owner (G43): "I would recommend posing this question to Designer, unless she needs any input from me".
- G-005 unbuilt board items. Owner (G44): "Design decides the order, the aesthetic, the look, and everything about it, so just get her opinion and then build it". Drop the Deposit row: there are no buyer deposits.
- G-006 blue info note, rounder icon buttons. Owner (G45): "if it has to do with aesthetics or visual appeal, then it lands at designer's door".
- G-007 five Devices wording items. Owner (G46): "these are things that you bring to design. And if she needs my input ... bring it back to me with what she needs from me".
- G-008 folding phones. Owner (G47): "we need to do our research on the iPhone Duo and all the Samsung fold phones and the other fold phones ... it needs to detect the type of fold phone it's on. And she needs to design the pages for those devices if they are different."
```

---

## 4. BLOCKED: rows waiting on the owner (not assignable), by page id

| owner page / question | rows | what it unblocks |
|---|---|---|
| p11-17 | Q-001, C-012 | chat keys at 48 h or 30 days |
| p11-18 | Q-002 | late "I've paid" vs the seller's refund |
| p11-19 | Q-003 | hardware-only moderator passkeys |
| p11-20 | Q-004 | Fast badge measure (R-037) |
| p11-21 | Q-005 | weak-login team invite (S-060) |
| p11-22 | Q-006 | members' hold rights (S-102, J-10) |
| p11-23 | Q-007 | combined hold rules (S-049, S-036) |
| p12-1 to p12-15 | Q-008 to Q-022 | chat membership keys, audit log, staff access, 60-day close scope |
| p12-7, p12-8, p12-11 | D-035, C-011 | audit log life, permanent staff log, who sees it (also holds J-27's C-016) |
| p12-12 | Q-019 | where scrubbed training copies live (holds J-27's C-015) |
| p12-5 | Q-012 | 6-digit device approval (holds part of J-23) |
| N1 (not yet on a page) | Q-023 | username-available tick |
| N2 | Q-024 | team chat label (S-086; J-10) |
| N3 | Q-025, S-029 | password-only members, members' recovery codes (part of J-20's S-095) |
| N4 | Q-026 | time-to-pay values (T-042) |
| N5 | Q-027 | moot once J-02 removes fixed offers: tell him |
| N6 | Q-028 | OMEMO only over Tor (W-007, W-020; J-24) |
| N7 | Q-029 | purged-chat memory (365 days) |
| N8 | Q-030 | recovery code through throttling; shared-password limits |
| N9 | Q-031 | where the demo lives |
| N10 | Q-032 | archive raw transcripts |
| G1 (re-ask with screenshot) | G-010 | wording after "I've paid" |
| G22 (re-ask) | Q-033 | feedback-form limit message |
| G28 (lead to discuss) | S-045 | which changes queue for 24 h |
| G30 (re-ask with example) | S-100 | revoked-session example |
| G38 (re-ask) | R-035 | badge middle choice |
| p5-5 (re-ask; folded into J-26) | G-014 | "sign these short lines" |
| wording pages (J-26) | G-023 | unsigned page names |
| S-087 granular list (J-10 first) | O-051 | instructions for members without offer rights |
| not yet on a page | Q-034 | tell the user a replaced recovery code was never revealed |
| re-ask, no page id | S-101, S-084, G-020 | trust reset; two-device rule; "the previous demo was better" |
| later / lawyer / idea | D-047, S-089, W-011, W-014, X-018, B-005, B-008, B-010 | appellate judges; team fee; I2P; affiliates; registrar; large-trade tier; warrant canary; team legal status |
| waiting on design | G-009 | fold "Pay now" label |

That is 57 rows. In addition, five not-started rows are assigned to jobs but held in part by an owner answer: C-015 (p12-12), C-016 (p12-7/8/11), S-095 (N3), S-075 (p12-5) and S-026 (new question d below).

**New owner questions this plan raises (add to page 11 with stable ids):**
- a. Recovery code format: one 16-character code (S-018, 1 Nov) or about 5 mnemonic words (S-019, G32)? And is it for the team lead and moderators only? Recommendation: one 16-character code, everyone who logs in (matches what landed).
- b. Extra XMR sent before "I've paid" (T-022, 20 Oct: "grows the trade at the same rate") versus his 30 Oct rule that surplus always stays in escrow (T-023). Does "grow the trade" survive? Recommendation: no; all surplus stays until a dispute.
- c. Only if J-11 hits it: the owner's backup login with one security key (p4-4) versus "owner-account changes need both owner keys" (G4).
- d. During a recovery hold, may trades already in motion carry on (S-026)? Recommendation: yes, as S-020 already allows.

---

## 5. Lead defaults for the owner to confirm (19 rows, for his page)

The register counts 19. Fourteen say "lead default (confirm)"; five more (T-042, T-079, O-017, D-062, S-063) state a lead default inside the text. In plain words, as they would go on his page:

| row | the default the lead chose | status |
|---|---|---|
| T-042 | Time to pay: 90 min for apps and instant transfers, 3 h for bank transfers, 24 h for cash by mail (same as N4) | on launch-rules |
| T-046 | The old "don't pay before all confirmations" pop-up was removed, because payment details now stay hidden until the escrow is secured | landed |
| T-067 | Taking an offer locks the server's live price; the Starter cap counts the larger of the cash and the XMR value; a blocked user can't take the blocker's offers | landed |
| T-073 | "Secured" means the trade's own coins have 10 of 10 confirmations; dust sent later never re-locks paying | landed |
| T-077 | "Completed trades" counts releases plus refunds after a dispute | landed |
| T-079 | The "no proof attached, are you sure?" warning always shows; it can't be switched off like the other confirmations | J-19 |
| O-017 | Offer minimum past trades: "No minimum" is offered and is the default, next to 5/10/25/50 | Task 34 |
| O-055 | In the XMR/currency switch on a range, the minimum and maximum switch together | batch 2 |
| D-011 | If no moderator is eligible to review an appeal, it waits, the owner is alerted and the trader is told | J-15 |
| D-049 | Profiles show "Disputes: N won, M lost" (he was leaning yes) | J-21 |
| D-062 | A loser with no escrow money pays the 1% from their next settled trades | J-06 |
| D-067 | The moderator contact link accepts Matrix or Telegram, Matrix preferred | J-24 |
| D-068 | Moderators can't send chat messages outside development until the chat key design is built | batch 3 |
| S-063 | Idle reminder intervals offered: 10, 15, 30, 60, 120 minutes | batch 2 |
| C-019 | Team members' chat replies stay hidden until team members have their own chat key | J-10 |
| R-036 | The release-time figure uses the last 20 actions per account, with no trade codes | batch 2 |
| R-037 | Lost disputes count from live rulings; badge defaults on for all; every review counts; Fast = median of both lists (Fast also waits on p11-20) | batch 2 |
| P-031 | No virus scanning service or server antivirus; instead the receiver's device rebuilds every proof image and refuses broken ones | J-22 |
| W-020 | Opening a dispute sends the payer a "trade needs attention" Jabber notice; weak logins and holds can't change Jabber settings | jabber branch |

---

## 6. Counts, and the index of every row that was not started on 9 Nov

**Row status on 10 Nov 2026 (main d421706c, after batch 4; refreshed from the register).** All 534 register rows: landed 273, in flight 40, not started 83, waiting 53, superseded 85. The 131 rows indexed below were all "not started" on 9 Nov; today they stand as follows (last column of the index has each row):

| job | rows | landed | in flight | not started | waiting |
|---|---|---|---|---|---|
| J-01 | 4 | 0 | 0 | 0 | 4 |
| J-02 | 3 | 2 | 0 | 1 | 0 |
| J-03 | 1 | 1 | 0 | 0 | 0 |
| J-04 | 2 | 2 | 0 | 0 | 0 |
| J-05 | 1 | 1 | 0 | 0 | 0 |
| J-06 | 5 | 0 | 0 | 5 | 0 |
| J-07 | 5 | 0 | 0 | 5 | 0 |
| J-08 | 1 | 1 | 0 | 0 | 0 |
| J-09 | 5 | 5 | 0 | 0 | 0 |
| J-10 | 7 | 7 | 0 | 0 | 0 |
| J-11 | 3 | 0 | 0 | 1 | 2 |
| J-12 | 5 | 0 | 0 | 5 | 0 |
| J-13 | 2 | 2 | 0 | 0 | 0 |
| J-14 | 3 | 0 | 3 | 0 | 0 |
| J-15 | 6 | 1 | 0 | 5 | 0 |
| J-16 | 5 | 0 | 5 | 0 | 0 |
| J-17 | 4 | 4 | 0 | 0 | 0 |
| J-18 | 2 | 1 | 0 | 1 | 0 |
| J-19 | 1 | 1 | 0 | 0 | 0 |
| J-20 | 3 | 0 | 2 | 0 | 0 |
| J-21 | 5 | 0 | 5 | 0 | 0 |
| J-22 | 1 | 1 | 0 | 0 | 0 |
| J-23 | 1 | 0 | 1 | 0 | 0 |
| J-24 | 4 | 0 | 0 | 4 | 0 |
| J-25 | 2 | 2 | 0 | 0 | 0 |
| J-26 | 1 | 0 | 1 | 0 | 0 |
| J-27 | 2 | 0 | 0 | 0 | 2 |
| J-28 | 3 | 0 | 0 | 3 | 0 |
| J-29 | 3 | 0 | 0 | 3 | 0 |
| J-30 | 3 | 0 | 0 | 3 | 0 |
| J-31 | 9 | 7 | 0 | 2 | 0 |
| J-32 | 5 | 0 | 1 | 4 | 0 |
| J-33 | 7 | 2 | 0 | 5 | 0 |
| J-34 | 6 | 1 | 0 | 5 | 0 |
| lead own (section 1 table) | 11 | 0 | 0 | 8 | 3 |

Job state in words: J-02 (the O-028 limit pop-up is still open), J-04, J-05, J-08, J-09, J-10, J-13 (dark), J-17, J-18 (research; T-031 still needs an owner call on the sound), J-19, J-22, J-25 landed in batch 3 or batch 4. In flight: J-16 (`wip/lead-flex-launch-4`, with the launch rules), J-14 (`wip/second-support-tickets`), J-20 (`wip/second-team-limits`), J-21 (`wip/second-staff-pages`), J-23 (`wip/lead-multi-device`, note only), J-26 (wording pages). Waiting on the owner: J-01 (p11-63..66), J-27 (p12-7/8/11/12), part of J-11 (p11-69). Not started: J-06, J-07, J-12, J-15, J-24, J-28, J-29, J-30. Design jobs J-31 to J-34 are partly drawn (see the J-19 rows landed from trade-copy). Changelog: 10 Nov 2026, counts and index status refreshed from the register.

**Jobs per owner:**

| owner | jobs | job ids |
|---|---|---|
| lead helpers | 21 | J-01, J-05, J-08, J-09, J-10, J-13, J-14, J-16, J-18, J-19, J-20, J-21, J-22, J-23, J-24, J-25, J-26, J-27, J-28, J-29, J-30 |
| claude3 | 5 | J-06, J-07, J-11, J-12, J-15 |
| claude2 | 4 | J-02, J-03, J-04, J-17 |
| design | 4 | J-31, J-32, J-33, J-34 |
| lead itself (no job) | 11 rows | X-017, X-019, G-018, W-015, X-002, X-003, X-021, B-007, W-013, X-005, X-007 |

**Index: all 131 not-started rows to their job** (checked by script: none missing, none twice)

| row | rule (short) | job | carried by | priority  status 10 Nov |
|---|---|---|---|------|
| B-004 | Separate internal revenue ledger (aggregate) of completed trades' 1%;  | J-13 | LH | P1  landed |
| B-006 | Fee wallet stays hot; at an owner-set threshold the excess moves autom | J-13 | LH | P1  landed |
| B-007 | Crypto lawyer before mainnet; Terms text from the lawyer | lead own (section 1 table) | lead | -  not started |
| B-009 | Sanctioned rails (SBP, Mir, YooMoney) need a lawyer; no sanctioned cur | J-29 | LH | P3  not started |
| C-013 | Terms say: completed trades destroyed on the 30th day; disputes kept u | J-05 | LH | P1  landed |
| C-015 | Disputes kept 90 days with personal detail removed, dialogue intact; u | J-27 | LH | P2  waiting p12-12 |
| C-016 | Revoking a removed staff member's chat access is logged ("any event is | J-27 | LH | P2  waiting p12-7 |
| C-019 | Team chat must not ship before a team-member key path exists; hide tea | J-10 | LH | P1  landed |
| D-002 | Filing a dispute shows an hourglass counting down from 24 h ("the maxi | J-15 | c3 | P2  landed |
| D-005 | File appeal button on completed-trades list and the trade page; disapp | J-15 | c3 | P2  not started |
| D-006 | Won appeal fixes the record and liens the other account until it repay | J-06 | c3 | P1  not started |
| D-008 | Losing a dispute that requires restitution: immediate lien; lifted whi | J-06 | c3 | P1  not started |
| D-009 | Money moves at once after a ruling; a lien covers a reversal | J-06 | c3 | P1  not started |
| D-010 | One appeal only, filed within 48 h of the ruling, decided within ~48 h | J-15 | c3 | P2  not started |
| D-011 | No eligible appeal reviewer: appeal waits, owner alerted, trader told | J-15 | c3 | P2  not started |
| D-016 | Frozen-account message: "A moderator has frozen your account. Open you | J-33 | design | P2  landed |
| D-020 | Ban notice: "We're sorry, but your account has been banned. If you fee | J-33 | design | P2  not started |
| D-029 | Owner backup login: one security key is enough (its PIN also needed);  | J-11 | c3 | P1  waiting p11-69 |
| D-030 | Owner who loses every PGP key gets back in with one of his two backup  | J-11 | c3 | P1  waiting p11-69 |
| D-032 | Moderator who loses the only key: recovery code, else owner vets and r | J-11 | c3 | P1  not started |
| D-036 | Moderator and helper permissions granular; senior always has feedback | J-21 | LH | P2  in flight wip/second-staff-pages |
| D-041 | Staff pay per completed dispute, calculated at logout since the last p | J-12 | c3 | P1  not started |
| D-042 | For now pay is per completed dispute only (no hourly); pay kinds stay  | J-12 | c3 | P1  not started |
| D-043 | Seniors: pay per dispute + % of large-trade revenue (threshold TBD); b | J-12 | c3 | P1  not started |
| D-044 | Clawback option A: pay goes out at clock-out; an overruled decision re | J-12 | c3 | P1  not started |
| D-045 | Clock-out required; closing the app is no clock-out; auto-logout recor | J-12 | c3 | P1  not started |
| D-046 | First staff login explains position, pay and the appeal/clawback risk | J-33 | design | P2  not started |
| D-049 | Profiles show "Disputes: N won, M lost" | J-21 | LH | P2  in flight wip/second-staff-pages |
| D-055 | One open ticket per person until it is resolved | J-14 | LH | P1  in flight wip/second-support-tickets |
| D-057 | Tickets shared across a team; feedback per member | J-14 | LH | P1  in flight wip/second-support-tickets |
| D-059 | "My account has been compromised" ticket: username + any credentials + | J-14 | LH | P1  in flight wip/second-support-tickets |
| D-062 | Loser with no escrow money still owes 1% of the trade; deducted from f | J-06 | c3 | P1  not started |
| D-063 | Lien includes the unpaid fee only if the lien holder owed it; the repa | J-06 | c3 | P1  not started |
| D-064 | Staff who reach the owner on the secure Jabber channel may end a recov | J-24 | LH | P2  not started |
| D-066 | Only trade parties open disputes; team members with dispute access may | J-10 | LH | P1  landed |
| D-067 | Moderator contact link setting takes Matrix or Telegram (Matrix prefer | J-24 | LH | P2  not started |
| D-069 | In a dispute both parties must cooperate with the moderator's question | J-31 | design | P2  landed |
| G-003 | Active Buy/Sell tab 2 px dark border, after design review | J-34 | design | P3  not started |
| G-004 | Disabled-button and sheet-title look: design decides | J-34 | design | P3  not started |
| G-005 | Unbuilt board items (market price card, method icons, section counts,  | J-34 | design | P3  not started |
| G-006 | Blue info note and rounder icon buttons: design's call | J-34 | design | P3  not started |
| G-007 | Five Devices wording items go to design; owner input only if she asks | J-34 | design | P3  landed |
| G-008 | Research folding phones (Pixel, Samsung, others); detect the type; des | J-34 | design | P3  not started |
| G-012 | Sign unsigned wording: send every line, grouped by screen | J-26 | LH | P2  in flight |
| G-013 | Support headline: "Ask an X2F staff member" | J-33 | design | P2  not started |
| G-018 | Send design a phone screenshot pack + "what changed" after each landin | lead own (section 1 table) | lead | -  not started |
| O-001 | Offers are market ± % only; no fixed-price offers | J-02 | c2 | P1  landed |
| O-009 | At most 3 amount bands per currency | J-16 | LH | P2  in flight wip/lead-flex-launch-4 |
| O-010 | At most 5 payment types per offer | J-16 | LH | P2  in flight wip/lead-flex-launch-4 |
| O-015 | A second band needs differentiating conditions (e.g. trade count); sam | J-16 | LH | P2  in flight wip/lead-flex-launch-4 |
| O-016 | Research LocalMonero, LocalCoinSwap, Paxful listing conditions into a  | J-18 | LH | P2  landed |
| O-019 | Currency list: top 5-6 most common, then A-Z, all with flags | J-16 | LH | P2  in flight wip/lead-flex-launch-4 |
| O-020 | A currency with no market rate shows a "no rate" tag in the dropdown o | J-16 | LH | P2  in flight wip/lead-flex-launch-4 |
| O-021 | Run the no-rate pop-up wording by design | J-32 | design | P2  not started |
| O-022 | My offers: flag an ad whose currency has no price, obvious and pretty; | J-32 | design | P2  not started |
| O-023 | Name the screen: vote among My offers / My listings / My ads / My post | J-32 | design | P2  not started |
| O-024 | My offers shows the payment types in a dropdown | J-32 | design | P2  in flight wip/lead-flex-launch-4 |
| O-025 | 3 buy + 3 sell ads per vendor, in settings and the ad builder; no on-h | J-02 | c2 | P1  landed |
| O-028 | Limit pop-up "Sorry, you're limited to N offers per side..." + feedbac | J-02 | c2 | P1  not started |
| O-030 | Expand the 109 payment types as its own task after Task 34, legal chec | J-29 | LH | P3  not started |
| O-035 | Ad button reads "Request to buy XMR" (and the sell equivalent) | J-32 | design | P2  not started |
| O-037 | Max gap between price sources 3% before no price | J-03 | c2 | P1  landed |
| O-044 | Price-health page moves to the staff site | J-21 | LH | P2  in flight wip/second-staff-pages |
| O-052 | After launch add the currencies that both Coinbase and BitPay quote | J-29 | LH | P3  not started |
| P-011 | Disclaimer wording, placement and button: design's job | J-31 | design | P2  not started |
| P-012 | "Was this proof blurred correctly?" on every proof for the first coupl | J-07 | c3 | P2  not started |
| P-013 | First month: ask BOTH parties every time whether private info was remo | J-07 | c3 | P2  not started |
| P-014 | Database of foreign-language name labels; ask every uploader whether t | J-07 | c3 | P2  not started |
| P-015 | Receiver's feedback button records auto vs manual blur; read by a help | J-07 | c3 | P2  not started |
| P-016 | Proof template DB (field names, data blank) until auto-blur is perfect | J-28 | LH | P3  not started |
| P-019 | OCR reads the label before a number (phone, account) to decide blurrin | J-28 | LH | P3  not started |
| P-020 | Warn if the payer's blur hides the trade code; still allowed; system p | J-07 | c3 | P2  not started |
| P-022 | Card last-4 matching the amount: OCR the preceding words; "Trade code" | J-28 | LH | P3  not started |
| P-030 | Buyer paid less: no prompt; seller accepts or disputes; encourage talk | J-31 | design | P2  not started |
| P-031 | No VirusTotal or server AV; receiver-side proof check (decode, re-rend | J-22 | LH | P2  landed |
| R-011 | Feedback follows the final outcome: reversed none; settled stays; appe | J-15 | c3 | P2  not started |
| R-012 | Totals follow the final binding outcome | J-15 | c3 | P2  not started |
| R-028 | A different account may claim a revoked key if it proves it | J-21 | LH | P2  in flight wip/second-staff-pages |
| S-012 | Username + authenticator code alone is NOT allowed; no Medium tier | J-09 | LH | P1  landed |
| S-013 | Username-only accounts not allowed | J-09 | LH | P1  landed |
| S-014 | Strong passwords enforced at signup with a live meter; only "strong" a | J-09 | LH | P1  landed |
| S-015 | At signup a strength chart shows where the chosen methods stand; confi | J-33 | design | P2  not started |
| S-017 | Recovery code required at signup: tick "I've written it down", then ty | J-09 | LH | P1  landed |
| S-019 | Recovery code = emergency login only; very long or ~5 mnemonic words;  | J-09 | LH | P1  landed |
| S-025 | Message for a recovery-session change attempt ("a 24 h hold... securit | J-33 | design | P2  not started |
| S-026 | During a recovery hold contact only via Matrix/Telegram/secure Jabber | J-24 | LH | P2  not started |
| S-043 | No warning notice before the 60-day close; explain the rule clearly at | J-33 | design | P2  landed |
| S-075 | Full abilities on every extra device logged in strongly; approve a new | J-23 | LH | P2  in flight wip/lead-multi-device |
| S-085 | Device-bound sessions (non-copyable browser key) before mainnet | J-30 | LH | P3  not started |
| S-087 | Granular teams: 3-4 member types, 7-10 boxes each, a member can be in  | J-10 | LH | P1  landed |
| S-090 | Per-method detail boxes in the payer's chat side (e.g. Interac: name,  | J-08 | LH | P2  landed |
| S-091 | Each member gets a trade-size band that limits everything they do | J-20 | LH | P2  in flight wip/second-team-limits |
| S-092 | Granular boxes; a "manager" preset ticks a recommended set that can be | J-10 | LH | P1  landed |
| S-094 | Member boxes "can view notes on traders" and "can add notes" (logged,  | J-10 | LH | P1  landed |
| S-095 | Member logins: approve only the first login (design B); the granular b | J-20 | LH | P2  superseded |
| S-096 | Member hours: 24/7 or fine-tune days and hours | J-20 | LH | P2  in flight wip/second-team-limits |
| S-097 | The starting granular list is good; think of every one, leave the rest | J-10 | LH | P1  landed |
| T-017 | All cancel types recorded as ONE cancel figure, seen only by moderator | J-21 | LH | P2  in flight wip/second-staff-pages |
| T-023 | Automatic payouts pay ONLY the trade's expected amounts; any surplus s | J-01 | LH | P1  waiting p11-63 |
| T-024 | Surplus too small to move stays unless the seller disputes; they may t | J-01 | LH | P1  waiting p11-63 |
| T-025 | The pre-determined amounts are set in stone for every automatic payout | J-01 | LH | P1  waiting p11-63 |
| T-026 | Payout network fee option B: seller's funding includes an estimate of  | J-01 | LH | P1  waiting p11-66 |
| T-031 | Nudge sound = old ICQ Model T horn, original sped up, 2nd recording wi | J-18 | LH | P2  not started |
| T-034 | The trade's rules list tells each side about the nudge and encourages  | J-31 | design | P2  landed |
| T-039 | A rule pop-up when opening a trade: if you open several to see who ans | J-31 | design | P2  landed |
| T-044 | Recommend paying from an account in your own name; never enforced; rea | J-31 | design | P2  landed |
| T-049 | Buyer's Cancel confirmation wording goes to design | J-31 | design | P2  landed |
| T-055 | Gift card must be bought within the last 30 days | J-17 | c2 | P2  landed |
| T-056 | Full written value only, except range cards (e.g. Visa 200-500), which | J-17 | c2 | P2  landed |
| T-057 | Gift card brand list = top 30 + Home Hardware + Canadian Tire + Other  | J-17 | c2 | P2  landed |
| T-058 | Accept gift cards; easy, clear rules for buyers and sellers from Paxfu | J-31 | design | P2  landed |
| T-061 | Poster has 60 min to respond to a trade request before it closes autom | J-04 | c2 | P1  landed |
| T-076 | Team members never release XMR on the vendor's sell trades: only the v | J-10 | LH | P1  landed |
| T-079 | No-proof warning: tapping "I've paid" with no proof shows "are you sur | J-19 | LH | P2  landed |
| T-080 | Trade terms show each reader only what applies to them, line by line ( | J-31 | design | P2  landed |
| T-081 | Gift cards: card currency follows its country, short window, evidence  | J-17 | c2 | P2  landed |
| W-004 | Maintenance never defaults to "emergency" (internal only); unplanned:  | J-04 | c2 | P1  landed |
| W-009 | Optional unrestricted battery on Android, explained in setup | J-30 | LH | P3  not started |
| W-010 | Android: APK from the site + own F-Droid repo; web app stays main path | J-30 | LH | P3  not started |
| W-013 | Not open source for now; outside testing groups and a bug bounty | lead own (section 1 table) | lead | -  not started |
| W-015 | Real Matrix and Telegram addresses set up near the end of design | lead own (section 1 table) | lead | -  not started |
| W-016 | Optional secure Jabber account for staff to reach the owner; Matrix/Te | J-24 | LH | P2  not started |
| X-002 | Install SonarQube Cloud / the official SonarQube scan action; token is | lead own (section 1 table) | lead | -  waiting |
| X-003 | Use the 1Password CLI / service MCP vault for tokens | lead own (section 1 table) | lead | -  waiting |
| X-005 | No freelance crypto review now; a proper audit from early revenue | lead own (section 1 table) | lead | -  not started |
| X-006 | Public 2-4 page crypto spec for community review | J-25 | LH | P2  landed |
| X-007 | Bug bounty after launch | lead own (section 1 table) | lead | -  not started |
| X-008 | Monero CCS, OTF Red Team Lab, NLnet applications: drafts only; nothing | J-25 | LH | P2  landed |
| X-017 | "I don't see why nudge can't be moved to GitHub": scheduled routine wa | lead own (section 1 table) | lead | -  not started |
| X-019 | claude2 and claude3 accounts close 21 Nov: on 19-20 Nov confirm all pu | lead own (section 1 table) | lead | -  not started |
| X-021 | One 1Password service account token allowed in the cloud lead's enviro | lead own (section 1 table) | lead | -  waiting |
