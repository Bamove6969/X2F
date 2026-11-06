# Review: wip/lead-design-myoffers @e5ac017 (My offers to the board and the 1 Nov design review)

Reviewer worktree: ~/x2f-worktrees/review-myoffers-design (detached at e5ac017). Base 52b7a0e.
Design refs: origin/wip/design-brief @47ee9f4: docs/design-conventions.md, docs/design-boards/MyOffers.dc.html,
docs/design-review-screens-2026-11-01.md section 3 (shots 31-35, 54) and X1.

## Verdict: APPROVED WITH MINOR

No Important findings. One Minor (sticky hold flag) worth fixing before or soon after landing; the
rest are nits and owner/design questions.

## Checks run

| Check | Result |
|---|---|
| `git merge --no-commit origin/claude/compassionate-johnson-k95ssr` (e7dd94c) | Clean, no conflicts (myOffers.test.tsx auto-merged; main brings serve.ts, purge.ts, Security.tsx latestHoldEnd, tests). Merge aborted, nothing committed. |
| `npm ci` | ok |
| `npm run typecheck` (all workspaces) | exit 0 |
| `npm run copy-lint` | "apps/web/src is clean" |
| `npx vitest run apps/web` | 81 files, 1105 tests passed |
| Playwright `--workers=1`, X2F_CHROMIUM_PATH=/usr/bin/chromium: parity, shell, fold, browse-sell, browse-buy, myOffers, post, wallets | 159 passed, 0 failed. parity-pixels are report-only (Main 19.79%, BuyMain 19.67%, SellOffers 18.94%, BuyOffers 19.37%), no blocking parity. |

Heavy runs were under `flock ~/x2f-comms/check.lock`. The checks ran on e5ac017 alone (not the merge result); the merge touches no file this branch changes except myOffers.test.tsx, and that is the same 30 s budget commit on both sides.

## model.ts summary logic (correct)

- `summaryLine(status, results, before)` counts `changed` against the statuses before, so an offer already in the asked status is "already on/off", not "turned on". This matches the API: `POST /v1/account/offers/status` (apps/api/src/offers/routes.ts:689) returns an offer already in that status as done, with no refusal. Defaulting `before = []` keeps the old count for callers that do not pass it.
- Hold branch: `status === 'live' && changed === 0 && some refused === 'trading-hold'`. `accountRefusal` (routes.ts:339) refuses every off offer during a hold. The only off offers that escape it are method-unavailable ones (the method check comes first, routes.ts:695), so under a hold `changed` is always 0 and the branch fires. The text matches the review's draft copy for shot 33. The `already` offers that are on but hidden are not counted as "turned on". This is the documented fix.
- `isHeld`: true if a Turn on was refused for the hold, or if any live offer has `hidden === 'trading-hold'`. This matches routes.ts:606, which marks every live offer during a hold. Its blind spot (only Off offers and no Turn on yet) is documented as an API follow-up.
- `statusLine(o, held)` and `countLine(offers, held)` follow review shot 34. Grammar fixed ("1 offer stayed as it was"). Pluralisation is covered by tests.
- No other behaviour changes. Refusal Notices go from `x2f-error`/alert to caution/alert (still announced). A failed switch is still danger.

## Accessibility (good)

- Switch: a real `<button role="switch" aria-checked>`, 60×44 hit box, keyboard via the native button (Space/Enter), and focus ring from base.css `button:focus-visible`. It is named by aria-labelledby (title, method, price, limits) and described by the status (and the why line, if there is one). The accessible name no longer starts with "On", which is fine because the switch state carries it.
- Checkbox: a native 24 px input inside a 44×44 label (`accent-color: var(--x2f-ink)`). Mixed is shown through `indeterminate`, which Playwright confirms is exposed. Select all has a visible label plus aria-describedby for the hint.
- Clear 44 px, Turn on/off 44 px, Post an offer 56 px. The selection bar is a named region. Contrast of the caution 13 px text is ok in both themes (day #8a5a00 on #fff ≈ 5.6:1).

## Shared tab-bar change

- `.x2f-bottom-nav__tab[aria-current='page']` is now ink with a 2 px inset top line (ui.css:437-441).
- `min-height: calc(100dvh - 61px)` applies to `main` only when the phone shell has the nav (ui.css:449). `[data-shell-body]` is `display: contents`, so the selector still matches by DOM.
- Main, BuyMain, browse, post, wallets (including "Save footer stays pinned"), shell and fold specs all pass. No new parity regressions are blocking.

## Findings

### Important
None.

### Minor
- **M1 `refusedHold` never resets** (apps/web/src/screens/MyOffers.tsx:58, :118). Once a Turn on is refused for a hold, the screen stays in the hold state ("Trading hold · all offers hidden", every row "Hidden · trading hold") for the rest of the mount. That holds even after a later Turn on succeeds, or a reload shows no `hidden: 'trading-hold'` (hold lifted). **Fix:** on every Turn on, set it from that call (`if (status === 'live') setRefusedHold(results.some((r) => r.refused === TRADING_HOLD_CODE))`), and clear it in `reload()` when the list loads. Add a unit test: refused for hold, then a Turn on that succeeds, and the header returns to "N of M offers on".

### Nits
- **N1** apps/web/src/ui/Checkbox.tsx:16-18. The `indeterminate` effect depends on `[mixed]` only. A click on a mixed box clears `indeterminate` in the browser. If the parent keeps `mixed` true (a no-op handler, or a disabled state flipping), the effect does not re-run and the box shows ticked or unticked while the state is mixed. The current SelectAll always leaves mixed, so this is not reachable today, but the part is meant to be shared. **Fix:** `useEffect(..., [mixed, checked])`, or set it in a ref callback on every render.
- **N2** apps/web/src/screens/MyOffers.tsx:279. The `aria-live="polite"` count is inside the bar, which mounts on the first tick. A live region inserted together with its text is usually not announced, so "1 selected" is silent and later counts are read. **Fix:** keep an always-mounted visually-hidden live region outside the bar, or accept as is.
- **N3** apps/web/src/ui/ui.css:437-441. Conventions (2 Nov, "Current nav item") say "ink text on `--surface-raised`, with a 2px ink inset line". The build has no `--surface-raised` background. Review X1 only asks for ink + top bar, so the two refs differ. **Fix:** add `background: var(--x2f-surface-raised)` if the conventions win (see Q2).
- **N4** apps/web/src/ui/ui.css:445 (`--x2f-tab-bar-height: 61px`) is tied to the 60 px tab plus the 1 px border by hand, and neither accounts for `env(safe-area-inset-bottom)`. That gap was already there, but the action bar now relies on this number. **Fix:** a comment pointing at `.x2f-bottom-nav__tab { height }`, or derive both from one token.
- **N5** apps/web/src/screens/MyOffers.tsx:119/188. On a hold refusal, the caution Notice (role=alert) and the CantDoThat popup both announce the same thing. This was already the case before the branch (alert + popup). It is fine to leave.
- **N6** The `.x2f-switch:disabled` opacity 0.5 and `disabled={busy}` move focus off the switch the user just pressed during the call. This was already the case before the branch.

## COPY-UNSIGNED / copy-lint
New sentences are marked: countLine and statusLine hold copy, the hold summary, "N were already on", "stayed as it was", the empty state ("No offers yet" / "Post an offer to buy or sell XMR."). copy-lint is clean.

## Questions (product/design choices not settled by the board)
1. **Q1 Off offers during a hold** read "Hidden · trading hold" (review shot 34 says "each row"), so the row no longer says Off. After the hold lifts, those offers stay hidden because they are Off, not because of the hold. Keep it as is, or show "Off · hidden from everyone" for Off offers and the hold line only on On offers?
2. **Q2 Current tab background**: conventions say on `--surface-raised`, review X1 says ink plus top bar only. Which wins for every tab bar?
3. **Q3 Footnote and empty-state cap sentence** ("2 offers per side ... for each currency") is left out because the API caps are 3 per market and 20 in all. This is already an open owner question; it needs an owner answer before the copy is signed.
4. **Q4 Shot 54 (fold 884)** in the reshoot still shows one centred column across the hinge. The review marks this as NEEDS_DESIGN (list in the left pane, selected offer + Edit in the right). It is not addressed in this branch and is still open for Claude Design or the owner. The Wide table layout (MyOffers-Wide) and the per-offer Edit link are also not built (tripwire NEEDS_DESIGN_MYOFFERS, Task 35).
5. **Q5 Hold detection with only Off offers** needs an account-level hold flag on GET /v1/account/offers (API follow-up already noted in model.ts isHeld). Schedule it?
