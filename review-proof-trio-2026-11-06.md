# RV4: proof trio review (claude3: proof core, envelope, smart check), 2026-11-06

Reviewer: read-only helper. Main line ref: origin/claude/compassionate-johnson-k95ssr @a779ef9 (= main e7636c7 + a settings-only chore).

## Verdicts

| Branch | Head | Verdict |
|---|---|---|
| `wip/third-p5-proof-core` (R5 / C5) | 4d39fc76 | **CHANGES REQUIRED**: 1 Important (I1), 4 Minor |
| `wip/third-p5-proof-envelope` (R6 / C7) | e49c62a1 | **APPROVED** for the merges. It carries core's I1, so re-merge core once I1 is fixed, then land it. |
| `wip/third-p5-smart-check` (R7 / C8) | 1e54d3f5 | **APPROVED WITH MINOR** for the merges. It carries core's I1 (re-merge after the fix). It also has one cross-task Minor (M4). |

Scope of the core review: `git diff b5e85cf 4d39fc7`. That diff is the C5 round-5 approval (d3f62b4, `review-p5-task7-proof-round5-2026-10-30.md`, plus main 3635fac at b5e85cf) followed by 31b80bc2 and 4d39fc7.
- Two main-line merges: 2a6148e0 (b6835ee) and c4c413b7 (e7636c7). `git show --remerge-diff` of both is empty: no conflicts and no hand edits.
- Against main e7636c7, the branch touches only `packages/proof/**`, `docs/coordination.md` and the lockfile entry for `@x2f/proof`.
- The proof changes are: the safety-net and UPI notes, the item 37 tests, item 29 `GROUPED` for notes, item 30 `nameLabels.ts`, the "amount never auto-blurred" rule (`amountKept`, `amountBoxes`, `padAndMerge(..., keepClear)`), the Q15 test and Q17 `standsAlone`.

## Merge checks (envelope and smart check)

- **Merges only.** Each branch's first-parent history above its approved head is exactly 2 merges:
  - Envelope: a8d9dab (approved R2-N1 head), then 7ef1916f (core 31b80bc2), then e49c62a1 (core 4d39fc7).
  - Smart check: d85f859 (approved fix-round head), then 85a5a97b (core 31b80bc2), then 1e54d3f5 (core 4d39fc7).
  - No other commits were added.
- **Remerge diffs.** 7ef1916f and 85a5a97b each have one conflict, in `docs/coordination.md`. It was resolved by keeping both the Task 8/9 notes and main's Plan 2 Task 18 section. The conflict markers are gone and nothing was dropped (one blank line moved). e49c62a1 and 1e54d3f5 have no conflicts and no hand edits.
- **Nothing dropped or duplicated.** I compared `git diff b5e85cf <approved head>` with `git diff 4d39fc7 <tip>`:
  - Envelope: 7 files, +818/-2 in both.
  - Smart check: 10 files, +1435/-5 in both.
  - The two diffs are textually identical except for hunk line offsets and index hashes. So each tip = core 4d39fc7 + that branch's own approved delta.
  - No duplicated exports. `index.ts` keeps core's `Box` / `amountBoxes` plus the branch's additions.
- **Semantic clashes.** tsc is clean on all three tips.
  - `Region extends Box` is compatible with `payloads.ts`, `seal.ts` and `check.ts`. `HiddenKind` is unchanged, so `parseProofPayload`'s `hidden` subset check still holds.
  - `check.ts` uses `markDates`, `codePattern` and `normalizeText`, all unchanged.
  - One behavioural gap between core's new amount rules and Task 9's amount reader: M4.

## Checks run

All runs were in my own detached worktree `~/x2f-worktrees/rv-proof` (now removed, nothing committed), each under `flock ~/x2f-comms/check.lock`, one at a time, after `free -m`.

| Tip | Step | Result |
|---|---|---|
| 1e54d3f5 smart | `npm ci` (pinned npm 11.21.0) | ok, 297 packages |
| 1e54d3f5 smart | `tsc --noEmit -p packages/proof` | 0 errors |
| 1e54d3f5 smart | `vitest run --project @x2f/proof` | 8 files, **244/244** passed (plus my 2 probe files, run separately) |
| e49c62a1 envelope | (same lockfile as smart, no `npm ci`) `tsc -p packages/proof`, `tsc -p packages/protocol` | 0 / 0 errors |
| e49c62a1 envelope | `vitest run --project @x2f/proof` | 6 files, **206/206** passed |
| 4d39fc76 core | `npm ci` (lockfile differs) | ok |
| 4d39fc76 core | `tsc --noEmit -p packages/proof` | 0 errors |
| 4d39fc76 core | `vitest run --project @x2f/proof` + probe file | **178/178** of the branch's tests passed. The probe "test" fails on purpose to print its results. |
| all | `git show --remerge-diff` of 6 merges; delta comparison against the approved heads | as above |

- The counts match claude3's reports (178 / 206 / 244).
- Probe file (not committed): `~/x2f-comms/review-proof-trio-2026-11-06-probe.test.ts.txt`.
- Not run: copy-lint (no copy changed), the full suite, Playwright (no app code imports `@x2f/proof`).

## Important

### I1. A card or phone number with spaced dashes is left visible when one of its groups equals the trade amount (owner Q17, `standsAlone`)

- **Where:** `packages/proof/src/detect.ts:621-631` (`JOINED_BEFORE` / `JOINED_AFTER` / `standsAlone`), used by `amountKept` at `:635`.
- **Cause:** a bare number "stands alone" unless the character just before it is a digit, or a digit plus one joining character. The spaced-dash form `4111 - 1111` has the digit, a space, `-` and a space before the group, so it does not count as joined. Owner item 37 says this form is *definitely* caught, and the detector catches it.
- **What goes wrong:** the group is marked kept (the amount). The kept characters then split the dash-joined run, so what is left is no longer long enough to be a 15/16-digit number or a phone. **The other groups lose their mask too.**
- **Probes (images, synthetic OCR, at 4d39fc7):**

  | OCR line | Trade amount | Masked |
  |---|---|---|
  | `Card 4111 - 1111 - 1111 - 1111` | 412.50 (default) | all 7 words (phone) |
  | `Card 4111 - 1111 - 1111 - 1111` | 1111.00 | **nothing** |
  | `Card 4000 - 1234 - 5678 - 1000` | 1000.00 | first three groups; `1000` shown |
  | `Tel 555 - 201 - 3344` | 412.50 (default) | all |
  | `Tel 555 - 201 - 3344` | 3344.00 or 201.00 | **nothing** |
  | `IBAN DE89 – 3704 – 0044 …` | 3704.00 | `DE89 –` and `3704` shown |

  The ASCII form `4111-1111-1111-1111` stays masked as `card` because it is joined.
- **Failure scenario:** a buyer pays 1,000 (a round amount, which is common). The screenshot shows their own phone `+1 415 – 555 – 1000`, or a card written with spaced dashes. The automatic blur leaves the group visible, and in the repeated-group case the whole number. This breaks the package's fail-safe rule ("one misread digit must not leave a real card visible") for the separator form the owner named. The uploader's preview is a safety net, but the detector should not create the hole.
- **Fix:** before and after the number, also treat these as joined: a digit followed by optional spaces, one non-letter joining character and optional spaces, for example `JOINED_BEFORE = /(?:\p{N}\s?[^\p{L}\p{N}\s]?\s?|[#+])$/u`, and the mirror image for `JOINED_AFTER`. Add red tests built from the rows above, including `–` and `—`.
- **Wider guard (recommended):** run detection first without the Q17 bare-number keep. Then un-keep a bare amount when it lies inside a span detected as card, phone, IBAN or account. That way the keep can never break a run.

## Minor

### M1. `padAndMerge` keeps the amount clear only when the caller passes `amountBoxes`; the default `[]` silently breaks the owner rule, and Task 15's duty is not recorded

- **Where:** `packages/proof/src/redact.ts:57` (`keepClear: readonly Box[] = []`). `docs/coordination.md`, section "Plan 5 Task 7, owner answers 2026-11-02".
- **Failure scenario:** Task 15 keeps the old call `padAndMerge(regions, w, h)`. The 4 px padding, and the merge of a name line with an email line, then cover the amount. The branch's own test "Without the amount box the union swallows it" shows this happening.
- **Gap in the notes:** the coordination notes cover the safety net, UPI, separators, item 29 and item 30. They say nothing about:
  - the amount rule (31b80bc2);
  - Q17;
  - Task 15 having to pass `amountBoxes(words, keep)`;
  - the owner's own-blur warning ("The amount is hidden, so the seller may not be able to check your payment.", COPY-UNSIGNED).
- **Fix:** add a "Task 15 owes" bullet for all of these. Better still, make `keepClear` a required parameter, or add a `NEEDS_TASK_15_KEEP_CLEAR` tripwire.

### M2. The extra-width rule (review M8) is now dropped next to every kept character, not only the amount

- **Where:** `detect.ts:781-783`. `k[c-1]` / `k[d]` is true for dates and the trade code as well.
- **Effect:** for a detail glued to a date or the code in one OCR word, the region no longer reaches one average character width toward the kept part. Only the later 4 px padding remains (`keepClear` holds only the amount). In a proportional font, the last glyph of the detail can show next to the date or code.
- **Severity:** rare (it needs an OCR word that joins a detail to a date or code).
- **Fix:** test against an amount-only mask, i.e. keep the M8 width unless the neighbouring character is part of the amount.

### M3. Name labels: two gaps in the item 30 data (best effort)

- **(a) Decomposed accents miss.** `detect.ts:493` `foldAccents` folds only precomposed letters. `Empfänger: Max Mustermann` (NFD) masks nothing, while the NFC form masks the name. Most OCR outputs NFC, so this is low risk. Fix: apply NFC per line before folding, keeping the index map, or delete `\p{M}` with the map, as `normalize` already does for digits.
- **(b) `para` over-masks, and the colon-only rule is applied unevenly.** `para` (`nameLabels.ts:25`, `:45`) is a full label, but it is the commonest Spanish/Portuguese preposition. `Para su seguridad no comparta …` masks the whole line as `name`. This is fail-safe, but it hides receipt text the seller may want, and it is the same case `de` / `a` were made colon-only for. Fix: move `para` to `colonOnly`. `nombre`, `nom` and `naam` are similar, but they are real labels; keep them.

### M4 (smart check, cross-task). Task 7 now keeps a bare or label-only amount clear, but Task 9's `parseAmounts` never reads one as the amount

- **Where:** `packages/proof/src/amounts.ts:190` (at 1e54d3f5). An amount with no marker counts only with decimals.
- **Probe:** `checkProof(ocr('Total 250000', 'Ref K7M2-9QXA-4FTR-8WPN', 'Oct 16, 2026'), {fiatCents: 25000000n, …})` gives `amount: not-found`. The detector keeps `250000` clear on purpose (owner 2026-11-02 amount label, and Q17).
- **Failure scenario:** the seller's card has no "Shows …, the right amount" line. Once item 64 is built, the poster also gets the "unable to detect the amount" pop-up, even though the amount is plainly on the screen.
- **Fix:** for the expected currency, let `parseAmounts` / `checkProof` treat a whole number equal to `fiatCents` as a match when it follows an amount label, or stands alone as in Task 7. Reuse `AMOUNT_LABEL` / `standsAlone` rather than a second rule.
- **Nit in the same file:** the comment `check.ts:127` says the sender labels have "Same shapes as Task 7's name labels". Task 7's labels are now multilingual data and `SENDER` (`:129`) is English only. In practice a foreign sender name is auto-blurred anyway, so this is a comment fix (or note that Task 9's sender labels stay English on purpose).

## Verified, no finding

- **The merge-joint rule** (`redact.ts:77`) refuses an automatic-only union that would newly cover the amount. It allows growth only when one side already touches the amount, which needs a manual region (owner 18b: "manual blur growing slightly when merged = OK"). `cut` never removes an automatic pixel outside `keepClear`. The loop terminates.
- **`GROUPED`** (notes, `detect.ts:857`): bounded on both sides, so it cannot lift a 9-digit slice out of a longer number. `411 111 111 111 111`, `4111 1111 1111 1111`, `+34 612 345 678` and `0612 345 678` are still refused.
- **Q15:** the apostrophe behaves exactly like a comma in notes and in images. This is test only, and correct.
- **UPI:** one flag. Images give `account`, notes refuse. Chat is untouched (owner 07:10 clarification).
- **Item 37:** the dashed 15/16-digit and `+`-led tests are meaningful (but see I1 for when the amount coincides with a group).

## Open questions (owner/lead calls; my recommendation)

1. **Q17 also unmasks short "last 4" numbers when they equal the amount.** `Visa ending 1234`, `Card **** 1234` and `Card ...1234` are left clear when the amount is 1234.00 (before Q17 they were masked as `account`, round-1 M1). Rec: accept. It is only the last 4 digits, and the owner's reasoning ("most likely another spot where the amount is shown") applies.
2. **Item 29 in notes, wider than ES/PT phones.** The bare 9-digit 3-3-3 class also lets through PL (`512 345 678`) and CZ (`601 123 456`) mobile phones, and a labelled account `acct 123 456 789`. The owner said "not too stringent" (Q13/Q14/Q16, as built). Rec: tell the lead the class covers PL/CZ phones and grouped 9-digit accounts too. Keep as built unless the owner objects.
3. **Q22 (pending): comma/apostrophe-separated card-length numbers.** `card 4,111,111,111,111,111` passes in notes and is not blurred on images. This predates the diff. Rec: as claude3 asked, blur on images; notes as the owner decides.

## Counts

Important 1 (core I1, inherited by envelope and smart check until re-merged). Minor 4 (M1-M3 core, M4 smart check), plus 1 nit inside M4. Open questions 3.
