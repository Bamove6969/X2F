# Review: Plan 2 FU-D rebuilt on FU-A (login name stored only as a keyed tag)

- Branch `origin/wip/second-p2-fud` @590a1bf (one commit by claude2 on 0e92cb6). Reviewer: read-only helper, 2026-10-29.
- Read: coordination.md FU-D entry and FU-A review notes (1)-(4), `docs/superpowers/reviews/2026-10-27-p2-fua.md` (I1, I3, M8, the FU-D notes), plan-2-review.md (FU-A section, I2 residual, the new FU-D section), dev-setup.md, the whole diff.
- Trial merge with the main line `origin/claude/compassionate-johnson-k95ssr` @1b2bb3a in a detached worktree (`~/x2f-worktrees/rv-fud`, now removed).

## Verdict: CHANGES REQUIRED (2 Important, 4 Minor)

The design is sound and close to done. Every name-based login path (password, backup code with TOTP or a recovery code, security key by name) looks the name up by its tag under every ring key. Discoverable passkeys and PGP never used the name. The ring follows the FU-C pattern exactly: `parseKeyring`, newest first, ids 1-32767, `_FILE`, `assertSeparate`, and config errors name the variable only. Waiting sign-ups seal the login name. The cross-namespace check (FU-A I1 A and B) and the per-key uniqueness are kept under one advisory lock. The tool is idempotent and resumable (one update per row, `where login_key = $2`), and the API refuses to start while plaintext remains. The tests are thorough, including a dump of every table for the plaintext name, same-SQL parity under a two-key ring, rotation, and races.

Both Important findings are cheap. I1 is a semantic clash with the main line that turns a Plan 3 test red. I2 is a docs claim that is false on any database that held rows before 012.

## Important

**I1. A main-line Plan 3 test still reads the plaintext login name and fails after the merge (no textual conflict).**
- Where: `apps/api/test/offers.test.ts:127-131` (main line, Task 4).
- What it does: it selects `login_name` from `accounts` and asserts that the public offer bodies do not contain `JSON.stringify(login_name)`.
- What breaks: after FU-D, `login_name` is null for every row, so the needle is the string `null`. Every offers body contains `"rate":null`, so the test fails: `expected '[{"id":...' not to contain 'null'` (trial merge: 1 failed of 583 API tests).
- Even if it passed, it would check nothing: the real login name is no longer in the database to compare with.
- Fix:
  - `apps/api/test/helpers/tradeApp.ts:19-26`: `trader()` already makes `loginName`. Return it with `{ id, displayName, browser }`.
  - In the offers test, assert that the bodies do not contain `loginName` (compare in lower case), and that the row has `login_name`/`login_key` null and a `login_tag`.
- This is the only main-line code or test that still reads `login_name`/`login_key`. `nudge/names.ts`, `nudge.test.ts:616` and `events.test.ts:315` only mention them in comments or test names, and pass.

**I2. "A stolen database holds no login names" is not true after the tool runs on a database that already had rows. The old values stay in heap pages, in index pages, in WAL and in backups.**
- Where:
  - `docs/dev-setup.md` (the key-ring line and Migration 012 step 1)
  - `docs/security/plan-2-review.md:205`
  - `apps/api/migrations/012_login_tags.sql:2`
  - `apps/api/src/accounts.ts:194` (`tagLoginNames`)
- What happens: `update ... set login_name = null, login_key = null` leaves the old tuple as a dead tuple. Plain (auto)VACUUM marks that space reusable but does not zero it. The B-tree pages of `accounts_login_key_key` and `name_keys_pkey`, and the dead `name_keys` 'login' rows, keep the lower-cased login keys until the index or table is rebuilt.
- Step 2 does not fix it either: `alter table ... drop column` does not rewrite the table.
- Failure scenario: a deployment (or a staging copy of real users) migrates and runs the tool. Months later its data directory or a base backup is stolen. `pg_filedump` or `strings` on the `accounts`/`name_keys` relation files and their indexes recovers every login name tagged by the tool. A pg_dump or WAL archive taken before the tool holds them in clear.
- Fix (docs plus one line in the tool's instructions):
  - After `tag-login-names`, step 1 says to run `VACUUM FULL accounts, name_keys;` (it rewrites both tables and all their indexes) before starting the API.
  - Every pg_dump, base backup and WAL archive from before that point holds login names in clear. Destroy them, or keep them as sealed as the key ring.
  - Soften the plan-2-review and migration-header claim to "once the tool and the VACUUM FULL have run, and older backups are gone".
  - Optionally, the tool can print a reminder after its counts.
- Before launch there should be no rows, which is why this is cheap. But the claim is the point of FU-D, and the lead asked specifically about backups of the old columns.

## Minor

**M1. The retag is not best-effort, so a database error during it can cost a recovery code or send a session cookie on a 500.**
- Where: `apps/api/src/auth/recovery.ts:154`, `apps/api/src/auth/webauthn.ts:648-657`, `apps/api/src/auth/password.ts:258`.
- `retagLoginName` swallows only 23505 and rethrows anything else.
- Recovery code: the code is already burned (`used_at` set, line 151) before the retag. If the retag throws (connection drop, statement timeout), the person loses a code and gets no session.
- Security key: the retag runs after `completeLogin` has started the session and set the cookie. A throw turns it into a 500 that may still carry `Set-Cookie`.
- Fix: catch everything inside `retagLoginName`. It is an opportunistic rotation step, and the next login retries it. Log nothing that holds the name, or move the retag before the irreversible step.

**M2. The Plan 6 vault task does not cover the new ring.**
- Where: `docs/superpowers/plans/2026-10-24-plan-6-hardening.md:609-625` (Task 10).
- The key handles are `x2f-totp`, `x2f-pgp-key`, `x2f-pepper` and `x2f-recovery`. "With `vault`, setting any of `X2F_PASSWORD_PEPPERS`, `X2F_RECOVERY_CODE_KEYS`, `X2F_TOTP_KEYS` ... is a config error" leaves out `X2F_LOGIN_NAME_KEYS`.
- Failure scenario: Plan 6 moves every other ring into the HSM, and the login-name key stays in the environment by omission.
- Fix:
  - Add an `x2f-login-name` handle and the variable to the config-error rule.
  - Note that every name login then makes ring-size vault HMAC calls, which belong in the outage test's "same 503 for unknown names".

**M3. Removing a ring key releases the stranded names, so a stranded account's private login name can become someone's public display name.**
- Where: `apps/api/src/accounts.ts:221-233` (`namesTaken` checks only keys still in the ring), and the dev-setup rotation text.
- Failure scenario:
  - Alice never logs in by name (she uses a discoverable passkey), so her row stays under key 1.
  - The operator removes key 1 after checking the count and accepting the stranding.
  - Mallory signs up with display name `alice.secret`, which is Alice's login name. The I1 B check cannot see it any more, so the name is printed on the site.
  - Or Bob signs up with login name `alice.secret`. Alice's own login by name was already gone, but now the name is taken by someone else.
- Fix (docs): the rotation paragraph should say that removing a key also frees every name still under it, in both namespaces. Before removing a key, the operator should contact or close the accounts stranded under it, or set their `legacy_login_name`. Alternatively, keep removed keys "check-only" for sign-ups.

**M4. The decoy residual (FU-A note 4, plan-2-review I2) is left open.**
- This is recorded honestly in plan-2-review "Not done", and coordination.md says "(4) left open".
- No change asked. It is for the lead or owner to weigh. A tag-keyed per-name decoy set is now possible, at the cost of a write per unknown-name start.

## Checks that hold (no finding)

- **No plaintext login name anywhere new.**
  - `createAccount` inserts only `login_tag`/`login_tag_key_id`, and `setLoginName` nulls `login_name`/`login_key`.
  - Register challenges hold `sealNames`: AES-256-GCM, a random 12-byte nonce, AAD, the key `subkey('login-seal')`. 012 deletes the old plaintext payloads.
  - The confirm action `set-login-name` carries no name. Throttle keys keep `subkey('name')` HMAC tags.
  - The startup error and the tool print counts only.
  - The 23505 detail on `accounts_login_tag_key` names a tag, never a name, and is caught.
  - Test `login-tags.test.ts:395` dumps every table, all logs and all bodies.
- **Key ring.** Uses the same `parseKeyring`/`ringSource`/`assertSeparate` as FU-C. Schema tests cover missing, bad id, short key, duplicate id, a key repeated inside the ring, a key shared with another ring, and rotation order. The rotation path (retag at login, no rewrap possible) is documented, with the count query and the "every process holds both keys, new key second first" order. Sign-ups check under all keys, and a test covers a rolling ring.
- **Constant-time enough.** `loginNameLookup` makes exactly ring-size HMACs plus one `subkey('name')` HMAC for known, unknown and malformed input; malformed input becomes `~...`, which cannot match. The query sequence is the same. Same-SQL tests cover password, backup and security-key start under a two-key ring. Error codes are unchanged (`names-unavailable` for every clash, one answer). Throttles are unchanged (by account id when found, else by the name tag).
- **Migration 012 on existing data.** It only adds nullable columns and three constraints, and they hold on 009 rows (`one_form`, `pair`). `display_name`/`display_key` are untouched. Legacy rows are tagged under their display key and keep logging in by it (test). `accounts_names_differ`, `login_key_lower` and `login_name_pair` all pass when the key is nulled. The `name_keys` trigger drops the 'login' rows. Out-of-order application after 101-111 is fine (`migrate` applies whatever is missing; 012 touches only `accounts`/`challenges`). The stop, migrate, tool, start order is in dev-setup.
- **Uniqueness and case.** Names are ASCII-only (`NAME_RE`), so NFC and lower-casing are trivially idempotent and the JS key equals the PG `lower()`. `unique(login_tag)` plus `NAMES_LOCK` (no collision with the migrate, moderation or PGP advisory locks) plus `namesTaken` give one name per account across keys and both namespaces. `retagLoginName` without the lock cannot create a duplicate: it changes only the key, never the name, and the unique index backstops it.
- **The names-differ check in the app.** `createAccount` gives 400 `names-same`. The route compares the name with the account's own display key. Legacy equality is still allowed, because only legacy rows were tagged that way (FU-A note 3).
- **The lock cost** (sign-up finishes serialised, database-wide) is documented. Argon2, WebAuthn verify and PGP open all run before `begin`, so the lock is held only for a few inserts.

## Tests (trial merge 590a1bf + 1b2bb3a, `npm ci`, all under `flock ~/x2f-comms/check.lock`)

- tsc: api 0, web 0, auth-client 0 errors.
- API vitest, 19 files (login-tags, account, password, pgp, webauthn, recovery, schema, identity, offers, sessions, totp, security-review, logs, fx, price, nudge, events, confirm, throttle): **582 passed, 1 failed** (`offers.test.ts` "posts an offer and lists it to a logged-out browser", see I1).
- auth-client vitest: 70/70 (5 files).
- web vitest: 828/828 (56 files).
- Playwright login + setup + parity-auth: 54/54 passed.

## Landing conflict notes

- `apps/api/test/schema.test.ts`: three migration lists conflict, at lines ~46, ~68 and ~143. The main line added `102_offers.sql` and FU-D added `012_login_tags.sql`. Keep both, with `012` after `011` and `102` after `101`. Verified green.
- `docs/dev-setup.md`: the API-settings line conflicts. The main line added the `X2F_TERMS_VERSION` note "must equal the web app's `TERMS_TEXT_VERSION` ..." and FU-D added `X2F_LOGIN_NAME_KEYS`. Keep both. In the key-rings line, keep FU-D's version ("Four secrets").
- Semantic clash with no textual conflict: `offers.test.ts:127-131` (I1). Main-line tests that call `seedAccount`/`trader()` typecheck and pass with FU-D's new helper signature (`config` in deps).
- `docs/coordination.md` merged cleanly.
