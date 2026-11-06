# Review: Task 22 landing, wip/lead-p3-task22-land @7171bd2 (fresh, independent, 2026-10-28)

**Verdict: APPROVED.** No Important findings. Six Minors follow. None of them blocks the merge; Minor 1 and Minor 2 should get a coordination line.

Scope: `git diff 7f83946 7171bd2` (commits 1e2dc4f, 9fb7f23, 76aea46, 0031fbf, 50ecd93, 7171bd2), plus a sanity check of the merge 7f83946 against both of its parents.

Tests: in ~/x2f-worktrees/lead-t22-land @7171bd2, run under flock with `npx vitest run` on tradeRoomEscrow, tradeFund, refund-tripwires, tradeRoom-tripwires, css-collisions, useEscrow, finalAlert, sellerRefund and quote-tripwires. Result: 9 files, 110/110 passed. No e2e was run.

## What passes

- **Merge 7f83946.** Against parent a3a7d7f (the main line), the merge adds only Task 22's own files, plus the expected App.tsx route swap and import, fixtures/index.ts, HoldButton (Task 22's I2 change) and parity.ts TradeFund exceptions. Against parent 9bb22b7 (approved Task 22), Task 22's files are byte-identical. The only differences are main-line content (FinalAlert, parity.ts additions, and so on). No hand-merge damage was found.
- **Amounts and addresses come only from the device.**
  - `escrowAddress` is set only from `party.ready()`'s resolved address (runtime.ts:570).
  - `deal` is `rec.deal`, which is copied from the user's ConfirmedTrade (runtime.ts:450). It is never taken from the API.
  - `receivedAtomic` and `confirmedAtomic` come from the device's own `funds()` reading. `confirmedAtomic` counts `incoming` with 1+ confirmations, so a 0-conf tx never sets the funded mark.
  - `seams.ts` now types `TradeEscrow = UseEscrow`, so there are no drifting copies. `integrityFailed` and `verifiedFunding` are unchanged from the approved code.
  - attestation-flow.test.ts adds a real-runtime test for all four fields, including a balance that falls after a settlement while the confirmed amount stays.
- **Fixtures mode cannot reach production.**
  - `__X2F_FIXTURES__` is folded at build time, and `fixturesOn` allows a build only with mode `fixtures`. The fixtures module, including its new FinalAlert, boards and recorder imports, is reached only through the dead dynamic import.
  - `fixtures-serve.ts` always builds with `--mode fixtures` into a gitignored `dist-fixtures*` directory.
  - The worker env fix is real. Before it, `workerConfig(import.meta.env)` inlined the whole env object, VITE_FIXTURES included, into the production worker chunk. Now the five keys are named one by one (worker.ts:96-104), and `import.meta.env` appears nowhere else in src.
  - bundle.test.ts scans every `.js` file under dist recursively, worker chunk included, for "fixture", and it builds with VITE_FIXTURES=1. That makes it a working regression guard for this leak.
  - Only public `VITE_` values are inlined: network, mod public key, fee wallet, relay URL and node-proxy URL. No secrets.
- **Confirmed fallback (TradeRoom.tsx:182-186).**
  - The history state wins. Otherwise `readConfirmed(code)` is used, keyed by the exact code that both useTake and AcceptedSheet store under. `readConfirmed` validates the shape.
  - A stale or mismatched stored record cannot do harm. On a first start the runtime checks `viewMatches` (role, poster, currency, rate, maximum) and the amount, so a wrong role or deal gives `deal-mismatch` before any identity is registered.
  - Once a record exists, `confirmed` is ignored (runtime.ts:419-425).
  - tradeRoomEscrow.test.tsx covers three cases: state beats storage, storage for the right code only, and neither present.
- **Live fan-out.**
  - There is one EventSource: `LiveAccepted` is mounted only when `isTrader`, so staff and logged-out sessions have no source and the room only polls.
  - The listener Set unsubscribes when the source changes or the room unmounts, through the `useTradeLive` effect cleanup. StrictMode's set/null/set is harmless.
  - The tradeFund test proves an event triggers a refresh and that nothing happens after `setLiveSource(null)`.
  - The tripwire pins the wiring and the single `connectEvents` call site.
- **refund.spec semantics match the plan.** Plan Task 25 (plan line 844) says SellerRefund "appears only after `payBy` has passed by the server clock". The old harness showed a disabled Cancel button before payBy. The room correctly shows no refund screen there: seller × secured before payBy belongs to Task 23. The new unit test pins it: `screenFor(v, payBy)` is null and payBy+1 gives SellerRefund. That matches the API's strict `now > payBy` (`too-early` at exactly payBy).
- **The tripwire retirements are legitimate.**
  - NEEDS_TASK_22: all five of its steps are done. refundSlot.ts uses Task 22's types, refundScreens.ts:42 registers, screens.ts imports it, the e2e drives /trade/:code with the 1280x800 parity, and `methodOf` is Task 22's.
  - Task 12's: all four fields are in EscrowStatus/UseEscrow, and seams calls `useEscrow`.
  - Task 19's: replaced by a positive wiring check.
  - The I4 navigation tripwire stays.
- **CSS.** The renames are consistent: no `.x2f-quote`, `.x2f-qr` or `x2f-qr__` is left in trade code. css-collisions.test.ts is a useful guard; its only exception is the pre-existing `.x2f-input`.

## Minor

1. **The room now starts the real escrow worker for every visitor, and the run never stops** (TradeRoom.tsx:186, seams.ts `useTradeEscrow`, useEscrow.ts effect; runtime.ts:419-433 `retry` loop).
   - The cause: `useEscrow`'s cleanup only unsubscribes. The worker's `TradeRun` keeps calling `getTrade` every `pollMs` (5 s) until the tab closes.
   - Failure scenario: a logged-out visitor, a staff account, or a trader opening a wrong or someone else's code sees "Trade not found" or is sent to login. Their tab then sends GET /v1/trades/:code every 5 s indefinitely, one loop per distinct code visited. Each visit also boots the worker, with monero-ts and resume-all.
   - Fix: call `useTradeEscrow` with a no-op or pending handle until `load.kind === 'ready'`, which keeps the hook order fixed by switching inside the hook. Alternatively, have the runtime stop a first start whose `getTrade` answers 401, 403 or 404 instead of retrying.
2. **A `not-confirmed` run is sticky for the worker's lifetime** (runtime.ts:1103-1106 `if (runs.has(code)) return`; `retry` only re-runs retryable errors, runtime.ts:1148).
   - Failure scenario: AcceptedSheet's "Add a wallet" sends the poster to `/wallets?add=1&returnTo=/trade/<code>` (AcceptedSheet.tsx:161-170). The poster comes back to the room without ever confirming. There is no state and no stored record, so the room shows `not-confirmed`: "Open this trade from the device you started it on." That text is wrong for this case, and there is no way to accept from the room, so the trade lapses at setupBy.
   - Any later in-tab start with `confirmed` is also ignored until a reload.
   - This is unreachable today because /wallets is a placeholder. It is Task 19/13 territory made live by this landing. Record it in coordination.md: the returnTo should reopen the accept sheet, or the room should offer the poster's accept step.
3. **The worker fails closed silently on missing env** (worker.ts:96-104 with `workerConfig` throwing; serveEscrow swallows it).
   - Failure scenario: a production build without, say, VITE_MOD_SIGNING_PUBLIC shows every trade as endless "Setting up escrow" with no error sentence. That is the I3 symptom, now through misconfiguration.
   - This is not new code, but the landing is what makes the real worker reachable.
   - Suggest a build-time check in vite.config for production mode, or post an `unsupported-browser`-style status when the runtime fails to build.
4. **The tripwire test misses a second `useLiveEvents` caller** (tradeRoom-tripwires.test.ts:81).
   - The regex counts `new EventSource(`, `new Source(` and `connectEvents(`, but `useLiveEvents(` opens its own connection too.
   - Failure scenario: a later task adds `useLiveEvents` in TradeRoom. The test stays green and the tab has two EventSources.
   - Fix: also assert that `useLiveEvents(` appears only in App.tsx.
5. **The refund e2e lost its real-hook coverage** (src/fixtures/index.ts:260-284).
   - The old harness ran Task 12's real `useEscrow` over a recorder client, so the e2e exercised the action-to-message mapping (`signal` → `{type:'signal', signal}`, `buildRefund` → `build-refund`).
   - The fixture now records names directly from a fake handle.
   - useEscrow.test.tsx still covers the mapping at unit level, so this is acceptable. Either note it in refund.spec's header, or have the fixture build use `useEscrow` over a recorder `EscrowClient` via `setEscrowClient`, which would keep the e2e on the real hook.
6. **Two inaccurate comments.**
   - TradeRoom.tsx:181 and quote/confirmed.ts say history state does not survive a reload. With BrowserRouter it does, because `history.state` persists across reload and back/forward, and structured clone carries bigints. What does not survive is a fresh tab or a push-notification open.
   - confirmed.ts says "the room may clear the stored copy once the escrow has it", but nothing clears it, so the payout address stays in sessionStorage for the tab's life. That is low risk, since storage is tab-scoped, but either clear it once `escrow.deal !== null` or drop the sentence.

## Notes, no action needed

- `e2e/accepted-phone.spec.ts` failing on the main line and the `.x2f-input` collision are correctly recorded as not this landing's.
- The Desktop parity in refund.spec still skips until BuyerPay lands, as recorded.
- While Task 23 is absent, a seller who taps "Give 30 more min" sees the plain status card for the extension window. That is the expected interim behaviour, and the coordination note states it.
