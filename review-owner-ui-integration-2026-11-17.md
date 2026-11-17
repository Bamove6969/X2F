# Review: owner-UI integration, wip/lead-owner-ui f06301cf (17 Nov 2026)

Independent reviewer, 2026-11-17. Code and test review of `wip/lead-owner-ui` @f06301cf against main
4f0afa14, following the builder's `build-owner-ui-2026-11-12.md` and the earlier
`review-owner-ui-2026-11-12.md`. Detached worktree in the scratchpad (`wt-rev-oui`, no node_modules
installed, removed at the end). **No tests were run by me**: the full `npm run check` is on the cloud
runner, as the lead asked, and nothing here needed a targeted run (static checks below).

**Verdict: APPROVE WITH MINORS**, subject to the cloud runner's full check coming back green. Every
earlier finding is fixed. No test was weakened. The test changes the lead must accept (the selection-ink
additions, the fold drift cap, the help-link hrefs) are justified. The reserved-name change only adds
refusals. Members never reach /welcome or the trader tour. No change to money, keys or login security.

## Integration shape

The first-parent merges are the right shas. a8e7a0ab merges terms a467c7e7. 3d000356 merges copy-1
7348962c. 28170739 merges layout c728c8b6. e75579b2 merges landing-tour 609fba83. 24a1199c merges
tours-staff-team ead0bb90. f06301cf merges tours-staff-team 63a69d04. The origin heads of all five
branches match the shas named. Between the merges come the builder's own commits: eabb8327 RED,
c9d3d905, 307fbd19 RED, 93c56bb0 and ed4b8110. In all, 67 files change.

## Earlier findings: all fixed

| Finding | Status | How it is fixed now |
|---|---|---|
| L1 loginApproveV2 pin | fixed | Pins 26/32 and 30/34, with the same comment text as third-demo-r3's 3c83307b, so the later merge is clean. |
| L2 fold looseness | fixed | `\|after.top - before.top\| <= view/4` (125 px at 500 tall; 43 px seen), on top of the in-view and `scrollY > 0` checks. This was one of the two tightenings I suggested. |
| L3 two help pages | fixed | One `/help/:topic` page. The signed-in `/help` is gone. Welcome uses `HELP_LINKS`. Someone inside keeps the rail on /help (`helpInside`). shell.spec checks both frames. |
| L4 help copy when signed in | fixed | Each topic has an `out`, an `in` and an optional `member` line. The back link goes to /sell or /login. ownerLayout.test checks every topic both ways. |
| L5 header in span / two headers | fixed | `ScreenHeader as="div"` in MethodList and TradeHeader. shell.spec asserts `:is(header, span) header` has count 0. The trade room has one header (unit test). |
| B1 satoshi_ghost in bundle | fixed | The stage uses `example_seller`. No `satoshi_ghost` is left in src/tour. bundle.test is unchanged (FORBIDDEN still lists it). The stage is a lazy chunk. |
| B2 url() mask | fixed | An even-odd path with no SVG mask, so TourProvider has no `url(`. proof-render-tripwire is unchanged. |
| B3 kit-tokens / orange | fixed | No `box-shadow` in tour/*.css or welcome.css (the scan line's glow was dropped). The orange uses are listed in ORANGE_ALLOWED (see below). kit-tokens is unchanged. |
| B4 cantDoThat cap | fixed | The stage's two pragmas are gone: the lines moved to `screens/trade/escrowCopy.ts` and keep their single pragmas (TradeFund and SellerConfirm render the same strings). Comment pragmas `not-a-refusal:` go from 66 on main to 67 (one added, sessionCopy's askHint). The cap is 67, with a reason. |
| B5 team.spec origin | fixed | playwright.config seeds both origins. `freshPhone` seeds LOCAL explicitly, and a `newDevice` option gives an explicitly empty storage. |
| B5b folded Duo | fixed | third-demo-r3's 1ccbb0b9: `--x2f-shell-header` is set only where the shell draws the header, and is subtracted from the 100dvh screens (trade room, wallets). |
| T1 tour over Sheets | fixed | `useSheetOpen` (a MutationObserver on body for `body > .x2f-sheet-layer`). While a Sheet is open the overlay is not rendered, so no scrim and no key handler. The Sheet portals outside the inert `#root`, so it stays reachable. The tour carries on at the same stop afterwards. |
| T2 inert / Tab | fixed | Unit tests, plus tour.spec, which asserts `#root[inert]` during the tour and removed after Esc, and three Tab and three Shift+Tab presses staying inside the card. |
| T3 gate drops query | fixed | WelcomeGate navigates to `/welcome${search}`, and Skip goes to `/sell${search}` (frontDoor.test). |
| C1 open item state | fixed | The open tick is `role="img" aria-label="Not done yet"` (COPY-UNSIGNED). |
| C2 hard-coded greens | fixed | No `#3ccf7a` or `#1a7f45` left. The ticks use `--x2f-escrow`, with a DESIGNER-REVIEW comment. |
| C3 dead export | fixed | Welcome.tsx no longer exports FEE_SENTENCE. task28-units imports offerForm's, the one PostOffer shows, with the same assertion. |
| T4 / S1 / S2 / S3 | fixed | Members get the member tour (below). S5 agrees with the pay rule, with Clock out and Notifications stops. The data is the engine's TourDef. The tour is built from `me.nav`. |

## Test changes: none weakened

- **selection-ink ORANGE_ALLOWED +3:** `.x2f-mark__ring`, `.x2f-ex__button, .x2f-ex__hold` and
  `.x2f-ex__scan`.
  - Accept. The test's real assertion (no selected-state rule is orange) is untouched.
  - ORANGE_ALLOWED is the list of non-selection uses, and two of the three fit categories already on it:
    - The stage's primary action and hold mirror `ui.css .x2f-button--primary` and `.x2f-hold`.
    - The mark's ring is round logo D's dot, like `.x2f-logo__dot`.
  - The scan line is the only new kind: decorative, and now with no glow.
  - Each line carries design's reason. third-demo-r3 made the same choice (fdd02939), and its review
    accepted it.
  - The stage's selected states (`[data-state='ok']`, `[data-done='true']`) are escrow-coloured, not
    orange.
- **fold.spec drift cap:** accept. It is stricter than the 9cd77a12 version, which had only the in-view
  bounds. The reason the builder gives for not using two line heights (a button anchor has a 20 px
  line, and the rewrap alone moves it 43 px) holds.
- **tour.spec help hrefs** (`/feedback` and `/settings/security` became `/help/support` and
  `/help/settings`): accept.
  - This follows the L3 ruling (one help page).
  - The way on from the help page is now pinned in ownerLayout.test: the owner gets `/feedback` and
    `/settings/security`; a member gets `/feedback` and no Settings link.
  - The one cost is an extra tap to reach Settings from /welcome. That is a design point, not test
    coverage.
- **shell.spec:**
  - `header[data-screen-header]` became `[data-screen-header]:visible`, still with count 1. A new
    nesting assertion closes the gap that change leaves.
  - The Landing check is stricter.
  - The top-left logo test was already in 9cd77a12 (owner #37).
- **team.spec:**
  - The join tests now assert there is no welcome screen.
  - A new test covers a member on a new device: they get the member tour, not /welcome, and only once,
    because /sell again shows no card. /welcome then sends them to /sell.
  - Seeding the flag in the join tests hides nothing: members never go to /welcome anyway, and the new
    test covers the unseeded path.
- **frontDoor.test:** additions only, plus `resetWelcomeMemory()` in beforeEach, which is test isolation.
- **tourSteps (staff-web) and memberTourSteps:**
  - Every removed assertion has a one-to-one replacement in the TourDef shape (`explanation` became
    `body`; `route` became the page `path`; `staffTour(role, grants)` became
    `staffTour({ role, nav: navFor(role, grants) })`). There are new assertions too.
  - A new `s.target !== null` guard in `missingTargets` is a type necessity only: no staff or member
    step has a null target.
- **loginApproveV2, tokens, termsSignature, task28-units, setup.spec:** already judged in the 12 Nov
  review, or a pin moving with the text or tokens (the Terms version, #43).
- **Not changed:** bundle.test, proof-render-tripwire, kit-tokens, cantDoThat-lint's logic (only the
  cap and its comment).

## Reserved display names: no bypass

`packages/accounts/src/username.ts` adds `RESERVED_NAMES` (`exampleseller`, `examplebuyer` after
`lookAlikeKey` and with the separators dropped). It also adds one line in `isReserved`:
`if (RESERVED_NAMES.has(flat)) return true;`.

- **The change only adds refusals.** It is an early `return true` before the unchanged prefix and suffix
  rules. The token rules and the other rules run as before, so no name that was refused is now allowed.
- **Only display names are checked.** `checkLoginName` is unchanged (shape only), and so are
  `lookAlikeKey`, the shape regex and the 64-unit pre-check.
- **There is no apps/api source change.** The API refuses these names through `checkNames` and
  `checkDisplayName`, at register, at a display-name change (nudge/names.ts) and for team-member names
  (team/members.ts). All three paths now refuse the example names, which is consistent. No API route
  writes `display_name` without `checkDisplayName`.
- **The staff and owner impersonation checks are untouched.** They are the API's own `lookAlikeKey`
  comparison.
- **Look-alikes:** 0/o, 1/l/i, rn/m, any case, and `.`, `-`, `_` or no separator (also doubled
  separators, since all are stripped). Non-ASCII is refused earlier by shape.
  - username.test covers both names, case, both separators, none, `examp1e_se11er` and `exarnple_buyer`.
  - It also checks that near names stay allowed: `example_sellers`, `my_example`, `example.k`,
    `buyer_one`, `seller_42`.
  - password.test checks that register returns 400 `display-name-reserved` for `example_seller` and
    `Example.Buyer`.

## Members never reach /welcome or trader-only screens

- **WelcomeGate** waits for the session (`loading` renders nothing). For a member it never redirects to
  /welcome. On their first /sell on a device it marks the welcome seen and starts `memberTour(abilities)`.
- **WelcomeScreen** renders nothing while the session loads and sends a member to /sell, so a deep link
  to /welcome is covered (frontDoor.test, team.spec).
- **useSession** shares one promise, so the door, the gate and the screen read the same answer.
- **The first-trade tour starts from only two places:** WelcomeScreen, and Security's HelpCard. Security
  is wrapped in `<OwnerOnly screen="security">`. A member has no path to the trader stage or its "Press
  and hold to release" stop.
- **The member tour's pages** are /buy, /profile/offers, /settings/changes and /feedback, plus
  /trade/:code only with a code, which this call never passes. Each appears only when the member's ticked
  boxes, or `always`, put a stop on it. The owner-only screens (Wallets, Security) are in
  PENDING_MEMBER_STOPS, in no tour.

## The help page shows members no Settings link

`HelpTopic` drops the link when `member && link.owner === true`. Only Settings has `owner: true`. A member
reads the `member` line ("The account owner looks after the settings ...") and keeps Support's Feedback
link. ownerLayout.test pins this.

- **info H1:** on wide screens the signed-in /help now keeps the rail (L3), and the rail's `LINKS` include
  Settings and Wallets for everyone, members too. This is main's rail, the same on every signed-in screen,
  and not new here. The help page itself shows members no Settings link. If members should not see
  owner-only rail links at all, that is a separate pre-existing item for the lead.
- **info H2:** `HelpLinks` on /session-length, which a member may see, still names a link "Settings". It
  goes to the help topic, which for a member has no onward link. Fine. The label is COPY-UNSIGNED.

## Money, keys, login security

- No change to packages/escrow, trade, protocol or proof. No apps/api src change, and no change to the
  login, recovery, WebAuthn or session logic.
- **TradeFund and SellerConfirm:** the same two strings now come from `escrowCopy.ts`. The text is
  identical and nothing else changes.
- **trade.css and Wallets.css heights:** `calc(100dvh - var(--x2f-shell-header, 0px))`, which is
  layout only. The variable is 0 on the trade room, which draws no shell header.
- **sessionCopy:** copy only (the owner's words), COPY-UNSIGNED. The session-length logic is unchanged.
- **StaffShell:** `data-nav`, `data-part` attributes only, plus main's clock-out block kept.
- **staff-web kit.ts:** a type-only re-export of the tour engine types.
- **localStorage:** only `x2f.welcome.seen` = "1" and the tour stop index, as reviewed on 12 Nov.

## Minors and info (none blocking)

1. **info H1 and H2** above (the rail is pre-existing; a label only).
2. **Copy:** the stage reads "Selling to example_seller", so the named party is the buyer. This is
   already the builder's owner question 1. `example_buyer` is reserved too.
3. **Tests:** the lead must formally accept the selection-ink +3. I recommend accepting them.
4. **After third-demo-r3 lands:** revert its 884a5548 bundle exemption for `satoshi_ghost`, which is
   empty once this branch is in. second-fonts will move the type pins again.
5. **Deploy:** `X2F_TERMS_VERSION=2026-11-12` with this web build (carried from the 12 Nov review).
6. **The approval depends on the cloud runner's full `npm run check` on f06301cf.** I ran no tests. The
   builder reports web 2181/2181, staff-web 77/77, accounts 148/148, api 2678 plus 1 todo, and e2e
   238/238 on this head. The xmpp.test OMEMO flake is unrelated.

## Owner and lead questions

These carry the builder's list forward, with nothing new from this review except H1:

- **H1, for the lead:** should the wide rail hide Settings and Wallets from members? This is pre-existing
  on main and not part of this branch.
