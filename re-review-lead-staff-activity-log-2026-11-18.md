# Re-review: wip/lead-staff-activity-log 86f8b2c5 (fixes for review-lead-staff-activity-log-2026-11-18)

Reviewer: independent helper (rev-actlog), 18 Nov 2026, about 11:40 BC time.
Range: a19cd082..86f8b2c5, 4 commits (bcba4033 red tests, 2eb11e4c anonymizer, 2d65f61e api, 86f8b2c5 staff-web).

## Verdict: CHANGES NEEDED (one blocker: a test that fails about half the time)

Every item from the first review was addressed:
- M1, M2 and M3 are covered by the new anonymizer.
- m1: training ids are now keyed with HMAC, the list shows the month only, and the amount is rounded.
- m2 to m5: paging and limit parsing are strict, and the actor list now excludes owner-only actions.
- m6: the page no longer promises the purge.
- m7: the three cost items are marked with TODOs.

The new code is good work. But the new "looks random" address heuristic makes the branch's own API
test fail on about half of all runs (B1), so the head cannot land as it is. I also found a new round
of anonymizer gaps (M1, M2). None of them blocks landing. The owner's question 2 from the first
review (a person reviews the masks before a case is listed) is still what actually protects the
library: no regex set will catch everything.

## Tests run (outside the lock, nice -n 10)

- `@x2f/staff` (whole project): 11 files, 304 passed.
- `@x2f/staff-web` (whole project, vitest): 12 files, 119 passed.
- `@x2f/api` test/staff/ + test/log.test.ts + test/schema.test.ts: 20 files. **1 failed**, 511 passed.
  The failure is activityLog.test.ts:381 (see B1). I then ran activityLog.test.ts on its own 4 more
  times: 2 passed, 2 failed. That is 3 failures in 5 runs, so the test is flaky, not broken by the
  environment.
- Not run: Playwright and the full `npm run check` (excluded by the brief).

Mutation checks on the new guards (all reverted afterwards); each one turned anonymize.test.ts red:
- `IGNORABLE` narrowed back to the four zero-width characters -> the 2 soft-hyphen / word-joiner tests fail.
- The 2-letter name suffix removed -> the "short letter suffix" test fails.
- Address pieces joined across whitespace only -> the 2 dash / quoted-line tests fail.

## Findings

### B1. The address heuristic swallows ordinary ruling prose, and the API test fails 3 runs in 5
`packages/staff/src/anonymize.ts:227-230` (`looksRandom`) and `:277-297` (the window pass), together with
`:245-248` (pieces are joined across up to 3 characters that are not letters or digits).
How it happens:
- Ordinary prose turns into one long "stream" of base58 pieces, because words separated by a space
  or `'s ` are joined.
- The stream only breaks at the letters base58 does not use (`0`, `O`, `I`, `l`).
- Any 95 characters of that stream that hold at least 3 digits, 8 upper-case and 8 lower-case
  letters become one `[address]` mask, stretched out to whole words.
- A trade code (about 10 upper-case letters) plus a card number or some figures is enough to pass
  that test.

Observed in the test: the ruling reason
`REASON-SENTINEL: <buyer>'s payment from card 4111 1111 1111 1111 shows in <seller>'s bank. Trade <code>. Refund address <addr>.`
comes out as `REASON-SENTINEL: [address] [address].`.

Whether it happens depends on the random test names and the random trade code: the stream breaks
early only if one of them contains a `0`. That is why the test passes about half the time.

Impact:
- The head is red about half the time, in CI as well.
- In real use, any staff reason that mentions a trade code and some numbers in one sentence can be
  wiped out in the library. Over-masking is the safe direction, but this destroys the training value
  of exactly the cases that are worth studying.

Fix (engineering, the threshold is the lead's call). Look for randomness inside a piece, not across
words. Each of these would do:
- Count windows only over pieces of at least about 12 characters.
- Require several upper/lower case changes inside a single piece.
- Treat as joinable only the gaps that real split addresses use (`-`, whitespace with a line break,
  `> `), and not `'s ` or a single space between short words.

Then make the test deterministic: use fixed names that contain no `0`, or a seeded code, and add a
case with exactly this sentence shape that must keep its words.

### M1. New name bypasses (each probed against `anonymizeText`, each left unmasked)
`anonymize.ts:87-100` (CONFUSABLE), `:115-135` (skeleton), `:150-168` (nameSpans).
Ways a name gets through:
- **Combining marks:** `m̀ira.k` (reads as "m̀ira.k"), `quietföx`. NFKC cannot compose
  these, and the name regex has no room for `\p{M}`.
- **Missing accents:** `Jose` for the display name `José`. `Strauss` for `Strauß`.
- **Turkish dotted I:** `MİRA.K`. U+0130 has no simple case fold to `i`.
- **Look-alikes not in the table:** Armenian `օ` (`quietfօx`), the small capital `ᴍ` (`ᴍira.k`),
  and leetspeak `0` for `o` (`quietf0x`).
- **Separators not handled:** inside a part (`m.i.r.a.k`), and `,` `·` `/` between parts
  (`mira,k`, `mira·k`, `mira/k`). NAME_SEP is only `[._\- ]`.
- **Suffixes not handled:** `_` or digits (`quietfox_real`, `quietfox99`), because the
  lookahead counts `_` and digits as word characters. Also suffixes of 3 or more letters
  (`Kowalska`).
- **Reversed text:** `‮k.arim`. Stripping the override leaves the reversed name readable.

Failure scenario: a trader's note says "Jose never paid" or "quietfox_real on Telegram". The library
shows a name that identifies the buyer, and nothing is highlighted.

Fix (engineering): in the skeleton, decompose each character (NFD) and drop `\p{M}`. One source
character still maps to its units, so the from/to mapping keeps working. Fold `ß` to `ss` and `İ` to
`I`, which needs a one-to-many entry in from/to. Widen NAME_SEP to `[^\p{L}\p{N}]{0,3}`. Allow
`[_\p{N}]` after the name. For confusables, take Unicode's confusables.txt (Latin targets only)
rather than a hand-made list.

Owner/lead questions:
- Match a name with separators between every letter? I recommend yes for names of 4 or more letters.
- Match `0` for `o` and `1` for `i`/`l` inside names? I recommend yes: over-masking is fine.

### M2. Other identifiers that still get through
Probed:
- **Another trade's code:** written lowercase (`rvgf4pmgr9cmeza9`), lowercase with spaces, or with
  dots (`RVGF.4PMG.R9CM.EZA9`). Only the case's own code accepts any separator
  (`:189-200`). A ruling that names an earlier trade by the same trader links the case to that trade.
- **Address:** split by a gap of 4 or more characters (`... -- ...` has a space on each side, so the
  gap is 4), or with one non-base58 character inserted (`0`, `O`, `I` or `l`) (`:210`, `:245-248`).
- **tx id:** in two halves with a word between them, or with `O` typed for `0`.
- **IBAN:** with dashes, which leaves `XXXX-XXXX-XXXX-XXXX-0130-00`, so the IBAN's last
  digits show under a trade-code mask. With dots, nothing is masked (`:382`).
- **Card:** written `4111 - 1111 - 1111 - 1111` or `4111/1111/1111/1111` (`:393`).
- **Other wallets and contacts:** Bitcoin bech32 and legacy addresses, and Session ids (66 hex
  starting `05`).
- **Links:** a bare host whose top-level domain is not in the list (`quietfox-store.shop` comes out
  as `Seller-store.shop`).

Fix: other trade codes are engineering, so I'd do them now. The same is true for IBAN and card with
`-`, `.`, `/` and ` - ` separators, and for any 20+ character random base58 run in M2/B1. Whether to
also mask other chains' addresses and Session ids is the owner's call (I recommend yes).

### m1. Absolute dates, times and exact amounts in free text are not masked
For example `paid on 12 Nov 2026 at 14:32` and `412.37 EUR for 1.2345 XMR` both pass through. The
list now shows the month only and a rounded amount (m1, done), but a case's note or ruling reason
often states the exact figures, and those match an open dispute seen earlier.
Owner question: mask dates, clock times and exact amounts in the texts? I recommend masking
clock times and the XMR amount, and keeping fiat amounts and days of the month (training value).

### m2. Worst-case run time is quadratic, but bounded today
At 20k characters, `a-`, `a.` and `a+` repeated take 200 to 314 ms; at 40k they take 0.6 to 1.0 s.
Doubling the input multiplies the time by about four. The two link regexes (`:373-375`) and the
phone regex (`:400`) can start at every word boundary and then scan to the end of the text.
NFKC can make a text longer: U+FDFA becomes 18 characters and U+33C2 becomes `a.m.`. 4000 × U+33C2
becomes 16 000 characters and takes 153 ms.
The server's texts are capped (note 1000, reason 4000, evidence 10 × 200, by DB check and route), so
a training case read costs at most about 1 s of CPU in the worst case. The browser chat scrub
(future) has no such cap.
Fix (later): check the length after NFKC (refuse or truncate above about 8k), or bound `[^\s<>"']+`
and `[\d ()./-]{5,}` to about 2000 characters.

### m3. The training id scan reads and hashes every closed dispute on each lookup
`apps/api/src/staff/training.ts:61-62` (`findCase`): every `GET /training/:id` and every
`?before=` reads all closed disputes and computes an HMAC for each one. Until Task 23 deletes old
disputes, that number grows without limit.
At 100k disputes this is about 100k rows plus about 0.2 s of HMAC per request, and any moderator
can trigger it repeatedly.
The `===` comparison is not constant-time, but that doesn't matter: the ids are handed to the same
readers in the list.
Fix (recorded as a TODO): store the HMAC id in a column that is filled when the dispute closes and
indexed, or keep an in-process map refreshed on close.

### m4. Key handling: sound, with one gap
Checked:
- 32 bytes base64, or `_FILE`.
- Required on mainnet.
- Must differ from `X2F_SERVER_KEY` and every key ring (`assertSeparate`, tested in schema.test.ts:642-656).
- The test config uses a random key.
- The development key is public and allowed on stagenet and testnet only when the variable is unset.

The gap: `parseTrainingIdKey` (config.ts:203-213) accepts the public `DEV_TRAINING_ID_KEY` if
someone sets it explicitly on mainnet (for example by copying a stagenet `.env`). Fix: refuse a key
equal to `DEV_TRAINING_ID_KEY` when the network is mainnet.

### What I checked and found sound
- **Mapping back from the skeleton:** the skeleton is one unit per unit, except that a whitespace
  run becomes one space, and `from`/`to` record where each unit came from. No mask can start or end
  on a collapsed space:
  - name separators sit between the parts;
  - the email regexes end with a letter;
  - links stop at whitespace;
  - phone numbers end with a digit;
  - address windows end at a piece boundary.
  So nothing leaks at a mask's edge.
- **Confusable folding and look-alike pages:** the folding only changes what is matched; the
  output is the NFKC text. Surrogate pairs are copied as two units on both sides. I found no
  misalignment, and no page of look-alike text came out showing part of a masked span.
- **Training list paging:** it now uses `(closed_at, code, seq)` and is consistent with
  `order by closed_at desc, code desc, seq desc`.
- **`roundXmrAtomic`:** rounds half up to 2 significant figures, as documented.
- **`before` and `limit` parsing:** `before` is checked as a safe integer, `limit` matches
  `^[1-9][0-9]{0,2}$` with a cap of 100, and the actor list uses the `not like` clauses. All tested.

## Owner questions (for the lead's page)
1. M1: match names with separators between letters and with leetspeak (0/o, 1/i/l)? I recommend yes.
2. M2: mask other chains' addresses (BTC and others) and Session ids? I recommend yes.
3. m1: mask clock times and exact XMR amounts in case texts? I recommend yes. Keep fiat amounts and days.
4. Still open from the first review: should a person review the masks before a case is listed? I
   recommend yes. This round shows the regexes will always miss something.
