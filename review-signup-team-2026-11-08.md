# Security review: wip/lead-signup-team

- **Branch:** `wip/lead-signup-team`, worktree `/home/user/X2F/.claude/worktrees/signup-team`
- **Head:** `08d96d4d` ("READY: signup one private username + live tick, recovery-code-only backup; team items held for owner rulings"), merge base with `origin/main` `5c4c8773`
- **Scope:** `git diff origin/main...HEAD` (30 files, +918 / -266, no migrations). Read in full: `apps/api/src/auth/nameCheck.ts`, `accounts.ts` (namesTaken, loginTags, loginNameAvailable), `limits.ts` (TokenBucket, KeyedBuckets, the new budgets), `auth/recovery.ts`, `auth/device.ts`, `auth/throttle.ts` (key and check), `auth/strength.ts`, the web setup screens (`Username.tsx`, `DisplayName.tsx`, `availability.ts`, `SetupFlow.tsx`, `Backup.tsx`, `register.ts`, `names.ts`, `kit.tsx`), `BackupLogin.tsx`, `settings/Methods.tsx`, `termsText.ts`, auth-client `api.ts`, and the changed tests. Context: `docs/security/plan-2-review.md` (FU-A, FU-D), `docs/superpowers/rulings-and-lessons.md` (R28, R29), `LEAD-START-HERE.md` section 7, owner answers Q54, G32 and the 1 Nov login-strength table.
- **Reviewer:** independent security reviewer (read-only; nothing changed in the code worktree; no commit).
- **Tests run** (single files, serialised runner; this box's dockerd runs with `--bridge=none`, so API files ran with the existing test-only docker shim `scratchpad/rc1-dockerwrap` on PATH, which only swaps `-p` for host networking; no code touched):
  - `apps/api/test/name-check.test.ts`: 9 passed / 9
  - `apps/api/test/recovery.test.ts`: 21 passed / 21
  - `apps/api/test/coolingOff.test.ts`: 83 passed / 83
  - `apps/web/test/signupNames.test.tsx` + `apps/web/test/backupLogin.test.tsx`: 15 passed / 15
  - `tsc --noEmit` for `apps/api` and `apps/web`: clean
  - **Not run:** `ownerLockout.test.ts`, `task28-units.test.tsx`, auth-client tests, Playwright (`setup.spec`, `login.spec`, `design-shots.spec`; the builder did not run them either).

## Verdict

**APPROVED WITH MINOR for the code; DO NOT LAND until the owner answers Owner questions 1 and 2.**

The code does what it says, correctly. The name check uses the same one-namespace query as `createAccount`, computes the tag under every key of the ring, answers only a boolean, logs nothing and refuses a wrong shape before any lookup. TOTP backup is refused before any lookup. The hold rules still agree with each other. Signup cannot finish without a display name, or with a display name that equals any login name. What blocks landing is a decision, not a bug. The branch reverses a hidden-existence rule from FU-A I1 and FU-D. It also contradicts the owner's own framing: Q54 says the username "is never shown to anybody and is as confidential as your password", and on 1 Nov he called the username "the FIRST factor". On top of that, it removes a backup method that the owner's 1 Nov strength table still lists (row 10, "TOTP-only backup"). That removal comes from design's gap list, not from an owner ruling. G32 says what a recovery code is for, but not that it is the only backup.

## Findings

### F1. Important (owner-gated): the tick is an oracle for private login names
**Where:** `apps/api/src/auth/nameCheck.ts:28-39`, `apps/api/src/accounts.ts:269-271` (calls `namesTaken`, `accounts.ts:235-255`, with `lock: false`).

**What it reveals:** `available: false` for any of these:
- (a) a display name of any account (`display_key = $1`; public anyway);
- (b) a private login name of any account, under any key of the ring (`loginTags` at `accounts.ts:117-128` gives one HMAC per ring key, and `loginTagMatch` matches each row only under its own key id), legacy pre-009 accounts included;
- (c) a login name that a legacy account is waiting out its 24-hour hold to set (`account_holds.pending_change` of kind `login-name`). See F4.

The boolean does not say which namespace matched. Display names are public, though (profiles, offers), so an attacker can subtract them and is left with the private login names. This is exactly what FU-A said no start route could do ("no start route can test whether a login name exists").

**Scenario:** a script sends `POST /v1/register/name-check` with no cookie (or a made-up 43-character cookie: `device.ts` `VALUE` accepts any well-formed value, R29). Every request gets a fresh per-device bucket, so only the site-wide `NAME_CHECK_BUCKET` binds. That gives 30 at once and then 10 a minute, `limits.ts:94`. Over a day: 10 × 1,440 = **14,400 names a day**, plus a burst of 30 at each process start. The script can also aim at one person: guess login names that look like someone's known display name, a few dozen tries. A confirmed name then feeds:
- password spraying (residual (d): about 960 tries a day per name from untrusted browsers);
- the quiet lock (M-3);
- the recovery-code throttle (F5).

**Baseline for the owner:** the old oracle still exists. Every register finish answers `names-unavailable` for 1 token of `REGISTER_BUCKET` (20 a minute, about 28,800 a day, shared with real signups). But each of those tries costs an Argon2 hash, a PGP round or a WebAuthn ceremony, and a free name creates an account. The tick adds a cheap oracle with no side effects, at half that rate.

**Fix:** owner decision (Owner question 1). Options, with my recommendation:
- **B (recommended): check public display names only.** Keep the tick but drop the login-tag and pending-hold parts of the query (`display_key = $1` only). It then reveals nothing that is not already public. In the rare case where the name is someone's private login name, the tick says "available" and the finish still answers `names-unavailable`.
- A: drop the tick (back to FU-A I1).
- C: keep it as built, and accept about 14,400 a day per process.

### F2. Minor: the limits are in memory, per process
**Where:** `limits.ts:36-61` (`TokenBucket`), `limits.ts:108-150` (`KeyedBuckets`), `limits.ts:200-201`.

Both budgets live in process memory, not in the database. With N API processes the site-wide bound becomes N × 14,400 a day. Each restart refills the burst of 30. Today the API is one process (`docs/coordination.md:79`, EventBus), so the number holds for now.

**Fix:** if the tick stays in its current form (option C), either move the site-wide count to Postgres (like `login_throttle` / `dailyCap`) or add it to the Plan 6 scale-out list next to the EventBus note. The comments in `nameCheck.ts` and `limits.ts` should also say "per process".

### F3. Minor: one shared budget means one script turns the tick off for everyone
**Where:** `nameCheck.ts:31-32`.

A script sending one request every 6 seconds keeps `NAME_CHECK_BUCKET` empty all day. Every honest signup then sees "We'll check it when you finish", while the script takes all 14,400 answers. Signup itself still works, as the builder says.

**Fix:** none needed if the owner keeps option C. Option B removes the reason to care.

### F4. Minor: a login name waiting out a hold can be found before it takes effect
**Where:** `accounts.ts:240-244` (the `pending(...)` clause, reached from the tick).

A legacy account that has requested a private login name holds it in `account_holds` for 24 hours. The tick shows that name as taken, so a stranger can find someone's next login name before it is even live. The tick has to match `createAccount` to be accurate, so this follows from F1.

**Fix:** goes away with option B. Under option C, accept it (there are no real pre-009 accounts: residual (c)).

### F5. Minor (raises owner question 8 of section 7): the recovery code is now the only backup, and a stranger can slow it
**Where:** `apps/api/src/auth/recovery.ts:138, 159-160`, `throttle.ts:51-53`.

Every untrusted browser trying a recovery code for an account shares one throttle key, `recovery-code:<account>:anon`. Someone who knows the login name, which F1 now lets them find, can keep that key at one try per 30 seconds (R28). The real owner of the account, on a new browser after losing every device, then competes with the stranger for each try. Before this branch, a TOTP backup was a second path with its own key. Now there is only one.

**Fix:** owner question 8 ("always let a correct recovery code through even when logins are throttled") becomes more urgent. Answer it before or together with this branch.

### F6. Minor (owner-gated): removing TOTP as a backup leaves some accounts without one, and Settings still offers it
**Where:** `recovery.ts:138`; `apps/web/src/screens/settings/Methods.tsx:39` (the comment "an authenticator app and recovery codes only back them up" is now wrong for TOTP), `Methods.tsx:155-157` ("Add an authenticator app" is offered to every account); `apps/api/src/auth/totp.ts` (enrolling needs no password).

**Scenario:**
- An account that logs in with PGP or a passkey and set up TOTP as its backup now has no backup way in, and nothing tells it so.
- A passwordless account can still add an authenticator app in Settings. That adds no way in at all: TOTP is used only as a password's second step.

**Can a user end up with no backup?** Yes. Signup's backup step still has "Skip for now", which was already true and is what the owner wants (optional, strongly recommended). The new part is losing a backup without being told.

**Fix:**
- The owner confirms the removal (Owner question 2).
- Pure engineering: fix the `Methods.tsx:39` comment.
- Copy for design: in Settings, hide "Add an authenticator app" or explain it when the account has no password.
- Before launch, a one-line count of accounts that have TOTP but no password and no recovery codes. Expected 0 before launch; verify on the live database.

### F7. Minor (owner + lawyer): the Terms still use the old names, and the version was NOT bumped
**Where:** `apps/web/src/screens/setup/termsText.ts:50` says "You pick a public username and a private login name". The branch's screens now use "username" for the private name and "display name" for the public one (Q54), so the Terms the person accepts on step 0 contradict the screen they see next. `termsText.ts` is **not changed** on this branch: `TERMS_TEXT_VERSION = '2026-10-17'` (`termsText.ts:16`). The server's `X2F_TERMS_VERSION` must change with it (config.ts:195, R10), and `apps/web/e2e/setup.spec.ts:14` pins `'2026-10-17'` too.

**Fix:**
- The owner (and later the lawyer) approves new wording, for example "You pick a private username, which only you see, and a public display name."
- Then bump `TERMS_TEXT_VERSION`, `X2F_TERMS_VERSION` and the e2e constant together.

### F8. Minor (UX, no security effect): back buttons and "Change your names" skip the display name
**Where:** `setup/Login.tsx:89` (`back={path('name')}`), `setup/kit.tsx:140` ("Change your names" goes to `name`).

`display-name-taken` sends the person back to the username screen, not the display-name screen. The header of `DisplayName.tsx` claims "with a link back here". The flow still works: Continue goes on to the display-name screen.

**Fix:** point Login's back button at `display-name`, and point the link at `display-name` when the error is `display-name-taken` or `display-name-reserved`.

### F9. Info: the request reveals which namespace matched only through timing
**Where:** `accounts.ts:246-251`.

The `or` chain can stop after the first match. A display-key match may come back a little faster than a login-tag or pending match. At most this tells which namespace matched, and public profiles already tell that. A wrong shape gets 400, and the limits give 429 or 503: each of these depends only on the input's shape or the request rate, never on whether the name exists.

**Fix:** none.

### F10. Info: more variants of the private name are sent, but none are stored
**Where:** `availability.ts:486-499`.

Every 500 ms pause sends the name typed so far. That puts more variants of a private name on the wire than the old single submit did: a half-typed name, or a password typed into the wrong field. On the server, `req.body` is redacted in logs (`app.ts:190`), the route echoes nothing and stores nothing, and the test "never writes the name to the log" passes. Setup state stays in memory (`SetupFlow.tsx:12`). PGP and WebAuthn register challenge payloads still seal the names (`sealNames`, unchanged).

**Answer to check (2):** no path stores or logs the plaintext login name earlier than before.

### F11. Info (wording, for design): the hold message suggests an authenticator code alone can log in
**Where:** `apps/web/src/ui/cantDoCodes.ts:418`.

"If you had a passkey, a security key, or an authenticator code set up before the hold, log in with it now" implies an authenticator code alone can log in. It was never strong alone, and now it is not a login at all without a password. The wording predates this branch; send it to design as "your password and authenticator code".

## Checked and found sound

- **Name check against FU-D:** the tag is computed under every key in the ring, and each row matches only under its own key id. This is the same query `createAccount` runs (minus the advisory lock, which is fine for advice: `createAccount` checks again under `NAMES_LOCK`). A key removed from the ring frees its names here exactly as it does in `createAccount` (FU-D M3).
- **Order of checks:** a token is taken before the shape check (a malformed name probes nothing for free). The device bucket is taken before the site bucket. The body limit is 1 KiB. The origin hook and the maintenance gate apply. The response is only `{ available }`, with `cache-control: no-store`.
- **Backup login:** `kind !== 'recovery-code'` gets 400 `bad-request` before any lookup. A test checks with `spySql` that no account, TOTP, throttle, session or hold table is read. The recovery-code path is unchanged apart from removing the branch: the same lookup under every ring key, the same SQL sequence for known and unknown names (the I-1 parity test still runs for recovery codes), and the code is used up atomically.
- **24-hour hold:** a recovery code alone still opens a `recovery` session held for 24 hours and starts the account's hold. `STRONG_COMBOS` is unchanged. The weak single ways that can still be reached are a password alone (`weak-single`), a recovery code alone (held) and PGP alone (`pgp-single`). An authenticator code alone can no longer be reached, so the rules lost one weak path and stay consistent.
- **Display name:** signup cannot finish without one. The web guard `named` requires `displayName !== ''` (`SetupFlow.tsx:46`), and the server's `checkNames` requires both names. A display name equal to the account's own login name gets `names-same`, server side. A display name equal to anyone's login name, under any ring key, gets `names-unavailable` under `NAMES_LOCK` at create time (unchanged). A stale display name left over from going back is caught by the server.

## Tests: what they cover and what they miss

**Covered:**
- name-check: a free name; a taken login name in any case; a display name counting as taken; wrong shapes refused before lookup; the answer has only the `available` key; nothing logged; the device bucket gives 10 then 429 with a wait, a wrong shape also costs a token, and another device is unaffected; the bucket refills; the site gets 30 then 503 across throwaway cookies.
- Recovery: TOTP backup refused before any lookup, with no session, hold, throttle row or alert; the held session, passkey and security-key holds and ending the session, all moved over to recovery codes; I-1 parity for recovery codes.
- Web: one field; debounce; wrong shapes never sent; a taken name blocks Continue; paced or busy shows neutral and Continue still works; stale answers ignored; the display-name step (preview, must differ, reserved words, no availability call); the backup screen offers only a recovery code.

**Missing (recommend adding before landing, if the tick stays in its current form):**
1. A name whose tag is under an **older ring key** is reported taken (rotation, FU-D).
2. A login name **waiting out a hold** is reported taken (or, under option B, is not).
3. **SQL parity** for taken and free names (`spySql`), like the I-1 tests, so a later change cannot add a namespace-dependent query.
4. A device over its limit **does not spend the site budget** (the order the comment claims).
5. A **made-up but well-formed cookie** gets a fresh device bucket (documents R29 for this route).
6. Settings: adding TOTP to a passwordless account, and what it then does (nothing). Accounts with TOTP as their only backup.
7. Web: Login's back button and "Change your names" go to the right screen (F8); the `display-name` route guard when the login name is empty.
8. Playwright `setup.spec`, `login.spec` and `design-shots.spec` were not run by the builder or by me.

The deleted TOTP-backup tests (daily cap, parallel race, wrong or replayed code, disabled account) test a path that no longer exists, so deleting them does not weaken any test of live code.

## Owner questions

1. **Keep the live "username available" tick?** As built it lets anyone test whether a private username exists: up to **14,400 names a day** for the whole site, verified from the code (10 a minute after a first 30, `NAME_CHECK_BUCKET`, `limits.ts:94`). That is per API process, kept in memory, refilled at each restart. Throwing cookies away gets past the per-device limit. We had hidden this on purpose (FU-A I1, FU-D). You said your username "is as confidential as your password" (Q54) and is "the first factor" (1 Nov). For comparison: finishing a signup already reveals whether a name exists, but each try costs real work and creates an account when the name is free. Options:
   - **(B, recommended)** the tick checks only public display names, so it reveals nothing that is not already public;
   - (A) remove the tick;
   - (C) keep it as built.
2. **The authenticator app as a backup.** Your 1 Nov table had a "TOTP-only backup" row. This branch removes the authenticator code as a backup way in (design's gap list: "Your recovery code is your only backup"), and the recovery code becomes the only backup login. An account that relied on TOTP as its backup now has none, and Settings still lets a passwordless account add an authenticator app that then does nothing. Confirm the removal? If yes: should Settings hide the authenticator option when there is no password?
3. **Terms wording and version.** The Terms (section 2) still say "You pick a public username and a private login name", which now contradicts the screens ("username" = private, "display name" = public). Suggested wording: "You pick a private username, which only you see, and a public display name." Approve, and we bump the Terms version (now `2026-10-17`) on the web and the server together. Everyone accepts the Terms again on their next signup step.
4. **Section 7, question 8 becomes more urgent.** The recovery code is now the only backup. Someone who knows your username can slow every new browser's recovery-code tries to one every 30 seconds. Should a correct recovery code always get through, even while logins are throttled?
5. **Wording for design (no decision needed, FYI).** The hold message says "an authenticator code set up before the hold, log in with it now". It should say "your password and authenticator code" (`cantDoCodes.ts:418`).
