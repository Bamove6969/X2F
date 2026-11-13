# Review: five owner-demo UI branches (12 Nov 2026)

Reviewer: independent helper, 2026-11-12. Code and security review of five branches cut from main
8246e64b, plus a merge check onto main 4f0afa14. Reviewed in a detached worktree with a fresh `npm ci`
(scratchpad `wt-ownerui`, removed afterwards). All test runs went through `~/x2f-comms/check.lock`, with the
timeout inside the lock. Playwright used /opt/pw-browsers/chromium with `--trace off`.

| Branch | Head | Merges onto 4f0afa14 | Verdict |
|---|---|---|---|
| wip/lead-terms-v2 | a467c7e7 | clean | **APPROVE** (info only) |
| wip/lead-owner-copy-1 | 7348962c | clean | **APPROVE WITH MINORS** |
| wip/lead-owner-layout-1 | 9cd77a12 | clean | **CHANGES NEEDED**: one blocking finding (a pinned token test fails) |
| wip/lead-landing-tour | 9456548f | clean | **CHANGES NEEDED**: four blocking findings (6 unit tests and 2 to 3 team e2e tests fail) |
| wip/lead-tours-staff-team | e4b20baf | **conflict** in apps/staff-web/src/ui/StaffShell.tsx (mechanical) | **APPROVE WITH MINORS** |

Note: the local ref `wip/lead-owner-layout-1` is still at b8489a7b. I reviewed origin's 9cd77a12 as asked.

## Tests run

The branch's own tests, each run on its own head:

- **terms a467c7e7**: vitest task28-units + termsSignature 38/38; `tsc -p apps/web` clean; e2e setup.spec 34/34.
- **copy 7348962c**: vitest ownerCopy1 + task28-units + cantDoThat-lint 39/39; tsc clean; e2e owner-copy.spec + setup.spec 36/36.
- **layout 9cd77a12**: vitest ownerLayout + tokens + frontDoor 97/97; tsc clean; e2e shell.spec + fold.spec 41/41.
- **tour 9456548f**: vitest tour + frontDoor 103/103; tsc clean; e2e tour.spec 13/13.
- **staff e4b20baf**: staff-web tourSteps 11/11; web memberTourSteps 13/13; tsc web and staff-web clean.

The combined run, on one merge of all five onto 4f0afa14 (eef0ed4b, local only; the StaffShell conflict
resolved mechanically by keeping main's clock-out block and adding `data-part="logout"`):

- `tsc` web and staff-web: clean.
- **vitest @x2f/web: 7 failed, 2157 passed (141 files).** The failing tests are bundle (2), cantDoThat-lint,
  kit-tokens, loginApproveV2, proof-render-tripwire and selection-ink.
- vitest @x2f/staff-web: 74/74.
- vitest @x2f/api: 2678 passed, 1 todo (115 files).
- **e2e setup, owner-copy, shell, fold, tour and team: 3 failed, 115 passed.** The failures are two team.spec
  joins and tour.spec's folded iPhone Duo.

Attribution: I ran those six vitest files on main and on each branch head, and team.spec on main and on the
tour head.

- main 4f0afa14: 57/57. team.spec 28/28.
- terms, copy, staff: 57/57.
- **layout: loginApproveV2 fails** (1 test).
- **tour: bundle (2 tests), cantDoThat-lint, kit-tokens, proof-render-tripwire and selection-ink fail** (6 tests).
  **team.spec: 2 failed, 24 passed.** Which join variant fails changes from run to run.
- The cantDoThat count is 69 on the merge: 66 on main, +1 from copy, +2 from tour.

Probes (scratch only, nothing committed):

- (a) The old fold assertion on the layout head: `scrollY` 143 against the expected 100 ±5, so it fails.
- (b) The member tour with one box at a time (disputes-answer, offers-pause, offers-delete, offers-post,
  trades-see-active): every target renders, 10/10.
- (c) tour.spec on layout+tour merged: 1 failed, 12 passed. Only the folded iPhone Duo fails (657 > 617),
  so the cause is the combination of the two branches: the 52 px ScreenHeader on /welcome plus the bigger type.

None of these failing tests ran in the branches' own runs. They are repo-wide tripwires and specs the branches
did not touch, so each branch's own suite was green.

## 1. wip/lead-terms-v2 (a467c7e7): Terms v2026-11-12

The diff changes termsText.ts (the owner's 16 comments), the version (2026-11-09 to 2026-11-12), the pin hash,
setup.spec's TERMS_VERSION, docs/dev-setup.md, and one assertion in task28-units.

- **info: the task28-units change is justified, not a weakening.** The old test checked that the Terms
  contained FEE_SENTENCE word for word. That sentence is no longer in the Terms: the owner replaced it with
  his own (comment 10475770, terms-draft item 7). The new assertion pins the two sentences that carry the
  rule (the poster pays 1%, taking an ad is free) and keeps the no-"!" check. The sibling test still pins
  FEE_SENTENCE itself to OD-7, and Welcome and PostOffer still use it. The rule's coverage is unchanged.
- **info: the server's X2F_TERMS_VERSION is a deploy setting.** No code in the repo pins it. The branch
  updates the only in-repo reference (docs/dev-setup.md). The API tests use their own versions. Whoever
  deploys must set `X2F_TERMS_VERSION=2026-11-12` with this web build, or sign-up shows "Reload the page".
  Put this in the landing note.
- **info: wording waits on the owner.** The lead's interim wording still waits on Q-5 to Q-16 and Q-K.
  Examples: the moderator-access paragraph, "without always giving a reason", and "send us feedback about the
  site" (the draft had "leave feedback"). It is marked COPY-UNSIGNED and needs no engineering change. The pin
  hash moves with the text, as the rule asks. No XSS surface: the Terms are rendered as React text.

## 2. wip/lead-owner-copy-1 (7348962c): /session-length and /setup/welcome

**Every old summarize() rule has a replacement assertion.** I checked them in ownerCopy1.test.tsx:

| Old rule (task28-units) | New assertion |
|---|---|
| The flow comes first (password + recovery codes, Cake …k3Fz) | "reads the flow first" checklist toEqual |
| A second PGP key comes from the flow | `PGP keys (2)`, in two places |
| A reload reads the account (pgp+security-key, security-key alone, password+recovery-codes, none) | "a reload without the flow state still reads the account", all four cases |
| An authenticator app is never the backup | `recoveryDone` false for password+totp; the app is listed only as a login method |
| Only a usable wallet is shown | usable:false gives null; the usable second wallet is chosen |
| (new) Methods ordered best to worst | two orders checked, plus the full six-method list |

The meaning changed on purpose: the "backup" row became "Emergency login method: recovery code documented",
and only recovery codes tick it. A security key or second PGP key is now listed among the login methods
instead of as the backup. On a reload, PGP is no longer named first: the security key and passkey come
first ("lead default, owner may reorder"). This is the owner's checklist, so it is not a weakening. Two
setup.spec assertions moved from `summary-backup` = "Recovery codes" to the recovery item's tick, which is
equivalent. The fee sentence asserted there is now the owner's Welcome line.

- **info: the cantDoThat cap 66 to 67 is justified.** The askHint ("…your account will be logged out for your
  security") is a hint shown before anything happens, not a refusal. But see finding 4-B4: on the five-branch
  merge the count is 69 against a cap of 67.
- **minor C1: an open item has no accessible state.** An undone item's tick is `aria-hidden` with no text.
  A screen-reader user hears the three item titles but not which ones are not done (the done tick says
  "Done"). Give the open circle `role="img" aria-label="Not done yet"` (COPY-UNSIGNED), or put the state in
  the item text.
- **minor C2: hard-coded greens.** The two greens (#3ccf7a night, #1a7f45 day) are local stand-ins outside the
  token set, and the comment says so. They should become a token when design lands them. No test flags this
  today.
- **info C3: dead export.** Welcome no longer shows FEE_SENTENCE, but Welcome.tsx still exports it, and only
  task28-units and PostOffer (its own copy) use it. Move the OD-7 pin to the one PostOffer uses, or leave a
  comment.
- **info C4: parity exceptions.** Five SetupWelcome texts were added to KNOWN_EXCEPTIONS, each with the owner
  note as the reason. Justified until the board is redrawn.

44 px and sideways scroll: owner-copy.spec checks scrollWidth at 443 px. The ticks are not controls. No XSS:
every string is a React text node.

## 3. wip/lead-owner-layout-1 (9cd77a12): ScreenHeader, type scale, help links, TradeHeader logo, fold test

- **BLOCKING L1: loginApproveV2.test.tsx fails on this branch.** The test pins `sheet-title` at 24/30 in
  design/design-system/tokens.json ("the v2 title styles"). The branch moved it to 26/32 (#43) and updated
  tokens.test.ts, but not this second pin. Moving the pin is the right fix (the owner asked for the bump),
  with a comment naming #43, as tokens.test.ts already has. It is red until then. Run the whole web project
  before READY: the branch's own run did not include this file.
- **info L2: the fold test change is justified, but the replacement is looser than it needs to be.**
  - Why it is justified: I re-ran the old assertion on this head (probe a). `scrollY` is 143 where 100 ±5
    was expected. The bigger type rewraps at 390 px, and the browser's scroll anchoring moves `scrollY` to
    keep the content in place. The pixel test is no longer the right measure. The new test still fails if
    the page jumps to the top (`scrollY > 0`), and it adds the TradeHeader name check.
  - Why it is looser: the anchor is the first line whose top is a quarter of the way down the view. The
    test then accepts it anywhere from one line above the top edge to one line below the bottom edge. A
    regression that moved the content by most of a screen (about 300 px at 500 px tall) would still pass.
  - Suggested tightening, a test change for the lead to accept: record the anchor's `top` before the fold
    and assert `|after.top - before.top| <= 2 * line` (or a quarter of the view). The 43 px drift seen
    here passes that comfortably.
- **minor L3: two help placeholders.** This branch adds `/help/:topic` (HelpTopic, on the front door) and
  links /login and /session-length to `/help/faq` and so on. wip/lead-landing-tour adds a different `/help`
  page behind the door, which /welcome links to as `/help#faq`. On the merge, both exist with different words.
  Also, DesktopShell's `PRE_LOGIN` regex now matches `/help`, so the tour branch's signed-in /help page gets
  the centred pre-login frame on wide screens, with no rail. Pick one help page before both land.
- **minor L4: help links seen while signed in.** On /session-length the person is signed in, but the
  placeholders say "once you are logged in" and end with "Back to log in". Copy, for the owner or design
  (COPY-UNSIGNED anyway).
- **minor L5: markup.** MethodList puts ScreenHeader's `<header>` inside a `<span>` (`.x2f-browse__logo`).
  That is flow content inside phrasing content, so the HTML is invalid, though browsers tolerate it. A phone
  trade room also gets a second `header` element. Use a `div` wrapper, or render ScreenHeaderView with
  `as="div"` inside bars.
- **info L6: a second logo on /welcome.** On the merge, the phone shell draws ScreenHeader on /welcome, which
  has its own large logo. The shell skips only `/`, browse and the trade room. Owner #37 says "every screen",
  but the welcome board is a hero screen, like the Landing board. Probably add `/welcome` to the skip list.
  It is also the cause of the Duo failure in 4-B5 (probe c).
- Checks that pass:
  - Front door: `/^\/help\/[a-z-]+$/` lets only the placeholders through, and frontDoor.test covers it.
  - HelpTopic looks topics up with `hasOwnProperty` (no prototype keys) and renders text only.
  - The trade code in the screen name comes from the person's own URL and is rendered as text.
  - 44 px help links are measured in shell.spec. Long names are cut with an ellipsis, and sideways scroll is
    checked at 360 px.
  - The token bump is applied in both tokens.css and tokens.json.

## 4. wip/lead-landing-tour (9456548f): /welcome, the tour engine, the playwright.config change

**Blocking findings (repo tripwires the branch breaks, none of which the branch's own run included):**

- **BLOCKING B1: the fixture name is in the production bundle.** The example stage
  (src/tour/FirstTradeStage.tsx) hard-codes `satoshi_ghost`, and bundle.test.ts forbids that string (2
  tests fail). Beyond the tripwire, the example shows a username that a real trader could register. The
  first-trade tour would then show a real account's name as the model counterparty, presented as a vendor.
  Use a name that cannot be registered (reserved or invalid by the username rules), or a neutral label such
  as "the buyer". Which name to use is an owner or design call.
- **BLOCKING B2: proof-render-tripwire fails** on `mask={\`url(#${maskId})\`}` in TourProvider.tsx. The
  `url()` is a same-document SVG mask, not a picture, so the code is safe. But the tripwire exists to
  stop images that bypass ProofThumb. Fix it by setting the mask from CSS (tour.css cannot reach a useId),
  or by adding a narrow, commented exemption for `url(#` in that test. The lead must accept the exemption,
  as a test change.
- **BLOCKING B3: kit-tokens and selection-ink fail.**
  - stage.css has `box-shadow: 0 0 8px var(--x2f-monero)`. The kit allows only the two nav-current inset
    lines.
  - Orange is used on `.x2f-mark__ring`, `.x2f-ex__button, .x2f-ex__hold` and `.x2f-ex__scan`, outside
    ORANGE_ALLOWED.
  - These are the kit's design rules. Either design accepts the example stage as an exception (then extend
    the lists with a reason, as a test change for the lead) or the stage follows the kit.
- **BLOCKING B4: the cantDoThat cap.** The branch adds two `not-a-refusal` pragmas (FirstTradeStage :332,
  :416), so the count goes from 66 to 68 and the test fails. Both are honest, since they are notes on an
  example screen. Raise the cap with a reason, as the other branches do. On the merge with copy-1 it must
  be 69.
- **BLOCKING B5: the playwright.config change hides the welcome gate only on 127.0.0.1, and team.spec
  breaks.** The `storageState` origin is `http://127.0.0.1:4317`. team.spec opens `http://localhost:4317`
  (its LOCAL), in its own `browser.newContext()`, which does not get the flag. After the join it lands on
  `/welcome` instead of `/sell`. On the tour head, team.spec has 2 failed and 24 passed; main has 28/28.
  - Fix the harness, not the assertion: seed the flag in team.spec's `freshPhone`, or list both origins in
    storageState.
  - Separately, the folded iPhone Duo test (tour.spec:230) passes on the tour head but fails on the merge
    with layout-1. The Skip button's bottom is at 657 against the tab bar at 617. Probe (c) confirms the cause is the
    52 px ScreenHeader plus the bigger type (see L6). Whichever branch lands second must fix it, probably by
    skipping the header on /welcome.

**Does the playwright.config change hide anything important?** It marks the welcome as seen for every spec,
so no other spec ever exercises the gate. What that means:

- The specs that log in and expect `/sell` no longer show what a new device really does: sign-up, then login,
  then /sell is gated to /welcome. Today only tour.spec and frontDoor.test cover the gate, and no e2e covers
  "setup, then first login, lands on /welcome".
- The rest is acceptable, because the gate is tested where it lives. Add one setup.spec journey that ends on
  /welcome on a fresh device (minor, recommended).
- The real gap is B5: the change silently does not apply to the other origin, or to contexts a spec makes
  itself.

Minor and info:

- **minor T1: the tour can cover the "Stay logged in?" prompt.** SessionPrompt and IdleReminder use Sheet,
  which portals to `document.body` (z-index 100), outside the inert `#root`. The tour layer is z-index 1000
  with a full-screen catch, and its Tab handler keeps focus in the card. If the session's end comes during a
  tour, the prompt is dimmed under the scrim and cannot be reached with the keyboard. The person is logged
  out at the end unless they press Skip tour first. Fix: end or pause the tour when a Sheet opens, or put
  Sheets above the tour.
- **minor T2: no test for inert or the focus trap.** The background inert (`#root[inert]`) and the Tab trap
  have no unit or e2e assertion. tour.spec checks keys and 44 px, but not that Tab never leaves the card or
  that `#root` is inert while the tour runs. Add both.
- **minor T3: the gate drops the query.** WelcomeGate redirects `/sell?…` to `/welcome` without keeping the
  query. Skip then goes to a bare `/sell`. No take flow uses `/sell?` (takes go to `/sell/:method?take=`,
  which is not gated), so this is cosmetic today. Keep the query, or document that it is dropped.
- **minor T4: team members and the welcome screen.** WelcomeGate gates members' `/sell` too. The welcome
  links "Settings" to `/settings/security`, which is owner-only for members, so a member taps into an
  owner-only refusal. The Help/replay card also lives on Security, so members cannot replay the tour, and
  they get the trader tour, which teaches "Press and hold to release" (trades-release is hard owner-only).
  This is not a leak: the stage is example data. But until branch 5's member tour is wired in, a member
  should probably see the member tour or none. This is an owner or design question.
- **info T5: once per device, not per account.** A second account on the same device never sees /welcome.
  This is the lead's reading of #47, documented in welcomeSeen.ts.
- Checks that pass:
  - **XSS**: card titles and bodies are React text nodes. There is no `dangerouslySetInnerHTML` or
    `innerHTML` in src/tour or src/screens/welcome. Selectors come only from the built-in tour data.
  - **Stage data**: the stage is static example data, with no fetch and no session read, so nothing of a
    real member or trader is shown.
  - **localStorage**: welcomeSeen and progress wrap every `getItem`, `setItem` and `removeItem` in
    try/catch, with an in-memory fallback. They store only `"1"` and a stop index, and only digits are
    accepted when read back. The keys hold no identity. Unit tests cover the throwing store.
  - **Reduced motion**: base.css forces animation and transition durations to 0.01 ms under `reduce`, which
    also covers the stage's un-guarded transitions (margin slide, hold fill). The WAAPI letter intro and
    tap dips check `matchMedia`. Smooth scroll becomes instant. tour.spec has a reduced-motion test.
  - **44 px and sideways scroll**: tour.spec measures every card button and every welcome control at 44 px
    or more, and checks scrollWidth at 443, 390, 466 and 890 wide.

## 5. wip/lead-tours-staff-team (e4b20baf): staff and team-member tour step data

- **merge M0, mechanical:** StaffShell.tsx conflicts with main's O-040 Notifications link and the D-045
  clock-out block. Keep main's block and put `data-part="logout"` on the Log out button. After that,
  staff-web is 74/74 on the merge.
- **minor S1: the logging-out stop contradicts the pay rule.** S5 says "Log out when you step away." Main
  now says "Clock out at the end of your shift to be paid. Logging out or closing the app does not pay." A
  helper or mod who follows S5 may not get paid. The shell also now has a Clock out button and (owner) a
  Notifications link, and neither has a stop. Design copy question for the owner. At least list both as
  PENDING_STAFF_STOPS.
- **minor S2: the data does not match the engine.** Both files declare their own `TourStep` type, with
  `route`, `explanation` and placements `top`, `bottom`, `left`, `right`. The engine (branch 4) takes `id`,
  `body`, `path` per page and placements `auto`, `above`, `below`, `center`. The data cannot be fed to
  the engine as it stands. An adapter is needed when it is wired in, and that adapter is where the role
  filtering must be kept.
- **minor S3: the staff tour should follow the server's menu.** `staffTour(role, grants)` recomputes the
  menu with `navFor`, although the shell already has the server's `me.nav`. Building from `me.nav` keeps the
  tour equal to the menu if the server ever narrows it (login hours, a revoked grant). The routes are
  server-guarded either way, so this is not a leak.
- **info S4: member stops depend on the server's set.** Member stops are gated by `me.member.abilities`, with
  the API's hold implication copied (end includes cancel, cancel includes see). The client does not add
  ALWAYS_ON or drop HARD_OWNER_ONLY. It needs neither: no stop uses an always-on or owner-only id. Only the
  three `always` stops show without a box. My probe (b) rendered every live target with one box at a time,
  10/10. That includes disputes-answer alone and offers-pause, offers-delete and offers-post alone, which the
  branch's own sets only cover together.
- **Roles and member data: no finding.**
  - Each staff role's live stops are only on that role's menu routes (asserted per role).
  - The owner-only stops (Staff grants, Overview news) are only in the owner's or senior's tours, according
    to `NAV`.
  - Every card is fixed text: no member or staff name, amount or grant is interpolated. The pending
    `PENDING_*` lists are data only, in no tour.

## Owner and lead questions

1. (4-B1) Which name should the example counterparty have, given that a real trader could register
   `satoshi_ghost`?
2. (4-T4) Should team members see /welcome and the trader tour before the member tour is wired in?
3. (5-S1) S5 "Log out when you step away" against "only a clock-out pays": what should the stop say, and
   should Clock out and Notifications get stops?
4. (3-L3) Which help page wins: the front-door `/help/:topic` placeholders or the signed-in `/help`?
5. (1) Deploy: set `X2F_TERMS_VERSION=2026-11-12` together with this web build.
