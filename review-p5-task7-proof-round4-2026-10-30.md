# Review round 4: Plan 5 Task 7, `@x2f/proof`

- Branch `wip/third-p5-proof-core` @ 6583b78 (claude3). Red tests at 89d3807. Diff base 0651429.
- Rounds 1-3: `review-p5-task7-proof-2026-10-30.md`, `-round2-`, `-round3-`.
- Reviewer: read-only helper, 2026-10-30. Line numbers are `packages/proof/src/detect.ts` at 6583b78.
- In the probe strings below, `\uXXXX` stands for that one character (the strings are written in JS escape form so the invisible ones can be seen).

## Verdict: CHANGES REQUIRED

All round-3 findings are fixed and tested (R3-I1, R3-I2, R3-I3 as listed, R3-M1 to R3-M5, and the UPI flag). `normalizeText` keeps the length in UTF-16 units: I checked every code point and 20,000 random strings that included lone surrogates. It maps every `\p{Nd}` digit to the right value: all 770 digits match Python's `unicodedata`. It runs before every detector in both entry points, and regions land on the original words, including with emoji and astral digits before and inside a word.

The R3-I3 class is still not closed, though. Two kinds of character still break numbers apart in notes, and each one lets a card, IBAN or phone through completely:

- **R4-I1:** invisible format characters (`\p{Cf}`), such as zero-width spaces, soft hyphens and the LRM/RLM direction marks.
- **R4-I2:** the dash list is a hand-picked range, not `\p{Pd}`, and it leaves out the Japanese long-vowel mark `ー`, which Japanese users type as a hyphen in phone numbers.

The rest are Minor findings.

## Checks run

My own detached worktree, with `npm ci`, under flock. The worktree has been removed.

- `tsc --noEmit -p packages/proof`: OK.
- `npx vitest run --project @x2f/proof`: 4 files, **135/135 passed**.
- **Red-first check:** at 89d3807 the run gives **14 failed | 121 passed**. The 14 are exactly:
  - the BE, MX, Unicode-separator and look-alike rows of the format table;
  - the 2 R3-I3 dash and notes tests, and the astral-digit test;
  - R3-I1, R3-I2, R3-M2, the 2 R3-M3 tests (UPI and its flag), R3-M4 and R3-M5.
  - 89d3807 changes only `test/detect.test.ts`. The fix commit adds 2 assertions: `BE68-5390-0754-7034` gives `iban`, and the own trade code gives `[]`.
- **`normalizeText`:**
  - Every code point from U+0000 to U+10FFFF, and 20,000 random 20-unit strings (20% lone surrogates): the length never changes.
  - All 770 `\p{Nd}` digits map to the right value. The 90 digits that Python 15.1 does not know are newer and could not be checked.
- **Probes:** about 250 strings through `detectSensitive` (synthetic OCR) and `detectSensitiveText`.
- **`cleanImage` fuzz:** 50,000 random byte changes, truncations, insertions and deletions of the 5 fixtures.
  - 0 exceptions other than `CleanError`, 0 outputs that failed `assertClean`, 0 outputs that changed when cleaned a second time.
  - Accepted 19,514, rejected 30,486, in 0.6 s.

## Round-3 findings: status

| # | Status | Evidence |
|---|---|---|
| R3-I1 | Fixed | These are refused as `phone`: `TEL`, `SMS`, `MOB` and `CEL 347.1234567`, `347.1234567 SMS only`, `call 347.1234567 PLS`, `call 612.345678 SMS`, `tel: 347.1234567`, `WhatsApp 347.1234567`, `612.345678 Euro`. These pass: `347.1234567 EUR`, `usd`, `xmr`, `$347.1234567`. Residue: see R4-M5. |
| R3-I2 | Fixed | Image `Tel +32 (0)470 01.02.03`, `Tel +32(0)470 01.02.03` and `Tel +32 (0) 470 01.02.03`: every word is masked. In notes, `call +32 (0)470 01.02.03` and `+32 (0)470/01.02.03` are refused. `Paid 412.50 16.10.26` and `Sent (1) 16.10.26` pass. |
| R3-I3 | **Fixed as listed, class still open** (R4-I1, R4-I2, R4-M1, R4-M2) | All of these are refused: the en-dash card, NBSP card and IBAN, U+202F, tab and U+3000 phones, Arabic-Indic, Persian, Thai and full-width digits, and the astral math digits. The image `😀 Tel 06–12–34–56–78 jane@x.io` masks exactly the phone and the email words. Inside a word, `K7M2-9QXA-4FTR-8WPN😀😀4111111111111111` puts the region at x0=220, after the emoji, on UTF-16 columns. The trade code with en-dashes passes in notes. |
| R3-M1 | Fixed (2 of 3) | `got 0.12345678 xmr` and `got 0.12345678 Monero`/`monero` pass. `rate was 165.12345` is still refused. claude3 left it out on purpose, and it is fail-safe. |
| R3-M2 | **Partly fixed** (R4-M4) | Masked now: the 24-character 4-line wrap, the 30+30+35 word split, and `44AFFq … QBEP3A`. Still unmasked: 4-character groups, `44AF…EP3A`, and wraps narrower than 20 characters. |
| R3-M3 | Fixed | Masked: `jane@example .com`, `jane@example. com`, `jane @example .com` (all 3 words), `jane@example.c0m`, `jane.doe@gmail` (as account) and `UPI jane@okaxis`. `pay jane@okaxis` is refused. The flag is honoured: with `{upiIds:false}` the same note gives `[]`. |
| R3-M4 | Fixed | `(4l5)` and `+49 l7l` are masked. |
| R3-M5 | Fixed | These pass: `16. 10. 2026`, `16.10.2026-17.10.2026` (also with ` - `, `–` and `/`), `contract ending in 2026`. `Acc x1234` is refused. See R4-M5 for the 2-digit-year range. |
| UPI flag | Done | `UPI_IDS = true` with `// PENDING OWNER (owner item 34)`. `DetectOptions.upiIds` exists, and both states are tested. |

## Important

### R4-I1. Invisible format characters inside a number are not normalised, and the number leaks fully in notes

- **Where:** `detect.ts:63` (`SPACE`) and `normalizeText`. Characters in `\p{Cf}` pass through unchanged, except U+FEFF. That includes U+200B ZWSP, U+200C, U+200D, U+2060 word joiner, U+00AD soft hyphen, U+200E/U+200F LRM/RLM and U+2066-2069 isolates. U+2028 and U+0085 also pass through, because notes split only on `\r` and `\n`. `DIGIT_RUN`, `PHONE` and `IBAN` all stop at these characters, so every group falls under the digit thresholds.
- **Probes, notes.** Each returns `[]` and is published. Each looks exactly like a plain number on screen.
  - `card 4111​1111​1111​1111`
  - `card 4111‌1111‌1111‌1111`
  - `card 4111‍1111‍1111‍1111`
  - `card 4111⁠1111⁠1111⁠1111`
  - `card 4111­1111­1111­1111`
  - `card 4111‎ 1111‎ 1111‎ 1111`: LRM before each space
  - `card 4​1​1​1​1​1​1​1​1​1​1​1​1​1​1​1`
  - `card 4111 1111 1111 1111`
  - `card 4111\u00851111\u00851111\u00851111`
  - `iban DE89​3704​0044​0532​0130​00`
  - `call 06​12​34​56​78`
  - `call 061​234​5678`
  - `call +972‎50‎123‎4567`
  - `jane​@example.com`
  - The 95-character Monero address with U+200B at the 3 wrap points
- **Images:** `Tel 06​12​34​56​78` and `Card 4111­1111­1111­1111` mask nothing. This is low there, because OCR engines rarely output these characters.
- **Failure scenarios:**
  - **(a)** A Hebrew or Arabic user copies their number from an RTL app or web page. Those insert LRM/RLM or isolate marks around digit groups. The note is published.
  - **(b)** A user copies an IBAN from a PDF or Word statement with soft hyphens, or from a web page that puts `&#8203;` into long numbers so they can wrap. The note is published.
  - **(c)** Anyone can get round the check on purpose with one invisible character.
- **Fix:** this is the same class as R3-I3. There are two ways:
  - **Preferred:** normalise by *deleting* `\p{Cf}`, combining marks after a digit (R4-M2) and line separators. Keep an index map from each normalised position to its original position, and convert span ends through the map. This also allows full NFKC, which handles R4-M1 and `⑩`.
  - **Smaller step:** map each `\p{Cf}` unit, plus U+2028, U+2029 and U+0085, to `' '`. The separator rules then join the digit groups, and the length stays the same. Two side effects follow:
    - `jane​@example.com` becomes the split form, which in notes is caught only by the UPI rule.
    - The ZWSP-joined Monero address needs `moneroChains` to accept a 1-space gap, which it already does.
  - Add the LRM card, the soft-hyphen IBAN and the ZWSP phone as tests.

### R4-I2. The dash list is not `\p{Pd}`, and it misses the Japanese long-vowel mark used as a hyphen

- **Where:** `detect.ts:62`: `HYPHEN = /[‐-―−﹘﹣]/`. U+FF0D is handled separately, through the full-width range.
- **Missing `\p{Pd}` characters:** U+058A, U+05BE (Hebrew maqaf), U+1400, U+1806, U+2E17, U+2E1A, U+2E3A, U+2E3B, U+2E40, U+2E5D, U+301C, U+3030, U+30A0, U+FE31, U+FE32 and U+10EAD.
- **Also missing:** these are not `Pd` but are typed as hyphens: U+30FC `ー` (katakana long-vowel mark), U+FF70 `ｰ` (its half-width form) and U+2043 `⁃` (hyphen bullet).
- **Probes, notes.** Each returns `[]`:
  - `電話 090ー1234ー5678`
  - `電話 ０９０ー１２３４ー５６７８`: full-width digits with `ー`, as a Japanese IME types it
  - `call 090ｰ1234ｰ5678`
  - `card 4111ー1111ー1111ー1111`
  - `card 4111־1111־1111־1111`
  - `tel 050־123־4567`
  - `card 4111⁃1111⁃1111⁃1111`
  - The same with U+2E3A, U+301C, U+058A, U+1806, U+2E17 and U+FE32
- **Probes, images:**
  - `Tel 090ー1234ー5678`: nothing masked.
  - `Card 4111⁃ 1111 1111 1111`: `4111` stays visible.
- **Failure scenario:** a Japanese user types their phone number in a review note with the IME in full-width mode. `ー` is the usual hyphen there. The note is published.
- **Fix:**
  - `HYPHEN = /[\p{Pd}−⁃ーｰ]/u`. Keep U+FE58, U+FE63 and U+FF0D, which are in `\p{Pd}` anyway.
  - Add the `ー` phone and the maqaf phone as tests.

## Minor

### R4-M1. Other-number digits (`\p{No}`) are not digits

- **Probes, notes.** Each returns `[]`:
  - `call ⁰⁶ ¹² ³⁴ ⁵⁶ ⁷⁸` (superscript)
  - `call ₀₆ ₁₂ ₃₄ ₅₆ ₇₈` (subscript)
  - `call ⓪⑥ ①② ③④ ⑤⑥ ⑦⑧` (circled)
  - `card ④①①① ①①①① ①①①① ①①①①` (circled)
  - `call ❶❷❸❹❺❻❼❽❾` (dingbat negative circled)
- **Severity:** mostly deliberate hiding, and OCR does not output these characters.
- **Fix:**
  - Length-preserving: map any code point whose NFKC form is exactly one ASCII digit to that digit. This covers ⁰-⁹, ₀-₉, ⓪ and ①-⑨. ❶-❾ need a small table, because they have no NFKC form.
  - With the index map from R4-I1, plain NFKC also handles `⑩` and `⒈`.

### R4-M2. Combining marks after digits split the number

- **Probes, notes.** Each returns `[]`:
  - `card 4111́ 1111́ 1111́ 1111`
  - `call 0̂6 1̂2 3̂4 5̂6 7̂8`
- **Keycaps:** a keycap card `4️⃣1️⃣1️⃣1️⃣…` (`️⃣` after each digit) breaks every digit apart. Only the plain-digit groups that follow are caught: `card 4️⃣1️⃣1️⃣1️⃣ 1111 1111 1111` gives `phone`.
- **Fix:** delete `\p{M}` after a digit in the index-map normalisation (R4-I1). Or map it to a repeat of the digit before it: that keeps the length and is fail-safe, the same trick as for astral digits.

### R4-M3. Cyrillic and Greek look-alikes for digits

- **Where:** `detect.ts:265`. `LOOKALIKE = /^[0-9OolI|SB]+$/` is ASCII only.
- **Probes, notes.** Each returns `[]`, while the same string with ASCII `O` is refused as `phone`:
  - `call 06 12 3Ο 56 78` (Greek capital omicron U+039F)
  - `call 06 12 3О 56 78` (Cyrillic O U+041E)
  - `call 06 12 З4 56 78` (Cyrillic Ze U+0417 for 3)
  - `iban DE89 37О4 ОО44 О532 О13О ОО` (Cyrillic O for every 0)
- **Failure scenario:** a user on a Russian keyboard layout types `О` for zero, or someone hides a number on purpose. In images, Tesseract with `eng` does not output Cyrillic.
- **Fix:** add the common confusables to the look-alike set, mapped to `0`: `ОоΟοЗІіӀЅБб`.

### R4-M4. Monero: still unmasked (carried from R3-M2)

- **Probes, images:**
  - Wrapped at 16 characters a line (`44AFFq5kSiGBoZ4N` / `MDwYtN18obc8AemS` / `33DBLWs3H7otXft3` / …): **all lines unmasked**. The chain needs a 20-character first token.
  - `44AF Fq5k SiGB oZ4N …` (4-character groups): all unmasked.
  - `44AF…EP3A`: not masked.
- **Probe, notes:** the same 16-character wrap → `[]`.
- **Severity:** low, as before. Fiat proofs rarely show XMR addresses.
- **Fix:**
  - Lower the chain start to 12 or more characters starting with `[48]`, followed by base58 tokens that add up to 90 or more characters in all.
  - A follow-up is fine.

### R4-M5. False positives and leftover holes in the currency allowlist (notes)

- **False positives.** All are refused, and all are fail-safe:
  - `16.10.26-17.10.26` → `phone`. `DATE_RANGE` (`:129`) handles 4-digit years only.
  - `XMR: 0.12345678` → `phone`. The `:` between the code and the number stops `markBefore`. This was already there before round 3.
  - `rate was 165.12345` → `phone` (carried from R3-M1).
  - `ref x1234` → `account`. This is new, from the single-`x` tail added for R3-M5. `tx1234` passes.
  - About 1 in 2,000 trade codes is refused in a note as `iban`: a code of the form `LLDD-…` that happens to pass mod-97 (`isIban`, `:174-182`), such as `DE12-…`. Images are not affected.
- **Holes in the allowlist.** Each of these is published, though it should be `["phone"]`:
  - `text 347.1234567 Ron`, `call 347.1234567 bam` and `347.1234567 Cad`: `RON`, `BAM` and `CAD` count in any case, and they are also names or words.
  - `call me 347.1234567 TRY` and `347.1234567 TOP`: the `WORD_CODES` words in capitals.
- **Severity:** low. Each needs a one-dot phone format next to that exact word.
- **Possible tightening:**
  - Count a lowercase code only for `xmr`, `btc`, `eth`, `eur`, `usd`, `monero` and the app's own fiat list.
  - Add `RON`, `BAM`, `CAD`, `DOP` and `ERN` to `WORD_CODES`.

## OWNER CHOICE (kept as built, not bugs)

- **q29, whole amounts in notes:** for example `Paid 12 345 678 VND` → `phone`.
- **q30:** English name labels only.
- Names, addresses and @handles are not refused in notes.
- **Item 34, UPI on by default.** Two side effects for the owner to weigh:
  - **(a)** Shorthand like `meet@noon` and `rate xmr@kraken` is refused in notes as `account`.
  - **(b)** With UPI off, a note email split before the dot (`mail jane@example .com`) is published. `SPLIT_EMAIL` runs in images only, so in notes the UPI rule is what catches it today.
- **Separators left as a choice in round 3:** `_ • · , :`, and also U+3001 `、`. Probes that return `[]`:
  - `card 4111_1111_1111_1111`
  - `card 4111 · 1111 · 1111 · 1111`
  - `call 06、12、34、56、78`

## Clean results (no action)

- **Ordinary notes that pass:**
  - `Paid 412.50 EUR on 16.10.2026 at 14:32 — thanks!`, `Fast trade – 10/10 would trade again`, `took 10–15 min`
  - `2023–2026 regular, 50+ trades`, `Release at 18:00 — 18:30 CET`, `17.10.2026 18:00–19:00`, `16.10.26 - 17.10.26`
  - `Paid 1 234,56 EUR`, written with NBSP and with U+202F
  - `Paid ٤١٢٫٥٠ EUR`, `Paid ¥41250 JPY`, `Paid ₹41,250 INR`, `Paid 41.250,00 COP`, `Paid 1,234,567 IDR`
  - `price 165.40 EUR/XMR, margin +2.5%`, `Version 1.2.3.4 of the app`, `OS 14.2.1 iPhone 13`, `Took 1.5–2 hours`
  - `l00% legit`, `B2B 10 lol`, `B 12 S 34 O 56`, `3 BOB 50`, `Level 10 lol 25`, `Trade №12345`, `0x1234 lol`
  - `Paid 412.50 EUR 🙂 16.10.2026 🙂 14:32`, `Code K7M2–9QXA–4FTR–8WPN done`, `Code K7M2 9QXA 4FTR 8WPN done`
- **Contrived inputs that are refused, fail-safe:** `SOS 1 2 3 4 5 6 7` and `Steps 1-2-3-4-5-6-7 followed`.
- **Images keep the amount and date when written in Unicode:** `Paid 412٫50 EUR on 16–10–2026` and `Paid ٤١٢٫٥٠ EUR on ١٦.١٠.٢٠٢٦` mask nothing. `Code K7M2–9QXA–4FTR–8WPN` stays visible.
- **Emoji and astral characters:** none caused an offset error.
  - Emoji before, between and inside card and phone words were masked or refused.
  - A lone surrogate before a card still gives `card`.
  - Astral digits double the digit count, so a 4-digit astral group can only be over-masked. For example, `Card 𝟒𝟏𝟏𝟏 1111 1111 1111` is labelled `phone`.
