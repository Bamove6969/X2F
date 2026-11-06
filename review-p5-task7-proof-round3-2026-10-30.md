# Review round 3: Plan 5 Task 7, `@x2f/proof`

- Branch `wip/third-p5-proof-core` @ 0651429 (claude3). Red tests at d47c177. Diff base 756d44a.
- Rounds 1-2: `review-p5-task7-proof-2026-10-30.md`, `review-p5-task7-proof-round2-2026-10-30.md`.
- Reviewer: read-only helper, 2026-10-30. All line numbers are `packages/proof/src/detect.ts` at 0651429.

## Verdict: CHANGES REQUIRED

All six round-2 findings are fixed and tested, and the new country table (US UK CA DE FR NL ES IT BE) passes. I also ran PT PL SE CH AT IE MX BR AU IN NG (about 60 more formats), and none of them leak. Three Important findings remain:

- **R3-I1:** the R2-I1 fix accepts any 3 uppercase letters as a currency code. So `TEL 347.1234567` and `SMS 347.1234567` pass a note again.
- **R3-I2:** the Belgian `(0)` form `+32 (0)470 01.02.03` still leaks fully, in images and in notes.
- **R3-I3:** separators and digits are ASCII-only. A card, IBAN or phone joined by en-dashes or em-dashes leaks fully in images and notes. In notes, the same goes for non-breaking spaces, narrow non-breaking spaces, tabs and non-ASCII digits. This was already there before round 1; no earlier round tried non-ASCII characters.

Each fix is small.

## Checks run

My own detached worktree, with `npm ci`, under flock. The worktree has been removed.

- `tsc --noEmit -p packages/proof`: OK.
- `npx vitest run --project @x2f/proof`: 4 files, **111/111 passed**.
- **Red-first check:** at d47c177 the run gives **9 failed | 102 passed**. The failures are exactly R2-I1, R2-I2, R2-M1, R2-M2, R2-M3, R2-M4 and the DE, IT and BE rows of the country table. d47c177 changes only `test/detect.test.ts`.
- **Probes:** about 230 strings, run through `detectSensitive` (synthetic OCR) and `detectSensitiveText`. The R3 leaks were compared with 756d44a.
- **`cleanImage` fuzz:** 50,000 random byte changes, truncations, insertions and deletions of the 5 fixtures. Every output was checked with `assertClean` and cleaned a second time.
  - 0 exceptions other than `CleanError`, 0 outputs that failed `assertClean`, 0 outputs that changed when cleaned again.
  - Accepted 20,912, rejected 29,088. Time: 0.5 s.

## Round-2 findings: status

| # | Status | Evidence |
|---|---|---|
| R2-I1 | **Fixed for the listed strings, with a hole** (R3-I1) | `chiamami 347.1234567`, `call 02.12345678` and `call 0612.345678` are refused. `0.12345678 XMR`, `Rate 1.0234 EUR/XMR` and `0,123456 BTC` pass. |
| R2-I2 | **Fixed, with one form left** (R3-I2) | These are masked or refused: `0470/12.34.56`, `+32 470/12.34.56`, `0470 01.02.03`, `+32 470 01.02.03`, `0470 01-02-03`, `0470 01/02/03`, `+32 470 01/02/03`. `Sent 16.10.26` and `412.50 sent on 16.10.26` are kept. |
| R2-M1 | Fixed | These pass: `Waited ... 15 minutes`, `ok … 20 min`, `trade ending in 10 minutes`, `Waited...1500 ms`. `card ...1234` and `ending in 1234` are refused. |
| R2-M2 | Fixed | `text.split('')`. There are emoji tests. |
| R2-M3 | Fixed | `jane.doe@ example.com` and `jane.doe @ example.com` are masked. |
| R2-M4 | Fixed | These are masked: `44AFFq…QBEP3A`, `44AFFq...QBEP3A`, `44AFFq..QBEP3A`, 47+48 and 32/32/31 wraps, subaddress `84…`. See R3-M2 for narrower wraps. |

## Important

### R3-I1. Any 3 uppercase letters count as a currency code, so a one-dot phone passes a note again (R2-I1 hole)

- **Where:** `detect.ts:457-458` (`MARK_AFTER` and `MARK_BEFORE`: `[A-Z]{3}`), used by `longDecimalIsAmount` at `:465`.
- **Probes:** each of these returns `[]` and is published. At 0651429 they all should be `["phone"]`:
  - `TEL 347.1234567`
  - `SMS 347.1234567`
  - `MOB 347.1234567`
  - `CEL 347.1234567`
  - `347.1234567 SMS only`
  - `call 347.1234567 PLS`
  - `call 612.345678 SMS`
- **Failure scenario:** an Italian trader writes `SMS 347.1234567` or `TEL 347.1234567` in a public review note, and it is published. claude3 listed `347.1234 NOW` as a side effect, but `TEL` and `SMS` are the words most likely to sit next to a phone number.
- **Fix:** match only real codes:
  - Use an allowlist of ISO 4217 codes plus the crypto codes the app supports (XMR, BTC, …).
  - Match them without regard to case. That also fixes R3-M1 (`xmr`).
  - Add the probes above as tests that must be refused.

### R3-I2. The Belgian `(0)` form still leaks fully

- **Where:** `detect.ts:75` (`PHONE_GROUP_BEFORE`) needs whitespace or line start before the group. In `(0)470 ` the group comes after `)`, so the date `01.02.03` is kept. What is left, `+32 (0)470`, has only 6 digits, so it is neither a phone nor an account.
- **Probes:** all of these are untouched in both images and notes. They were the same at 756d44a.
  - Image `Tel +32 (0)470 01.02.03`: nothing masked.
  - Image `Tel +32(0)470 01.02.03`: nothing masked.
  - Note `call +32 (0)470 01.02.03` → `[]`.
- **Failure scenario:** a Belgian bank screenshot shows `+32 (0)470 01.02.03`, a common way to write an international number. About 6% of real numbers have last pairs that form a valid date. The whole number reaches the other party unmasked.
- **Fix:**
  - Allow `)` before the group as well: `(?:^|[\s)])`.
  - Or, simpler: do not keep a 2-digit-year date when any digit, `+` or `)` comes right before it with only one space between.
  - Add both probes as tests.

### R3-I3. Non-ASCII separators and digits are not normalised: cards, IBANs and phones leak fully

- **Where:**
  - `detect.ts:135` (`DIGIT_RUN`, `[ -]`), `:137` (`IBAN`, `[ -]`) and `:157` (`PHONE`, `[\d ().\/-]`) accept only ASCII space and `-`.
  - `\d` matches only ASCII `0-9`.
  - `detectSensitiveText` (`:482`) runs on the raw string.
- **Probes**, images (synthetic OCR). Every word listed stays unmasked:
  - `Card 4111–1111–1111–1111` (U+2013 en-dash)
  - `Card 4111—1111—1111—1111` (U+2014 em-dash)
  - `IBAN DE89–3704–0044–0532–0130–00`
  - `Tel 415–555–0134`, `Tel 06–12–34–56–78`, `Tel 415‐555‐0134` (U+2010), `Tel 415−555−0134` (U+2212)
  - Lower likelihood: `4111_1111_1111_1111`, `4111,1111,1111,1111`, `06•12•34•56•78`, `06·12·34·56·78`, `06:12:34:56:78`
- **Probes**, notes. Each returns `[]` and is published:
  - `card 4111–1111–1111–1111`
  - `iban DE89–3704–0044–0532–0130–00`
  - `card 4111 1111 1111 1111` (NBSP)
  - `iban DE89 3704 0044 0532 0130 00` (NBSP)
  - `call 06 12 34 56 78` (narrow NBSP, the French typographic space)
  - `call 06\t12\t34\t56\t78`
  - `call ０６１２３４５６７８` (full-width digits)
  - `call ٠٦١٢٣٤٥٦٧٨` (Arabic-Indic digits)
  - `call ०६१२३४५६७८` (Devanagari digits)
- **Failure scenarios:**
  - **(a)** Tesseract often reads a printed hyphen as `–` or `—`. A card or IBAN printed with hyphens then reaches the other party unmasked.
  - **(b)** A French user copies their IBAN or phone from a bank web page, which separates groups with NBSP or U+202F, and pastes it into a review note. The note is published.
  - **(c)** An Arabic-keyboard user types their number in native digits, and the note is published.
  - Note: `amounts.ts` already treats these spaces as separators (`THIN`), so the package knows about them.
- **Fix:** normalise before detection, keeping the length the same so that indexes stay valid. Do it in `moneySpans` for the classifier text, or once per line in both entry points:
  - Map `[‐-―−﹘﹣－]` to `-`.
  - Map `[  -   　\t]` to space.
  - Map every `\p{Nd}` digit to its ASCII digit. Each of these is a single UTF-16 unit, so the length does not change.
  - Decide whether to also accept `_`, `•`, `·`, `,` and `:` between digit groups as joiners. For the phone/card rules it is a cheap gain. `,` and `:` need care because of amounts and times.
  - Add the en-dash card, the NBSP IBAN and the Arabic-Indic phone as tests.

## Minor

### R3-M1. New false positives from the long-decimal rule (notes)

- **Where:** `detect.ts:457-465`.
- **Probes:** each is refused as `["phone"]`. At 756d44a all of them passed.
  - `got 0.12345678 xmr`: lowercase `xmr` is the common spelling.
  - `got 0.12345678 Monero`
  - `rate was 165.12345`
- **Fix:** match the code allowlist from R3-I1 without regard to case, and add `Monero`.
- **Kept by design:** `got 1234.5678 XMR` is refused because its whole part has 4 digits. That case is rare.

### R3-M2. Monero addresses split more than once

- **Where:** `detect.ts:164` (`MONERO`, 29 or more characters) and `:381-385` (the tail rule only follows a line that already has a Monero-class span).
- **Probes**, images:
  - An address wrapped at 24 characters a line (`44AFFq5kSiGBoZ4NMDwYtN18` / `obc8AemS33DBLWs3H7otXft3` / `XjrpDtQGv7SqSsaBYBb98uNb` / `r2VBBEt7f2wfn3RVGQBEP3A`): **all 4 lines unmasked**. The first line is under 29 characters.
  - Space-grouped in 4s (`44AF Fq5k SiGB …`): all unmasked.
  - Split by spaces into 30+30+35 on one line: only the first part is masked.
  - `44AFFq … QBEP3A` (spaces around the ellipsis): not masked.
  - `44AF…EP3A` (4…4): not masked.
- **Severity:** low. XMR addresses rarely appear in fiat proofs, which was the same reasoning as R2-M4.
- **Fix:** start a chain from a 20+ base58 token that starts with `[48]` and is followed by base58 on the next line or the next word. Allow `\s*` around `…`. A follow-up is fine.

### R3-M3. Email split around the TLD dot, and UPI IDs

- **Probes**, images:
  - `jane@example .com` → nothing masked.
  - `jane@example. com` → nothing masked.
  - `jane @example .com` → `jane` and `.com` visible.
  - `jane@example.c0m` → nothing masked.
  - `jane.doe@gmail` (truncated) → nothing masked.
- **Probes**, UPI:
  - Image `UPI jane@okaxis` → nothing masked.
  - Note `pay jane@okaxis` → `[]`.
- **Where:** `:147` (`EMAIL`) and `:152` (`SPLIT_EMAIL`) need a `.tld` with no space before it.
- **Comment on UPI:** a UPI ID (`name@bank`) is the payment address on every Indian UPI screenshot. If India is a target market, consider masking `word@word` with no TLD too, in images at least, as `account`. **OWNER CHOICE** if IN is not in scope. `UPI 9876543210@ybl` is already masked by the digit rule.

### R3-M4. A look-alike in a bracketed area code stays visible

- **Where:** `:248`. `PHONE` runs on the raw text, not on `look.text`. `DIGIT_RUN` stops at `)`.
- **Probes:**
  - Image `Tel (4l5) 555-Ol34` → `(4l5)` visible.
  - Image `Tel +49 l7l l234567` → `+49 l7l` visible.
  - The rest of each number is masked.
- **Fix:** run `PHONE` on `look.text` as well.

### R3-M5. Small false positives (notes)

- `16. 10. 2026`: a spaced Czech, Polish or German date. Refused as `phone`.
- `16.10.2026-17.10.2026`: refused as `phone`, because `NA` refuses a date followed by `-\d`. With spaces around the dash it passes.
- `contract ending in 2026`: refused as `account` (`ENDING`, `:145`). Could require a `card`, `account` or `acct` word before it, or exclude 19xx and 20xx.
- `Order 2026-10-16/02`: refused as `phone`. This came with the new `/` in `PHONE`. It is harmless.
- Also `Acc x1234`: a tail with a single `x` is not masked (`MASKED_TAIL` needs 2 or more). Only 4 digits show.

## OWNER CHOICE (kept as built, not bugs)

- **q29, whole amounts in notes:** `trade #123456` → `account`, `paid 123 456,78 EUR` → `account`.
- **q30:** English name labels only.
- Names, addresses and @handles are not refused in notes.
- UPI IDs (R3-M3), if India is not a target market.

## Clean results (no action)

- No leaks in these formats, in images (alone, beside a kept amount and date) or in notes (alone, after a date and time):
  - PT `912 345 678`, `+351 21 123 4567`
  - PL `22 123 45 67`, `(22) 123 45 67`
  - SE `070-123 45 67`, `08-12 34 56`
  - CH `079 123 45 67`, `079/123.45.67`, `+41 (0)79 123 45 67`
  - AT `0664/123 45 67`, `+43 (0)1 1234567`, `0664/12.34.567`
  - IE `(01) 234 5678`
  - MX `+52 1 55 1234 5678`, `(55) 1234-5678`
  - BR `(11) 91234-5678`, `(11)91234-5678`, `+55 (11) 9 1234-5678`
  - AU `(02) 9876 5432`, `+61 (0)412 345 678`
  - IN `98765 43210`, `+91-98765-43210`
  - NG `+234 (0) 803 123 4567`, `08031234567`
  - OCR look-alikes such as `O6 12 34 56 78`, `+44 77OO 9OO123`, `0612 3456 7B`
- These all pass as ordinary notes:
  - `paid 15.50 EUR`, `took 20 min`, `trade ending in 10 minutes`
  - `Paid 412.50 EUR on 16.10.2026 at 14:32`, `paid 1.234,56 EUR`, `paid 12 345,67 EUR`
  - `Sent 10/16/26 2:32 PM`, `between 14:00-14:30`, `14:00–14:30`
  - `took 15 - 20 minutes`, `24/7 support`, `Rated 4.8/5 after 120 trades`
  - `block 3,141,592`, `trade 17.10.26 18:00`, `on 16 okt. 2026`, `am 16. Oktober 2026`
- Card, IBAN and account forms that are masked:
  - `4111.1111.1111.1111`, `DE89.3704…`, `DE89 37O4 OO44 …`, lowercase `de89 …`
  - `CLABE 0021 8000 1234 5678 91`, `CPF 123.456.789-09`, `BSB 062-000 Acc 1234 5678`, `Routing 021000021`
