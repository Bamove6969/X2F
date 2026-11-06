# Re-review (round 4): wip/lead-p3-task24 @8caaca2 (Task 24 fix round 3) — APPROVED (0 Important, 2 Minor; one landing fix required)

Reviewer: helper subagent for the lead, 2026-10-29. Read only. Scratch worktree ~/x2f-worktrees/rv-t24 has been removed.

**Scope:**
- `git diff a5a9927 8caaca2`: the fixes and tests on top of the 7c43bf0 merge. Files:
  - SellerConfirm.tsx, TradeRoom.tsx, release/marker.ts, release/slots.tsx
  - release.test.tsx, tradeRoomEscrow.test.tsx, finalAlert.test.tsx, sellerRefund.test.tsx
  - docs/coordination.md
- Answers: ~/x2f-comms/review-task24-round3-2026-10-29.md
- Trial merge onto the main line d5b7fb9 (Task 4 in).

## Checks run (merged tree, under flock, own worktree)

- **Merge onto d5b7fb9:** one textual conflict, in docs/coordination.md (both sides appended). Keep both: main's "Task 4 (offers) notes" section and Task 24's round-4 line. No code conflicts.
- `npm ci` (pinned npm): OK.
- **tsc:**
  - apps/api: clean. packages/auth-client: clean.
  - **apps/web: 1 error, a semantic clash with Task 4.** `apps/web/test/release.test.tsx(32,54): Property 'stage' is missing … in type 'TraderSummary'`. Task 4 added `stage: 'starter'|'building'|'graduated'` to `TraderSummary` (api/trade.ts:48-49).
  - **Landing fix (required, one line):** add `stage: 'graduated'` (or `'building'`) to `who()` in release.test.tsx:32. Nothing in src is affected.
- **vitest `--project @x2f/web`:** 54 files, 804 of 804 passed. Vitest does not typecheck, so the clash above does not show here.
- **Red on the old code:** I put the a5a9927 SellerConfirm.tsx, TradeRoom.tsx, marker.ts and slots.tsx back under the new tests. 7 of the 59 tests in release.test.tsx and tradeRoomEscrow.test.tsx fail, which is all the new ones:
  - room fail-closed in every state and role;
  - refusal for X with no escrow start;
  - a later re-read with Y's code;
  - the marker keyed by the escrow code when handed Y's view;
  - dispute taps clear the marker;
  - the boot-phase hint;
  - the lost-POST test, through its new copy.
  - The positive "same code written differently" test passes on both versions, as it should.
- **Playwright:** release.spec 34, refund.spec 18 (+1 self-skip), fund.spec 28: 80 passed, 1 skipped, 0 failed (Chromium /usr/bin/chromium; web servers exited with the run).

## Round-3 findings verified

- **Important 1: fixed, at the right layer.**
  - TradeRoom.tsx:207-215 compares `normalizeTradeCode(route)` with `normalizeTradeCode(view.code)`. It renders only the `data-trade-mismatch` alert, before `ReadyRoom`, so no slot renders and `useTradeEscrow` is never called.
  - A later mismatched poll unmounts `ReadyRoom`, which takes the screen away.
  - `TradeScreenProps.code` is the normalized route code. SellerConfirm keys the marker by it (`escrowCode`), and also uses it for the release-started POST, the dispute links and the Chat link.
  - Attacks I tried:
    - **Normalisation tricks:** `normalizeTradeCode` (packages/core/src/tradeCode.ts:56-75) rejects non-strings, non-ASCII and over-long input. It folds case, spaces and dashes, and maps O→0 and I/L→1, then requires 16 valid characters.
      - A view code that normalizes to the route's is the same trade under the same rules the escrow runtime uses (runtime.ts:1160+ normalizes its code too). The marker key is the normalized form, so it equals the runtime's trade.
      - Another trade's code can never compare equal.
      - A non-string or junk `view.code` gives `null !== own`, which is a refusal.
    - **The poll swapping the code mid-sign:** `ReadyRoom` unmounts. A `release()` already in flight was asked for by this device for this route's trade (a hold, or the marker keyed by the route), so no consent crosses trades.
      - On the next good read a fresh `ReadyRoom`/SellerConfirm mounts. The marker resumes only for this route's trade.
    - **Slots other than release (Tasks 22, 23, 25, 27):** they are all behind the same check, so any `view.code` a screen reads is the route's trade, possibly spelled differently. See Minor 2.
    - **A view handed directly to the screen (no room):** the test "even handed Y's view directly…" shows the marker is keyed by X, so the screen needs a hold.
- **Minor 1: fixed.**
  - The dead `ended` effect is removed.
  - "Payment not received" and "Open dispute" clear the marker on click (SellerConfirm.tsx:295-299). A router `Link` fires `onClick` for mouse, touch and keyboard activation.
  - The links show in `paid` (which covers the lost-answer case) and in `foreign`.
  - The marker.ts:9-15 comment now says what happens.
- **Minor 2: fixed.** An unreachable POST (not `ApiCallError`) gives `failed: 'unknown'` and "We couldn't confirm the release started. If it did, this phone will finish it." A refusal keeps "didn't start". See Minor 1 below for the word "phone".
- **Minor 3: fixed.**
  - `notHere` is only `idle`.
  - `registering`/`verifying`/`setting-up` show "Starting this device's escrow…" while releasing.
  - `foreign` still takes priority, so a device with no marker never gets the soothing copy instead of the warning.

## Minor

1. **SellerConfirm.tsx:284: "If it did, this phone will finish it."** Every other line on the screen says "this device", and the web app runs on desktops too. Use "this device".
2. **Cross-task (Tasks 22 and 25), not blocking: screens still key device-local state by `view.code`, which may be spelled differently from the route.**
   - The room check (normalized equality) lets through a `view.code` that is the same trade but spelled differently. TradeFund.tsx:196-258 (`hasFundMark`/`setFundMark`, localStorage) and SellerRefund.tsx:105-248 (`useFlowDeps`, `refundRun`, `pendingRefundRun`) still key by `view.code`.
   - Scenario: a buggy or compromised API sends `k7m2-9qxa-…` in lower case. The fund marks or the pending refund run are then looked up under another key, and a "funded" mark or a pending refund is not found.
   - Every outcome fails safe: no cross-trade hit and no signing. It is still inconsistent.
   - Fix: switch those screens to `props.code`, as TradeRoom.tsx:23-26 now asks.

## Landing notes (onto d5b7fb9 or later)

- docs/coordination.md: keep both appended blocks.
- apps/web/test/release.test.tsx:32: add `stage` to `who()`. Without it, web tsc fails on the merged tree.
- Task 23, if it lands first: its screen gets `code` in `TradeScreenProps` for free. The room check also covers it.
