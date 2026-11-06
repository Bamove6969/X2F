# X2F LEAD HANDOFF — Mon 2 Nov 2026, ~07:30 PT (full context clear)

Read this FIRST, then the per-agent handoffs in §6, then `LEAD-HANDOFF.md` section 0 for older history.

## 0. Who you are and the rules
- You are the X2F **lead**: plan, assign, review, land. The **owner** (bamove) talks only to you; workers report only to you.
- **Owner rules (memory: feedback-no-important-calls.md):**
  - No decisions about what the app DOES (rules, limits, flows) or how it LOOKS/READS (screens, wording, defaults) without the owner. Ask first and recommend.
  - Code is your arena: merges, tests, structure, landing approved/reviewed work.
  - Visual calls are delegated to the **design session** (cloud, "Continuation" or its successor).
  - Decisions the owner made with design or with claude2/claude3 while you were offline are valid, but **review every one with the owner** (he asked).
  - He wants **lots running in parallel** (workers + helpers), and **push to GitHub after every step**.
- **Every landing:** independent review → merge the main line → full tests → `git push origin HEAD:claude/compassionate-johnson-k95ssr HEAD:main` (GitHub `main` is kept equal to the main line) → announce the new main in to-second.log / to-third.log.
  - Tests: web, api and trade vitest; typecheck; copy-lint; separation-check.
  - Playwright: `--workers=1`, `X2F_CHROMIUM_PATH=/usr/bin/chromium`.
  - Run heavy tests under `flock ~/x2f-comms/check.lock`.
- **Commit trailer:**
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Btihb34hJU5sMkyYMAzy4k
  ```
  Identity: `-c user.name=flem -c user.email=bamove@gmail.com`.

## 1. Repo
- Main line = GitHub main = **b6835ee** (repo Bamove6969/X2F; local ~/x2f on branch compassionate-johnson-k95ssr).
- **Landed 1–2 Nov:**

  | Commit | What |
  |---|---|
  | 9b26423 | Team members |
  | 52b7a0e | Staff core |
  | d77134d / bd5a077 | Test flake fixes |
  | e7dd94c | SonarQube fixes |
  | 0c0f9ac | Escrow tap commits after save |
  | 850052d | Device approval + Devices and sessions |
  | 5bfb450 | My offers; ONE kit Switch + ONE Notice |
  | b6835ee | C11: ruling copy "goes to", v2 CantDoThat dialog, invite disabled at 3/3, Post tab hidden for members |

- **Shared UI kit** in apps/web/src/ui. Reuse it; never duplicate parts.
- **Local SonarQube:** 127.0.0.1:9000, `~/x2f-comms/tools/sonar-scan.sh`, secrets in ~/x2f-comms/secrets (never push). The cloud app was uninstalled by the owner.
- **Backups:** `backup/*-2026-11-01` branches (stale worktrees).

## 2. Branches: state and next step (heads as of 07:30)
**Ready / in review (land after review passes):**

| Branch | Head | Owner | Review | Notes |
|---|---|---|---|---|
| wip/second-api-cap-dispute | 83f814f | claude2 | running → `review-claude2-ready-2026-11-02.md` | Cap 3 buy + 3 sell; buyer dispute 30 min after paid. Trading-hold end time NOT built (questions). |
| wip/second-design-loginapprove-v2 | 3e9a906 | claude2 | same file | Changes the Sheet/Notice look app-wide (v2 caution callout). |
| wip/second-design-selection | 22a36eb | claude2 | same file | No orange for selection. |
| wip/third-p5-reviews-api | 8cb4ea2 | claude3 | running → `review-claude3-ready-2026-11-02.md` | C12/C12b: no weighting, month-only, no blind reveal, Skip final, opt-in volume line (mig 307). Check migration-number clashes. |
| wip/landing-p5-feedback | 04a4515 | claude3 | same file | Feedback; global cap removed. Owner: form limit = 1 per 30 s **per person** (to build). |

**Building (lead helpers; each writes `~/x2f-comms/HANDOFF-lead-<name>-2026-11-02.md`):**

| Branch | Head | Status |
|---|---|---|
| wip/lead-sessions | bc20806 | Session length chosen at every login (traders 2/4/6/12 h, vendors 2/6/12/24 h, drop-down, nothing preselected); "Stay logged in?" extend with any login method; no absolute max. Prompt wait OPEN (draft 2 min). |
| wip/lead-hold-v3 | ef29c2a | Password-only change to login methods / wallets / member on-off/permissions → changes queued 24 h, nobody logged out, anyone can cancel; strong pre-existing passkey/key/PGP login ends early + discards. Recovery-code login → everyone logged out, unfunded trades cancelled, funded paused ("<name>'s account has a temporary problem"); auto-end 24 h; mods can extend. Reuses wip/lead-p2-recovery-rules @03114fa. SECURITY REVIEW before landing. |
| wip/lead-vendor | 172c5fc | Trader/Vendor (vendor switch needs passkey/key/PGP; only vendors post offers, have teams, pay 1% fee); ban list = usernames, PGP fingerprints incl. subkeys, Jabber accounts (keyed hashes). Must stay compatible with the 3+3 cap. SECURITY REVIEW. |
| wip/lead-design-results | 947f247 | Review `review-lead-design-results-2026-11-01.md`: I1 Block close while busy, I2 kit unify vs main, I3 build Site news bell before enabling dismiss, M2 owner Decision 7 wording, M5, M6. Design reworded Refunded: "X2F fee: None" + "X2F took nothing from you. If you already sent the payment, open a dispute below." Re-review then land. |
| wip/lead-design-fold | 4b0e983 | Review `review-lead-design-fold-2026-11-01.md`: **SAFETY I1** (glance/cover/tabletop must never say "Pay now"/"Send exactly" when payBlock blocks), I2 safety lines on tabletop, M1 double-take on fold remount, M2, M3. Re-review then land. |

**Worker queues:**
- **claude2:**
  - C2-V3: offers screens to v2 batch 3, visuals only (branch wip/second-design-offers-v2, not yet pushed).
  - Task 34 multi-currency on wip/second-p3-task34 @be19e5e: the design note has owner decisions; the lead was asked to review them. Owner confirmed today: instructions per payment type AND currency where they differ. Still to confirm with the owner: no fixed-price offers at all (market ± % only), and contiguous bands (next starts +1 cent / whole units). Design has drawn whole units, 501 after 500.
- **claude3:**
  - P1 proof core (wip/third-p5-proof-core @2a6148e, moving): detector as a safety net, UPI blurred in proofs (not chat), detect 15/16-digit dash-separated and '+'-led numbers, foreign name-label data file.
  - P2 past-rep: accept signatures with an email and store them encrypted, same key for two sites of one account allowed, revoked key can re-claim, strict clock + 4-point help copy, 10/h.
  - P3 C12: overturned trade → its review erased.
  - Review-note numbers with separators allowed up to ~9 digits (card-length refused); ALL personal details incl. UPI refused in notes; feedback form 1 per 30 s per person.
- **Waiting on the owner (not started):**
  - items 42–43 (self-destruct: wip/lead-p7-retention @c06d549);
  - the watcher (Tasks 9 / 9-view / 10, on hold);
  - proof envelope C7 @a8d9dab and smart check C8 @d85f859: land with proof core;
  - item 62 card behaviour (owner: "no excuse for underpaying; seller decides; nothing prompts") — interpret as no new card prompt, and confirm;
  - items 63/64 are now POP-UPS to the proof poster (screens later);
  - item 65: disclaimer + mods may request video evidence from both parties;
  - docs pass: wip/second-docs-1030-answers @e286489, do ONE big docs pass later.

## 3. Owner decisions (latest; full record: `owner-answers-2026-10-30-lead-window.md` bottom, `owner-answers-2026-11-01-claude3.md`, Task 34 note, design `docs/design-hold-model-2026-11-02.md`)

**Login and recovery**
- Login strength table: artifact 9J57ypxmiJXQUdsJTxLKhT.
- Username + display name are required.
- Authenticator-only and username-only logins are not allowed.
- Strong passwords are enforced by a meter.
- Recovery code: ONE 16-character code, required at signup (tick, then type it back), replaced after use with a reminder.
- Sensitive actions need a passkey, security key or PGP (an authenticator is not enough).

**Devices and team**
- Device approval is for the lead only. An unapproved device simply can't log in.
- With no other device, log in with a passkey, security key or PGP.
- The lead can have up to 3 devices. Members don't count toward the 3.
- The lead approves a member's first login and can log out one member or all members.
- Team members: vendors only, granular per-member permissions with presets; no auto-accept ever.

**Offers and trades**
- One ad covers up to 5 currencies and many payment methods. The buyer filters first and picks both; they are locked into the signed terms (the rate too).
- Amount bands are typed per currency, contiguous, with no conversion and no rounding.
- Market ± % only.
- Cap: 3 buy + 3 sell per vendor.
- The button reads "Request to buy XMR".
- Buyer can dispute 30 min after "I've paid" (minimum).
- Buyer can cancel; the trade stays open until the XMR is confirmed back at the seller (option B).

**Reviews and reputation**
- Reviews: stars, badges, and a pre-made or custom comment. No $ weighting.
- A review shows when the trade completes. Skip is final and shows nothing.
- If a trade is overturned, its review is erased.
- The month + year is kept after the self-destruct.
- Opt-in vendor setting "Completed over $X in trades to date" (min $10k; $10k steps, then $100k+, then $50k steps), including PROVEN imported volume.
- OPEN: past-rep stores trade COUNTS, not dollars → add a moderator-verified $ field vs show imported history separately.
- All cancels are grouped into one moderator-only figure.

**Proofs**
- The encrypted unblurred copy is moderator-only, only in a dispute. It is deleted 48 h after the trade ends, or after the appeal window. Traders are told.
- Blur-template DB with field names only, data blank.
- Every uploader is asked whether the blur was right (with a comment box).

**Other**
- Ban list as in §2.
- Feedback: no global cap; 1 per 30 s per person.
- SonarQube local only.

## 4. Open with the owner (ask next)
1. No fixed-price offers at all? (Market ± % only.)
2. Band edges: next band starts at +1 (whole units), as design drew?
3. Past-rep dollar volume: a verified $ field vs separate "N trades verified from LocalMonero".
4. Trading-hold end time: who sets it, default length, where it's shown.
5. claude2's wording / look list: cap sentences, fixed "3", My offers "several currencies" footnote, the v2 caution look on My offers, link hover, XMR unit colour, the Devices wording items.
6. Item 62 interpretation, and items 63–65 screens.
7. Design's OPEN list: `DESIGN-HANDOFF-2026-11-02.md` §5.

## 5. Roadmap (status board https://claude.ai/artifact/3mx5a9ij6MYjQheusWxTqq, v14)
About 6–8 weeks to launch-ready (mid–late Dec), excluding lawyers and an audit. Stages:
1. Finish design fixes.
2. Land built work.
3. New account rules (sessions, hold v3, vendor, permissions).
4. Multi-currency offers.
5. Watcher.
6. Member escrow keys.
7. Staff tools Plan 4 Tasks 4–20 (including the ruling executor, so "coins move at the ruling" becomes true).
8. Reputation rest.
9. Plan 7 privacy and public site.
10. v2 restyle.
11. Plan 6 hardening and apps.
12. E2E regtest, stagenet, final review.

## 6. People, comms, handoffs
- **claude2** (account2 window) and **claude3** (account3 window):
  - The lead writes to `~/x2f-comms/to-second.log` / `to-third.log`; they report in `to-lead.log` (watch it with a Monitor, re-armed every 30 min).
  - Their handoffs: `HANDOFF-claude2-2026-11-02.md`, `HANDOFF-claude3-2026-11-02.md`.
  - After a clear they need a nudge in their window: "read ~/x2f-comms/to-<second|third>.log and your HANDOFF file, then report".
- **Lead helpers' notes:** `HANDOFF-lead-{sessions,hold-v3,vendor,results,fold}-2026-11-02.md`. Helper IDs don't survive a clear; start fresh helpers from those notes.
- **Design session:**
  - The cloud session "Continuation" is being replaced by a fresh one. It reads `docs/DESIGN-HANDOFF-2026-11-02.md` on `wip/design-brief` (head 960a86f+), and will need the owner's one-time trust approval before it can message the lead.
  - Canvas: https://claude.ai/artifact/NRhrWVvBrSwJ1Dt8oxp4eH (v111+). PR #3 is docs only.
  - Every board is on v2. The design backlog is empty except the OPEN list.
- **Screenshot pack:** `apps/web/e2e/design-shots.spec.ts` (`X2F_DESIGN_SHOTS=1`, pass the full path). Send design a pack after each landing batch (owner-approved cadence).
- 2 Nov 07:18: NEW design session is up (cloud, same session id session_01XZAz2tn1YbpoyEtNYuAJim; may list under a new title in ListAgents), on wip/design-brief @09467b6f, nothing in flight.
- 2 Nov 07:19: hold v3 parked at wip/lead-hold-v3 @b5802ec (pushed); note HANDOFF-lead-hold-v3-2026-11-02.md (13 owner questions; next: tsc + holdV3.test, rewrite obsolete coolingOff/recovery/deviceApproval/team tests; trade engine needs a system cancel event). claude2 READY TO CLEAR (HANDOFF-claude2-2026-11-02.md).
- 2 Nov 07:21: results parked at wip/lead-design-results @15126db; note HANDOFF-lead-results-2026-11-02.md (all review items done in code incl. Site news bell; next: full web suite, Playwright, reshoot; check double bell on desktop Buy/Sell).
- 2 Nov 07:23: vendor + ban list parked at wip/lead-vendor @20a8bef (pushed); note HANDOFF-lead-vendor-2026-11-02.md (migrations 017_ban_list, 198_account_type; next: full check; 6 owner questions). MIGRATION NUMBERS to reconcile at landing: hold v3 016, ban list 017, account type 198, reviews 307_traded_totals; recovery-rules branch also used 016 (superseded by hold v3).
- 2 Nov 07:23: foldables parked at wip/lead-design-fold @32f963f (pushed); note HANDOFF-lead-fold-2026-11-02.md (SAFETY I1 + all review items fixed, merged with b6835ee; next: Playwright rerun on 32f963f, then re-review + land).
- 2 Nov 07:24: sessions parked at wip/lead-sessions @756f15d (pushed); note HANDOFF-lead-sessions-2026-11-02.md (next: run coolingOff/auth-client/web/Playwright login+security; 6 owner questions). !! MIGRATION CLASH: sessions 307 (drops idle_hours) vs claude3 reviews 307_traded_totals: renumber one at landing. All 5 lead helpers parked. Waiting: claude3 READY TO CLEAR; reviewers a6a6993 (review-claude2-ready-2026-11-02.md) and a274b05 (review-claude3-ready-2026-11-02.md) may still be writing.
- 2 Nov 07:36: LANDED login-approval v2 -> main line = GitHub main = c3c139e. claude2 review file review-claude2-ready-2026-11-02.md: NEXT land selection after deleting line 50 of its selection-ink.test.ts (I1) [+ M1 inset shadow so chips don't shift]; cap-dispute needs I1 seller tip copy (SellerConfirm.tsx:371, owner wording), M1 maintenance should pause the 30-min wait (measure from confirmBy - confirmWindowMin), M2 cap text from perSide; OWNER Qs: per-method dispute wait? pause stops clock? pause existing >3 offers on deploy? Follow-up for login v2: day-theme contrast of 'Your number' chip (4.05:1).
- claude3 READY TO CLEAR (HANDOFF-claude3-2026-11-02.md); its P1/P2/P3/form-limit branches are WIP pushed before final checks.
- Reviewer a274b05 (claude3 reviews-api + feedback) may still be running -> review-claude3-ready-2026-11-02.md.
- LOCAL ENV: ~/x2f node_modules is stale (no @x2f/staff link) -> run 'npm ci' in ~/x2f before using it for checks (fresh worktrees are fine).
- ALL SESSIONS READY TO CLEAR (lead, claude2, claude3, design; helpers parked).
- 2 Nov (final): LANDED Plan 5 Task 4 feedback (no global cap) -> main line = GitHub main = e7636c7. claude3 reviews-api review (review-claude3-ready-2026-11-02.md): APPROVED WITH CHANGES: I3 add the 6 new routes to NOT_AUTH_CLIENT (auth-client flows.test:150); I1 renumber 307_traded_totals -> 308 (sessions keeps 307); I2 overturn-erases-review not built (add eraseReviewsOfTrade seam + NEEDS_P4_OVERTURN_ERASES_REVIEWS tripwire); M1 'over $X' false at exactly X. Owner Qs: what counts as 'overturned'; after erase is the trade done/skip rows erased; does an overturned trade count in totals; 'over $X' vs '$X+'; does 1-per-30s replace the 5-a-day count too. Form-limit branch wip/third-feedback-form-limit @171b38ad unreviewed.
- 2 Nov 07:59: FRESH LEAD running. Workers back + queued (to-second/to-third). 5 lead helpers restarted (fold, results, sessions, vendor, hold-v3), report to lead. Owner answers today: owner-answers-2026-11-02-lead.md (Task 34 market±% only + whole-unit bands -> claude2 GO after selection/cap; past-rep mod-verified $; trading hold = freeze only when a dispute/ruling is ignored, no end time).
- 2 Nov 08:17: design can message the lead directly (cross-session from session_01XZAz2tn1YbpoyEtNYuAJim) and also writes docs/to-lead.md on wip/design-brief. claude2+3 MAXED (5 helpers each); claude3 started Plan 4 Task 4.
- 2 Nov 08:32: LEAD USAGE LIMIT. State: main still e7636c7. FOLD READY @e02c1e9 (all checks green); independent re-review running -> review-lead-design-fold-round2-2026-11-02.md; land it if APPROVED (merge main, full tests, push both refs, announce). Helpers still running: results, sessions (flagged 'instruction poisoning' = it only updated comments for the owner-confirmed 2-min prompt; still review the whole branch), vendor, hold-v3 -> RESULT sections in their HANDOFF-lead-*.md. claude3 STALLED since 07:46 (no ack of the 08:02/08:25 queue); owner asked to restart it. claude2 maxed (5 helpers). Owner answers: owner-answers-2026-11-02-lead.md. Next owner Qs: design #1 presets, #10, #12, #7; fold Q1-Q4; claude2 wording list; P7 I1/I2 (review-p7-retention-2026-10-30.md:13,18).
