# Re-review round 2: wip/second-p2-fud @9865bdd (FU-D, login name as keyed tag): CHANGES REQUIRED (1 Important, docs only; 1 Minor), 2026-10-30

Scope: the fix commits since 590a1bf: 67cb144 (M1, I2, M2, M3), 7b4a185 (I1, inside a main-line merge), 2bcb298, de3191d (merge), 7058b68 (M1 security-key test), eb050b4 (merge 414e722 plus the blocks.test fix), 69fd967 (profiles.test fix), and the docs commits ae3ae9e, 46637f2 and 9865bdd. This review is read-only. I checked against `~/x2f-comms/review-fud-2026-10-29.md` and the fix-round section of `docs/superpowers/reviews/2026-10-29-p2-fud.md`, and I verified every item in the code and tests, not from the commit messages.

Checks run (all under `flock ~/x2f-comms/check.lock`, one at a time):
- Trial merge of 9865bdd with the main line `origin/claude/compassionate-johnson-k95ssr` @d48033f, in a detached worktree `~/x2f-worktrees/rv-fud2` (now removed). `git merge-tree` reports **no conflicts**. `npm ci` was run because the lockfile did not change.
- `tsc --noEmit -p apps/api`: 0 errors.
- API vitest, 12 files: login-tags, account, password, webauthn, recovery, schema, offers, offersBulk (new on main, Task 36), blocks, profiles, logs, security-review. Result: **353/353 passed**.
- Probe on a throwaway `postgres:17.11-alpine3.24` container (the pinned test image), for N1 below.

## Round-1 items

- **I1 (offers test read the plaintext login name). Fixed.**
  - `apps/api/test/helpers/tradeApp.ts:15,21-28`: `trader()` returns `loginName`. The display name is now `Pub0001x`, so it is no longer a superstring of the login name and the "not contained" check can actually fail.
  - `offers.test.ts:127-136` checks that `login_name` and `login_key` are null and that `login_tag` equals the current-key tag of the signed-up name. It then checks that the public bodies do not contain the name (in lower case).
  - The same clash came back through Task 37's `blocks.test.ts:105-108`. It is fixed the same way.
  - At d48033f, no main-line src or test reads `login_name`/`login_key`, apart from the schema tests of the migrations themselves and the ones FU-D rewrites. Task 36 (`offers/routes.ts`, `offersBulk.test.ts`) reads neither column and uses `trader()`/`trader('staff')`, which FU-D's helper still accepts.
- **I2 (dead tuples, indexes, backups). Fixed as asked, but incomplete: see N1.**
  - The `VACUUM FULL accounts, name_keys;` step, and the warning that older dumps, base backups and WAL hold the names, are in `docs/dev-setup.md:15` and `:12`, `012_login_tags.sql:2-3,12-14`, `tag-login-names.ts:3-4` and `plan-2-review.md:205`.
  - The claim is softened as asked.
  - The optional printed reminder was not added. That is fine.
- **M1 (re-tag not best-effort). Fixed.**
  - `accounts.ts:169-179` catches everything and logs nothing.
  - Every call site uses `deps.db`, the pool, not a transaction client (`recovery.ts:154,168`, `password.ts:258`, `webauthn.ts:657`). A swallowed error therefore cannot leave a transaction aborted.
  - Tests: `login-tags.test.ts:213-251` covers the password login and the recovery-code login after the code is burned, and checks that no name appears in the logs. `webauthn.test.ts:441` covers a security key by name after the cookie is set: 200 with the cookie, the row stays under the old key, and the next login moves it.
- **M2 (Plan 6 vault). Fixed.** `plan-6-hardening.md:609` adds the handle `x2f-login-name`. `:614` adds `X2F_LOGIN_NAME_KEYS` and `_FILE` to the config-error rule. `:621` adds the ring-size HMAC calls to the same-503 outage test.
- **M3 (removing a key frees names). Fixed (docs).**
  - `dev-setup.md:17` and `plan-2-review.md:206` say that removing a key frees the stranded names in both namespaces, and that the operator must contact or close those accounts, or set `legacy_login_name`, first.
  - I checked the `legacy_login_name` advice in the code. `setLoginName` (`accounts.ts:249-258`) works on any row with `legacy_login_name`. It excludes `self` from the check and stores a fresh current-key tag. The route checks names-differ against the row's own display key. So a stranded account set to legacy can choose a new name after a passkey or PGP login, and `me` prompts it through `needsLoginName`.
  - Residual: the freed name itself stays takeable. That is documented and accepted ("check-only removed keys" was not taken).
  - No new enumeration oracle: sign-up still answers one `names-unavailable` for every clash.
- **M4 (decoy residual). Left open, as agreed.** It is recorded in `plan-2-review.md` "Not done".
- **69fd967 (profiles.test viewerId).** Correct. Task 37's `liveOffers` now takes `viewerId`, and the logged-out call passes `null`. The test passes on the merged tree.
- The in-repo review copy's fix-round section matches the code. Every file:line in it checks out.

## New items

**N1 (Important, docs only). After the documented step 1, about 100 login names stay readable through plain SQL in `pg_statistic`. After the next ANALYZE they become dead tuples there. `VACUUM FULL accounts, name_keys` does not touch that table.**
- Where:
  - `docs/dev-setup.md:15` (Migration 012 step 1)
  - `:12` (key-ring line)
  - `apps/api/migrations/012_login_tags.sql:2-3,12-14`
  - `apps/api/src/tools/tag-login-names.ts:3-4`
  - `docs/security/plan-2-review.md:205`
- What happens: once `accounts` has been analysed (autovacuum does this after about 50 + 10% row changes), `pg_statistic` holds a histogram of `login_name`, `login_key` and `name_keys.key`, with up to `default_statistics_target` (100) sampled values each.
  - `VACUUM FULL` neither re-analyses nor rewrites `pg_statistic`.
  - The next ANALYZE replaces the row but leaves the old one as a dead tuple in `pg_statistic`'s heap.
- Probe (PG 17.11, 500 rows of `zsecretN`, then ANALYZE, then the tool's update, then `VACUUM FULL accounts`, then CHECKPOINT):
  - `select histogram_bounds from pg_stats where tablename='accounts'` still returns `{zsecret1,zsecret102,...}` for both columns. This is live, through SQL.
  - `strings` on `pg_statistic`'s file: 101 hits.
  - After `ANALYZE accounts`, pg_stats shows `null_frac 1`, but the file has 202 hits (dead tuples).
  - After `VACUUM FULL pg_statistic`: 0 hits. The `accounts` file: 0 hits.
- Failure scenario: a deployment with real rows follows the docs exactly. Later, an attacker with read-only SQL (a leaked replica credential, SQL injection, a stolen data directory) runs `select * from pg_stats` and gets about 100 private login names per column. A stolen data directory has them as dead tuples even after a later ANALYZE.
- Fix (docs and comments, the same places as I2): make step 1
  `ANALYZE accounts, name_keys; VACUUM FULL accounts, name_keys, pg_statistic; CHECKPOINT;`
  run as a superuser (`pg_statistic` belongs to the bootstrap superuser), before starting the API.
- Optional: in `login-tags.test.ts:458` (the table dump), run `ANALYZE accounts, name_keys` before tagging, then assert that `pg_stats` for both tables contains no seeded name after the documented SQL. As it stands, the dump only reads `information_schema` base tables, so it cannot see this.

**N2 (Minor, docs). The docs say "every WAL archive from before that point" but leave out the server's own `pg_wal`.**
- The tool's UPDATE writes full-page images of the pre-update pages, with the plaintext names, into the current WAL. My probe found thousands of `zsecret` hits in `pg_wal` after the VACUUM FULL and a CHECKPOINT. In that probe the inserts were also recent. In a real deployment, the update's full-page images alone carry every tagged row.
- Old segments are recycled (renamed), not zeroed. The pre-rewrite relation files are unlinked, not wiped.
- Fix: one sentence in `dev-setup.md:15`:
  - `pg_wal` (and each standby's) holds the names until those segments are overwritten.
  - The disk blocks of the old table files are freed, not wiped.
  - For a deployment that held real rows, treat the data volume (and its snapshots) like the older backups: encrypted at rest, or retired.
- Before launch there are no rows, so this costs nothing in practice. It is about making the claim true.

## What the branch needs to land on d48033f

1. N1: the doc and comment edits above (no code change). N2 too, ideally, in the same commit.
2. Merge d48033f. It is clean by `git merge-tree`: no textual conflicts, and `coordination.md` auto-merges. Task 36's new `offersBulk.test.ts` passes with FU-D's `trader()`.
3. After the merge: tsc for api, and the API vitest files above, as checked here. Web and auth-client are untouched by FU-D. Their main-line changes (Task 36) do not touch accounts or login names.
4. A third round is not needed for N1/N2 if the lead checks the wording against this note.
