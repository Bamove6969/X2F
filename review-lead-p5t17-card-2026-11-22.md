# Review: wip/lead-p5t17-card @ 0b472450 (Plan 5 Task 17 e2e rows, and the code check's OCR misreads)

Reviewer: independent reviewer for the lead, 22 Nov 2026. One round.
Base: main 2da4f93d (merge-base; origin/main is now b7fb9969, and the branch merges onto it cleanly). The branch has 4 commits: 027a9af7, 20a792ba, 383aca49, 0b472450.
Scope: `git diff origin/main...0b472450`:
- `packages/proof/src/detect.ts`: `codePattern`, `CODE_CONFUSIONS`, and the proof tests.
- `apps/web/e2e/reputation.e2e.spec.ts`: the proof card "right amount" row and the Starter + New row.
- `apps/web/e2e/tradeFlow.ts`: the `poster` option and the hold-button scroll.
- `tools/regtest/e2e/stack.ts`: the /ocr/ pin check and the CSP check.

Worktree: `.claude/worktrees/rev-p5t17` (detached at 0b472450). Its node_modules has been deleted.

## Verdict: APPROVE WITH MINORS

The new tolerance does not let a different trade's code match in any way that matters.
- The chance that two random codes collide rises from 2^-80 to 2^-73.7, about 78 times higher. That is still negligible.
- A crafted memo gains a buyer nothing. The buyer makes the screenshot, so the buyer can always type the real code.
- The new pattern accepts everything the old one did. So nothing that used to be kept unblurred is now blurred.

The three Minors are limits the tests leave unpinned: a guard-revert of each one survives (M1 to M3). The e2e rows assert real outcomes. The `purged_*` seeding is faithful to what the purge writes. Conflicts with p4t21 are mechanical (m5).

## Collision math

The Crockford alphabet has 32 symbols. Two code characters are "compatible" when some single glyph is in both of their classes. I computed this by brute force over printable ASCII against the real `codePattern` classes. Exactly 5 unordered pairs are compatible:

| Pair | Shared glyphs |
|---|---|
| 1 / J | `1` |
| 2 / Z | `2 Z z` |
| 5 / S | `5 S s` |
| 6 / G | `6 G g` |
| 8 / B | `8 B b` |

Every other pair is disjoint. `I`, `i`, `L` and `l` read only as 1, and `)` and `]` read only as J.

**Per position.** For two independent uniform characters, P(compatible) = (32 + 2·5) / 1024 = 42/1024 ≈ 0.0410. On main it was 32/1024 = 1/32.

**Whole code (16 positions).** (42/1024)^16 = **2^-73.72 ≈ 6.4e-23**. On main it was 2^-80 ≈ 8.3e-25. The ratio is (42/32)^16 ≈ **77.6**. Even 10^6 code pairs (one buyer with 1,000 trades) give about 2^-53.8.

**Doubled 0.** This makes no extra collisions between distinct codes.
- A text that uses the doubling has 16 + d characters, with d ≤ 4 and at most one extra per group.
- A matching code is that text with d zero-class characters removed, one from each doubled run.
- Removing any one character of a run of zeros gives the same string. So two different codes can only both match by placing their removals in different zero runs.
- Both codes would also need zeros at exactly those places. That case is already inside the per-position count, since 0 is compatible only with itself.

**Separators.** Space and dash are in no class, so up to 3 of them between characters adds no overlap. The fuzz below found no backtracking blow-up: each start position needs a non-alphanumeric character before it, and each group tries at most 5 alternatives.

**Crafted memo.** No glyph is in more than 2 classes (I computed the maximum: 2, for the glyphs `1 2 5 6 8 B G S Z b g s z`).
- A 16-glyph memo therefore matches at most 2^16 = 65,536 codes, which is 2^-64 of the code space.
- Doubled-0 variants add only a small constant on top. Zero positions cover just one code character, which costs more than the variants gain.
- This gives the buyer nothing. The buyer builds the screenshot, and a memo with many lines could always list many codes, on main too.
- The only real false-positive case is an accidental mix-up: the wrong trade's screenshot sent to the right trade. That is the 2^-73.7 above.

**The adjacent-line join (N1, kept by the lead).**
- `codeCandidates` (check.ts:189) and `codeBoxes` (detect.ts:1103-1125) join each pair of adjacent lines, with no separator and with a space.
- Combined with the new tolerance, the only new matches are the per-glyph widenings above, now spanning a line wrap. The new separator rule makes the space join redundant (CODE_SEP already allows spaces), and it is harmless.
- `codeBoxes` boxes a joined match only when the match crosses the join, so blur placement is unchanged in kind.
- The doc comments say "never a line break". That is true of the regex. `checkProof` and `codeBoxes` still read a code wrapped once onto the next line, by the N1 decision.

## Other users of `codePattern`

**Buyer keep-unblurred (`markDatesAndCode`, detect.ts:800; `keepCode` :823).**
- Kept spans can now include up to 3 spaces or dashes between characters, and a `)` or `]` read for a J. Only this trade's code is ever kept.
- For a bank or account number to be kept by mistake, it would have to fit the code at all 16 positions under the 5 pairs. Most code letters have no digit look-alike, so this is negligible.
- It is also an improvement. A misread memo ("6E)7") used to fail the pattern, and the auto-blur could then cover the buyer's own memo.

**False negatives.**
- The new pattern is a superset of the old one: wider classes, a separator of `{0,3}` instead of `?`, doubled-0 alternatives added, and the same B/E boundaries.
- A fuzz of 60,000 random codes compared old and new on mutated texts (case, O/I/L, random look-alikes, separators, line breaks, prefixes and suffixes). Old matched 2,143 times and new matched every one of them: **0 regressions**. New matched 1,196 more.
- So a code that used to be kept is never blurred now.

**Amount and name checks.** `amountKept`/`showsWholeAmount` and `senderNameShown`/`residue` blank the code span. They blank only this trade's code, so a wider match can only stop the code's own digits being read as an amount or a name.

## Findings

**M1 (Minor) — the 3-separator limit is not pinned.** detect.test.ts:1106. Widening `CODE_SEP` to `{0,4}` passes all 200 tests (table row 11).
- Fix: add a test that `'4VC0 -- 9AXP-E7EV-6EJ7'` (4 separators) is not a match.

**M2 (Minor) — "only a 0 may double" is not pinned.** detect.test.ts:1092-1099. Dropping the `c !== '0'` guard, so any character may double, passes everything (row 6). The `'4VC0X'` case cannot catch it, because X is not a repeat of a code character.
- Fix: add a test that `'4VVC0-9AXP-E7EV-6EJ7'` is not a match.

**M3 (Minor) — a separator inside the doubled 0 is not pinned.** detect.ts:321 builds the pair as `${k}${k}`, with no separator between the two glyphs. Allowing `${k}${CODE_SEP}${k}` passes everything (row 14).
- Fix: pin whichever is intended, for example that `'4VC0 O-9AXP-E7EV-6EJ7'` is not a match.

**m4 — the e2e rows do not assert wallet amounts.** reputation.e2e.spec.ts:146-150 and :250-254 release the trade and assert `untilState(... ['released'])` and RELEASED in the UI. They do not check what the buyer received: `fund(o)`'s return value is ignored, and `receivedIn` is not called.
- This is not the subject of either row, and trade.e2e.spec.ts:87-101 already pins the amounts.
- Optional fix: `expect(await fund(o)).toBe(AMOUNT)`, which costs nothing.

The other outcomes are real:
- the API's `fiatCents`;
- the card text and tone, and the CSP on /ocr/;
- the hold button disabled, with the trade still `paid` in the API;
- the review rows in SQL;
- the stage and badges from `/v1/offers` and `/v1/account/badges`;
- the 400 `new-is-fixed` response.

**m5 — merge conflicts with wip/lead-p4t21-dispute-e2e** (`git merge-tree`). Both are keep-both:
- **tradeFlow.ts, `openTrade` options and the poster lines.** Take the union `{ buyerPage, beforeAccept, poster?, xmr?, maxUsd? }`. Then: `const poster = o.poster ?? await signUp(...)` and `if (!o.poster) await poster.api.ok('POST', '/v1/offers', offer(side, o.maxUsd))`.
- **stack.ts:395.** Keep both the /ocr/ pin check and the `if (o.staff) staffPrep = await prepareStaff(...)` line.

Apart from that, stack.ts stays self-contained:
- the imports it uses (`createHash`, `readdirSync`) already exist;
- the CSP check after the API starts merged without conflict;
- the check reads `tools/ocr-assets.sha256` itself rather than importing the ESM-only copier, as its comment explains.

**Note (behaviour the seller sees; the lead's call, not blocking).** The card prints the canonical code ("Note says 4VC0-9AXP-E7EV-6EJ7, this trade's code"), not what the OCR read.
- With this change, a memo the buyer typed with 8 for B, 5 for S or ) for J is also reported as the exact code.
- That was already true for O/0 and I/L/1, and the closing line still tells the seller to look in the bank.
- Recommendation: log the widened look-alike set in the owner decisions log, because the plan's Task 9 rule named only O/0 and I/L/1.

**Seeding (`purged_completed` / `purged_sales`, reputation.e2e.spec.ts:228-233).** This is faithful to the purge model.
- These are exactly the columns `tradePurge.ts:251` adds for undisputed released trades: completed and sales go up, won and lost stay 0.
- The readers (`COMPLETED_TRADES_SQL` for the stage, `FINAL_SALES_SQL` for the shown count) add them back.
- The 31-day age is consistent with 19 trades purged 30 days after they closed.
- The fresh account has no row, so the upsert is a plain insert, and the add-only trigger is not involved.
- It does not seed `own_usd_cents`, `own_xmr_atomic` or `fast_payments`, which real trades would have added at completion. No assertion depends on them.
- The 20th trade is real, and graduation is read through the API.

## Guard-reverts (mutations of detect.ts; detect, check and codeBoxes tests, 200 tests)

| # | Mutation | Result |
|---|---|---|
| 1 | J drops `)` | 3 failed (caught) |
| 2 | J drops `]` | 2 failed (caught) |
| 3 | J drops `1` | 2 failed (caught) |
| 4 | no doubled 0 at all | 3 failed (caught) |
| 5 | doubled 0 may repeat 1 to 3 times | 1 failed (caught) |
| 6 | any character may double | **0 failed (survives, M2)** |
| 7 | 8 no longer reads B | 2 failed (caught) |
| 8 | G no longer reads 6 | 1 failed (caught) |
| 9 | S no longer reads 5 | 1 failed (caught) |
| 10 | Z no longer reads 2 | 2 failed (caught) |
| 11 | separator `{0,4}` | **0 failed (survives, M1)** |
| 12 | separator `{0,2}` | 1 failed (caught) |
| 13 | separator allows `\s` (line break) | 1 failed (caught) |
| 14 | separator inside the doubled 0 | **0 failed (survives, M3)** |
| 15 | no B/E boundaries (inside a longer run) | 2 failed (caught) |
| 16 | 0 stops reading O | 4 failed (caught) |

Group order is pinned directly (detect.test.ts, "groups out of order"). I restored the file after every mutation, and `git status` was clean afterwards.

## Tests run (nice -n 10, outside the lock, per the brief)

| Suite | Files | Tests | Result |
|---|---|---|---|
| `@x2f/proof`, whole project | 14 | 391 | all passed |
| `@x2f/web` proof files: chatProof, chatProofReceive, chatProofSend, proof-render-tripwire, proofPrompts, proofStackSeams, proofThumb, proofUpload, smartProofCard | 9 | 174 | all passed |
| `@x2f/web` blurEditor, chatNotice | 2 | 33 | all passed |
| `tsc -p packages/proof --noEmit` | | | OK |

My own probes:
- collision pairs, by brute force;
- the old-versus-new fuzz (60,000 cases, 0 regressions);
- a timing check on adversarial strings of zeros and separators (under 10 ms each).

Not run:
- the regtest e2e (the builder reports 35/35);
- the full `npm run check` (out of scope per the brief).
