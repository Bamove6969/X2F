# Handoff: design results branch (2 Nov 2026)

- Branch `wip/lead-design-results`, worktree `~/x2f-worktrees/lead-design-results`.
- Head **15126db** (a wip commit), pushed. Main line merged up to **b6835ee**: devices 850052d, then
  My offers 5bfb450, then C11 b6835ee.
- Review: `~/x2f-comms/review-lead-design-results-2026-11-01.md` (reviewed @8e29b9f).
- Commits: identity `-c user.name=flem -c user.email=bamove@gmail.com`; messages end with
  Co-Authored-By plus the Claude-Session line.

## Review items

| Item | State | Where / what's left |
|---|---|---|
| I1 Block sheet closes while busy | **done** (dcb4777; red test first) | `BlockAction.tsx` ignores onClose while busy; test in `blocked.test.tsx` "review I1" |
| I2 kit duplicates | **done in code**; reshoot still to do | One `.x2f-panel` (main's base plus `data-outline`). Type roles = main's names (`x2f-h2`, `x2f-section-title`, `x2f-kicker`, `x2f-fine`, `x2f-body`; branch duplicates deleted; `.x2f-lead` kept, it is the muted body). `danger-outline` = main's 56 px plus `data-size="medium"` 48 px. `ChoiceGroup look="card"` for the Feedback kind. `Disclosure` has `note` and `outline` props (PaidWaiting "Your payment"). `Facts` (`ui/Facts.tsx`) has `layout="rows"\|"stacked"` on one `.x2f-facts` class; LoginApprove now uses `<Facts layout="stacked">`. `CheckRow` (`ui/CheckRow.tsx`) wraps myoffers' `Checkbox` (Feedback anonymous, News hide). `Notice tone="neutral"` replaces `.x2f-callout` (Block). `FlowScreen` gained `sub`, `action`, `titleAs="label"`, `back.icon="close"`, `busy`; Feedback and News use it; `.x2f-page*` retired. Refunded uses the trade room's `.x2f-pay` frame (it renders inside the room's `<main>`). cantDoThat-lint ratchet recounted to 53 (main 51 + 2). **Next:** look at Devices, LoginApprove and My offers screens for silent restyles. LoginApprove's facts now come from `Facts`; the DOM is the same apart from a span inside the Time value. |
| I3 Don't show me this again | **done**: bell built | `ui/NewsBell.tsx` ("Site news" link to /news, teal dot from `useNewsUnseen`). It is beside the logo in `DesktopShell` and in the phone Buy/Sell header (`MethodList`). `NEWS_DISMISS_ENABLED = true`; the checkbox only shows on `/news?after=login` (`authApi.afterLogin`). **Check:** on the Desktop layout, the Buy/Sell page may now show two bells (shell header plus MethodList header). Hide MethodList's when `data-shell=desktop` if so. |
| I4 owner calls | confirmed by the lead | 30-min dispute: `disputeOpensAt` = max(paidAt + 30 min, confirmBy), null without confirmBy. The client follows the server; claude2 is changing the API. The seller is named in Refunded. |
| M1 one date format | **done** | `dispute/rules.ts` `dayTime`/`clockTime` now use `ui/dates.ts` (signature lost the `timeZone` arg). Also `SellerCancelConfirm` (`<When>`), `PgpKey` (`formatDate`) and `lastActive.utcWhen` (delegates). Tests and the e2e dispute text are updated. |
| M2 Decision 7 wording | **done** | Auto-refund lead: "Payment time ran out, <seller> cancelled; everything in escrow went back to the original owner. X2F took nothing from you. If you already sent the payment, open a dispute below." The last sentence shows only while the dispute card shows. The design session's "X2F fee: None" row replaces "Charged to you", on every refund. |
| M3 doc comments | **done** | `refusals.ts` `localTime` renamed `momentText`; `cantDoCodes.ts` examples updated. |
| M4 Charged/anyway wording | open, for the design session | The row is now "X2F fee: None" per the session. |
| M5 disputeOpensAt edges | **done** | |
| M6 regex rewrite | **done** | `refundStory(view, seller, disputeOpen)` and `refundTimeline(view, seller)` take the name explicitly; `withName` is gone. |
| Nits | N1, N2, N3, N4, N5, N8, N9, N11 **done** | N6 is moot: no `<details>` any more. N7 (proof slot) is a question for the owner. |

## Test status at 15126db

- `tsc --noEmit -p apps/web`: clean. `npm run copy-lint`: clean.
- Web unit suite: a targeted run of the 16 touched test files passed **269/269** on 15126db
  (buyerPay, disputeSlot, CantDoThat, cantDoThat-lint, news, news-tripwire, blocked, chatPanel,
  dates, dispute, hold, task30-refusals, loginApprove, css-collisions, browse, ui). The full suite
  has not been rerun since the merges; the last full green run was 1111/1111 at 8e29b9f.
- Playwright: last green at 8e29b9f (59 passed: pay, news, feedback, dispute-room, block, login).
  Not rerun since the merges.

## Exact next steps

1. `cd ~/x2f-worktrees/lead-design-results && flock ~/x2f-comms/check.lock npx vitest run --project @x2f/web`.
   Fix anything red. Likely areas: browse tests that count fetch calls (NewsBell fetches `/v1/news`),
   `loginApprove.test.tsx` (Facts markup), `news.test.tsx`, `CantDoThat.test.tsx` (CheckRow,
   ChoiceGroup), `myOffers`.
2. Playwright under flock with `X2F_CHROMIUM_PATH=/usr/bin/chromium`: pay, refund, dispute,
   dispute-room, news, feedback, block, security, login, myOffers, browse-buy, browse-sell, wallets, team.
   `news.spec` expects no checkbox on plain /news (still true), and `/news?after=login&returnTo=…` after login.
3. Reshoot both sets with `X2F_DESIGN_SHOTS=1 X2F_DESIGN_SHOTS_DATE=2026-11-02` into
   `docs/design-screens/2026-11-02/` (the spec is main's version merged with this branch's edits):
   this branch's 39, 48, 60, 62-64 and the date shots, plus devices' 01-03/06-08/10/11/30 and My
   offers' 31-35. Look for silent restyles: panel padding is now main's 14/16, the danger-outline
   is 56 by default, and Facts went through the component.
4. Commit, push, report the head to the coordinator.
