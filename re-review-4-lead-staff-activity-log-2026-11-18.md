# Re-review 4: wip/lead-staff-activity-log 2e2af0c0 (curation fail-closed, reviewTag, anonymizer m2/m4/m5, e2e)

Reviewer: independent helper (rev-actlog), 18 Nov 2026, about 13:10 BC time.
Range: fd550c23..2e2af0c0, 5 commits (6bb92c44 and 42ff73d0: the anonymizer; f5d4b4bc and b94a8499:
curation and the reviewTag; 2e2af0c0: training-review.spec).

## Verdict: APPROVE WITH MINORS

- **Round-3 B1 is fixed.** Every probe I ran against curation fails closed, my round-3 probe and
  each variant the coordinator asked for.
- **m1 (reviewTag) is fixed.** The tag is refused when it is stale or forged.
- **m2 (dropped masks) is fixed.** Overlapping spans are now clamped.
- **m4 (names, times, amounts) and m5 (the cut) are fixed.**
- **The new e2e proves the offsets.** A mutation shows it catches a code-point versus UTF-16 mistake.

What remains is nits and false negatives that the curator now sees. None blocks.

## Tests run

All runs outside the lock used nice -n 10.
- `@x2f/staff`: 11 files, 332 passed.
- `@x2f/staff-web` vitest: 12 files, 124 passed.
- `@x2f/api`, test/staff/ + log.test.ts + schema.test.ts: 20 files, 526 passed.
- activityLog.test.ts, 5 separate runs: 30/30 passed each time.
- **Playwright staff-web, whole suite, under `~/x2f-comms/check.lock`**
  (`X2F_CHROMIUM_PATH=/opt/pw-browsers/chromium`): 12 passed. The parity pixel differences are
  reported as not blocking, as before (StaffLog 13.6%, ModQueue 12.5%, ModCase 17.8%, OwnerSetup 8.3%).
- **e2e mutation, under the lock.** I changed `selectionIn` (Training.tsx:330) to count code
  points instead of UTF-16 units. training-review.spec then failed 1 of 4 tests (the
  multi-byte-then-mask test). I reverted it afterwards.
- **Not run:** the full `npm run check`. The brief asked for targeted runs only. The 13 Nov rule
  wants a full check before landing; I leave that to the lead.

## Fail-closed probes

Each probe was a temporary test that I removed afterwards. Each one changes the stored text or the
anonymizer's inputs of the curated case C, then reads it as a moderator. A read either succeeds (200)
or is hidden (404).

| Change | `GET /training/:id` |
|---|---|
| none (baseline) | 200 |
| round 3: text appended to the note after its manual range | 404 |
| round 3: text appended to the ruling reason, a field with no manual mask | 404 |
| restored | 200 |
| an evidence line added (a field added) | 404 |
| every evidence line removed (a field gone) | 404 |
| curated again with 2 evidence lines | 200 |
| the 2 evidence lines swapped (reordered) | 404 |
| swapped back | 200 |
| **anonymizer-input-only change:** a staff member renamed to "Screenshot" (a word in the evidence), with no case text edited | 404 |
| renamed back | 200 |
| a stored `field_tags` with an extra key | 404 |
| a stored `field_tags` with one key replaced by `constructor` | 404 |

The rename is a real anonymizer-only change: it adds a staff name, so the pre-masked text changes
while no case text changes.

PUT with the reviewTag:

| Request | Result |
|---|---|
| a reviewTag taken before the note changed | 409 `case-changed` |
| the same old reviewTag after the note was reverted | 200 (the texts are identical again, so this is correct) |
| a forged reviewTag (`f` × 64) | 409 |

## Tag construction (training.ts:69-88, 216, 388)

- **Field tag.** It is `HMAC(key, "x2f/training-mask\0field:<field>\0<whole pre-masked text>")`.
  The range tags use the same label but `<field>` without the `field:` prefix. Field names are
  fixed (`note`, `ruling.N.reason`, `ruling.N.evidence.I`, `appeal`), none starts with `field:`, and
  none contains `\0`, so the two input families can't collide. Everything after the second `\0` is
  the text, so a `\0` in a text can't shift the boundary.
- **Review tag.** It is `HMAC(key, "x2f/training-review\0" + JSON.stringify(sorted [field, text]
  pairs))`. That encoding is canonical: JSON escapes the strings, and the pairs are sorted by field.
- **Training id.** It is `HMAC(key, "x2f/training-id\0<code>\0<seq>")`.
- **One key is fine.** All three share the training-id key under distinct labels. None of these
  values has a second holder, and the field and range tags never leave the server.
- **The field list is checked.** The stored key count must equal the current field count, and every
  stored key must match, so an added, removed or renamed field fails (probes above).
- **Comparisons use `!==`, not constant-time.** No caller can turn that into an oracle:
  - field and range tags are never sent to a client;
  - the reviewTag is given to its only submitter (the owner) by GET, so timing it gains nothing
    the owner can't simply GET again.
- **Forgery and replay.** A forged tag fails: it needs the key. A replayed tag is accepted only if
  every pre-masked field of that case is byte-identical to the texts it was made for. The tag is not
  bound to the case (nit 2), so it could be replayed onto another case, but only if that case's
  texts are identical too, in which case the masks are correct for it anyway.

## Anonymizer (fresh probes on 42ff73d0)

- **m2 (dropped masks), fixed.** `S123456789ABCDEß123456789ABCDES` comes out as
  `XXXX-XXXX-XXXX-XXXXXXXX-XXXX-XXXX-XXXX`: both copies are masked, so the clamp works.
- **m4 (names), fixed.** These are masked now: a display name's parts alone or in either order
  (`Mira`, `Kowal`, `Kowal Mira`), `Kowal's`, `Kowalem`, `1432h`, `14.32 CET`, `14h32`,
  `1 . 2345 XMR`, `XMR1.2345`, `1,2345 XMR` and `1.2345 monero`. Fiat amounts and dates are kept.
- **m5 (the cut), fixed.** An address next to the 20k cut, whole or split by a space, ends up in
  `[long text]`, never half-shown. A text of 30 000 characters with no space becomes `[long text]`
  as a whole.
- **Timing.** Worst case is about 100 ms (`Ab.` repeated at 21k and at 100k characters, since the
  masks read up to 21k), not about 10 ms. Most patterns take 9 to 36 ms. The cap bounds it at every
  length.

## Minors

1. **Some values are still not masked; the curator sees each one.** None blocks.
   - an initial with its full stop (`M.` in `M. Kowal`), and `M.K.`;
   - a 3+ letter suffix (`Kowalska`): stated as later work;
   - another trade's code with mixed separators (`ZF3T-NT05 33RA.XQ5P`);
   - the times `2.30pm` and `14 32`, and spelled-out times or amounts;
   - `1.2345 ɱ`.
   Reversed text is still over-masked as `[link]`, which is safe.
2. **The reviewTag is not bound to the case** (training.ts:83-88). Prefix the HMAC input with the
   training id. This is defence in depth only, since replay needs identical texts (see above).
3. **The field-tag domain relies on a `field:` naming convention** (training.ts:78-80). A distinct
   label (`x2f/training-field\0`) would make the separation independent of the field names.
4. **e2e scope** (training-review.spec.ts). The spec covers:
   - a left-to-right drag after an emoji and an accented letter;
   - a drag after an automatic mask;
   - refusal of a cut into an automatic mask;
   - a whole-field mask;
   - mark, unmark and stale.

   The API is stubbed, so the spec shows the browser sends the right offsets, and the API tests
   show the server applies them. Not covered: a right-to-left drag, a double-click word selection,
   and a selection that starts inside an existing `<mark>`. Recommend adding the right-to-left drag
   (one line).
5. **Still later work.** These were stated by the fixer, and I agree none blocks now that a
   person curates:
   - the curator's O(N) scan of closed disputes and the review list's 200 cap with no paging;
   - the 3+ letter suffixes;
   - reversed text.

## Owner questions
None.
