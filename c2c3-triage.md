# claude2 / claude3 unfinished-work triage (12 Nov 2026, read-only)

Base: origin/main 6ebed537 (after `git fetch origin`). Method: `git cherry`, `git log -S`/`--grep`, `git diff` of key files against main, `git merge-base --is-ancestor`. No worktrees made, nothing built or run.
Already handled by the lead and left out: J-14, J-20, J-21, O-028/S-093, S-026/D-058, P-012..P-016/P-020/P-022.

## 1. Branch verdicts

| Branch | Verdict | What's left | Size | Key files / evidence |
|---|---|---|---|---|
| wip/second-docs-1030-answers (6 +) | (a) SUPERSEDED | Nothing. These are the 30 Oct lead decisions and the provisional q11-q15 text. The owner has answered them since. Main's spec now opens with "Revision 2026-11-09 (owner)", which wins over older text. The decisions are in code or coordination.md (`MIN_REVIEWS_TRUSTED = 5`; backups are covered by Plan 6). Its "reviews store a weight" line contradicts main's item 26 (no dollar weighting). Delete. | - | docs/superpowers/specs/2026-10-14-x2f-design.md, docs/coordination.md |
| wip/second-gift-cards (22cc4b89) | (a) SUPERSEDED | Nothing. This commit is a post-merge test fix. Main's offersBulk.test.ts has since been rewritten (`{ buy, sell }` cap shape). J-17 landed in batch 4 (314412af). Delete. | - | apps/api/test/offersBulk.test.ts |
| wip/second-offer-rules (a871baae) | (a) SUPERSEDED | Nothing. The commit drops one `not-a-refusal` pragma to stay under a budget of 53. Main's budget is now 65 and the pragma is still there (offerForm.ts:585). This is only cosmetic. J-02 landed in batch 4. Delete. | - | apps/web/src/screens/post/offerForm.ts |
| wip/second-timers-maint (f4e91fe6) | (a) SUPERSEDED | Nothing needed. Main's frontDoor.test.ts already checks `plannedMaintenance`, and maintenance.spec.ts signs in. The only piece not on main is one extra e2e case: signed out, the front door shows "Unplanned maintenance" from `{kind}` alone. It can be ported later if wanted (XS). J-04 landed in batch 4. Delete. | - | apps/api/test/frontDoor.test.ts, apps/web/e2e/maintenance.spec.ts |
| wip/second-fold-followups (5 +) | (a) SUPERSEDED | Nothing. m1/m2/m3 landed through wip/lead-fold-quote 0efa7d38 (851dbf99 forgetQuote, f476a07e, 785ddf29, 8b824240). Its Q12 glance change (`releasable`) is obsolete: main has a separate `securing` state and payModel `payBlock` 'not-secured' gates paying (Q12 is on main in pay.spec.ts:262 and ChatPanel). 57e543f5 is an UNCHECKED test-only WIP. Delete. | - | apps/web/src/screens/trade/TradeGlance.tsx, payModel.ts |
| wip/second-api-cap-dispute (4 +) | (b) READY: cherry-pick ONE commit | **2c782032 (owner g67)** is NOT on main. On main, `apps/web/src/escrow/policy.ts:166` lets the buyer's device co-sign a `buyer-cancel` in `settling` after "I've paid". The commit adds `&& c.trade.paidAt === null`, plus a policy.test.ts case. The trade machine already refuses this, so the commit is defence in depth on an escrow path. It was never reviewed (review-cap-dispute-2026-11-10 covered only a99af200). The other commits: a99af200 landed as wip/lead-cap-dispute (90744d97, D-060). **326d9c6f must NOT land** (g66 nudge-before-cancel, reversed by owner p6-1 / T-033). 5f3d944b is moot (main's test uses 16 min). After the cherry-pick, delete the branch. | S | apps/web/src/escrow/policy.ts, apps/web/test/policy.test.ts |
| wip/second-price-feeds (8 +) | (d) BLOCKED | O-036: the 4th XMR source (coinpaprika) plus the per-currency route chain, off unless PRICE_SOURCES names it. Round-2 review APPROVED. Owner rule: "add a 4th source after it passes a Tor check". This box cannot run Tor (bootstrap stuck at 14%) and the proxy refuses api.coinpaprika.com (403). Left: (1) run the Tor check on the PC or deploy host (`torsocks curl .../v1/tickers/xmr-monero`) and compare with the fixture in price-chain.test.ts; (2) re-merge main 6ebed537 (it is on 58f3d186; 5 files overlap: config.ts, index.ts, main.ts, price/routes.ts, test/helpers/app.ts); (3) owner OC1, whether to turn the source on by default. Alternative, which is the lead's call: land it dark now and do the Tor check before switching it on. | S (after Tor) | apps/api/src/price/chain.ts, sources.ts, fx.ts, market.ts; test/price-chain.test.ts; docs/superpowers/specs/2026-11-02-price-feeds.md |
| wip/second-p3-task34 (24 +) | (a) SUPERSEDED | Rebuilt as J-16. Main's migration 490_flex_offers.sql says it was "Rebuilt from claude2's Task 34 migration (117 on wip/second-p3-task34 c2d1006c)". lead-flex-launch-4 is in main. **One carry-over to note:** Task 34 review I1 (e8b58a40 + WebCrypto fix) bound `instructionsSha256` into `AttestedTerms.deal`. Main has no instructions hash (packages/trade/src/attestation.ts:33). It doesn't matter today, because `paymentInstructions` reaches no screen (flex review M4). It must be ported before any trade-room screen shows locked instructions. Delete the branch. | - | packages/trade/src/attestation.ts, apps/api/src/trades/view.ts:141 |
| wip/second-p3-task34-web (36 +) | (a) SUPERSEDED | J-16's PostOffer replaced it. N1 (double ring) and N2/N3 are moot. Delete. | - | apps/web/src/screens/post/* |
| wip/third-demo (3 +) | (a) SUPERSEDED | A standalone 8 Nov `.mts` demo. The PC demo (wip/lead-demo, tools/demo/*.ts, real moderation service) replaced it. Its one idea not in lead-demo is seeding in-progress trades (secured, paid, in dispute) linked from /__demo. Port it to lead-demo only if the owner wants it (S). Delete. | - | tools/demo/seed.mts |
| wip/third-semgrep-triage (384359ed) | (a) LANDED / SUPERSEDED | Main already has the pinned checkout SHA (semgrep.yml:26), `min-release-age=14` (stricter than 7), and the same `nosemgrep` notes (attestation.ts, leaked.ts, quoteModel.ts, detect.ts, parity.ts). Delete. | - | .github/workflows/semgrep.yml, .npmrc |
| wip/third-old-session-handover (412e0ead) | (a) SUPERSEDED | A 9-line handover note. Everything it lists has landed (Tasks 4, 5, 7, 11, 15, 16, staff split, proof fix). The UPI and 6+ digit refusal notes are in main's proof code. Delete, or copy the note to comms if wanted. | - | docs/handover/claude3-old-cloud-session-2026-11-07.md |
| wip/third-p4-task11 (ca356ce7) | (a) LANDED | It is an ancestor of main (67f63f27 merges it in batch 3). The "WIP UNCHECKED" state was 6 Nov. It was finished and reviewed after that (8e2df345 security review I-1..I-3, M-2; ca356ce7 re-verify). Queue, case, take, messages, freeze and proof-request routes are on main, and NEEDS_P4_CASE_ASSIGNEE is fulfilled (staff/members.ts:111). **Removed on purpose by review I-1/I-2, and still owed:** moderator chat read and unblurred proof (NEEDS_P4_CHAT_MEMBERSHIP, 19 sites), and moderator chat send without the dev flag (NEEDS_P4_MOD_COUNTERSIGN, 8 sites). See job 5 below. | - | apps/api/src/disputes/staffRoutes.ts, moderationClient.ts, migrations/208_moderation.sql |
| wip/third-p4-task16 (169fa1d6) | (a) LANDED | It is an ancestor of main (de7a6d7e). The "NOT READY" list (ownerLockout flake, e2e config and shell spec, copy-lint for staff-web, invite resume key count) was fixed in 20e51c48 and dcfbb26a, then security-reviewed (I-4, G3). | - | apps/staff-web/* |
| wip/third-p4-task15 (5b5a5cbf) | (a) LANDED | It is an ancestor of main. | - | - |
| wip/third-p4-staff-trader-split (b8cdef6b) | (a) LANDED | It is an ancestor of main. | - | - |
| other wip/third-p4-* (reverify, task4, task5, task5-minors, task6, task7, task7-fixes, task8, task10) | (a) LANDED | All are ancestors of main. task4-split a0cc3766 is patch-equivalent (cherry `-`). Delete all. | - | - |

Also checked: there are no local-only second/third branches, and no other origin branch carries claude2 or claude3 sessions with unmerged commits.

## 2. Unfinished claude2/claude3 work that no branch above holds

These come from claude3's 5 Nov queue ("Task 12, 24, 25, 17, 18"), the c3 jobs in owner-answers-assignments.md (J-06, J-11, J-12, J-15), and register rows.

### 2a. Rows that other lead branches already cover (READY, waiting for landing; nothing for claude2/claude3 left)
- D-013, D-014, D-015 freeze: wip/lead-freeze ac3ab777 (in lead-land-8).
- D-032, D-064, D-070 (and D-017 rule list): wip/lead-mod-rules 5c19ddbe (in lead-land-8).
- R-011, R-012, R-042: wip/lead-reputation 4df9bc54 (in lead-land-8).
- D-005 (partly), D-010, D-011: wip/lead-appeals 1bdaa226 (not in lead-land-8).
- D-006, D-008, D-009 (lien part), D-062, D-063: wip/lead-liens 7472994f (not in lead-land-8).
- D-041..D-045: wip/lead-staff-pay 41e8e1e5 (not in lead-land-8). The payroll send stays tripwired (NEEDS_PLAN_6_PAYROLL_WALLET), and the ClockOut sheet waits for design.
- D-060: landed (lead-cap-dispute). P-007, P-008, P-010, P-018: landed (lead-proof-popups 177fa75e). O-003..O-020, O-047: landed (J-16 in main). O-015 waits on owner p11-60/p11-96.

### 2b. Not built anywhere
- **Plan 4 Task 12, rulings** (propose, approve, publish, appeal review, account actions, after-refund compliance). There are no ruling routes on main, lead-land-8 or lead-appeals; staffRoutes only has queue/take/messages/freeze/proof-request. Lead-liens says plainly: "Not built: ruling publish routes (Task 12)". D-050 (owner co-approval above the limit) waits on it. Without it the appeals and liens code has no ruling to act on. **L.**
- **Plan 4 Task 13 + Task 14, ruling gate and execution** (moderation chain of trust; coins move at the ruling, D-009). NEEDS_PLAN_4_RULING_PAYOUT appears 10 times on main. This is a regtest suite, so it cannot run on this box (downloads.getmonero.org blocked). **L.**
- **J-06 tails** (from the lead-liens READY note): the repayment trade (NEEDS_REPAYMENT_TRADE), collecting fees_owed from later trades (NEEDS_FEE_OWED_COLLECTION), and the seller-returns-fiat lien (NEEDS_OWNER_FIAT_LIEN, an owner question). **M** for the first two; the fiat lien is BLOCKED on the owner.
- **Plan 4 Task 18, ModQueue and ModCase staff screens**, and **Task 17, owner StaffList/StaffSettings/StaffOverview**. staff-web on main and on every lead branch has only Feedback, Invite, Login, NewsEditor, OwnerSetup (+ Prices, StaffGrants on j21, + Tickets on j14). Moderators can work disputes only through the API. **L** (design boards exist for ModQueue/ModCase; StaffSettings needs the 48 h-bonus option removed, D-044).
- **D-005 completed-trades list with the File appeal row.** The lead-appeals READY says "The completed-trades list is not built yet; its row takes the same component". **S-M.**
- **O-040, owner notifications list on the staff site** (price-source-failing/recovered alerts exist in apps/api/src/alerts.ts; no staff-web page or route anywhere). Not drawn by design. **M.**
- **D-071, dispute-room line between the seller's cancel and the refund landing** ("XMR has begun refunding ... n/10"). Design words it first; then **S**.
- **O-041, sanctions audit of the 45 launch currencies** (RUB first). Research plus maybe a list edit. **S.** O-052 (add the Coinbase∩BitPay currencies) is after launch.
- **T-054, gift-card video-of-login proof.** Only a term exists; it is NEEDS(lead). Small, but waits on the lead or owner.

### 2c. Blocked
- **Task 11 residual: moderator chat read, unblurred proof, and moderator chat send** (NEEDS_P4_CHAT_MEMBERSHIP, NEEDS_P4_MOD_COUNTERSIGN). Blocked on the chat-membership-key build ("design build task 9", design-chat-membership-keys-2026-11-08.md) and its security review. No branch builds it. Until then the dev-only `X2F_DEV_MOD_CHAT` path stays refused in production. **L.**
- **J-03 price-feeds Tor check** (above).

## 3. Prioritised jobs to assign

1. **g67 co-sign guard** (P1, escrow): cherry-pick 2c782032 from wip/second-api-cap-dispute onto main and run apps/web/test/policy.test.ts. A short escrow-path review is needed because it was never reviewed. Then delete the branch, and never land 326d9c6f. **S.**
2. **Plan 4 Task 12 rulings** (P1, money; it unblocks lead-appeals, lead-liens and D-050): propose, approve, publish, appeal review and account actions, built on main plus lead-land-8 plus lead-appeals and lead-liens. Needs a security review. **L.**
3. **Plan 4 Task 13/14 ruling gate and execution** (P1, money; it clears NEEDS_PLAN_4_RULING_PAYOUT): needs a box with monerod access (regtest). **L.**
4. **J-06 tails**: the repayment trade, then fees_owed collection, after job 2 (P1, money). **M.** Ask the owner about the fiat lien.
5. **Moderator chat via chat-membership keys** (P1, security; it ends the Task 11 dev-only path): BLOCKED on design build task 9. Assign it once the crypto design is signed off. **L.**
6. **Plan 4 Task 18 ModQueue/ModCase + Task 17 owner staff pages** (P2; the moderators' working screens). Can start on the existing API in parallel with job 2. **L.**
7. **J-03 price feeds** (P2): run the Tor check on the PC, re-merge main 6ebed537, and ask owner OC1. **S** once Tor works.
8. **D-005 completed-trades list with File appeal** (P2), after lead-appeals lands. **S-M.**
9. **O-040 owner notifications page on the staff site** (P2; design first). **M.**
10. **O-041 sanctions audit of the 45 currencies** (P2, research). **S.**
11. **D-071 cancelled-refund line in the dispute room** (P2; design words first). **S.**
12. **Carry-over guard** (note, not a job yet): before any screen shows `paymentInstructions`, port Task 34's `instructionsSha256` attestation (e8b58a40 on wip/second-p3-task34). Worth putting in J-16's follow-ups or a tripwire.

Branches safe to delete once the lead agrees: second-docs-1030-answers, second-gift-cards, second-offer-rules, second-timers-maint, second-fold-followups, second-p3-task34, second-p3-task34-web, third-demo, third-semgrep-triage, third-old-session-handover, every third-p4-*, and second-api-cap-dispute after job 1. second-price-feeds stays until J-03 is done.
