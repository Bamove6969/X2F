# Review: wip/lead-proof-popups (proof pop-ups P-007/P-008/P-010 + proof date G16 / field labels G17) — 10 Nov 2026

Reviewer: independent helper (privacy and correctness), read-only on code.
Branch: `wip/lead-proof-popups` at 7d0c6be5 in `/home/user/X2F/.claude/worktrees/proof-popups`
(main d421706c + merge 2d7cf5f3 of e5780990 + merge 9546e621 of 7b50096d + 7d0c6be5).
Owner rulings read: owner-decisions-2026-11-06.md (lines 19, 45, 60), owner-answers-2026-11-01-claude3.md (items 63/64/65, Q21),
owner-answers-2026-11-02-lead.md (blur rule, own-blur warning), owner-answers-page-2026-11-06.md (Q42, Q43, Q44),
owner-answers-page3-2026-11-07.md (G16, G17), owner-answers-register.md (P-006..P-022).

## Verdict

**Changes needed before it lands.** It is library-level only (nothing calls `uploadPrompts`, the pop-ups, `photoTakenAt`,
`proofDate` or the new `checkProof` argument outside tests; Plan 5 Tasks 15/16 owe the wiring), so nobody sees any of it
yet except one live change: review notes on the API (`apps/api/src/reviews/sensitive.ts` uses `detectSensitiveText`) now
refuse more text (finding 5). Two code fixes are needed (1, 2). Two results are stale compared with the owner's later rulings
and need owner calls (3, 4). Tests and typecheck are green.

## Runs

All through the serialised runner, from the proof-popups worktree:
- `npx vitest run --project @x2f/proof` detect, detect-labels, photoDate, codeBoxes, check, seal: **6 files, 241 tests passed**.
- `npx vitest run --project @x2f/web` proofPrompts, photoDate, cantDoThat-lint: **3 files, 29 tests passed**.
- `npx tsc -p packages/proof --noEmit`: clean. `npx tsc -p apps/web --noEmit`: clean.
- Not run: `apps/api/test/reviews-sensitive.test.ts` (not in the brief; it is DB-free and worth running before landing, see 5).
- My own probes (scratchpad scripts under `.../scratchpad/rv/`, run with tsx, no repo files touched): 20,000 random/hostile
  buffers through `readPhotoTime` (PNG, JPEG+Exif, junk): **0 throws**; timing probes below.

## Findings

1. **HIGH (engineering fix): catastrophic backtracking in the XMP element-form regex** (`packages/proof/src/photoDate.ts`,
   `xmpTime`): `<${f}>\s*([^<]{1,64})\s*</${f}>`. The `\s*` on each side overlaps `[^<]` (which also matches whitespace), so
   an opening `<xmp:CreateDate>` followed by a long run of whitespace with no closing tag is worse than quadratic. Measured
   (JPEG APP1 or PNG iTXt, one field): 1,000 spaces 70 ms, 4,000 spaces 1.5 s, 16,000 spaces ~19-21 s; it runs up to 3 times
   (one per XMP field) and a JPEG APP1 holds about 64 KB, a PNG iTXt any size, so a crafted file freezes the tab for minutes
   to hours. The input is the poster's own picked file (not a received one), so this is a self-DoS or "send this receipt
   image to your buyer" trap, not a data leak; still a hang on untrusted bytes. The nosemgrep reason itself is right (the
   pattern is built only from the constant `XMP_FIELDS`), but constant-built does not mean linear. Fix: drop both `\s*`
   (`<${f}>([^<]{1,64})</${f}>` and trim the capture, which the code already does), or find the tag with `indexOf` and
   read at most 64 characters; also consider capping how much XMP text is scanned. Add a timing test (e.g. 60 KB of spaces
   after the open tag in under 100 ms). The attribute branch is fine (measured 0.1-0.2 ms). `NUMBER_LABEL` and
   `LABELLED_VALUE` (detect.ts) are fine: their tails are all optional, so a match never fails after a greedy run and never
   backtracks; labels are escaped by `alternation()` from the constant `NUMBER_LABELS` (confirmed: no input reaches either
   nosemgrep regex). `detectSensitiveText` is O(n^2) on a long run of dots or `x`s (20,000 chars: 0.5-1.5 s), but that is
   the same with no label (main has it too), so it is not this branch's; note it if review notes are not length-capped.

2. **HIGH (owner call, recommendation below): the photo's own date overrides a stale date on the screenshot, on both sides.**
   `checkProof(..., takenAt)` and `proofDate` use `takenAt` *instead of* the OCR'd dates whenever it is present
   (check.test.ts line 244 pins it: OCR `Oct 2, 2026` + a fresh `takenAt` = `in-range`). A fresh metadata date is trivial to
   get for an old receipt with no tools at all: screenshot the old screenshot again, or photograph the screen; any editor
   crop also writes a new CreateDate. So item 63/Q42 ("No, ask for a fresh screenshot") is bypassed by the most ordinary
   reshare. On the seller's side it is worse: `takenAt` comes from the buyer's sealed payload, so a modified client can set
   any value, and `check.ts`'s own header ("nothing here trusts a value from the buyer except the `hidden` list") is no
   longer true. G16's owner words are about *where to look when there is no date* (EXIF first, then the screenshot); they do
   not say EXIF wins a conflict. Recommendation: out-of-range if EITHER source is out of range; `takenAt` decides only when
   the screenshot shows no date (and on the seller side treat it as the buyer's claim, never as clearing an OCR date).

3. **MEDIUM (stale vs. G16, merge not reconciled): two different date verdicts for the poster.** P-007's `uploadPrompts`
   calls `checkProof(words, expected, [])` with no `takenAt`, and `uploaderPopup`'s doc still says "no date found: ... the
   plan and the owner give no prompt for it" (docs/coordination.md repeats it under OWNER-Q). G16 (7 Nov) replaced that:
   warn the poster, allow posting, warn the seller. G16's `proofDate` + `posterDateLine` do that, but separately, with
   `takenAt`. Once Task 15 wires both, the poster can get the item-63 pop-up (OCR old) while `proofDate` says in range, or
   no pop-up while `posterDateLine` says "dated outside this trade". Also `posterDateLine`'s doc says "Posting stays allowed
   either way (... Q42 asks for a fresh screenshot)", but Q42 is "No" (the poster cannot send it), which is what
   `ProofNotCurrent` does. Fix: one date verdict (pass `takenAt` into `uploadPrompts`, after finding 2 is settled); item 63's
   pop-up for out-of-range (blocking, Q42); `posterDateLine` only for not-found; update the stale comments and the
   coordination note.

4. **MEDIUM (stale vs. Q43): the no-amount pop-up requires an explanation.** `ProofNoAmount`'s Send proof is disabled until
   the box has text, and its OWNER-Q ("required? who reads it?") is still marked open. Q43 (6 Nov, after the branch was built
   on 3 Nov) answers it: "the buyer can say yes and post it anyways". Recommendation: explanation optional, Send proof always
   enabled (owner to confirm). **Q43's "X2F keeps these to improve detection" is NOT built** (register P-008 states it as if
   it were part of the row): nothing stores or sends a no-amount proof or its explanation anywhere; `onSend(explanation)`
   hands it to an undefined caller. Good: no string claims it (I grepped the diff for improve/keep/learn/teach: none in
   copy). But item 64's own sentence "Please use the feedback tool below" implies the text reaches X2F; the box is not the
   feedback tool and has no destination yet. Keeping proofs for detection needs a privacy design (proofs are end-to-end
   sealed; X2F's server cannot read them) before anyone builds or promises it. Same for G17's "proofs teach the detector over
   the 30 days": not built, only a comment in numberLabels.ts, which is fine.

5. **MEDIUM (live user-visible change, owner call): review notes now refuse a payment word followed by an amount.** Because
   G17's labels include payment-method words, `detectSensitiveText` (used by the API to refuse review notes with personal
   details) now refuses: "Paid with Visa 1500 EUR, fast release" (card), "Sent via mobile 2500 MXN, great" (phone), "Paid by
   card 1000, thanks" (card), "card 2024 trade went smoothly" (card). These are ordinary feedback, not personal details.
   In proofs the F15 rule (a number after "Card" is the card even when it equals the amount) makes sense; in free-text
   review notes it is a false refusal. Recommendation: in `detectSensitiveText` require a number-ish tail for card/phone
   labels (`ending`, `no.`, `#`, a mask, or 6+ digits) or skip a number followed by a currency word/code; or keep it strict
   and accept the refusals. Owner/lead to choose; run `apps/api/test/reviews-sensitive.test.ts` either way.

6. **LOW (compat, decide before Task 15): `proof.attached` now REQUIRES `takenAt`** (`hasExactKeys` with the new key). An
   envelope without it is `bad-payload`, and an older client rejects new envelopes (extra key). Today nothing seals or opens
   `proof.attached` outside the package's tests (the API stores envelopes opaquely, the dispute/staff code never parses
   them, `receive.ts` checks image bytes only and does not touch the payload), so no stored data breaks. It matters only for
   version skew after Task 15 ships (a cached old web client). Recommendation: accept a missing `takenAt` as null when
   parsing, keep writing it always. Naming nit: trades already use `takenAt` for when the trade was taken
   (`apps/moderation/src/shadow.ts`, `apps/api/src/disputes/staffRoutes.ts`); `photoTakenAt`/`madeAt` would avoid confusion.

7. **LOW (privacy, confirmed mostly good): what leaves the device.** `photoTakenAt` returns only a UTC string; `exifTags`
   reads only ASCII tags from the Exif IFD (GPS IFD, maker notes, device, ModifyDate are never read), and the parse result is
   a time, so no GPS/device field can reach `proof.attached` (web test "gives only a UTC time" checks it). Bounds: every PNG
   chunk/JPEG segment length and IFD offset is checked, IFD count capped at 512, block walk capped at 4096, ASCII values
   capped at 64; fuzz found no throw. Two small points: (a) it is a time to the second, not a date; the check has 14 h of
   slack, so rounding to the minute or hour would lose nothing (the screenshot itself usually shows the time, so the gain is
   small; lead call); (b) `photoTakenAt` reads the whole picked file into memory before any size cap; cap it at the proof
   input limit. Time zones: an offset tag is honoured; no offset is read in the device zone (stated), and invalid offsets
   fall back to the device zone; DST gaps shift an hour at most, inside the slack. Correctness gaps (minor): XMP
   `photoshop:DateCreated` is often date-only (`2026-10-16`) and is rejected (a date-only value could count as the whole day);
   field names have no left boundary (`foo:xmp:CreateDate=` matches); HEIC/WebP give null (fine: OCR fallback).

8. **LOW: `codeBoxes` is per line only.** `checkProof` finds a trade code wrapped onto the next line (review N1), but
   `codeBoxes` does not box a wrapped code, so an own blur over a wrapped memo gives no `PROOF_MEMO_HIDDEN` warning. Trade-code
   matching otherwise reuses `codePattern` (any case/grouping, Crockford look-alikes) and boxes only the code's characters;
   tests cover that. Overlap test is strict (touching edges do not count): fine.

9. **Copy and claims (item 3 of the brief).** Every new string carries `COPY-UNSIGNED`: the four in ProofPrompts.tsx, the
   titles/labels/buttons (one marker per Sheet), and the four date lines in check.ts (plus a TODO(design)). Item 63 and 64
   texts are the owner's words verbatim except "[or whatever it is on the screen]" dropped; the own-blur amount line is the
   owner's 2 Nov draft. Not the owner's words: `PROOF_MEMO_HIDDEN` (flagged OWNER-Q; note Q44 is superseded by P-020, which
   asks for a system heads-up IN THE CHAT, not a poster warning, so this line may not be wanted at all), the item-65
   disclaimer, and all four G16/Q42 date lines (G16 asks design for wording; the seller line follows his meaning: "does not
   mean it is not valid ... extra caution"). Claims of unbuilt features: `posterDateLine`'s "the seller will be told to take
   extra care" is true only once Task 16 renders `proofCardLines` with the same date verdict (see 2/3); nothing else claims
   a feature not built. The own-blur strings say "the seller", which is wrong if a seller ever posts `kind: 'evidence'` through
   the same editor (low; Task 15 should pick the other party's role). The cantDoThat ratchet 61 -> 62 is justified in the test.

10. **Tests.** Meaningful overall: photoDate covers LE/BE TIFF, offsets, fallback order, IFD0 ModifyDate never read, PNG
    eXIf, iTXt (compressed skipped), XMP both forms, truncated/hostile bytes; seal covers takenAt shape and missing/extra
    keys; detect-labels covers the label kinds and F15 amount collision; proofPrompts covers the popup choice, overlap edges,
    and each component's text and buttons. Missing: a timing/ReDoS test for XMP (1); a test that a stale OCR date is not
    cleared by `takenAt` (2: today a test asserts the opposite); a test that `uploadPrompts` and `proofDate` agree (3); a
    review-note false-positive test (5); a date-only XMP case (7).

## Owner questions

- **OQ1 (finding 2):** When the photo's metadata says "today" but the screenshot visibly shows an old date, which wins?
  Recommendation: the proof counts as out of date if either says so; the metadata date only decides when the screenshot shows
  no date.
- **OQ2 (finding 4, Q43):** Is the explanation in the "amount not found" pop-up optional? Recommendation: optional, Send
  always allowed (your Q43 words). And where should it go: the seller with the proof, the moderator, or X2F's detection
  feedback? "X2F keeps these proofs to improve detection" is not built and needs a privacy design first, because proofs are
  sealed so X2F cannot read them.
- **OQ3 (finding 5):** Should review notes be refused for "Paid with Visa 1500 EUR" or "Sent via mobile 2500 MXN"? The new
  field-label rule treats them as a card and a phone number. Recommendation: no; apply the strict rule to proof screenshots
  only, or require "ending"/"no."/a mask after card and phone words in notes.
- **OQ4 (finding 9):** The "note with this trade's code is hidden" warning to the poster: keep it, or only the system
  heads-up in the chat that P-020 asks for?
- Lead (not owner): finding 6 (accept a missing `takenAt`), 7a (round `takenAt`), the naming nit.

## Re-verify 525c1bf7

Branch `wip/lead-proof-popups` at 525c1bf7 (seven commits on 7d0c6be5), worktree clean. **Verdict: findings 1-8 are closed.
Ready to land as far as engineering goes.** Four lead defaults wait on the owner (p11-140, -141, -142, -143), and one narrow
residue of finding 5 remains (below). I found no weakened tests: every removed `expect` was replaced by a matching or
stricter one (the old pinned `Oct 2 + fresh takenAt = in-range` is now asserted `out-of-range`; `send.disabled` became
"sends with an empty explanation"; the `uploadPrompts` calls gained the `takenAt` argument).

Runs (serialised runner): `@x2f/proof` detect, detect-labels, photoDate, codeBoxes, check, seal: **6 files, 253/253 passed**.
`@x2f/web` proofPrompts, photoDate, cantDoThat-lint: **3 files, 32/32 passed**. `@x2f/api` reviews-sensitive: **1 file,
4/4 passed**. `tsc --noEmit` is clean for packages/proof, apps/web and apps/api.

- **F1 closed (a9db320f).** The element form now uses `xmpElement` with `indexOf`. Each open tag scans only to the next `<`
  and is checked against the field's own close tag, so total work is linear. The attribute regex has no overlapping
  quantifiers. I re-ran my probe from the first review: 16,000 and 60,000 spaces after an open tag now take 0.1-1.2 ms
  (before: about 20 s at 16,000), a 1 MB iTXt 2.4 ms, a 4 MB file of repeated tags 11 ms. The file is now read through a
  generator over byte ranges:
  - only block headers and the bodies of PNG eXIf/iTXt and JPEG APP1 are read;
  - a block over 256 KB is skipped unread;
  - at most 1 MB is read in total (the sync `readPhotoTime` has the same budget);
  - `photoTakenAt` reads through `Blob.slice`, and any rejection becomes null.

  The tests are real. One hits the old pathology (20,000 spaces per field in JPEG and PNG) with a 50 ms bound; the old code
  took seconds, so the margin is wide, though it is a wall-clock assertion on a shared box. Byte-counting readers prove that
  a 4 MB JPEG scan or PNG IDAT is never read (total under the segment size + 64/200 bytes). An oversized chunk is skipped
  having read under 4 KB. The web spy Blob counts the bytes handed out: under 1 KB for a 4 MB JPEG.
- **F2 closed (36bcb6bd, `DATE_OUT_OF_RANGE_IF_EITHER = true`, owner p11-140).** `combineDates`: out of range if either the
  photo time or a screenshot date is out of range; the photo time decides only when the screenshot shows no date. The
  check.ts header now says the photo time is the buyer's claim. Setting the flag to `false` restores the 7 Nov behaviour.
- **F3 closed (36bcb6bd, `POSTER_BLOCKED_WHEN_OUT_OF_RANGE = true`, owner p11-143).** `uploadPrompts` takes `takenAt` and
  returns the same `date` that `proofDate` and the seller's `checkProof` give. A test loops over shots × times and asserts
  `not-current` exactly when that verdict is `out-of-range`. Out of range blocks even when the screenshot is unreadable.
  The stale "no prompt when no date" comments are fixed; no date found gives `posterDateLine` and posting stays allowed (G16).
- **F4 closed (fcca7a45, `PROOF_EXPLANATION_REQUIRED = false`, owner p11-141).** Send proof works with an empty box, and a
  TODO states plainly that the explanation goes nowhere and that Q43's "keeps these to improve detection" is not built and
  needs a privacy design. No string claims it.
- **F5 mostly closed (a10de7e7, `REVIEW_NOTE_NUMBER_LABELS = ['iban','account']`, owner p11-142).** Notes no longer refuse
  "Paid with Visa 1500 EUR", "Sent via mobile 2500 MXN" or "Paid by card 1000" (all tested). Real card and phone numbers
  are still refused by their shape, and "Acct 4821" still counts. **Residue (low, add to p11-142):** the account list also
  holds payment-rail words, so these notes are still refused as `account`: "Paid via SWIFT 2000 EUR, slow", "Paid to
  account 2500 MXN fast", "Sent from my conta 1500 BRL". The same fix applies: drop the rail words
  (`swift`, `bic`, `routing`, `aba`) from the notes set, or skip a number followed by a currency code.
- **F6 closed (9d1eb60b).** The field is renamed `photoTakenAt`, and a missing one parses as null. The old `takenAt` key is
  refused cleanly: it is an extra key, so `ProofError('bad-payload')`, and `{...attached, takenAt: null}` is refused too
  (tested). Nothing outside the package parses `proof.attached`, so no receiver or dispute view changes. One minor
  behaviour: an own property set to `undefined` also parses as null, which JSON cannot produce anyway.
- **F7 closed (0dfaf916).** Times are rounded down to the minute (`toUtcMinute`, and `isUtcMinute` refuses non-zero
  seconds), well inside the 14 h slack. Only the date tags are still read. Not done, and not required: date-only
  `photoshop:DateCreated` is still rejected, and field names still have no left boundary.
- **F8 closed (525c1bf7).** `codeBoxes` joins each pair of adjacent lines (with nothing and with a space between) and
  boxes each part of a code that crosses the line break on its own line. Tested.
