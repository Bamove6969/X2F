# Review: Plan 5 Task 7, `@x2f/proof` (detection, redaction, image cleaners)

- Branch `wip/third-p5-proof-core` @ 1489e79 (claude3), contains main line 5c4d35b. First review.
- Reviewer: read-only helper, 2026-10-30.

## Verdict: CHANGES REQUIRED

One Important finding: phone numbers written with dots or dashes in two-digit groups (`06.12.34.56.78`) leak entirely. Everything else is Minor. The package is otherwise solid:
- the code is pure (no I/O, no Node APIs);
- the cleaners use allowlists with exact body checks;
- redaction cannot be undone;
- the tests are thorough.

## Checks run (own detached worktree, `npm ci`, under flock)

- `tsc --noEmit -p packages/proof`: OK.
- `npx vitest run --project @x2f/proof`: 4 files, **81/81 passed**.
- Extra probes, run as temporary test files in my worktree and not committed:
  - About 45 detection edge cases and 17 review-note texts.
  - A fuzz run of 200,000 random mutations and truncations of the 4 fixtures through `cleanImage` + `assertClean`: 0 non-`CleanError` exceptions, 1.4 s.
  - 20 MiB of `0xFF`: rejected in 17 ms.
  - A PNG declaring a 2 GB chunk: rejected.
  - 5 M tiny APP segments: see M9.
- Worktree removed.

The following were checked and are fine:
- **Cards:** spaces, dashes, double spaces and dots are all masked; a Luhn-invalid card is still masked.
- **IBANs:** a mod-97-invalid IBAN is still masked; lowercase `de89 …` is masked through the digit rule.
- **Phones:** international formats with spaces or brackets (`+44 7700 900123`, `+49 30 1234567`, `(020) 7946 0958`, `0412 345 678`) are masked.
- **Monero:** standard, sub (`8…`) and integrated addresses are masked when OCR reads the whole address.
- **Emails:** uppercase emails and emails with an accented local part are masked.
- **Kept items:** the trade code is kept in any grouping; the amount and dates are kept.
- **`redact`:** it destroys the pixels, so the output depends only on the region mean and the position. Redaction runs on decoded RGBA before the canvas re-encodes, so nothing of the original survives in the region.
- **Metadata:** EXIF, XMP, ICC, IPTC, COM, MPF and thumbnails (APPn segments and data after EOI) are all dropped. PNG text, `eXIf`, `iCCP`, `tIME` and `pHYs` are dropped, and so are bytes after IEND. HEIC and WebP are refused here, which is correct: Task 13 re-encodes to PNG or JPEG first.
- **Decompression bombs:** the cleaners never decompress, and the pixel limits belong to Task 13's header check.

## Important

### I1. A numeric date "keep" swallows dotted or dashed phone numbers, which are then not masked at all

- **Where:** `packages/proof/src/detect.ts:61` (`DATE_NUMERIC`), `:63-71` (`markDates`), and the ≥ 7-digit rule at `:169`.
- **What happens:** `06.12.34.56.78` contains `06.12.34`, which looks like a valid day.month.yy date, so it is kept and blanked. Only `56.78` is left, and 4 digits are below both the phone rule (≥ 7) and the account rule (≥ 6).
- **Confirmed by probe.** Nothing is masked in:
  - `Phone 06.12.34.56.78`
  - `Phone +33 6.12.34.56.78`
  - `Tel 06-12-34-56-78`
  - `412.50 sent on 16.10.26 to 06.12.34.56.78` (here the phone also passes `detectSensitiveText`: `call me 06.12.34.56.78` → `[]`)
- **Failure scenario:** a French, Belgian or Swiss buyer uploads a bank or Lydia/Wero transfer screenshot showing the recipient's mobile as `06.12.34.56.78`. The number goes to the seller and the moderator unblurred. Writing phone numbers in dotted pairs is the usual style in France.
- **Fix:** keep a numeric date only when it is not part of a longer group run. Add the lookbehind `(?<!\d[-/.])` and the lookahead `(?![-/.]\d)` to `DATE_NUMERIC`, or keep only the part of a digit-group run that is a date when the whole run is exactly three groups. Add tests for the four strings above.
- **Same class of problem:** an `HH:MM` or `YYYY-MM-DD` keep sitting inside a longer separator run. A lookbehind/lookahead guard on all of `DATE_TEXT[2]`, `[3]` and `DATE_NUMERIC` covers it.

## Minor

### M1. Masked tails written with dots, an ellipsis or "ending in" are not masked

- **Where:** `detect.ts:122`.
- **Probe:** `Card ending ...1234`, `Card ending …1234` and `Account ending in 1234` → nothing masked.
- **Why it matters:** OCR often reads `••••` as `....`, `…`, `°°°°` or `eeee`, and Chase-style screens print `...1234`. Only the last 4 digits leak, but the spec lists masked tails as a class.
- **Fix:** add `.` (with 3 or more repeats), `…` and `°` to the class. Optionally add the phrase `ending (in)? \d{4}`.

### M2. An OCR misread inside a digit run leaves the rest of the group visible

- **Where:** `detect.ts:118`.
- **Probe:** in `Card 4111 1111 1111 l111` (OCR read `1` as `l`), `l111` stays visible.
- **Why it matters:** this weakens the "one misread digit must not leave it visible" fail-safe. Only the last group leaks.
- **Fix:** when joining runs for masking only, count `O o l I | S B` next to digit groups as digits. Labels still come from the real digits.

### M3. Monero addresses are only masked when OCR reads all 95 or 106 characters exactly

- **Where:** `detect.ts:128`.
- **Cases that leak:**
  - one character misread outside base58 (`0`, `O`, `I`, `l`);
  - an address wrapped over two OCR lines;
  - a truncated UI form `4AdUnd…684Rge`;
  - stagenet or testnet prefixes.
- **Failure scenario:** a wallet screenshot wraps the address over two lines and neither line matches. The Luhn and mod-97 fail-safe principle is not applied here.
- **Severity:** low for fiat payment proofs, where XMR addresses are rare.
- **Fix:** mask any base58 token of 30 or more characters starting with `4`, `8`, `5`, `7`, `9`, `A` or `B`, and any token of 40 or more characters that is almost all base58.

### M4. Emails with a non-ASCII domain, or split by OCR, leak

- **Where:** `detect.ts:123`.
- **Probes:**
  - `jane@exämple.com` → not masked, and `detectSensitiveText` → `[]`.
  - If OCR splits `jane.doe @example.com`, only `@example.com` is masked (as a handle) and `jane.doe` stays visible.
- **Fix:** use the `u` flag with `\p{L}\p{N}` in both the local part and the domain. When a handle-like `@domain.tld` follows a word with no space-free `@`, also mask the word before it.
- **Out of scope:** obfuscated forms such as `jane (at) example (dot) com` are not caught. That is fine for a filter aimed at accidental disclosure.

### M5. A UK sort code shaped like a date is kept

- **Where:** `detect.ts:61`.
- **Probe:** `Sort code 12-05-26` → kept as a date. `20-32-06` is masked.
- **Severity:** a sort code identifies only a bank branch, so this is low. I1's lookaround fix does not cover it.
- **Possible fix:** do not keep a numeric date in dashed `DD-MM-YY` form when a `sort code` label is on the line.

### M6. Review-note false positives refuse ordinary text (`detectSensitiveText`)

- **Where:** `detect.ts:125`, `:118`, `:364`.
- **Probes:** each of these is refused with "Remove personal details":
  - `Great trade, got 0.12345678 XMR fast` → `phone` (the decimal part also matches the digit-run rule)
  - `Traded with them 2023 - 2026` → `phone`
  - `Met at 10.00-12.00` → `phone`
  - `Paid 1 250 000 IDR` → `phone`
  - `sent 250000 COP` → `account`
  - `trade #123456` → `account`
- **Clear bug, fix it:** digits after a decimal point are not an account or phone number. Excluding them (`(?<![.,]\d*)` before the run, or skip runs that `findAmounts` reads as having decimals) and dropping `space-dash-space` year ranges are plain fixes.
- **OWNER CHOICE** (big whole numbers in notes, such as `250000 COP` or `1 250 000 IDR`):
  - (a) Keep refusing any number of 6 or more digits. This is safest; IDR, VND, COP and KRW traders have to drop the amount.
  - (b) Allow a number when a currency code or symbol, or `XMR`, is right next to it.
  - (c) Allow any number with thousands separators.

### M7. Name labels are English only

- **Where:** `detect.ts:175`.
- **Probe:** `Para: Juan Pérez`, `Empfänger: Hans Müller` and `Bénéficiaire : Jean Dupont` → nothing masked.
- **Background:** the plan's label list is English, and Task 13 OCR loads only `eng`, so this matches the plan. But a Spanish, German or French bank receipt leaks the payee name.
- **OWNER CHOICE:**
  - (a) Keep English only, and record the recall gap in `docs/security/plan-5-review.md` (Task 13 measures recall).
  - (b) Add the labels for the app's supported locales now (`para, de, destinatario, beneficiario, ordenante, empfänger, begünstigter, auftraggeber, von, an, bénéficiaire, destinataire, émetteur, de la part de, ontvanger, begunstigde, naar, van, …`). This is cheap in the detector. OCR accuracy on accented labels depends on the OCR language packs, which is a Task 13 choice.

### M8. Redacted regions in words that hold a kept part are placed by character count

- **Where:** `detect.ts:340-347`.
- **What happens:** when one OCR word holds both a kept part and a detected part (for example `K7M2-9QXA-4FTR-8WPN/jane@x.io` with no space), the masked part's box is placed in proportion to the character count. With a proportional font, the box can miss a character or two at the edge. The 4 px padding usually covers this, but nothing guarantees it.
- **Fix:** add one character's average width as extra padding on the covered side of such partial regions, or mask the whole word when the detected part is a money or contact class. The kept item is then also hidden, but staying safe matters more than keeping it.

### M9. The cleaners hold every piece in an array before rejecting

- **Where:** `clean.ts:66`, `:162`.
- **Probe:** a 20 MiB JPEG made of 5 M four-byte APP0 segments used about 330 MB of heap and took 0.9 s before it was rejected (`unsupported`, no scan).
- **Severity:** today the cleaners only run on the sender's own canvas output (Task 13), so no attacker can reach this. It becomes a memory DoS as soon as anyone calls `cleanImage` or `assertClean` on received or raw input.
- **Fix:** cap the piece count (for example 4096, then `unsupported`), or keep only the kept pieces and count the rest.

### M10. The JPEG cleaner accepts 4-component frames and always drops APP14 Adobe

- **Where:** `clean.ts:145`, `:183`.
- **What happens:** without the APP14 colour-transform flag, CMYK, YCCK and RGB-coded JPEGs decode with wrong colours. This is not a leak, and canvas output is always YCbCr JFIF.
- **Fix:** allow only `nf ∈ {1, 3}`, so that anything else is `unsupported` instead of silently changing colour.

## Notes (no action)

- Every kept JPEG segment (DQT, DHT, SOF, SOS, DRI) is checked to have no spare bytes. The PNG walker checks every CRC and refuses unknown critical chunks. Bytes after the end marker are dropped and `assertClean` treats them as `metadata`. Good.
- The redaction mean leaks one average colour per region, which roughly means how much ink was in it. This is inherent to P5-A26's look and negligible for regions the size of a word.
- The quantisation tables left in a canvas-encoded JPEG identify the browser engine, not the camera. This is acceptable.
