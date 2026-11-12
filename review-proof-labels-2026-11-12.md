# Review: `wip/lead-proof-labels` 360960b3 (P-014 Russian and Turkish name and number labels), 12 Nov 2026

Independent reviewer. No code edits. Detached worktree from origin (`rvx-proof`, fresh `npm ci`), removed afterwards. dockerd was not restarted.
Commits on main 6ebed537: 5f0c7d7c (RED), 360960b3 (READY). Changed files: `nameLabels.ts`, `numberLabels.ts`, `detect.ts` (the dotless-ı class and `№` in the number tail), and three test files.

## Verdict: APPROVE. 0 Must-fix, 0 Should-fix, 2 Minor (coverage gaps that over- or under-blur, never a false clear), 1 Info on pre-existing performance.

## Tests
- packages/proof, whole project as asked: 11 files, 356/356 passed.
- Semgrep on the 6 changed files: 0 findings.
- Ad-hoc probes with `tsx` against `detectSensitiveText` from scratch scripts outside the repo: correctness probes and hostile-input timing, comparing this branch with main 6ebed537.

## The checks

### No false clears: holds by construction
The only ways a label match changes the outcome both add blur or a refusal:
- **Name labels** (`nameStart`) mark the rest of the line, or the next line when the label stands alone, as a `name` span.
- **Number labels** (`labelledNumbers`) mark the number after the label with the label's kind. They also *take a number out of* the amount exemption in `amountKept`: `isPersonal` wins over "equal to the trade amount" (owner F15).

Nothing on this branch touches what is kept clear: `AMOUNT_LABEL` (which already had `tutar`, `сумма`, `сума`), dates or the trade code. So no new label can unblur anything.

Additional points:
- The `[ıi]` rewrite applies only inside `alternation()`, which builds the name and number label regexes, never `AMOUNT_LABEL`.
- No existing label contained `ı`, so other languages are unaffected.
- `foldAccents` keeps one UTF-16 unit per character, so match positions still line up with the text. It folds `ё`→`е`, `й`→`и`, `İ`→`I`, and the Turkish `ş ğ ç ö ü`.
- Under `/iu`, `ı` does not case-fold to `I`/`i`, so the explicit class is needed. `ALICI`, `Alici`, `ISIM` and `İSİM` all match (tested, and probed).

### Colon-only words: right
- `от` (ru, "from") and `ad` (tr, "name") are in `colonOnly`, so they count only with a following colon: `LABEL_START`'s colon branch, or `LABEL_COLON` with a lookbehind for a word boundary.
- Tested: "От души спасибо" and "Ad blokesi yok" stay clear, while "От: …" and "Ad: …" mask the name.
- "Получателям спасибо" and "Adres doğrulandı" stay clear, thanks to the lookahead and lookbehind on letters and digits.
- The multi-word labels `от кого` and `ad soyad` / `adı soyadı` count without a colon at the start of a line, which is right for receipts.
- `кому` and `kime` ("to whom") also count without a colon at the start of a line. A sentence starting with them in a proof would be over-blurred, which is the safe direction.

### Catastrophic backtracking: none from this change; one pre-existing quadratic (Info)
- The new pieces are fixed literals, `\s+` between words, the one-character class `[ıi]`, and `№` as one more alternative in `NUMBER_TAIL`. There are no nested quantifiers.
- `NUMBER_TAIL`'s `\s* … \s*[:：#]?\s*` overlap is unchanged and at worst polynomial.
- Probes at up to 100 000 characters stayed near linear, at most 210 ms:
  - `тел` and `тел. №` followed by whitespace runs;
  - `владелец `, `hesap `, `от `+`:`, `тел 1 ` repeated;
  - whitespace around `alıcı adı`;
  - `№` repeated.
- **i1 (pre-existing, not from this branch):** one long run of letters with no spaces is quadratic in `detectSensitiveText`, on main and on the branch alike.
  - Timings for a 18 000-character word: `'abc'×6000` took about 0.7 s on both; `'alı'×6000` took 5.4 s on main and 6.1 s on the branch; `'ыab'×6000` took 7.0 s on main and 6.3 s on the branch. Non-ASCII runs are about 8 times slower, and that holds on main too.
  - The server path is safe: review notes are capped at 120 characters (`REVIEW_NOTE_MAX`) before detection runs.
  - Proof OCR detection runs in the uploader's own browser on their own image, so the worst case is self-inflicted slowness.
  - Worth a line-length cap in `normalize` some day. Not blocking.

## Findings
- **m1 (under-blur, coverage):** the Russian inflected forms "Номер телефона" and a bare "телефона" are not labels. Probe: "Номер телефона: 1234" gives no labelled number.
  - Longer numbers are still caught by the generic rules (6 or more digits). A short or masked one after this label is not.
  - Suggest adding `номер телефона` and `телефона`, and perhaps `счета`, `карты` and `номер`+`№`.
- **m2 (over-blur, info):** `cep` (Turkish "mobile") is also Brazil's postcode label "CEP". "CEP 01310-100" is now labelled `phone` and blurred. Postcodes were already blurred as address parts, so this changes only the reported kind (and the review-note refusal kind). Acceptable.
- Not checked: the image path (`detectSensitive` with OCR boxes) was not probed by hand beyond the branch's own tests, which do exercise it (`masked(ocr(...))`).
