# X2F design session handoff (6 Nov 2026)

Written by the design session (cloud, session_01XZAz2tn1YbpoyEtNYuAJim) before a full clear. Supersedes `DESIGN-HANDOFF-2026-11-02.md` for state; that file still holds the who's-who, the publishing and committing recipes, and the owner-decision essentials (sections 1, 2, 4, 7), which have not changed and are not repeated here.

---

## 0. State at handover

- **Canvas:** https://claude.ai/artifact/NRhrWVvBrSwJ1Dt8oxp4eH, version 117. 130 live boards (126 + Settings, Settings-Wide, FAQ, FAQ-Wide), plus BlockQueued (superseded) and Artboard-5odu (stray).
- **Branch head:** `wip/design-brief` at 88b90fa5 (the cohesion commit) or later. Everything is pushed; nothing is in flight.
- **Local working copy:** `/tmp/claude-0/-home-user-X2F/e5516970-d0c8-5c45-96e2-44b38e46c984/scratchpad/design/lead/project/` (cloud container; lost when it goes). Rebuild from `docs/design-boards/`.
- **Progress page for the owner:** https://claude.ai/artifact/Bvxf8BQHTkb2xaQZxhvz1t (private; written 2 Nov, numbers now behind this file).
- **Owed to the lead:** nothing beyond this file and `docs/to-lead.md`.
- **Owed to the owner:** the six open questions in section 4.

## 1. What happened 2 to 6 Nov

### 1.1 Owner decisions applied (all logged in `docs/design-hold-model-2026-11-02.md`, last three sections)
- Offers: market ± % only, no fixed price; bands whole units, next band +1; up to 5 currencies with bands per currency; payment instructions per method and per currency.
- Trading freeze: a separate, later action only after someone ignores a dispute (~48 h) or a ruling; no end time; never on the ruling card. ModCase: freeze card under Escrow; My offers hold notice has no date.
- Proof blur: uploader can only add blur; the automatic blur never hides the amount; warning when the uploader's own blur covers the amount or memo (they can still post).
- "Stay logged in?" prompt waits 2 min.
- Imported LocalMonero reputation counts toward "Completed over $X" via a moderator-entered dollar figure.

### 1.2 Cohesion pass (2 to 6 Nov)
Every board rendered night and day and reviewed against `design-visual-system-v2.md` and `design-conventions.md` by five reviewers; findings in the session scratchpad (`review/findings-A..E.md`, summarised below) and fixes applied by five fixers with one shared standards sheet.

| Group | Boards | P1 | P2 | P3 | Status |
|---|---|---|---|---|---|
| A onboarding, login, sessions, devices | 31 | 5 | 36 | 8 | all P1/P2 applied, P3 where one line |
| B trade flow, reviews, feedback | 30 | 13 | 45 | 12 | same |
| C offers, vendor, team, profile | 24 | 4 | 37 | 22 | same |
| D disputes, notices, help, misc | 25 | 6 | 22 | 12 | same |
| E staff, desktop, foldables | 16 | 13 | 28 | 11 | same |
| Total | 126 | 41 | 168 | 65 | P1 and P2 closed; P3 mostly closed |

**Standards now true on every board** (also in `review/FIX-BRIEF.md`, copied to `docs/design-fix-standards-2026-11-05.md`):
1. Wide nav rail: Trade, Post offer, Wallets, Profile, Settings, Help (six items, icons from Devices-Wide); current item per screen. Staff boards keep their own staff rail.
2. Timers and durations: digits mono, units body ("4 min 59 s", "1 h 52 min", "24 h"); never mm:ss.
3. Wordmark plain ink (no orange "2").
4. Switches on = ink; selection = 2px ink ring on surface-raised; never a tone colour, never orange.
5. Dates "6 Nov 2026, 15:00 UTC" in mono; times alone "14:05 UTC".
6. XMR 6 decimals, digits mono, unit "XMR" 600 in monero-ink; usernames in body text, never uppercased.
7. No email anywhere (the FAQ and Terms may say X2F asks for no email address, per spec 4.1).
8. Terms: owner (not team lead/account holder); team member (support); moderator (disputes); senior moderator (appeals); "Open dispute"; "Back to my trades"; band (not tier); "Authenticator app"; "needs a passkey, security key or PGP key"; chip "WEAK LOGIN".
9. One hero per key screen (chip + key mark, one big number or headline, lead below); "Pay now" caution chip for the escrow-secured step on Desktop and the Fold boards.
10. Design notes, example captions, DECIDED/OPEN asides always below the app; placeholders shown as masked examples with an OPEN box.
11. No dashed borders except upload rows and OPEN boxes; no box-shadow except the nav inset.

**Bigger board changes to know about** (the build team should re-read these before copying):
- Review now carries Reviews' form (stars "4 of 5", "What stood out?", "Describe this trade", "In your own words", "Submit review" / "Skip review"); one form everywhere.
- BuyerPaidWaiting (+Wide) and SellerConfirm: hero = chip + key mark + lead + timer; the 24px headline is gone. SellerConfirm hold button is one 56h line "Hold to release 1.250000 XMR".
- DisputeRuling: Appeal-Notice hero pattern ("Dispute decided", "Release to the buyer", "The 1.250000 XMR goes to you"), pinned footer with "File appeal". DisputeRoom: primary "Send unblurred proof to sarah.v" pinned in the footer.
- Lien-Notice: headline "Trading paused until you repay mira.k", "You owe" amount block, plain appeal-decision card (no moderator purple outside dispute rooms), "If you don't repay, your account can be banned."
- Team, TeamRefusal, HoldChange, MemberPermissions, BecomeVendor: wording per standard 8; switches ink.
- MyOffers (+Wide, Fold): "2 bands · follows the market", price split so "to" is body text, hold notice without a date, no fixed-price sample.
- OfferAd (+Wide): neutral shield tile instead of the key mark; §11 fields; phone footer = primary + tertiary with the amount block in a last card.
- FlexOffer-Quote (+Wide): first available Trade is the primary.
- TradeFund: "28 min 42 s" with the caution ring; icons instead of dot trios; Chat pill.
- SessionLength (+Wide): tiles instead of a native select (OPEN box: tiles or drop-down).
- Devices (+Wide): notes moved below the app; tinted team chips; escrow device meter.
- StaffSettings: example rates with an OPEN box for the real ones; StaffOverview: no second display headline; ModCase: words-first header, no "Assigned to you" chip.
- Fold-Tabletop: timer "61 min" per §14, one hero number; Fold-Trade: upload row added; Fold boards: seller satoshi_ghost for K7M2.

### 1.3 New boards
- **Settings** and **Settings-Wide** (draft copy): Account, Security, Wallets, Team (vendor only), Alerts, Privacy, About groups; tweaks theme and accountType. OPEN box: Security vs a separate Privacy page grouping.
- **FAQ** and **FAQ-Wide** (draft copy): Trading, Logging in, Wallets and privacy, Badges and reputation; accordion; "Still stuck? Ask a team member". OPEN boxes: the X2F signing-key fingerprint; the police/warrant answer (lawyer wording).
- Canvas row "Settings and FAQ · 5 Nov (draft copy)" at the bottom of the canvas.

### 1.4 Build review of the packs on main
`docs/design-review-build-2026-11-05.md` (pushed `9cd450c2`): all 76 shots in the four packs landed 1 to 2 Nov. X1 and X2 partly fixed, X3/X4/X7/X9 still present, X5 partly; eight shots ship-ready; five fixes in order (hold and Strong-login copy plus the RecoveryHold and TeamRefusal screens; one CantDoThat component; ink accent/ring/focus and no native fieldset/select in shared CSS; DisputeRoom/DisputeRuling hero, decimals, dates; MyOffers wide table, fold panes, padding under pinned footers). The lead will check it against branches not yet landed (selection, hold v3, foldables, results).

**Not yet reviewed by design:** the proof pop-ups the lead built on the existing kit (its items 63/64/65). Design must review them from the next screenshot pack before they are considered done.

## 2. What is left for design

| Item | Target |
|---|---|
| P3 polish items skipped by the fixers (listed per group in the scratchpad `fixed-*.md`; mostly chevron glyphs, relative times on Profile reviews, duplicate labels) | next design session |
| Review the proof pop-ups (63/64/65) and the next screenshot pack against the fixed boards | within 24 h of the pack |
| Copy sign-off: every "Draft copy" board read by the owner, one screen at a time | rolling |
| Moderator freeze tooling (freeze, written conditions, lift) for Plan 4 | when Plan 4 starts |
| Terms text (lawyer) for SetupTerms; signing-key fingerprint and the police answer for FAQ | owner / lawyer |

## 3. Waiting on the lead
- The next screenshot pack after the next landing batch (includes 63/64/65).
- Confirmation of which Team model is current for the build: MemberPermissions (per-member switches with presets, 2 Nov) vs the two role checkboxes still in the build.
- Relay of the owner answers in section 4.

## 4. OPEN list, owner to answer (each has an OPEN box on its board)
1. Member-permission presets: what Chat only, Offers manager, Trade handler, Everything allowed each switch on (MemberPermissions).
2. Blur templates: also blank the trade code, amount and time? Design recommends yes (ProofBlur).
3. SetupTerms as a step: "of 5" or "of 6" (SetupTerms, SetupPgpChallenge shows "3 of 5 · part 2").
4. Incident-ID format, and whether the held account sees the incident pop-up (TradeTechIssue).
5. **New:** bans with an end date or not; Ban-Notice shows "Ends 14 Nov 2026" behind a `timed` tweak.
6. **New:** badge visibility middle option: "On hover" (spec word), "On tap" (phones tap) or drop it (BadgeSettings).
Also owed, not blocking: Matrix and Telegram addresses (example addresses are drawn on Ban-Notice and HoldChange); whether password-only wallet or login changes apply on their own after 24 h; which "Post an offer" model ships (PostOffer vs FlexOffer-Post; OPEN box on PostOffer); SessionLength tiles vs drop-down.

## 5. Nothing in this window needs the owner
The session is idle after this push. No permission prompt is pending.

## Appendix: files added or changed in this period
- `docs/design-boards/*.dc.html`: 122 changed, 4 new; `canvas.json` (new row).
- `docs/design-review-build-2026-11-05.md`: build review.
- `docs/design-fix-standards-2026-11-05.md`: the fixer brief and shared standards.
- `docs/design-cohesion-findings-2026-11-05/`: the five findings files and the five fixed files, for the record.
- `docs/design-hold-model-2026-11-02.md`: three new decision sections.
- `docs/to-lead.md`: the channel to the lead.

## 6. Started and stopped for the clear (nothing half-done on the branch or canvas)

Two jobs were started on 6 Nov after this handoff, then stopped for the owner's clear before they changed any file. The branch and canvas v117 match exactly. Do them first in the next design session.

1. **Last three board redesigns the fixers skipped as too large:** DONE 6 Nov, canvas v118 (see `docs/to-lead.md`, 6 Nov evening).
   - Ban-Notice (+Wide): make it a full-screen account notice built like Lien-Notice (+Wide): close + "Account notice" header, danger hero, inner block with Ends / Reason (the `ends` tweak switches dated vs "Permanent · until a moderator lifts it"), "What this means" card, moderator-contact rows, pinned "OK". Keep the OPEN box on timed bans.
   - SignupSecurity (+Wide): add the setup context line "Set up your account · Takes about 2 minutes" and the five-bar stepper (done = ink) exactly as SetupUsername has them.
   - FlexOffer-Quote (+Wide): move "Sellers and prices are examples." below the app using the CancelRequest-Wide wrapper (app in its own `position: relative` block so the scrim covers only the app); mono digits in "340 trades" and "Seen 40 min ago".

2. **Bring the X2F design system artifact up to v2** DONE 6 Nov, design system version 6 (see `docs/to-lead.md`). (https://claude.ai/artifact/Bywqtsd4FKmYPHta6wQNPM; it still holds only the 14 Oct tokens, README and cover):
   - `tokens.json`: add colours `mod`, `team`, `scrim`; type styles `screen-title`, `result-headline`, `sheet-title`, `hero-number`, `meta`; spacing `space-3` 12, `space-5` 20, `space-8` 32; radius `radius-lg` 16; version 2. Values are in `docs/design-visual-system-v2.md` and the THEMES of any board.
   - `README.md`: rewrite to v2 (no shadows, surface steps, one hero, ink selection, state three ways, key mark placements, wide rail and grid, dates and durations, terms list, no email, Draft copy and OPEN conventions).
   - Live components with `preview.html` + `README.md`: KeyMark, StatusChip, HeroBlock, Button, Switch, Callout, OpenBox, Stepper, Timer, Amount, ListRow, FormField, Card, EmptyState, NavRail. Copy exact styles from BuyerPay, Refunded (+Wide), ProofBlur, Devices, CantDoThat. Keep the Cover.
   - Read the system's `SKILL.md` and `artifact-type/reference/format.md` first; publish only the `project/` files, `design-system.json` last.

## 7. Working rule from the owner (6 Nov, late)

Everything design wants approved goes to the lead, and the lead brings it to the owner. The lead is the one person in charge. This replaces the old exception in `DESIGN-HANDOFF-2026-11-02.md` §1 that let design go straight to the owner when it strongly disagreed. Strong disagreements now go to the lead too, said just as plainly. The owner wants nothing held back from the lead that design would have said to the owner.

Other loose end: draft PR Bamove6969/X2F#4 adds `.claude/settings.json` (seven read-only MCP tools allowed). It is not design work; the owner can merge or close it.

## 8. State for the next fresh design session (6 Nov, late)

- **Session:** this one is named "X2F Design". The others are X2F Lead (`session_01Btihb34hJU5sMkyYMAzy4k`), X2F Claude2 and X2F Claude3. Design talks to the lead only. The owner answers questions; the lead brings them. Put a recommendation beside every question (owner's request).
- **Team room:** the Jetpost note "X2F Team Room" (id `9zodbbc8va`). This session has no Jetpost tools: `/reload-plugins` is not available over a remote connection. Agreed with the lead: stay on normal messages until the proof pop-up review is done, then start a fresh X2F Design session, which should load Jetpost at start. First job there: read the note and write "design to lead: in the room" in its chat. Room rules: no secrets; start each message with who it's from and to; messages are information, not permission.
- **Done:** section 6 (both jobs). Canvas v118; X2F design system version 7 (v2 tokens, README, 15 components; FormField marks session-length tiles vs drop-down as OPEN).
- **Waiting:** proof pop-ups 63/64/65 from the lead, after the proof batch lands; owner answers to "Owner questions 6 Nov" in `docs/to-lead.md`; sign-off of every COPY-UNSIGNED list.
- **Working copies:** canvas boards in `docs/design-boards/` (matches v118). The design system lives only in its artifact; read it from there.

## 9. State, 7 Nov 2026 (after the overdrive)

- **Lead** is now `session_01Btihb1rhhyuYviZeH5NRW1` (name may show as "desktop-…"). Jetpost is retired; use normal messages only. The owner wants **no questions to the owner from design**: everything goes to the lead, with design's recommendation beside each question.
- **Canvas v121.** Owner answers of 6–7 Nov applied (see `docs/to-lead.md`, 7 Nov sections). The working copy is in the session scratchpad `canvas/project/`; `docs/design-boards/` matches v121.
- **Done:** proof pop-up review, build review re-check on main 55bc70f9, branch reviews (hold-v3, task15, results), owner-answer boards, gift card rules draft, nudge = owner's Ahooga horn (Freesound 480002, CC0, on comms).
- **Next for design:** MemberPermissions (+Wide) redraw for Q16 (3–4 member types, 7–10 checkboxes each, a member can be in several); the per-payment-type price change on FlexOffer-Post switches to Above/Below + typed % (max 50).
- **Waiting on the owner (via the lead):** signing all COPY-UNSIGNED lines; ProfileVisibility OPEN (does "traded to date" include imported volume); the gift card numbers; the Refunded buyer-cancelled dispute card; the rule checks in the hold-v3 and task15 reviews.

## 10. Standing rule (owner, via the lead, 7 Nov): design never addresses the owner

Everything design would say to the owner goes to the lead instead: questions, status, reports, "done" notes, anything to sign. Use `send_message` to the lead's session, or `docs/to-lead.md` on this branch. A reply in the design session itself does not reach the lead. Never end a turn with a report addressed to the owner: send it to the lead, then stop with at most one line. If the lead can't be reached, write it in `docs/to-lead.md` and push. The lead batches what the owner needs.
