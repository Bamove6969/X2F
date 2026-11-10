# Owner answers register (built 9 Nov 2026, cloud lead helper)

The owner's order (8 Nov): "I want all my answers to every question moved and dispersed and disseminated amongst the team and worked on." One row per answer he has given. His own words win over this file; where a row and his words differ, fix the row.

## Summary (counts by the first word of each row's status; 534 rows; refreshed 10 Nov 2026 against main d421706c, batch 4 landed 01:41 UTC)

| status | rows |
|---|---|
| landed main (batches 2, 3 and 4 included; incl. Oct work and done settings/processes) | 273 |
| in flight (on a branch awaiting review, fixes or landing; or an ongoing process) | 40 |
| not started | 83 |
| waiting on the owner (page id in the row) or on a later/lawyer/design decision | 53 |
| superseded by a later ruling | 85 |

Rows marked "lead default (confirm)": 18. Design audit column: CONFLICT 17, DRAWN 1, NOT DRAWN 24, PARTLY 37 (others not in design's audit; new 9 Nov rows carry the lead helper's reading of what the boards lack).
Caveats: a row "landed" with a partial tail (e.g. "landed main ...; X not built") counts as landed; its next action names the remainder. Many October rows were checked by presence in code only. "Dark" means built and on main but switched off (Jabber notices, fee sweep) until a named step.
Where the work is now: **in flight** = `wip/lead-flex-launch-4` (J-16 flexible offers + launch rules, review CHANGES REQUESTED, fixes running; batch 5), `wip/lead-jabber-omemo` (OMEMO, dark, batch 5), `wip/lead-multi-device` (J-23 design note), `wip/second-support-tickets` (J-14, claude2), `wip/second-team-limits` (J-20, claude2, READY), `wip/second-staff-pages` (J-21, claude2), `wip/lead-demo` (PC), plus process rows.

### Ten most important rows (status 10 Nov; the old "not started" top ten)
1. **T-023/T-024/T-025** surplus stays in escrow (money; main still does the opposite): waiting on owner p11-63..65 (does extra XMR still grow the trade?), T-026 fee estimate p11-66.
2. **O-001** remove fixed-price offers: landed main d421706c (J-02).
3. **O-025** offer cap 3 buy + 3 sell: landed main 58f3d186 (batch 3).
4. **O-037** price source gap 3%: landed main 58f3d186 (batch 3).
5. **O-009/O-010** 3 bands, 5 payment types: in flight, `wip/lead-flex-launch-4` (batch 5).
6. **P-012/P-013** "Was this blurred correctly?": not started (J-07).
7. **S-090** per-method payment detail boxes in chat: landed main d421706c (J-08).
8. **D-041..D-046** staff pay at clock-out, clawback A, first-login explainer: not started (J-12, claude3).
9. **D-059** "My account has been compromised": in flight, `wip/second-support-tickets` 3a438934 (J6 sealing owed; owner p11-78..80).
10. **C-013** Terms 30/90 days, **B-012/B-013** signature erase and everyone signs: landed main d421706c (terms-signature).

Change log:
- 10 Nov 2026: every non-superseded row re-checked against main d421706c and the branches. Batch 3 (58f3d186) and batch 4 (d421706c, wip/lead-land-4: terms-signature, docs-rules, crypto-spec, research, signup-rules, trade-copy, proof-receive, revenue-ledger, results-port, jabber-notices dark, J-02, J-04, J-17, pay-details, team-perms-port + hold v3, staff invite Terms) rows are now "landed"; flex-launch-4, OMEMO, J-23 note, J-14, J-20, J-21 rows are "in flight" with the branch; rows blocked on an owner page carry its id (p11-N / p12-N). Counts moved from 159/101/148/41/85 (landed / in flight / not started / waiting / superseded) to 273/40/83/53/85. The status "in batch 4" was used only while batch 4 was unlanded; it landed at 01:41 UTC.
- 9 Nov 2026: register built; page 11 answers 17-40 recorded.


## How to read it

- **id**: stable register id (area letter + number). **source**: his page/question id (Q = 6 Nov page, F = follow-ups 7 Nov, G = page 3 / "remaining" 7 Nov, p4-p11 = later pages), or the file and time for chat/lead-window rulings (`28OCT` = owner-answers-2026-10-28.md, `29OCT-lc` = owner-answers-2026-10-29-lead-calls.md, `30OCT-lw` = owner-answers-2026-10-30-lead-window.md, `C3` = owner-answers-2026-11-01-claude3.md, `2NOV-l` = owner-answers-2026-11-02-lead.md, `HO` = HANDOFF.md "Decided" sections on main, `R`n = rulings-and-lessons.md, `chat` = transplant/owner-words.md).
- **status**: `landed main <sha>` / `in flight <branch> <sha> (state)` / `not started` / `waiting on owner <page id>` / `superseded by <id>` (before 10 Nov also `on branch ... awaiting ...` and `in progress on ...`; both are now `in flight` or `landed`). "(unverified)" means I could not confirm it in code; "(Oct)" means it landed with the October plan tasks and is inside main 0c6f3f16 (I did not hunt the exact sha).
- **design**: design's own audit (`origin/wip/design-brief:docs/owner-answers-audit/combined-by-stage.md`, 82 rows): DRAWN / PARTLY / CONFLICT / NOT DRAWN; `-` = not in design's audit.
- **owner** (who carries it): design / claude2 (offers, prices, disputes timing, sessions, holds, vendor) / claude3 (staff, proof, reputation, dispute screens) / lead helper / lead / owner-pending. claude2 and claude3 accounts close 21 Nov: their rows pass to lead helpers then.
- Branch shorthands. **Batch 2** = `wip/lead-land` f89233af (page3 2213ae8a + sessions c8c84e7f + vendor bb7616e2 + wide-shell 057887a7 + watcher-flake + fold-quote 0efa7d38 + offer-units 225cfd5a), all APPROVED, 25 failing tests to fix before landing. **Batch 3** = trade-rules-p1 1801ffb5, design-results 3e70488e, third-p4-task11 ca356ce7 + third-p4-task16 169fa1d6, quote-bands 94360d55, all APPROVED. Main = d421706c after batch 4 (10 Nov 01:41 UTC); it was 0c6f3f16 when the register was built.
- Lead default (confirm) = a lead/builder call, not the owner's words; listed so he can overrule.

---

## 1. Trades and escrow

| id | date | source | rule | owner | status | design | next action |
|---|---|---|---|---|---|---|---|
| T-001 | 10-14 | HO Platform | No built-in wallet: users link their own wallets; one temporary escrow key per trade | lead | landed main (Oct) | - | none |
| T-002 | 10-14 | HO Platform | Fresh 2-of-3 multisig per trade; X2F holds at most the moderator key | lead | landed main (Oct) | - | none |
| T-003 | 10-14 | HO Platform | Building on Haveno rejected (would be custodial in a browser) | lead | landed main (decision) | - | none |
| T-004 | 10-14 | HO Platform | Seller funding window 30 min | claude2 | landed main (Oct; TIMERS.fundMin 30) | - | none |
| T-005 | 10-15 | HO Trade flow 2 | Take button says "Trade" (replaced "I'm in") | design | superseded by O-035 | - | none |
| T-006 | 10-15 | HO Trade flow 5; G66 | Buyer's 90-min payment timer starts when escrow is secured (fully funded) | claude2 | landed main (Oct; payBy from securedAt) | - | none |
| T-007 | 10-29 | 28OCT 07:55; HO 29b | "I've paid" is two steps (confirm sheet with required tick) | claude2 | landed main (Oct) | - | none |
| T-008 | 11-08 | p7-2 | Every completion box gets a 2nd "Are you sure..." pop-up with a "Do not show me this warning again" checkbox | lead helper | landed main 58f3d186 (batch 3; trade-rules-p1 1801ffb5) | - | none |
| T-009 | 10-15 | HO Trade flow 6 | Seller checks own bank, ticks, press-and-hold 1.5 s to release; no undo | claude2 | landed main (Oct) | - | none |
| T-010 | 10-29 | 28OCT 07:55 | The seller can never cancel after tapping "Fund escrow" | claude2 | superseded by T-033 | - | none |
| T-011 | 10-29 | HO 29b; G67 | No cancel of any kind after "I've paid"; buyer can't cancel after tapping it | claude2 | landed main (Oct; R39) | - | none |
| T-012 | 10-29 | 28OCT 12:30; R39 | Buyer cancel after funding = option B: XMR goes back at once (buyer + mod auto-sign to locked refund address); seller's Confirm cancel greyed until return confirmed | claude2 | landed main (Oct) | - | none |
| T-013 | 10-29 | 28OCT 13:14, 14:06 | Seller never taps Confirm cancel: stays in Active trades with "Your input is needed..."; auto-closes 48 h after the button lights up | claude2 | landed main (Oct; SELLER_CONFIRM_CANCEL_TIMEOUT_H 48) | - | none |
| T-014 | 10-29 | 28OCT 12:52, 13:48 | A cancel itself can't be disputed | claude2 | landed main (Oct) | - | none |
| T-015 | 10-29 | 28OCT 14:05 | Buyer may open a dispute within 48 h of a no-show refund to prove they paid | claude2 | superseded by T-082 (p11-17: window to file a dispute becomes 72 h; code still 48) | PARTLY | none |
| T-016 | 10-15 | HO Edge cases | Mutual cancel, no penalty; profiles show a neutral cancel rate | claude2 | superseded by T-017 | - | none |
| T-017 | 11-02 | 30OCT-lw 2 Nov 01:50 (2) | All cancel types recorded as ONE cancel figure, seen only by moderators (not public) | claude3 | in flight wip/second-staff-pages 20a73d24 (J-21, claude2, in progress) | - | finish, review, land |
| T-018 | 10-15 | HO Edge cases | Buyer no-show: seller may extend +30 min at most twice | claude2 | landed main (Oct; extendMin 30, maxExtensions 2) | - | none |
| T-019 | 10-15 | HO Edge cases | Buyer gets a 15-minute final alert before the no-show refund | claude2 | superseded by T-033 | - | removal is on trade-rules-p1 (finalAlertMin gone) |
| T-020 | 10-17 | HO Edge cases | Dispute after refund: mod may place a trading hold; seller must send the XMR as agreed | claude3 | superseded by D-013 | - | none |
| T-021 | 10-17 | HO Edge cases | No buyer deposits; only the seller funds | claude2 | landed main (Oct) | - | design: drop the "Deposit row" from G44 list |
| T-022 | 10-20 | HO Decided 10-20 | Extra XMR before "I've paid", within offer limits, grows the trade at the same rate; above max or after I've paid goes back to seller | claude2 | superseded by T-023 | - | lead to confirm whether "grow to funded" survives T-023 |
| T-023 | 10-30 | 29OCT-lc (10-30 07:45) | Automatic payouts pay ONLY the trade's expected amounts; any surplus stays in escrow; seller must open a dispute and the mod key sends it | lead helper | waiting on owner p11-63 (extra XMR before "I've paid": grow the trade or stay in escrow; p11-64, p11-65 follow) | - | owner p11-63..65 |
| T-024 | 10-30 | 29OCT-lc 07:50 (2) | Surplus too small to move stays unless the seller disputes; they may top up, then their key + mod key send it | lead helper | waiting on owner p11-63 (extra XMR before "I've paid": grow the trade or stay in escrow; p11-64, p11-65 follow) | - | owner p11-63..65 |
| T-025 | 10-30 | 29OCT-lc 07:50 (3) | The pre-determined amounts are set in stone for every automatic payout/refund | lead helper | waiting on owner p11-63 (extra XMR before "I've paid": grow the trade or stay in escrow; p11-64, p11-65 follow) | - | owner p11-63..65 |
| T-026 | 10-30 | 29OCT-lc (network fee) | Payout network fee option B: seller's funding includes an estimate of the payout tx fee so payouts pay exact amounts; leftover = surplus | lead helper | waiting on owner p11-66 (payout fee estimate 0.0001 XMR) | - | owner p11-66 |
| T-027 | 10-17 | HO Edge cases | Late extra XMR waits until every coin has 10 confirmations, then pays out; no time cap | claude2 | landed main (Oct) | - | re-check against T-023 |
| T-028 | 10-15 | HO Edge cases | Nudge: ICQ-style buzz, on by default, quiet hours, rate limits, privacy-safe push | claude2 | landed main (Oct) | - | none |
| T-029 | 11-07 | F10 | Nudge at most once every 15 minutes | claude2 | landed main 687ae821 (NUDGE_GAP_MS 15 min) | - | none |
| T-030 | 11-08 | chat 8 Nov 00:40 UTC; owner-decisions 7 Nov chat | "One nudge is not the maximum, it's just only one nudge per 15 minutes" (no count cap) | lead | landed main 687ae821 (per sender+recipient gap, no count cap) | - | none |
| T-031 | 11-07 | F10; G55; chat 7 Nov 07:14-07:32 | Nudge sound = old ICQ Model T horn, original sped up, 2nd recording with the 2nd horn 0.5 s longer; owner: "Sounds good"; check the rights first: an original sound in that style unless it can be licensed | design | not started (research pack landed d421706c: the original ICQ sound is proprietary; needs an owner call, no asset built) | - | owner call on the sound |
| T-032 | 11-07 | G2 | Seller who escrowed must wait 90 min and try at least one nudge before cancelling | claude2 | superseded by T-033 | - | branch wip/second-api-cap-dispute 326d9c6f built this: do not land that commit |
| T-033 | 11-08 | p6-1 | Nudges optional; a cancel gives no warning or 15-min alert; refund starts at once and completes at 10 confirmations; weak/strong login irrelevant to cancelling | lead helper | landed main 58f3d186 (batch 3; trade-rules-p1 1801ffb5) | - | none |
| T-034 | 11-08 | p6-1 | The trade's rules list tells each side about the nudge and encourages it with an unresponsive partner | design | landed main d421706c (batch 4; trade-copy e47e8e43) | - | none |
| T-035 | 11-07 | G66 | Seller's 90 minutes count from when escrow is fully funded | claude2 | landed main (Oct) | - | none |
| T-036 | 11-07 | G67 | Buyer can no longer cancel once "I've paid"; only disputes from then | claude2 | landed main (Oct; R39) | - | none |
| T-037 | 11-08 | p9-2; p11-18 | When the 90 min run out it is not automatic: seller may cancel; buyer may still ask to wait; if buyer paid and seller cancels, buyer may dispute at once | lead helper | landed main 58f3d186 (batch 3; trade-rules-p1 1801ffb5) | - | none |
| T-038 | 11-08 | p9-3 | No penalty for a taker who opens trades and never funds | claude2 | landed main (no penalty exists) | - | none |
| T-039 | 11-08 | p9-3 | A rule pop-up when opening a trade: if you open several to see who answers first, close the others out of respect (design wording) | design | landed main d421706c (batch 4; trade-copy e47e8e43) | - | none |
| T-040 | 11-08 | p9-4 | Once the poster taps "I've paid" (proof or not), the other side can no longer cancel | lead helper | landed main 58f3d186 (batch 3; trade-rules-p1 1801ffb5) | - | none |
| T-041 | 11-08 | p9-4 | Wait after "I've paid" is per payment type; shown up front at method pick ("FYI this method can take up to 12 hours") | lead helper | in flight wip/lead-flex-launch-4 43333a3a (review CHANGES REQUESTED, fixes running; batch 5; launch rules: $5,000 cap, time to pay per method, dispute before I've paid; owner p11-53..56, p11-95, p11-124, p11-126 pending) | - | land batch 5 |
| T-042 | 11-08 | p9-6 | Time to pay reflects the payment method | lead helper | in flight wip/lead-flex-launch-4 43333a3a (review CHANGES REQUESTED, fixes running; batch 5; launch rules: $5,000 cap, time to pay per method, dispute before I've paid; owner p11-53..56, p11-95, p11-124, p11-126 pending) | - | land batch 5 |
| T-043 | 11-08 | p9-7 | Seller marks complete, XMR releases automatically, 1% subtracted; no release deadline (lead reading) | claude2 | landed main (Oct) | - | design: R-m3 copy treats confirmBy as a release deadline: fix copy |
| T-044 | 11-08 | p9-9 | Recommend paying from an account in your own name; never enforced; reassure identity is protected | design | landed main d421706c (batch 4; trade-copy e47e8e43) | - | none |
| T-045 | 11-06 | Q12 | "Pay now"/payment details never show before escrow is secured (10/10), even for trusted sellers | lead helper | landed main 687ae821 | - | proto still shows details early: rebuild wip/lead-proto |
| T-046 | 10-28 | 28OCT Warning popups | Buyer warning before paying: don't send until all confirmations are in | lead | superseded by T-045 | - | lead default (confirm): PayWarning sheet deleted because Q12 gates paying |
| T-047 | 10-28 | 28OCT Warning popups | Seller warning before release: check your own bank, not a screenshot; release can't be undone | claude2 | landed main (Oct) | - | none |
| T-048 | 11-07 | G56 | No dispute card after a buyer's cancel; instead warn before cancelling that it is likely final; design wording | design | landed main 687ae821 ("Cancelling is final" sheet) | - | owner signs wording on the by-screen pages (G-012) |
| T-049 | 11-08 | p5-2 | Buyer's Cancel confirmation wording goes to design | design | landed main d421706c (batch 4; trade-copy e47e8e43) | - | none |
| T-050 | 10-28 | 28OCT Decision 1 | Trade waits until both addresses are in; locked after | claude2 | landed main (Oct) | - | none |
| T-051 | 10-28 | 28OCT Decision 7 | Buyer's refunded screen covers every refund reason, reason shown | claude2 | landed main d421706c (batch 4; results-port / quote-bands) | - | none |
| T-052 | 10-28 | 28OCT Decisions 2-6 | Migration 111, paidRecorded, trade-closed -> idle, PHONE_VIEWPORTS, 44px name to design | lead | landed main (Oct) | - | none |
| T-053 | 11-08 | p11-16 | Party who escrowed may dispute before "I've paid"; this greys out the other side's "payment sent" and warns "Do not send funds... moderator summoned" | lead helper | in flight wip/lead-flex-launch-4 43333a3a (review CHANGES REQUESTED, fixes running; batch 5; launch rules: $5,000 cap, time to pay per method, dispute before I've paid; owner p11-53..56, p11-95, p11-124, p11-126 pending) | PARTLY | land batch 5 |
| T-054 | 11-07 | G50 | Gift card: the escrower has 45 min to check it; video proof allowed (sender logs in and shows the card) | claude2 | landed main d421706c (batch 4; 45-minute gift-card window and J-17 terms; the video-of-login proof itself is only a terms line) | NOT DRAWN | video proof not built |
| T-055 | 11-07 | G51 | Gift card must be bought within the last 30 days | claude2 | landed main d421706c (batch 4; J-17 gift-card rules ed3ceecf) | NOT DRAWN | none |
| T-056 | 11-07 | G52 | Full written value only, except range cards (e.g. Visa 200-500), which need video proof; design words it | claude2 | landed main d421706c (batch 4; J-17 gift-card rules ed3ceecf) | NOT DRAWN | none |
| T-057 | 11-08 | G53, p4-3, p5-6 | Gift card brand list = top 30 + Home Hardware + Canadian Tire + Other (32 + Other; list in owner-decisions p5-6; Razer Gold dropped) | claude2 | landed main d421706c (batch 4; J-17 gift-card rules ed3ceecf) | PARTLY | none |
| T-058 | 11-07 | F13 | Accept gift cards; easy, clear rules for buyers and sellers from Paxful/LocalMonero evidence | design | landed main d421706c (batch 4; J-17 gift-card rules ed3ceecf) | PARTLY | none |
| T-059 | 11-06 | Q22 | Research how other sites handled gift cards | lead | superseded by T-058 | - | none |
| T-060 | 10-21 | HO Open decisions 6 | Gift cards allowed (~15 brands) | lead | superseded by T-057 | - | none |
| T-061 | 11-06 | Q11 | Poster has 60 min to respond to a trade request before it closes automatically | claude2 | landed main d421706c (batch 4; J-04 timers/maintenance) | - | none |
| T-062 | 11-06 | Q11 | Once in play 90 min to say transfer sent; slow types get a custom time; lead brings timing table | claude2 | superseded by T-063 | - | none |
| T-063 | 11-07 | F9 | Instant methods 90 min before a dispute; same/next day 24 h; slow 48 h-4 days (raise the 24 h maximum); common types get their own timing profile; "everything else you recommended, just do it" | lead helper | landed main 58f3d186 (batch 3; trade-rules-p1 1801ffb5) | - | none |
| T-081 | 11-07 | F13 (decisions) | Gift cards: card currency follows its country, short window, evidence checklist, tick-box terms | claude2 | landed main d421706c (batch 4; J-17 gift-card rules ed3ceecf) | - | none |
| T-064 | 11-06 | Q10 | Buyer waits 60 min after "I've paid" before a dispute; pauses in maintenance without affecting the poster's time | claude2 | superseded by T-063 | - | none |
| T-065 | 11-06 | Q36 | Seller waits 60 min before filing a dispute; nudge frequency to decide | claude2 | superseded by T-063 | - | none |
| T-066 | 11-01 | 30OCT-lw 1 Nov 21:40 | Buyer may dispute 30 min after "I've paid" (corrected from "straight away") | claude2 | superseded by T-064 | - | none |
| T-067 | 10-29 | 29OCT-lc | Take locks the server's live price; Starter cap counts the larger of cash and XMR at market; a blocked user can't take the blocker's offers | lead | landed main (Oct) | - | lead default (confirm) |
| T-068 | 11-07 | G62 | Maintenance freezes every trade timer site-wide; the 24 h low-security account holds keep ticking | claude2 | landed main (Oct-Nov; maintenance_since, coordination "Owner rule g62") | - | design: SellerConfirm/dispute hide Open dispute in maintenance (p1 follow-up) |
| T-069 | 11-07 | G19 | During maintenance all disputes and their times are on hold | claude2 | landed main (same as T-068) | PARTLY | none |
| T-070 | 11-07 | G7 | A held trade: both can still enter and chat; no coins move until a moderator decides | claude2 | landed main d421706c (batch 4; hold v3 + team-perms-port cba502d2) | PARTLY | none |
| T-071 | 11-07 | G33 | During a hold the partner may leave the trade and do other things | claude2 | landed main (nothing locks them) | - | none |
| T-072 | 11-01 | 30OCT-lw 1 Nov 17:00 #4 | When a hold triggers: unfunded trade cancelled; mid-trade put on hold with incident ID pop-up; partner told "technical issue" | claude2 | superseded by S-106 (p11-26: a hold holds only the changes made; trades keep running); hold-v3 561af62c still cancels/holds trades | - | rework in hold-v3 per S-106 |
| T-073 | 11-08 | lead decision | "Secured" = the trade's own funds 10/10 and unlocked; later dust never re-locks paying | lead | landed main 687ae821 | - | lead default (confirm) |
| T-074 | 11-08 | p10-1 | Selling poster escrows trade + 1%; taker receives the full amount (case 2 as the app does) | claude2 | landed main (Oct) | - | design: BuyQuote fee rows must match (board changes, not the build) |
| T-075 | 11-08 | p9-1 | Buying poster: on completion the poster receives the trade less 1%, fee to the X2F wallet | claude2 | landed main (Oct) | - | results room must not promise the full amount (results-fold review): fixed on design-results? verify |
| T-076 | 11-08 | p10-2; p7-1 | Team members never release XMR on the vendor's sell trades: only the vendor does; every release logged with name and amount | lead helper | landed main d421706c (batch 4; team-perms-port cba502d2: abilities catalogue) | - | none |
| T-078 | 11-07 | G2 | Before escrow is funded either side can cancel at once, no reason needed | claude2 | landed main (Oct) | PARTLY | design draws Cancel on TradeFund (seller, unfunded) |
| T-079 | 11-08 | owner-decisions 8 Nov | No-proof warning: tapping "I've paid" with no proof shows "are you sure?", says proof can win a dispute, leaves it to them (design words; lead default: can't be silenced) | lead helper | landed main d421706c (batch 4; trade-copy e47e8e43) | - | none |
| T-080 | 11-08 | prototype comments 8 Nov | Trade terms show each reader only what applies to them, line by line (responsibilities, effects, options such as nudge every 15 min); no "poster pays 1%" to the taker | design | landed main d421706c (batch 4; trade-copy e47e8e43) | - | none |
| T-077 | 10-29 | 29OCT-lc | "Completed trades" = released + refunded-after-dispute (R38) | claude3 | landed main (Oct) | - | lead default (confirm) |
| T-082 | 11-09 | p11-17 | Window to file a dispute is 72 h (was 48 h); 30 days for destroying an undisputed trade's chat and keys stands | claude2 | waiting on owner p11-51 (which 72 h window; docs say 72 h, code still 48 h) | PARTLY | owner p11-51 |
| T-083 | 11-09 | p11-29; p11-18 | Time to pay per payment type = the researched average time to receive that method; the same number is the wait before the other side may cancel | lead | waiting on owner p11-53 (five time tiers; per-method times already on the profiles in flex-launch-4) | - | owner p11-53 |

## 2. Offers and prices

| id | date | source | rule | owner | status | design | next action |
|---|---|---|---|---|---|---|---|
| O-001 | 11-06 | Q1; 2NOV-l 07:48 | Offers are market ± % only; no fixed-price offers | claude2 | landed main d421706c (batch 4; J-02 fixed-price offers removed end to end) | - | none |
| O-002 | 10-17 | HO Open decisions 8 | Pricing market ± % or fixed per XMR with a stale-price warning | claude2 | superseded by O-001 | - | none |
| O-003 | 11-06 | Q4 | FlexOffer-Post is the offer form (bands per currency, each its own ± %) | claude2 | in flight wip/lead-flex-launch-4 43333a3a (review CHANGES REQUESTED, fixes running; batch 5; J-16 flexible offers) | CONFLICT | land batch 5 |
| O-004 | 11-06 | Q5 | Vendor picks currencies and methods separately; X2F doesn't pair them; taker picks both from dropdowns on the ad | claude2 | landed main c85dffe9 (method picker); currency dropdown in progress on wip/second-p3-task34 | PARTLY | design stops pairing methods per currency on the board |
| O-005 | 11-07 | F7 | One ad: dropdown of currencies, then dropdown of methods; all items indexed for search | claude2 | in flight wip/lead-flex-launch-4 43333a3a (review CHANGES REQUESTED, fixes running; batch 5; J-16 flexible offers) | - | land batch 5 |
| O-006 | 11-01 | 30OCT-lw 1 Nov 21:00 | One ad lists many payment types; a search by type finds it; buyer picks one, locked in; cash in person is a type; type rules come with the type | claude2 | landed main c85dffe9 (picker); multi-type ads in progress on Task 34 | - | with O-003 |
| O-007 | 11-01 | 30OCT-lw 1 Nov 21:10 | An ad lists all the poster's currencies; buyer picks one at start | claude2 | in flight wip/lead-flex-launch-4 43333a3a (review CHANGES REQUESTED, fixes running; batch 5; J-16 flexible offers) | - | land batch 5 |
| O-008 | 11-01 | 30OCT-lw 1 Nov 21:40 (3) | Band amounts are converted at market and shown in the chosen currency | claude2 | landed main d421706c (batch 4; results-port / quote-bands) | - | none |
| O-009 | 11-06 | Q23 | At most 3 amount bands per currency | claude2 | in flight wip/lead-flex-launch-4 43333a3a (review CHANGES REQUESTED, fixes running; batch 5; J-16 flexible offers) | CONFLICT | land batch 5 |
| O-010 | 11-06 | Q23 | At most 5 payment types per offer | claude2 | in flight wip/lead-flex-launch-4 43333a3a (review CHANGES REQUESTED, fixes running; batch 5; J-16 flexible offers) | - | land batch 5 |
| O-011 | 11-06 | Q23 | Instructions change with the payment type picked in the dropdown; the ad stays short | claude2 | in flight wip/lead-flex-launch-4 43333a3a (review CHANGES REQUESTED, fixes running; batch 5; J-16 flexible offers) | - | land batch 5 |
| O-012 | 11-07 | F2 | Vendor may write instructions per payment type; if blank: "Payment method chosen: <type>. Please post pertinent details in chat window." | claude2 | in flight wip/lead-flex-launch-4 43333a3a (review CHANGES REQUESTED, fixes running; batch 5; J-16 flexible offers) | - | land batch 5 |
| O-013 | 11-06 | Q2 | Automatic instruction line idea; open to feedback | design | superseded by O-012 | - | none |
| O-014 | 11-02 | 30OCT-lw 2 Nov 07:20 | Instructions per payment type AND per currency where they differ | claude2 | in flight wip/lead-flex-launch-4 43333a3a (review CHANGES REQUESTED, fixes running; batch 5; J-16 flexible offers) | - | land batch 5 |
| O-015 | 11-07 | Q20; F3 | A second band needs differentiating conditions (e.g. trade count); same-amount bands only with modifiers; the set is not settled | claude2 | in flight wip/lead-flex-launch-4 43333a3a (review CHANGES REQUESTED, fixes running; batch 5; J-16 band-must-differ; owner p11-60 and p11-96 pending) | PARTLY | owner p11-60, p11-96 |
| O-016 | 11-07 | G15 | Research LocalMonero, LocalCoinSwap, Paxful listing conditions into a list | lead helper | landed main d421706c (batch 4; research pack / crypto-spec d7fbdbdb; drafts only, nothing sent) | - | none |
| O-017 | 11-06 | Q27 | Min past trades per band: 5, 10, 25, 50 (lead default: "No minimum" also offered and default; owner may make 5 the floor) | claude2 | landed main 58f3d186 (batch 3; offer-rules: min past trades 5/10/25/50 or none; unverified that chips match) | DRAWN | verify chips in code |
| O-018 | 11-02 | 2NOV-l 07:48 | Bands are whole units; the next starts at +1 (500 then 501) | claude2 | in flight wip/lead-flex-launch-4 43333a3a (review CHANGES REQUESTED, fixes running; batch 5; J-16 flexible offers) | - | land batch 5 |
| O-019 | 11-06 | Q28 | Currency list: top 5-6 most common, then A-Z, all with flags | claude2 | in flight wip/lead-flex-launch-4 43333a3a (review CHANGES REQUESTED, fixes running; batch 5; J-16 flexible offers) | PARTLY | land batch 5 |
| O-020 | 11-06 | Q24 | A currency with no market rate shows a "no rate" tag in the dropdown or disappears; returns instantly | claude2 | in flight wip/lead-flex-launch-4 43333a3a (review CHANGES REQUESTED, fixes running; batch 5; J-16 flexible offers) | PARTLY | land batch 5 |
| O-021 | 11-06 | Q25 | Run the no-rate pop-up wording by design | design | not started | - | with O-020 |
| O-022 | 11-07 | F4 | My offers: flag an ad whose currency has no price, obvious and pretty; single-currency ad can't go live; multi shows "not available" | design | not started | - | design solution, then build |
| O-023 | 11-07 | F5 | Name the screen: vote among My offers / My listings / My ads / My posts, run by design | design | not started | - | design decides; wide-shell uses "My offers" for now |
| O-024 | 11-07 | F6 | My offers shows the payment types in a dropdown | design | in flight wip/lead-flex-launch-4 43333a3a (review CHANGES REQUESTED, fixes running; batch 5; My offers lists every method; the dropdown look is design J-32) | NOT DRAWN | design J-32 |
| O-025 | 11-07 | F8; Q31 | 3 buy + 3 sell ads per vendor, in settings and the ad builder; no on-hold 7th | claude2 | landed main 58f3d186 (batch 3; offer-rules 738f02ee: 3 buy + 3 sell) | - | none |
| O-026 | 11-01 | 30OCT-lw 1 Nov 21:40 (2) | Ad cap = 3 buy + 3 sell per vendor (replaces 3 per market / 20 total) | claude2 | superseded by O-025 | - | none |
| O-027 | 10-28 | 28OCT Q14 | Flexible offers; cap 2 per side per currency, 20 total | claude2 | superseded by O-025 | - | none |
| O-028 | 10-28 | 28OCT Q14 | Limit pop-up "Sorry, you're limited to N offers per side..." + feedback link + thank-you text | claude2 | not started | - | write postCantDoText with the 3+3 cap |
| O-029 | 11-07 | F1 | Margin typed as above or below market, max 50% | claude2 | landed main (Oct; MAX_MARGIN_BPS ±50%) | - | none |
| O-030 | 11-06 | Q30 | Expand the 109 payment types as its own task after Task 34, legal check per type | lead helper | not started | - | queue after Task 34 |
| O-031 | 11-06 | Q3 | Board vs server ranges: owner needs more detail | lead | superseded by O-029 | - | none |
| O-032 | 11-06 | Q26, Q29, Q32, Q33 | "What is My offers / Task 34 / fixed 3?" | lead | superseded by O-022, O-023, O-024, O-025, O-005 | - | none |
| O-033 | 10-28 | 28OCT Q10 | My offers: list of my offers, each with on/off, plus Select all | claude2 | landed main (Oct; Task 36) | - | none |
| O-034 | 10-29 | 28OCT 08:03 e | Tick one by one or Select all, then Turn on / Turn off | claude2 | landed main (Oct) | - | none |
| O-035 | 11-02 | 30OCT-lw 2 Nov 01:50 (1) | Ad button reads "Request to buy XMR" (and the sell equivalent) | design | not started | PARTLY | design fixes BuyQuote/SellQuote; build (no such string in code) |
| O-036 | 11-07 | Q6; F11 | Keep the 3-source middle value; add a 4th source after it passes a Tor check | claude2 | landed main (3-source median, Oct); 4th source in progress on wip/second-price-feeds f1dea13d (stale) | - | reassign: test 4th source over Tor, then land |
| O-037 | 11-06 | Q7 | Max gap between price sources 3% before no price | claude2 | landed main 58f3d186 (batch 3; offer-rules ac97ac44: 3% source gap) | - | none |
| O-038 | 11-06 | Q8 | Price sources hourly or faster only | claude2 | landed main (Oct; fx staleAfterMs 1 h) | - | none |
| O-039 | 11-06 | Q34 | Users never see which source was used | claude2 | landed main (owner-only price health) | - | none |
| O-040 | 11-06 | Q35 | Owner notification when a currency drops or returns; it returns to the dropdown automatically | claude3 | landed main (owner alerts price-source-*); staff-site notifications list not started | NOT DRAWN | build owner notifications on staff site |
| O-041 | 11-07 | Q9; F12 | As many currencies as possible; launch with the 45; never sanctioned currencies; check the 45 too, including RUB | claude2 | landed main (45, unverified) | - | audit the 45 for sanctioned currencies (RUB first) |
| O-042 | 10-23 | HO 10-23 | Three keyless Tor-reachable XMR price sources, median; pause when stale > 5 min or disagreeing | claude2 | landed main (Oct) | - | none |
| O-043 | 10-24 | HO 10-23 | Every currency priced: XMR/USD median x FX from 3 keyless sources in fixed trust order | claude2 | landed main (Oct) | - | none |
| O-044 | 11-06 | Q13 | Price-health page moves to the staff site | claude3 | in flight wip/second-staff-pages 20a73d24 (J-21, claude2, in progress) | NOT DRAWN | finish, review, land |
| O-045 | 10-15 | HO Payment methods | No risk ratings; currency matching from live offers; sort Most buyers/Best rate/A-Z; Haveno-seeded list | claude2 | landed main (Oct) | - | none |
| O-046 | 10-17 | HO Open decisions 8 | Badge requirements shown openly on the Post an offer form | claude2 | landed main (Oct) | - | none |
| O-047 | 10-29 | HO 29b design-reported | Method price adjustment is a percent; a method outside the buyer's amount is greyed out with the reason | claude2 | in flight wip/lead-flex-launch-4 43333a3a (review CHANGES REQUESTED, fixes running; batch 5; J-16 flexible offers) | - | land batch 5 |
| O-048 | 10-29 | 28OCT lead calls | Task 4's 3/20 caps stay until flexible offers land | lead | superseded by O-025 | - | none |
| O-049 | 11-08 | p11-6 | Most anyone can trade at once, first months: $5,000 | lead helper | in flight wip/lead-flex-launch-4 43333a3a (review CHANGES REQUESTED, fixes running; batch 5; launch rules: $5,000 cap, time to pay per method, dispute before I've paid; owner p11-53..56, p11-95, p11-124, p11-126 pending) | NOT DRAWN | land batch 5 |
| O-050 | 10-24 | HO Badges | Starter limits $200 / $1,000 / no cap by trades and days; owner can change | claude2 | landed main (Oct) | - | none |
| O-051 | 11-06 | Q21 | Whether a member who can't manage offers sees instructions is decided by the granular options | lead helper | not started (J-10 landed d421706c; the instruction visibility is the catalogue ability offers-edit-methods, not built) | - | build with the ability |
| O-052 | 11-07 | F12 | After launch add the currencies that both Coinbase and BitPay quote | claude2 | not started | - | after launch, check sanctions first |
| O-053 | 11-08 | prototype comments 8 Nov | Browse: the method on the "Zelle · N buyers" card becomes a dropdown of every method with live offers in the currency | lead helper | landed main c85dffe9 (ac907739) | - | none |
| O-054 | 11-08 | prototype comments 8 Nov | Quote screen carries the offer's buyer bands and where the amount clips; keep the Max button | lead helper | landed main d421706c (batch 4; results-port / quote-bands) | - | none |
| O-055 | 11-08 | prototype comments 8 Nov | Range boxes have an XMR / currency switch (default XMR, selected unit bold orange); fiat ranges still sell XMR; cards show both rows with markup; search box "Display amounts including vendor markup"; quote carries it | lead helper | landed main 22b379e8 (batch 2) | - | none |

## 3. Disputes, moderators and staff

| id | date | source | rule | owner | status | design | next action |
|---|---|---|---|---|---|---|---|
| D-001 | 10-28 | 28OCT Q1; C3 Q5a | Disputes settled within 48 h, goal 24 h or less | claude3 | landed main 58f3d186 (batch 3; T11 on main; unverified that the 48 h and 24 h timers are all coded) | - | verify timers |
| D-002 | 11-06 | Q38 | Filing a dispute shows an hourglass counting down from 24 h ("the maximum before a moderator steps in; usually quicker"); 48 h part later | claude3 | landed main d421706c (batch 4; hourglass line on dispute open and room; unverified 24 h wording) | PARTLY | verify wording |
| D-003 | 10-28 | 28OCT APPEALS | Appeal CTA with 72 h deadline, File appeal button on completed list and trade page | claude3 | superseded by D-004 | - | none |
| D-004 | 10-29 | 28OCT 13:34; R40 | Appeal window 48 h everywhere | claude3 | landed main (Oct; appeal_until) | CONFLICT | design: Appeal-Notice/DisputeRuling boards show 72 h: redraw |
| D-005 | 10-28 | 28OCT APPEALS | File appeal button on completed-trades list and the trade page; disappears at the deadline | claude3 | not started (unverified) | PARTLY | design adds to MyTrades; build in Plan 4 |
| D-006 | 10-28 | 28OCT APPEALS outcome | Won appeal fixes the record and liens the other account until it repays the loss (trade's XMR) through a repayment trade; system lifts the lien | claude3 | not started (Plan 4 Tasks 24-25) | - | build Plan 4 appeals |
| D-007 | 10-28 | 28OCT; R37 | Appeals decided by a senior moderator or the owner; nobody involved in the dispute may take part (enforced in code) | claude3 | landed main (Oct; R37) | - | none |
| D-008 | 10-29 | 28OCT 12:54; R40 | Losing a dispute that requires restitution: immediate lien; lifted while an appeal is pending; outcome decides; overturn liens whoever got the coins | claude3 | not started (Plan 4 Task 25) | - | build |
| D-009 | 11-06 | Q37 | Money moves at once after a ruling; a lien covers a reversal | claude3 | not started (NEEDS_PLAN_4_RULING_PAYOUT) | - | Plan 4 ruling payout + RulingKind |
| D-010 | 11-03 | C3 Q5 | One appeal only, filed within 48 h of the ruling, decided within ~48 h, final | claude3 | not started (Plan 4) | - | build with D-006 |
| D-011 | 10-29 | 28OCT lead call | No eligible appeal reviewer: appeal waits, owner alerted, trader told | lead | not started | - | lead default (confirm) |
| D-012 | 10-29 | 28OCT lead call | Plan 4 A1 (hold payout until appeal window closes) dropped; coins move at the ruling | lead | landed main (decision) | - | none |
| D-013 | 11-02 | 2NOV-l 07:58 | Open disputes never block trading; a mod freezes trading only when a party ignores the dispute ~48 h or a ruling; no end time; mod writes what to do | claude3 | not started (Plan 4; trading hold exists on main, trigger rules unverified) | - | verify freeze is a separate later action; build in staff tools |
| D-014 | 11-02 | 2NOV-l 07:59 | Once done, the person messages the mods in the dispute; mods verify and lift the freeze | claude3 | not started (Plan 4; trading hold exists on main, trigger rules unverified) | - | with D-013 |
| D-015 | 11-02 | 2NOV-l 08:12 | Freeze is a separate later action, never an option on the ruling card | claude3 | not started (Plan 4; trading hold exists on main, trigger rules unverified) | - | with D-013 |
| D-016 | 11-06 | Q39 | Frozen-account message: "A moderator has frozen your account. Open your dispute to see what you need to do..." (design words) | design | landed main d421706c (batch 4; AccountFrozen screen only; the frozen state is not wired until J-14 lands) | PARTLY | wire with J-14 |
| D-017 | 11-06 | Q15 | Bans: pre-written rule list later; mod picks length for now; scamming can be lifetime at once; 3rd offence lifetime | claude3 | landed main (Oct; mod-chosen length, unverified); rule list not started | - | write the ban rule list with owner later |
| D-018 | 10-28 | 28OCT Q8 | Staff bans: trade ban; timed site ban with exact reinstate time, auto reinstate, contact link | claude3 | landed main (Oct; Task 27, unverified) | - | none |
| D-019 | 10-29 | 28OCT 08:03 a | Bans show a simple general reason and the end date | claude3 | landed main (Oct, unverified) | - | none |
| D-020 | 11-07 | G39 | Ban notice: "We're sorry, but your account has been banned. If you feel this has been done in error, reach out to a moderator at [Matrix] [Telegram]..." (design words) | design | not started | - | design words it; addresses wait on W-016 |
| D-021 | 11-06 | Q79 | No look-alike name bans | claude2 | landed main (no such check exists) | - | none |
| D-022 | 11-07 | G27 | Banning a vendor also bans its team members' entries | claude2 | landed main 22b379e8 (batch 2) | - | none |
| D-023 | 11-06 | Q51; G3 | Moderators hold a security key, a PGP key and a passkey; a new device needs 2 of 3; an existing device 1 | claude3 | superseded by D-070 (p11-19: security key optional for a moderator with username + password + PGP + passkey); invite all-three on wip/third-p4-task16 169fa1d6 must change | CONFLICT | none |
| D-024 | 11-06 | Q52 | Owner always uses one of his two security keys for serious actions | claude3 | landed main 22b379e8 (batch 2) | PARTLY | none |
| D-025 | 11-07 | G4 | Every security-key use is a tap; owner-account changes (e.g. changing a key) need both owner keys | claude3 | landed main 22b379e8 (batch 2) | NOT DRAWN | none |
| D-026 | 11-06 | Q55 | Site isn't live until the owner activates with both security keys | claude3 | landed main 58f3d186 (batch 3; staff-web T16 169fa1d6) | PARTLY | none |
| D-027 | 11-06 | Q54 | Username = private login name, never shown; display name = public | claude3 | landed main 58f3d186 (batch 3; staff-web T16 169fa1d6) | CONFLICT | none |
| D-028 | 11-06 | Q59 | Owner's PGP key mandatory; owner logs in only with PGP key + security key | claude3 | landed main 58f3d186 (batch 3; staff-web T16 169fa1d6) | PARTLY | none |
| D-029 | 11-07 | p4-4 | Owner backup login: one security key is enough (its PIN also needed); owner also uses passkeys, PGP and a recovery key | claude3 | waiting on owner p11-69 (how he gets back in if one key is lost) | - | owner p11-69 |
| D-030 | 11-07 | G59 | Owner who loses every PGP key gets back in with one of his two backup security keys | claude3 | waiting on owner p11-69 (how he gets back in if one key is lost) | - | owner p11-69 |
| D-031 | 11-06 | Q56 | Removing staff is permanent; plus an on/off switch and login days/hours | claude3 | landed main 58f3d186 (batch 3; staff-web T16 169fa1d6) | PARTLY | none |
| D-032 | 11-07 | G60 | Moderator who loses the only key: recovery code, else owner vets and resets (gives username + password, then they add methods) | claude3 | not started | - | build owner reset of staff security |
| D-033 | 11-07 | G35 | Every action is auditable, including a moderator ending/extending a hold | claude3 | landed main d421706c (batch 4; hold v3 + team-perms-port cba502d2) | - | none |
| D-034 | 11-07 | G37 | Incident ID 8-9 characters, shown at the top of the trade to both parties and to the moderator; acceptance logged with times | claude3 | landed main 58f3d186 (batch 3; disputes T11 ca356ce7) | PARTLY | none |
| D-035 | 11-07 | G18 | Every staff login-method use is in the owner's audit log; structure TBD | claude3 | waiting on owner p12-7, p12-8, p12-11 | - | after page 12 |
| D-036 | 11-06 | Q60 | Moderator and helper permissions granular; senior always has feedback | claude3 | in flight wip/second-staff-pages 20a73d24 (J-21, claude2, in progress) | NOT DRAWN | finish, review, land |
| D-037 | 11-03 | C3 Q19; Q13 | Staff have two separate logins (trader and staff); staff and owner refused on the trader site | claude3 | landed main (third-p4-staff-trader-split in main) | NOT DRAWN | design draws the refusal state on Login |
| D-038 | 11-03 | C3 Q19a | Admin, mods, vendors may be logged in on several computers; new device needs approval from a logged-in one | claude2 | landed main (Oct; device approval) | - | none |
| D-039 | 11-07 | Q58; F17 | Moderator-entered imported amount: hard cap 100,000 USD, shown converted to XMR | claude3 | landed main (MAX_VERIFIED_USD_CENTS 100,000) ; XMR display unverified | NOT DRAWN | verify XMR equivalent shown; design draws mod field |
| D-040 | 11-03 | C3 Q9 | Senior moderators and the owner enter the verified past-rep figure (maybe all mods later) | claude3 | landed main (third-p5-past-rep in main, unverified) | - | verify role check |
| D-041 | 10-30 | 29OCT-lc q5/q6 | Staff pay per completed dispute, calculated at logout since the last paid logout; transparent total + thank-you; pick a pre-approved address; adding one needs strong security | claude3 | not started (Plan 4 Task 33) | NOT DRAWN | design draws clock-out sheet; build |
| D-042 | 10-30 | 29OCT-lc q6 | For now pay is per completed dispute only (no hourly); pay kinds stay extensible; revisit staff work kinds | claude3 | not started | - | with D-041 |
| D-043 | 10-29 | 28OCT 13:07 | Seniors: pay per dispute + % of large-trade revenue (threshold TBD); bonus set aside when the dispute completes | claude3 | not started | - | with D-041; owner sets numbers later |
| D-044 | 10-29 | 28OCT 13:24; R43 | Clawback option A: pay goes out at clock-out; an overruled decision reduces future pay (owed if they leave) | claude3 | not started | CONFLICT | design: remove "hold the bonus 48 h" option from StaffSettings |
| D-045 | 10-29 | 28OCT 13:07 | Clock-out required; closing the app is no clock-out; auto-logout recorded as information; profile reminds staff | claude3 | not started | - | with D-041 |
| D-046 | 10-29 | 28OCT 13:07 | First staff login explains position, pay and the appeal/clawback risk | design | not started | NOT DRAWN | design draws first-login welcome (can share the p11-14 signing step) |
| D-047 | 10-29 | 28OCT 13:07 | "Appellate judge" positions maybe later | owner-pending | waiting on owner (idea) | - | none now |
| D-048 | 10-28 | 28OCT Q16; R38 | A settled dispute counts as completed; no automatic stage drop; mod may recommend limits to a senior | claude3 | landed main (Oct) | - | none |
| D-049 | 10-29 | 28OCT 13:12 Profile | Profiles show "Disputes: N won, M lost" | claude3 | in flight wip/second-staff-pages 20a73d24 (J-21, claude2, in progress) | - | finish, review, land |
| D-050 | 10-15 | HO Moderators | Roles owner / moderator / helper; owner co-approves rulings above the large-trade limit | claude3 | landed main d421706c (batch 4; staff roles 202/209; owner co-approval above the limit waits on Plan 4 Task 12, unverified) | - | with D-006 |
| D-051 | 10-17 | HO Moderators | Staff log in with two factors; idle 2 h; 12 h max | claude3 | superseded by D-023 | - | none |
| D-052 | 10-17 | HO Moderators; HO 10-20 | Owner logs in with YubiKey 5 fw 5.7+ and PGP; violet "X2F Moderator" badge only in disputed rooms | claude3 | landed main (Oct; allowlists, ModeratorTag) | - | none |
| D-053 | 10-28 | 28OCT Q12, Q13 | Titan v2 only; YubiKey Bio allowed for staff | claude3 | landed main (Oct; fido-mds allowlists) | - | none |
| D-054 | 10-28 | 28OCT Q9 | Support tickets in categories + "Everything else"; owner picks which staff get ticket access | claude3 | in flight wip/second-support-tickets 3a438934 (J-14 READY, re-verified PASS; lead requires J6 sealing before landing; owner p11-78..80 pending) | - | J6 sealing, then land |
| D-055 | 11-03 | C3 Q1a | One open ticket per person until it is resolved | claude3 | in flight wip/second-support-tickets 3a438934 (J-14 READY, re-verified PASS; lead requires J6 sealing before landing; owner p11-78..80 pending) | - | J6 sealing, then land |
| D-056 | 11-06 | Q67 | Feedback and tickets max 10 a day, with an anti-spam explanation (design words) | claude3 | landed main (feedback FEEDBACK_FORM_DAILY 10); tickets not started | PARTLY | add ticket limit + Support limit state |
| D-057 | 11-06 | Q69 | Tickets shared across a team; feedback per member | claude3 | in flight wip/second-support-tickets 3a438934 (J-14 READY, re-verified PASS; lead requires J6 sealing before landing; owner p11-78..80 pending) | PARTLY | J6 sealing, then land |
| D-058 | 11-07 | G20 | Named feedback is the sender's choice (checkbox); named shows the account so staff can follow up | claude3 | landed main (trader side); staff list not started | NOT DRAWN | build staff feedback list showing the account |
| D-059 | 10-30 | 30OCT-lw 11:00, 11:20, 11:50 | "My account has been compromised" ticket: username + any credentials + comment; account frozen at once (full lockout); open trades paused; staff talk on Matrix/Jabber | claude3 | in flight wip/second-support-tickets 3a438934 (J-14 READY, re-verified PASS; lead requires J6 sealing before landing; owner p11-78..80 pending) | - | J6 sealing, then land |
| D-060 | 11-07 | G63 | Full reversal: no 1% fee, mod still paid; ruling that moves the trade forward: poster pays; appeal ending in completion or a lien: 1% paid | claude2 | not started (stale branch wip/second-api-cap-dispute 5f3d944b carries superseded g66) | - | cherry-pick a99af200 only; design explains it |
| D-061 | 10-29 | 28OCT 13:12; R41 | The 1% is not refunded on disputed trades (X2F's service was used) | claude2 | landed main (Oct) | - | none |
| D-062 | 10-29 | 28OCT 13:45; R41 | Loser with no escrow money still owes 1% of the trade; deducted from future trades; ruling screen says so | claude3 | not started (Plan 4) | - | build; lead default: taken from next settled trades |
| D-063 | 10-30 | 29OCT-lc q8 | Lien includes the unpaid fee only if the lien holder owed it; the repayment trade adds no fee | claude3 | not started | - | with D-006 |
| D-064 | 11-01 | 30OCT-lw N51 | Staff who reach the owner on the secure Jabber channel may end a recovery hold | claude3 | not started | - | Plan 4 staff tools |
| D-065 | 11-07 | F19; Q62 | Owner's staff menu: show screenshots when Task 16 is ready | lead | landed main 58f3d186 (batch 3; staff-web T16 169fa1d6) | - | none |
| D-066 | 11-08 | p7-7 | Only trade parties open disputes; team members with dispute access may see everything and answer the moderator | lead helper | landed main d421706c (batch 4; team-perms-port cba502d2: abilities catalogue) | - | none |
| D-067 | 10-29 | 28OCT lead call | Moderator contact link setting takes Matrix or Telegram (Matrix preferred) | lead | not started (unverified) | - | lead default (confirm) |
| D-068 | 11-08 | lead decision (T11 review I-2) | Moderator chat sending dev-only until the chat key design is built | lead | landed main 58f3d186 (batch 3; disputes T11 ca356ce7) | - | none |
| D-069 | 11-08 | p9-5 | In a dispute both parties must cooperate with the moderator's questions or risk a ruling against them | design | landed main d421706c (batch 4; trade-copy e47e8e43) | - | none |
| D-070 | 11-09 | p11-19 (changes Q51, G3) | A moderator may log in with username, password, PGP key and passkey and have no security key; synced passkeys stay allowed (no hardware-only rule) | claude3 | not started | CONFLICT | change third-p4-task16 invite all-three; lead confirms the 2-of-3 new-device rule when the key is absent; design redraws the staff invite card |
| D-071 | 11-09 | p11-37 | Dispute room between the seller's cancel and the refund landing: "The seller has cancelled this trade. XMR has begun refunding back to their wallet", with confirmations n/10 (replaces "Locked in escrow") | design | not started | - | design words it; claude3 builds in the dispute room |

## 4. Accounts, logins, holds, sessions, teams

| id | date | source | rule | owner | status | design | next action |
|---|---|---|---|---|---|---|---|
| S-001 | 10-30 | 30OCT-lw; G6 | Every account creates a unique username (private login) and a unique display name; password optional | claude2 | landed main d421706c (batch 4; signup-team 08d96d4d) | - | none |
| S-002 | 10-30 | 30OCT-lw | Logging in always needs the username; the display name is never a login | claude2 | landed main (Oct) | - | none |
| S-003 | 10-29 | 28OCT 08:03 f; HO | Usernames 5-20 chars; deleted usernames burned forever | claude2 | landed main (Oct) | - | none |
| S-004 | 10-29 | 28OCT 14:12; R42 | Every account has two factors; no-wait combos: pw+TOTP, pw+passkey/key, PGP+passkey/key, passkey/key alone | claude2 | superseded by S-008 | - | none |
| S-005 | 10-30 | 30OCT-lw 11:50 | Strong = any 2 factors only; a passkey or key alone still waits | claude2 | superseded by S-008 | - | none |
| S-006 | 11-01 | 30OCT-lw 1 Nov 09:03 | Strong = username+password + (passkey / key / PGP) | claude2 | superseded by S-008 | - | none |
| S-007 | 11-01 | 30OCT-lw 1 Nov 09:10 | No password + passkey/key = weak | claude2 | superseded by S-008 | - | none |
| S-008 | 11-01 | 30OCT-lw 1 Nov 10:30 | Strength table: user+pass WEAK; user+pass+any of passkey/key/PGP/TOTP STRONG; 2+ = "Armored vault"; user+passkey/key/PGP no password STRONG; recovery code not a login | claude2 | landed main d421706c (batch 4; hold v3 + team-perms-port cba502d2) | - | none |
| S-009 | 11-07 | G6 | Username + PGP key (+ display name) is strong | claude2 | landed main d421706c (batch 4; hold v3 + team-perms-port cba502d2) | - | none |
| S-010 | 11-06 | Q81 | A username + PGP login counts as strong: no hold | claude2 | landed main d421706c (batch 4; hold v3 + team-perms-port cba502d2) | - | none |
| S-011 | 11-07 | G34 | Username + password + TOTP (+ display name) is strong | claude2 | landed main d421706c (batch 4; hold v3 + team-perms-port cba502d2) | CONFLICT | none |
| S-012 | 11-01 | 30OCT-lw N1/N4 | Username + authenticator code alone is NOT allowed; no Medium tier | claude2 | landed main d421706c (batch 4; signup-rules 7bd9532a) | - | none |
| S-013 | 11-01 | 30OCT-lw N2 | Username-only accounts not allowed | claude2 | landed main d421706c (batch 4; signup-rules 7bd9532a) | - | none |
| S-014 | 11-01 | 30OCT-lw 10:45 | Strong passwords enforced at signup with a live meter; only "strong" accepted (design words) | claude2 | landed main d421706c (batch 4; signup-rules 7bd9532a) | - | none |
| S-015 | 11-01 | 30OCT-lw 09:10 | At signup a strength chart shows where the chosen methods stand; confirm to continue; owner's draft copy per row | design | not started | - | design words chart; build |
| S-016 | 11-01 | 30OCT-lw 11:00 | Recovery code is not a login combo; everyone should have one, stored apart from every method (humour ok) | claude2 | landed main d421706c (batch 4; signup-team 08d96d4d) | - | none |
| S-017 | 11-01 | 30OCT-lw 11:05 | Recovery code required at signup: tick "I've written it down", then type it back | claude2 | landed main d421706c (batch 4; signup-rules 7bd9532a) | - | none |
| S-018 | 11-01 | 30OCT-lw 16:30 Q4 | ONE 16-char recovery code; after use remind the lead at next login to write the new code | claude2 | landed main (unverified) | - | check against S-019 format; p11-36 (S-111): person generates the new code in security settings: confirm flow |
| S-019 | 11-07 | G32 | Recovery code = emergency login only; very long or ~5 mnemonic words; does not overwrite user/pass or the 24 h hold; for team lead or moderator only | claude2 | landed main d421706c (batch 4; signup-rules 7bd9532a) | CONFLICT | none |
| S-020 | 10-31 | 30OCT-lw 31 Oct 00:45 | Recovery login = username + code; 24 h hold on everything; trading delayed except trades in motion | claude2 | landed main (Oct, unverified) | - | none |
| S-021 | 10-31 | 30OCT-lw 00:45 | During a recovery hold the person may add/upgrade 2FA | claude2 | superseded by S-023 | - | none |
| S-022 | 10-31 | 30OCT-lw 00:55 | Held trader's offers simply hidden; recovery hold always 24 h; other devices notified and can block | claude2 | landed main (Oct, unverified) | - | none |
| S-023 | 11-01 | 30OCT-lw N52-N54 | No methods (incl. PGP) can be added during a recovery hold unless a strong login ends it first | claude2 | landed main d421706c (batch 4; hold v3 + team-perms-port cba502d2) | - | none |
| S-024 | 11-01 | 30OCT-lw N51 | A strong login (re-proving pre-hold methods) ends a recovery hold early | claude2 | landed main (Oct; R42) | - | none |
| S-025 | 11-01 | 30OCT-lw N50 | Message for a recovery-session change attempt ("a 24 h hold... security team reviews... Matrix/Telegram... Jabber") (design words) | design | not started | - | design words; addresses W-016 |
| S-026 | 11-01 | 30OCT-lw N55 | During a recovery hold contact only via Matrix/Telegram/secure Jabber | claude2 | not started | - | confirm trades in motion with owner |
| S-027 | 11-01 | 30OCT-lw N56 | Hide offers during every hold ("you are considered offline to everyone") | claude2 | superseded by S-106 for weak-login holds (p11-26: everything else works as normal); recovery hold to confirm | - | lead confirms whether S-106 also covers the recovery hold |
| S-028 | 11-01 | 30OCT-lw N60 | A method added is kept if saved before the session ends and not in the hold | claude2 | landed main (Oct, unverified) | - | none |
| S-029 | 11-01 | 30OCT-lw | Recovery codes only for the account owner (team lead), never members | claude2 | superseded by S-108 (p11-28: members get their own recovery codes) | - | none |
| S-030 | 11-01 | 30OCT-lw 17:00 #1 | A username+password session changing login methods or payout wallets triggers the 24 h hold; pop-up recommends stronger security | claude2 | landed main (Oct; hold v2) | - | none |
| S-031 | 11-01 | 30OCT-lw 17:00 #2,#7 | Lead's new device: "is this you?" on a logged-in device; device approval is for the lead only | claude2 | landed main (Oct) | - | none |
| S-032 | 11-01 | 30OCT-lw 17:00 #4 | When a hold triggers, everyone on the account is logged out | claude2 | superseded by S-035 | - | none |
| S-033 | 11-01 | 30OCT-lw 17:00 #5 | Hold ends by the lead's own strong methods or after 24 h; a mod can extend it or vet the lead back in | claude2 | landed main (Oct; mod extend in Plan 4 unverified) | - | none |
| S-034 | 11-01 | 30OCT-lw 17:00 #9 | Weak changes take effect only after the hold; if the lead ends it early they are discarded | claude2 | superseded by S-046 | - | none |
| S-035 | 11-07 | G8 | A held account can stay logged in and extend its session; hold strongly recommends upgrading security | claude2 | landed main d421706c (batch 4; hold v3 + team-perms-port cba502d2) | - | none |
| S-036 | 11-07 | G5 | Weak removal of a wallet or member: wallet unusable / member access removed at once; deleted after 24 h | claude2 | superseded by S-055 | - | p11-23 not answered as asked (9 Nov): re-ask; p11-26 (S-106) says a hold holds only the changes made |
| S-037 | 11-07 | G10 | A username+password account may extend its session with username + password | claude2 | landed main 22b379e8 (batch 2) | - | none |
| S-038 | 11-07 | G13 | A vendor can't remove its only strong method; it must swap it for another strong one | claude2 | landed main 22b379e8 (batch 2) | NOT DRAWN | verify refusal; design draws it |
| S-039 | 11-07 | G14 | Auto-closed account: may reuse keys on a new account; needs new username and display name | claude2 | landed main 22b379e8 (batch 2) | - | none |
| S-040 | 11-07 | G26 | Anyone may apply to be a vendor, even a beginner (needs passkey/key/PGP only) | claude2 | landed main 22b379e8 (batch 2) | PARTLY | none |
| S-041 | 11-06 | Q77 | Account not logged into for 60 days closes automatically; to become a trader, open a new account | claude2 | landed main 22b379e8 (batch 2) | CONFLICT | none |
| S-042 | 11-07 | p4-5 | Fine to pause the 60-day countdown while trades are open (they'll log in anyway) | claude2 | landed main 22b379e8 (batch 2) | - | none |
| S-043 | 11-07 | p4-6 | No warning notice before the 60-day close; explain the rule clearly at signup / in the rules list ("X2F is for active traders"); revisit if users complain | design | landed main d421706c (batch 4; Terms key point (60 days) in SetupTerms) | - | none |
| S-044 | 11-07 | G11, G12 | "Remind me what the 60-day auto-close is" | lead | superseded by S-042, S-043 | - | none |
| S-045 | 11-07 | G28 | Which changes queue for 24 h: discuss with the lead | lead | waiting on owner G28 (lead to discuss) | - | lead puts the hold-trigger list on a page |
| S-046 | 11-07 | G58 | A strong lead sees pending weak changes before/after with a countdown and can approve now, cancel all or edit | claude2 | landed main d421706c (batch 4; hold v3 + team-perms-port cba502d2) | - | none |
| S-047 | 11-07 | G29 | Tally all changes (one screen or a final list) with before/after view; weak users told submit starts 24 h; serious ones act at once but become permanent at 24 h; strong users see the same view, instant | claude2 | landed main d421706c (batch 4; hold v3 + team-perms-port cba502d2) | - | none |
| S-048 | 11-07 | G36 | At most 20 waiting changes per account | claude2 | landed main d421706c (batch 4; hold v3 + team-perms-port cba502d2) | - | none |
| S-049 | 11-07 | G64 | Weak lead changing a login method: new credentials take effect only after 24 h; the real owner can still log in and kick the thief | claude2 | landed main d421706c (batch 4; hold v3 + team-perms-port cba502d2) | - | none |
| S-050 | 11-07 | G65 | Cancel all changes with one button, or uncheck individual ones | claude2 | landed main d421706c (batch 4; hold v3 + team-perms-port cba502d2) | - | none |
| S-051 | 11-07 | G57 | Only the team lead kicks out members; weak kick = immediate, deletion after 24 h; other weak member changes wait 24 h | claude2 | landed main d421706c (batch 4; hold v3 + team-perms-port cba502d2) | CONFLICT | none |
| S-052 | 11-07 | G31 | Team members can't see or cancel the lead's waiting changes (built) | claude2 | landed main (built per the page; unverified sha) | - | none |
| S-053 | 11-07 | p4-8 | Members' login strength capped at the lead's (the strength cap only) | claude2 | superseded by S-054 | - | none |
| S-054 | 11-08 | p7-9 | Members may use any login method; if the lead is weak the 24 h hold applies even to strong members' changes | lead helper | landed main d421706c (batch 4; signup-team / team-perms; unverified that API join no longer needs two strong factors) | - | verify join with a weak member login |
| S-055 | 11-08 | p5-7 | Weak logins: 24 h hold for every important change (account, team, wallet/cash-out), removals included, so nothing applies early; the same lead may log back in and undo some or all | claude2 | landed main d421706c (batch 4; hold v3 + team-perms-port cba502d2) | - | none |
| S-056 | 11-08 | p5-7 | With secure Jabber set up, every account change sends a discreet notice that doesn't say what | lead helper | landed main d421706c (batch 4; jabber-notices 5d2b6e61, dark until OMEMO lights) | - | light with OMEMO (batch 5) |
| S-057 | 11-06 | Q14 | Changes after the 24 h apply on their own; always say "username and password", never "password only" | claude2 | landed main d421706c (batch 4; hold v3 + team-perms-port cba502d2) | - | none |
| S-058 | 10-30 | 30OCT-lw 11:50 | During a 24 h hold block all team changes (invites, roles, removals wait) | claude2 | superseded by S-036, S-051 | - | none |
| S-059 | 11-01 | 30OCT-lw 08:49 #48 | Removing a member during a hold is queued until the hold ends | claude2 | superseded by S-036 | - | none |
| S-060 | 11-01 | 30OCT-lw 47 | Invites / role grants need a strong login; password-only gets "not allowed" | claude2 | superseded by S-104 (p11-21: weak-login invite goes through, member settings apply after 24 h); hold-v3 561af62c still refuses it | - | none |
| S-061 | 11-06 | Q73 | 5-min warning before the session ends; extend for the same durations with your own login methods; members too | claude2 | landed main 22b379e8 (batch 2) | - | none |
| S-062 | 11-02 | 2NOV-l 08:12 | "Stay logged in?" prompt 2 minutes | claude2 | superseded by S-061 | - | none |
| S-063 | 11-06 | Q75 | Optional idle reminder in personal settings: on/off and its own interval | claude2 | landed main 22b379e8 (batch 2) | NOT DRAWN | none |
| S-064 | 11-07 | G23 | Session length drop-down, nothing preselected: trader 2/4/8/12 h, vendor 2/6/12/24 h | claude2 | landed main 22b379e8 (batch 2) | PARTLY | none |
| S-065 | 11-07 | G24 | A newly chosen length starts now (3 h into 6 h + 6 h = 6 h from now) | claude2 | landed main 22b379e8 (batch 2) | - | none |
| S-066 | 11-07 | G25 | After signup go back to the login screen; log in to test; then pick session length | claude2 | landed main 22b379e8 (batch 2) | - | none |
| S-067 | 11-07 | G9 | Extending a session sends no alert | claude2 | landed main 22b379e8 (batch 2) | - | none |
| S-068 | 11-07 | F18; Q71 | Changing session length on Devices changes this session only | claude2 | landed main 22b379e8 (batch 2) | - | none |
| S-069 | 11-01 | 30OCT-lw | Trader sessions 2-12 h; "30 days is ridiculous" | claude2 | superseded by S-064 | - | none |
| S-070 | 11-01 | 30OCT-lw N3 | Session absolute max 24 h | claude2 | superseded by S-061 | - | lead reading: extensions have no fixed max now; owner to confirm |
| S-071 | 11-01 | 30OCT-lw 16:30 Q7 | Idle logout choices 2/4/6/12 h for non-vendors | claude2 | superseded by S-064 | - | none |
| S-072 | 10-23 | Security.tsx (owner 10-23) | Inactivity logout timer 2-12 h | claude2 | superseded by S-063 | - | sessions branch drops idle_hours |
| S-073 | 10-29 | 28OCT 07:59; HO 29b | New device must be approved/blocked from a logged-in device, number matching; max 3 devices; "One device at a time" option | claude2 | landed main (Oct) | - | none |
| S-074 | 10-29 | 28OCT 13:23 | Weak way + no device to approve = 24 h; real owner learns of a thief via approval prompt, push/Jabber alerts, Devices list | claude2 | landed main (Oct; R42) | - | none |
| S-075 | 11-08 | p11-4 | Full abilities on every extra device logged in strongly; approve a new login from a notification on a logged-in device, no 24 h; a Jabber-worthy notification | lead helper | in flight wip/lead-multi-device 9154196b (design note only; build waits on p12-5, owner p11-100..107) | PARTLY | owner p12-5 |
| S-076 | 10-28 | 28OCT Q7 | Delete my account, blocked while a trade or dispute is open | claude2 | landed main (Oct) | - | none |
| S-077 | 10-29 | HO 29b design-reported | Deleted accounts keep trade and dispute records until their normal delete date | claude2 | landed main (Oct, unverified) | - | none |
| S-078 | 10-17 | HO Accounts | Terms screen first in setup: scroll, tick, accept; shown again when Terms change | claude2 | landed main (Oct) | - | none |
| S-079 | 11-06 | Q18 | Terms is a gate before step 1 ("of 5") | design | landed main (unverified) | - | none |
| S-080 | 10-17 | HO Accounts | PGP login first; RSA 4096+/Ed25519/Ed448; emails in keys never recorded; TOTP never the only login | claude2 | landed main (Oct) | - | none |
| S-081 | 10-17 | HO Accounts | A passkey counts as a backup, a password never | claude2 | superseded by S-016 | - | none |
| S-082 | 10-17 | HO Accounts | First wallet skips confirm; no trading or ads until a wallet is added | claude2 | landed main (Oct) | - | none |
| S-083 | 10-14 | HO Accounts | No sign-up form at the door; setup at the first Trade tap | claude2 | superseded by W-019 | - | none |
| S-084 | 10-30 | 30OCT-lw | A password-only user must still use two devices or move to a new one and kick the old | owner-pending | waiting on owner (design discussion never closed) | - | put on a page with the device rules |
| S-085 | 11-01 | 30OCT-lw | Device-bound sessions (non-copyable browser key) before mainnet | lead helper | not started | - | queue before mainnet |
| S-086 | 10-29 | 28OCT 13:41; R44 | Team members: up to 3; roles Offers and Trades; audit log for the owner; chat label "Message from Team <name> member: <member>" | claude2 | landed main (Oct; 015_team_members); chat label superseded by S-105 (p11-25) | CONFLICT | label: see S-105; design CONFLICT now resolved by a third rule (neither R44 nor design) |
| S-087 | 11-06 | Q16 | Granular teams: 3-4 member types, 7-10 boxes each, a member can be in several types | lead helper | landed main d421706c (batch 4; team-perms-port cba502d2: abilities catalogue) | PARTLY | none |
| S-088 | 10-29 | 28OCT 13:42 | Team members at launch if possible | lead | landed main d421706c (batch 4; team-perms-port cba502d2: abilities catalogue) | - | none |
| S-089 | 10-29 | 28OCT 13:58 | Team-member fee idea (tiered 1.1/1.2/1.3% or flat 1.15%), decide before launch | owner-pending | waiting on owner (before launch) | - | put on a page before launch |
| S-090 | 11-08 | p7-3 | Per-method detail boxes in the payer's chat side (e.g. Interac: name, email or phone); one click sends them packaged | lead helper | landed main d421706c (batch 4; J-08 pay-details 2b54fe67) | - | none |
| S-091 | 11-08 | p7-4 | Each member gets a trade-size band that limits everything they do | lead helper | in flight wip/second-team-limits d3053141 (J-20, READY, review next; first-login approval replaced by notice per p11-27) | - | review then land batch 5 |
| S-092 | 11-08 | p7-5 | Granular boxes; a "manager" preset ticks a recommended set that can be unticked | lead helper | landed main d421706c (batch 4; team-perms-port cba502d2: abilities catalogue) | - | none |
| S-093 | 11-08 | p7-6 | Block/unblock in one click; blocked list with optional notes and the date/time blocked | claude2 | landed main (Oct; block + list); notes and time not started | - | add notes + timestamp to Blocked |
| S-094 | 11-08 | p7-8 | Member boxes "can view notes on traders" and "can add notes" (logged, no delete) | lead helper | landed main d421706c (batch 4; team-perms-port cba502d2: abilities catalogue) | - | none |
| S-095 | 11-08 | p7-10 | Member logins: approve only the first login (design B); the granular boxes are the protection (no money on site) | lead helper | superseded by S-107 (p11-27: no first-login approval; notice + Jabber instead) | - | none |
| S-096 | 11-08 | p7-11 | Member hours: 24/7 or fine-tune days and hours | lead helper | in flight wip/second-team-limits d3053141 (J-20, READY, review next; first-login approval replaced by notice per p11-27) | - | review then land batch 5 |
| S-097 | 11-08 | p7-12 | The starting granular list is good; think of every one, leave the rest to feedback | lead helper | landed main d421706c (batch 4; team-perms-port cba502d2: abilities catalogue) | - | none |
| S-098 | 11-01 | 30OCT-lw 17:00 #8 | Lead approves every new team member; refusal removes the newcomer only | claude2 | landed main (Oct, unverified) | - | none |
| S-099 | 11-07 | G61 | "Holds off-limits to team members?" (owner asked what it means) | lead | superseded by S-053, S-054 | - | none |
| S-100 | 11-07 | G30 | "Example of a revoked session?" | lead | waiting on owner G30 (lead to re-ask with an example) | - | put on a page |
| S-101 | 10-30 | 30OCT-lw | Trust reset on owner proof: owner asked for a better explanation | lead | waiting on owner (re-ask) | - | put on a page |
| S-102 | 11-07 | p4-8 | Who can see, untick or cancel waiting changes, or end a hold, is a granular team permission; default only the lead acts; others just see a hold is on | lead helper | landed main d421706c (batch 4; hold v3 + team-perms-port cba502d2) | - | none |
| S-103 | 11-08 | prototype comments 8 Nov | Agree once at account opening (Terms, required tick box, tall wide signature pad; a scribble or X is fine); never per trade | lead helper | landed main d421706c (batch 4; terms-signature e07cb506 + staff invite Terms 3ff7ae47) | - | none |
| S-104 | 11-09 | p11-21 (changes 30OCT-lw 47) | A weak-login lead may invite: invite goes out, member accepts, lead notified (+ secure Jabber); lead sets and submits the member's settings, which take effect after 24 h | lead helper | not started (hold-v3 refuses today) | NOT DRAWN | replace the weak-invite refusal in hold-v3 with a 24 h hold on the member's settings; design draws it |
| S-105 | 11-09 | p11-25 (changes R44) | Team member's chat label = "<lead's display name> Assistant 1", "Assistant 2" (e.g. "Circa 55 Assistant 1"); the member's own name is not shown | lead helper | not started | CONFLICT | design redraws chat label; change label in code; lead updates R44 in rulings-and-lessons.md |
| S-106 | 11-09 | p11-26 | A 24 h hold holds only the changes being made; everything else works as normal; a member's weak login holds only that member's own changes; the team account never freezes because of a member | lead helper | landed main d421706c (batch 4; lead reading of p11-26 in routes/account.ts; unverified) | - | verify p11-26 reading with owner |
| S-107 | 11-09 | p11-27 | New team member's first login: no approval by the lead; the lead gets a notification and a secure Jabber notice when the member first logs in | lead helper | in flight wip/second-team-limits d3053141 (J-20, READY, review next; first-login approval replaced by notice per p11-27) | - | review then land batch 5 |
| S-108 | 11-09 | p11-28 | Team members get their own recovery codes | lead helper | not started | - | member join in signup-team; design adds the step to member setup |
| S-109 | 11-09 | p11-34 | A correct recovery code always gets in, even when logins are throttled | lead helper | not started (unverified on hold-v3) | - | check hold-v3 throttle path; build bypass for a correct code |
| S-110 | 11-09 | p11-35 | Password change with current password + new password + recovery code applies at once (no 24 h hold) | lead helper | not started | NOT DRAWN | build in hold-v3; design draws the option on the password change form |
| S-111 | 11-09 | p11-36 | After a recovery code is used: tell the person it is burned and to generate a new one in security settings | design | not started | - | design words the notice; lead confirms whether the new code is user-generated (vs made automatically, S-018) |

## 5. Chat and privacy

| id | date | source | rule | owner | status | design | next action |
|---|---|---|---|---|---|---|---|
| C-001 | 10-28 | 28OCT Q1; R36 | Undisputed trades self-destruct 30 days after they end; no user-chosen times, no early delete | lead helper | landed main b63e4c29 (chat retention, merge 0933a9ca) | - | none |
| C-002 | 10-28 | 28OCT Q1 | Disputed trades kept 90 days from the dispute button | lead helper | superseded by C-003 | - | none |
| C-003 | 11-08 | p11-11 | The 90 days count from the day the dispute closes | lead helper | landed main c0af884b | CONFLICT | design redraws timeline; docs R36, spec 4.1, Plan 4, migration 110, coordination M4 still say "from button" |
| C-004 | 10-27 | HO 10-27 | User-set message/trade self-delete times | lead | superseded by C-001 | - | none |
| C-005 | 10-17 | HO Moderators | Dispute records kept 30 days after close | lead | superseded by C-003 | - | none |
| C-006 | 10-17 | HO Moderators | Anonymized training copies kept 6 months | lead | superseded by C-015 | - | none |
| C-007 | 10-17 | HO Moderators | No IP addresses logged, even in disputes | lead | landed main (Oct) | - | none |
| C-008 | 10-27 | HO 10-27 | Chat encryption as is: mods read once a dispute opens; before that rules + audit log stop them | lead | superseded by C-010 | - | none |
| C-009 | 11-08 | p11-1 | No Matrix; build our own encryption | lead | landed main (Oct; libsodium chat) | - | none |
| C-010 | 11-08 | p11-2; p9-5 | One key per trade, members added like Windows permissions; a dispute adds the moderator (full history); seniors/owner per case; key filed with the dispute for an appeal | lead helper | landed main 58f3d186 (batch 3; chat-shred-2 7bbda3ab, tasks 1-2: one key per trade; staff and member key paths wait on p12-1..p12-11) | - | after page 12 answers: staff and member key paths |
| C-011 | 11-08 | p11-2 | Audit log of every message and button action with time stamps, for admins; destroyed at completion without dispute or 90 days after resolution | lead helper | waiting on owner p12-7, p12-8, p12-11 | - | after page 12 |
| C-012 | 11-08 | p11-3 | Completed trade's keys destroyed at the 48 h mark unless a dispute happens | lead helper | superseded by C-001 (p11-17: 30 days stands; his "48 h" was the dispute window, now 72 h: T-082) | - | none |
| C-013 | 11-08 | p11-9 | Terms say: completed trades destroyed on the 30th day; disputes kept up to 90 days (privacy-scrubbed, for training) | lead helper | landed main d421706c (batch 4; terms-signature e07cb506 + staff invite Terms 3ff7ae47) | - | none |
| C-014 | 11-08 | p11-10 | Purge is system-wide, including the trader's own devices | lead helper | landed main 58f3d186 (batch 3; chat-shred-2 7bbda3ab) | - | none |
| C-015 | 11-02 | C3 16:02 (Q6 retention) | Disputes kept 90 days with personal detail removed, dialogue intact; unedited proof kept 90 days for training | claude3 | waiting on owner p12-12 (where scrubbed training copies live; also p11-83 (does closes include appeals)) | - | owner p12-12 |
| C-016 | 11-08 | p11-5 | Revoking a removed staff member's chat access is logged ("any event is logged") | claude3 | waiting on owner p12-7, p12-8, p12-11 (audit log life, staff-wide log, who sees it) | PARTLY | owner p12-7/8/11 |
| C-017 | 11-03 | C3 09:51 Q6 | Once erased (30 days) no one can see a trade again; disputes 90 days for training | lead helper | landed main b63e4c29 | - | none |
| C-018 | 10-27 | HO Moderators | Users told in every chat that a moderator can read it in a dispute | lead | landed main (Oct) | - | public crypto spec must say "only after a dispute" is enforced by Plan 4 |
| C-019 | 11-08 | lead/design | Team chat must not ship before a team-member key path exists; hide team replies until then | lead | landed main d421706c (batch 4; team-perms-port cba502d2: abilities catalogue) | - | none |
| C-020 | 11-08 | owner-decisions 8 Nov chat retention | A dispute opened inside the 30 days stops the 30-day destruction | lead helper | landed main b63e4c29 | - | none |
| C-021 | 11-09 | p11-33 | When a device becomes active again (website, Android web app or app) it syncs first: every change is pushed before the user can act (a few seconds) | lead helper | not started | - | fold into chat-shred-2 device erase (C-014); marker keep time still open (Q-029) |

## 6. Reputation, reviews and proof

| id | date | source | rule | owner | status | design | next action |
|---|---|---|---|---|---|---|---|
| R-001 | 10-28 | 28OCT Ratings | All feedback permanent (survives the 30-day delete): comment, templated comments, badges, stars | claude3 | landed main (Oct; Plan 5) | - | none |
| R-002 | 10-29 | HO 29b | Stars 1-5 only | claude3 | landed main (Oct) | - | none |
| R-003 | 10-29 | 28OCT 08:03 c | A disputed review shows "Under review" at once until a mod removes comments, lets it stand or removes it | claude3 | landed main (Oct) | PARTLY | design: public Profile under-review state |
| R-004 | 10-29 | 28OCT 08:03 c | Reviews public but anonymous (no account or trade number) | claude3 | landed main (Oct) | - | none |
| R-005 | 11-01 | C3 item 26 | No dollar weighting; a review = stars + badges + pre-made or custom comment | claude3 | landed main (Oct-Nov) | - | none |
| R-006 | 11-01 | C3 item 28 | Offers reappear at once; "Skip review" option needed to clear the trade | claude3 | landed main | - | none |
| R-007 | 11-02 | 30OCT-lw 2 Nov 01:20 (1)(2) | Review shows once the trade is complete (no blind reveal); Skip shows nothing | claude3 | landed main | - | none |
| R-008 | 10-15 | HO Trade flow 8 | Required rating with blind reveal | claude3 | superseded by R-007 | - | none |
| R-009 | 11-02 | C3 C12 Q5; 30OCT-lw (4) | Skip is final; a skipped trade still counts as completed | claude3 | landed main | - | none |
| R-010 | 11-02 | C3 C12 Q6 | Overturned "like it never happened": feedback erased; ends normally: stays | claude3 | superseded by R-011 | - | none |
| R-011 | 11-06 | Q40 | Feedback follows the final outcome: reversed none; settled stays; appeal holds it, then the result decides | claude3 | not started (Plan 4 ruling hooks, unverified) | PARTLY | build with D-006; design adds lines to dispute boards |
| R-012 | 11-06 | Q41; C3 Q7 | Totals follow the final binding outcome | claude3 | not started (unverified) | - | build with R-011 |
| R-013 | 11-01 | C3 item 27 | Review time after the trade self-destructs: month and year | claude3 | landed main (unverified) | PARTLY | design adds a "Sep 2026" sample |
| R-014 | 11-01 | C3 item 31 | Pre-launch trades not in the please-rate list | claude3 | landed main | - | none |
| R-015 | 11-02 | 30OCT-lw 2 Nov 01:20 (3) | Optional "Completed over $X in trades" line, buy+sell, rounded steps | claude3 | superseded by R-017 | - | none |
| R-016 | 11-03 | C3 Q4 final | To earn a step you need MORE than it ($30,001 shows $30,000+) | claude3 | superseded by R-017 | - | lead to confirm whether steps apply to the XMR line |
| R-017 | 11-06 | Q63 | Offer card shows the amount traded to date in XMR, not dollars | claude3 | landed main (third-rep-owner-1106 in main) | - | design owns the XMR line wording |
| R-018 | 11-07 | G54 | "XMR traded to date" counts X2F trades only; imports stay on their own lines | claude3 | landed main (rep-owner-1106, unverified) | - | none |
| R-019 | 11-06 | Q64; C3 Q10 | Imported volume: a separate line per site with proof, with the site name, even with zero X2F trades | claude3 | landed main ("Imported from") | CONFLICT | design: FAQ says "separate badge": fix FAQ |
| R-020 | 11-07 | p4-1 | Imported volume shown in US dollars (universal currency) | claude3 | landed main (rep-owner-1106: imported volume in USD) | - | none |
| R-021 | 11-02 | C3 C12 Q7 | Volume line is a vendor setting: "Would you like to display total amount of trades to date (min $10,000)" | claude3 | landed main (unverified) | - | reword for XMR (R-017) via design |
| R-022 | 11-02 | 30OCT-lw (3); C3 Q3 | The $ line includes other sites if proven; wording "Over $90,000+" | claude3 | superseded by R-018 | - | none |
| R-023 | 11-02 | 2NOV-l 07:48; C3 Q8 | Imported LocalMonero volume via a moderator-verified $ field; counts only once approved | claude3 | landed main | - | none |
| R-024 | 10-17 | HO Badges | Past reputation badge via PGP signature on an archived profile, mod-approved; never adds to X2F counts | claude3 | landed main (Oct) | - | none |
| R-025 | 11-02 | C3 item 70 | Past-rep claims by team members: owner only for now | claude3 | landed main (unverified) | - | none |
| R-026 | 11-02 | C3 items 71, 72 | Email inside a PGP signature: accept and store encrypted; same key two sites same account: allow | claude3 | landed main | - | none |
| R-027 | 11-02 | C3 item 74 | A key whose claim a mod revoked may file a fresh claim (back to a mod) | claude3 | landed main (unverified) | - | none |
| R-028 | 11-07 | G21 | A different account may claim a revoked key if it proves it | claude3 | in flight wip/second-staff-pages 20a73d24 (J-21, claude2, in progress) | - | finish, review, land |
| R-029 | 11-02 | C3 item 75 | Future-dated signatures stay strict; rejection shows 4 checks (key format, clock, sign not encrypt, up-to-date software) | claude3 | landed main (unverified) | NOT DRAWN | design draws the claim screens |
| R-030 | 11-07 | F16; Q66 | Show the 4-point help after every failed claim | claude3 | landed main (unverified) | NOT DRAWN | verify every failure shows it |
| R-031 | 11-02 | C3 item 76 | Automated signature step: a few per hour is fine; the manual review works like a ticket | claude3 | landed main | - | none |
| R-032 | 11-08 | p5-3 | "Trusted" = 200+ trades and 98%+ positive | claude3 | landed main 22b379e8 (batch 2) | - | none |
| R-033 | 10-15 | HO Badges | Trusted = 100+ trades, 98%+ | claude3 | superseded by R-032 | - | none |
| R-034 | 10-15 | HO Badges | New safety badge; milestones 10/50/100/500/1000; Veteran; Fast; Clean record; security honours; Featured/On hover/Hidden; no volume badges | claude3 | landed main (Oct) | - | none |
| R-035 | 11-07 | G38 | Badge middle choice (tap/hover): owner asked what it does | lead | waiting on owner G38 (lead to re-ask) | - | put on a page with an example |
| R-036 | 10-29 | 28OCT lead call | Release-time stat: last 20 action durations per account, no trade codes | lead | landed main 22b379e8 (batch 2) | - | none |
| R-037 | 11-08 | lead defaults (offer-units) | Lost disputes from live rulings; badge defaults for all; every review counts; Fast = median of both lists | lead | landed main 22b379e8 (batch 2; Fast = median of both lists is replaced by R-042, not started) | - | with R-042 |
| R-038 | 11-01 | 30OCT-lw item 9 | No feedback cap | claude3 | superseded by D-056 | - | none |
| R-039 | 11-02 | 30OCT-lw 07:20; C3 04:51 | Feedback form at most 1 submission per 30 s per person | claude3 | landed main (third-feedback-form-limit in main) | - | none |
| R-040 | 10-28 | 28OCT Feedback | "Leave feedback" link on every popup that refuses something; "Send anonymously" checkbox; owner's thank-you text | claude3 | landed main (Oct; Task 21) | PARTLY | add link to inline refusals (TeamRefusal etc.) |
| R-041 | 10-29 | 29OCT-lc | Anonymous feedback updates no "last seen"; copy promises only "We don't record who sent it" | claude3 | landed main (Oct) | - | none |
| R-042 | 11-09 | p11-20 (replaces R-037 Fast median) | Fast badge: earned after 30 ("let's say") payments sent in under half the allowed time to pay | claude3 | not started | - | lead reading: measured to the "I've paid" tap (allowed time ends there): confirm; replace median in offer-units |
| P-001 | 10-15 | HO Proof | Metadata stripped on device; best-effort auto blur; buyer double-checks; seller sees blurred; mod can request unblurred; proof optional; smart card | claude3 | landed main (Oct) | - | none |
| P-002 | 11-02 | 2NOV-l 08:12 | Uploader can only ADD blur, never remove the automatic one | claude3 | landed main (unverified) | - | none |
| P-003 | 11-02 | 2NOV-l 08:17 | Auto blur never hides the amount; if the uploader's blur covers amount/memo: warn, can still post | claude3 | landed main | - | none |
| P-004 | 11-06 | Q17 | Card numbers written with commas or apostrophes blurred on pictures; review notes stay relaxed | claude3 | landed main (third-p5-proof-core in main, unverified) | - | none |
| P-005 | 11-06 | Q50 | Trade code, amount and time never blurred; names and account numbers blurred | claude3 | landed main (unverified) | - | verify template rules |
| P-006 | 11-06 | Q42 | Stale screenshot date: ask for a fresh screenshot (built) | claude3 | landed main (built) | PARTLY | design draws the state |
| P-007 | 11-02 | C3 item 63 | Pop-up to the poster: "The screenshot submitted is not current. Please redo proof and resubmit." | claude3 | not started (stale branch wip/third-p5-proof-popups e5780990 exists, unreviewed, not in main) | - | reassign: rebase, review, land |
| P-008 | 11-06 | Q43 | Amount not detected: buyer may post anyway; X2F keeps these to improve detection | claude3 | not started (stale branch wip/third-p5-proof-popups e5780990 exists, unreviewed, not in main) | PARTLY | rebase + verify |
| P-009 | 11-02 | C3 item 64 | Pop-up "unable to detect the amount... use the feedback tool and leave an explanation" | claude3 | superseded by P-008 | - | none |
| P-010 | 11-02 | C3 item 65 | Disclaimer + moderators trained to request video evidence from both sides | claude3 | not started (stale branch wip/third-p5-proof-popups e5780990 exists, unreviewed, not in main) | - | rebase + land |
| P-011 | 11-06 | Q46 | Disclaimer wording, placement and button: design's job | design | not started | - | design |
| P-012 | 11-06 | Q47 | "Was this proof blurred correctly?" on every proof for the first couple of months, then every 10th/20th; No asks a comment that goes to the feedback readers | claude3 | not started (no code anywhere) | - | build back end + screens |
| P-013 | 11-08 | p9-8 | First month: ask BOTH parties every time whether private info was removed and the trade info kept; lead words it | claude3 | not started | - | merge with P-012; lead writes wording |
| P-014 | 11-02 | C3 item 30 redo | Database of foreign-language name labels; ask every uploader whether the blur was right, with a comment | claude3 | not started | - | with P-012 |
| P-015 | 11-02 | C3 Q18 | Receiver's feedback button records auto vs manual blur; read by a helper | claude3 | not started | - | with P-012 |
| P-016 | 11-02 | C3 item 35 | Proof template DB (field names, data blank) until auto-blur is perfected, then purged; manual blur teaches; mods see unredacted in disputes | claude3 | not started | - | design the template store |
| P-017 | 10-30 | 29OCT-lc; C3 item 35 | Proof blurring is a safety net; land once reviews find no leak; sender reviews by hand | claude3 | landed main (Oct-Nov) | - | none |
| P-018 | 11-07 | G16 | No date found: EXIF first, then the image; warn the poster and the seller; allow posting (design words) | claude3 | not started (stale branch wip/third-proof-owner-g16 7b50096d exists, unreviewed, not in main) | - | reassign: rebase, review, land |
| P-019 | 11-07 | G17 | OCR reads the label before a number (phone, account) to decide blurring; proofs kept 30 days teach per payment type | claude3 | not started | - | research OCR label detection |
| P-020 | 11-07 | F14 | Warn if the payer's blur hides the trade code; still allowed; system posts a heads-up in the chat | claude3 | not started (chat message part) | PARTLY | build chat system message |
| P-021 | 11-06 | Q44 | Trade code covered by own blur: question unclear | claude3 | superseded by P-020 | - | none |
| P-022 | 11-07 | F15; Q48 | Card last-4 matching the amount: OCR the preceding words; "Trade code" or "Amount" stays clear, other digits blurred if they look personal | claude3 | not started | - | with P-019 |
| P-023 | 11-02 | C3 Q17 | Unlabelled number equal to the trade amount stays clear | claude3 | landed main (proof-core, unverified) | - | none |
| P-024 | 11-02 | C3 Q13-Q16 | Review notes: 9-digit grouped, comma/apostrophe grouped numbers, handles, addresses allowed; images still blur; vendors police their reviews | claude3 | landed main | - | none |
| P-025 | 11-02 | C3 item 29 | Numbers with separators allowed in notes | claude3 | superseded by P-024 | - | none |
| P-026 | 11-02 | C3 item 37 | Refuse 15-16 digit dash-separated numbers and numbers starting with + | claude3 | landed main (unverified) | - | none |
| P-027 | 11-02 | 30OCT-lw 07:20 | Refuse ALL personal details in review notes automatically | claude3 | superseded by P-024, P-029 | - | none |
| P-028 | 11-02 | C3 item 34 | UPI IDs blurred in proofs; kept in chat as evidence | claude3 | landed main (UPI_IDS default on) | - | none |
| P-029 | 11-02 | C3 item 36 | UPI IDs in review notes not refused; the vendor reports the review | claude3 | landed main | - | none |
| P-030 | 11-03 | C3 Q20; item 62 | Buyer paid less: no prompt; seller accepts or disputes; encourage talking first | design | not started | NOT DRAWN | design draws the short-payment state |
| P-031 | 11-08 | lead decision | No VirusTotal or server AV; receiver-side proof check (decode, re-render, refuse otherwise) | lead helper | landed main d421706c (batch 4; proof-receive fcb3990b) | - | none |

## 7. Design and copy

| id | date | source | rule | owner | status | design | next action |
|---|---|---|---|---|---|---|---|
| G-001 | 11-07 | G40 | Links turn the dark ink colour on hover | design | landed main (kit, unverified) | PARTLY | design adds the rule to the remaining boards |
| G-002 | 11-07 | G41 | "XMR" next to amounts in Monero's true orange (getmonero.org) unless design changes it | design | landed main 8daa953f (repo orange #ff6600) | - | none |
| G-003 | 11-07 | G42 | Active Buy/Sell tab 2 px dark border, after design review | design | not started | - | design reviews |
| G-004 | 11-07 | G43 | Disabled-button and sheet-title look: design decides | design | not started | - | design |
| G-005 | 11-07 | G44 | Unbuilt board items (market price card, method icons, section counts, Site news link, Deposit row, empty-search heading): design decides, then build | design | not started | - | design picks; drop "Deposit row" (no deposits, T-021) |
| G-006 | 11-07 | G45 | Blue info note and rounder icon buttons: design's call | design | not started | - | design |
| G-007 | 11-07 | G46 | Five Devices wording items go to design; owner input only if she asks | design | landed main d421706c (batch 4; Devices wordings) | - | none |
| G-008 | 11-07 | G47 | Research folding phones (Pixel, Samsung, others); detect the type; design per device | design | not started | - | design research |
| G-009 | 11-07 | G48 | Fold "Pay now" label waits until the fold boards are final | design | waiting on design (fold boards) | - | none |
| G-010 | 11-07 | G1 | Wording after "I've paid": owner needs a better picture | lead | waiting on owner G1 (re-ask with screenshot) | - | put a screenshot on a page |
| G-011 | 11-07 | G2 | Refund-screen wording ideas (run by design) | design | superseded by T-033 for the rules; wording not started | - | design words the result screens |
| G-012 | 11-08 | p5-1 | Sign unsigned wording: send every line, grouped by screen | lead | in flight (J-26 wording pages batches 1-12 published, 1081 items; more batches pending) | - | owner signs lines |
| G-013 | 11-08 | p5-4 | Support headline: "Ask an X2F staff member" | design | not started (string not in code) | - | change Support headline |
| G-014 | 11-08 | p5-5 | "Sign these short lines?": owner had no idea what they were | lead | waiting on owner p5-5 (re-ask with context) | - | fold into G-012 pages |
| G-015 | 11-08 | p8-1 | Logo D (wordmark X2F in Familjen 700, one Monero-orange coin on the F); header "logo – page name" on every page | design | landed main 58f3d186 (batch 3; front door eb2a86bb with wide shell (batch 2)) | - | none |
| G-016 | 11-08 | p8-2 | Browse page header: "Find a trade" | design | landed main 58f3d186 (batch 3; front door eb2a86bb with wide shell (batch 2)) | - | none |
| G-017 | 10-15 | HO Design system | Night-first; orange only for the one primary action; state colours with words; fonts; no emoji or exclamation marks; usernames as set | design | landed main (Oct) | - | none |
| G-018 | 10-30 | 30OCT-lw 11:50 | Send design a phone screenshot pack + "what changed" after each landing batch | lead | not started (process) | - | do it after batch 2 |
| G-019 | 11-08 | standing rule | Forward every owner comment/answer to design verbatim | lead | in flight (process, ongoing) | - | see status |
| G-020 | 11-08 | chat 8 Nov; p11-39 | "Frankly the previous demo was better" (why not yet given) | owner-pending | superseded by X-016 (p11-39: he misses the Claude integration while reviewing) | - | none |
| G-021 | 10-29 | HO 29b | Foldables: phone < 600 px, two panes to 999, wide from 1000, tabletop/flip layouts | design | landed main (Oct; Task 40) | - | none |
| G-022 | 11-08 | p11-15 | Typed signature box: tick to agree, sign your name, "begin account creation" (design words) | design | landed main d421706c (batch 4; terms-signature e07cb506 + staff invite Terms 3ff7ae47) | - | none |
| G-023 | 11-08 | wide-shell review M2 | Page names Blocked users, Zelle offers, Dispute · code, Wallets, Security are unsigned | owner-pending | waiting on owner (wording pages) | - | add to G-012 pages |
| G-024 | 10-28 | 28OCT Decision 5 | 44px method name left to Claude Design | design | landed main (Oct) | - | none |
| G-025 | 11-09 | p11-24 | Signup order: disclaimer/Terms of Service, then site rules (maybe separate pages, each acknowledged), then a box to sign (any signature), then "Continue creating your account" | design | not started | - | design checks terms-signature (S-103) follows this order |

## 8. Public site, alerts, Jabber

| id | date | source | rule | owner | status | design | next action |
|---|---|---|---|---|---|---|---|
| W-001 | 10-28 | 28OCT Q6 | No email system; an announcements (News) inbox at login, newest first, dated | claude3 | landed main (Oct) | - | none |
| W-002 | 10-29 | 28OCT 08:03 d | News bell with an unread dot even when the popup is off; "don't show again" exists | claude3 | landed main (Oct) | - | none |
| W-003 | 10-28 | 28OCT Q15 | Emergency stop: lists hidden, message "unscheduled but necessary maintenance"; see News or Matrix/Telegram | claude2 | landed main (Oct) | - | reword per W-004 |
| W-004 | 11-07 | G19 | Maintenance never defaults to "emergency" (internal only); unplanned: minimal info + best guess; planned: ~24 h notice; 500 chars in a big bright banner | claude2 | landed main d421706c (batch 4; J-04 timers/maintenance) | CONFLICT | none |
| W-005 | 10-29 | HO 29b design-reported | Maintenance planned (start/end) and emergency ("back soon", timers paused) versions | claude2 | superseded by W-004 | - | none |
| W-006 | 10-28 | 28OCT Q6 final | Phone push + loud alarm (default sound/volume, custom sound file + volume) | lead helper | landed main (push, Oct); loud alarm + custom sound not started (unverified) | - | verify; build in native app (Plan 6) |
| W-007 | 10-28 | 28OCT Q6 final; p11-31 | One extra alert channel only: OMEMO Jabber over Tor; no Nostr | lead helper | in flight wip/lead-jabber-omemo baf56fab (approved with minor, lands dark in batch 5; interop run before lighting; owner p11-121..123, p11-127..129 pending) | - | batch 5 |
| W-008 | 10-27 | HO 10-27 | Nostr and PGP-encrypted email alerts | lead | superseded by W-007 | - | none |
| W-009 | 10-28 | 28OCT Battery | Optional unrestricted battery on Android, explained in setup | lead helper | not started (Plan 6 native app) | - | Plan 6 |
| W-010 | 10-27 | HO 10-27; 28OCT Q4 | Android: APK from the site + own F-Droid repo; web app stays main path | lead helper | not started (Plan 6) | - | Plan 6 |
| W-011 | 10-27 | HO 10-27; 28OCT Q5 | I2P address: decide after research and in-house testing | lead helper | waiting on owner (research first) | - | research helper |
| W-012 | 10-27 | HO 10-27 | Public pages very important: intro pages, FAQ, searchable support centre, guides, lawful-request policy | design | landed main 58f3d186 (batch 3; front door eb2a86bb with wide shell (batch 2)) | - | none |
| W-013 | 10-27 | HO 10-27 | Not open source for now; outside testing groups and a bug bounty | lead | not started (bug bounty after launch) | - | none now |
| W-014 | 10-27 | HO 10-27; 28OCT Q3 | Affiliates, sponsored ads, featured trader, banners: later | owner-pending | waiting on owner (later) | - | none |
| W-015 | 11-07 | G49 | Real Matrix and Telegram addresses set up near the end of design | lead | not started | - | lead sets up before launch; fill placeholders |
| W-016 | 11-01 | 30OCT-lw | Optional secure Jabber account for staff to reach the owner; Matrix/Telegram for support | lead helper | not started | - | build with Jabber |
| W-017 | 11-07 | p4-2 | Deadlines in UTC only, no time-zone option | lead | landed main (UTC strings everywhere) | - | none |
| W-018 | 10-27 | HO 10-27 | No guest buying; sign-up stays easy and fast | claude2 | landed main (Oct) | - | none |
| W-019 | 11-08 | design real-app review | Owner 8 Nov: "No one gets past the front door... without signing an agreement, creating an account and logging in. No free tours." Logged-out: login, create account, recovery only; API refuses market/user data without a full session | lead helper | landed main 58f3d186 (batch 3; front door eb2a86bb with wide shell (batch 2)) | - | none |
| W-020 | 11-08 | lead default (jabber) | Dispute opened -> payer gets a "trade-attention" Jabber notice; weak sessions and holds block Jabber writes | lead | landed main d421706c (batch 4; jabber-notices 5d2b6e61, dark until OMEMO lights) | - | light with OMEMO (batch 5) |
| W-021 | 11-09 | p11-27 | A Jabber notifications settings page: each user picks which events send them a secure Jabber notice | lead helper | not started | NOT DRAWN | design draws it; build on jabber-notices |
| W-022 | 11-09 | p11-32 | Jabber events: lead and design list every event worth a notice in an artifact checklist; the owner ticks the ones to use and can add rows with his own description | lead | not started | - | lead + design build the checklist artifact |

## 9. Ops, security, GitHub

| id | date | source | rule | owner | status | design | next action |
|---|---|---|---|---|---|---|---|
| X-001 | 11-06 | chat 6 Nov 07:13 | Purge old dead branches; keep a clean work environment | lead | in flight (process, ongoing) | - | see status |
| X-002 | 11-06 | chat 6 Nov 06:59-07:39; p4-7 | Install SonarQube Cloud / the official SonarQube scan action; token is in the 1Password service vault | lead | waiting on owner (1Password service-account token not created; owner action, no page id) | - | owner creates token |
| X-003 | 11-07 | p4-7 | Use the 1Password CLI / service MCP vault for tokens | lead | waiting on owner (1Password service-account token not created; owner action, no page id) | - | owner creates token |
| X-004 | 11-08 | p11-8 | Turn on GitHub security alerts and automatic security fixes | lead | landed (GitHub settings 8 Nov; Dependabot config main 46bffbaa) | - | check security/dependabot after next push |
| X-005 | 11-08 | p11-7 | No freelance crypto review now; a proper audit from early revenue | lead | not started (later) | - | none now |
| X-006 | 11-08 | design relay | Public 2-4 page crypto spec for community review | lead helper | landed main d421706c (batch 4; research pack / crypto-spec d7fbdbdb; drafts only, nothing sent) | - | none |
| X-007 | 11-08 | design relay | Bug bounty after launch | lead | not started | - | after launch |
| X-008 | 11-08 | design relay | Monero CCS, OTF Red Team Lab, NLnet applications: drafts only; nothing sent without his yes | lead helper | landed main d421706c (batch 4; research pack / crypto-spec d7fbdbdb; drafts only, nothing sent) | - | none |
| X-009 | 11-08 | design relay | Fuzz and attack tests | lead helper | landed main d934daa1 | - | none |
| X-010 | 11-06 | chat 6 Nov 07:38 | Lead: review code, find security flaws, keep workers on task, merge to main, delegate; owner only answers questions | lead | in flight (process, ongoing) | - | see status |
| X-011 | 11-06 | chat 6 Nov 07:50 | Questions go on click-through artifact pages: multiple choice, "recommended" marked, plus a free-text option | lead | landed (pages 1-12) | - | add N1-N11 to page 11 |
| X-012 | 10-27 | HO 10-27; chat 7 Nov 07:19-07:20 | Workers and design never message the owner; everything goes through the lead (permission prompts too) | lead | in flight (process, ongoing) | - | see status |
| X-013 | 11-08 | chat 8 Nov | Move the lead and all X2F folders to the cloud/GitHub; leave nothing important behind | lead | landed (pc-archive-2026-11-08, comms) | - | none |
| X-014 | 11-08 | chat 8 Nov | Spawn many agents for maximum parallel work | lead | in flight (process, ongoing) | - | see status |
| X-015 | 11-08 | p11-12 | Open the demo on his phone through Tailscale | lead | landed (demo on PC, wip/lead-demo 8855328c) | - | long-term home: X-023 (Claude cloud session environment, p11-38) |
| X-016 | 11-08 | chat 8 Nov; p11-39 | A comment tool on the demo like the earlier one | lead | in flight wip/lead-demo 8855328c (running on the PC, not on main) | - | see status |
| X-017 | 11-08 | chat 8 Nov | "I don't see why nudge can't be moved to GitHub": scheduled routine wakes workers from the comms branch | lead | not started | - | create scheduled tasks for claude2/claude3 until 21 Nov |
| X-018 | 11-08 | chat 8 Nov | Registrar that keeps the buyer confidential and takes Monero; lead reads actual terms | owner-pending | waiting on owner (rec IncogNET, then OrangeWebsite, 1984; Njalla unread) | - | read Njalla terms; owner chooses |
| X-019 | 11-08 | chat 8 Nov | claude2 and claude3 accounts close 21 Nov: on 19-20 Nov confirm all pushed, get final handoffs, reassign | lead | not started | - | schedule for 19 Nov |
| X-020 | 10-21 | R30 (lead) | Every agent pushes its own wip branch at each commit | lead | landed (process) | - | none |
| X-021 | 11-08 | owner-decisions 8 Nov | One 1Password service account token allowed in the cloud lead's environment (replaces "vault token stays off cloud"); lead recommends a dedicated read-only vault | lead | waiting on owner (1Password service-account token not created; owner action, no page id) | - | owner creates token |
| X-022 | 11-07 | owner-decisions 7 Nov | Next topic after the owner sees the working demo: team member permissions | lead | in flight (process, ongoing) | - | see status |
| X-023 | 11-09 | p11-38 | Working demo: code on GitHub, run in a Claude cloud session environment while it is being tested (reachable from claude.ai / Android app) | lead | not started | - | set up the demo in a cloud environment |
| X-024 | 11-09 | p11-40 | No archive of the raw lead transcripts; the snapshot was only for the cloud migration | lead | landed (decision) | - | none |

## 10. Business and legal

| id | date | source | rule | owner | status | design | next action |
|---|---|---|---|---|---|---|---|
| B-001 | 10-14 | HO Open decisions 1 | 1% per completed trade, paid only by the ad poster; takers never see a fee line | claude2 | landed main (Oct) | - | design: BuyQuote fee rows (p10-1 case 2) |
| B-002 | 10-29 | 28OCT 13:32; R41 | The poster whose ad was taken always pays the 1%, buy or sell side | claude2 | landed main (Oct) | - | none |
| B-003 | 10-29 | 28OCT 13:26; R41 | Cancelled trades (buyer cancel, walk-away, lapse/no-show) pay no fee | claude2 | landed main (Oct) | - | none |
| B-004 | 10-28 | 28OCT Q3 | Separate internal revenue ledger (aggregate) of completed trades' 1%; for revenue/payroll/treasury | lead helper | landed main d421706c (batch 4; revenue-ledger 02762a02 + fee sweep, dark until the owner sets the threshold p11-76/77) | - | owner sets threshold |
| B-005 | 10-28 | 28OCT Q3 | A second fee tier for large trades later (threshold TBD) | owner-pending | waiting on owner (later) | - | none now |
| B-006 | 10-30 | 29OCT-lc q7 | Fee wallet stays hot; at an owner-set threshold the excess moves automatically to his cold wallet, leaving 1 day + 1 night of staff pay; owner notified | lead helper | landed main d421706c (batch 4; revenue-ledger 02762a02 + fee sweep, dark until the owner sets the threshold p11-76/77) | NOT DRAWN | owner sets threshold |
| B-007 | 10-14 | HO Open decisions 2 | Crypto lawyer before mainnet; Terms text from the lawyer | lead | not started | - | lawyer-questions.md |
| B-008 | 10-28 | 28OCT Q11 | Warrant canary: deferred to the lawyer | owner-pending | waiting on owner (lawyer) | - | lawyer list |
| B-009 | 10-14 | HO Open decisions 5; F12 | Sanctioned rails (SBP, Mir, YooMoney) need a lawyer; no sanctioned currencies | lead | not started (legal) | - | lawyer list; check method/currency data |
| B-010 | 10-29 | HO 29c | Team members: lawyer item 2 (business or exchange status) | owner-pending | waiting on owner (lawyer) | - | lawyer list |
| B-011 | 10-17 | HO Accounts | Terms say X2F answers lawful warrants with the little it holds (no IPs, names, phones, emails) | lead | landed main (Oct; lawyer to word) | - | none |
| B-012 | 11-08 | p11-13 | Erase the trader's signature when the account closes | lead helper | landed main d421706c (batch 4; terms-signature e07cb506 + staff invite Terms 3ff7ae47) | PARTLY | none |
| B-013 | 11-08 | p11-14 | Everyone who gets a login signs (team members and staff too) | lead helper | landed main d421706c (batch 4; terms-signature e07cb506 + staff invite Terms 3ff7ae47) | NOT DRAWN | none |
| B-014 | 11-08 | lead fact | Domain is permanent because passkeys are tied to it (plan D22) | lead | landed (decision) | - | choose registrar first (X-018) |

## 11. Waiting on the owner (open questions and re-asks)

| id | date | source | question / what is needed | owner | status | design | next action |
|---|---|---|---|---|---|---|---|
| Q-001 | 11-08 | p11-17 | Completed trade's chat and keys destroyed at 48 h or 30 days? (he wrote both) | owner-pending | superseded by C-001, T-082 (p11-17 answered 9 Nov) | - | none |
| Q-002 | 11-08 | p11-18 | A late "I've paid" cannot stop the seller's refund (as built per p9-2): confirm | owner-pending | superseded by T-037 (p11-18 confirmed as built) | - | none |
| Q-003 | 11-08 | p11-19 | Must moderators' passkeys be hardware devices? | owner-pending | superseded by D-070 (p11-19 answered 9 Nov) | - | none |
| Q-004 | 11-08 | p11-20 | Fast badge: buyer's speed to the "I've paid" tap or to the seller's confirmation? | owner-pending | superseded by R-042 (p11-20 answered 9 Nov) | - | none |
| Q-005 | 11-08 | p11-21 | Weak-login team invite: held 24 h or refused? | owner-pending | superseded by S-104 (p11-21 answered 9 Nov) | - | none |
| Q-006 | 11-08 | p11-22 | May a member with hold rights cancel/approve the lead's waiting team changes? | owner-pending | waiting on owner (p11-22 not answered as asked: he wants the full list of team abilities, and whether there are member types or only per-ability boxes, decided first) | - | lead + design write the full abilities list (Job 1c, S-087/S-097), then re-ask |
| Q-007 | 11-08 | p11-23 | The combined hold rules (per-change dates; older session ends newer): as he wants? | owner-pending | waiting on owner (p11-23 not answered as asked; he said a thief would need both username and password) | - | re-ask on a later page; p11-35 (S-110) and p11-34 (S-109) give the owner a way out |
| Q-008 | 11-08 | p12-1 | Moderators never read a chat without a dispute: does that include the owner? | owner-pending | waiting on owner p12-1 | - | none |
| Q-009 | 11-08 | p12-2 | When the system opens a dispute by itself, how does X2F get the chat key? | owner-pending | waiting on owner p12-2 | - | none |
| Q-010 | 11-08 | p12-3 | Both traders lose their devices: chat unreadable forever. Accept? | owner-pending | waiting on owner p12-3 | - | none |
| Q-011 | 11-08 | p12-4 | How do seniors and the owner get into a disputed chat? | owner-pending | waiting on owner p12-4 | - | none |
| Q-012 | 11-08 | p12-5 | New-device approval: same 6-digit code on both screens? | owner-pending | waiting on owner p12-5 | - | none |
| Q-013 | 11-08 | p12-6 | Removed staff can't un-see: build a key change for their cases now? | owner-pending | waiting on owner p12-6 | - | none |
| Q-014 | 11-08 | p12-7 | When is the audit log destroyed? | owner-pending | waiting on owner p12-7 | - | none |
| Q-015 | 11-08 | p12-8 | Staff-wide events in a permanent log? | owner-pending | waiting on owner p12-8 | - | none |
| Q-016 | 11-08 | p12-9 | Backups: build "backups shred too" before launch? | owner-pending | waiting on owner p12-9 | - | none |
| Q-017 | 11-08 | p12-10 | Staff open the staff site only from a checked, pinned copy? | owner-pending | waiting on owner p12-10 | - | none |
| Q-018 | 11-08 | p12-11 | Who sees the audit log? | owner-pending | waiting on owner p12-11 | - | none |
| Q-019 | 11-08 | p12-12 | Where are the "privacy tool scrubbed" training copies made and kept? | owner-pending | waiting on owner p12-12 | - | none |
| Q-020 | 11-08 | p12-13 | A staff-only thread per case for questions to the previous moderator? | owner-pending | waiting on owner p12-13 | - | none |
| Q-021 | 11-08 | p12-14 | Chats no longer stored on the phone; app reads them live each time? | owner-pending | waiting on owner p12-14 | - | none |
| Q-022 | 11-08 | p12-15 | 60-day inactivity close: all trader accounts, never staff, owner or team-member logins? | owner-pending | waiting on owner p12-15 | - | none |
| Q-023 | 11-08 | LEAD-START-HERE 7 N1; p11-24 | Signup "username available" tick allows ~14,400 existence checks a day (was hidden on purpose): keep? | owner-pending | waiting on owner (p11-24 not answered as asked; he described the signup order instead: G-025) | - | re-ask the live username tick on a later page |
| Q-024 | 11-08 | N2; p11-25 | Team chat hint: "Team Calcium member: Aurora" (R44) vs design's "never name the member" | owner-pending | superseded by S-105 (p11-25 answered 9 Nov) | CONFLICT | none |
| Q-025 | 11-08 | N3 | Password-only members: may a member's weak login hold the lead's account; first-login approval; members' recovery codes? | owner-pending | superseded by S-106, S-107, S-108 (p11-26, 27, 28 answered 9 Nov) | - | none |
| Q-026 | 11-08 | N4; p11-29 | Time-to-pay defaults: 90 min apps/instant, 3 h bank, 24 h cash by mail | owner-pending | superseded by T-083 (p11-29 answered 9 Nov: research the average per method) | - | none |
| Q-027 | 11-08 | N5; p11-30 | Fixed-price offer can't be taken while the feed is down (for the $5k cap): OK? | owner-pending | waiting on owner (p11-30 not answered as asked: he said 3-4 feeds plus a Tor backup should be enough) | - | re-ask: no trades at all while the price is unknown (as built)? N5 fixed-price part is moot if O-001 lands |
| Q-028 | 11-08 | N6; p11-31, p11-32 | Jabber: "OMEMO only over Tor" or "OMEMO recommended"? And what counts as an account change | owner-pending | superseded by W-007, W-022 (p11-31, p11-32 answered 9 Nov) | - | none |
| Q-029 | 11-08 | N7; p11-33 | How long the server remembers a purged chat (builder: 365 days) | owner-pending | waiting on owner (p11-33 not answered as asked: he gave sync-on-login, C-021, not how long the marker is kept; builder 365 days as built) | - | lead decides whether to re-ask the number |
| Q-030 | 11-08 | N8; p11-34, p11-35 | Hold: let a correct recovery code through even when throttled; two limits of a shared password (cancel each other's change; older session ends newer) | owner-pending | superseded by S-109, S-110 (p11-34, p11-35 answered 9 Nov; the two limits themselves were not explicitly accepted or rejected) | - | none |
| Q-031 | 11-08 | N9; p11-38 | Where the working demo lives (needs a machine that stays on) | owner-pending | superseded by X-023 (p11-38 answered 9 Nov) | - | none |
| Q-032 | 11-08 | N10; p11-40 | Archive the raw chat transcripts to the private repo? | owner-pending | superseded by X-024 (p11-40 answered 9 Nov) | - | none |
| Q-033 | 11-07 | G22 | "Too many tries, try again in 1 minute" after 2 sends in 30 s: which form? (he asked back) | lead | waiting on owner G22 (re-ask: it is the feedback form) | - | put on a page |
| Q-034 | 11-08 | hold-v3 review minor 8; p11-36 | Tell the user a replaced recovery code was never revealed? (product decision) | owner-pending | superseded by S-111 (p11-36 answered 9 Nov) | - | none |
| Q-035 | 11-08 | chat-retention review | Terms wording for 30/90 days (p11-9 answered); does "destroyed" cover the trader's device (p11-10 answered yes) | lead | superseded by C-013, C-014 | - | none |

---

## Conflicts between owner answers and main (or built branches)

1. **Fixed-price offers still exist on main** (O-001 vs `apps/api/src/offers/routes.ts` mode 'fixed', PostOffer fixed price). Owner: market ± % only.
2. **Offer cap on main is 3 per market / 20 total** (O-025 vs `OFFER_CAP_DEFAULTS`). Owner: 3 buy + 3 sell.
3. **Price source gap is 5% on main** (O-037 vs `price/feed.ts maxSpreadBps: 500`). Owner: 3%.
4. **Surplus in an escrow is paid automatically to the seller on main** (T-023 vs `packages/trade/src/payouts.ts`, `apps/web/src/escrow/policy.ts`). Owner (30 Oct): automatic payouts pay only the expected amounts; surplus needs a dispute.
5. **Trusted badge is 100 trades on main** (R-032); 200 only on batch 2 (offer-units).
6. **Task 34 branches allow 5 bands and 10 payment types** (O-009, O-010 vs `MAX_BANDS = 5`, `MAX_METHODS = 10`). Owner: 3 and 5.
7. **Terms text says dispute records kept 30 days** (C-013, termsText.ts:31,84). Owner: up to 90 days.
8. **Docs still say 90 days from the dispute button** (C-003): R36 text, spec 4.1, Plan 4, migration 110 comment, coordination M4. Code on main follows the owner (from close).
9. **wip/second-api-cap-dispute** carries g66 "one nudge required before the seller's cancel" (326d9c6f), reversed by p6-1 (T-032/T-033): do not land that commit.
10. **No nudge sound asset on main** although the owner approved one (T-031).
11. **Design conflicts the owner's words** (design's audit): G34 (TOTP strong), G32 (recovery code lets you in), Q23 (3 bands), G19 (no "emergency" default), appeal 48 h (boards show 72 h), p11-11 (90 days from close), Q77 (no switch back), G57 (weak kick is immediate), clawback A (no 48 h hold), Q54 (two fields), Q51/G3 (all three staff methods), R44 chat label (design says never name the member). 9 Nov: Q51/G3 changed by p11-19 (D-070) and the R44 label changed by p11-25 (S-105): the boards must be redrawn to the new rules, not to the old ones. Rows S-011, S-019, O-009, W-004, D-004, C-003, S-041, S-051, D-044, D-027, D-023, S-086 carry "design to redraw" or "owner to confirm".
12. **G5 vs p5-7 (removals during a hold):** G5 said a weak removal acts at once and becomes permanent at 24 h; owner-decisions reads p5-7 as "removals held too, nothing applies early". S-036 is marked superseded on that reading; hold-v3 staged removals; the owner confirms the combination on p11-23. 9 Nov: p11-23 not answered as asked (re-ask); p11-26 adds that a hold holds only the changes made (S-106).
13. **Nudge sound licence:** F10 (owner-decisions) says check the rights to the ICQ clip first; use an original in that style unless it can be licensed (T-031).
14. **Dispute window 48 h in code vs 72 h** (T-082, p11-17): `disputeAfterRefundHours 48` on main; lead confirms which window he meant.
15. **hold-v3 refuses invites from a weak login** (S-060 built) vs p11-21: the invite goes through and the member's settings apply after 24 h (S-104).
16. **hold-v3 account-wide hold effects** (offers hidden, unfunded trades cancelled, trades held: S-027, T-072) vs p11-26: a hold holds only the changes made (S-106).
17. **Moderator invite needs all three methods** (third-p4-task16, D-023) vs p11-19: security key optional with username + password + PGP + passkey (D-070).
18. **Time-to-pay defaults on launch-rules** (90 min / 3 h / 24 h) are not approved (p11-29): placeholders until the per-method research (T-083).
