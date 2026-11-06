# Review: origin/wip/lead-design-results @8e29b9f (design review item 10, plus the 2 Nov session calls)

Reviewer: review agent, 2026-11-01/02. Worktree `~/x2f-worktrees/review-results-design` (detached, npm ci).
I reviewed `52b7a0e..661653a` (3 commits, 88 files, 50 of them PNG reshoots), then the newer pushed head
`661653a..8e29b9f` (1 commit, "design session calls of 2 Nov", 16 files). Line numbers below are @8e29b9f.
Main line is now `origin/claude/compassionate-johnson-k95ssr` @850052d, and **it already contains
`wip/second-design-devices`** (merge 850052d). Nothing committed or pushed.

## Verdict

**Not ready to land as is. Fix I1-I4, then land.**
- @661653a had no rule changes. The date formatter is correct and UTC-only. "Charged to you: Nothing"
  follows the stated rule. Feedback anonymity holds.
- @8e29b9f **changes three things that were owner-gated**:
  - It turns on News "Don't show me this again". The code said: "Turning it on is the owner's call, not a builder's."
  - It adds a buyer dispute rule of "30 min after paid" (client side only; it can't take effect before the server allows it).
  - It names the seller in Refunded copy where the owner had said "the seller".
  The commit cites "design session 2 Nov" / "owner 2 Nov". The lead must confirm these are real owner
  decisions (I4). The News one also breaks something (I3).
- Devices has landed, so the CSS class collisions are now live against main. The merge with main conflicts
  in ui.css, Button.tsx, cantDoThat-lint.test.ts and design-shots.spec.ts. When resolving it, the duplicated
  classes must be unified, not both kept (I2).

## Checks run

| Check | @661653a | @8e29b9f |
|---|---|---|
| `npm run typecheck` | clean | clean |
| `npx vitest run apps/web` (whole suite) | 1104/1110; the 6 failures are `myOffers.test.tsx` 5 s timeouts under load | 1104/1111; same 6 myOffers timeouts + 1 `attestation-flow.test.ts` (load-sensitive; main already has the fix ae3a877, this branch's base predates it). **Both files pass alone (109/109).** Neither is touched by the branch. |
| Playwright `--workers=1`, `X2F_CHROMIUM_PATH=/usr/bin/chromium`, under `flock ~/x2f-comms/check.lock`: pay refund dispute news feedback block wallets team security release fund login setup | **248 passed** (5.5 min) | 246 passed, 2 failed in the full run (14.3 min on a loaded machine: `refund.spec.ts:164` "Give 30 more min twice" and `release.spec.ts:500` "touch hold at 360x800", both timeouts; neither file nor its screen changed since 661653a). **Both pass on a rerun (5 passed incl. projects).** |
| `git merge --no-commit` of main line | @0c0f9ac: clean, typecheck clean (aborted) | @850052d (now includes devices): **CONFLICTS** in `apps/web/src/ui/ui.css` (4 hunks), `apps/web/src/ui/Button.tsx` (1: both add `danger-outline`), `apps/web/test/cantDoThat-lint.test.ts` (1: both bump the not-a-refusal ratchet; main 45->50, this branch 45->47, so the merged count needs a recount), `apps/web/e2e/design-shots.spec.ts` (add/add, 12 hunks). Aborted. |
| Other unlanded branches (`git merge-tree` vs @661653a) | myoffers: ui.css, design-shots.spec.ts. fold: ui.css, design-shots.spec.ts. |

## Rule checks

- **Refund dispute window: unchanged.** The card is still gated on `disputeEntry` (dispute/rules.ts,
  untouched): buyer only, `closedAt + TIMERS.disputeAfterRefundHours`, none after a cancel refund unless
  the buyer paid first, "opened" once a dispute exists. The "until" time is the same sum. Only the display
  changed: it is now UTC, and @8e29b9f shows it as a danger text link instead of an outlined button.
- **Buyer dispute in paid.** @661653a kept the server rule (opens at `confirmBy`). @8e29b9f adds
  `disputeOpensAt` = max(paidAt + 30 min, confirmBy) (`PaidWaiting.tsx:56-60`). With today's server
  (confirmBy is always set in paid and is later), behaviour is the same, so nothing is offered that the
  server refuses. Two edges: see M5.
- **Nudge: unchanged.** It uses the existing `sendNudge` (POST /v1/nudges), the same as SellerRefund.
  `too-soon` goes to CantDoThat ("once every 10 minutes"). There is no client-side limit.
- **Feedback anonymity: unchanged.** `sendFeedback` (`Feedback.tsx:60-63`) is untouched. The anonymous body
  is exactly `{kind, text, anonymous: true}`: no username, no `from`. Asserted by
  `CantDoThat.test.tsx` (exact body) and `feedback.spec.ts:71`. The "Sent anonymously." / "Sent as <name>."
  line is display only. @8e29b9f rewords the hints: anonymous "Your username isn't attached, so we can't
  follow up with you."; named "Your username is attached, so we can reply in the app." (`Feedback.tsx:36-38`).
  Both are true. Copy is COPY-UNSIGNED.
- **Refunded "Charged to you: Nothing": correct.** It shows only when `view.paidAt === null`
  (`Refunded.tsx:147`). It is absent after "I've paid", including the paid-then-cancel-refund case. Both
  cases are tested.
- **News after login: CHANGED** (I3, I4).

## Date formatter (`ui/dates.ts`, `ui/When.tsx`, `Duration`)

Correct. It uses only `getUTC*`. The year is always shown, the clock is 24-hour zero-padded, and the day has
no leading zero. Invalid input (`''`, `'soon'`, `NaN`, `Invalid Date`) gives `''`, and `When` renders nothing.
Offset ISO strings convert correctly (tested). Epoch 0 is accepted. `Duration` gives the same text as
`formatRemaining('minutes')` and rounds up. One edge, not a bug today: an ISO string with no zone
(`"2026-11-06T15:00"`) is parsed by JS as local time. The API always sends `Z`. Optional: note this in the
module doc.

## Findings

### Important

**I1. Block confirm sheet: Esc, the backdrop or the close button during "busy" closes the sheet, but the block still lands.**
`apps/web/src/screens/settings/BlockAction.tsx:86`. `onClose={() => go({ kind: 'idle' }, 'open')}` runs
while `state.kind === 'busy'`. Before, the inline confirm had only buttons, and they were disabled while busy.
Now the person "cancels", sees the idle "Block <name>" button, and then `blockTrader` resolves and the
screen flips to "Blocked". This is a silent action that affects another person.
Fix: `onClose={() => { if (state.kind !== 'busy') go({ kind: 'idle' }, 'open'); }}`, and add a unit test
that presses Esc while busy and checks the sheet stays open.

**I2. Duplicate kit classes, now live against main (devices landed in 850052d).** Main defines
`.x2f-choice`, `.x2f-choices`, `.x2f-choice__text`, `.x2f-facts`, `.x2f-disclosure`, `.x2f-panel`,
`.x2f-button--danger-outline` with different rules from this branch. For example, main's `.x2f-choice` has a
2px border, and its `.x2f-facts` stacks dt over dd on a raised fill. If the ui.css conflict is resolved by
keeping both sides, the later rules win on both sets of screens: Feedback's "Send anonymously" row, News'
"Don't show me this again" row, Refunded/PaidWaiting facts, devices' choice cards and LoginApprove facts.
Unit tests check class names, not layout, so nothing goes red.
Fix while rebasing onto main: reuse main's parts or rename this branch's (the table below gives which to
keep). Then reshoot Feedback, News, Refunded, PaidWaiting **and** devices' 01-03/06-08/10/11/30 to confirm
nothing moved.

**I3. "Don't show me this again" leaves no way back to News, and its hint points to a control that does not exist.**
`apps/web/src/screens/News.tsx:190-205`, `news-model.ts:31,165`. The hint says "You can still read it any
time under Site news, the bell at the top of the screen." There is no such bell: `useNewsUnseen` has no
caller, and the only link into `/news` in the whole app is the after-login redirect (`authApi.ts:74`). Once
ticked, `hasUnseenNews()` returns false forever on that device. The user never sees News again, including
the emergency-stop message that the API and News doc say "sends everyone here" (spec 6.6: News may be the
only channel to users). The flag can only be cleared from the after-login page, which no longer opens.
Fix: either keep `NEWS_DISMISS_ENABLED = false` until a News entry point (the bell) ships, or ship the bell
in the same change. Also consider still opening News after login for posts flagged urgent/emergency even
when hidden. Owner decision, see I4.

**I4. Owner-gated changes in @8e29b9f need owner confirmation before landing.** The brief for this
branch was "no rule changes". The commit flips three earlier owner-held calls, each cited as "design
session 2 Nov":
- News "Don't show me this again" on (`news-model.ts:26-31`; it replaced the comment "Turning it on is the
  owner's call, not a builder's").
- Buyer dispute "30 min after paid" (`PaidWaiting.tsx:46-61`; client only, so today the server's `confirmBy`
  still decides. The comment asks the API for a follow-up).
- The seller named in Refunded copy instead of "the seller" (`Refunded.tsx:45-53`, `withName`; owner
  2026-10-29 had said "the seller").
If the owner made these calls in the 2 Nov session, record them in decisions/coordination and this is
fine (apart from I3). If not, revert them.

### Minor

**M1. "One date format" is not applied everywhere yet; four screens still use local-zone or other formats.**
- `apps/web/src/screens/auth/LoginApprove.tsx` `when()`: `toLocaleString('en-GB', …)` with no `timeZone`
  gives local time and no "UTC". Use `formatDateTime`. (This file was reworked on main by devices; recheck
  after the rebase.)
- `apps/web/src/screens/trade/SellerCancelConfirm.tsx:110`: `Intl.DateTimeFormat(undefined, {dateStyle, timeStyle})`.
  Use `<When>`.
- `apps/web/src/screens/dispute/rules.ts:150-161` `clockTime`/`dayTime` (DisputeRoom, DisputeRuling,
  dispute seams): viewer's zone.
- `apps/web/src/screens/setup/PgpKey.tsx:30`: `toISOString().slice(0,10)` gives "2026-11-06". Use `formatDate`.
If these are left on purpose, list them in WHAT-CHANGED.md or add a NEEDS tripwire.

**M2. The auto-refund lead replaces the owner's own wording.** `Refunded.tsx:92` uses the board's
"You didn't tap I've paid in time, so the seller cancelled. …" (now with the seller's name). The old text in
`refundReason` (`dispute/rules.ts:110-115`) is marked "The owner's wording (Plan 3 Revision 2026-10-29,
Decision 7)". Owner's call (Questions).

**M3. Stale doc comments after the format change.** `refusals.ts:43` and `cantDoCodes.ts:334,342` still
show `"until Tue 3:05 PM"`. It now reads "until 6 Nov 2026, 15:00 UTC". `localTime` (`refusals.ts:39`) is no
longer local; rename it.

**M4. "Charged to you: Nothing" sits next to "Did you send the money anyway?"** (`Refunded.tsx:147`, `:93`).
In the time-ran-out variant the same screen says nothing was charged and asks whether money was sent. The
logic is as specified. This is a wording question for the owner.

**M5. `disputeOpensAt` edges offer a link the server refuses** (`PaidWaiting.tsx:56-60`, `:269`).
- With `confirmBy === null` and `paidAt` set, it returns paidAt + 30 min. The server
  (`machine.ts:416`) refuses a buyer dispute while `confirmBy` is null (too-early).
- With both null, it returns `null`, and the link is offered at once.
@661653a kept the button disabled in both cases. Neither should happen in `paid` today, but the comment
promises "never before the server allows it". Fix: return `null` → disabled (not offered) when `confirmBy`
is null, until the API change lands.

**M6. `withName` rewrites by regex** (`Refunded.tsx:45-53`): `/\b[Tt]he seller\b/` over every story,
title, lead and timeline key, including `refundReason`'s texts. A future sentence like "the seller's
wallet" becomes "<name>'s wallet", which is fine, but any copy that should keep "the seller" (for example a
rule explanation) is silently changed too. A capitalised "The seller" at the start of a sentence becomes a
lower-case username, which is fine for usernames. Prefer passing the name into the story builders
explicitly. Low risk today; tests cover the current strings.

### Nits

- **N1.** `PaidWaiting.tsx:254`: after a successful nudge the button is replaced by "Nudge sent. You can send
  another in 10 min." and does not come back during the visit. SellerRefund keeps its button.
- **N2.** `PaidWaiting.tsx` `onNudge`: `no-shared-context` shows "That did not work. Try again.", but trying
  again can't help. Rare in paid.
- **N3.** Focus is lost when the focused control unmounts: News "Mark all as read" (`News.tsx:127` and its
  button) and Feedback "Write another" (`Feedback.tsx:172`). Move focus to the h1 / the textarea.
- **N4.** `PaidWaiting.tsx:275`: the disabled "Open a dispute" can't take focus, so its `aria-describedby`
  is unreachable by keyboard. The footnote is visible, so this is acceptable. `aria-disabled` would be better.
- **N5.** `PaidWaiting.tsx` ring label: with `paidAt` missing, `lengthMs` is 0, giving "N of 0 minutes left".
- **N6.** `theme/base.css:28-33`: the ink focus-ring list lacks `summary`, so "Your payment" `<details>`
  gets the browser ring.
- **N7.** In paid, BuyerPay drops the escrow chip, the TradeTimeline (wide) and the disabled ProofSlot, as the
  board shows. See Questions on proof.
- **N8.** `Feedback.tsx:224`: the count is `[...text].length` (code points, untrimmed), while `maxLength` counts
  UTF-16 units. Cosmetic.
- **N9.** News post toggles have long accessible names (status + dates + title). Use `aria-labelledby={titleId}`.
- **N10.** News stepper (`News.tsx` `goTo`): `requestAnimationFrame(... scrollIntoView)` is fine. Focus stays
  on the arrow button, which is fine. The `role="status"` "2 of 3 new" announces. OK.
- **N11.** `Wallets.tsx:1`: import order.

## Kit overlap

Devices = `wip/second-design-devices` (**landed on main @850052d**); myoffers = `wip/lead-design-myoffers`
@54ab006; fold = `wip/lead-design-fold` @a0552ee.

| Part | this branch | other | Same? | Keep |
|---|---|---|---|---|
| `Button` `danger-outline` | 48px/16px default + `data-size="large"` 56px/18px | devices (main): always 56px/18px | same name and look, **different default height** | One variant. Since main has 56 as the default: keep main's, and make this branch's 48px use a `data-size="medium"` (or adopt 56 if the boards allow). Resolve Button.tsx by taking either side, since the line is identical. |
| Checkbox | inline `label.x2f-choice > input[type=checkbox]` + title/hint (Feedback "Send anonymously", News "Don't show me this again") | myoffers `Checkbox` (`.x2f-tickbox`, 24px in a 44×44 label, ink, `mixed`) | same box spec; this branch has no component | **myoffers' `Checkbox`**, plus a labelled-row wrapper (title + hint) used by Feedback and News. This branch's `.x2f-choice` checkbox row must be renamed anyway (clash with main). |
| Radio choices | @8e29b9f moved Feedback's kind to `.x2f-cards` / `.x2f-card-choice` (new names, no clash) | devices `ChoiceGroup` (`radiogroup`, looks `tile`/`card`, on main) | same pattern ("selectable cards", ink selection), two implementations | **main's `ChoiceGroup look="card"`** for Feedback's kind. Drop `.x2f-card-choice` and `.x2f-cards`. |
| Disclosure / fold-away | native `<details class="x2f-disclosure">` (PaidWaiting "Your payment"); News' own `.x2f-post__toggle` | devices `Disclosure` (button + aria-expanded/controls, on main) | **same class, conflicting rules** | **main's `Disclosure`** with a `note` slot for "total · method". Move PaidWaiting to it, and consider it for News posts. Drop this branch's `.x2f-disclosure` CSS. |
| Facts | `Facts` component (key left, mono value right, `rule`, `label`) | devices: CSS-only `.x2f-facts` (dt over dd, raised fill) | **same class, different layout** | **this branch's `Facts` component**, with a `layout="stacked"` mode for devices' screens. Until then, rename one class. |
| Panel | `.x2f-panel` gap 8 / pad 16, `data-outline` | main `.x2f-panel` gap 10 / pad 14×16, `data-tone` | near-identical, conflicting | One rule: main's tones + this branch's `data-outline`. Pick gap/padding from the boards. |
| Page frame | `.x2f-page*` (hand-built headers in Feedback, News, Refunded) | main `FlowScreen` (`.x2f-flow*`) | same concept | **main's `FlowScreen`**, with `sub` and `action` header slots and an optional non-h1 header title. Retire `.x2f-page`. |
| Type roles | `.x2f-title`, `.x2f-heading`, `.x2f-overline`, `.x2f-small`, `.x2f-lead` | main `.x2f-h2`, `.x2f-section-title`, `.x2f-kicker`, `.x2f-fine`, `.x2f-body` | **byte-identical declarations**: title=h2, heading=section-title, overline=kicker, small=fine | One set. Since main has devices' names, either rename main's to role names in one sweep or use main's names here. Don't ship both. |
| Notice | `.x2f-callout` (Block sheet, neutral) | main `Notice` (caution + icon); myoffers `Notice` (plain/caution/danger, auto role) | two `Notice`s with the same name (main vs myoffers) | **myoffers' tone API** merged into main's `Notice` (keep its icon), and add a neutral tone for the Block callout. |
| Switch | none | main `Switch`, myoffers `Switch` | duplicate between those two | myoffers must reuse main's when it rebases. |
| `chevron-down` icon | added | main has the identical line | identical | either; git dedups it |
| PickButton | none | fold | no overlap | keep fold's |
| StatusChip `muted`, TimerCard, When/Duration, `.x2f-steps`, `.x2f-footnote`, `.x2f-inline-action`, `.x2f-done`, stepper | this branch only | none | none | keep |

`design-shots.spec.ts` is add/add with main, myoffers and fold. It needs one owner, or per-area files.

## Questions for the owner (via lead)

1. **"Don't show me this again" for News (I3, I4).** Did you decide to turn it on? If yes: should an
   emergency/urgent post still open after login for people who ticked it, and should the News bell ship
   first (today there is no other way into News)?
2. **Buyer dispute 30 min after "I've paid".** Did you decide this? It needs an API/state-machine change
   (today the buyer waits for the seller's confirm window). The client is ready for it.
3. **Name the seller in the Refunded copy** ("satoshi_ghost cancelled") instead of "the seller"
   (your 2026-10-29 call)?
4. **Auto-refund wording (M2):** the board's "You didn't tap I've paid in time, so <seller> cancelled.
   Everything in escrow, X XMR (about $Y), went back to <seller>." or your Decision 7 "Payment time ran out,
   the seller cancelled; everything in escrow went back to the original owner."?
5. **"Charged to you: Nothing" (M4)** next to "Did you send the money anyway?": keep, reword, or cancel
   refunds only?
6. **Payment proof after "I've paid" (N7):** should the proof slot come back on this screen once upload ships?
