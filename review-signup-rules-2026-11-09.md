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
