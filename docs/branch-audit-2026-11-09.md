# Branch audit 2026-11-09 (claude2)

Proposals for the lead. Nothing was deleted by this audit; the lead decides and deletes.

Basis: `git fetch origin --prune`, origin/main = `22b379e8`, 111 remote branches (excluding HEAD). Ages measured against 2026-11-09 12:00 UTC.

Rules applied: MERGED (0 commits not in main) and SUPERSEDED (all patches in main by content) are proposed for deletion. ACTIVE, HELD, STALE and PROTECTED are kept. main, comms, claude/* and any branch whose head subject is READY:/BLOCKED: and under 2 days old are never proposed for deletion.

## Summary

| Class | Count | Proposal |
|---|---|---|
| MERGED | 34 | delete |
| SUPERSEDED | 3 | delete |
| HELD | 2 | keep |
| ACTIVE | 63 | keep |
| STALE | 4 | lead decides |
| PROTECTED | 5 | keep |
| Total | 111 | |

Proposed deletions: 37 (MERGED 34 + SUPERSEDED 3).

## Per-branch table

Columns: in main = head contained in origin/main; ahead = commits not in main; uniq = of those, patches not in main by content (git cherry `+`).

| Class | Branch | Head | Last commit | In main | Ahead | Uniq | Author | Last subject | Reason |
|---|---|---|---|---|---|---|---|---|---|
| MERGED | `wip/lead-batch4` | `e667c3ce` | 2026-11-06 | yes | 0 | 0 | flem <<bamove@gmail.com>> | Merge claude/task-z23obx @9a02a61a into the landing batch | head is contained in origin/main |
| MERGED | `wip/lead-design-fold` | `e02c1e98` | 2026-11-02 | yes | 0 | 0 | flem <<bamove@gmail.com>> | test(web): ui.css rule lookups also find a selector inside a selector list | head is contained in origin/main |
| MERGED | `wip/lead-exact-send` | `a6d81fd0` | 2026-11-08 | yes | 0 | 0 | flem <<bamove@gmail.com>> | fix(web): phone wallet hint keeps exactXmr per the TradeFund board; e2e: a 12-place amount | head is contained in origin/main |
| MERGED | `wip/lead-land` | `22b379e8` | 2026-11-09 | yes | 0 | 0 | flem <<bamove@gmail.com>> | e2e: Main and BuyMain parity exceptions for the X2F wordmark (the header shows logo D; own | head is contained in origin/main |
| MERGED | `wip/lead-land-t9io-held` | `36e728a3` | 2026-10-30 | yes | 0 | 0 | flem <<bamove@gmail.com>> | fix(api): the timer loop also reads buyer's cancels awaiting Confirm cancel, so the 48 h a | head is contained in origin/main |
| MERGED | `wip/lead-patch-keeping` | `46bffbaa` | 2026-11-08 | yes | 0 | 0 | flem <<bamove@gmail.com>> | fix(ci): an unscored finding with several advisory ids also fails closed (lead review) | head is contained in origin/main |
| MERGED | `wip/lead-semgrep-cloud` | `d2693f5e` | 2026-11-08 | yes | 0 | 0 | flem <<bamove@gmail.com>> | Merge remote-tracking branch 'origin/main' into wip/lead-semgrep-cloud | head is contained in origin/main |
| MERGED | `wip/lead-sonar-action` | `8cfa0d44` | 2026-11-06 | yes | 0 | 0 | flem <<bamove@gmail.com>> | ci: SonarQube Cloud scan of main with the official action, off until the project is set up | head is contained in origin/main |
| MERGED | `wip/lead-vendor` | `bb7616e2` | 2026-11-08 | yes | 0 | 0 | flem <<bamove@gmail.com>> | fix(pgp): keep the proved recipient through the challenge payload; work it out for unknown | head is contained in origin/main |
| MERGED | `wip/lead-watcher-flake` | `c2b74539` | 2026-11-08 | yes | 0 | 0 | flem <<bamove@gmail.com>> | test(moderation): watcher tests stop watching earlier tests' trades (cross-test relay clos | head is contained in origin/main |
| MERGED | `wip/lead-watcher-revive` | `46301028` | 2026-11-08 | yes | 0 | 0 | flem <<bamove@gmail.com>> | test(web): the older-API refundRules case nudges first (merge with main 687ae821) | head is contained in origin/main |
| MERGED | `wip/second-design-offers-v2` | `1e890b13` | 2026-11-06 | yes | 0 | 0 | flem <<bamove@gmail.com>> | Merge main 1c400ea2 (fold, form limit, Sonar) into wip/second-design-offers-v2 | head is contained in origin/main |
| MERGED | `wip/second-design-selection` | `67336d49` | 2026-11-02 | yes | 0 | 0 | flem <<bamove@gmail.com>> | test(web): selection-ink: drop the tab-bar exception (main's tab bar is already ink) | head is contained in origin/main |
| MERGED | `wip/second-p3-task10` | `305124b7` | 2026-10-30 | yes | 0 | 0 | flem <<bamove@gmail.com>> | docs(task10): fix round 3: R3-N1 re-arm, R3-M1 (no withdraw of a handed outcome) and R3-M2 | head is contained in origin/main |
| MERGED | `wip/second-p3-task9-io` | `7346fc00` | 2026-10-30 | yes | 0 | 0 | flem <<bamove@gmail.com>> | docs(review): Task 9 I/O round-3 review copied in, with its fix-round-3 section (fix, file | head is contained in origin/main |
| MERGED | `wip/second-p3-task9-view` | `99ba09fc` | 2026-10-30 | yes | 0 | 0 | flem <<bamove@gmail.com>> | fix(timers): the API loop also reads a buyer's cancel awaiting Confirm cancel, so its 48 h | head is contained in origin/main |
| MERGED | `wip/third-design-build` | `7f6cafc0` | 2026-11-07 | yes | 0 | 0 | flem <<bamove@gmail.com>> | READY: design build review 7 Nov (web), main d41c8fb1 merged | head is contained in origin/main |
| MERGED | `wip/third-feedback-form-limit` | `70821e98` | 2026-11-06 | yes | 0 | 0 | flem <<bamove@gmail.com>> | fix(api): feedback form gap keeps only "blocked until" and gives it back on a failed inser | head is contained in origin/main |
| MERGED | `wip/third-p4-reverify` | `d41c8fb1` | 2026-11-07 | yes | 0 | 0 | flem <<bamove@gmail.com>> | READY: staff fixes after the lead's 7 Nov review (I-1, I-2, M1, M3, M4, M5) on the re-revi | head is contained in origin/main |
| MERGED | `wip/third-p4-staff-trader-split` | `b8cdef6b` | 2026-11-06 | yes | 0 | 0 | flem <<bamove@gmail.com>> | fix(api): a staff login on the trader site answers exactly as an unknown name (RV5 I1, own | head is contained in origin/main |
| MERGED | `wip/third-p4-task10` | `3d678a33` | 2026-11-03 | yes | 0 | 0 | flem <<bamove@gmail.com>> | feat(api): the dispute view's 24-hour goal (goalAt) beside the 48-hour deadline; schema te | head is contained in origin/main |
| MERGED | `wip/third-p4-task15` | `5b5a5cbf` | 2026-11-07 | yes | 0 | 0 | flem <<bamove@gmail.com>> | READY: Task 15, main d41c8fb1 merged, lead's 7 Nov review done | head is contained in origin/main |
| MERGED | `wip/third-p4-task4` | `eee547f2` | 2026-11-06 | yes | 0 | 0 | flem <<bamove@gmail.com>> | fix(api): RV5 Task 4 minors checked and finished (grants check, kind trigger both ways wit | head is contained in origin/main |
| MERGED | `wip/third-p4-task5` | `896b8e47` | 2026-11-02 | yes | 0 | 0 | flem <<bamove@gmail.com>> | test(api): staff-API tripwires fire on Task 4's staff/app.ts, not on any file under apps/a | head is contained in origin/main |
| MERGED | `wip/third-p4-task5-minors` | `5e3020d2` | 2026-11-06 | yes | 0 | 0 | flem <<bamove@gmail.com>> | fix(api): RV5 Task 5 minors m8-m12 for key taps | head is contained in origin/main |
| MERGED | `wip/third-p4-task7` | `1d1c65e9` | 2026-11-03 | yes | 0 | 0 | flem <<bamove@gmail.com>> | test(api): the migration lists include 205_staff_invites.sql (Plan 4 Task 7) | head is contained in origin/main |
| MERGED | `wip/third-p4-task7-fixes` | `d687cf30` | 2026-11-07 | yes | 0 | 0 | flem <<bamove@gmail.com>> | READY: Task 7 fixes (contains Task 4 + staff split and Task 5 minors; land in one step) | head is contained in origin/main |
| MERGED | `wip/third-p4-task8` | `ac472caf` | 2026-11-03 | yes | 0 | 0 | flem <<bamove@gmail.com>> | fix(api): Plan 3 may set maintenance_since alone (kind reads as emergency); GET /v1/site i | head is contained in origin/main |
| MERGED | `wip/third-p5-past-rep` | `4a687f94` | 2026-11-02 | yes | 0 | 0 | flem <<bamove@gmail.com>> | fix(api): only senior moderators and the owner may enter a verified past-rep figure (owner | head is contained in origin/main |
| MERGED | `wip/third-p5-proof-core` | `210fdf53` | 2026-11-06 | yes | 0 | 0 | flem <<bamove@gmail.com>> | fix(proof): check the RV4 fix round (I1, M1-M3); a whole amount with a marker is guarded t | head is contained in origin/main |
| MERGED | `wip/third-p5-proof-envelope` | `05567436` | 2026-11-06 | yes | 0 | 0 | flem <<bamove@gmail.com>> | Merge proof core 210fdf53 (RV4 I1, M1-M3 fixes) into the proof envelope | head is contained in origin/main |
| MERGED | `wip/third-p5-reviews-api` | `a7a38fdf` | 2026-11-03 | yes | 0 | 0 | flem <<bamove@gmail.com>> | fix(reputation): a traded step needs MORE than the step (owner 2026-11-03) | head is contained in origin/main |
| MERGED | `wip/third-p5-smart-check` | `746133a3` | 2026-11-06 | yes | 0 | 0 | flem <<bamove@gmail.com>> | fix(proof): the smart check reads a whole amount Task 7 keeps clear (review RV4-M4) | head is contained in origin/main |
| MERGED | `wip/third-p5-traded-pastrep` | `1a99f7b9` | 2026-11-06 | yes | 0 | 0 | flem <<bamove@gmail.com>> | fix(api): RV3 M1 (310 trigger bypass only for a null or unchanged verified_usd_by) and M2  | head is contained in origin/main |
| SUPERSEDED | `pc/lead-land-fixer-wip` | `3b248153` | 2026-11-08 | no | 1 | 0 | flem <<bamove@gmail.com>> | WIP (unchecked, helper stopped when the PC lead retired): batch 2 integration, offerUnits/ | all 1 patch(es) already in main by content (git cherry all -) |
| SUPERSEDED | `pc/stash-finding1-kit` | `886a42b4` | 2026-11-08 | no | 2 | 0 | flem <<bamove@gmail.com>> | On wip/lead-job2-kit: finding1 WIP (belongs to another branch) | all 2 patch(es) already in main by content (git cherry all -) |
| SUPERSEDED | `wip/third-p4-task4-split` | `a0cc3766` | 2026-11-06 | no | 1 | 0 | flem <<bamove@gmail.com>> | test(auth-client): the owner is refused on the trader site like an unknown name (owner Q13 | all 1 patch(es) already in main by content (git cherry all -) |
| HELD | `wip/lead-hold-v3` | `b2e97c6c` | 2026-11-09 | no | 51 | 43 | flem <<bamove@gmail.com>> | fix(hold): R-C1 the held buyer's seller can no longer record the buyer's cancel (lead revi | hold-v3 (team hold rights, S-102): re-verify pending, to be merged into wip/lead-team-perms per owner-answers-assignments.md |
| HELD | `wip/second-docs-1030-answers` | `e286489b` | 2026-11-01 | no | 7 | 6 | flem <<bamove@gmail.com>> | Merge main line 52b7a0e into the 10-30 docs branch | Docs pass waiting on owner (HANDOFF-claude2-2026-11-02/05/06: "WAITING ON OWNER"); keep until the lead releases it |
| ACTIVE | `dependabot/github_actions/actions-5fb051b480` | `f41927c0` | 2026-11-09 | no | 1 | 1 | dependabot[bot] <<49699333+dependabot[bot]@users.noreply.github.com>> | ci: Bump the actions group across 1 directory with 2 updates | commit within last 3 days |
| ACTIVE | `dependabot/npm_and_yarn/npm-minor-and-patch-360e1bebc1` | `bbdd5f5b` | 2026-11-09 | no | 1 | 1 | dependabot[bot] <<49699333+dependabot[bot]@users.noreply.github.com>> | deps: Bump the npm-minor-and-patch group across 2 directories with 12 updates | commit within last 3 days |
| ACTIVE | `dependabot/npm_and_yarn/npm-minor-and-patch-c30b68d541` | `0452f715` | 2026-11-09 | no | 1 | 1 | dependabot[bot] <<49699333+dependabot[bot]@users.noreply.github.com>> | deps: Bump the npm-minor-and-patch group across 2 directories with 12 updates | commit within last 3 days |
| ACTIVE | `dependabot/npm_and_yarn/types/node-26.6.5` | `25ef32d6` | 2026-11-09 | no | 1 | 1 | dependabot[bot] <<49699333+dependabot[bot]@users.noreply.github.com>> | deps: Bump @types/node from 24.19.1 to 26.6.5 | commit within last 3 days |
| ACTIVE | `dependabot/npm_and_yarn/vite-8.3.5` | `195ea8c0` | 2026-11-09 | no | 1 | 1 | dependabot[bot] <<49699333+dependabot[bot]@users.noreply.github.com>> | deps: Bump vite from 7.3.7 to 8.3.5 | commit within last 3 days |
| ACTIVE | `pc-archive-2026-11-08` | `8c965b00` | 2026-11-08 | no | 1 | 1 | flem <<bamove@gmail.com>> | PC archive 8 Nov 2026: local notes folder, helper scratch files, demo logs, memory | commit within last 3 days |
| ACTIVE | `pc/rv-door-probe` | `a5645c62` | 2026-11-08 | no | 7 | 6 | flem <<bamove@gmail.com>> | pc archive: reviewer's returnTo probe files from the front-door review (untracked on the P | commit within last 3 days |
| ACTIVE | `wip/design-brief` | `28d45d74` | 2026-11-09 | no | 137 | 137 | flem <<bamove@gmail.com>> | Design: J-34 look-and-feel rulings (G42-G47) | commit within last 3 days |
| ACTIVE | `wip/design-build-followups` | `cf104d65` | 2026-11-07 | yes | 0 | 0 | flem <<bamove@gmail.com>> | READY: follow-ups (1)-(3) merged with main 6ccb3e2d | READY:/BLOCKED: head under 2 days old: never delete |
| ACTIVE | `wip/design-buyerpay-ref` | `b428a1bd` | 2026-11-08 | yes | 0 | 0 | flem <<bamove@gmail.com>> | READY: BuyerPay board and parity reference refreshed for Q12 (escrow=securing) | READY:/BLOCKED: head under 2 days old: never delete |
| ACTIVE | `wip/design-cancelrequest-ref` | `20f7250c` | 2026-11-08 | yes | 0 | 0 | flem <<bamove@gmail.com>> | READY: CancelRequest added to the parity set (G56 "Cancelling is final") | READY:/BLOCKED: head under 2 days old: never delete |
| ACTIVE | `wip/design-repo-orange` | `8daa953f` | 2026-11-08 | yes | 0 | 0 | flem <<bamove@gmail.com>> | READY: repo board copies on Monero #ff6600, all parity references re-captured | READY:/BLOCKED: head under 2 days old: never delete |
| ACTIVE | `wip/design-sellerrefund-ref` | `4938379d` | 2026-11-08 | yes | 0 | 0 | flem <<bamove@gmail.com>> | READY: SellerRefund board and parity reference refreshed for G2 | READY:/BLOCKED: head under 2 days old: never delete |
| ACTIVE | `wip/design-trusted-200` | `b427426e` | 2026-11-09 | no | 1 | 1 | flem <<bamove@gmail.com>> | Design: Trusted 200+ on repo boards, BuyQuote fee rows (OD-4, no deposit), owner PGP requi | commit within last 3 days |
| ACTIVE | `wip/lead-cancel-reversal` | `d422a67f` | 2026-11-08 | no | 5 | 5 | flem <<bamove@gmail.com>> | test(web): SellerRefund parity: the board's retired nudge lock is a known exception (owner | commit within last 3 days |
| ACTIVE | `wip/lead-chat-retention` | `c0af884b` | 2026-11-08 | yes | 0 | 0 | flem <<bamove@gmail.com>> | READY: chat retention review fixes (B1, M1, M2, M3) | READY:/BLOCKED: head under 2 days old: never delete |
| ACTIVE | `wip/lead-chat-shred` | `3eb636b9` | 2026-11-08 | no | 1 | 1 | flem <<bamove@gmail.com>> | WIP: chat shred (helper cut off by the 8 Nov machine reboot; unchecked) | commit within last 3 days |
| ACTIVE | `wip/lead-chat-shred-2` | `7bbda3ab` | 2026-11-09 | no | 8 | 7 | flem <<bamove@gmail.com>> | chore: moderation migration 007 -> 008 (Task 11 holds 007) | commit within last 3 days |
| ACTIVE | `wip/lead-crypto-spec` | `d902281a` | 2026-11-09 | no | 1 | 1 | flem <<bamove@gmail.com>> | J-25: public crypto spec and grant drafts (X-006, X-008) | commit within last 3 days |
| ACTIVE | `wip/lead-demo` | `8855328c` | 2026-11-08 | no | 20 | 16 | flem <<bamove@gmail.com>> | demo: Comment button top-right, 36 px pill in a 44 px touch area, clear of header actions | commit within last 3 days |
| ACTIVE | `wip/lead-demo-shots` | `ddedee7f` | 2026-11-08 | no | 1 | 1 | flem <<bamove@gmail.com>> | docs: real-app screenshots of the demo for design review (partial) | commit within last 3 days |
| ACTIVE | `wip/lead-dependabot-1` | `7e833593` | 2026-11-08 | yes | 0 | 0 | flem <<bamove@gmail.com>> | READY: spikes archival; remove spikes/phase0-browser/package-lock.json (5 Dependabot alert | READY:/BLOCKED: head under 2 days old: never delete |
| ACTIVE | `wip/lead-design-results` | `3e70488e` | 2026-11-08 | no | 105 | 72 | flem <<bamove@gmail.com>> | READY: design-results on trade-rules-p1 1801ffb5 + main 0c6f3f16, heroes on the kit Hero | READY:/BLOCKED: head under 2 days old: never delete |
| ACTIVE | `wip/lead-fold-quote` | `0efa7d38` | 2026-11-08 | yes | 0 | 0 | flem <<bamove@gmail.com>> | READY: fold quote-pane fixes (m1, m2) and the m3 glance fallback on main 5c4c8773 | READY:/BLOCKED: head under 2 days old: never delete |
| ACTIVE | `wip/lead-front-door` | `eb2a86bb` | 2026-11-09 | no | 15 | 13 | flem <<bamove@gmail.com>> | test(api): the route list classifies every method, not only GET (review 6a5949a6 F2b) | commit within last 3 days |
| ACTIVE | `wip/lead-jabber-notices` | `4446e3c5` | 2026-11-08 | no | 6 | 6 | flem <<bamove@gmail.com>> | READY: secure Jabber (XMPP) account-change notices (owner rule p5-7) + dispute notice to t | READY:/BLOCKED: head under 2 days old: never delete |
| ACTIVE | `wip/lead-job1a-paid-gate` | `333b7748` | 2026-11-07 | yes | 0 | 0 | flem <<bamove@gmail.com>> | READY: Q12 paid gate, review 2026-11-07 changes applied | READY:/BLOCKED: head under 2 days old: never delete |
| ACTIVE | `wip/lead-job1b-cancel` | `687ae821` | 2026-11-08 | yes | 0 | 0 | flem <<bamove@gmail.com>> | READY: Job 1 landing unit, 1a (Q12 paid gate) + 1b (cancel rules) with review 2026-11-07 c | READY:/BLOCKED: head under 2 days old: never delete |
| ACTIVE | `wip/lead-job2-kit` | `d7410eb4` | 2026-11-08 | yes | 0 | 0 | flem <<bamove@gmail.com>> | READY: kit round 1 after re-review | READY:/BLOCKED: head under 2 days old: never delete |
| ACTIVE | `wip/lead-land-3` | `be73600a` | 2026-11-09 | no | 96 | 75 | flem <<bamove@gmail.com>> | Merge origin/wip/lead-offer-rules (738f02ee) into batch 3 | commit within last 3 days |
| ACTIVE | `wip/lead-launch-rules` | `17eba0de` | 2026-11-08 | no | 47 | 36 | flem <<bamove@gmail.com>> | READY: launch rules: $5,000 launch cap (p11-6), time to pay per method (p9-6), "can take u | READY:/BLOCKED: head under 2 days old: never delete |
| ACTIVE | `wip/lead-method-dropdown` | `c85dffe9` | 2026-11-08 | yes | 0 | 0 | flem <<bamove@gmail.com>> | READY: method picker after review | READY:/BLOCKED: head under 2 days old: never delete |
| ACTIVE | `wip/lead-nav-p1` | `0fdf498e` | 2026-11-08 | no | 9 | 8 | flem <<bamove@gmail.com>> | test(e2e): block.spec checks the quote before seeding the block | commit within last 3 days |
| ACTIVE | `wip/lead-npm-audit` | `9acf33b1` | 2026-11-07 | yes | 0 | 0 | flem <<bamove@gmail.com>> | READY: npm audit clean (follow-redirects, @fastify/static, check.sh order) | READY:/BLOCKED: head under 2 days old: never delete |
| ACTIVE | `wip/lead-offer-rules` | `738f02ee` | 2026-11-09 | no | 2 | 2 | flem <<bamove@gmail.com>> | Offer cap: 3 buying + 3 selling offers per account (owner Q31) | commit within last 3 days |
| ACTIVE | `wip/lead-offer-units` | `225cfd5a` | 2026-11-08 | yes | 0 | 0 | flem <<bamove@gmail.com>> | READY: offer units review 2 fixes (I1, I2, I3, M1, M2, M4) and the unflagged strings marke | READY:/BLOCKED: head under 2 days old: never delete |
| ACTIVE | `wip/lead-proto` | `c3b7cabd` | 2026-11-09 | no | 9 | 5 | flem <<bamove@gmail.com>> | chore(proto): dispute wait from the method profile, as the API sets it | commit within last 3 days |
| ACTIVE | `wip/lead-quote-bands` | `94360d55` | 2026-11-08 | no | 9 | 6 | flem <<bamove@gmail.com>> | READY: quote bands review 8 Nov (I1 forced-colors focus, m2 :has focus-visible, m5 COPY-UN | READY:/BLOCKED: head under 2 days old: never delete |
| ACTIVE | `wip/lead-release-settle` | `3efabc81` | 2026-11-08 | no | 1 | 1 | flem <<bamove@gmail.com>> | WIP: release settle (helper cut off by the 8 Nov machine reboot; unchecked) | commit within last 3 days |
| ACTIVE | `wip/lead-research-1109` | `60a3e19e` | 2026-11-09 | no | 1 | 1 | flem <<bamove@gmail.com>> | research: time to receive each payment method (109 methods, tiers 60 min to 72 h; owner p1 | commit within last 3 days |
| ACTIVE | `wip/lead-sessions` | `c8c84e7f` | 2026-11-08 | yes | 0 | 0 | flem <<bamove@gmail.com>> | READY: lead-sessions review fixes, e2e/setup.spec.ts 33/33 under pw.lock | READY:/BLOCKED: head under 2 days old: never delete |
| ACTIVE | `wip/lead-signup-team` | `08d96d4d` | 2026-11-08 | no | 3 | 3 | flem <<bamove@gmail.com>> | READY: signup one private username + live tick, recovery-code-only backup; team items held | READY:/BLOCKED: head under 2 days old: never delete |
| ACTIVE | `wip/lead-terms-signature` | `909f87fb` | 2026-11-08 | no | 6 | 3 | flem <<bamove@gmail.com>> | READY: terms signature after security review 2026-11-08 | READY:/BLOCKED: head under 2 days old: never delete |
| ACTIVE | `wip/lead-trade-rules-p1` | `1801ffb5` | 2026-11-08 | no | 36 | 27 | flem <<bamove@gmail.com>> | READY: trade-rules-p1 merged with main 0c6f3f16 (ef5de01e) | READY:/BLOCKED: head under 2 days old: never delete |
| ACTIVE | `wip/lead-wide-shell` | `057887a7` | 2026-11-08 | yes | 0 | 0 | flem <<bamove@gmail.com>> | READY: wide shell review fixes I1 (quote columns shrink, one column under 1232 px), M3 (44 | READY:/BLOCKED: head under 2 days old: never delete |
| ACTIVE | `wip/second-api-cap-dispute` | `5f3d944b` | 2026-11-08 | no | 27 | 22 | flem <<bamove@gmail.com>> | test(api): nudge delivery test waits the 15-minute nudge gap (owner g66/F10) | commit within last 3 days |
| ACTIVE | `wip/second-fold-followups` | `2855529d` | 2026-11-08 | no | 14 | 5 | flem <<bamove@gmail.com>> | READY: wip/second-fold-followups, main cbf8e50e merged | READY:/BLOCKED: head under 2 days old: never delete |
| ACTIVE | `wip/second-gift-cards` | `1518d002` | 2026-11-09 | no | 113 | 87 | flem <<bamove@gmail.com>> | feat(web): gift-card tick-box terms on the post form and the quote, evidence checklist in  | commit within last 3 days |
| ACTIVE | `wip/second-offer-rules` | `32744fdd` | 2026-11-09 | no | 8 | 7 | flem <<bamove@gmail.com>> | READY: J-02 fixed-price offers removed end to end (API, DB guard 345, take, chat, browse,  | READY:/BLOCKED: head under 2 days old: never delete |
| ACTIVE | `wip/second-p3-task34` | `c2d1006c` | 2026-11-02 | no | 32 | 24 | flem <<bamove@gmail.com>> | docs(task34): owner settles band coverage as built (200-500 covers 200.00-500.99; top band | named as current job in owner-answers-assignments.md |
| ACTIVE | `wip/second-p3-task34-web` | `488a5a71` | 2026-11-06 | no | 50 | 36 | flem <<bamove@gmail.com>> | docs(design-screens): reshoot the PostOffer shots 61, 72, 72b after the Task 34 web fix ro | named as current job in owner-answers-assignments.md |
| ACTIVE | `wip/second-price-feeds` | `988d88f4` | 2026-11-09 | no | 9 | 7 | flem <<bamove@gmail.com>> | BLOCKED: J-03 Tor check needs egress to Tor relays (or a Tor SOCKS endpoint) and to api.co | READY:/BLOCKED: head under 2 days old: never delete |
| ACTIVE | `wip/second-support-tickets` | `89cb132e` | 2026-11-09 | no | 24 | 19 | flem <<bamove@gmail.com>> | wip(UNCHECKED): J-14 member placeholder hidden from staff list; coordination note | commit within last 3 days |
| ACTIVE | `wip/second-timers-maint` | `3dde2b28` | 2026-11-09 | no | 45 | 39 | flem <<bamove@gmail.com>> | READY: J-04 setupMin 60; maintenance planned/unplanned (never emergency), best guess, anno | READY:/BLOCKED: head under 2 days old: never delete |
| ACTIVE | `wip/third-demo` | `4c88570d` | 2026-11-08 | no | 3 | 3 | flem <<bamove@gmail.com>> | Demo: seed trades in progress (secured, paid, in dispute) and link them from /__demo | commit within last 3 days |
| ACTIVE | `wip/third-old-session-handover` | `412e0ead` | 2026-11-07 | no | 1 | 1 | flem <<bamove@gmail.com>> | READY: old cloud claude3 session handover, stopped, nothing unpushed | commit within last 3 days |
| ACTIVE | `wip/third-owner-page3` | `2213ae8a` | 2026-11-08 | yes | 0 | 0 | flem <<bamove@gmail.com>> | READY: owner page 3 review fixes (P-I1, P-I2, P-m1, P-m2, P-m3, P-m4) | READY:/BLOCKED: head under 2 days old: never delete |
| ACTIVE | `wip/third-p4-task11` | `ca356ce7` | 2026-11-08 | no | 14 | 10 | flem <<bamove@gmail.com>> | READY: Plan 4 Task 11 after the re-verify (R-1 NODE_ENV allowlist for X2F_DEV_MOD_CHAT, R- | READY:/BLOCKED: head under 2 days old: never delete |
| ACTIVE | `wip/third-p4-task16` | `169fa1d6` | 2026-11-08 | no | 15 | 11 | flem <<bamove@gmail.com>> | READY: Plan 4 Task 16 after the 8 Nov security review (I-4, owner G3 in the invite page) | READY:/BLOCKED: head under 2 days old: never delete |
| ACTIVE | `wip/third-p5-proof-popups` | `e5780990` | 2026-11-06 | no | 5 | 3 | flem <<bamove@gmail.com>> | Merge smart check 746133a3 (RV4 I1, M1-M4 fixes) into the proof poster pop-ups | named as current job in owner-answers-assignments.md |
| ACTIVE | `wip/third-proof-owner-g16` | `7b50096d` | 2026-11-08 | no | 5 | 5 | flem <<bamove@gmail.com>> | docs: proof date (G16) and field labels (G17, F15) notes | commit within last 3 days |
| ACTIVE | `wip/third-rep-owner-1106` | `7b0f5a79` | 2026-11-07 | yes | 0 | 0 | flem <<bamove@gmail.com>> | READY: rep owner rulings, imported volume in USD (owner p4-1), lead review minors | READY:/BLOCKED: head under 2 days old: never delete |
| ACTIVE | `wip/third-semgrep-triage` | `680cbaed` | 2026-11-08 | no | 2 | 1 | flem <<bamove@gmail.com>> | READY: wip/third-semgrep-triage, the owner's Semgrep findings (8 Nov) fixed or marked, fro | READY:/BLOCKED: head under 2 days old: never delete |
| STALE | `wip/lead-docs-task42-design` | `827c03cb` | 2026-10-30 | no | 2 | 2 | flem <<bamove@gmail.com>> | docs(spec): Task 42 design revision after review: account key binds every slot, pin hold a | older than 3 days, unmerged, named only in older to-second.log lines |
| STALE | `wip/lead-p7-retention` | `c06d549d` | 2026-10-30 | no | 18 | 16 | flem <<bamove@gmail.com>> | test(web): R3-m3 wait for the WebCrypto tag instead of one tick (flaked once in the full w | older than 3 days, unmerged, named only in older to-second.log lines |
| STALE | `wip/lead-p7-retention-t20` | `58c2d897` | 2026-10-30 | no | 8 | 5 | flem <<bamove@gmail.com>> | Merge branch 'wip/lead-p7-retention' into wip/lead-p7-retention-t20 | older than 3 days, unmerged, not referenced |
| STALE | `wip/third-p4-task6` | `6d23e637` | 2026-11-02 | no | 4 | 4 | flem <<bamove@gmail.com>> | test(api): schema test lists migration 204 (Plan 4 Task 6) | older than 3 days, unmerged, not referenced |
| PROTECTED | `claude/compassionate-johnson-k95ssr` | `22b379e8` | 2026-11-09 | yes | 0 | 0 | flem <<bamove@gmail.com>> | e2e: Main and BuyMain parity exceptions for the X2F wordmark (the header shows logo D; own | main/comms/claude/* never deleted |
| PROTECTED | `claude/reviews-sensitive-text-pf40mh` | `7a2acd87` | 2026-11-06 | yes | 0 | 0 | flem <<bamove@gmail.com>> | fix(api): review notes call detectSensitiveText from @x2f/proof (NEEDS_TASK_7_SENSITIVE_TE | main/comms/claude/* never deleted |
| PROTECTED | `claude/task-z23obx` | `9a02a61a` | 2026-11-06 | yes | 0 | 0 | flem <<bamove@gmail.com>> | test(e2e): count the primary action in one evaluate; setup waits for each screen | main/comms/claude/* never deleted |
| PROTECTED | `comms` | `13d19e2b` | 2026-11-09 | no | 85 | 85 | flem <<bamove@gmail.com>> | LANDED batch 2 -> main 22b379e8 | main/comms/claude/* never deleted |
| PROTECTED | `main` | `22b379e8` | 2026-11-09 | yes | 0 | 0 | flem <<bamove@gmail.com>> | e2e: Main and BuyMain parity exceptions for the X2F wordmark (the header shows logo D; own | main/comms/claude/* never deleted |

## Notes

- Typo-like names on origin such as `wip/second-`, trailing-dot variants and similar are listed as found; if they are junk refs the lead may want to review them with STALE.
- The 2026-11-08 lead line says the watcher revival (Plan 3 Task 9 I/O + view + Task 10) landed; the HELD branches are kept pending the lead confirming the 2026-10-30 hold is released.
- Branches in the ACTIVE class because of older commit dates but named in the 9 Nov queue: J-02, J-03, J-04, J-14, J-17 branches.
- Four former hold branches are now MERGED because their heads are in main (wip/second-p3-task9-io, wip/second-p3-task9-view, wip/second-p3-task10, wip/lead-land-t9io-held; the watcher revival landed 8 Nov). The earlier hold said never to purge them: the lead should confirm the hold is released before deleting these four.
- wip/lead-land (merged, 22b379e8) is the base named for J-02 in the 9 Nov queue; delete only after J-02 has rebased on main.
