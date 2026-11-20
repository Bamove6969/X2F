# Re-review: wip/lead-p5t11-past-rep @ 737fc9ae (Plan 5 Task 11, round 2)

Reviewer: independent helper (rev-p5t11), 20 Nov 2026, 08:45 BC time.
Range: 56b82d4b..737fc9ae (5c9cdb58 red tests, 8a56b4d7 api, 737fc9ae staff-web). The first review was review-lead-p5t11-past-rep-2026-11-20.md.

## Verdict

**CHANGES NEEDED: one blocker (B1), a small fix.**
- B1: `archivedOriginalHost` can be made to name the claimed site for a page that is not on it. That is the exact attack the M2 fix exists to stop.
- M1 (the cursor's millisecond precision) is engineering and cheap. Fix it in the same change.
- Everything else from round 1 is fixed and tested. Each new guard I removed made a test fail.

Not run: Playwright (`apps/staff-web/e2e/pastrep.spec.ts`), and the full suite (runner G has it).

## Tests run (targeted, `nice -n 10`, outside the lock)

- `@x2f/api`: `staff/pastrep`, `staff/matrix`, `staff/login`, `staff/members`, `pastrep`, `pastrepVerifiedUsd`, `schema`: 7 files, 400 passed, 1 todo.
- `@x2f/staff` roles: 94 passed.
- `@x2f/staff-web`: `pastRep` and `shell`: 2 files, 26 passed.
- `tsc --noEmit` for apps/api and apps/staff-web: clean. copy-lint: clean.

### New guards removed (each change reverted)

| Change | Result |
|---|---|
| drop `confirm-profile` (`staff/pastrep.ts`, approve) | 1 failed |
| drop `reviewer-own-key` | 1 failed |
| revoke writes `reviewer_id`/`decided_at` again (m3) | 1 failed |
| drop the LIKE escape on `name` | 1 failed |
| approved list oldest first again (M1) | 1 failed |
| drop the staff/owner key check in Task 10 (`pastrep/routes.ts:200`) | 1 failed |
| staff-web: Approve not gated on the profile tick | 1 failed |
| staff-web: Approve not gated on the fingerprint tick (round-1 m1) | 1 failed |
| staff-web: no full-URL text | 2 failed |

## Round-1 items

- **M1 (paging): fixed** (`staff/pastrep.ts:101-110`, `:170-207`; `PastRep.tsx`).
  - The approved list is newest first by approval, with a cursor, "Show more", and a display-name prefix filter that takes wildcards literally. It is tested with 112 claims.
  - **Injection: none.** The cursor must match `ISO~uuid` exactly or the request is 400. Its parts are bound as parameters, and `sortAt`/`order` are constants. `name` is at most 64 characters, lower-cased against `display_key`, with `\ % _` escaped, and bound. A repeated `name` or `cursor` (an array) is 400.
  - New problem: see M1 below.
- **M2 (URL shown, second tick): fixed in the UI and the API** (`confirm-profile` is enforced server side). The host helper is wrong; see B1.
- **M3 (own key): fixed.**
  - Approve refuses with 403 `reviewer-own-key` when the claim's fingerprint is one of the reviewer's `pgp_keys`. The check runs in the transaction, before the UPDATE.
  - Task 10 refuses staff and owner login keys with 409 `key-unavailable`, only after the signature verifies. See m1 for what that answer reveals.
- **m1 (tick test): fixed.** Both ticks are now proven by removing them.
- **m2 (copy): fixed.** The message is now "This claim changed meanwhile. The list is up to date again."
- **m3 (revoke overwrites the approver): fixed.**
  - Migration 751 adds `revoked_by`/`revoked_at`, with checks that `revoked_by` comes with a `revoked_at` and that `revoked_at` is only on a revoked row.
  - Jabber `changePaths` and `NOT_ACCOUNT_CHANGES` are updated, and the schema test lists the migration.
- **m6: fixed.** There is an `it.todo` for Task 12's profile line.
- **m7: fixed.** `decide` now takes `StaffRole`, and the `as never` is gone.
- **The `pastrepVerifiedUsd.test` break: fixed.** It passes; the column name stays in `store.ts` via `verifiedUsdCentsTextSql`.

## Probing `archivedOriginalHost` with hostile URLs (stored form after `checkEvidenceUrl`)

| Link | originalHost | Correct? |
|---|---|---|
| `web.archive.org/web/2023/https://localmonero.co/ad/1`, and the `id_` form | localmonero.co | yes |
| `…/web/2023/https://localmonero.co@evil.com/`, and `:443@evil.com` | evil.com | yes |
| `…/web/2023/https://evil.com@localmonero.co/` | localmonero.co | yes (the browser goes there) |
| `…/web/2023/https://evil.com/?u=https://localmonero.co` | evil.com | yes |
| `…/web/2023/https://evil.com#/https://localmonero.co` | evil.com | yes |
| `…/web/2023/https://lоcalmonero.co/` (Cyrillic о), or typed as punycode | `xn--lcalmonero-…` | yes (punycode shown, visibly different) |
| `…/https%3A%2F%2Flocalmonero.co/`, `ftp:`, `javascript:`, `[::1]` | null | yes |
| `…/https://localmonero.co%2F@evil.com/` | evil.com | yes |
| nested `…/https://archive.ph/AbCd1`, `…/https://web.archive.org/web/…` | null | yes |
| nested `…/https://archive.md/AbCd1` | archive.md | honest, see m4 |
| `archive.ph/AbCd1`, `archive.is/AbCd1#https://localmonero.co`, `archive.today/o/AbCd1/https://…` | null | yes |
| **`https://archive.ph/AbCd1?x=/https://localmonero.co/`** | **localmonero.co** | **no (B1)** |
| **`https://archive.ph/AbCd1/https://localmonero.co/`** | **localmonero.co** | **no (B1)** |
| **`https://web.archive.org/web/2023?x=/https://localmonero.co/`** | **localmonero.co** | **no (B1)** |

## Findings

### Blocker

**B1. The host helper reads the query string as part of the path, and accepts any first segment as the archive's timestamp.** (`apps/api/src/pastrep/challenge.ts:128-129`)
- `path = u.pathname + u.search`, and the regex's first segment `[^/]+` is any text, including `AbCd1?x=`.
- So a trader archives a fake profile on their own domain on archive.today, takes its short id, and submits `https://archive.ph/<id>?x=/https://localmonero.co/`. The link passes `checkEvidenceUrl`.
- archive.today ignores the query and serves the trader's page. The staff page states "Archived site: localmonero.co" (`PastRep.tsx:247`).
- That is the false assurance M2 was meant to remove. The `/<id>/https://…` form behaves the same: the archive's answer for that path is unknown, yet the helper asserts a host.
- Fix (engineering):
  - Match on `u.pathname` only, and require the first segment to be a real timestamp:
    - Wayback: `^\d{1,14}(?:[a-z]{2}_)?$`.
    - archive.today: `^\d{4}\.\d{2}\.\d{2}-\d{6}$`, `^\d{14}$`, `newest` or `oldest`.
  - Anything else gives null.
  - Add the three hostile links above to `apps/api/test/pastrep.test.ts`.

### Major

**M1. The cursor drops microseconds, so rows can be skipped or repeated.** (`staff/pastrep.ts:206`)
- The cursor is `sort_at.toISOString()`, which keeps milliseconds, but the column is `timestamptz` and holds microseconds.
- Probe (temporary test, not committed): 150 approved rows whose `decided_at` differed only in microseconds. The cursor walk returned **100 of 150**; 50 were skipped on the descending list. The ascending queue would repeat rows instead.
- Today every writer passes a JS `Date` (`clock()` for `decided_at`, `now` for `created_at`), so live data is safe. The paging is still only correct while nothing writes `now()` (an import, a future writer, a test fixture).
- Fix: put microseconds in the cursor (select `to_char(sort_at, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` at time zone UTC, or epoch microseconds as text). Or compare on `date_trunc('milliseconds', …)` in both the order and the predicate. Add the probe as a test.

### Minor

**m1. Within past-rep, `key-unavailable` means only "a staff or owner login key".**
- The comment at `pastrep/routes.ts:191-195` says the answer matches the ban list. The code is the same, but this route never consults the ban list (no `assertKeyNotBanned`).
- Exposure is limited to someone who can sign with that key, which means the staff member or a thief of their private key.
- Recommendation (owner question): also refuse banned keys here with `assertKeyNotBanned`. Banned keys then fail as well, and the answer becomes truly ambiguous.
- Also: a key added as a staff login key after a claim is filed is not caught at finish. `reviewer-own-key` covers only the reviewer's own case. That is acceptable, but say so.

**m2. The waiting queue loads only the first 100 signed claims.**
- "Claim n of 100+" shows, but Skip cycles within those 100. If all 100 are skipped as hard cases, claim 101 is never reached.
- The queue drains, so this is low. A cursor "next page" on the queue would close it.

**m3. Copy for the site "Other".** "The archived page is the trader's profile on Other" (`PastRep.tsx:308`) reads oddly. Suggest "on the site the trader named" when the site is Other (COPY-UNSIGNED).

**m4. archive.today mirrors.** `archive.md`, `archive.li`, `archive.vn` and `archive.fo` (archive.today mirrors not in `PAST_REP_ARCHIVE_HOSTS`) show as "Archived site: archive.md" when nested. That is honest, but returning null (read it on the page) for the known mirror family would be clearer.

## Owner questions

1. m1: should a banned PGP key be refused for past-rep claims too? Recommended yes; it also makes `key-unavailable` ambiguous.
2. Still open from round 1 (m5 there): the revoke reason minimum, the 500-character cap, `tradesSeen <= claimed`, and moderators seeing the verified dollar figure.
