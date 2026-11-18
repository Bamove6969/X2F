# Review: wip/lead-review-screens @ 0eaea7ae vs main 8e7e63d5 (Plan 5 Task 6)

Reviewer: independent helper, 18 Nov 2026, 12:25 BC time (UTC-7).
Commits: 2aef27c9, c3843a85, 4e8e0e52, merge 066f0e8b, 0eaea7ae.

## Verdict: CHANGES NEEDED (0 B, 2 M, 8 m)

The API gate is sound (it is main's Task 3 code; this branch adds only `completedTrades`). I found no bypass and no
leak, and no case that traps a user for good. The merge lost nothing. Two things block approval:
- M1: the resumed take on the quote can start a trade at a total the person never saw.
- M2: the whole quote-side gate (the sheet and the resume) has no test.

## What I checked

- Bypass: the only trade-creating path is `takeRoutes` (store.ts:248 is called from take.ts only). Both
  `POST /v1/offers/:id/take` (take.ts:351, under the account locks, in the take transaction) and
  `POST /v1/trades/:code/wallet` (take.ts:484, after `select ... for update` on the account) assert the gate.
  Members are refused by `ownerDeviceOnly` on both, and the review routes answer 403 owner-only to members. A race
  where a trade turns reviewable during a take is harmless: the next take sees it. A one-time wallet is not used up
  by a refused take: the gate runs before `pickWallet`, and the transaction rolls back.
- Trap: `pendingReviews` and `pendingReviewSql` share the same predicate, so the list and the gate agree. The inner
  join on `accounts` cannot drop a row, because trader accounts are never hard-deleted (FK not null, and only
  member and owner rows are deleted). A disputed trade blocks only once it is `final`/`closed` as a sale. A reversed
  trade never blocks. Skip review is always offered, except in m3 below.
- Leak: the taker gets `review-pending` only for their own pending reviews. The poster's pending review answers
  `offer-busy` (take.ts:352). The sheet shows only the caller's own counterparty's public display name.
  `postMood` sends exactly `{ mood, note }`.
- Review content (main's API): `validateReview` takes NFC, trims, refuses line breaks and bad characters, allows
  at most 120 code points and refuses personal details. The side and the subject come from the trade row. The
  row is locked, the code checks for an existing review or skip, and unique keys back that up (23505 becomes
  `review-exists`), so a second review and a review by someone outside the trade are both refused (404 for a
  non-participant). The web's `maxLength` counts UTF-16 units, so it is stricter than the server: fine.
- Platform feedback (main's API): the row stores only mood, note and day. It is purged after 365 days, readers
  need staff `feedback.read`, and each account gets 3 sends a UTC day, counted in memory, with a silent 202 over
  the limit.
- Wallet retry: AcceptedSheet resumes with `use()`, which reads the same `picked` state. The picker is not shown
  during `rate`, so the pick cannot change. The default-first rule from main (`setPicked(p => p ?? default)`) is
  untouched. Quote resumes with `pickedWallet?.id ?? null`, the same expression main's Trade button used.
- Merge 066f0e8b: `git show --cc` shows that only the import hunk conflicted. Both sides are present
  (`ApiCallError` and `DEFAULT_TAG`/`matchesRecord`/`NEW_ADDRESS`). The swapped-address alert, `isDefault` and the
  default tag are all kept. Quote.tsx: main's take body moved into `startTake` with no change.
- Orange rule: stars and the picked mood are ink, and the chips are escrow (teal) or danger (rose). The only orange
  is the primary Submit rating. selection-ink.test and the new kit-contrast case pass.

## Items

**M1 — the resumed take uses a price the person never saw.** apps/web/src/screens/quote/Quote.tsx:535 (with
:337-347).
- Failure scenario: the person taps Trade at a total of EUR 187.50 and gets 409 review-pending. They spend more
  than 60 s rating in the sheet. `useMarket` re-quotes behind the sheet every 60 s (Quote.tsx:36, :110), and the
  new quote is EUR 191.20. On cleared, `startTake()` sends the new quote, which is within 0.5% of the server's
  rate, so the take succeeds and the trade starts at EUR 191.20 with no tap at that price.
- Main's own rule for a moved price is the opposite: "The price moved. Check the new total and tap Trade again"
  (takeErrors.ts:55), with a test that says nothing is taken until a fresh tap.
- The fix picks a behaviour, so it is an owner/lead call. Recommendation: remember the quote that was tapped, and
  resume only if `centsPerXmr` and `fiatCents` are unchanged. Otherwise close the sheet and show the price-moved
  line, so the person taps again.
- `startTake` also skips `canTrade` (m1).

**M2 — the quote-side gate is untested.** apps/web/src/screens/quote/Quote.tsx:528-538. I reverted
`{cantDo === REVIEW_PENDING_CODE ? (` to `{false ? (`, which drops the sheet. I also reverted
`if (rated) startTake();` to a no-op, which drops the resume. Both reverts passed review.test.tsx and
quoteScreen.test.tsx, 88/88. Failure scenario: a later refactor stops the sheet opening on a take, or stops the
take resuming, and CI stays green. The test needs:
- a 409 review-pending opens RateFirstSheet;
- after a rating, a second take carries the same `walletId`, using a picked non-default wallet among two wallets;
- closing without rating leaves `RATE_FIRST.inline` and takes nothing;
- a test for the M1 behaviour once it is decided.

**m1 — the resume skips `canTrade`.** Quote.tsx:337. `startTake` checks only `ok`, not `canTrade`
(`!state.busy`, `!blockedPoster`, `giftTermsOk`, `pickedWallet !== null`). Failure scenario: the wallet list
reloads while the sheet is open and the picked wallet is no longer usable. `pickedWallet` becomes null, and the
resume sends `walletId: null`. With no default, the server picks or refuses where main's button would have been
disabled. Fix: guard `if (!canTrade) return`.

**m2 — "Rating saved" can be false.** apps/web/src/screens/review/ReviewCard.tsx:61. A 409 `review-exists` or
`not-reviewable` finishes the card as `rated`, and TradeReview then shows "Rating saved. X can see it now." It can
also ask for feedback. Failure scenario: the person skipped in another tab, or a dispute was opened meanwhile.
The screen then says a rating was saved and is visible, which is untrue. Fix: report a separate outcome, for
example `'gone'`, and show nothing.

**m3 — the sheet can offer only Try again.** apps/web/src/screens/review/RateFirstSheet.tsx:62/85. If
`GET /v1/trades/:code` fails, the sheet shows only "That did not work. Try again." and hides Skip review, which
does not need the side. Failure scenario: that read keeps failing for one pending trade (a server bug, or a
session that the reviews routes accept but `readTrade` refuses). Every take then ends in a sheet with no way
forward. It is not permanent (it heals when the read heals), but nothing in the gate needs that read in order to
skip. Fix: offer Skip review when the side is unknown.

**m4 — the feedback card says sent when it was not.** apps/web/src/screens/review/FeedbackCard.tsx:42-44. A failed
send shows "Thanks. Your feedback was sent." The doc comment says the card closes. Failure scenario: the network
fails, or the note holds a hidden character and the server answers 400 `bad-request` (mood.ts parseBody). The
person is told it was sent, and it was not. Fix: close quietly on failure, as the comment says, or make
the line neutral. This is a copy call.

**m5 — the ruling screen's card never refreshes.** apps/web/src/screens/dispute/DisputeRuling.tsx:296 with
TradeReview.tsx:37. TradeReview reads `reviewable` once, on mount. Failure scenario: the person keeps the ruling
open while the appeal window closes and the dispute turns `final`. No rating card appears until a reload. The
gate's sheet still asks at the next take, so this is cosmetic.

**m6 — the swapped-address alert shows during rating.** apps/web/src/screens/AcceptedSheet.tsx:188. The
swapped-address alert shows during the `rate` phase too, stacked above "Rate your last trade to continue". Failure
scenario: a poster with a swapped wallet sees two unrelated warnings on one sheet. Fix: add `phase !== 'rate'`.

**m7 — misplaced doc comment.** apps/api/src/routes/account.ts:174-181. The new `completedTrades` was inserted
under teamHoldOf's comment ("Owner p4-8: the lead's waiting changes ..."). `completedTrades` now carries two
JSDoc blocks, and `teamHoldOf` has none. Failure scenario: misleading hover docs. Fix: move the function above that
comment.

**m8 — the tests are thinner than their names.**
- The AcceptedSheet gate test (apps/web/test/review.test.tsx:297) uses one wallet with no default. It proves the
  resume sends `w1` twice, but not that a picked non-default wallet is reused over the default.
- The Released slot (slots.tsx) has no test that TradeReview mounts only in `released`, not `settling`.
- The ReviewCard section's `aria-label={\`Rate ${counterparty}\`}` (ReviewCard.tsx:96) is a new screen-reader
  string with no COPY-UNSIGNED marker.
- Failure scenario: a regression in default-versus-picked wallet handling passes the gate test.

## Mutation proof

| Revert | Result |
|---|---|
| AcceptedSheet.tsx: `if (false && e instanceof ApiCallError && e.code === REVIEW_PENDING_CODE)` | review.test.tsx 1 failed / 40 (AcceptedSheet meets the gate) |
| RateFirstSheet.tsx: `onCleared(true)` in place of `onCleared(didRate.current)` | review.test.tsx 1 failed / 21 (empty list from the start) |
| account.ts: `completedTrades: 0` | reviews-gate.test.ts 1 failed / 50 |
| take.ts:484: wallet-pick gate removed (main's guard) | reviews-gate.test.ts 1 failed / 15 (poster wallet pick) |
| Quote.tsx: `walletId: null` | quoteScreen.test.tsx 8 failed (main's coverage) |
| Quote.tsx: sheet branch `false ?` | 88/88 passed: **not covered (M2)** |
| Quote.tsx: no resume after rating | 88/88 passed: **not covered (M2)** |
| TradeReview.tsx: feedback after any outcome | 21/21 passed (equivalent: `skipped` returns null first) |

## Tests run (nice -n 10, outside the lock per the 18 Nov rule)

- web: review, AcceptedSheet, quoteScreen, wallets, selection-ink and kit-contrast: 6 files, 138/138 passed.
- api: reviews-gate and account: 2 files, 50/50 passed.
- Not run: the full `npm run check` (the lead says it is green on the cloud runner) and Playwright
  e2e/review.spec.ts.

## Owner/lead question

- M1: after rate-first, should the take go again by itself only at an unchanged price, or always need a fresh tap?
  Recommendation: resume only when the tapped quote is unchanged; otherwise show the price-moved line.
- m4 is a copy call: what the feedback card says when a send fails.
