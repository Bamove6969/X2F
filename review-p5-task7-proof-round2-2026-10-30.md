# Review round 2: Plan 5 Task 7, `@x2f/proof`

- Branch `wip/third-p5-proof-core` @ 756d44a (claude3). Red tests are at 467afd7. Diff base is 1489e79.
- Round 1: `review-p5-task7-proof-2026-10-30.md`.
- Reviewer: read-only helper, 2026-10-30.

## Verdict: CHANGES REQUIRED

Almost all of the round-1 fixes are correct and tested. Two Important findings remain:

- **R2-I1:** the M6 decimal-part rule is too broad. A phone number written with one dot is no longer refused in notes. This is a **regression** from 1489e79.
- **R2-I2:** Belgian mobile formats still leak in images and notes. The slash form `0470/12.34.56` always leaks. The space form `0470 01.02.03` leaks when its last three pairs look like a date. This was **already there at 1489e79**; round 1 missed it. It is the same kind of problem as I1.

Both fixes are small regex changes plus tests.

## Checks run

All checks ran in my own detached worktree with `npm ci`, under flock. The worktree has been removed.

- `tsc --noEmit -p packages/proof`: OK.
- `npx vitest run --project @x2f/proof`: 4 files, **94/94 passed**.
- **Red-first check:** at 467afd7 the same run gives **11 failed | 83 passed**. The failures are exactly I1 (2 tests), M1, M2, M3, M4, M5, M6, M8, M9 and M10. The "real dates are still kept" test passed there, as it should.
- **Detection probes:** about 95 image and note strings, run at both 756d44a and 1489e79 to tell regressions apart from older gaps.
- **Fuzz:** 200,000 random byte changes, truncations, insertions and deletions of the 4 fixtures, through `cleanImage`. Every output was also checked with `assertClean` and cleaned a second time.
  - Results: 0 non-`CleanError` exceptions, 0 cleaned outputs that failed `assertClean`, 0 outputs that changed when cleaned again. Time: 2.9 s.
  - Accepted 17,256, rejected 182,744.
- **M9 memory probe:** a 20 MB JPEG made of 5 M four-byte APP0 segments in front of a real image is now cleaned in 71 ms with about 0 MB of extra heap. Round 1 measured about 330 MB.

## Round-1 findings: status

| # | Status | Evidence |
|---|---|---|
| I1 | **Fixed**, with a gap left (see R2-I2b) | These are now masked: `06.12.34.56.78`, `+33 6.12.34.56.78`, `06-12-34-56-78`, `01.02.03.04.05`, `555-01-02-03`, `415.555.0134`. These dates are still kept: `16.10.2026.`, `16/10/2026, 14:32`, `2026-10-16T14:32`, `Date: 16.10.26 Time: 14:32`. The `NB`/`NA` guards are at `detect.ts:53-54`. |
| M1 | Fixed | `...1234`, `…1234`, `°°°°1234`, `.... 1234`, `ending in: 1234` and `Ending In 1234` are masked. This adds new false positives in notes (R2-M1). |
| M2 | Fixed | `4111 1111 1111 l111`, `1234O678` and `411111111111111l` are masked, and none is labelled `card`. A group made only of look-alikes (`IIII`, `4lll`) stays visible. That follows the documented "at least as many digits" rule and is accepted. There is an indexing bug after emoji (R2-M2). |
| M3 | Fixed for its scope | Full, misread (`l`), wrapped (48 + 47 characters), stagenet (`5…`) and testnet (`9…`) addresses are masked. The truncated form `44AFFq…QBEP3A` is not (R2-M4). |
| M4 | Fixed for its scope | `jane@exämple.com`, `иван@пример.рф` and `jane.doe @example.com` (both words) are masked. A split after the `@` is not (R2-M3). |
| M5 | Fixed | `Sort code 12-05-26` and `Sort-code 01-02-03` are masked. |
| M6 | Fixed for the listed cases, but **too broad** | `0.12345678 XMR`, `2023 - 2026`, `10.00-12.00` and `12.3456789012 XMR` pass, and so do the cases with emoji. But see R2-I1. |
| M7 | OWNER CHOICE (q30) | English labels only, as built. Not flagged. |
| M8 | Fixed | `detect.ts` partial-word branch: each part reaches one average character width toward its neighbour, clamped to the word. The red test checks the placement. |
| M9 | Fixed | `clean.ts` `Kept`: touching ranges are merged, at most 4096 ranges, dropped pieces are only counted. The probe numbers are above. |
| M10 | Fixed | `clean.ts` `bodyOk`: only `nf ∈ {1, 3}` is accepted. |

## Important

### R2-I1. The M6 decimal-part rule lets single-dot phone numbers through in notes (regression)

- **Where:** `packages/proof/src/detect.ts:423` (`DECIMAL`) and `:443`.
- **What happens:** `DECIMAL` keeps any `\d+[.,]\d{4,}` tail as a decimal part. That tail is then blanked, so the `PHONE` rule only sees the digits in front of the dot.
- **Probes**, with the result at 1489e79 and at 756d44a:

  | Note text | 1489e79 | 756d44a |
  |---|---|---|
  | `chiamami 347.1234567` | `["phone"]` | `[]` |
  | `call 02.12345678` | `["phone"]` | `[]` |
  | `call 0612.345678` | `["phone"]` | `[]` |

- **Failure scenario:** an Italian trader writes their mobile number as `347.1234567`, which is a common Italian style, in a public review note. Round 1 refused that note. It is now published.
- **Images are not affected:** `detectSensitive` does not use `DECIMAL`. `Tel 347.1234567` is still masked.
- **Fix:** keep a long decimal part only when the number really looks like an amount. Two ways to do that:
  - Integer part is `0` or a 1-3 digit number with no leading `0`, **and** a currency or crypto code or symbol sits next to it. This covers `0.12345678 XMR`, `12.3456789012 XMR` and `Rate 1.0234 EUR/XMR`.
  - Or: the integer part has no leading zero, and integer plus decimals have fewer than 7 digits.

  Keep the existing `\d{1,2}` decimals as they are. Add the three probe strings above as tests that must be refused.

### R2-I2. Belgian mobile formats leak entirely: the slash form always, the space form when the pairs look like a date (already there at 1489e79)

- **Where:**
  - `detect.ts:143` (`PHONE`): `/` is not in its character class.
  - `detect.ts:128` (`DIGIT_RUN`): only joins over a space or `-`.
  - `detect.ts:53` (`NB`): only looks for a digit group before the date that is joined by `-/.:`, not one joined by a space.
- **Probes**, where empty means nothing is masked or refused:

  | Input | Result (both commits) |
  |---|---|
  | Image `Tel 0470/12.34.56` | empty |
  | Image `Tel +32 470/12.34.56` | empty |
  | Note `call 0470/12.34.56` | `[]` |
  | Image `Tel 0470 01.02.03` (kept as a date) | empty |
  | Image `Tel +32 470 01.02.03` | empty |
  | Note `call me 0470 01.02.03` | `[]` |

  For comparison, `Tel 0470 12.34.56` is masked (`34` is not a month), and so are `Tel 02/123.45.67` and `Tel 0171/1234567`.
- **Failure scenarios:**
  - **(a)** A Belgian buyer's bank or Payconiq screenshot shows the payee mobile as `0470/12.34.56`, a very common Belgian way to write it. All of it reaches the seller and the moderator unblurred, every time.
  - **(b)** In the space form `0470 dd.mm.yy`, about 6% of real numbers have last three pairs that form a valid date. Those numbers are fully visible.
- **Fix:**
  - **(a)** Let `PHONE` join over a single `/` between digit groups. Dates are already blanked before the classifiers run, so `16/10/2026` is not affected.
  - **(b)** Do not keep a 2-digit-year numeric date (`dd.mm.yy`, `dd-mm-yy`) when a digit group starting with `0` or `+`, or a 3-4 digit group, comes right before it, joined by a single space or `/`.
  - Add tests for all six strings above, plus `Sent 16.10.26` and `412.50 sent on 16.10.26` as dates that must still be kept.

## Minor

### R2-M1. The new masked-tail and "ending" rules refuse ordinary notes

- **Where:** `detect.ts:135` (`\.{3,} ?\d{2,}` and the lone `…`) and `:137` (`ENDING`, `\d{2,}`).
- **Probes:** each of these returns `["account"]` and is refused with "Remove personal details". All of them passed at 1489e79.
  - `Waited ... 15 minutes`
  - `Waited.... 15 minutes`
  - `ok … 20 min`
  - `trade ending in 10 minutes`
- **Fix:** for the dot and ellipsis forms and for `ending`, require exactly 4 digits (`\d{4}(?!\d)`). For the dot and ellipsis forms, also allow no space before the digits. Images could keep the looser rule, because over-masking there costs little. `.... 1234` with a space mostly comes from OCR of `•••• 1234`, which is already covered by the bullet class.

### R2-M2. The look-alike pass is off by one after an emoji or any other non-BMP character

- **Where:** `detect.ts:164`. `const chars = [...text]` splits by code point, but it is indexed with `m.index`, which counts UTF-16 units.
- **Probes:**
  - Image `😀 Card 4111 1111 1111 l111`: `l111` is not masked. The other three groups are labelled `phone`.
  - Note `👍 Card 4111 1111 1111 l111` → `["phone"]`, where the same note without the emoji gives `["account"]`.
  - When the wrong index lands on an emoji, the string gets one unit shorter and every later span moves one character left: `😀 1S😀 4111 1111 1111 1111` covers `1S😀`.
- **Severity:** low. Tesseract `eng` rarely outputs non-BMP characters, and in notes only the label changes.
- **Fix:** use `text.split('')` so the indexes match. Add an emoji test.

### R2-M3. An email that OCR splits after the `@` is not masked at all (images)

- **Where:** `detect.ts:141` (`SPLIT_EMAIL` only handles `word @domain`).
- **Probes:** `jane.doe@ example.com` and `jane.doe @ example.com` → nothing masked. Neither half is caught: `@ ` is not a handle, and `example.com` is not an email.
- **Fix:** also allow `word@ domain.tld` and `word @ domain.tld` in `SPLIT_EMAIL`, with at most one space on each side of the `@`.

### R2-M4. Truncated Monero addresses (claude3's open item (b))

- **Where:** `detect.ts:150`.
- **Probes:**
  - `44AFFq...QBEP3A` and `44AFFq…QBEP3A` → nothing masked.
  - The short second half of a wrapped address (under 40 characters and not starting with a Monero prefix) is not masked either.
- **Answer to (b):** yes, do it as a technical follow-up. It can wait until after merge, because XMR addresses rarely appear in fiat payment proofs.
- **Suggested shape:** `[45789AB][base58]{3,}(?:…|\.{2,})[base58]{3,}` for the truncated form. For a base58 token of 20 or more characters on the line right after a masked Monero token, mask it as well.

## OWNER CHOICE (kept as built, not bugs)

- **q29, whole amounts in notes:** these are still refused:
  - `Paid 1 250 000 IDR` → `phone`
  - `pay 1.000.000 IDR` → `phone`
  - `sent 250000 COP` → `account`
  - `trade #123456` → `account`

  claude3's open item (a), letting `#n` pass, falls under the same question.
- **q30:** name labels are English only.
- Names, addresses and @handles are not refused in notes.

## Notes (no action)

- A pasted 64-character hex transaction ID in a note is refused as `account`, through `LONG_TOKEN`. That is a reasonable outcome, since it links to the chain.
- `Ref 16.10.2026-001` is now masked as `phone` instead of being kept as a date. This hides more than needed, but it is the safe direction and it is the intended I1 behaviour.
