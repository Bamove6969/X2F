# Review: wip/lead-followups-1029 @5d5caff (base 1b2bb3a; bb5682a, 5d5caff)

Reviewer: read-only helper, 2026-10-29. Trial-merged onto main line origin/claude/compassionate-johnson-k95ssr @b3e7599 (Task 24) in a detached worktree. The worktree is removed.

## Verdict: APPROVED (0 Important, 5 Minor)

Both follow-ups do what the reviews asked. Tests are green on the merged tree. The Minors are copy and edge cases in the new BuyerCancelling refusal line (m1 to m3), and two small Terms points (m4, m5). None of them blocks landing.

## Tests (merged tree, each under check.lock)
- `tsc --noEmit` (apps/web): exit 0.
- Full web vitest (`--project @x2f/web`): 58 files, 887 tests passed.
- Playwright `pay refund setup release` in one run: 86 passed, 1 failed, 17 did not run.
  - The failure was `pay.spec.ts:104` with `EADDRINUSE 127.0.0.1:4320`. It comes from the main line, not from this branch: `pay.spec.ts:14` and `release.spec.ts:22` both start their fixture server on PORT 4320 in `beforeAll`, and Playwright runs the two files in parallel workers. See Landing.
  - Rerun separately: pay.spec 18/18 passed, release.spec 34/34 passed.
  - setup.spec (33, all passed) and refund.spec all passed in the combined run. That includes :707 (M3), :732 (new m2 test) and :782 (M4).

## (1) Task 23 round-3 Minor 1: BuyerCancelling refusal line (BuyerPay.tsx:613-615, :657-661)

What holds:
- The line shows only while the refund is neither done nor stopped.
- It shows once, with role=status, on phone and wide.
- There is one `[data-primary]`.
- A saved tap gives no Try again. The test uses `intentKind === settling`, so `saved` is true.
- The "done" and "stopped" cases are tested.

Each refusal kind, by cancel kind. Both buyer-cancel (machine.ts:136, from `paid` and `refund_requested` too) and mutual-cancel (machine.ts:134, from `paid`) can come after "I've paid":

| refusal | shown | right? |
|---|---|---|
| null, amount-out-of-range, amount-unknown | nothing | yes. Refunds are not blocked by amount (runtime.ts:672 refundOnly) |
| attempts-exhausted | "Your device couldn't settle this trade. Open a dispute." | the fact is right, but see m3 |
| view-mismatch | "...don't match what you agreed to. Don't send any money. Open a dispute if this doesn't clear." | it does block the refund (runtime.ts:923-926), but see m1 |
| amount-changed | "...Your device settles only the amount you paid. Open a dispute..." | wrong for a refund, see m2 |
| paid-amount-refused / paid-amount-waiting | default sentence | seller-only, so the buyer never gets them |

**m1. The view-mismatch sentence is misleading on a cancel after paying.** PaidFlowSheet.tsx:60, used at BuyerPay.tsx:615.
- Scenario: the buyer paid, then cancels (buyer-cancel from `paid`, or mutual-cancel). The API view drifts. The room says "Don't send any money", but the money is already sent.
- It also never says that the refund itself is waiting, which is the thing the person cares about.
- Before paying, "Don't send any money" is redundant on a cancel screen, but harmless.
- The paid Finish card already has its own wording for this (BuyerPay.tsx:519, "Don't pay again").
- Suggested BuyerCancelling-only sentence: "The trade's details on the server don't match what you agreed to, so your device can't return the XMR yet. Keep this page open. Open a dispute if this doesn't clear."
- To do it: give BuyerCancelling its own mapping instead of `refusalText`, and add a mutual-cancel view-mismatch case to the it.each (only attempts-exhausted is covered for mutual-cancel).

**m2. amount-changed is shown on a refund that is not blocked.** BuyerPay.tsx:615, with runtime.ts:800 and :945.
- Scenario: the buyer taps "I've paid", which fixes `acceptedAtomic`. The API later shows another amount, and the buyer cancels (or both agree to cancel).
- `refusalFor` returns `amount-changed`, so the room says "Your device settles only the amount you paid. Open a dispute if this doesn't clear."
- Meanwhile the refund is signed normally. `context(…, refundOnly=true)` ignores the view amount, and the runtime doc at runtime.ts:72-73 says refunds are never refused for an amount.
- Fix: in BuyerCancelling, show only the refusals that block a refund (view-mismatch, attempts-exhausted) and hide the amount-* ones. Add a test with amount-changed that expects no `[data-escrow-refusal]`.

**m3. "Open a dispute" contradicts the rest of the card and has no way to act on it.** BuyerPay.tsx:648, :675, :657.
- With attempts-exhausted, the card still says "Returning the XMR to X. Keep this page open." and the disabled primary says "Returning the XMR…". Next to it, the new line says the device couldn't settle.
- This screen has no dispute control.
- In `settling` the machine refuses `open-dispute` before `settleBy` (machine.test.ts "in settling only after settleBy"). An immediate tap would be refused anyway.
- Suggestion:
  - On attempts-exhausted, change the card title to "Your device couldn't return the XMR".
  - Drop "Keep this page open".
  - Keep one disabled primary, or make it the dispute link.
  - Add the dispute entry using Task 27's `rules.ts` settling rule (settleBy): "Dispute opens in <countdown>", then "Open dispute". Doing this when Task 27 lands is fine.
- Edge case, low confidence: with `intentKind !== view.settling` and a stale in-memory `attempts-exhausted` (runtime.ts:833), Try again and "Open a dispute" show together.

## (2) Task 28 round-2 m2: Terms version change (Terms.tsx:56-106, :168-176; e2e setup.spec.ts:732)

What holds, end to end:
- **The refusal.** On `terms-not-accepted` the page clears the tick and read state and scrolls to the top. It then runs `checkEnd()` once, so a big box counts as read again at once: the batched `setRead(false)` then `setRead(true)` ends as true, and a short box stays unread. Then it awaits `load()`.
- **New version.** `load()` returns N+1, which is not `TERMS_TEXT_VERSION`. The page then shows only the stale alert, the tick and I accept stay disabled, and there is no "read again" line. This is the review's scenario, and it is now fixed.
- **Same version.** `load()` returns the same version: the "read again" line shows, as before (:707 still passes).
- **No loop.** Nothing retries by itself. Each round needs a tap.
- **Reload picks up the new build.** Reload does a full `location.reload()`. index.html is served `no-cache` and assets are hashed and `immutable` (apps/api/src/static/serve.ts:166-195). public/sw.js has no fetch cache. A real reload therefore gets the new build.
  - `/terms?returnTo=` survives the reload. `/setup` restarts at the Terms, its first step, so nothing is lost.
- **The text button.** It is a native `<button type="button">` with the name "Reload the page", in the same `x2f-start__textbutton` style as the existing "Try again". It sits inside the role=alert paragraph. The tick's `aria-describedby="terms-stale"` now reads "The Terms have been updated. Reload the page to read the new version." That is fine.
- **The normal path.** It is unchanged apart from `load` becoming async (the effect wraps it in `void`, and Try again uses `() => void load()`). The full web vitest suite and all 33 setup.spec tests pass.
- **The e2e trick does not leak.** `page.route('**/assets/*.js')` is registered on that test's own `page` fixture, which is fresh per test. No other spec routes assets. The version string `2026-10-17` appears only in termsText.ts:16, so the rewrite touches nothing else. Routing also turns off the HTTP cache, so the reload really fetches the rewritten assets.
- **The new test catches a regression.** It would fail without the fix: the `not.toContainText('Read them to the end again')` check, the single role=alert, and the Reload button all depend on it.

**m4. Focus after the refusal lands on a disabled button.** Terms.tsx:126 (I accept) and :170-172.
- The tap that triggers the refusal leaves focus on I accept, which is now disabled.
- The alert is announced, but a keyboard user has to tab around to find Reload.
- Suggestion: when a refusal leads to `stale`, focus the Reload button.

**m5 (pre-existing, also in M4). The box claims the new version for the old text.** Terms.tsx:153.
- While stale, the box ends with "End of Terms. Version <server version>." under text that is `TERMS_TEXT_VERSION`'s.
- Suggestion: print `TERMS_TEXT_VERSION` there. The e2e at :760 still holds after a reload, because the rewritten build carries NEW.
- Smaller point: when the re-read fails (`now === null`), only "Could not load the Terms version. Try again." shows, with no word on why the tick cleared.

## Landing / conflict notes
- **Trial merge with the main line @b3e7599 (Task 24): clean.** There are no textual conflicts. The only file both sides touched is buyerPay.test.tsx, which auto-merged. tsc and vitest are green on the result. npm ci was done.
- **Task 27** (origin/wip/lead-p3-task27 @31884f8):
  - This branch touches none of its files. Its diff against the main line has no changes in BuyerPay.tsx, PaidFlowSheet.tsx, setup/, setup.spec.ts or buyerPay.test.tsx.
  - `git merge-tree` of (main + this branch) with Task 27 conflicts only in apps/api/src/app.ts and docs/coordination.md. Those are Task 27 against the main line, not this branch.
  - The settling dispute rule in m3 is Task 27 material (`screens/dispute/rules.ts`, settling case).
- **Main line, not this branch: pay.spec.ts:14 and release.spec.ts:22 share PORT 4320.**
  - Any Playwright run with both files in parallel workers can fail with EADDRINUSE. Seen here in pay.spec.ts:104, after which 17 tests did not run.
  - Fix: give release.spec its own port (e.g. 4321, checking the other specs' ports), or run the two files serially. Until then, run them as separate commands.
