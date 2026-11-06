# Handoff: wip/lead-design-fold (fold review fixes), 2 Nov 2026

Worktree: `~/x2f-worktrees/lead-design-fold` (branch `wip/lead-design-fold`; push only this branch).
Review: `~/x2f-comms/review-lead-design-fold-2026-11-01.md`.
Head: **32f963f** (pushed; worktree clean).

## Commits (all pushed)

- 98f87e0 I1 + I2 (red tests first, test/fold.test.tsx)
- 2a888ba M1, M2, M3, N1, N2 (red tests first, test/quoteScreen.test.tsx "the quote across a fold")
- 2832936 merge main 850052d (devices kit): ui.css one shared selection style (ChoiceGroup + PickButton), design-shots.spec.ts main's copy plus the 53/54 two-pane checks
- e85ebd9 N5 (pick rows named by title + methods, described by status/refusal)
- 4b0e983 merge main b6835ee (My offers 5bfb450 + C11): RowText wraps the SelectCard body, kit Switch in MyOfferDetail (N6), offerRange dropped for offerLimitsRange, shared selection style now includes ticked SelectCard; a PickButton inside a card is bare and its shown state is a 2 px ink inset line (no nested ring)
- 1a99572 shot 54 reshot (night + day)
- 32f963f fix: tab bar pinned for screens inside Panes (ui.css `[data-shell-body] > .x2f-panes > [data-pane='main'] > main`); e2e myOffers.spec.ts 5/5 after it

## Review items

| Item | State |
|---|---|
| I1 SAFETY (glance says pay while gate blocks) | DONE. glanceWarning uses payBlock/payBlockText for the buyer on the pay step; tests for still checking, setting up, total mismatch (same and other amount), no amount, refused, stopped, on tabletop and cover |
| I2 tabletop own-name + gift-card lines | DONE. PayFacts carries both; tests incl. gift-card method |
| M1 fold loses take guard/refusal/You're back/blocked poster | DONE. `src/screens/quote/quoteKept.ts`: per-offer store above the component; useTake reads its busy flag as the guard; entry dropped after the last quote for the offer unmounts (deferred a tick so a fold's remount keeps it) unless a take is in flight. Tests: pending take across unfold (no second take, refusal shown after), You're back across unfold |
| M2 typed amount shared across offers | DONE. Amount lives in the per-offer store (useKeptText no longer used by the quote); test: back to list and open a quote starts empty |
| M3 fold/unfold tests | DONE (unit): amount, unit, wallet, picked offer, one quote mounted across phone -> two -> phone -> two. Not added: "list not refetched / scroll kept" |
| N1 empty quote aside | DONE (side = null) |
| N2 cover timer label | DONE (label kept unless "N min left") |
| N3 no Back on tabletop | OPEN: owner question 2 in the review |
| N4 pick row drops badges | Note for the board follow-up, not done |
| N5 pick row name | DONE |
| N6 kit Switch in detail | DONE (after My offers merge) |
| N7 design-shots add/add | Resolved in the merges |

## Test status (at 4b0e983, under check.lock)

- tsc: pass. copy-lint: clean. Web units: 82 files, 1187/1187 pass.
- Playwright --workers=1 (fold, quote, pay, browse-buy, browse-sell, myOffers, chat): 129 passed, 1 failed:
  `myOffers.spec.ts:225 PostOffer links to My offers; an empty list still offers Post an offer`, expectPinnedTabBar (nav bottom 440, viewport 844).
  Cause: main line pins the tab bar with `[data-shell-body] > main { min-height }`; My offers' main is now inside `.x2f-panes > [data-pane='main']` (display: contents on a phone, but the child combinator does not match). Fixed in 32f963f: myOffers.spec.ts now 5/5.
- Shot 54 reshot after the merge (passed).

## Left / next steps

1. Re-run the requested Playwright set (fold, quote, pay, browse-buy, browse-sell, myOffers, chat; --workers=1, X2F_CHROMIUM_PATH=/usr/bin/chromium, under flock) once on 32f963f; the only failure at 4b0e983 is fixed. Also check other main-line selectors written as `[data-shell-body] > main` (grep src) in case another needs the Panes path; reshoot 31-35 only if My offers pixels changed on a phone (the merge kept main's phone markup: RowText renders a fragment on a phone).
2. Hand to review, then land.
3. Owner questions still open (review "Questions"): Q1 answered by M2 fix (amount no longer carries to other offers on a phone; ask owner if carry-over is wanted), Q2 tabletop Back (N3), Q3 offline sellers in two panes, Q4 ticked vs shown on My offers: implemented ticked = ring (SelectCard), shown = 2 px ink inset line on the bare PickButton; owner/design to confirm.

## RESULT (2 Nov 2026, helper)

Head: **e02c1e9** (pushed to origin/wip/lead-design-fold; worktree clean; main not touched).

- 6a594e8 merge origin/main e7636c7 (login approval v2, platform feedback): clean auto-merge (ui.css auto-merged). No other `[data-shell-body] > main` selector in src needs the Panes path (only ui.css's pin rule, which already has both).
- e02c1e9 test-only: kit-selection.test.ts and main's loginApproveV2.test.tsx looked up ui.css rules by exact selector text. They failed against the grouped selector lists: the Panes tab-bar pin from 32f963f, and the shared selection rule that now holds `.x2f-choice[data-on='true']`. Both lookups now also find a selector inside a selector list. No CSS change.
- Review items rechecked in code and tests: I1 (glanceWarning takes payBlock/payBlockText on the buyer's pay step; 7 blocked states x tabletop/cover with no "Pay now"/"Send exactly"/"then tap I've paid"), I2 (own-name + gift-card lines in PayFacts, tests), M1 (quoteKept.ts keeps busy/error/back/blockedPoster/chatHint; tests: pending take across unfold, You're back), M2 (per-offer amount; test), M3 (unit round trip phone->two->phone->two, one quote mounted). M3's "list not refetched / scroll kept" still not tested (as before).

Checks (all under check.lock, on e02c1e9 / 6a594e8):
- typecheck (all workspaces): pass. copy-lint: clean. separation-check: ok.
- vitest web 83 files 1205/1205; api 58 files 1462 passed + 1 todo; trade 12 files 328/328.
- Playwright full e2e suite, --workers=1, X2F_CHROMIUM_PATH=/usr/bin/chromium: 454 passed, 46 skipped, 0 failed (8.1 min). No shot changes.

Left: owner questions Q1-Q4 (unchanged, see above); N3 tabletop Back (owner Q2); N4 board follow-up. Ready for review, then the lead lands it.
