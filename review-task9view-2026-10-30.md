# Review: Plan 3 Task 9 release-claim VIEW field (claude2's item W), wip/second-p3-task9-view @fe96aab, 2026-10-30

Reviewer: helper, read only. Scope: the view work only, which is 5bb387c plus the merge commit's own lines (`git diff 3dc2a58 origin/wip/second-p3-task9-view`, 12 files, +186/-6). Task 9 I/O itself (3dc2a58, and now 8cfdbe6..f60c449) is out of scope. I also trial-merged the branch onto the current Task 9 I/O head `origin/wip/second-p3-task9-io` @f60c449, which already contains the main line f13f574, and resolved it by hand in my own worktree.

## Verdict: APPROVED WITH MINOR

There are no Important findings. There are 5 Minor ones. The re-merge will need 3 hand edits: one textual conflict and two compile-time fixture fixes (see the re-merge notes).

The field is correct and does not leak:
- **API (`apps/api/src/trades/view.ts:111`, `:180`).** `releaseClaimedAt` is the claim time only, as ISO or null. It is the same for buyer and seller and names neither the claiming party nor anything about the moderator.
  - Third traders still get 404 and staff still get 403, because the existing guard on `GET /v1/trades/:code` is unchanged.
  - No amount, address, tx hash or fee is added. The poster-only fee rule is untouched (`fee` is not touched by this diff).
  - The new test checks that both roles see the same value and that `releaseClaimedAt` is the only key matching `/claim|mod/` (`apps/api/test/view.test.ts:103`).
  - What a counterparty learns is the time at which one side's device reported its part as done. Decision b says both traders see the claim, so this is acceptable.
- **Time maths.**
  - `settleBy` is passed through unchanged.
  - `nextDeadline` comes from the machine (`machine.ts:522`: null once claimed), so it is never computed in the view.
  - The web countdown reads the server clock (`Countdown` via `serverClock`), never the device clock.
  - Once a trade is claimed, nothing on the web counts down, either in `SettleWait` or on the main line's `TradeGlance`. The glance's "Time left" uses `nextDeadline`, which is null once claimed. That matches the machine: `tick` no longer reverts a claimed trade (`machine.ts:327`).
  - Dispute access is unchanged. On the main line, `screens/dispute/rules.ts:70` still opens a dispute from `settling` after `settleBy`, claimed or not, as Revision 2026-10-29 says.
- **Types.**
  - The web `TradeView` (`apps/web/src/api/trade.ts`) mirrors the API type.
  - auth-client has no `TradeView` and no new route, so `flows.test.ts` needs nothing.
  - The escrow runtime's own `parseTradeView` (escrow/adapters.ts) does not read the field, so nothing there is needed.
  - The main line's amount-checking `parseTradeView` does not need it either, because it is not an amount.
- **Tests.**
  - API: both roles, before and after the claim, and the key filter.
  - Web unit tests: every settle kind, past `settleBy`, outside `settling`, and the StatusCard.
  - Playwright: phone viewports for both claimed and unclaimed.
  - The red-first claim is plausible from the to-lead log. I did not re-run the API test because it needs Postgres. See the Tests section.

## The 'settling' screen gap: is it real on the main line? Mostly no; no tripwire needed

claude2 wrote that no web screen shows `settleBy` during `settling` and that the status card is the only place for the claim. That is true on this branch's base (the Task 8 merge 5dd43e2), but **not on the main line**, where Tasks 23 and 24 are merged. After the merge, the room routes `settling` like this:

| settling kind | buyer | seller |
|---|---|---|
| `release` | Task 24 `Released` (release/slots.tsx:75-79) | Task 24 `SellerConfirm` in its releasing look |
| `buyer-cancel`, `mutual-cancel` | Task 23 `BuyerCancelling` (BuyerPay.tsx:51) | **StatusCard + SettleWait** |
| `auto-refund`, `lapse-refund` | **StatusCard + SettleWait** | **StatusCard + SettleWait** |

The owned screens never show `settleBy` either:
- `SellerConfirm` hides `ConfirmWindow` while releasing (SellerConfirm.tsx:219).
- `Released` and `BuyerCancelling` have no timer.
- The only `settling` deadline on the main line is `TradeGlance`'s "Time left" (fold layouts), which reads `nextDeadline`. That is already right for a claim.

So no screen shows a stale deadline after the merge. Nothing needs to be built, and a NEEDS_* tripwire is not justified. The cost is that the `'Release sent, waiting for the network'` branch can no longer be reached in the room on the main line, because Task 24 owns every release settling. That is fine. See M4 for the stale wording that results.

## Important

None.

## Minor

**M1. A view without the field breaks the refund screens' dry runs (fail-closed, but on a field that does not matter to them).**
- Where: `apps/web/src/screens/trade/refundRules.ts:74` (`date(v.releaseClaimedAt, 'releaseClaimedAt')`) and `:18` (`date` only handles `null`).
- Failure: `new Date(undefined)` is NaN, so `tradeFromView` throws RangeError. `allowed()` then returns false for `extend`, `request-refund` and `mark-paid`, and `finalAlertEnds` (main line `refundRules.ts:129`) returns null. The view can lack the key in these cases:
  - during a deploy where an older API serves the trade to a newer web bundle;
  - with any fixture built with a cast rather than the `TradeView` type.
  In those cases the seller's Request refund / Extend buttons and the buyer's final-alert countdown go dead in `secured` and `refund_requested`. Those states never read the claim, which matters only in `settling`.
- `settleWaitOf` already tolerates `undefined` (`settleWait.tsx:20`), so the two readers of the same field disagree.
- Fix: `releaseClaimedAt: date(v.releaseClaimedAt ?? null, 'releaseClaimedAt')`, plus a `refundRules.test.ts` case where the key is deleted from the view.

**M2. "N min left to sign" is shown to a party who has nothing to sign.**
- Where: `apps/web/src/screens/trade/settleWait.tsx:42`.
- On the main line the status card is reached only by these (table above):
  - the seller in `buyer-cancel`, which the buyer builds and the mod co-signs (`escrow/policy.ts:91`);
  - the buyer in `auto-refund`, which the seller builds and the mod co-signs (`policy.ts:90`).
- Neither viewer signs, yet each is told there is time "left to sign". A buyer may take this as a call to act.
- Fix: make it role-aware using `ROUTE[kind]` in `escrow/policy.ts` (export it or a `signsIn(kind, role)` helper). The builder or co-signer gets "N min left to sign". Everyone else gets neutral wording such as "Being signed, N min left" or "Refund in progress, N min left", or no timer at all.
- Also open: claude2's decision (1), whether refund kinds should keep "Refund sent" or use one wording everywhere. I recommend keeping "Refund sent": it is accurate for every refund kind and is the only branch left in the room on the main line.

**M3. Past `settleBy` but before the server's tick reverts an unclaimed trade, the card reads "0 min left to sign". An unreadable `settleBy` leaves a bare " left to sign".**
- Where: `settleWait.tsx:21`, `:40-44`, and `ui/Countdown.tsx` (`Math.max(0, ms)`, and it returns null for a non-finite deadline).
- The window is short (the timer loop runs about every minute, and the room re-reads at `nextDeadline` plus slack), so this is cosmetic.
- Fix: in `SettleWait`, compute `Date.parse(view.settleBy)`. Render nothing (or a "Checking…" line) when it is NaN or `<= serverClock()`. Add a test at `settleBy = at(-1)`, unclaimed.

**M4. Copy and comments go stale at the merge.**
- (a) `settleWait.tsx:35-43` is new user-facing copy with no board, but it carries no `// COPY-UNSIGNED` marker. Every other unboarded string on the main line has one (TradeGlance.tsx, dispute/rules.ts, blockCopy.ts). Fix: add the marker.
- (b) Some text assumes Task 24 never lands on this line and is wrong once it does:
  - `settleWait.tsx:9-10` ("Screens that own `settling` (Task 24's release screens) can embed `SettleWait`; the room's plain status card shows it for every settling kind no screen owns yet");
  - the `describe('StatusCard while settling (no Task 24 screen on this line)')` at `apps/web/test/settleWait.test.tsx:61`;
  - the coordination.md note "Shown in the room's plain status card (no settling screen on this line); Task 24's release screens … can embed".

  Fix at the re-merge:
  - rewrite them to the routing table above;
  - say that release settling is Task 24's;
  - say that `SettleWait`'s release branch is kept for a future embed but is not reachable in the room;
  - close claude2's decision (2) as "not needed" because Task 24's settling screens show no deadline.

**M5. The view keeps sending a claim that is no longer live.**
- Where: `apps/api/src/trades/view.ts:180`.
- The fix-round Revision (plan line 9) says an escalation from `settling` leaves `releaseClaimedAt` set on the `disputed` trade, and that Task 27 and Plan 4 "must not take them as live". The view still sends that stale value to both clients in every state. The current web code gates on `state === 'settling'` (`settleWait.tsx:19`), so nothing misreads it today. But the API now publishes exactly the value the plan warns about, to every future reader.
- Fix: `releaseClaimedAt: t.state === 'settling' ? iso(t.releaseClaimedAt) : null`, with an API test that escalates a claimed trade and expects null. Alternatively, document on the field that it is meaningful only while `state === 'settling'`.

## Re-merge notes (for when Task 9 I/O's round-3 head lands, 8cfdbe6+ / now f60c449)

`origin/wip/second-p3-task9-io` @f60c449 already merges the main line f13f574 (Tasks 23, 24, 27 and 40), so a merge of the view branch onto it is effectively a main-line merge.

- **Against `origin/wip/second-p3-task9-io` @f60c449.** `git merge-tree` gives **1 textual conflict, `apps/web/src/screens/trade/TradeRoom.tsx`**, in two hunks:
  - the imports: keep Task 40's `fold`/`Panes`/`Sheet`/`useTradeChat` imports AND `SettleWait`;
  - the room body: keep Task 40's `<Panes …>` layout and change its `main=` fallback to `<StatusCard view={view} serverClock={clock} />`. Do not take the branch's flat `{Screen ? … : <StatusCard/>}` block, which would drop the fold layout and the chat pane.

  Everything else auto-merges: view.ts, view.test.ts, refund.spec.ts, refundViews.ts, api/trade.ts, refundRules.ts, tradeFund.test.tsx, coordination.md.
- **Semantic conflicts that tsc catches and git does not.** These are main-line `TradeView` literals that lack the new required field:
  - `apps/web/src/fixtures/payBoard.ts:31` (`PAY_SECURING`) and the `PAY_SECURED` that follows it: add `releaseClaimedAt: null` after `settleBy: null`. `pay.spec`, `fold.spec` and `refund.spec` import these fixtures, so this one fix covers them.
  - `apps/web/test/buyerPay.test.tsx:57`, in the `tradeView()` literal: add `releaseClaimedAt: null`.

  With these three edits the merged tree typechecks clean for both web and api (see Tests).
- **Against the main line `origin/claude/compassionate-johnson-k95ssr` @f13f574 directly.** There are 3 conflicts:
  - `TradeRoom.tsx`, as above;
  - `apps/api/test/schema.test.ts`, which is Task 9 I/O's migration `113_release_claim.sql`, not the view's;
  - `docs/coordination.md`.

  The last two are already resolved by Task 9 I/O's own merge f60c449. So merge the view branch **after** Task 9 I/O, onto its head, not straight onto the main line.
- At that merge, also apply M4(b): fix the coordination.md text, the `settleWait.tsx` header comment and the test's `describe` name.

## Tests

My own detached worktree `~/x2f-worktrees/rv-t9view` was f60c449 with `origin/wip/second-p3-task9-view` merged by hand (TradeRoom resolved as above, plus the two fixture lines). Nothing was committed or pushed, and the worktree was removed afterwards. I ran `npm ci` (pinned npm) and every run was under `flock ~/x2f-comms/check.lock`, one at a time:
- `tsc -p apps/web --noEmit`, before the fixture fixes: 2 errors (payBoard.ts:31, buyerPay.test.tsx:24). After them: clean.
- `tsc -p apps/api --noEmit`: clean.
- vitest (apps/web), 10 files: settleWait, tradeRoom, tradeRoom-tripwires, tradeRoomEscrow, refundRules, buyerPay, release, fold, tradeFund, copy-lint. Result: **240/240 passed**.
- Not re-run:
  - the API `view.test.ts` (needs Postgres). claude2 reports 35/35 for api view/watchReports/timers/tradePublish.
  - Playwright. claude2 reports refund+fund 48 passed and 1 skipped.

  The new refund.spec test uses seller × `auto-refund`, which still reaches the StatusCard on the main line, so it should keep passing after the merge. It should be re-run after the merge, inside the Task 40 `Panes` layout.
