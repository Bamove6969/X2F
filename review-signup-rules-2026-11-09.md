# Security review: signup rules (J-09) on top of signup-team

- Branch: wip/lead-signup-rules, head a42eec01 (7 commits on signup-team 08d96d4d)
- Prior review of the base: review-signup-team-2026-11-08.md (APPROVED WITH MINOR; F2, F3, F8 followed up here)
- Date: 2026-11-09. Reviewer: cloud lead reviewer (independent, read-only on code)

## Verdict: CHANGES REQUIRED (small)

The server-side work is sound. The shared bucket is atomic, its refill maths is right, and the hour purge cannot reset a budget early. Recovery login never touches the password, names or hold. Weak passwords are refused on the server.

Two things stop it landing as is:
- S1: moving the budgets to Postgres removed the in-memory load shed, so a flood of unauthenticated requests now costs database writes even while the budget is empty.
- S2: the e2e changes are incomplete. Two `setup.spec.ts` tests will fail as written (S2a, S2b).

S3 is an owner question: the "required" recovery code is a UI gate only.

## Tests run (serialised runner, this worktree)
- `apps/api/test/name-check.test.ts`: 13 passed.
- `apps/api/test/signup-rules.test.ts`: 6 passed.
- `apps/api/test/recovery.test.ts`: 24 passed.
- `tsc -p apps/api --noEmit` and `tsc -p apps/web --noEmit`: clean.
- Not run: web vitest (`signupPasswordMeter`, `signupRecoveryCode`, `signupNamesBack`) and Playwright (`setup.spec.ts`, reviewed by reading only; see S2).

## Checked and sound

- **`takeSharedBucket` is atomic.** It is one `insert ... on conflict (key) do update ... where level >= 1000 returning`. Postgres takes the row lock on conflict and re-evaluates the WHERE against the latest row version. Two racing first inserts resolve as one insert and one update. A parallel burst can never take more tokens than the bucket holds; the cross-process tests show the count is shared.
- **Refill maths.**
  - Level in thousandths: `least(cap, failures + floor(max(0, now - last) * perSecond))`. A take writes `level - 1000` and `last = greatest(last, now)`.
  - Clock skew between processes only under-refills, which is the safe direction: the `greatest` calls stop time going backwards.
  - `floor` loses less than a thousandth of a token per take, which is negligible.
  - The largest level is 30,000, well inside `int`. The guard keeps `failures` at 0 or more.
  - `retryAfterSeconds` is right, and becomes 1 if the row vanished between the two queries.
- **A deleted row counts as full, and the purge can't reset early.**
  - A missing row inserts at `capacity - 1000`.
  - `purgeExpired` deletes `login_throttle` rows whose `last_failure_at` (the last successful take; refused takes don't move it) is over an hour old.
  - The function refuses any bucket that takes more than 60 minutes to refill (site 3 min, device 5 min). So a row old enough to purge is already full.
- **No collision in `login_throttle`.** Keys `name-check:site` and `name-check:dev:<hmac>` share no prefix with the throttle keys (`<method>:<account>:...`). Only the purge reads the table broadly; `lockAlert` acts only through `throttleFail`, which these keys never reach.
- **Device before site cannot starve honest devices.** A device's bucket is keyed to an HMAC of its own HttpOnly random cookie, so nobody else can spend it. Requests refused by their device's limit never spend the site budget.
  - The ordering is not new: the base already took the device bucket first (08d96d4d `nameCheck.ts:31-32`), so the "F3" change is the persistence only.
  - Cookie values are chosen by the client, so a script that makes up or drops cookies still drains the site budget. That is the partial F3 the builder states: no worse, no better. Option B from owner question 1 of the prior review is still the real fix.
  - Small side effect: while the site budget is drained, an honest device still spends its own device tokens on 503s (10 at once, 2 a minute). Harmless.
- **Typed-back recovery code.** The compare runs only in the browser on codes the server just sent to the same person, and nothing is sent to the server. It is a usability check, not an authentication check, so timing is irrelevant.
  - `pickIndex` uses `crypto.getRandomValues`; the modulo bias for 10 codes is negligible.
  - Codes stay in React state only, with no storage.
- **S-019 (`recovery.test.ts`).** Tests show a recovery-code login changes no names, no password hash or pepper, and the old password still verifies. A recovery session gets 403 `recovery-hold` on a password change during the 24 hours. A second code later moves the hold end later, never earlier. A recovery session cannot end another backup session.
- **S-012/13/14 (`signup-rules.test.ts`).**
  - Every sign-up route refuses names without a login method.
  - No sign-up or login works with an authenticator code alone.
  - A password missing any rule, or on the leaked list, is refused at sign-up and at a password change.
  - The meter is advisory: the server is the gate.
- **F8.** Back from the login method step goes to the display-name step. "Change your names" links to the screen of the name that was refused (`display-name-*` codes to the display name, anything else to the username). UX only.

## Findings

### S1. Important (availability): the name check now writes to Postgres on every unauthenticated request, even when the budget is empty
**Where:** `apps/api/src/auth/nameCheck.ts:36-37`.

**What happens:**
- Before, both budgets were in memory: a drained bucket refused without touching the database.
- Now every request runs an upsert that creates a new `login_throttle` row for a new or made-up cookie, then a second upsert on the single hot row `name-check:site`, then a `select` when it is refused. That is up to three queries, one of them a new row, per request.
- The rows live for an hour.
- The API keeps no IP, so nothing upstream caps the request rate.
- Every other public route sheds load in memory first: `budgets.start.take()` or `budgets.register.take()` before any query (27 call sites, for example `password.ts:235`).

**Scenario:** a script with made-up cookies sends name checks as fast as it can.
- Each request takes a pool connection and inserts a row, so the table and its index grow by millions of rows an hour.
- All requests queue on one row lock.
- The pool, shared with login and trading, runs dry.
- In-memory budgets made this impossible on the base.

**Fix (engineering, no behaviour change):** keep a process-local `TokenBucket` in front as a load shed, using `budgets.start.take()` or a dedicated in-memory bucket sized at the site budget, before the first query. Keep the two shared buckets after it as the real limit. Optionally, skip the device upsert when the cookie was just minted on this request (a new device is full by definition). That does not help against made-up cookies, so the in-memory shed is the part that matters. Add a test that a drained in-memory shed answers without a query (a `spySql` helper exists in the tests).

### S2. Important (tests): `setup.spec.ts` will fail as written (not run by the builder or me)

**S2a.** `setup.spec.ts:217` (both phone sizes) calls `expectParity(page, 'SetupBackup', ...)` before the codes are saved. The new first view of the backup step shows "Save your recovery codes" and the code panel. The `SetupBackup` board's texts are missing from it: "Add a backup way to log in", "We recommend it. ...", the radio options and "Skip for now". After saving, the heading is "Add another backup (optional)". `parity.ts` has no new `SetupBackup` exceptions, so the parity check fails. The builder needs to add exceptions with reasons (design S-017, board not updated), or run parity on the screen after saving and except the changed heading and intro. Which board texts are given up is a design call: the copy is COPY-UNSIGNED.

**S2b.** `setup.spec.ts:462-463`, the quote-return test ("a visitor who taps Trade comes back to the same quote ..."), still clicks `[data-part="backup-skip"]` straight away. That button no longer exists until the codes are saved, so the click times out.
- Fix: call `saveRecoveryCodes(page)` first.
- The test's own rule ("each one reached by a single tap of its own button ... Any step added later must keep this green") is broken by S-017: the backup step now needs a tap, a tick and a typed code. The lead or owner should note that S-017 knowingly overrides that rule, and the test comment should say so.

**Also:**
- This branch's `setup.spec.ts` still has `TERMS_VERSION = '2026-10-17'`. Terms-signature bumps it, so expect a mechanical conflict when both land.
- Run `setup.spec.ts` once (Playwright) before merging.

### S3. Minor (owner question): "recovery codes required" is enforced only in the setup screens
**Where:** `apps/web/src/screens/setup/SetupFlow.tsx` (`needsBackup`, the `after()` routes), `Backup.tsx`. No API change.

**What happens:**
- The account and its full session exist once register finish succeeds. Codes are made only if the client calls `POST /v1/account/recovery-codes`.
- A direct API client skips that step. So does a person who reloads (the `registered` memory is lost, so `needsBackup` is false) or goes straight to `/sell` (the gate covers only `/setup/wallet` and `/setup/welcome`). Any of them ends up with an account that has no recovery code.
- Nobody else gains anything: the only person exposed is the account holder, who risks being locked out. So this is not an attack path. But "required" does not hold.
- Separately, a reload on the backup step makes a new set that replaces the old one (documented). Someone who wrote down the first set and reloads must write the second set; the step does make them type one back.

**Options:**
- (a) Accept a UI-only requirement (recommended for launch; nothing to defend).
- (b) Have the server answer 403 `backup-required` on trading routes while a new trader account has no recovery codes, like `terms-required`.

### S4. Minor: the meter can say Strong for a leaked password until it is submitted
**Where:** `Password.tsx` `passwordStrength`. Leaked status is known only from the server's refusal (`password-leaked`), so before the first submit a password that meets every rule but is on the list shows "Strong", then flips to Weak. The claim "Strong = server rule + not leaked" holds only after the server has answered.
- No security effect: the server refuses it.
- Fix if design wants it exact: show "Strong" only after a server check, or word the meter so it does not promise "not leaked" before the check. Wording is for design.

### S5. Info
- The comments in `nameCheck.ts:17-19` and `limits.ts` now say "per process" or "Postgres" correctly. The remaining `TokenBucket` and `KeyedBuckets` users are still per process (as documented). The Plan 6 scale-out list should keep the register, start and security-change budgets.
- The prior review's F1 (the tick is an oracle for private login names) is unchanged and still waits on owner question 1. F2's persistence makes the 14,400-a-day bound hold site-wide.

## Owner or lead questions
1. S3: is a UI-only "required" enough for the recovery codes, or should the server refuse trading until codes exist? Recommendation: UI-only for now.
2. S2b: S-017 lengthens the visitor's short trip (one more step that needs a tick and typing). Confirm that the "single tap per board" rule gives way to it.

---

# Re-verify 7bd9532a

- Branch: wip/lead-signup-rules, base a42eec01; fix commits 473e8f3b (S1), 3844d89e (S4), 7bd9532a (S2).
- Date: 2026-11-09, later. Re-verifier: cloud lead reviewer (independent, read-only on code).

## Verdict: APPROVED WITH MINOR

S1, S2 and S4 are fixed as described. Nothing in the three commits loosens a limit, weakens a test or changes what the server refuses. One owner/design question falls out of the S4 fix (finding 6: the meter never says Strong any more, and "Checking…" describes a check that is not running); the rest is information.

## Tests run (this worktree, serialised runner unless said)
- `apps/api/test/name-check.test.ts`: 15 passed (13 before, plus the two S1 shed tests).
- `apps/web/test/signupPasswordMeter.test.tsx` and `apps/web/test/signupRecoveryCode.test.tsx` in one run: 2 files, 9 passed.
- `tsc -p apps/api --noEmit` and `tsc -p apps/web --noEmit`: clean (run directly, as the brief allows; the runner was held by another helper's `npm run check`).
- Not run: Playwright (`setup.spec.ts`), read only. The builder reports 33 passed; the file has 29 `test(` calls of which 4 run at two phone sizes, so 33 is the right count for a full run.

## Findings

1. **S1 verified: the shed sits before any query, with the right codes, and no row for a made-up cookie.** `nameCheck.ts:41-46`: device shed (`KeyedBuckets`, 429 `slow-down`), site shed (`TokenBucket`, 503 `busy`), then the two Postgres buckets with the same codes. Both sheds throw with `retryAfterSeconds`, as the shared ones do. The only work before a shed refusal is the cookie check and one HMAC. The new tests hold it: an empty site shed answers 503 with no `login_throttle`/`accounts`/`names` statement and the `name-check:%` row count unchanged; an empty device shed answers 429 with no statement. `spySql` wraps `pool.query` and checked-out clients, and `takeSharedBucket` goes through `deps.db.query`, so a query could not hide from it.
2. **Sizes are sane against the shared budgets.** Each shed is the same size as the shared bucket behind it (30/10 a minute site, 10/2 a minute device), so a shed can only ever be as strict or stricter than Postgres, never looser; the shared count is still taken after it and remains the real site-wide bound (14,400 a day). With N processes the sheds together admit N times the budget, which Postgres then cuts back to one budget: correct, that is what a shed is for.
3. **No new way to lock real users out.** Per device: the key is an HMAC of the browser's own random HttpOnly cookie, so nobody can spend another browser's shed. Per site: a script with made-up cookies can empty one process's site shed with 30 requests and hold it empty at 10 a minute, giving everyone on that process 503 `busy`; but that is exactly what the shared site bucket already did (and the base's in-memory bucket before F2), with the same effect (the tick says "checked when you finish"; sign-up still works). The shed makes that flood cheaper for the server, not more effective for the attacker. The known trade-off (prior review owner question 1, option B) is unchanged.
4. **Info: the comment "the shed refuses nothing the shared count would allow from that process" (`limits.ts`) is slightly too strong.** Two edge cases make a shed stricter than Postgres, never looser: (a) after a restart the shed is full while the shared bucket may be low, so up to 30 requests pass the shed and are refused by Postgres (3 queries each, bounded, then the shed is in step again); (b) with several processes, a device at its shared limit that lands on a process whose device shed is still full passes both sheds, spends that process's site-shed token, and is refused by the shared device bucket, so the site shed can run a little ahead of the shared site bucket. Harmless; the comment could say "never looser". No change needed.
5. **Info: first unauthenticated use of `KeyedBuckets`.** The device shed's keys are chosen by the client (any 43-character cookie). Memory is bounded by `maxKeys` 100,000 (about 20 MB of Map). `prune` is O(1) while the oldest entry has refilled (30 s after its single take), and scans the whole Map only when more than 100,000 distinct cookies arrive within 30 s on one process (over 3,300 requests a second), which the process would not sustain anyway. Far better than the row per request it replaces. Optional hardening if ever wanted: a smaller `maxKeys` for this shed. No change needed for landing.
6. **S4 verified, with an owner/design question (Minor).** `passwordStrength` returns `strong` only for `'clear'`, `weak` for `'leaked'` whatever the shape, `checking` for a password that meets every rule before the server has spoken. The server does not care what the meter says: `assertNewPassword` (`password.ts:83-86`, `checkPassword` then `leaked.has`) runs at register (`password.ts:199`) and at a password change (`password.ts:316`) and answers 400 `password-leaked`. Tests cover the levels, the leaked case and that "Strong" is never in the screen's text before the refusal. **But** in the live screen `setLeaked` is only ever called with `'unknown'` (typing) and `'false'` (a `password-leaked` refusal); the only "not leaked" answer the server gives is a successful register, which leaves the screen. So the Strong level is now unreachable: the meter reads Weak, Medium, "Checking…", and "Set password" is enabled under "Checking…" while nothing is being checked until the tap. Owner S-014 asked for "weak, then medium, then strong" and "only a strong password is accepted". Security-neutral; the word is COPY-UNSIGNED. Options: (a) keep "Checking…"; (b) a top-level word that does not promise "not leaked" (for design, e.g. "Meets the rules" or "Strong (checked when you set it)"); (c) a server check without registering (new route, over-engineering for launch). Recommendation: (b). Small: the unit test title "only Strong (typed twice) can be set" now describes the "Checking…" level.
7. **S2a: every new `KNOWN_EXCEPTIONS` entry, with my view.** All seven texts are on their boards (`boardTexts` throws on a stale one, and the spec passed). Nothing was removed from the list; nothing else in `parity.ts` changed.
   - SetupBackup "Add a backup way to log in": accurate. The view checked is the optional one, whose heading is "Add another backup (optional)".
   - SetupBackup "We recommend it. X2F has no email address…": accurate as to where the copy went (the required first view says "…a recovery code is your emergency way back in"). The recommendation sentence is no longer anywhere word for word; that is S-017's screen copy (COPY-UNSIGNED, on the branch before this commit), not something this commit dropped.
   - SetupBackup "Your coins stay in your own wallet either way…": accurate, and the spec now asserts this sentence verbatim on the first view, so nothing is given up here.
   - SetupUsername "lumen.k is available": the old reason ("No API answers whether a name is free") had been wrong since 766747ea; the new reason is right (the board's example name; the page says "<typed> is available", which `pickNames` and M8 assert).
   - SetupUsername "This is how traders see you. No email or phone number needed, now or ever.": half accurate. "This is how traders see you." is on `DisplayName.tsx`. "No email or phone number needed, now or ever." is on neither screen: `Username.tsx` has said "Nothing else to give us, now or ever." since 766747ea (item 6, before this branch). The reason does not say the second sentence is gone. Lead: confirm design's item 6 list has it, or ask the builder to name the dropped sentence in the reason.
   - SetupUsername "5 to 20 characters: … It shows exactly as you type it. Pick something…": accurate; the split across the two help texts is exactly as stated.
   - SetupWelcome "Authenticator app": accurate; the board's example value for the Backup login row. `summarize` maps `recovery-codes` to "Recovery codes" and the spec now asserts `summary-backup` says so.
8. **S2 and item 4: no assertion weakened, and the behaviours under test are still exercised.**
   - PGP path (both sizes): parity moved to the optional view and three assertions were added (the "Show my recovery codes" button and the panel sentence on the required view, "Skip for now" only after saving, "Recovery codes" on Welcome). `saveRecoveryCodes` itself asserts `backup-skip` is absent before saving and Continue is disabled until the tick and the right code, so the S-017 gate is tested on every path that uses the helper.
   - Quote-return (S2b): `saveRecoveryCodes` before "Skip for now"; the `seen` list and the "no more screens than the boards" bound are unchanged; the override of the "one tap per board" rule is in a comment and stands as owner question 2.
   - Taken display name: the register error is still asserted; "Change your names" now must land on `/setup/display-name` with the display name kept, and Back must show the username kept. Same two values as before plus the right screen (F8, `register.ts:102`, `kit.tsx:141`). Nothing masked.
   - M6 terms change: still asserts the first refusal sends the person to the Terms with the tick disabled, the names kept (now both, each on its own screen), the retry posting the version read, two bodies. Only the expected username (`lumen-login-7`, the private name `toPassword` typed) changed; the old `lumen.k` was wrong since item 6.
   - M8: stronger than before (every id in `aria-describedby` must exist exactly once; the help visible; the live tick asserted).
   - I1 second key: saves the codes first; the assertion is the same.
9. **Still open from the first review**, unchanged: S3 (UI-only "required" recovery codes, owner question 1), S2b confirmation (owner question 2), the `TERMS_VERSION` conflict note, and F1 from the prior review.

## Owner or lead questions (added)
3. Finding 6: with the S4 fix the meter never reads Strong; "Checking…" is shown while nothing is being checked, and "Set password" is enabled under it. Keep, or pick a top-level word that promises only the rules (recommended, for design)?
4. Finding 7: the SetupUsername exception swallows "No email or phone number needed, now or ever.", which is on no screen now. Confirm design's item 6 copy list has it.
