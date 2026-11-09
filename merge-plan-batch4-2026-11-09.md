# Batch 4 merge plan, 2026-11-09

Read-only check (`git merge-tree --write-tree`), no branch touched. main = 22b379e8, batch 3 = origin/wip/lead-land-3 be73600a.
Batch 3 itself merges CLEAN into main (land-3 is 96 commits ahead of main, main is 1 ahead: the e2e wordmark commit).

## Naming notes (check these)
- `wip/lead-docs-rules` DOES NOT EXIST on origin. Docs branches on origin: `wip/lead-docs-task42-design` (827c03cb) and `wip/second-docs-1030-answers` (e286489b). Both checked below. Confirm which is "the held docs-rules branch".
- No J-16 branch exists on origin among those fetched (J-02 offer-rules, J-04 timers-maint, J-17 gift-cards, J-14 support-tickets).
- `wip/lead-research-1109` (60a3e19e) is research files only.

## Summary table

| Branch | Job | vs main 22b379e8 | vs land-3 be73600a |
|---|---|---|---|
| second-offer-rules 32744fdd | J-02 | CLEAN (based on 91a59c0c; 8 ahead, 1 behind) | 5 files conflict (1 mechanical, 4 test files with semantic overlap) |
| second-timers-maint 3dde2b28 | J-04 | CLEAN (contains main) | 7 files conflict |
| second-gift-cards ed3ceecf | J-17 | CLEAN (contains main) | 10 files conflict, incl. 2 BEHAVIOURAL |
| second-support-tickets 41751b28 | J-14 | CLEAN (contains main) | 7 files conflict |
| lead-docs-task42-design 827c03cb | docs | CLEAN (one new spec file) | CLEAN |
| second-docs-1030-answers e286489b | docs | 2 files conflict (coordination.md, spec) | same 2 files |
| lead-research-1109 60a3e19e | research | CLEAN (new files only) | CLEAN |

All four READY branches merge cleanly into main as it is, so if they go to main BEFORE batch 3 there is no conflict; the conflicts below appear only when batch 3 is on the line first (it is the stated plan).

## Migrations
New migration files per branch (vs main):
- J-02: api 345_offers_market_only
- J-04: api 350_maintenance_kinds (+ 120, 121 carried)
- J-17: api 355_gift_card_terms (+ 120, 121 carried)
- J-14: api 450_support_tickets (+ 204 carried)
- docs, research: none
- moderation: none on any branch (007, 008 only on land-3)

Land-3 owns 120, 121, 123, 204, 208, moderation 007, 008. The carried 120/121/204 files on J-04/J-17/J-14 are byte-identical blobs to land-3's (checked by blob id), so NO number clash and no file conflict on the SQL.
Pending numbers: 016 (`wip/lead-hold-v3`), 345/350/355/450 are unique on origin. 124, 125 (launch-rules), 332 (jabber), 440 (flex-offers) exist on no origin branch I could find under apps/api/migrations (those branches have no such file yet, or the files are unpushed or elsewhere): no clash visible, recheck when they land.
Verdict: no clashes. Each branch's `apps/api/test/schema.test.ts` migration lists will conflict (mechanical, see below); after the merges the lists must contain 120, 121, 123, 204, 208 and 345, 350, 355, 450 in numeric order (the test is the check).

## Conflicts against land-3 (be73600a)

### J-02 second-offer-rules
| File | Class | Resolution |
|---|---|---|
| apps/api/src/chat/routes.ts | mechanical | keep both imports (`purgedTagSql`, `MARKET_PRICED`) |
| apps/api/test/schema.test.ts | mechanical | union of the migration lists, add 345 |
| apps/api/test/blocks.test.ts | test, semantic overlap | keep land-3's front-door lines (logged-out gets 401) with J-02's bestRate `2970000` (fixed price gone); drop the old `anon` expectation |
| apps/api/test/offers.test.ts (3 hunks) | test, semantic overlap | keep J-02's market +/- % posts and values, but use land-3's `viewer` (front-door session) instead of `anon`; keep J-02's THB currency only if its data needs it, else land-3's JPY |
| apps/web/e2e/post.spec.ts | test, semantic overlap | land-3 says a logged-out visit to /post goes to `/?returnTo=...` (front door, owner 8 Nov); J-02 expects /setup then back to /post. Take land-3's logged-out assertions, keep J-02's below/margin field checks in the set-up-trader flow. Needs a person to run the e2e |

### J-04 second-timers-maint
| File | Class | Resolution |
|---|---|---|
| apps/api/src/alerts.ts | mechanical | union order of the two alert kinds |
| apps/api/test/schema.test.ts | mechanical | union lists, add 350 |
| docs/coordination.md | mechanical | keep land-3's Task 11/16 notes and J-04's section |
| apps/api/src/site/routes.ts | BEHAVIOURAL | land-3: `GET /v1/site` answers a logged-out visitor only `{maintenance:{kind}|null}` (front door). J-04: public shape adds `plannedMaintenance`. Proposed: keep land-3's `insideAccount` split, give `publicSite(state, now)` the plan for inside sessions, and decide below whether `outsideSite` shows the plan |
| apps/api/test/site.test.ts | follows site/routes.ts | adapt to the decision |
| apps/web/src/api/site.ts | doc comment + shape | follows the decision |
| apps/web/src/App.tsx | follows the decision | Layout takes both `door` and `planned`; J-04's `planned={site.plannedMaintenance}` goes on land-3's BehindTheDoor layouts |

OWNER/LEAD QUESTION (J-04): should a logged-out visitor on the front door see an announced maintenance plan (startsAt/endsAt/message), or only the planned/unplanned kind? Recommendation: kind only outside (matches the owner's 8 Nov front-door rule); the plan banner shows after login.

### J-17 second-gift-cards
| File | Class | Resolution |
|---|---|---|
| apps/api/src/alerts.ts | mechanical | union order |
| apps/api/test/schema.test.ts | mechanical | union lists, add 355 |
| docs/coordination.md | mechanical | keep both versions of the starter-limit line (check text) |
| apps/web/src/screens/myoffers/model.ts | mechanical | doc comment only |
| apps/api/src/offers/routes.ts (6 hunks) | BEHAVIOURAL | J-17 carries the OLD cap model (owner 1 Nov C2-A1: one `offers_max_per_side` key, 409 body `{perSide}`); land-3 has the newer Q31 (owner 6 Nov: `offers_max_buy`/`offers_max_sell`, plain 409). Proposed: take land-3's cap code entirely, keep only J-17's gift-card rule additions; check that `assertMayPost`'s `{side}` param change is not needed by J-17 |
| apps/api/test/offers.test.ts, offersBulk.test.ts | follow the cap decision | take land-3's Q31 tests, keep J-17's gift-card tests |
| apps/web/src/screens/News.tsx, news-model.ts | BEHAVIOURAL (UI) | J-17 has the older inline `Post` board with "don't show again after login"; land-3 moved it into `NewsMessage.js`. Proposed: take land-3's News files; ask whether J-17's hide-after-login (`readHideAfterLogin`) is still wanted |
| apps/web/e2e/design-shots.spec.ts | follows News | take land-3's version |

OWNER/LEAD QUESTION (J-17): confirm the Q31 per-side cap (6 Nov) and land-3's News board win over the 1 Nov / design-results variants on the J-17 branch. Recommendation: yes. Also the pairwise J-02 x J-17 conflict (below) shares the offers cap/form files.

### J-14 second-support-tickets
| File | Class | Resolution |
|---|---|---|
| apps/api/src/errors.ts | mechanical | the `setup-locked`/`owner-needs-pgp` lines moved in land-3; keep them once |
| apps/api/test/schema.test.ts | mechanical | union lists, add 450 |
| apps/api/test/staff/routes.ts | mechanical | keep both route inventories (disputes + tickets) |
| apps/api/test/team.test.ts | mechanical | keep both entries |
| apps/api/src/staff/app.ts | mechanical | register both `staffDisputeRoutes(...)` and `staffTicketRoutes(app)` |
| apps/web/src/App.tsx | mechanical | add the 3 /support routes inside land-3's BehindTheDoor layout group (land-3 moved /news and /feedback there) |
| apps/api/src/internal/routes.ts | semi-behavioural | imports: keep both (drop `appendLog` only if unused). Query: land-3 selects the chat code and has `site_paused`; J-14 adds `lock_held` and the `final_alert*` fields. land-3 has dropped the final-alert pieces in this file (only store.ts mentions it). Proposed: take land-3's query, add `${tradeHeldSql('t')} as lock_held` and `paused: ... || r.lock_held`; leave out finalAlertAt/finalAlertSeenAt. Confirm that retired final-alert fields are not needed by J-14's tests |

## Pairwise conflicts between the four READY branches (merge-tree, no land-3)
- J-02 x J-04: schema.test.ts only. J-02 x J-14: schema.test.ts only.
- J-02 x J-17: offers/routes.ts, offers.test.ts, schema.test.ts, PostOffer.tsx, myoffers/model.ts, post/offerForm.ts. Real overlap (post form: gift-card tick boxes on J-02's below/above margin form). Merge J-02 first, then J-17 resolves against it.
- J-04 x J-17: disputes.test.ts, nudge.test.ts, schema.test.ts, team.test.ts (tests, probably timers setupMin 60 vs fixtures).
- J-14 x J-17: internal/routes.ts, schema.test.ts, News.tsx, news-model.ts, coordination.md.
- J-04 x J-14: internal/routes.ts, schema.test.ts, coordination.md.

## Docs and research
- lead-docs-task42-design: clean on both. One new file `docs/superpowers/specs/2026-10-30-task42-member-escrow-keys.md`. (Its base is old, 1306 commits behind; the diff is just that file.)
- second-docs-1030-answers: conflicts with land-3 AND main in two files, both docs, both need text judgement:
  - docs/coordination.md: two long blocks both sides added (land-3: Plan 5 Task 3/7 notes; branch: "Lead decisions of 2026-10-30 / q11-q15"). Resolution: keep both blocks. Mechanical, but one `M2/M3` bullet pair differs slightly, diff it by eye.
  - docs/superpowers/specs/2026-10-14-x2f-design.md: BEHAVIOURAL (spec text): land-3/main says Trusted = 200+ trades and 98%+ positive (owner 7 Nov); the branch says 100+ trades, from 5 rated reviews (PROVISIONAL, lead 30 Oct, q12). The owner's 7 Nov ruling is newer: keep land-3's line and drop the provisional one. Question for the lead: the branch's other q11-q15 notes may be stale after the 6-8 Nov rulings; recommend a read before merging, or leave the branch held.
- lead-research-1109: new files under research/ only, clean.

## Proposed merge order for batch 4 (after batch 3 lands)
1. J-02 offer-rules (J-16 depends on it; touches the offer/pricing core). Resolve per table; mechanical 345 list.
2. J-04 timers-maint (needs the front-door decision for /v1/site).
3. J-17 gift-cards (resolves cap and News against land-3 and against J-02's form files; do it after J-02).
4. J-14 support-tickets (internal/routes.ts query with J-04's change already there).
5. Docs: lead-docs-task42-design (clean), then second-docs-1030-answers only once the spec line is settled (or hold).
6. Research (clean, any time).
After each merge, the schema.test.ts migration list must be re-sorted and then typechecked. Suggested order of the schema list additions: 120 121 123 204 208 (land-3), then 345, 350, 355, 450.

Not run: tests, typecheck (nothing was checked out or merged; all results are from merge-tree only).
