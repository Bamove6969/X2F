# Review: wip/lead-docs-rules

## Review 8e5f3b06

Reviewer: independent helper, read-only. Range 0c6f3f16..8e5f3b06 (10 commits, 12 files). Rulings checked against comms `owner-decisions-2026-11-06.md` (page 11 answers 17-40, and the Q list of 6 Nov) and `owner-answers-register.md`. No tests apply.

**Verdict: CHANGES NEEDED (docs only, all mechanical except Q-B1 to Q-B3).** Every edit cites the right ruling id, and the summaries stay within the rulings, with the exceptions below. The p11-11 strike-through edit left several lines that now contradict themselves or each other, and two "built on main" claims are false.

### Ruling ids: each one checked

| Commit | Ruling cited | Source line | Matches? |
|---|---|---|---|
| 9474d906 | Q31 offer cap 3+3, no seventh | decisions l.8 "exactly 3 + 3; a seventh can't be posted, no on-hold seventh" | yes. "Paused offers counted" is a fair reading of "no on-hold seventh". |
| 4d9a7521 | Q23 3 bands/currency, 5 types/offer | decisions l.5 | yes |
| a8493e98 | Q7 3% gap; Q6/F11 and O-036 fourth source after Tor check | decisions l.9 and l.40; register O-036 | yes |
| e0768e00 | p11-11 90 days from dispute closing | decisions l.165 | id right; mechanical leftovers (D1-D4) |
| 702b8282 | p11-17 72 h window, p11-51 pending | decisions l.172 | yes. **p11-51 is not in owner-decisions or the register** (it appears only in to-design-2026-11-09.md), so it is a pending question number, not a ruling. The wording "pending confirmation" is correct. |
| 31bec75f | p11-25 "<lead display name> Assistant N" | decisions l.180 | yes |
| a3e6dc21 | p11-19 moderator may lack a security key | decisions l.174 | yes, but see D6 |
| 97b7d7d1 | p11-26 hold holds only the changes made | decisions l.181 | id right; see D5 and Q-B2 |
| 1eb72ab7 | p11-20 Fast = 30 payments under half the time | decisions l.175 | yes. "Lead reading, to confirm" is kept. |
| 8e5f3b06 | p11-31 OMEMO and Tor mandatory; p11-27 and p11-32 | decisions l.186, l.182, l.187 | yes |

### Lines that now contradict another line (fix before landing)

- **D1, spec l.183, garbled.** "counted from the moment someone presses ~~the dispute button~~ the dispute closing". A find-replace left "presses the dispute closing". Rewrite it as "counted from the day the dispute closes".
- **D2, the text says closing but the column named is still `opened_at`:**
  - Plan 3 l.1098: "the dispute closing (owner p11-11) (`disputes.opened_at`)".
  - Plan 4 l.1140: "counted from `opened_at` (~~the dispute button~~ the dispute closing)", and "the tests above change to day 89 / day 91 **from the button**".
  - Plan 4 l.1156: "the dispute closing (`opened_at`)" and "Task 23: `DISPUTE_KEEP_DAYS = 90`, counted from `opened_at`".
  - coordination l.584: "90 days from the dispute closing ... the disputed case needs a `disputedAt` (`disputes.opened_at`) fact".
  - All four contradict Plan 4's own new Revision 2026-11-09 (l.1109: "counts from `closed_at` ... not `opened_at`") and migration 110's new comment. Replace `opened_at` with `closed_at` in each, and "from the button" with "from the closing".
- **D3, Plan 3 l.789, self-contradiction.** "`purgeChats` deletes envelopes ... or 90 days after the dispute closing for a disputed trade, **not 90 days after close**." "Not 90 days after close" now negates the rule. Drop that clause, or say "not 30 days after the trade closes".
- **D4, stale exception in R36 (rulings l.105) and Plan 4 l.1156.** "A dispute still open at day 90 is kept until it closes". With the clock starting at the closing, this cannot happen. Harmless, but readers will take it to mean the clock still starts at the button. Either drop it or reword it as "nothing is purged while any dispute on the trade is open". See also Q-B1.
- **D5, R42 (rulings l.115): two sentences now contradict each other.** The new "Superseded 2026-11-09 (owner p11-26): a 24-hour hold holds only the changes being made" is followed, unchanged, by "Lead readings, OPEN ...: **the hold covers the whole account**". Strike or annotate that lead reading. The spec's 2026-10-29c lead-readings section, if it repeats it, needs the same.
- **D6, spec l.614: the staff paragraph.** The p11-19 note was inserted into a paragraph that still says "Staff **cannot use passwords**, authenticator apps or recovery codes". p11-19 itself says a moderator "may log in with username, **password**, PGP key and passkey". As written, the two halves of the paragraph disagree. See Q-B3.
- **D7, "built on main" is false at 0c6f3f16 and at origin/main 22b379e8.**
  - Main still has `OFFER_CAP_KEYS = { perMarket: 'offers_max_per_market', total: 'offers_max_total' }` (`apps/api/src/offers/routes.ts`).
  - The keys `offers_max_buy` / `offers_max_sell` exist only on `origin/wip/lead-offer-rules`.
  - Affected lines: Plan 3 l.9 ("built on main (`OFFER_CAP_DEFAULTS`, keys `offers_max_buy` / `offers_max_sell`)"), l.1093 ("already built on main"), l.1133 ("already on main"), coordination l.442 ("built on main"), and coordination l.69 ("the older keys ... are replaced").
  - Say "on wip/lead-offer-rules, landing before Task 34", or land that branch first.
- **D8, Q23 "the code has 5 and 10".** Plan 3's revision and Task 34 lines (`MAX_BANDS = 5` web, `MAX_METHODS = 10` API and web) and spec l.11 ("the earlier build used 5 and 10") describe code that is not on main. It exists only on `origin/wip/second-p3-task34-web`. Say "the Task 34 branch has 5 and 10".
- **D9, Q7 meaning, minor.**
  - HANDOFF and Plan 3 state the 3% rule as settled ("sources disagree by more than 3%", "`maxSpreadBps` 300").
  - The spec's new 11.6 line says whether 3% means "from the median" or "between any two sources" is awaiting the owner (review O1).
  - The code's `maxSpreadBps` is from the median (`apps/api/src/price/feed.ts` l.19). Add "(from the median, pending O1)" to the HANDOFF and Plan 3 lines so all three agree.
- **D10, dates, minor.** HANDOFF l.13 says "owner Q7, 2026-11-09", and coordination l.69/74 say "owner Q31, 2026-11-09". The rulings are of 6 Nov (the other docs say "6 Nov"). Use one date.
- **D11, dev-setup J-03.** dev-setup says "Tracked as J-03 (`wip/second-price-feeds`)". The assignments file has J-03 as `wip/second-price-gap`, with the price-feeds rebase as part of it. Name both, or the J-03 branch.

### Not a contradiction, but worth noting

- **Migration 110 is edited in a docs branch** (`apps/api/migrations/110_dispute_system_retention.sql`, comment lines only). `apps/api/src/db/migrate.ts` keeps no checksums, so nothing breaks. Still, editing an applied migration file is unusual; consider leaving it and noting the change in the next migration instead. Lead's call.
- **Pre-existing, not introduced here.** R36 still says "the dispute-after-refund window is OPEN pending the owner's answer (question A; lead recommends 30 days)". Coordination says 48 h was decided on 2026-10-29. The new p11-17 bullet sits right under it, so readers now see three numbers (open/30 d, 48 h, 72 h). Suggest replacing that clause with "48 h (owner 2026-10-29); 72 h per p11-17 pending p11-51".
- **The cross-branch conflict is not in this branch.** The crypto-spec branch's §7 line ("The design's rule ... counts from the dispute button ... This is under review") becomes false once this lands. See review-crypto-spec-2026-11-09.md.

### Questions for the lead (not mine to decide)

- **Q-B1: what "the dispute closes" means when an appeal follows (R40 48 h appeal window).** Does the clock start at the ruling, or at the end of the appeal or appeal window? p11-11 says only "the day the dispute closes". The code (c0af884b) uses `disputes.closed_at`. Recommendation: say "closed_at, which an appeal reopens" if that is what Plan 4 writes, or ask the owner.
- **Q-B2: the reach of p11-26.** The spec, R42 and HANDOFF now say "nothing below that blocks trades, offers **or logins** stays". That drops "no approving new logins or devices during the hold". Approving a new device is arguably itself "a change being made" (a security change), so the owner may not have meant to lift it. Recommendation: keep "no approving new devices" as part of "the changes being made" until the lead confirms, along with the recovery-code question already flagged.
- **Q-B3: whether moderators have passwords** (D6). Is p11-19's "username, password" literal (staff passwords become allowed for moderators), or the owner's shorthand? Recommendation: ask the owner. Until then, record p11-19 as "security key optional when PGP + passkey are held" and leave "staff cannot use passwords" standing.
