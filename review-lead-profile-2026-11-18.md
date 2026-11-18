# Review: wip/lead-profile @37dcfb75 against main 75f7b5b4 (Plan 5 Tasks 5 and 12)

Independent security and privacy review, one round. 18 Nov 2026, 08:26 BC time.

**Verdict: CHANGES NEEDED.** The change is test-only. The code does what it should on every point checked. But two privacy behaviours have no test: I removed each one and the suite stayed green. Add the tests listed under I1 and I2, then this can land. The minors don't block.

## What I ran

All runs used `nice -n 10`, outside the lock (per the lead's 18 Nov rule), in a detached review worktree at 37dcfb75 (scratchpad `rv-profile`).

- **API vitest**, 8 files, **243/243 passed**: profile, profiles, frontDoor, offers, view, traderTrust, tradedTotal, schema.
- **Web vitest**, 6 files, **74/74 passed**: profile.test.tsx, browse.test.tsx, browse-buy, browse-tripwire, cantDoThat-lint, refundRules.
- **Typecheck: clean** (`tsc --noEmit`) for apps/api, apps/web and packages/auth-client.
- **Not run:** Playwright (`e2e/profile.spec.ts`) and the full `npm run check`. A reviewer runs the full check only before an APPROVE, and this round's verdict is CHANGES NEEDED. A last extra run of team.test also did not happen: lead-profile's node_modules disappeared mid-session (someone reinstalling, it seems). That run was outside the brief.

## Spot mutations (focus 5: code written before tests)

Each mutation was run against `apps/api/test/profile.test.ts` only. Logs are in scratchpad `logs/rvprof-mut-*.log`.

| # | Mutation | Result |
|---|---|---|
| M1 | Drop `hasBlocked` from the profile lookup (`visibleTrader`) | killed (the same-404 test) |
| M2 | Serve the public record even while it is private | killed |
| M3 | Remove the once-a-minute limit on the private export | killed (the 429 assertion) |
| M4 | Ignore the `badge_prefs` row in summaries | killed (2 tests) |
| M5 | Drop the recovery-hold hiding on the profile (`hidden` forced false) | **SURVIVED** |
| M6 | Put fingerprints in the public record | killed |
| M7 | Drop `hasBlocked` from `GET /v1/traders/:name/record` | **SURVIVED** |

5 of 7 killed. On the behaviours that are tested, the tests are real, not after-the-fact echoes.

## Important (block landing)

**I1. Nothing tests that a block applies to the public record (M7).** `record.ts` does check it, but no test does. Add to profile.test.ts, "the signed record":
- A trader with a public record blocks the viewer.
- Then `GET /v1/traders/<blocker>/record` returns 404, and its body equals the unknown-name body.
- While you're there (cheap): the record URL with a login name, and with a staff display name, gives that same body.

**I2. Nothing tests the recovery-hold behaviour of the profile (M5).** Put the account in an `account_holds` row with `reason = 'recovery-code'`. Then assert:
- Another viewer gets `online: false`, `lastSeenAt: null` and `offers: 0`.
- The account itself (self) still sees its own presence.
- Nothing in the body says why (no "hold" or "recovery").

Without this test, a refactor can drop the owner's 1 Nov rule silently.

## Focus answers

### 1. Privacy of `GET /v1/traders/:name` and the record

- **Record contents.** No amount, method, note, counterparty, trade code or exact time. I read `recordText`, and the test greps for the note, method, counterparty, login name, fingerprint and `$`.
- **Profile contents.** The profile does carry each review's `note` and `method` name. That is by design: P5-A10 lists "stars or Neutral, phrases, note, method name and a coarse age", and `toPublicReview` is the existing shape. It never carries a reviewer, an amount, a trade code or an exact time.
- **Pinned keys.** `tradedTotal.test` pins the summary's exact key list, now with `featuredBadges` only.
- **Same 404 for every miss.** Unknown, login name, staff, member and blocker all get one body (`kind = 'trader'` on `display_key`; login names live in `login_key`). The tests compare bodies byte for byte.
- **Timing (minor, m1).** The paths are not equal in work:
  - an unknown name costs 1 query;
  - a blocker costs 2;
  - a private record costs 3.

  This is a small oracle for "this name exists and blocked me". Name existence is already public through the name check and the boards, so it is low value. Still, a single statement joining accounts, blocks and badge_prefs would make the paths equal.
- **Member sessions.** `requireInside` lets members read profiles and public records (`member: 'any'`), which is fine. The four owner-only routes use `requireSession({kinds:['trader']})` with no `member` option, so a member gets 403 `owner-only` (fail closed). Those routes are `GET`/`PUT /v1/account/badges`, `GET /v1/account/record` and `PUT /v1/account/record/public`. The hidden-badge list leaves the API only through the owner-only `GET /v1/account/badges`. A member viewing their own team gets `self: true`, so the web shows "Choose badges" links that will 403 (cosmetic, m5). No test covers member 403 on these routes (m4: nice to have).
- **Recovery hold.** The code is right. Others see presence and offers hidden, and `listedOfferCount` already excludes the account through LISTED. The record stays readable during a hold, which seems fine. Owner nuance (OQ2): `lastSeenAt: null` on an account that clearly traded is itself a tell.

### 2. The record is signed with the login-challenge key (cross-protocol)

What is signed:
- **Challenges** (`packages/accounts` `encryptChallenge`) are `createMessage({text})` signed inside encryption, so the signature is type 0x01 (text) over the text:
  - first line `X2F login code: <code>`;
  - then `Site:`, `Purpose:`, `Time:`, `Expires:`.
- **Records** are cleartext-signed, also type 0x01, with first line `X2F portable reputation record v1`.
- At the packet layer the two are the same kind of signature. The only separation is the text.

Can a record pass as a challenge? **No.**
- The server never accepts a signature as login proof. Login proof is the decrypted code, checked in constant time against `secret_hash`.
- X2F's signature on a challenge exists only for the user's own PGP app (anti-phishing).
- A record cannot carry a challenge line: its first line is fixed, the display name matches `^[A-Za-z0-9._-]{5,20}$`, phrases come from a fixed catalogue, and fingerprints come from the database.

Can a challenge pass as a record? **Not to anything X2F runs today.**
- Someone can pull the signature out of a decrypted challenge and rewrap it as a cleartext message. gpg would then say "Good signature from X2F", but the text plainly reads as a login code.
- No X2F code parses signed records: VerifyRecord is not built (Record.tsx says so).

So nothing is exploitable at this head. **Recommended changes (minor, but do them when VerifyRecord lands):**
- **m2.** VerifyRecord must check two things: line 1 of the verified data is exactly `RECORD_HEADER`, and the signing key's fingerprint is the pinned one. The plan already requires the test "a genuine X2F-signed login challenge pasted into VerifyRecord fails". That test does not exist yet. Track it as an open item of Task 12, not as done.
- **m3 (defence in depth, small).** Add a purpose notation to both signatures (openpgp 6.3.2 supports `signatureNotations` on `sign` and `encrypt`). With it, separation no longer rests on text alone, and any future X2F-signed text gets its own purpose:
  - `record.ts` `signRecord`: `signatureNotations: [{ name: 'purpose@x2f', value: utf8('reputation-record-v1'), humanReadable: true, critical: false }]`;
  - `packages/accounts/src/pgp.ts` `encryptChallenge`: the same with `'login-challenge'`;
  - VerifyRecord requires the record notation.

  Keep `critical: false`: a critical unknown notation makes other verifiers reject the signature.

  A dedicated record subkey is the stronger option. It needs key ceremony and a second published fingerprint, so it is an owner and ops call; I would not do it now.

### 3. Badge settings

- **Nothing can be faked.** `applyChoice` refuses New (`new-is-fixed`) and any badge not earned (`not-earned`, nothing saved). `isBadgeId` accepts only catalogue ids or `past-rep:<uuid>`. `prefsFromRow` drops unknown ids. `resolveVisibility` works only from the earned list, so a hand-edited row can neither grant a badge nor hide New. M4 and the forced-SQL test cover this.
- **Nothing can be unhidden.** The only negative-toned badge is New, and it can't be hidden. Hiding PGP also hides "Account protected with PGP" (P5-A17), as specified.
- **`featuredBadges` leaks nothing.** It is the length of the already-public Featured list, and the web clamps it to 0..2.
- **The PUT is safe under concurrency.** It locks the row inside a transaction.

### 4. Rate limits and the signature cache

- **Private export.** Once a minute per account, in memory, per process (as the plan says). The map is pruned of expired entries once it passes 10k, so it is bounded by the accounts active in a minute.
- **Cache correctness.** The cache is keyed by subject and compares the full text. The text includes `Issued:` and every field, so a hit is always the current content. The private check runs before the cache, so turning the record private works at once.
- **m6.** The cache is bounded by entry count (more than 1000 clears everything), not by size. Worst case is 1000 traders × about 110 KB (1000 review lines in both text and armor), roughly 110 MB. Fixes:
  - store a SHA-256 of the text instead of the text;
  - use a small LRU, or cap by bytes.
- **m7.** `GET /v1/traders/:name/record` has no limit of its own. Each call reads `traderFacts` plus up to 1000 review rows. Once more than 1000 public records exist, cycling through them forces a fresh signature each time. Other inside reads are unlimited too, so this matches the codebase. Consider a per-viewer token bucket if edge limits don't cover it.

### 6. Were any tests weakened?

No.
- offers, view and refundRules only add `featuredBadges` to their fixtures.
- tradedTotal keeps the exact key list.
- schema adds `303_badge_prefs.sql` in place.
- frontDoor adds both new reads to READS (`inside: 404`).
- auth-client `flows.test` adds the 7 routes to `NOT_AUTH_CLIENT`.
- cantDoThat-lint goes from 67 to 68, with its reason recorded: BadgeSettings' standing footer "The New badge always shows while you have it and can't be hidden.", the board's own words (plan Task 12). Nothing is attempted and refused, so the raise is fair. The lead should take note of it.

## Minors (don't block)

- **m1.** Equalise the 404 paths' work: one query for name, block and prefs.
- **m2.** VerifyRecord: header line and pinned fingerprint, plus the challenge-pasted test. This is still open in Task 12.
- **m3.** A purpose notation on record and challenge signatures.
- **m4.** A test that a member gets 403 `owner-only` on the four owner-only routes.
- **m5.** The web hides the "Choose badges" and settings links for a member session (`self` is true for the team).
- **m6.** Bound the signature cache by size or hash, as an LRU.
- **m7.** Consider a per-viewer limit on the public record.
- **m8.** The private export's limit is consumed before the record is built, so a 500 still costs the minute. That's acceptable; just noting it.

## Owner questions

- **OQ1. Should a disabled or closed account keep a public profile?** `traderIdByName` doesn't filter on `disabled_at`. Banned accounts and accounts closed by `closeInactiveAccounts` (200_account_inactivity) still answer 200, with stats, reviews and (if it was on) the public record. Their offers are already hidden (LISTED). **Recommendation:** answer 404 with the same body as an unknown name, and keep the rows for moderators. If the owner wants a "closed" state shown instead, the design has to word it.
- **OQ2. What should `lastSeenAt` show during a recovery-code hold?** The profile shows `lastSeenAt: null`. For an account with a trading history, that's a tell an observer can spot (normal accounts show a coarse time). **Recommendation:** freeze `lastSeenAt` at the hold's start, rounded the same way, so nothing changes visibly. Low priority.
