# Re-review: wip/lead-review-screens @ ce6c970c (Plan 5 Task 6)

Reviewer: independent helper, 18 Nov 2026, BC time (UTC-7). Follows review-lead-review-screens-2026-11-18.md
(which was at 0eaea7ae).
New since then: merge 96f23bdb (main 5c937ab9), ad54ae0c (m7), 3001f788 (m2-m6, m8), df7f3184 (M1, M2, m1),
ce6c970c (e2e skip test).

## Verdict: APPROVED, on condition that Runner G's full `npm run check` is green

All of M1, M2 and m1-m8 are fixed, or, for m5, left by the lead's call with a TODO (TradeReview.tsx). I find no
new B or M. Three small m items are below; none of them blocks.

## The merge with main lost nothing

- `git merge-tree --write-tree 0eaea7ae 5c937ab9` gives tree 7fafac6b, which is the tree of 96f23bdb: the merge
  is exactly git's automatic result, and nothing was hand-resolved.
- `git diff 5c937ab9 ce6c970c` touches only the branch's 27 Task 6 files.
- Main changed 3 of those files between the two merges (cantDoCodes.ts, quoteScreen.test.tsx and
  apps/web/package.json). Every line main added there is present at ce6c970c: I grepped each added line and none
  was missing.

## The fixer's calls

- **`onCleared` now reports `'rated' | 'skipped' | 'empty'`** (RateFirstSheet.tsx). `finished()` counts a star
  rating or Neutral as `rated`. Skip, and `gone` (done elsewhere), count as `skipped` only while nothing was
  rated. An empty list from the start stays `empty`. Sound.
- **The quote takes again only on `rated`, and only at the exact quote tapped** (Quote.tsx `onRateFirstCleared`):
  - `startTake` stores `tapped = { centsPerXmr, fiatCents }` (quoteKept).
  - On `rated`, both must match exactly. bigint `===` compares values, so this is safe.
  - Otherwise the error becomes `QuoteMovedError`, which shows main's price-moved line (`PRICE_MOVED`, now shared
    with `price-changed`), and nothing is taken.
  - It then also requires `canTrade`. useTake itself also refuses `walletId === null` (useTake.tsx:103), a second
    defence.
  - This fixes M1 and m1. It fails safe.
- **The poster's wallet pick goes again on `rated` or `skipped`** (AcceptedSheet.tsx:207). I see no risk:
  - The deal is the server-locked one, so no price or total can move.
  - The poster already tapped Use this wallet, and the retry sends the same `picked` wallet.
  - The only thing that moves is the setup timer, and the server refuses a late pick with `wrong-state`.
  - So I agree with the lead.
- **review.spec's skip test now expects no retake and a fresh tap.** It matches the unit test "Skip review alone
  clears the gate but takes nothing". I did not run Playwright.
- **m3:** Skip review is now offered beside Try again when the trade's own view cannot be read. It calls the skip
  route directly, and a 409 counts as `gone`.
- **m2:** `gone` shows "There is nothing left to rate on this trade.", never "Rating saved", and never asks for
  feedback. It reads the trade again, and if the trade is still reviewable the card comes back.
- **m4:** a failed feedback send keeps the card, says "Your feedback could not be sent." and offers Try again. A
  400 with a hidden character in the note gets its own line. `FEEDBACK_HIDDEN` is the same regex as the API's
  `HIDDEN` (form.ts:46).
- **m6, m7 and m8:** fixed. The swapped-address alert is hidden during `rate`. The doc comments are back in place.
  `rateLabel` is COPY-UNSIGNED. The quote tests use a non-default wallet among two, and release.test covers the
  slot mounting only in `released`.

## Mutation checks, quote side (review.test, quoteScreen.test and AcceptedSheet.test together: 128 tests)

| Revert | Result |
|---|---|
| Q1 sheet branch `false ?` | 6 fail |
| Q2 the moved-quote check removed | 2 fail (both M1 tests) |
| Q3 only the total checked (rate check dropped) | 1 fails (M1, moved price) |
| Q4 only the rate checked (total check dropped) | 1 fails (M1, moved total) |
| Q5 `canTrade` guard removed | 1 fails (blocked poster); the wallet-unusable test still passes, because useTake refuses a null wallet |
| Q6 Skip retakes | 1 fails |
| Q7 `'empty'` retakes | **all pass (n1)** |
| Q8 no `startTake()` on rated | 1 fails |
| Q9 `walletId: null` | 8 fail (main's coverage) |
| A1 poster retakes on `rated` only | **all pass (n2)** |
| R1 Neutral not counted as rated | 4 fail |

## Items (all m, none blocking)

**n1 — the quote's `'empty'` branch is untested.** Quote.tsx `if (how === 'empty') return;`. Failure scenario: a
refactor drops the line. The gate then refuses with an empty pending list (a race with another tab), and the
quote loops: take, refused, sheet, empty, take again, for ever. RateFirst's own unit test proves it reports
`empty`. No test proves the quote acts on it. Add a quote test where `/v1/reviews/pending` is `[]` on a refused
take.

**n2 — the poster's retake after a skip is untested.** AcceptedSheet.tsx:207. Restricting the retake to `rated`
passes every test. Failure scenario: a later change makes the poster tap Use this wallet again after Skip review,
against the lead's chosen behaviour, and nothing goes red. Add a skip case beside review.test's AcceptedSheet gate
test.

**n3 — silent no-take when Trade is off.** Quote.tsx `if (!canTrade) { keep({ error: null }); return; }`. After a
rating, the take is quietly not made and the rate-first line is cleared. The disabled Trade button and its own
reasons are what the person sees. That is acceptable, but it is a silent outcome: note it for the copy pass. No
change asked.

**m5 is left open by the lead's call** (TODO in TradeReview.tsx).

## Tests run (nice -n 10, outside the lock)

- web: review, AcceptedSheet, quoteScreen, wallets, selection-ink, kit-contrast and release: 7 files,
  215/215 passed.
- api: reviews-gate and account: 2 files, 50/50 passed.
- `tsc -p apps/web --noEmit`: clean.
- Not run by me: the full `npm run check` (Runner G) and Playwright, including review.spec.ts.
