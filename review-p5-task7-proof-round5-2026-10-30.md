# Review round 5: Plan 5 Task 7, `@x2f/proof`

- Branch `wip/third-p5-proof-core` @ d3f62b4 (claude3). Red tests at c149398. Diff base 6583b78.
- Rounds 1-4: `review-p5-task7-proof-2026-10-30.md`, `-round2-`, `-round3-`, `-round4-`.
- Reviewer: read-only helper, 2026-10-30. Line numbers are `packages/proof/src/detect.ts` at d3f62b4.
- In the probe strings below, `\uXXXX` / `\u{XXXXX}` stands for that one character.

## Verdict: APPROVED (Minor findings only)

The new index map is correct. Masks cover the whole of the sensitive original text: never shifted and never partial. I tested this with deletions, astral digits, NFKC folds that change length, combining marks, keycaps, surrogate pairs and emoji (property test below: 20,000 image cases, 0 misses). Every round-4 finding in scope is fixed and tested. I found no remaining realistic card, phone, IBAN, XMR or email that gets through fully. What is left is exotic tricks and fail-safe false positives, all Minor.

## Checks run

My own detached worktree (`~/x2f-worktrees/rv-p5t7r5` @ d3f62b4), with `npm ci`, under flock. The worktree has been removed and nothing was committed.

- `tsc --noEmit -p packages/proof`: OK.
- `npx vitest run --project @x2f/proof`: 4 files, **147/147 passed**.
- **Red-first check:** with `src` from c149398 the run gives **12 failed | 135 passed**, as expected. The 12 are:
  - 5 format-table rows: format characters, Unicode dashes, other-number digits, combining marks, Cyrillic/Greek look-alikes.
  - R4-I1 (notes), R4-I1 (OCR columns), R4-I2, R4-M1, R4-M2, R4-M3 and R4-M5.
- **Test edits in the fix commit:** d3f62b4 also edits the red tests.
  - Most edits only rewrite invisible literals in `\u` escape form. The intent is the same.
  - One expectation changed: `Card 4111⁃ 1111 1111 1111` in an image is now `phone` (was `card`), with every word masked. A new assertion shows the ASCII `Card 4111- 1111 1111 1111` gives the same result. Coverage is not weakened.
- **Probes:** about 230 strings through `detectSensitiveText` and `detectSensitive` (synthetic OCR), each also run against 6583b78 to compare.

### Priority 1: the index map (property test, not committed)

`zz-review-prop.test.ts` was in the worktree only. It is seeded (mulberry32) and runs 20,000 image cases and 6,000 note cases.

- **Numbers:** `4111 1111 1111 1111`, `4111-1111-1111-1111`, `4111111111111111`, `5500 0000 0000 0004`, `06 12 34 56 78`, `+44 7700 900123`, `415-555-0134`, `+972-50-123-4567`, `DE89 3704 0044 0532 0130 00`, `GB82WEST12345698765432`, `FR1420041010050500013M02606`.
- **Random mutations of each number:**
  - Digits are replaced by astral math digits (`\u{1D7CE}`+d, a surrogate pair), full-width, superscript or circled digits.
  - Digit pairs `10`-`20` are folded into `⑩`-`⑳` (1 unit becomes 2 normalised digits).
  - Combining marks are added after digits: `\u0301`, `\u0302`, `\u0308`, `\u034F`, `\uFE0F`, `\u20E3`, and the keycap `\uFE0F\u20E3`.
  - Invisible format characters are added after any character: `\u200B`-`\u200F`, `\u2060`, `\u00AD`, `\uFEFF`, `\u2066`, `\u2069`, `\u061C`, `\u180E`.
- **Context in images:**
  - Prefixes: `Tel `, `😀 Card `, `Paid 412.50 EUR 😀😀`, `𝟏𝟐 `, `😀`, `Ref: `, and prefixes glued into the same word: the kept trade code `K7M2-9QXA-4FTR-8WPN/` or the kept date `16.10.2026/`. A glued prefix forces the per-character (partial-word) path through `toOriginal`.
  - Suffixes: `/K7M2-9QXA-4FTR-8WPN`, `/16.10.2026`, `/412.50`, `😀`, ` thanks`, ` 16.10.2026`.
- **Images:** for every original sensitive character (each digit, each IBAN letter, both columns of a surrogate pair, the one column of `⑩`), the mutated line must have a region over its exact column wherever the plain-ASCII version of the same line is covered.
  - **Result: 0 misses out of 20,000 cases.**
  - The plain baseline was also covered everywhere: 0 baseline misses.
- **Notes:** the same mutations with `call `/`card `/`iban `/`😀 `/`paid 412.50 EUR, ` before and emoji, `thanks` or a date after. **0 of 6,000 are published.**
- **Targeted checks:**
  - `K7M2-9QXA-4FTR-8WPN\u{E0020}/4111111111111111` (an astral deleted character, 2 units) gives region columns 21-38. The `/` is at 21 and the digits are at 22-37.
  - `K7M2-9QXA-4FTR-8WPN/⑩⑪⑫⑬⑭⑮⑯⑰` gives region 19-28: the 8 circled characters are at 20-27.
  - `K7M2-9QXA-4FTR-8WPN/４１１１…` (full-width) gives `card` 19-36.
  - `Tel \u{E0020}4111111111111111`: the whole word is masked as `card`.
- **Code read:** `normalize` (`:116-144`) pushes one `[start,end)` range per original UTF-16 unit, and both halves of a surrogate pair share it. In `toOriginal` (`:157-182`):
  - An expanded unit takes the best span among its outputs.
  - A deleted unit inherits a span only when both of its neighbours have the same one. So it never widens a kind across a boundary, and the +1-column padding in the partial path absorbs it.
  - The partial path's `charW` uses original UTF-16 units, which matches the map.

## Round-4 findings: status

| # | Status | Evidence |
|---|---|---|
| R4-I1 | **Fixed** | `\p{Cf}` is deleted (`:67`, `:129-130`), and U+0085, U+2028 and U+2029 map to a space. Refused: all 15 round-4 note probes, including `card 4111\u200E 1111\u200E…`, `iban DE89\u00AD3704…`, `call +972\u200E50\u200E123\u200E4567` and `jane\u200B@example.com` (as `email`). The astral Cf characters `\u{E0020}` and `\u{1D173}` are refused too. Images: `Tel 06\u200B12\u200B34\u200B56\u200B78` is masked whole, and `Card 4111\u{E0020}1111…` gives `card`. |
| R4-I2 | **Fixed** | `HYPHEN = /[\p{Pd}−⁃ーｰ]/u` (`:65`). These are refused: `電話 090ー1234ー5678`, `電話 ０９０ー１２３４ー５６７８`, `call 090ｰ1234ｰ5678`, `tel 050־123־4567`, `card 4111⁃1111⁃1111⁃1111`. Image `Tel 090ー1234ー5678` is masked. These pass: `took 10ー15 min`, `コーヒー 2 杯、10〜15 分`, `Code K7M2ー9QXAー4FTRー8WPN done`. |
| R4-M1 | **Fixed** | Refused: superscript, subscript, circled, dingbat (`❶…❾` → `account`), `⑫ ㉞ ㊼` and `⒓`. Image `Tel ⁰⁶ ¹² ³⁴ ⁵⁶ ⁷⁸` is masked. These pass: `10² fast`, `Rating ⑤/⑤`, `① fast ② friendly ③ …`, `⑩/⑩ would trade`, `Trade ⒈ fast ⒉ friendly`. |
| R4-M2 | **Fixed** | Refused: `card 4111\u0301 1111\u0301 …`, `call 0\u03026 1\u03022 …`, the keycap card (as `card`, previously `phone`) and the `\u20E3`-only 16-digit card. `1\uFE0F\u20E3 fast 2\uFE0F\u20E3 friendly` passes. |
| R4-M3 | **Fixed** | `call 06 12 3Ο 56 78` (Greek), `3О` and `З4` (Cyrillic) give `phone`. The Cyrillic-O IBAN gives `account`, and image `3О` is masked. Russian and Greek ordinary notes pass: `Оплата за 3О мин`, `Б 12 С 34 О 56`, `Ο πωλητής ήταν 10/10, ΟΚ`, `З 10 по 15 минут`. |
| R4-M5 | **Fixed (the holes)** | `Ron`, `bam`, `Cad`, `TRY` and `TOP` after `347.1234567` are now `phone`. `EUR`, `usd`, `xmr`, `Monero` and `$` still pass. The fail-safe false positives listed in R4-M5 remain: see R5-M4. |
| R4-M4 | Deferred (agreed) | Unchanged. |

## Important

None.

## Minor

### R5-M1. Blank "filler" letters and default-ignorables that are not `\p{Cf}` still split a number

- **Where:** `normalize` (`:116-144`). `FORMAT = /\p{Cf}/u` (`:67`) deletes format characters only. `MARK` is deleted only right after an ASCII digit.
- **Probes, notes.** Each returns `[]`; on screen each shows a blank or nothing between the digit groups:
  - `card 4111\u31641111\u31641111\u31641111` (Hangul filler, a known "invisible character")
  - `card 4111\uFFA01111\uFFA01111\uFFA01111` (half-width Hangul filler)
  - `card 4111\u115F1111\u115F1111\u115F1111`
  - `card 4111\u28001111\u28001111\u28001111` (braille blank, shows as a space)
  - `card 4111 \u034F1111 \u034F1111 \u034F1111` (combining grapheme joiner after a space, not after a digit)
- **Probe, image:** `Card 4111\u31641111\u31641111\u31641111` → nothing masked. OCR engines do not output these characters, so this is a hand-made trick.
- **Severity:** a deliberate trick only (owner item 35 policy), so Minor.
- **Fix:**
  - Delete `\p{Default_Ignorable_Code_Point}` instead of `\p{Cf}`. JS regex supports it, and it covers U+115F, U+1160, U+3164, U+FFA0, U+034F, U+180B-180F, the variation selectors and every Cf that is invisible.
  - Map U+2800 to `' '`.

### R5-M2. A few dash look-alikes outside `\p{Pd}`

- **Probes, notes.** Each returns `[]`:
  - `card 4111\u02D71111\u02D71111\u02D71111` (`\u02D7` modifier minus)
  - `card 4111\u23AF1111\u23AF1111\u23AF1111` (`\u23AF`)
  - `card 4111➖ 1111➖ 1111➖1111` (heavy-minus emoji)
- **Severity:** exotic, so Minor.
- **Note:** `電話 090・1234・5678` (U+30FB katakana middle dot) also passes. It belongs with the owner's "`·` not joined" choice, so it is listed here for awareness only.
- **Fix (optional):** add `\u02D7\u23AF➖` to `HYPHEN`.

### R5-M3. Nit: a trailing 2-unit keycap after the last digit is one column outside the region

- **Probe, image:** `4111111111111111\uFE0F\u20E3/K7M2-9QXA-4FTR-8WPN` → region columns 0-17. All 16 digits and `\uFE0F` are covered, but `\u20E3` (column 17) is not.
- **Why:** a deleted unit at the edge of a span takes no span, and the partial path pads only one column.
- **Severity:** none in practice. Every digit is covered, and a real renderer and OCR draw the keycap over its digit's box. No action needed.

### R5-M4. False positives on ordinary notes (all fail-safe: refused, never leaked)

- **New in round 5, from R4-I2 and R4-M5:**
  - `注文番号 2026ー1016` → `phone`. `ー` is now a hyphen, so this behaves exactly like the ASCII `2026-1016`.
  - `paid 0.12345678 SOL` and `paid 0.12345678 ADA` → `phone`. `WORD_CODES` now never count, in any case (`:680`, `:690-693`), so these real crypto tickers no longer clear a long decimal.
  - `paid 0.12345678 ltc` and `paid 0.12345678 usdt` → `phone`. Only `xmr monero btc eth eur usd` count in lowercase.
- **Carried from before:**
  - `16.10.26-17.10.26` → `phone`
  - `XMR: 0.12345678` → `phone`
  - `rate was 165.12345` → `phone`
  - `ref x1234` → `account`
  - `Paid 412.50 EUR (ref 2026-1016)` → `phone`
  - `order 2026-10-16-0001` → `phone`
  - `call me, room 1204-1205` → `phone`
  - About 1 in 2,000 trade codes is refused as `iban`.
- **Possible tightening:**
  - Let `SOL` and `ADA` count in capitals when right after a decimal number.
  - Add `ltc`, `usdt` and `usdc` to `LOWERCASE_CODES`.

## Not flagged (owner choices or already settled)

- q29 whole amounts (`paid 1\uFE0F\u20E32\uFE0F\u20E33\uFE0F\u20E34\uFE0F\u20E35\uFE0F\u20E36\uFE0F\u20E3 COP` → `account`, the same as the ASCII form).
- q30 English-only labels.
- UPI on.
- The separators `_ • · , :` are not joined.
- Names, addresses and @handles are not refused.
- Obfuscated emails such as `jane(at)example.com` and `jane at example dot com` pass. Round 1 ruled them out of scope.
- `card 4lll llll llll llll` passes. A token with more look-alikes than digits is not read as digits, by design since round 2.

## Clean results (no action)

- **Realistic leak hunt.** All refused or masked:
  - **Phones:** `+1 (415) 555-0134`, `+1.415.555.0134`, `001 415 555 0134`, `0044 7700 900123`, `+91 98765 43210`, `98765-43210`, `+55 (11) 91234-5678`, `138 0013 8000`, `13800138000`, `tel +7 (912) 345-67-89`, `tel 8 912 345 67 89`, `тел 8 912 345 67 89`, `tel +33 (0)6 12 34 56 78`, `call 612345678`, `call📞0612345678`, `📞+33 6 12 34 56 78`, `phone: 0612345678.`
  - **Cards:** amex `3782 822463 10005`, diners `3056 930902 5904`, `4111.1111.1111.1111`, `4111/1111/1111/1111`, `(4111 1111 1111 1111)`, `"4111111111111111"`, `😀4111111111111111😀`
  - **IBANs:** lowercase `iban de89 3704 0044 0532 0130 00` (as phone+account, and masked in images), `iban gb82 west …`, `NL91ABNA0417164300`, `CH93 0076 2011 6238 5295 7`, `BE68 5390 0754 7034`
  - **Emails:** `JANE@EXAMPLE.COM`, `jane＠example．com`
  - **XMR:** the full 95-character Monero address.
- **Ordinary notes that pass:**
  - `Paid 412.50 EUR on 16.10.2026 at 14:32 — thanks!`, `Paid 412.50\u200BEUR`, `Paid 412.50 EUR \u200F\u200E fast`, `Paid 412.50 EUR, 16.10.2026, 14:32, ok 👍🏽`
  - `5⭐\uFE0F 10/10`, `2\uFE0F\u20E30\uFE0F\u20E32\uFE0F\u20E36\uFE0F\u20E3 best trade`, `5\uFE0F\u20E30\uFE0F\u20E30\uFE0F\u20E3 EUR paid`, `100% legit ⓵⓪⓪`, `Was ①⓪ min late`
  - `ゲーム 2023ー2026`, `ありがとうございました！10ー15分で完了`, `振込 412.50 EUR、16.10.2026 14:32`
  - `שילמתי 412.50 EUR ב-16.10.2026`, `دفعت ٤١٢٫٥٠ يورو ١٦\u200F-١٠\u200F-٢٠٢٦`
  - `Всё ок, 5 звёзд, 10 из 10`, `Перевёл 412,50 EUR в 14:32, всё быстро`
  - The round-4 clean list is unchanged.
