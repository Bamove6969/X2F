# Plan 5 security review record

This file records Plan 5's measured security properties and accepted residuals. Each task adds its own section.

## Task 13: on-device OCR for the proof blur (`wip/lead-proof-ocr`)

### Supply chain (checked 2026-11-12, at install)

| Package | Version | Published | Licence |
|---|---|---|---|
| `tesseract.js` | 7.0.0 | 2025-12-15 | Apache-2.0 |
| `tesseract.js-core` | 7.0.0 (also pinned by root `overrides`) | 2025-12-15 | Apache-2.0 |
| `@tesseract.js-data/eng` | 1.0.0 | 2023-09-04 | MIT |
| `@tesseract.js-data/rus` | 1.0.0 (added 2026-11-12, the Cyrillic second pass) | 2023-09-04 | MIT |

Install command: `npx -y npm@11.21.0 install --save-exact --ignore-scripts`. The repo `.npmrc` keeps `ignore-scripts=true` and `min-release-age=14`. `tesseract.js`'s `postinstall` (`opencollective-postinstall`) never runs.

Resolved tree (`npm ls --all -w @x2f/web`, the `tesseract.js` subtree; `npm ls --all tesseract.js` prints only the path to it):

```
tesseract.js@7.0.0
+-- bmp-js@0.1.0                    (2018-04-23)
+-- idb-keyval@6.3.0                (2026-07-08)
+-- is-url@1.2.4                    (2018-03-26)
+-- node-fetch@2.7.0                (2023-08-23)
| +-- UNMET OPTIONAL DEPENDENCY encoding@^0.1.0
| `-- whatwg-url@5.0.0              (2017-05-26)
|   +-- tr46@0.0.3                  (2016-01-20)
|   `-- webidl-conversions@3.0.1    (2016-01-04)
+-- opencollective-postinstall@2.0.3 (2020-05-29)
+-- regenerator-runtime@0.13.11     (2022-11-14)
+-- tesseract.js-core@7.0.0 deduped (2025-12-15)
+-- wasm-feature-detect@1.9.0       (2026-08-11)
`-- zlibjs@0.3.1                    (2017-07-06)
```

- Every package was published more than 14 days before 2026-11-12.
- `node-fetch` and `idb-keyval` appear in no browser chunk.
- `npm audit --omit=dev` reports 0 vulnerabilities (2026-11-12).
- `@tesseract.js-data/rus` has no dependencies or install script. Its `4.0.0_best_int/rus.traineddata.gz` is served as `/ocr/rus.traineddata.gz`. Its SHA-256 `f51f5edc…101f6a` comes from `rus-1.0.0.tgz` (`npm pack`), and the build fails on any difference, as for the other five files. `npm audit --omit=dev` still reports 0 vulnerabilities.
- `tools/ocr-assets.sha256` was computed from the npm tarballs themselves (`npm pack`). The lockfile's sha512 integrity matches the registry. The independent review (comms/review-proof-ocr-2026-11-12.md) re-did this check.

### Name recall (measured 2026-11-12)

How it was measured:
- `apps/web/e2e/proof-ocr.spec.ts` ran in Chromium on the fixtures-mode build.
- It used the real self-hosted tesseract.js 7.0.0 with the `eng` `4.0.0_best_int` model.
- The receipts are made up. They are rendered as PNG or JPEG by `apps/web/e2e/fixtures/proofs/make.ts`, and their ground truth is the laid-out box of each marked span.
- A name counts as covered when the automatic regions cover at least 98 % of its glyph band.

| Layout | Fixtures | Covered | Recall |
|---|---|---|---|
| Name after a label (bank, dark mode) | bank-labelled, dark-labelled | 2/2 | 100 % |
| Big name at the top, no label (Zelle, Cash App, Venmo style) | top-name, venmo-style | 2/2 | 100 % |
| Avatar caption, no label (Wise, Revolut style, and an avatar whose initials are not read) | avatar-caption, revolut-style, wise-style | 3/3 | 100 % |
| **All Latin-script names** | 7 fixtures | **7/7** | **100 %** |
| Non-Latin name at the top (Cyrillic "Анна Петрова"), with the Russian second pass | cyrillic-top-name | 1/1 | 100 % |

Without the Russian second pass, the Cyrillic name scored 0/1 (`90c476e7`): the English model reads it as `AHHa lNMeTpoBa`.

Before the layout rules (Task 13 as first built, `aa0993e1`), names with no label scored 0/2: top-name 0/1 and avatar-caption 0/1.

Every card number, IBAN, email and phone number in the fixtures was covered. The trade amount and the trade code were never covered, in every fixture. Both hold as hard assertions in the e2e spec.

**How names with no label are found** (`packages/proof/src/layoutNames.ts`, from the OCR word heights and positions):
- A line of 2–4 name-shaped words near the top (within the first 45 % of the text's height) whose glyphs are at least 1.3 × the page's typical line height.
- An avatar's initials alone on a line (1–3 capitals), and the line under them whose initials they are. Both lines are blurred.
- The topmost line, name-shaped and at least 1.1 × the typical height. This is an avatar caption whose initials the OCR did not read: white letters on a coloured circle often are not, as in avatar-caption.jpg.
- "Name-shaped" means letters only (any script), each word starting upper case where the script has case, and no word from a list of app, heading and status words ("Payment sent", "Cash App", "You Paid", ...).
- No candidate line may contain a digit, a currency sign or `@`. Every kept character (the amount, the code, dates) stays blanked before any region is placed, as for every other class.

**Lead call on review m-5 (2026-11-12):** a prominent standalone name line is blurred by default. Unblurring is one tap; a leaked name cannot be taken back.

### Cost (measured 2026-11-12, production build)

| What | When | Size |
|---|---|---|
| Entry chunk (`index-*.js`) | every page | 1,817,532 B (581,308 B gzip); base `bde8310f` was 1,814,851 B (580,294 B gzip): +2,681 B (+1,014 B gzip) |
| `ocr-*.js` (the wrapper, lazy) | first proof | 2,036 B (1,155 B gzip) |
| tesseract.js chunk (lazy) | first proof | 14,236 B (5,867 B gzip) |
| `/ocr/worker.min.js` | first proof | 111,307 B |
| One core, `/ocr/tesseract-core-relaxedsimd-lstm.wasm.js` on Chromium (SIMD or plain elsewhere) | first proof | about 3.9 MB |
| `/ocr/eng.traineddata.gz` | first proof | 2,952,873 B |
| `/ocr/rus.traineddata.gz` | only when the English pass reads Cyrillic garbage | 2,679,598 B |

- The second worker loads its own copy of the core and the English model. The browser's HTTP cache serves those again: the static server sends an ETag, so at most a 304 revalidation. Its own download is the Russian model only.
- Both workers stay alive for later proofs in the same tab.
- The full e2e run makes these requests, and a Latin-only run never requests `rus.traineddata.gz` (tested).

### Accepted residuals and known limits

- **Non-Latin names: Cyrillic only.** English OCR runs first.
  - When its words look like Cyrillic read in Latin look-alikes, a second worker reads the page with English and Russian (`eng+rus`), and those words are used. That is `looksCyrillicGarbage`: at least two all-look-alike words with case no real word has, such as `AHHa`, `lNMeTpoBa`. Brands like `PayPal`, `iPhone` or `McDonald` do not trigger it.
  - A second pass that fails or hangs (its own 30-second timeout) keeps the English words.
  - The trigger reads only the OCR words. The trade's currency or method is not used: `Keep` does not carry them, and `ProofImageDeps.ocr` receives only pixels.
  - Other scripts (Greek, Arabic, CJK, ...) still read as garbage and are not blurred by layout. The sender reviews every blur. Other models are deferred (roadmap).
- **OCR misses.** On venmo-style.png the OCR did not read the large centred `$412.50` at all. That costs nothing for privacy: a line that is not read cannot be covered, and the amount must stay visible anyway. But the own-blur warning cannot see the amount there. The e2e records such misses (`ocr-missed`) instead of failing.
- **False positives.** A large two-to-four-word Title Case line near the top that is not a name, and not in the list of app and heading words, is blurred. This is accepted by the lead's call above.
- **Small sample.** These are 8 synthetic receipts. The numbers show the rules work on real OCR output, not real-world recall. No real person's receipt is ever committed.
- **Review items carried with this record:**
  - m-2: a worker whose load hangs or fails is terminated through the patched `spawnWorker`'s `onSpawn`.
  - m-3: a result with no blocks counts as "could not check".
  - m-4: `.gz` counts as a file extension only under `/ocr/`.
  - I-1 to I-6 are accepted as described in the review.
