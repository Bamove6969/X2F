# Review RV-F: offers v2, round 2

Branch origin/wip/second-design-offers-v2 @8252e887. Round 1 (review-offers-v2-2026-11-02.md) was APPROVED WITH MINOR at 86c58ec3. Fixes are at 3dbd82e3, plus a reshoot of shots 71/72 at 8252e887. Diff read: `git diff 86c58ec..8252e88` (14 files).
Reviewer: claude3 helper RV-F (read-only, own detached worktree ~/x2f-worktrees/rv-offers-v2, now removed).

## Verdict: APPROVED

M1-M7 are all fixed correctly. No regressions found. No Important or Minor findings.

## Fix-by-fix
- **M1 fixed.** Notice.tsx gains an `info` tone. The default icon is `info`, and the default live is `off`, so it has no role. The doc comment is updated. ui.css:889-900 holds the board look (surface-raised, 30% ink-muted border, ink-muted icon). Its icon rule (0,3,0) out-specifies the `.x2f-outcome__icon` caution default that follows it. The quote.css `plain` override is gone, and Quote.tsx uses `<Notice tone="info">`. The behaviour of caution, danger and plain is unchanged: the `heard` refactor gives the same roles as before. The Notice consumers (ui, loginApproveV2, myOffers, myOffers-tripwires) all pass.
- **M2 fixed.** The heading copies are replaced by the kit `.x2f-section-title`: the MethodList h2, the PostOffer "Your price" and "Who can trade with you" cards, and the quote's "You receive". `--x2f-heading-family` is the sans font, so the font does not change. The amount values (`.x2f-offer__rate`, `.post-preview .post-big`) and the label values (`.post-label`, `.x2f-quote__label`, PostOffer field labels) now use the amount and label tokens. The 12 px icon-button radius moved into the kit (ui.css:238). The per-screen copies are removed from browse, quote and PostOffer, and `.post-close` is now the kit `x2f-icon-button`. The `aria-labelledby` id on "Your price" is kept. The browse section title is now scoped as `.x2f-browse__section .x2f-browse__section-title` (0,2,0), which beats the kit's `margin: 0` whatever the import order. That also removes round 1's N2 for that rule.
- **M3 fixed.** `.x2f-chip-button` and `.x2f-segment__tab` keep `border-radius: var(--x2f-radius-pill)` (browse.css:65, 158), so the focus ring follows the pill. The PostOffer two-up re-sets `radius-md` at higher specificity (PostOffer.css:104), so the square-ish cards keep their shape.
- **M4 fixed.** `.x2f-browse__sorts` gets `row-gap: var(--x2f-space-3)` (browse.css:138). That makes 32 + 12 = 44 px per wrapped line, so the targets no longer overlap.
- **M5 fixed.** The methods-failed caption is now `<span className="post-caption">` (PostOffer.tsx:258), styled with the field labels (PostOffer.css:132-140). "Minimum completed trades" stays sentence case at 15 px, which matches the board (design/x2f-app/PostOffer.dc.html:77 on design-brief). No change is needed there.
- **M6 fixed.** The source-regex test is replaced by renders. offersV2 renders PostOffer and asserts the h1 class. quoteScreen.test.tsx adds a rendered check of the BuyQuote screen title, the info Notice (no role) and the "You receive" section title. New M1-M5 tests are added. These check the kit Notice render, the kit/screen rule text (the accepted `rule()` precedent) and the methods-failed caption render.
- **M7 fixed.** Shot 72 uses `postApi()`, which sends any /v1 route nobody named to a 404 first and stubs events, wallets and wallets/rule. Playwright's last-registered-first order lets the specific routes win. Shot 71 now uses a named seller fixture (`SELL_QUOTE_OFFER`, mira.k's buy ad), served only for side=buy, and asserts mira.k and $412.50. The reshoot updates 71 day/night and 72 night.

## Notes (no action)
- **N1: the icon-button radius now applies app-wide.** The kit change gives every `x2f-icon-button` a 12 px focus-ring radius: Sheet, TradeHeader, FlowScreen, Wallets, MyOffers and setup kit, as well as the offers screens. The button background is transparent, so only the focus ring's shape changes. This is consistent with v2, and design may want to know.
- **N2: one leftover line.** `.post-close` still sets `height: 44px`, which the kit already gives. It is harmless.
- **N3: round 1's notes still stand.** Round 1's N1 and N3 (the span titles have no h1, a follow-up task) are unchanged and remain out of scope.

## Runs
All runs were in my own detached worktree @8252e88, after `npm ci` (npm 11.21.0), each under `flock ~/x2f-comms/check.lock`, one at a time.
- `apps/web: npx tsc --noEmit -p .`: clean (exit 0, no output).
- `apps/web: npx vitest run offersV2 quoteScreen kit-selection browse browse-buy postOffer notice`: 7 files, 109 tests passed. There is no selection-ink.test.ts at this head; kit-selection.test.ts is today's selection test.
- `apps/web: npx vitest run ui.test loginApproveV2 myOffers`: the other Notice consumers, 4 files, 78 tests passed.

## Part 2
trial-merge PENDING: selection not landed yet. The tail of to-third.log at 6 Nov 23:49 has no selection-landed line. The main line is still a779ef9 / e7636c7.
