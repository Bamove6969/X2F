# Review: wip/lead-staff-activity-log a19cd082 (Plan 4 Task 19, Activity log page + training library)

Reviewer: independent helper (rev-actlog), 18 Nov 2026, about 11:00 BC time.
Diff: 001959cc (wip/lead-land-tw at branch point)..a19cd082, 5 commits, 18 files, +2639/-7.

## Verdict: APPROVE WITH MINORS

Privilege, scope and the log's no-leak guarantee are sound and properly tested. The weak spot is the
training anonymizer (`packages/staff/src/anonymize.ts`): I found several inputs that get through it
unmasked (M1-M3). Today this matters less than it sounds, because every reader of the library
(`training.read` = mod, senior, owner) already holds `disputes.handle` and can open the raw case. But the
library is meant to be the anonymized view, and it publishes every closed case automatically with no
human review (the OWNER-Q in training.ts). M1 and M2 are engineering fixes I'd like done before or
just after landing. No blockers.

## Tests run (this worktree, outside the lock, nice -n 10, per the 14:11 UTC lock rule)

- `@x2f/api` test/staff/ (all 18 files) + test/log.test.ts: 19 files, 428 passed, 0 failed.
- `@x2f/staff` (whole project): 11 files, 278 passed.
- `@x2f/staff-web` (whole project, vitest only): 12 files, 119 passed.
- Not run: Playwright `apps/staff-web/e2e/log-training.spec.ts`, and the full `npm run check` (both
  excluded by the brief).

Mutation spot-checks (each reverted afterwards); every one turned a test red:
- activityLog.ts: send the raw `detail` instead of `shownDetail(...)` -> "a tampered row ... shows no detail" fails.
- activityLog.ts:121: drop the 400 on an owner-only `kind` in the staff scope -> "a moderator reads the staff scope" fails.
- anonymize.ts:90: drop the not-inside-a-longer-word guard -> "never masks a username inside a longer word" fails.
- anonymize.ts:135: stop joining address runs across whitespace -> "masks an address split by spaces" fails.
- anonymize.ts:58: stop stripping zero-width characters -> "...through zero-width characters" fails.

## What I checked and found sound

- Privilege. All six new routes are in test/staff/routes.ts with the right perm and allowed set, and
  matrix.test.ts passes. `/log`, `/log/filters` and `/log/active-disputes` need `log.read.cases`;
  `/log/integrity` needs `log.read.all` (OWNER), and the mod gets 403 (tested). `/training` and
  `/training/:id` need `training.read`; helpers get 403. There is no write route
  (activityLog.test.ts:377-378 pins this for training).
- Scope can't be widened. `queryLog` adds the staff-scope clauses (`trade_code is not null`,
  `exists disputes`, `not like` for each OWNER_ONLY prefix) with AND, whatever filters are set.
  `actor`, `kind`, `code`, `before`, `from` and `to` only ever add more AND clauses. An owner-only
  kind is refused with 400 in the staff scope. LOG_KINDS' owner-only prefixes are exactly
  OWNER_ONLY_PREFIXES.
- SQL injection. Every input value is a bound parameter. The only text built into the SQL is the
  `like` prefixes from the LOG_KINDS constant (no `_` or `%` in them) and the PUBLIC_NAME_COLUMN
  constant. `kind=__proto__` and `kind=constructor` return 400 (`Object.hasOwn`).
- Page cap. The route takes 1 to 100 (`limit=101`/`150` give 400, I probed this), reads one extra
  row (at most 101, under queryLog's 200 cap), and pages with `before` (tested: nothing seen twice,
  nothing missed).
- Leaks in the log. `shownDetail` re-checks each detail against its action's schema
  (`assertDetail`: ids/uuid/amount/hex64/iso only, strings up to 64 characters). A tampered row
  comes back as `detail: {}, withheld: true`, and a row that is not JSON gives `detail: null`,
  which is also withheld (both tested). Trader names are the public display names. The training
  timeline shows the action and the role only.
- Training case reads: the note, every ruling reason and evidence line, and the appeal all go
  through `scrub`. The trade code is a constant. Times are offsets. The chat is `not-available`.
- Purge: the library is a view over `disputes` (status `closed`), so a case disappears once its
  dispute row is deleted. But see m6: that purge (Task 23) doesn't exist yet.

## Findings

### M1. Anonymizer: names get through with ordinary Unicode and spelling variants
`packages/staff/src/anonymize.ts:58` (ZERO_WIDTH), `:83-91` (nameSpans). I probed these against
`anonymizeText`. Each one was left untouched:
- A soft hyphen (U+00AD) or a word joiner (U+2060) inside the name: `mi­ra.k paid`. ZERO_WIDTH
  covers only U+200B-200D and U+FEFF.
- Unicode forms. A name stored NFC (`José`) doesn't match the same name typed NFD. Fullwidth forms
  (`ｍｉｒａ.ｋ`) and a Cyrillic `а` in `mirа.k` don't match either (no NFKC, no confusable folding).
- Whitespace and separator variants. `Mira  Kowal` (two spaces) and `Mira\nKowal` don't match the
  display name `Mira Kowal`. `mira_k`, `mira-k` and `mira k` don't match the login `mira.k`.
- Inflection. `Miras payment came late` keeps `Miras`, because the guard on line 90 skips any match
  followed by a letter. German and Slavic case endings hit the same guard.
Failure scenario: a seller's note reads "mi­ra.k never paid" (pasted from a phone, so the soft
hyphen is invisible) or "Miras bank says...". The training case then shows the buyer's username to
every moderator, unmarked, and the page highlights nothing because nothing was masked.
Fix (engineering):
- NFKC-normalize text and names before matching, and map offsets back to the original text if needed.
- Strip `\p{Default_Ignorable_Code_Point}`, not just the four zero-width characters.
- Build the name regex so that whitespace runs match `\s+` and `.`, `_`, `-` and space are
  interchangeable separators.
- Owner/lead question: should a name followed by a short letter suffix (up to about 2 letters,
  "Miras", "Miry") be masked? That trades over-masking for under-masking. My recommendation is yes
  for names of 4 or more characters.

### M2. Anonymizer: the case's own trade code and Monero values with other separators
`anonymize.ts:103` (the trade-code regex allows only `-` or space between groups), `:135`
(address runs are joined only across whitespace), `:181` (tx).
Probed, all left unmasked:
- The case's own (known) code written `FTYB.J3ZD.7MCZ.WKRA`, `FTYB_J3ZD_7MCZ_WKRA` or `FTYBJ3ZD/7MCZWKRA`.
- A 95-character address split with `-`, with a soft hyphen, or across a quoted line (`\n> `), or
  glued to a word (`to4AAA...`).
- A 64-hex tx id written `0x<64hex>` (the lookbehind rejects the `x`) or split in two halves.
- A 16-hex short payment id. This is not in the module's list, but it is a payment identifier.
Failure scenario: a ruling reason says "Trade FTYB.J3ZD.7MCZ.WKRA ..." and the training case shows
the real trade code, which defeats the opaque id. Or a seller pastes an address their chat app
hyphenated, and it shows in full.
Fix (engineering): for known codes, match the normalized code against the alphanumeric characters
with any non-alphanumeric separators skipped. Join address runs across any short run of
non-base58, non-letter punctuation (`-`, U+00AD, `> `), not only whitespace. Allow an optional
`0x` before a tx. Mask 16-hex runs next to "payment id" / "pid", or any 16-hex run.

### M3. Anonymizer: identifier kinds that are not masked at all (owner question on scope)
Not masked: PGP fingerprints (40 hex, spaced or not), URLs and handles (`https://t.me/mira_real`,
`example.com/u/quietfox99`), IPv6 and short IPv4 (`10.1.2.3`; `203.0.113.77` only happens to be
caught as a "phone"), obfuscated emails/JIDs (`mira at jabber dot ccc dot de`), phones split with
`/`, cards written with dots. A JID with a resource is only partly masked (`[email]/phone`). The
module comment does disclose that free text can name what the masks don't know, and it points to
`manual` masks. But no route or screen applies manual masks today, and every closed case is
listed automatically (OWNER-Q in training.ts:27). So there is currently no human step to catch
what the anonymizer misses.
Recommendation (owner): either take up the OWNER-Q "Mark as training case" with a review of the
masks before a case is listed, or add masks for 40-hex fingerprints, URLs (keep the host and mask
the path) and IPv4/IPv6. The masks are engineering work. Whether to gate the library behind review
is the owner's call.

### m1. The opaque training id is an unkeyed hash, so anyone who knows a trade code can link it
`apps/api/src/staff/training.ts:34`: `sha256('x2f-training-v1|' || code || '|' || seq)`, first 128 bits.
Reversing it by brute force is infeasible: a code is 16 Crockford base32 characters, which is 80
bits. But it is a deterministic hash with no secret, and the label is in the source. Anyone holding
a list of trade codes can compute every training id: for example, a moderator's own notes, or the
codes `/staff/v1/log` and `/log/active-disputes` show to every moderator. That moderator can then
map training cases back to trades. Separately, the list's exact `xmr` (atomic units), method and
closing day match `/log/active-disputes` (code, method, exact xmr) taken while the case was open,
so the opaque id isn't the only way to link.
Impact today is small, because the same readers can open the raw case through `disputes.handle`.
Fix: use an HMAC with a server-side key (or a random id column on `disputes`). Owner question
(recommend yes): should the list round the amount (for example to 2 decimals of XMR)?

### m2. A `before` above the bigint range gives a 500
`apps/api/src/staff/activityLog.ts:37` (`/^[1-9]\d{0,18}$/`), also query.ts:64. `?before=9999999999999999999`
returns 500 `{"error":"internal"}` (probed), because Postgres rejects a value above
9223372036854775807. Fix: compare with `BigInt(s.before) <= 9223372036854775807n` and return 400.

### m3. `limit` is parsed loosely
activityLog.ts:128 uses `Number(s.limit)`, so `limit=1e2`, `limit=0x10` and `limit= 50` are
accepted (probed, 200). There is no harm, but it is inconsistent with the strict validation of
every other parameter. Fix: check `/^[1-9]\d{0,2}$/` first.

### m4. No test pins the 100 cap
The only test is `?limit=500` (activityLog.test.ts:222). Its 400 would still happen if
LOG_LIMIT_MAX were raised to 199, because queryLog's own 200 cap throws a RangeError that is
mapped to 400. So the route's cap of 100 is not actually tested. Add `?limit=101` -> 400 and
`?limit=100` -> 200.

### m5. The staff-scope actor list doesn't exclude owner-only actions
activityLog.ts:175-177. The filters query applies the disputed-trade clause but not
OWNER_ONLY_PREFIXES, while `queryLog`'s staff scope applies both. Today every `staff.*`/`pay.*`/
`settings.*` entry has `trade_code = null` (pay.ts:417, payAccrual.ts:100), so this is latent.
Failure scenario: a future owner-only action logged with a trade code (for example a clawback tied
to a case) would add the owner or a staff member to a moderator's actor list, although the log
itself never shows that entry. Fix: add the same `not like` clauses.

### m6. The copy promises a purge that doesn't exist yet
apps/staff-web/src/screens/Training.tsx:70 says "A case leaves the library when its dispute is
deleted, 90 days after it closed", and training.ts:12 cites Task 23. There is no job that deletes
`disputes` rows yet (trades/purge.ts only nulls payout addresses). Until Task 23 lands, every closed
case stays in the library indefinitely. The roadmap line 44 also still mentions a "6-month purge of
anonymized training copies", which no longer applies now that no copies are stored. Note this in
the Task 19 report so Task 23 isn't forgotten. The copy is COPY-UNSIGNED, so the owner sees it anyway.

### m7. Smaller items (no action required)
- `/log/integrity` re-hashes the whole chain on every GET (activityLog.ts:202). It is owner-only;
  it will slow down as the log grows. A cached result or a checkpoint-based check would be enough later.
- `/log/active-disputes` is capped at 500 with no paging (activityLog.ts:194).
- `/training` computes `ID_SQL` (a sha256) for every closed dispute on each list or lookup, and no
  index can be used. This is fine at today's volume.

## Owner questions (for the lead's page)
1. M1: mask a name that has a short letter suffix ("Miras")? Recommend yes for names of 4+ characters.
2. M3: list closed cases only after a human reviews the masks ("Mark as training case")? Recommend
   yes while the chat is not in the library, and required before it is.
3. m1: round the amount shown in the training list? Recommend yes.
