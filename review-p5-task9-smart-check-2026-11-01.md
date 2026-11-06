# Review: Plan 5 Task 9, smart proof check (`@x2f/proof`)

- Branch: origin/wip/third-p5-smart-check @ dee0f56 (base origin/wip/third-p5-proof-envelope @ a8d9dab, approved)
- Diff reviewed: `git diff a8d9dab..dee0f56` (2 commits: dff2564 red tests, dee0f56 implementation)
- Worktree: ~/x2f-worktrees/review-p5-task8, detached at dee0f56. Lockfile unchanged, so no `npm ci`.
- Reviewer: security-minded code review, 2026-11-01

## Verdict: APPROVED WITH MINOR

The code does what Task 9 says. The board lines, the closing line and every COPY-UNSIGNED line match
the plan word for word. The Task 7 change only exports two functions and adds doc comments. Nothing
leaks: `ProofCheck` and the card lines hold no OCR text, only the buyer's display name, the trade
total, the trade code and a number read from the image. The open points are behaviours the plan
never settled (OWNER QUESTIONS 1-3), plus a few false "not found" results and gaps in the tests.
None of them blocks the merge. Question 1 should be answered before Task 16 ships the card.

## Checks run

- `npx vitest run packages/proof`: 205/205 pass (check.test.ts has 27 tests).
- `npm run typecheck` (all workspaces): clean.
- `npm run separation-check`: ok. `npm run copy-lint`: clean.
- Mutation testing on `check.ts` (one change at a time, then restored):
  - These mutants were killed: ignoring `hidden` (4 tests fail); a UTC-only date window; matching only the first amount; `>=` changed to `>` in the readable count and in the confidence test; reading numeric dates in one order only; dropping the calendar-day check.
  - **These mutants survived (no test fails):** (a) dropping the "last year" reading of a date with no year (`check.ts:128`); (b) dropping `normalizeText` before the reference and date checks (`check.ts:84`). See N4.
- Hand probes on synthetic OCR (results quoted in the findings below).

## Task 7 change (detect.ts)

`markDates` and `codePattern` are now exported, and their doc comments say Task 9 uses them. Their
bodies are byte-for-byte the same. The package index does not re-export them. `codePattern` returns
a `/g` regex, but `matchAll` copies it, so `lastIndex` state cannot leak between callers. No change
to text normalisation or redaction. **No finding.**

## Findings

### I (important)

None.

### M (medium)

None in the code itself. The behaviour with the most impact is a product choice the plan left open,
so it is OWNER QUESTION 1 below and not an M.

### N (minor)

**N1. One pass per line misses a trade code that wraps or has spaced dashes, and the card then wrongly says the code is missing.** `check.ts:84-86`
- Failure: phone bank apps wrap a long memo onto two lines (`Memo K7M2-9QXA-` / `4FTR-8WPN`). People also type `K7M2 - 9QXA - 4FTR - 8WPN`. Both give `reference: 'not-found'`, and the seller sees "This trade's code isn't in the note" for a correct payment. The error points the safe way, but the seller may challenge a good payment.
- Fix (technical): also run the pattern on each pair of consecutive lines joined with `''` and with `' '`. Let a separator between groups be `\s*-?\s*` instead of `[ -]?` (or strip spaces around dashes first). Keep the boundary guards.

**N2. On a mismatch, `seen` is the first amount in reading order, which can be a fee or $0.00.** `check.ts:81`
- Failure: `Fee $0.00` / `Amount $400.00` gives "Shows $0.00, not $412.50". The flag is right but the number is wrong, and the seller cannot tell what was actually sent.
- Fix (technical): pick the first amount that is not zero, or the amount closest to the expected one. Add a test for it.

**N3. The "sender name" check flags names that are not the sender's.** `check.ts:94` (it reuses Task 7's `LABELS`, `detect.ts:476`)
- Failure, case 1: `To: Bob Seller` (the recipient, usually the seller) gives `name: 'visible'` and the line "Shows a sender name. Check it matches the sender in your bank."
- Failure, case 2: a lone `From:` label whose name the buyer blurred as `manual` makes the next line (`Memo K7M2-...`) count as a name, so the card again says "Shows a sender name". Both errors point the cautious way.
- Fix (technical): for the card, count only spans that follow sender labels (`from`, `sender`, `payer`, `sent by`). Drop a `'next'` line that holds the trade code or an amount. Add a test for each case.

**N4. Two behaviours have no test (the mutants that survived).** `check.test.ts`
- Add a test with a date that has no year, near New Year (`Dec 31` with `latest` = 2027-01-01), so the "last year" reading is covered.
- Add tests for the reference and the date written with Unicode dashes, full-width digits or Arabic-Indic digits (`K7M2–9QXA–4FTR–8WPN` with en dashes, `２０２６-10-16`), so the call to `normalizeText` is covered.

**N5. A date with no year is read wrongly around New Year in time zones east of UTC.** `check.ts:88`, `check.ts:128`
- Failure: `latest` = 2026-12-31T20:00Z is already 1 January 2027 in UTC+14. A screenshot that says `Jan 1` is read as 2026 or 2025 and comes out `out-of-range`.
- Fix: try `thisYear + 1` as well. The range test already throws out days in the future.
- Impact today: none, because the card shows no date line (OWNER QUESTION 2).

**N6. The amount check reads the raw OCR text, while the reference and date checks read the normalised text.** `check.ts:77` versus `check.ts:84`
- Failure: `$４１２.５０` (full-width digits) or Arabic-Indic digits give `amount: 'not-found'`, while a code written the same way does match. This points the safe way (no false match), but the rule is inconsistent.
- Fix: pass `parseAmounts` the words with `normalizeText` applied to each word's text. Task 7's `detectSensitive` already keeps amounts found in normalised text.

**N7. The signatures go slightly beyond the plan (documented, accepted).**
- `CardTrade` adds `currency` and `exponent` to the plan's `t`, so the mismatch line can format the amount. The code comments call this a technical call, which is fine.
- The closing line has tone `caution`, while the board shows it as muted text. Also a documented technical call.
- The mismatch amount is formatted en-US with the symbol in front (`€400.00`), which can differ from how the caller writes `t.total`. Task 16 should pass a `total` in the same style. Note for the lead.

**N8. Test title.** `check.test.ts`, "the day before securedAt is in range in every time zone; two days before is not"
- The test asserts that Oct 14 (two days before an Oct 16 securedAt) is **in** range. That is correct for the UTC-12 to UTC+14 window. The title should say "three days before is not".

## Things checked and found fine

- **readable:** "≥ 3 words with conf ≥ 60". Both edges are tested, and mutants at the edges die. An unreadable screenshot returns the all-not-found result, with `name` set to `hidden` when the buyer hid a name.
- **Reference:** the code is normalised through `normalizeTradeCode` and the pattern accepts O for 0 and I or L for 1, in any case, with or without dashes. A code inside a longer run of letters or digits does not match. Cyrillic look-alike letters (`К7М2…`) and OCR reading 8 as B give `not-found`, so no false "match". A bad `tradeCode` throws a RangeError.
- **Date window:** a calendar day `d` overlaps `[earliest, latest]` in some time zone from UTC-12 to UTC+14 exactly when `d − 14h ≤ latest` and `d + 36h ≥ earliest`. That is what the code checks. Days that do not exist (2026-02-30) are rejected. A numeric date is read both ways round.
- **Amount:** comma decimals, non-breaking spaces and amounts in other currencies are handled, as Task 7 approved. A bare number with decimals counts as an amount in any currency (Task 7's rule).
- **Copy:** the three board lines and the closing line are verbatim. "Shows $400.00, not $412.50", "This trade's code isn't in the note", "We couldn't read this screenshot" and the P5-A28 line carry `// COPY-UNSIGNED` and match the plan text. The test of the closing line runs every combination of check results over 53 trades and requires the line to appear exactly once, last.
- **Privacy:** no OCR text, name text or account detail reaches `ProofCheck` or the card lines. `hidden` is the only input taken from the buyer, as the plan says.

## OWNER QUESTIONS

1. **A screenshot that shows the right amount next to a wrong one.** Today the check says "right amount" (green) when *any* amount on the screenshot equals the trade amount. Probes:
   - `Requested $412.50` / `Sent $400.00`: green, "Shows $412.50, the right amount".
   - `Paid $40.00` / `Balance $412.50`: green, same line.

   A partial payment is one of the mistakes this card exists to catch. The other way (green only when *every* amount equals the trade amount) would flag good receipts that also show a fee or a balance. A middle option is a caution line such as "Shows $412.50 and $400.00. Check which one was sent" (new copy). Which should the card do?

2. **A wrong date never reaches the seller.** The check works out `date: out-of-range`, for example for a screenshot from two weeks before the trade, which is the classic reused old screenshot. But the plan gives the card no line for it, so the seller sees nothing. The implementer left this as PENDING LEAD. The spec (4.2) says the card "flags mismatches". Should the card get a caution line (for example "Dated Oct 2, before this trade started", new copy), or should the date stay hidden?

3. **An amount that is not found shows no line.** When no amount in the trade currency is read, the card says nothing about the amount (PENDING LEAD in the code). A seller may read silence as "fine". Should there be a caution line such as "Couldn't find the amount" (new copy)?

4. **A screenshot of X2F's own payment screen.** A screenshot of X2F's own "send $412.50, put K7M2-… in the note" screen passes every check: right amount, code found, date in range. The closing line and Task 16's "Screenshots can be faked" caution are the only guard. Is that enough, or should the card try to spot X2F's own screen?
