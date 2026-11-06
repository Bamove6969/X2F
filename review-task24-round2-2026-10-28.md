# Re-review: wip/lead-p3-task24 @a6cce75 (Task 24 fix round) — CHANGES REQUIRED (1 Important)

Reviewer: helper subagent for the lead, 2026-10-28. Read only. Scratch worktree ~/x2f-worktrees/rv-t24 has been removed.

**Scope:**
- `git diff 561fb8a a6cce75`: 16 files.
- The merge 561fb8a itself.
- A trial merge onto today's main line, 9123b4f (clean).
- A trial merge onto origin/wip/lead-p3-task22-land, 5497862.
- Checked against: the original review (~/x2f-comms/review-task24-2026-10-27.md) and the fixer's record (docs/superpowers/reviews/2026-10-27-p3-task24.md).

## Checks run (under flock)

- **Branch merged with main line 9123b4f** (it merges with no conflicts):
  - web tsc: clean. api tsc: clean.
  - vitest on release.test.tsx, release-tripwires and app-routes: 44 of 44 pass.
- **Branch merged with 22-land** (App.tsx and manual-checks taken from 22-land, harness/main.tsx deleted), plus a probe that runs `for (const s of RELEASE_SLOTS) registerTradeScreen(s)`:
  - web tsc: the slot registration type-checks against Task 22's `TradeSlot`, `TradeScreenProps` and `TradeEscrow = UseEscrow`.
  - The only errors are in e2e/release.spec.ts: `./harness/serve.js` is gone, and `__escrowCalls`/`__escrowFail` are now `__x2fEscrowCalls`/`__x2fEscrowFail`.
  - vitest on release, release-tripwires, css-collisions, app-routes and tradeRoom-tripwires: 49 pass, 2 fail. The 2 are the two NEEDS_TASK_22 tripwires, as intended.
- Playwright: not re-run. The fixer reports release.spec 33/33 and refund.spec 17 pass with 1 skipped.

## Findings verified

- **I3: fixed.**
  - `ReleaseEscrow = Pick<UseEscrow, 'release'|'phase'|'error'|'refusal'|'keepOpen'|'amountAtomic'|'fiatCents'>` (view.ts:47).
  - `amounts()` (view.ts:86-100) reads only the device's `amountAtomic`/`fiatCents`, and works the fee out from the device amount with `escrowPlan`.
  - The hold is locked while the amount is null, under any refusal, and while the escrow is stopped (SellerConfirm.tsx:69-70, 201). It says why each time.
  - On the release screens, the API's amount is now used only in Released's fallback (see Minor 1).
- **I2: fixed.**
  - `useConfirmations` (seams.ts:22-53) asks only once the trade is `released` with a tx hash. Its dependencies are `[code, ready, txHash]`, so the Released screen that is already mounted starts counting.
  - A 409 means "not yet" and is asked again every 15 s. It cannot spin: there is always a timer between asks.
  - Any other 4xx stops. Backoff starts after 3 null answers and is capped at 4 min. Cleanup clears the timer.
  - A buyer in `settling` sees "<seller> released X to you / Your device is adding its signature…", or a refusal, or the stopped-escrow message. They never see "is yours" before their device has co-signed.
- **I1: the done look is fixed, but the resume added a new problem (Important 1 below).**
  - The done look comes from `escrow.phase` (`done`/`settled-without-device`), at SellerConfirm.tsx:66-67.
  - Loop and double-call safety holds:
    - The `asked` ref limits the automatic call to once per mount. It is set before the POST and reset only when the POST fails, so a lost answer can still resume.
    - A failed `release()` leaves `asked` set and offers "Finish the release on this device". There is no retry loop.
    - SellerConfirm stays mounted from `paid` to `settling`, in both the interim route and 22-land's ReadyRoom: the same `ReleaseRoomScreen` type, no key on `<Screen>`, and ReadyRoom keyed by code. So `asked` survives the room's refresh.
    - A repeated `act({type:'release'})` cannot double-sign. It only resets an identical tapped intent (runtime.ts:978-985). The outcome is re-derived and bound by `releaseBoundAtomic`, and `settle(o)` already runs on every tick.
    - A second hold after a lost answer gets a 409 from the API, which is harmless.
- **Minors 1, 2, 3, 4 (label), 6, 8, 9, 10, 11, 12: fixed as recorded.**
  - Minor 1 (chain.ts doc), Minor 2 (dev-setup) and Minor 12 (`prune: true`): diff checked.
  - Minor 6: `isTxHash` (view.ts:126).
  - Minor 10 and Minor 11: the copy and the `started` flag are in.
  - Minor 8: the CDP touch hold is in release.spec.ts:147-149.
  - Minor 9: PHONE_VIEWPORTS is used.
- **Deferrals: legitimate.**
  - Minor 5 is moot while the view carries no profile, and needs owner copy or a data field.
  - Minor 7 needs Task 12 to expose the device's own address.
  - Their tripwires (release-tripwires.test.ts:38-54) read only the local tree (`apps/api/src/app.ts` and `apps/web/src/escrow/useEscrow.ts`), and both pass today.
  - The NEEDS_TASK_22 tripwires (:17-36) also read only the local tree, and they fire on the 22-land merge as intended.
- **Merge 561fb8a: resolved correctly.**
  - main.ts keeps `ownerAlertSink` and `onAlert`/`alertLog`/`prices.start()`, and has `buildApi(deps, monerod ? {txConfirmations: daemonConfirmations({url: monerod})} : {})`.
  - App.tsx takes the main line's routes, with `/trade/:code` → InterimTradeRoute listed once.
  - The package block is the main line's.
- **Commits d412882 and be67e10 do not build on their own.** The tip is clean. This only matters for bisect, and history cannot be rewritten (no force-push). Nothing to do beyond the note the fixer already wrote.
- **I searched for amounts read from the API elsewhere on the release screens and found none.** The only remaining use is Released.tsx:30 (Minor 1).

## Important

1. **SellerConfirm.tsx:111-117 (with :57-58 and the test at release.test.tsx:207): the I1 resume lets the API's word alone make the seller's device sign a release, with no hold on this device.**
   - **What the code does.** The effect calls `escrow.release()` whenever the view says `settling`/`release`, the device is `ready` and nothing was asked on this mount.
   - **Why that matters.** Task 12 deliberately gives the seller no automatic `release` (runtime.ts:957-963, `autoKind`). The seller's hold is the only consent for the one outcome that pays the counterparty. The spec treats the service as possibly compromised (docs/superpowers/specs/2026-10-14-x2f-design.md:181, "even if the service is compromised"; §6.5 at :322-330, signed native builds). The device already refuses to trust the API on amounts (I3). With this effect it trusts the API on whether the seller agreed to release.
   - **Failure scenario.** A compromised or malicious API (or an insider working with the buyer) moves the trade `paid → settling/release` without any `release-started` from the seller. The machine's seller-only rule runs on the server and does not help. The buyer sends a fake payment screenshot and marks paid. The seller gets the "payment sent" push, opens the trade room to go and check the bank, and the device signs the release on mount. The buyer's device co-signs automatically (its `autoKind` gives it `release`). The XMR is gone before the seller ticked the box. This is exactly the fake-payment fraud that the box and the hold are there to stop.
   - **Fix: resume automatically only when this device itself asked.**
     - Write a per-trade "release asked" marker on the device just before the POST, in `release()`. Use localStorage keyed by trade code, or better, a Task 12 escrow-store flag or action. It must survive a reload.
     - Clear the marker when the release completes or the trade leaves settling.
     - Run the effect only when the marker is present. That still covers both lost-answer cases: (a) the lost POST answer, and (b) a reload between the POST and `release()`.
     - Without the marker (another device, a cleared store, or the API moved the trade alone), keep the done look device-based and show the box and an explicit "Hold to finish the release" (a HoldButton, not an automatic call). Use the same `release()` path. Copy along the lines of "X2F shows a release under way that wasn't started on this device. Check {place} first."
     - Tests: a remount in settling with no marker does not call `release()` and shows the hold. With the marker it calls once. A lost POST answer then settling still calls once, because the marker was written before the POST.
     - Pass this as a cross-task note to Task 12. An `EscrowStatus` flag such as "a release intent from this device is pending" would let the screen drop its own marker.

## Minor

1. **Released.tsx:28-30: the API's amount is the fallback in `settling` as well, though the doc comment (:19-21) and the fix record say "only once the trade is settled".**
   - Scenario: a buyer in `settling` whose device has no amount yet (still setting up after a restore, or `amount-unknown`). The heading "<seller> released {API amount} to you" then shows the API's figure.
   - Also, the `!` on the fallback crashes the screen if the API's `amountAtomic` is `"0"` (`amounts()` returns null). In the interim route, which does not run `parseTradeView`, a non-digit string makes `BigInt` throw.
   - Fix: fall back only when `trade.state === 'released'`. Before that, use wording with no amount ("<seller> released the XMR to you"). Guard against null instead of using `!`.
2. **SellerConfirm.tsx:132-135: while releasing, when the device is `idle`/`setting-up`/`verifying` (for example, the trade opened on a device that never held this escrow), the hint says "The release isn't signed on this device yet. Keep this page open." for ever.**
   - Fix: in those phases, say to open the trade on the device the escrow was set up on. (This fits Important 1's no-marker branch.)
3. **SellerConfirm phone layout (release.spec.ts:402-410): `header: true` skips the whole `expectPhoneLayout` on SellerConfirm** because of the shared `.x2f-method-name` button (claude2: 28x24 on every trade header) and the 22 px checkbox. The skip hides any other regression on that screen.
   - Better: exclude only `.x2f-method-name`, as 22-land's refund.spec.ts:298 does (`button:visible:not(.x2f-method-name)`), until the shared fix below lands.

## To land on Task 22 (origin/wip/lead-p3-task22-land @5497862)

`git merge-tree` of 22-land and a6cce75 gives 3 conflicts. Everything else merges cleanly, including worker.ts.

1. **apps/web/e2e/harness/main.tsx (modify/delete).**
   - Accept the delete: 22-land 0031fbf removed the harness.
   - Port release.spec.ts to `e2e/fixtures-serve.ts`: `startFixtures(4320, 'dist-fixtures-release')`, with port 4320 kept apart from refund's 4319. Drive `/trade/:code` in TradeRoom.
   - Rename `window.__escrowCalls`/`__escrowFail` to `__x2fEscrowCalls`/`__x2fEscrowFail`, and seed `window.__x2fFixtureEscrow` (phase, refusal, keepOpen, amountAtomic, fiatCents).
   - 22-land's fixture handle is static: `release` only records the call (fixtures/index.ts:48-70), and `setTradeEscrowHook(() => state)` never re-renders. Task 24's e2e needs `release` to move the phase to `done`, and needs a fail-then-succeed path ("Finish the release").
   - So extend fixtures/index.ts with a small store (`useSyncExternalStore`) and a `release` that sets `phase: 'done', keepOpen: false` unless `__x2fEscrowFail` is set. Or rewrite those e2e cases to reload with a new fixture phase. Keep refund.spec green.
   - The Task 22 tsc errors after the merge are only these three, in release.spec.ts lines 17, 36 and 259.
2. **apps/web/src/App.tsx (conflict).**
   - Take 22-land's file: the TradeRoom route and its LiveAccepted fan-out.
   - Delete `screens/trade/release/InterimTradeRoute.tsx` and its import. app-routes.test.ts must still pass, with `/trade/:code` listed once.
3. **docs/manual-checks.md (add/add).** Keep both sections: 22-land's and Task 24's hold rows (Android Chrome and PWA, iPhone Safari and PWA).
4. **Register the slots.**
   - At the top level of SellerConfirm.tsx (or a `releaseScreens.ts`, following 22-land's `refundScreens.ts`), add `import { registerTradeScreen } from './TradeRoom.js'; for (const s of RELEASE_SLOTS) registerTradeScreen(s);`. It type-checks as is, which the probe confirmed.
   - Put `import './SellerConfirm.js'; // Task 24: SellerConfirm, Released` on screens.ts's Task 24 line.
   - Watch for an import cycle: slots.tsx imports SellerConfirm. If SellerConfirm imports TradeRoom, keep the registration in a separate `releaseScreens.ts`, as Task 25 does, to avoid TradeRoom → screens → SellerConfirm → TradeRoom at module init.
5. **Use Task 22's api/trade.ts.**
   - In release/view.ts, replace the local `publicName`/`methodInfo` with `publicName` and `methodOf`.
   - Make `ReleaseTrade = Pick<TradeView, 'code'|'role'|'poster'|'state'|'counterparty'|'methodId'|'profile'|'amountAtomic'|'fiatCents'|'lockedRate'|'releasable'|'releasableEtaMin'|'fee'|'settling'|'txHash'|'confirmBy'|'serverNow'>`.
   - In SellerConfirm.tsx:93, replace the direct `api(...events)` with `postTradeEvent(trade.code, {type:'release-started'})`.
   - Delete both NEEDS_TASK_22 tripwires. Replace the unit test "registers for exactly the lead's slots" (release.test.tsx:537) with `screenFor(view, now)` checks, one for each slot.
6. **Env-keys commit e8f5ab4.** Its worker.ts hunk is byte-identical to 22-land 50ecd93's, and git auto-merges it with no conflict. Nothing to do. After the merge, bundle.test.ts should still pass: no `VITE_FIXTURES` in the production worker.
7. **CSS.**
   - Task 24's classes are all `.x2f-release*`/`.x2f-released*` (release.css). None of them collides with any stylesheet on 22-land, and test/css-collisions.test.ts passes on the merged tree.
   - 22-land renamed `.x2f-quote`→`.x2f-trade-quote` and `.x2f-qr`→`.x2f-fund-qr`. Task 24 does not use either.
8. **The shared `.x2f-method-name` (ui.css:227, TradeHeader.tsx:36), 28x24 on every trade header.**
   - Fix it once in the Task 14 UI layer (the lead's call), not per screen: give the button `min-height: 32px` (or 44 px) with inline-flex centering, so `expectPhoneLayout` passes on every trade screen.
   - Then remove Task 24's `header: true` skip and 22-land refund.spec's `:not(.x2f-method-name)` exclusion.
   - The 22 px checkbox on SellerConfirm (its label is the 44 px target) needs its own phone.ts rule ("an input inside a label of at least 32 px passes") or the lead's ruling.
9. **Behaviour to keep after the port.**
   - `completeOn` stays at its default, `'hold'`.
   - Under `participants-mismatch`/`deal-mismatch` the room's integrity screen replaces Task 24's.
   - The room polls every 15 s plus live events, where the interim route polled every 5 s. So `settling → released` and the start of the count can take up to 15 s without an event. That is acceptable.
   - Important 1's marker must survive TradeRoom's `ReadyRoom` remounts. A ref does not survive a reload, so it has to be device storage, not component state.
