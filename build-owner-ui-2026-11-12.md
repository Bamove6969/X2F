# Build: owner-UI review fixes and the integration (12-17 Nov 2026)

Builder helper, from the review `review-owner-ui-2026-11-12.md`. Worktrees in the scratchpad
(`wt-oub`, `wt-oub2`, `wt-oub3`, `wt-red`); every test through `~/x2f-comms/check.lock`, the timeout
inside the lock; Playwright on /opt/pw-browsers/chromium with `--trace off`. Not committed (comms).

## Heads

| Branch | Was | Now | Pushed |
|---|---|---|---|
| wip/lead-owner-layout-1 | 9cd77a12 | c728c8b6 | yes |
| wip/lead-landing-tour | 9456548f | 609fba83 | yes |
| wip/lead-tours-staff-team | e4b20baf | 63a69d04 | yes |
| wip/lead-owner-ui (new, on main 4f0afa14) | - | f06301cf | yes (new branch) |

Integration (first parent): terms-v2 a467c7e7, owner-copy-1 7348962c, layout-1 c728c8b6, landing-tour
609fba83, tours-staff-team ead0bb90; the copy-1 minors (eabb8327 RED, c9d3d905); the folded Duo and
help links (307fbd19 RED, 93c56bb0); a C2 test fix (ed4b8110); tours-staff-team again at 63a69d04. No
conflicts on the integration itself. The StaffShell.tsx conflict was resolved on tours-staff-team
(merge 051713e1: main's Notifications link and clock-out block, data-part="logout" on Log out).

Stacking: tours-staff-team now contains main 4f0afa14 and landing-tour (its data is in the engine's
types, which live on landing-tour). landing-tour's help links go to layout-1's /help/:topic, so land
layout-1 before or with landing-tour (the integration's order).

## wip/third-demo-r3 and wip/second-fonts (coordinator, 17 Nov)

third-demo-r3 (94337781) already merged the ORIGINAL layout-1 9cd77a12, landing-tour 9456548f,
copy-1 and terms, and second-fonts (7314ab50, DM Sans and DM Mono, sizes one more step up). It does
not contain any commit of this build. Where it had fixed a review finding, this build now uses its
version, so the two do not fight:

- B2, the scrim: r3's even-odd path with the shape also as CSS `d`, keyed like the ring (86f53562,
  ed931794) and its glide test, in place of this build's path plus fading patch. The hole no longer
  fades between stops (r3's DESIGNER-REVIEW note).
- B3, orange on the example stage: r3's choice (fdd02939): the scan line keeps orange with no glow;
  the welcome mark's dot ring, the stage's primary action and hold and the scan line stay orange and
  are listed in selection-ink.test.ts's ORANGE_ALLOWED with design's reasons. This replaced this
  build's ink ring and kit classes. A test change for the lead to accept (r3 made it).
- L1, loginApproveV2: r3's exact text (3c83307b), so a later merge is clean.
- B5, team.spec's join phones: r3's freshPhone wording (d23de39b), plus a `newDevice` option for the
  member-tour test (tours-staff-team).
- The folded iPhone Duo (4-B5 second part): r3's 1ccbb0b9 (a phone screen's min-height leaves out the
  52 px ScreenHeader) on the integration, a layout change; the header stays on /welcome as on r3.
  This build had first skipped the header on /welcome (review L6's idea); dropped to match r3.

Not reused, on purpose:

- B1: r3's 884a5548 lets bundle.test allow the stage's own `satoshi_ghost`. The lead's call here was
  to rename and reserve; with example_seller the stage has no `satoshi_ghost`, so bundle.test passes
  unchanged here, and r3's exemption is empty once this lands (recommend reverting 884a5548 then).
- cantDoThat cap: r3 is at 69 (its other branches); these branches keep main's 66.
- second-fonts: not in this integration (not in the list). Its later merge will move the type pins
  again (sheet title 28/34, screen title 34/40) in loginApproveV2.test and tokens.test.


## What changed, by branch

### wip/lead-owner-layout-1 (4a4614f0 RED, 1eef8f90, c728c8b6)
- L1: loginApproveV2 pins the #43 scale (sheet title 26/32, screen title 30/34), in r3's words.
- L2: fold.spec caps the anchor's drift at a quarter of the phone's view (125 px at 500 tall).
- L5: ScreenHeader takes `as="div"`; Buy/Sell's bar and the trade header use it, and the bar's
  wrappers are divs: no header inside a header or a span; the trade room has one header element.
- L3/L4: /help/:topic is the one help page. Each topic has a line for someone logged out and one for
  someone logged in (COPY-UNSIGNED); signed in, Support links to Feedback and Settings to Security,
  and "Back to trading" goes to /sell; a team member gets no Settings link (owner-only). Someone
  inside keeps the wide rail on /help (DesktopShell's PRE_LOGIN frame only for someone outside).

### wip/lead-landing-tour (88e964f9 RED, 52ccd42d, f701110e, 62b71ef8, 077a5b5c, 609fba83)
- B1: the example trader is `example_seller` (avatar ES). `example_seller` and `example_buyer`, with
  look-alikes and either separator, are reserved display names (packages/accounts; the API refuses
  them at register). The stage is a lazy chunk (React.lazy + Suspense in TourProvider). bundle.test
  is unchanged and passes (it scans every chunk, so the rename is what makes it pass).
- B2, B3: r3's versions (see above).
- B4: the two new pragmas are gone: the stage now shows the real screens' own lines, moved to
  screens/trade/escrowCopy.ts with their existing pragmas (TradeFund "One key alone can't move
  anything.", SellerConfirm's release note). Count 66, cap 66 unchanged. The stage's release line
  now reads as SellerConfirm's ("1.5 seconds", not "1.5 s").
- B5: playwright.config marks the welcome seen on 127.0.0.1 and localhost. A context a spec makes
  takes that storageState too unless given one.
- First-device journey: setup.spec "on a new device": sign-up, first login, /welcome, Skip to /sell.
- T1: the tour draws nothing and takes no keys while a Sheet is open (body > .x2f-sheet-layer),
  and carries on at the same stop when it closes.
- T2: tests for #root inert and the Tab/Shift+Tab trap (unit and e2e).
- T3: WelcomeGate keeps the query; Skip goes to /sell with it.
- Help: the signed-in /help page is gone; the welcome links are /help/faq, getting-started, support,
  settings.
- Members (lead call): WelcomeGate and WelcomeScreen never show /welcome to a member; both wait for
  the session first (useSession starts at `loading` in every component, which sent a member to
  /welcome and back; 609fba83).

### wip/lead-tours-staff-team (merge main 051713e1, db0f21cd RED, 5e2eb51f, merges of landing-tour,
fc98bfc7, clock-out fix, 63a69d04)
- S2: the staff and member tours are the engine's TourDef (staff-web reaches the types through
  ui/kit.ts); placements auto/above/below/center; unique step ids.
- S3: `staffTour({ role, nav })` builds from the server's me.nav.
- S1: S5 reads "When your shift ends, tap Clock out. Only clocked-in time is paid." for staff who clock
  out (COPY-UNSIGNED); the owner's S5 is "Log out when you step away." New stops: Clock out (staff,
  `data-part="clock-out-button"`; `clock-out` is the clock-out sheet's own) and Notifications (owner,
  `data-part="notifications"`), lead drafts, COPY-UNSIGNED.
- Members: a member's first /sell on a device starts the member tour (from me.member.abilities)
  once; its closed line is "Tour closed." (TourDef.closed; members have no Settings > Help). The
  Trade room page needs a trade code and is left out without one.

### wip/lead-owner-ui (integration)
- C1: an item not done yet is role=img "Not done yet" (COPY-UNSIGNED).
- C2: no `good`/green token exists, so the ticks use the kit's `--x2f-escrow` token (DESIGNER-REVIEW).
- C3: Welcome.tsx no longer exports FEE_SENTENCE; task28-units pins offerForm's (PostOffer's).
- Folded iPhone Duo: r3's 1ccbb0b9 (layout; the check unchanged). Welcome links = HELP_LINKS.

## Tests changed, and why

- loginApproveV2.test: the two title pins moved to 26/32 and 30/34 (owner #43; r3's words).
- fold.spec: added the drift cap (review L2). Two of the anchor's lines was tried first and failed:
  the anchor is often a button (a 20 px line) and the rewrap alone moves it 43 px.
- shell.spec: `header[data-screen-header]` became `[data-screen-header]` (a div inside bars); added
  "no header inside a header or a span"; the Landing check counts any screen header (stricter); new
  wide /help test (rail signed in, centred frame signed out).
- ownerLayout.test: the trade header's screen header is a div and the room has one header; HelpTopic
  signed out / signed in / member (useSession mocked); WELCOME_COPY.links is HELP_LINKS.
- username.test, password.test (API): the two example names are reserved, with look-alikes.
- tour.test: inert, Tab trap, Sheet deferral, even-odd dim with no mask, example_seller, r3's glide
  test, a tour's own closed line.
- frontDoor.test: the gate keeps the query; members (landing-tour: straight to /sell; tours-staff-team:
  the member tour, once, and /welcome sends a member to /sell); the welcome flag's memory reset in
  beforeEach (a Skip in an earlier test had set it).
- tour.spec: the welcome links' hrefs are /help/* (were /help#..., /feedback, /settings/security):
  one help page; #root inert and Tab inside the card; the Released line names example_seller.
- playwright.config: storageState on both origins (harness, B5).
- team.spec: the join phones seed the welcome flag (r3's d23de39b); a new-device member-tour test
  with an explicit empty storageState; a "no welcome after the join" assertion.
- setup.spec: the new first-device journey (it picks a session length before Continue).
- selection-ink.test: ORANGE_ALLOWED +3 (r3's: the mark's dot ring, the stage's action/hold, the scan
  line). Lead to accept, as r3's review did.
- tourSteps.test (staff-web), memberTourSteps.test: same assertions on the TourDef shape
  (explanation -> body, route -> page path), plus me.nav, type-shape, S5/Clock out/Notifications.
- ownerCopy1.test: C1-C3 (C2 reads setup.css by file path under happy-dom); task28-units imports
  FEE_SENTENCE from offerForm.ts, same assertion.
- Not changed: bundle.test, proof-render-tripwire, kit-tokens, cantDoThat-lint (cap 66).

## Test runs (all through the lock)

RED first, where the fix is new:
- layout 4a4614f0 (src stashed): ownerLayout 5 failed; shell.spec 2 failed, fold.spec 1 failed (the
  2-line cap; replaced by the quarter-view cap).
- landing-tour 88e964f9: web 11 failed / 194 passed (bundle 2, cantDoThat, kit-tokens, tripwire,
  selection-ink, frontDoor 2, tour 3); accounts 8 failed / 49; API password 1 failed / 45; e2e 3
  failed / 107 (two tour.spec link checks, one setup journey).
- tours-staff-team db0f21cd: staff tourSteps did not compile (red); web 15 failed / 111; e2e 3 failed.
- integration: copy minors at eabb8327 3 failed / 9; ownerLayout at 307fbd19 1 failed / 12; the folded
  Duo at 307fbd19 failed (Skip's bottom 657 > tab bar 617).

Green:
- layout-1 (1eef8f90): vitest ownerLayout, loginApproveV2, tokens, frontDoor 118/118; e2e shell + fold
  42/42. (c728c8b6 changes one comment only; covered by the integration run.)
- landing-tour 609fba83: web (tour, frontDoor, bundle, tripwire, kit-tokens, selection-ink,
  cantDoThat-lint, release) 206/206; accounts username 57/57; API password 46/46; e2e tour, team,
  setup, release 110/110.
- tours-staff-team 63a69d04: staff-web tourSteps, oneDoor, clockOut 26/26; web memberTourSteps,
  frontDoor, tour 127/127; e2e team + tour 42/42.
- integration f06301cf: tsc web, staff-web, api clean; vitest @x2f/web 2181/2181 (141 files);
  @x2f/staff-web 77/77; @x2f/accounts 148/148; @x2f/api 2678 passed, 1 todo (115 files); Playwright
  setup, login, tour, team, owner-copy, shell, fold, release, fund 238/238.
- One earlier full API run (on 93c56bb0) failed xmpp.test once ("device: prekey already used", OMEMO
  real encryptor). Nothing here touches OMEMO; it passed 30/30 on main and in the final run. Flaky,
  for whoever owns packages/omemo.

## Owner / lead questions

1. Example names: the tour's counterparty is the buyer ("Selling to example_seller"). The lead named it
   example_seller; example_buyer is reserved too, if the owner prefers the role to read right.
2. Members: the member tour starts by itself on a member's first /sell on a device (no choice screen).
   Members have nowhere to replay it yet (Security is owner-only); its closed line says only "Tour
   closed." Where should a member replay it?
3. Copy for the owner (COPY-UNSIGNED): S5 for staff (the lead's draft), the owner's S5, the Clock out
   and Notifications stops, the /help/:topic lines for each reader, "Not done yet".
4. Design: the setup ticks are the escrow colour until a green token exists; the tour's hole no longer
   fades between stops (r3's choice).
5. After this lands with third-demo-r3: r3's 884a5548 bundle exemption for satoshi_ghost is empty and
   can go; second-fonts moves the type pins again.

Worktrees: scratchpad wt-oub, wt-oub2, wt-oub3, wt-red (node_modules removed at the end).

