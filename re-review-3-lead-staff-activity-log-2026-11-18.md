# Re-review 3: wip/lead-staff-activity-log fd550c23 (review-first training library)

Reviewer: independent helper (rev-actlog), 18 Nov 2026, about 12:20 BC time.
Range: 86f8b2c5..fd550c23, 6 commits (d051c463 and 35265dc2: the anonymizer; 8f166482 and f8528f20:
the API curation, migration 750 and m4; 06ec3530 and fd550c23: the staff-web review pages).

## Verdict: CHANGES NEEDED (one blocker: the curator's approval does not hold)

What is fixed:
- **Round-2 B1 is fixed.** I ran activityLog.test 5 times and every run passed. Ordinary prose
  keeps its words.
- **Routes:** the curator routes are correct.
- **Key handling:** m4 is done.
- **Run time:** the 20k cap holds (worst case I found: 93 ms).

The blocker: the review-first design promises that readers see only what a curator reviewed, and
that the case is hidden when that changes. It does not keep that promise. Only the text under a
manual range is checked. Any change elsewhere is served to every moderator without review: a field
with no manual mask, or the rest of a field around a range. That includes any change in what the
anonymizer masks. B1 below has the details.

## Tests run (outside the lock, nice -n 10)

- `@x2f/staff`: 11 files, 327 passed.
- `@x2f/staff-web`: 12 files, 123 passed.
- `@x2f/api` test/staff/ + log.test.ts + schema.test.ts: 20 files, 524 passed.
- activityLog.test.ts on its own, 5 runs: 28/28 passed each time. Round-2 B1 is gone: the test now
  uses fixed names, a fixed code and a fixed address.
- Mutation check: I removed the tag comparison (training.ts:204). The test "fails closed: ... hidden
  until it is curated again" then failed. Reverted afterwards.
- Not run: Playwright and the full `npm run check` (excluded by the brief). The review pages have
  no Playwright spec.

## Findings

### B1. Curation is fail-open for every text a manual range does not cover
`apps/api/src/staff/training.ts:192-214` (`curated`). Two gaps:
- Line 201: `if (ranges.length === 0) continue;`. A field with no manual mask is never checked.
- Lines 202-205: in a field that has ranges, the tag covers only the characters under each range.
  Text before or after a range can change freely as long as the range's own slice still matches.

Shown with a temporary test inserted after "a case reads through ...", then removed:
- Append `TAIL-SENTINEL John Smith` to the marked case's note, after its manual range.
- Append `PAYER-SENTINEL John Smith` to its ruling reason, a field with no manual mask.
- Result: `GET /staff/v1/training/:id` as a moderator returns 200 with both sentinels.

Updating the stored text directly stands in for the real triggers:
- **An anonymizer change that masks less.** This happened in this very round: round 3 stopped B1's
  over-masking, so text that was hidden becomes visible. With today's code, a case curated under the
  old anonymizer would show that newly visible text to every moderator without re-review, unless a
  manual range happened to sit over exactly that spot.
- **Masking input that changes.** For example, the staff list in `caseNames` or a name change.

The design comment (training.ts:43-45) and the migration comment promise that the case is "hidden
until it is curated again" when "the automatic masks change under it". That promise holds only in
the existing test's case, where the change shifts a range.

Fix (engineering):
- At PUT time, store one HMAC per field over the field's whole pre-masked text (`maskTag(key,
  field, s.text)`), for every field, plus a tag over the sorted list of field names.
- On read, hide the case if any field's tag differs, if a field was added or removed, or if a
  range's tag differs.
- Close the GET-to-PUT race (m1) the same way. GET `/review/:id` returns a `reviewTag`, which is
  the HMAC of all the pre-masked fields. PUT must send it back, and the server answers 409 if it no
  longer matches.
- Add a test that changes a field with no manual masks, and one that changes a field after its
  range. Both must hide the case.

### m1. The masks the curator saves can be re-tagged against text they never saw (GET-to-PUT race)
`parseMasks` (training.ts:217-249) computes the tags from the server's current pre-masked text at
PUT time, not from the text the curator reviewed.

Failure scenario:
1. The curator opens a case.
2. A deploy changes the anonymizer, or a name list changes.
3. The curator saves.
4. The ranges are now applied to different text, and the new tags match that text, so the case is
   listed as marked.

The fix is the `reviewTag` in B1.

### m2. A span that starts inside an earlier span's source character is dropped, not clamped
`packages/staff/src/anonymize.ts:530`: `if (s.start < at) continue;`. A character that folds to
several units (`ß` to `ss`, `ẞ`, `ﬀ`) can end one span and start the next. The second span is then
dropped entirely, and all of its text shows.

Shown with the known code `S123-4567-89AB-CDES` written twice and sharing a `ß`:
`S123456789ABCDEß123456789ABCDES` comes out as `XXXX-XXXX-XXXX-XXXX123456789ABCDES`, so 15
characters of the case's own code show. This is contrived, and the curator would see it, but it is
a fail-open path.

Fix: when `s.start < at` and `s.end > at`, set `s.start = at` and still mask the rest; or merge it
into the previous span. Add the case above as a test.

### m3. The curator's list stops at 200 and has no paging
training.ts:285 (`REVIEW_LIST_MAX`). Closed cases older than the newest 200 cannot be reached
from the page, so they can never be curated. This is acceptable for now; page it (keyed on closed_at
and the dispute) before the library grows. The `findForCurator` scan (training.ts:82-87) is owner-only
and costs O(N) per open. Neither blocks.

### m4. Names and other values the anonymizer still misses (fresh probes; the curator is now the safety net)
Still unmasked:
- **Names:** a display name's first part alone (`Mira paid` for `Mira Kowal`), the parts reversed
  (`Kowal Mira`), initials (`M. Kowal`), 3+ letter suffixes (`Kowalska`, stated as later work),
  and an inflected Cyrillic name (`Миры`).
- **Codes and amounts:** another trade's code with mixed separators (`H7YA-W3PY NMPF.WFJ3`), half a
  tx id (28 hex), spelled-out phone numbers, `1432h` and `14.32 CET` as times, and `1 . 2345 XMR`
  (it leaves `1 . [amount]`).
- Reversed text (`‮k.arim`) now comes out as `[link]`. That is over-masked, so it is safe.

Over-masking of prose stays small. `Version 2.3.1` becomes `[ip]` and `#CB-2026-11-004417` becomes
`[phone]`. PayPal-style ids and bank references under 20 characters keep their words.

Recommendation (engineering): mask each part of a multi-part display name of 3 or more letters on
its own. That one change catches first-name, reversed-order and initials mentions.

### m5. A text over the cap is cut at a space, so an identifier can be cut in half
`cutAt` (anonymize.ts:501-508). An identifier that straddles the cut keeps its first part
unmasked, because that part is no longer whole. Examples: a split address, `Mira | Kowal`, an
IBAN with spaces.

Today's server texts are at most 4000 characters, so this only matters for the future chat scrub
in the browser. Fix: run the masks on the whole text first and replace the tail afterwards. With
the cap it is linear anyway; or cut back to the start of the last word plus its split pieces.

## What I checked and found sound

- **Order of auto and manual masks:** the auto masks run first. Manual ranges are offsets into
  the auto-masked text, applied through `applyManualMasks`, which refuses overlapping masks, ranges
  out of bounds, and any range that cuts an automatic mask. `parseMasks` makes the same checks
  (400, tested).
- **Stale on shifted ranges:** a range that is out of bounds, a tag mismatch, or a stored field
  that no longer exists all hide the case (404 to readers, `stale` to the curator).
- **Whole-field masks:** a whole-field mask replaces the field with `[hidden]` and ignores the
  field's ranges. Nothing of it can show.
- **Permissions:** `training.curate` is in PERMS, the owner holds it by role, and it is not in
  GRANTABLE_PERMS (roles.test.ts updated). The four curator routes are in test/staff/routes.ts as
  OWNER, and the matrix passes. A moderator gets 403 on DELETE (tested). Readers only ever read
  through the stored `training_id` (one indexed lookup).
- **Logging:** `staff.training-marked` (`masks` count) and `staff.training-unmarked` are `staff.*`,
  so they are an owner-only kind. They carry `tradeCode: null` (R37: the curator is not involved),
  and the detail is the opaque id only. The test checks that a moderator's log does not include them.
- **The 200 caps:** `MAX_MASKS` = 200 per case, checked before parsing. `REVIEW_LIST_MAX` = 200 (m3).
- **The mask tag key:** it is the training-id key with domain separation (`x2f/training-mask\0`
  vs `x2f/training-id\0`, and the field name before the text, so the inputs cannot collide). A
  separate key isn't needed:
  - both are server-side integrity values with the same holder;
  - tags never leave the server (GET strips them);
  - the covered text is in the disputes table anyway, so the key protects nothing more by being separate;
  - rotating the key changes the ids and hides every curated case until it is curated again,
    which is fail-closed.
- **Migration 750:** `on delete cascade` from disputes, so the Task 23 purge removes the curation
  row. `training_id` is unique, its shape is checked, and the masks must be a JSON array. The
  covered text is never stored (the test greps the stored JSON).
- **m4 from round 2:** the public development key is refused on mainnet even when set explicitly
  (`timingSafeEqual`, schema.test.ts:648-650).
- **Run time:** at 20k characters, over 21 adversarial patterns (`a-`, `a.`, `Ab.`, `㏂`, `ß`,
  `İ`, a name repeated...), the worst was 93 ms (`Ab.`) and most were 8 to 22 ms. The cap bounds the
  growth.

## The work stated as later: does any of it need to block now that a person curates?

None of it blocks, provided B1 is fixed. Each item is visible to the curator, so it is caught at
review time:
- reversed text: now over-masked as `[link]`;
- 3+ letter suffixes;
- the curator's O(N) scan of closed disputes: owner-only.

The missing Playwright spec for the review pages should be written before release, because the
selection-to-offset mapping in the browser is exactly where a mask could land one character off.
It is not a landing blocker, because the API refuses bad ranges and a mis-placed range shows up to
the curator straight away.

## Owner questions
None new. B1 is engineering: it makes the lead's own spec (hidden until curated again) true.
