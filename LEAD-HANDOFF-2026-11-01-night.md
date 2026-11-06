# Lead handoff, Sun 1 Nov 2026, ~21:45 PT (read this first, then LEAD-HANDOFF.md section 0)

## 0. Owner rules (non-negotiable)
- Owner = single contact; workers report to the lead only (to-lead.log).
- NO decisions on function (what the app does) or design (how it looks/reads) without the owner. Code/engineering (merges, tests, structure, landing approved work) is the lead's. Memory: feedback-no-important-calls.md.
- Owner handed VISUAL calls to the design session ("Continuation", cloud). Design decisions made with the owner while the lead was offline (from 2 Nov 00:22 UTC) OVERRULE earlier ones (docs/OWNER-NOTE-2026-11-02-design-decisions-overrule.md on wip/design-brief).
- Owner wants lots of work running in parallel; keep claude2 + claude3 busy; push after every step.

## 1. Repo state
- Main line origin/claude/compassionate-johnson-k95ssr = GitHub main = 0c0f9ac (fast-forwarded main from ed96147 today; keep pushing HEAD to BOTH refs on each landing).
- Landed today: Task 18 team members (9b26423), Plan 4 staff core (52b7a0e), myOffers test flake (d77134d), SonarQube fixes (e7dd94c), attestation flake (bd5a077), escrow "tap commits only after save" (0c0f9ac).
- Backups of stale dirty worktrees: backup/{lead-t29,p3-task28,rv-staff2,rv-t16}-2026-11-01.
- Local SonarQube: 127.0.0.1:9000, `~/x2f-comms/tools/sonar-scan.sh`, secrets in ~/x2f-comms/secrets/ (never push). Cloud app uninstalled by owner.

## 2. In-flight branches and LANDING ORDER
1. **wip/second-design-devices** (claude2) @acc14ae+: LoginApprove/ApproveOnDevice/Devices to boards; review review-second-design-devices-2026-11-01.md = approve after I1 (done in 769a7cd: Log out all team members, M1, M2). Land when claude2 reports its final tests green. Adds kit: FlowScreen, Choice(Group), Switch, Notice, Meter, Disclosure, Button danger-outline.
2. **wip/lead-design-myoffers** (lead helper) @54ab006+ : review APPROVED WITH MINOR (fixed). Design calls being added (Paused · trading hold chip + Notice, CantDoThat hold wording, current tab surface-raised, cap line, Post blocked during trading hold). THEN merge main (after devices) and UNIFY Switch/Notice with devices' (keep myoffers Switch API + devices' a11y name/focus ring/knob; Notice = one component with tone/icon/live, or rename devices' one CautionNote).
3. **wip/lead-design-fold** @a0552ee: review review-lead-design-fold-2026-11-01.md = CHANGES REQUESTED. **I1 SAFETY: the glance/cover/tabletop can say "Pay now"/"Send exactly" while the device says don't pay** — take the warning from payBlock/payBlockText (payModel.ts:162), test escrow-checking + total-mismatch. I2 tabletop hides "Pay from an account in your own name" + gift-card warning. M1 folding remounts quote -> double take risk (keep in-flight guard in useTake). M2 saved amount keyed per offer. M3 fold/unfold tests. Rebase onto myoffers after it lands (conflicts MyOffers.tsx, model.ts, ui.css, design-shots.spec.ts, shot 54). DO NOT LAND until I1/I2/M1 fixed. Helper ae07b76c1986dd372 finished; start a new helper with the review file.
4. **wip/lead-design-results** @661653a+: review running/finished -> review-lead-design-results-2026-11-01.md. Helper a60aa00ddafd284e8 applying design calls (name the seller, feedback hints, News one-at-a-time + "Don't show me this again", Refunded dispute as danger text button, mono dated rows) + dispute 30 MIN after "I've paid" (if the API refuses earlier, don't change API; UI follows server; list follow-up).
5. **wip/third-design-fixes-a** (claude3): cancel wording/flows, DisputeRuling copy, CantDoThat -> v2 batch-2 shared dialog. Built on devices' kit.
6. **wip/second-design-selection** (claude2) @b50fb03: no orange for selection anywhere.
7. Then v2 visual branches per batch (claude2 next: wip/second-design-loginapprove-v2 from main after devices lands).
- Kit duplicates must be unified at each landing (Switch, Notice, Checkbox, SelectCard vs PickButton vs ChoiceGroup share ONE selection style in ui.css; danger-outline button; disclosure/fold-away; design-shots.spec.ts exists on several branches).
- Every landing: review first, merge main, full web+api tests, Playwright (--workers=1, X2F_CHROMIUM_PATH=/usr/bin/chromium, flock ~/x2f-comms/check.lock), copy-lint, typecheck; push to both refs; announce new main in to-second.log/to-third.log.

## 3. Also not landed (waiting on owner answers)
- claude3: reviews API (C4 @7cbf2d0, items 26-28,31), proof core/envelope/smart check (C5 b5e85cf, C7 a8d9dab, C8 d85f859; items 29-30,34-37,62-65), past reputation (C9 8ddbd4d; items 70-76 + lead calls 1-3), feedback (wip/landing-p5-feedback @fa5542b; owner said NO cap -> remove FEEDBACK_GLOBAL_DAILY; item 33 week-vs-day).
- claude2: Task 34 flexible offers @481c0d3 (items 11, 23, 24; ALSO must now become multi-currency + multi-method per ad), docs @e286489 (hold for one big docs pass).
- lead: recovery rules @03114fa (superseded largely by the new hold model; rework), Plan 7 retention @c06d549 (items 42-43; proof copy retention new), Task 9/9-view/10 watcher (on hold).

## 4. Owner decisions today (full text: owner-answers-2026-10-30-lead-window.md bottom + design branch docs/design-hold-model-2026-11-02.md)
- Login strength table (x2f-login-strength.html, artifact 9J57ypxmiJXQUdsJTxLKhT); TOTP-only login NOT allowed; username-only NOT allowed; strong passwords enforced by meter; recovery code = ONE 16-char code, required at signup (tick + type back), replaced after use.
- Sensitive actions (end hold early, no-approval login, team invites/roles/on-off, become vendor) need passkey/security key/PGP; TOTP not enough.
- Hold model v3: password-only change = changes wait 24 h, nobody logged out, anyone can cancel them, owner notified everywhere, strong pre-existing method ends early (discard). Recovery-code login = everyone logged out; unfunded trades cancelled; funded paused, partner told "<name>'s account has a temporary problem"; mods can extend/vet; auto-ends 24 h.
- Device approval: lead only; unapproved device just can't log in; no other device -> log in with passkey/security key/PGP; lead up to 3 devices; members don't count; lead approves members' first login; lead can log out one/all members.
- Sessions: chosen at EVERY login (drop-down, none preselected): traders 2/4/6/12 h, vendors 2/6/12/24 h; at expiry "Stay logged in?" confirm with any login method; no fixed max.
- Trader vs Vendor accounts (vendor switch needs passkey/key/PGP; only vendors post offers, have teams, pay 1% fee). Team members vendors only, granular per-member permissions with presets; no auto-accept ever ("accept trade" a member permission); ban list = usernames, PGP fingerprints, Jabber accounts.
- Offers: one ad lists many currencies + payment types; buyer picks both at trade start, locked in; type rules come with the type; cap 3 buy + 3 sell per vendor; tier amounts converted to chosen currency. Dispute available 30 MIN after "I've paid" (min).
- Proofs: encrypted unblurred copy, mod-only, only in a dispute; deleted 48 h after trade end or after appeal window; traders told (exact line in LEAD-HANDOFF.md).
- NOT YET APPROVED TO BUILD: all the new behaviour above (vendor, permissions, sessions, hold v3, ban list, multi-currency ads, cap, dispute-30-min API). Ask the owner for a go; then plan API tasks.

## 5. Open questions for the owner
- owner-questions-2026-10-30-morning.md items still open (see "exact remaining questions" numbering in the conversation: reviews 5-8, blurring 10-13, self-destruct 14-15, older confirms 28-36), 66-80.
- Design OPEN items (design session tracks them): incident ID format, Matrix/Telegram addresses, member presets, "Stay logged in?" wait, vendor switch-back, blur-template blanking, etc.
- Fold review questions 1-4 (amount carry-over, tabletop back link, offline offers pickable, ring for ticked vs shown).

## 6. People and comms
- claude2 (account2, window), claude3 (account3, window): files to-second.log / to-third.log; they report in to-lead.log. They stop watching when paused; owner nudges with "read your to-…log and get going".
- Design session "Continuation" (cloud): SendMessage to "Continuation"; it replies via send_message into this session. Canvas https://claude.ai/artifact/NRhrWVvBrSwJ1Dt8oxp4eH ; branch wip/design-brief (v2 batches 4b355a56, 0955ab95, 84aceaa9, 87b07ff6; latest bb4982b5+). PR #3 is docs-only.

## 7. UPDATE 2 Nov ~01:55 PT (lead hit usage limit again)
- Main line + GitHub main = 5bfb450 (landed since: devices 850052d, My offers 5bfb450 with ONE kit Switch + ONE Notice).
- Ready/near-ready to land (each needs: merge main, tests green; reviews noted):
  * wip/second-design-selection @736e1c64 (claude2): NOT yet reviewed -> start a review, then land.
  * wip/third-design-fixes-a (claude3 C11): review review-third-c11-2026-11-02.md; claude3 helper fixing I1 (ruling copy "will be sent", gate untouched), M1/M2 swipe, N1-N3. Land after.
  * wip/lead-design-results (helper a60aa00ddafd284e8; resume with SendMessage if cut off): review review-lead-design-results-2026-11-01.md; fixing I1 Block close, I2 kit unify vs main 5bfb450, I3 build Site news bell before enabling dismiss, M2 owner Decision 7 wording, M5, M6. Land after.
  * wip/lead-design-fold (helper af75ecfa64525d12d): fixing SAFETY I1 (no "Pay now" when payBlock), I2, M1 double take, M2, M3; merge main 5bfb450. Don't land until fixed + re-reviewed.
- Building (lead helpers, resume via SendMessage if cut off): sessions a902972b23fd05875 (wip/lead-sessions), hold v3 ae33c869d67c69f06 (wip/lead-hold-v3), vendor+ban list a5ffac8e098780785 (wip/lead-vendor). Each needs a security review before landing.
- claude2 queue: LoginApprove v2 (wip/second-design-loginapprove-v2), C2-A1 API cap 3 buy + 3 sell + dispute 30 min after paid (+ trading-hold end time), C2-A2 multi-currency flexible offers on wip/second-p3-task34.
- claude3 queue: C12 reviews (no weighting, month+year, Skip review shows nothing, review shows on completion), C12b opt-in volume line, C13 remove feedback cap.
- Owner answers 2 Nov: ad button "Request to buy XMR"; all cancels grouped into one moderator-only figure; volume line includes PROVEN imported volume; skipped review still counts as completed.
- OPEN with owner: past-rep claims store trade COUNTS not dollars -> (1) add a moderator-verified "$ traded" field to claims, or (2) show imported history separately (e.g. "250 trades verified from LocalMonero") and keep the $ line X2F-only. Until answered, imported volume = $0.
- Design session: every board on v2 (wip/design-brief, latest bffb3466+); handoff docs/DESIGN-HANDOFF-2026-11-02.md. Pending design answer: Refunded "Charged to you: Nothing" vs "Did you send the money anyway?" wording; proof slot after "I've paid".
- Status board artifact: https://claude.ai/artifact/3mx5a9ij6MYjQheusWxTqq (v14, includes history + roadmap 6-8 weeks).
