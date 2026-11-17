# Review: wip/agy-a11y @2053477c (agy Job 8) — 17 Nov 2026, claude3

Branch: `origin/wip/agy-a11y` 2053477c (1 commit on wip/third-demo-r3 94337781; merges into the current
third-demo-r3 head without conflicts).
Order: AGY-ORDERS-2.md Job 8. Rulings checked: to-agy.log 2026-11-16 22:44:41 (OWNER order via claude2: "Job 8 must leave
font families, font-size/weight tokens and button sizing alone; do contrast, focus, labels, alt text only"),
to-lead.log 22:43:50 / 22:45:42 (owner: button sizes are claude2's; orange buttons stay the same size),
AGY-WORKSPACE.md §1 and §5, the 17:38 RULE (no product calls; ask in docs/agy-owner-questions.md).

## VERDICT: CHANGES NEEDED

No money/escrow/keys/auth/fees/liens/disputes/payout code is touched (CSS, three aria attributes, one test, one doc).
No font sizes or weights changed. The `.x2f-text-button:focus-visible` ring (browse.css:385-389), the badge-card
`max-width` (kit.css:546) and the new contrast checks in a11yPass.test.ts (ink / ink-muted / status tokens on all three
grounds, both themes) are good and can stay. Two things block: most of the diff is tap-target (button) sizing, which a
later owner order took out of Job 8, and the three new `aria-label`s replace the existing visible/hidden labels and
break three Playwright tests that pass on the base.

## Blocking

**B1. Tap-target / button sizing changed; the owner took button sizing out of Job 8.**
AGY-ORDERS-2.md Job 8 says "tap targets >= 44 px", but the later OWNER order (to-agy.log 2026-11-16 22:44:41) says Job 8
must leave button sizing alone and do "contrast, focus, labels, alt text only" (also to-lead.log 22:45:42: button sizes
are the owner's/claude2's call). This is the note-text-over-later-ruling pattern again. Hunks that size buttons/targets:
- `apps/web/src/screens/Wallets.css:172-176` (`.x2f-app-chip` 40 px -> min 44x44, inline-flex)
- `apps/web/src/screens/browse/browse.css:164-168` (`.x2f-chip-button` inline-flex + min-width),
  `:369-376` (`.x2f-text-button` 32 px -> 44x44, padding/margin 6 -> 10 px; changes line box and wrapping),
  `:678, :681` (`.x2f-offer__nudge` centring + min-width)
- `apps/web/src/screens/quote/quote.css:132-136` (`.x2f-quote__switch/.x2f-quote__max`)
- `apps/web/src/ui/ui.css:635, :638` (`.x2f-rail__home`)
- `apps/web/src/ui/sync-gate.css:32` (`.x2f-sync__retry` min-inline-size)
- `apps/web/src/screens/trade/pay.css:186-189` (`.x2f-pay-timer__text` min 44x44, and drops the `min-width: 0` that let
  the timer text shrink beside its sibling)
- `apps/web/src/screens/screens.css:266` (44 px rule widened from the Jabber rows to every `a.x2f-list__row` app-wide)

The findings doc then says (docs/agy-a11y-findings.md:12) the pass was done "without modifying ... button sizing tokens",
which hides the change from the summary.
Fix: restore those hunks to the base (`git checkout 94337781 -- apps/web/src/screens/Wallets.css
apps/web/src/screens/quote/quote.css apps/web/src/ui/ui.css apps/web/src/screens/trade/pay.css apps/web/src/screens/screens.css`,
and in browse.css/sync-gate.css revert everything except the `.x2f-text-button:focus-visible` block and, if wanted,
`cursor: pointer`). Delete the "tap targets >= 44px" block in `apps/web/test/a11yPass.test.ts:14-67`. Move the measured
under-44 targets (`.x2f-app-chip` 40 px tall, `.x2f-text-button` ~32 px, the others' widths) into
docs/agy-owner-questions.md as a list for claude2/the owner, and correct findings doc line 12 and §1-§2.

**B2. The three new `aria-label`s override existing labels and break 3 e2e tests.**
`apps/web/src/screens/browse/MethodList.tsx:156`, `OfferList.tsx:144`, `quote/Quote.tsx:373`: each control already has a
`<label htmlFor>` (MethodList.tsx:146 hidden "Search payment methods", OfferList.tsx:152 visible WITH_MARKUP_LABEL,
Quote.tsx:353 visible amount label); the findings doc itself (§5) says so. `aria-label` wins over `<label>` in the
accessible-name order, so the search box's name becomes "Search 124 payment methods" (it now changes with the count),
and `getByRole('searchbox', { name: 'Search payment methods' })` no longer matches:
- e2e/browse-buy.spec.ts:22 (matches the BuyMain board) — element not found at :40
- e2e/browse-buy.spec.ts:66 (search hit list under Best rate) — 30 s timeout at :70
- e2e/browse-sell.spec.ts:31 (matches the Main board)
The same two specs on the base 94337781: 45/45 passed. The READY line reported no Playwright run.
Fix: remove all three `aria-label` lines (the inputs are already correctly labelled; nothing to fix there) and the
"form input labelling" block in `apps/web/test/a11yPass.test.ts:98-113`; rewrite findings doc §5 as "audited, already
labelled, no change". Run browse-buy/browse-sell/quote e2e before the next READY and put the counts in it.

## Minors

**M1. Checks run from a forbidden folder.** docs/agy-a11y-findings.md:150-163 show every check run with
`/home/flem/x2f-comms/check.lock`; AGY-WORKSPACE.md §1 forbids using `~/x2f-comms`. Run checks inside `~/agy-x2f/<job>`
only and drop the local paths from the doc (just list command + counts).

**M2. Job 8's "body text >= the kit's body size" item is not reported.** Font sizes are claude2's, so don't change them,
but do list any trader text under the kit body size (screen, selector, px) in docs/agy-owner-questions.md for claude2
instead of leaving the item out silently.

**M3. Tests check CSS source text, not the page; no Playwright added.** a11yPass.test.ts regex-matches CSS files (they
pin the exact text, so any refactor turns them red without a real regression). The order asked for Playwright where
cheap. Replace the badge-card regex (a11yPass.test.ts:69-74) with a 360x800 Playwright check that opens a badge card and
asserts its box is inside the viewport (x >= 0 and right edge <= 360) and that `document.documentElement.scrollWidth <= 360`
on the main trader screens. Note kit.css:540 `left: -24px` + :546 `max-width` can still put the card past the left edge
when its anchor sits at the 16 px gutter; the Playwright check will show it.

**M4. Overclaims in the findings doc.** docs/agy-a11y-findings.md:132 "100% of trader form controls possess accessible
names" and §4 "No horizontal scrollbars appear on 360px viewports" are stated without a run that checks them (§4 is a
CSS read-through). Say what was actually checked, or back it with the M3 Playwright check.

## Checks (fresh detached worktree /home/user/rv2-agy-a11y @2053477c, npm ci, Node 24)
- typecheck (`npm run typecheck`, all workspaces): ok, 0 errors
- copy-lint: clean (apps/web/src, apps/staff-web/src)
- separation-check: ok
- web vitest (a11yPass, kit-contrast, browse, browse-buy, quoteScreen, quoteFocus, wallets, methodPicker, selection-ink,
  kit-selection, wideShell, buyerPay, syncFirst, offersV2): 14 files, 342/342 passed (a11yPass 63/63)
- Playwright (browse-buy, browse-sell, quote, wallets, pay, syncFirst, alerts, fold, shell, parity, setup, trades):
  273 run, 270 passed, **3 failed** (browse-buy.spec.ts:22, :66, browse-sell.spec.ts:31 — B2)
- Base 94337781, browse-buy + browse-sell: 45/45 passed (the 3 failures are this branch's)
- Merge check: `git merge-tree` with origin/wip/third-demo-r3 head: clean
