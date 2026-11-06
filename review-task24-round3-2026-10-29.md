# Re-review (round 3): wip/lead-p3-task24 @6b60297 (Task 24 fix round 2, claude2) — CHANGES REQUIRED (1 Important)

Reviewer: helper subagent for the lead, 2026-10-29. Read only. Scratch worktree ~/x2f-worktrees/rv-t24 has been removed.

**Scope:**
- `git diff 0e92cb6...6b60297` (25 files), concentrating on:
  - SellerConfirm.tsx, release/marker.ts, Released.tsx
  - release/slots.tsx, releaseScreens.ts, screens.ts
  - fixtures/index.ts, ui.css, e2e/phone.ts, refund.spec.ts, release.spec.ts
  - release.test.tsx, release-tripwires.test.ts
- Read against:
  - Task 12's runtime (apps/web/src/escrow/runtime.ts on 0e92cb6: `act`, `tickOnce`, `viewSupports`, `autoKind`, `settle`)
  - Task 22's room (TradeRoom.tsx, api/trade.ts on 0e92cb6)
- Answers: ~/x2f-comms/review-task24-round2-2026-10-28.md
- Trial merge of 6b60297 onto the main line 0e92cb6: clean, no conflicts.

## Checks run (merged tree, under flock)

- `npm ci` (pinned npm 11.21.0): OK.
- `tsc --noEmit` on apps/api, apps/web and packages/auth-client: all clean.
- vitest `--project @x2f/web`: 53 files, 780 of 780 passed.
- Playwright (Chromium /usr/bin/chromium):
  - release.spec 34 passed;
  - refund.spec 18 passed, plus 1 self-skip;
  - fund.spec (Task 22's room) 28 passed.
  - Total 80 passed, 1 skipped, 0 failed.
- None of the tests covers Important 1, a view whose `code` differs from the route.

## The round-2 Important (API's word alone triggers release()): mostly fixed

What now holds:

- **No marker, no automatic signature.**
  - The automatic `sign()` (SellerConfirm.tsx:135-139) runs only when `releaseAsked(trade.code)` is true.
  - The marker is written only in two places:
    - `release()` (:107), just before the POST, after a full hold;
    - `finish()` (:128), after a full hold in the `foreign` branch.
  - A plain API move `paid → settling/release` with no marker gives `foreign` (:84). That means the box (unticked, enabled), the warning copy, the dispute links, and a HoldButton disabled until the box is ticked and the device is `ready` (:235). No new POST is sent.
  - Task 12 adds no path of its own:
    - `autoKind` gives the seller no `release`.
    - A tapped `release` intent exists only after `act({type:'release'})`, which only `sign()` calls.
- **A second device, or cleared storage.**
  - localStorage belongs to the device and the origin, so there is no marker. The screen falls to `foreign` and needs the hold. This is the safe direction.
  - If the store is blocked, `markReleaseAsked` fails quietly. A lost answer then needs a hold, which is also safe.
- **Another tab on the same device.**
  - The tabs share the marker. That is acceptable: the seller held on this device.
  - Only the tab whose runtime holds `x2f-escrow:<code>` reaches `ready`. The effect needs `ready`, so the other tab cannot sign.
  - Two tabs cannot double-sign, because the runtime's `inflight` and the Web Lock prevent it.
- **Reload, and a lost POST answer.**
  - Both are covered: the marker is written before the POST and survives the reload.
  - A refused POST (`ApiCallError`) clears the marker (:114).
  - A second hold after a lost answer gets a 409 from the API. That clears the marker, and the next read falls back to the explicit hold. This costs an extra tap, which is safe.
- **A stale marker from an earlier episode of the same trade.**
  - The marker is bounded by the device clock: 15 min, `TIMERS.settleMin`. A future timestamp is dropped (`age < 0`).
  - Once `release()` has run, Task 12's tapped intent carries the seller's consent anyway. It holds only while `viewSupports('release', v)` is true, and is dropped (`r.intent = null`) once the view leaves paid/secured/settling-release (runtime.ts:926-939). So after the first `release()` the marker adds no reach.
  - The gap that remains is in Minor 1.

What does not hold is in Important 1: the per-trade key is taken from the API's view, not from the route.

## Important

1. **SellerConfirm.tsx:78, :107, :136 (marker read and written with `trade.code`), slots.tsx:52 (`trade={view}`), TradeRoom.tsx:145/212/231: the marker is looked up under the code the API's view says, but the escrow that signs is the route's.**
   - **What the code does.**
     - The room fetches `GET /v1/trades/<route code>` and starts `useTradeEscrow(<route code>)`.
     - It hands the screen `view` unchanged. `parseTradeView` (api/trade.ts:124) checks only the amounts and never checks `view.code === code`.
     - SellerConfirm uses `trade.code` (the API's string) to decide whether "this device asked to release this trade". Then it calls `escrow.release()` on the route's escrow.
   - **Why it matters.** A compromised API controls the key that is meant to scope consent to one trade.
   - **Failure scenario.**
     1. Seller S has two trades, Y and X, both funded. S holds to release Y. The marker `x2f.release-asked:Y` is written.
     2. The API, or the buyer of Y through the API relay, stalls Y's co-signature. Y's device never reaches `done`, so the marker is not cleared, and S moves on.
        - Or, more simply: Y's release-started answer is dropped at network level (a connection reset is not an `ApiCallError`), so the marker stays.
     3. Within 15 min S opens trade X, where the buyer has just "marked paid" with a fake screenshot.
     4. The API answers `GET /v1/trades/X` with `{ code: 'Y', role: 'seller', state: 'settling', settling: 'release', … }`. Amounts are taken from the device for X (I3), so nothing looks off apart from the code in the header.
     5. `releaseAsked('Y')` is true and X's escrow is `ready`, so the effect calls `escrow.release()` on X.
     6. X's runtime `fresh('release')` reloads X's view from the same API ("settling/release"), passes, and signs. X's buyer co-signs automatically.
   - **Result:** X's escrow is released with no tap on X. This is the round-2 attack with one extra precondition (a live marker on any other trade).
   - **Fix (small):** scope the marker to the trade the device escrow belongs to, not to the API's string. Either:
     - (a) The room (Task 22, TradeRoom.tsx `ReadyRoom` or `useTradeView`) refuses a view whose `code` differs from the route code, and treats it like the integrity failure: fail closed. This protects every slot, including Task 25's refund screens. Or:
     - (b) ReleaseRoomScreen / SellerConfirm key the marker by the escrow's own code. Pass the route code down, or use `escrow.deal`'s trade id if Task 12 exposes it.
   - (a) is the better fix and is a one-line cross-task note for Task 22. Do both if (a) cannot land with this task.
   - **Test:** a marker for trade Y, a view `{code:'Y'}` rendered for the route/escrow X in settling/release. Expected: `release()` is not called and the room shows the integrity/"could not load" state.

## Minor

1. **SellerConfirm.tsx:141-145 (the "trade has ended" clear) never fires in the room, so the marker outlives the seller's own retraction.**
   - **Why the clear never fires:**
     - SellerConfirm is mounted only for `paid` and `settling/release` (slots.tsx:16-22).
     - In `released`, ReleaseRoomScreen swaps to `<Released>`.
     - In `disputed`, `cancelled`, `refund_requested` and the like, the room renders another task's screen.
     - So SellerConfirm unmounts before it can ever render with `ended === true`. `ended` is dead in production, and the doc claim "cleared … when the trade has ended" (marker.ts:12) does not hold.
   - **Scenario:**
     1. S holds. The POST's answer is lost (or a compromised API resets the connection) and the marker stays.
     2. The screen says "The release didn't start. Try again." (:266).
     3. S re-checks the bank, sees nothing, and taps "Payment not received" / "Open dispute".
     4. Within 15 min of the hold, the API moves the trade (back) to `settling/release`. On the next read the device signs with no tap, even though S's last explicit act was a dispute.
   - **Fix:**
     - Clear the marker on the "Payment not received" and "Open dispute" taps (:276-281).
     - Move the "ended" clear to where it can run: ReleaseRoomScreen or the Released screen for `released`, or a room-level effect. Better, drop the claim and rely on the 15 min bound plus the dispute-tap clear.
   - Bounded by the hold S gave and by the 15 min, so Minor.
2. **SellerConfirm.tsx:112-118 and :266: after an unreachable POST the marker is kept on purpose, but the copy says "The release didn't start. Try again."**
   - Release.test.tsx:245-262 shows that the next settling read then signs by itself, and the alert disappears.
   - The seller is told nothing started, when in fact a signature may follow on its own within seconds.
   - Fix: for the unreachable case (not `ApiCallError`), say that the outcome is unknown. For example: "X2F didn't answer. If the release started, this device will finish it. To stop it, report the payment missing." Keep "didn't start" for a refusal.
   - This also makes Minor 1's dispute path explicit.
3. **SellerConfirm.tsx:86 and :162-163 (round-2 Minor 2 fix): `notHere` includes `registering`/`verifying`/`setting-up`.** These are also the phases every correct device passes through right after a reload (Task 12 boots `registering → verifying → ready`).
   - So the seller who reloads in settling on the right device briefly reads "This device doesn't hold this trade's escrow yet. If you set the trade up on another device, open it there."
   - Fix: show that line only for `idle` (or once the phase has stayed non-ready for a few seconds). Use "Starting this device's escrow…" for the transient phases.

## Round-2 Minors and the Task 22 port

- **Round-2 Minor 1: fixed.** Released.tsx:29-35 falls back to the API amount only when `state === 'released'` and the strings are plain digits. `amounts()` returning null gives "The XMR"/"the XMR". The `!` is gone, and the words name no amount in settling.
- **Round-2 Minor 2: fixed**, with the nit in Minor 3 above.
- **Round-2 Minor 3 and the shared-target ruling: done.**
  - `.x2f-method-name` is inline-flex with a 44 px minimum height and width (ui.css:227-235).
  - phone.ts passes a checkbox/radio whose `<label>` is at least 44 px tall and MIN_TAP wide.
  - The `header: true` skip is gone from release.spec, and the `:not(.x2f-method-name)` exclusion is gone from refund.spec.
  - Pixel parity on the trade headers is report-only, as claude2 noted.
- **Port onto Task 22: correct.**
  - releaseScreens.ts registers `RELEASE_SLOTS` and is imported by screens.ts on the Task 24 line. There is no TradeRoom ↔ SellerConfirm cycle: SellerConfirm does not import TradeRoom.
  - The slots match TradeRoom.tsx:45's ownership list.
  - `postTradeEvent` and `methodOf` come from api/trade.ts.
  - InterimTradeRoute and harness/main.tsx are gone. App.tsx is the main line's.
  - Both NEEDS_TASK_22 tripwires are deleted. The remaining tripwires (NEEDS_TASK_3_IN_VIEW, NEEDS_TASK_12_OWN_ADDRESS) read only the local tree.
  - The fixture escrow now re-renders (`useSyncExternalStore`). `release` moves the phase to `done` unless `__x2fEscrowFail` is set. It is fixture-only (VITE_FIXTURES, dropped in production).
  - The integrity screen still pre-empts Task 24's screens (TradeRoom.tsx `integrityFailed`).
- **The marker survives the `ReadyRoom` remount and a reload:** it is in localStorage. That is the point of round-2 To-land #9.

## Cross-task notes

- **Task 22:** TradeRoom should fail closed when `view.code !== code` (Important 1's fix (a)). It protects every slot.
- **Task 12 (repeated from claude2):** an `EscrowStatus` "release intent from this device pending" flag, kept with the escrow record and keyed by the escrow's own trade, would replace the marker and close Important 1 by construction.
