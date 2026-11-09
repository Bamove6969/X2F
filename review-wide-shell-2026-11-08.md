# Review: wide shell (Job 3), 8 Nov 2026

- Branch: `wip/lead-wide-shell` at **391661e4** (worktree agent-af5162d455652e9a7, clean), on top of `origin/wip/lead-job2-kit`.
- Diff reviewed: `git diff origin/wip/lead-job2-kit...HEAD` (18 files, +621 / -74).
- Spec: design-review-real-app-2026-11-08 items 2 and 3, design-build-gaps README Job 3 (item 3 "Screen frame"), design-kit-handoff, Desktop / Login-Wide / SellQuote-Wide / Block-Wide / FlexOffer-Quote-Wide and the other *-Wide boards on `origin/wip/design-brief`.
- Tests I ran (vitest, 3 files): `test/wideShell.test.tsx` 14/14, `test/ui.test.tsx` 42/42, `test/selection-ink.test.ts` 4/4. I ran no Playwright.

## Verdict

**Approve after one Important fix (I1).** The minors can land later or go to design.

## What I checked and found correct

- **Logo D.** The 24 and 32 letter paths in `apps/web/src/ui/Logo.tsx` are byte-identical to `docs/brand/svg/x2f-color-{24,32}-day.svg` (compared by script). The dot geometry matches too (56/11/3 and 73/15.5/4). The letters use `currentColor` and the dot uses `var(--x2f-monero)` (`ui.css` `.x2f-logo__dot`; the token is #ff6600 in both themes). There are no hex values and no style attributes, so it is CSP-safe. The `selection-ink` allow-list entry is justified.
- **Rail.** It is 240 px with 24/16 padding, a 4 px gap, a 1 px raised right border, 44 px links, `radius-sm` (6), and the current page on the raised surface with the inset 2 px ink line. That matches Desktop.dc.html on design-brief line for line (tokens instead of hex). The Settings and Help icons match the board's paths.
- **Page names.** The board-sourced ones match the boards: Find a trade, Your quote, Post an offer, My offers, Site news, Devices, Team, Feedback, and Trade · K7M2 with the code in mono (see M2 for the ones that don't).
- **Pre-login centred logo.** `/login`, `/login/backup`, `/setup/*`, `/terms` and `/team/join` show the 32 px logo in a 36 px row, 56 px from the top, as on Login-Wide. There is no navigation (`wideFrameOf`, DesktopShell.tsx:30-36). `/loginx` correctly gets the rail.
- **Widths.** Beside the rail the body pads 32 48 48. A single-column screen is at most 720 px. The quote, the room, `.x2f-columns` and page-look flows are at most 944 px (ui.css after `.x2f-desktop__body`).
- **App.tsx, no remount.** `Layout` keeps `[top, body, nav]` as fixed child slots, so `top` changing between `null`, `DesktopRail` and `WideTop` never remounts the `data-shell-body` subtree. The routes are unchanged (the diff touches only imports and `Layout`).
- **Phones unchanged.** All new layout CSS is scoped to `[data-shell='desktop']` or `[data-wide-frame='rail']`. On phone, `top` is null and `data-wide-frame` is undefined. The only phone changes are deliberate (item 3): logo D replaces the "X2F" text in the browse header (MethodList.tsx:88-90) and on the Fold-Cover glance (TradeGlance.tsx:155-157).
- **Post offer hiding.** The rail uses the same `mayPostOffers(session)` as the bottom nav. It returns false while the session loads and false for a member without `offers`, and true for the owner and for signed-out visitors. **The server refuses as well:** `POST /v1/offers` uses `requireSession({ kinds:['trader'], member:'offers' })` (apps/api/src/offers/routes.ts:374, 448), and PATCH, `GET /v1/account/offers` and the status route use the same `member:'offers'` guard (routes.ts:381, 483, 600, 660). So hiding the link is only cosmetic, and that is fine.
- **Accessibility.** The rail is one `<nav aria-label="Main">` that comes first in the DOM, so focus order is rail then page. Screens keep their own `<main>`, and the pre-login top is a `<header>`. `aria-current="page"` is on exactly one link per route (unit-tested across 12 paths). The logo inside the home link is `aria-hidden` and the link is named "X2F home"; standalone logos are `role="img"` named "X2F". Rail links are 44 px tall, and focus uses the global `a:focus-visible` outline, which the 16 px rail padding leaves room for.
- **Desktop board copy** (design/x2f-app/Desktop.dc.html). It is the design-brief rail with tokens resolved to hex, which matches the rest of that file, without the "My trades" card (the comment says why: `/trades` is unrouted). The wrapper `<div>` is opened and closed correctly.
- **Kit handoff line 677** ("Pre-login wordmark: plain ink X2F … It isn't a logo mark"). This contradicts design review item 3 and the Login-Wide board, which draws logo D at 32 in a 36 row. It is **docs only**: no code or test relies on a text wordmark (`.x2f-wordmark` is gone and nothing references it), and the build follows the board. Design should update line 677.

## Findings

### Important

**I1. The wide quote overflows sideways between 1000 and 1231 px.** `apps/web/src/screens/quote/quote.css:428` sets fixed `grid-template-columns: 560px 360px` (944 px total). The wide layout starts at 1000 px (`src/ui/fold.ts:34`), but the rail plus padding needs 240 + 48 + 944 + 48 = 1280 px. At 1000 px the body is 664 px wide, so the second column, which holds the Trade button, runs from x≈872 to x≈1232. Trade is cut off and the page scrolls sideways. That is the "Trade below the fold" problem from item 2, moved sideways. It also hits 1024 px windows and 1280 px windows with any side panel open. The e2e test only checks 1440×900 (quote.spec.ts:105).

- Fix: let the columns shrink, for example `grid-template-columns: minmax(0, 560px) minmax(280px, 360px)`, and add a one-column fallback when the body is too narrow (`@media (max-width: 1231px)` → `grid-template-columns: minmax(0, 1fr)`, footer `grid-column: 1`).
- Add an e2e case at 1024×768 asserting `document.documentElement.scrollWidth === 1024` and that Trade is visible.

### Minor

**M1. The Profile link goes nowhere.** DesktopShell.tsx:22 links to `/profile`, which has no route (App.tsx:202 `*` → `/sell`). Pressing Profile lands on Find a trade, with Trade marked current. The phone tab bar has the same dead link (BottomNav.tsx:15), so this was already broken; the rail just copies it. wideShell.test.tsx:73 asserts that `/profile` marks Profile, which hides the issue.
- Fix: either list the item as a known gap (Profile screen, gap list) or, until Profile exists, point it at the nearest built screen (as was done for Settings → Security and Help → Feedback) and record that in the comment.

**M2. Four page names aren't on any board.** They are user-facing copy, so the owner or design should sign them off.
- `/sell/:method` → "Offers". FlexOffer-Quote-Wide writes "Zelle offers", the method name plus "offers" (DesktopShell.tsx:48).
- `/settings/blocked` → "Blocked". Block-Wide's settings view writes "Blocked users" (its script line 255, `pn.settings`) (DesktopShell.tsx:54).
- `/trade/:code/dispute` → "Dispute · K7M2". No Dispute*-Wide board exists; the nearest is Appeal-Notice-Wide, "Appeal · K7M2" (DesktopShell.tsx:62).
- `/wallets` → "Wallets" and `/settings/security` → "Security". There is no Wallet-Wide or Security-Wide board.
- Fix: change "Blocked" to "Blocked users" now. Make "Offers" "<method> offers" once the method name is at hand, or keep "Offers" as COPY-UNSIGNED. Send the rest to design.

**M3. The home link (logo) is a 60×24 target, not 44 px.** `.x2f-rail__home` (ui.css, after `.x2f-rail__head`) is only as tall as the 24 px logo. It passes WCAG 2.2 AA (24 px minimum) but not the project's 44 px rule. The board draws it the same way.
- Fix: `min-height: 44px; align-items: center;` with `margin: -10px 0` so the layout doesn't move.

**M4. No route for My offers for a member without Offers.** With `postOffers=false`, `/profile/offers` has no current item, because only Post offer matches it (DesktopShell.tsx:20). The page itself gets 403s from the server, so this only matters when someone deep-links. It's cosmetic and can be noted and left.

## Not findings (out of Job 3 scope, for the lead's tracking)

- Signed out at wide, `/sell` shows the full rail (Wallets, Profile, Settings…). Design review item 1 (Landing, no public market) is a separate job; the rail only reflects the routing that already exists.
- The phone "logo – page name" header (item 3, phone half) and a phone pre-login logo are not part of this diff.
- The board's rail "My trades" card is left out on purpose until `/trades` exists. The previous top bar's "My trades" link was also dead.
- There is no skip link. It wasn't there before either (the old top bar came first too), so this is not a regression.

## Strings added (user-facing)

- **Rail links:** Trade, Post offer, Wallets, Profile, Settings, Help.
- **Rail page names:** Find a trade, Your quote, Offers, Post an offer, My offers, Wallets, Security, Devices, Blocked, Team, Site news, Feedback, "Trade · {code4}", "Dispute · {code4}" (and plain "Trade" / "Dispute" when the code doesn't parse).
- **Accessible names:** "X2F home" (rail home link), "X2F" (logo image).
- **Removed:** the old header texts "X2F", "Buy", "Sell", "My trades" (top bar) and the "X2F" text on the browse header and Fold-Cover glance (now logo D).
