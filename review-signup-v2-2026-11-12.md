# Review: `wip/lead-signup-v2` at 020c5cb2 (sign-up v2), security, 12 Nov 2026

Reviewer: independent reviewer (cloud helper). I made no code edits to the branch. The review ran in a detached worktree `rv-signup2` (removed afterwards). It is one commit on `origin/main` 8246e64b: 24 files, +1388/-249.

**The site PGP signing key work the brief mentions is not on this head.** There is no commit for it, and no file changes a signing key. What the branch uses is the existing official signing key (R7, on main). I reviewed that below; the new work needs its own look when it lands.

## Verdict

**Land, with the items below fixed or accepted.** Nothing is blocking. The server-side change is small: the code formats and the recovery input length. The login and confirmation rules are unchanged, and the new flow stays inside them.

- **The main risk is not new.** It is the creating session's 30-minute sign-up window (`onboarding_until`, `requireConfirm({ onboarding: true })`). The window:
  - skips the confirmation for every add-method route, including replacing an existing password without the old one;
  - does not close when sign-up finishes.

  The branch now drives several method additions through it by design (a password after PGP, the authenticator app). That makes the window's limits matter more. See M1.
- **The client-side ordering is UX, not a security boundary.** The ticked order, "Set up later" and the required recovery code are all enforced only in the client. A direct API user has always been able to skip them. See m-2.

## What I checked (attack by attack)

### 1. Skip a factor

- **The first ticked method creates the account.** Every later one goes through the existing add-method routes, and "Set up later" is offered for each (MoreMethods.tsx). The server keeps no list of what was ticked. Skipping a later method is allowed by design, and gains nothing: it removes a factor the person chose; it does not get past one.
- **The required recovery code (owner S-017) is enforced only in the client** (SetupFlow `needsBackup`, the Backup screen). The server has no "recovery code required" gate. An account made straight through the API has no recovery code until it makes one. This was true before the branch. See m-2.
- **No route lets a session reach full trading strength by skipping a step.** Session strength comes from the login method (`strength`). Inside the window, `weakOf` treats the creating session as not weak whatever its method. That is pre-existing.

### 2. Add a weaker method to an account that should need confirmation

- **Outside the window**, every add-method route needs a confirm token for exactly that action:
  - `PUT /v1/account/password` (`set-password`);
  - `POST …/totp` (`add-method totp`);
  - WebAuthn and PGP add (`add-method`);
  - `POST /v1/account/recovery-codes` (`new-recovery-codes`).

  A weak or waiting login's change is staged for 24 h (hold model v3, `gateChange`).
- **Probe result.** Outside the window, `PUT /v1/account/password` with no token is refused with 403 (PROBE P3, asserted).
- **Inside the window there is no confirmation**, by design. A PGP-first account can add a password (the branch's intended path, Password.tsx `adding`) or an authenticator app with no proof beyond holding the creating session's cookie. That is acceptable for the person signing up. But an attacker who gets that cookie in its first 30 minutes (XSS, a shared or stolen device, a malicious extension) can add a weak method that persists. See M1.

### 3. Abuse the sign-up window to change methods later

- **Probe results:**
  - inside the window, the creating session replaced the account's existing password with no confirmation and no old password (PROBE P1, asserted: the new password logs in and the old one is refused);
  - it did so again after the recovery code had been made, that is, after sign-up was "done" (PROBE P2, asserted: after `POST /v1/account/recovery-codes`, a second replacement still logs in).
- **The window is purely time-based.** It is 30 minutes from the first session (`ONBOARDING_MS`). Nothing clears `onboarding_until` when the Welcome step is reached or the recovery code is confirmed. See M1.
- **Members, recovery sessions and later logins never get the window.** The `firstSession && !member` check in `startSession` holds.

### 4. Bypass the recovery-code check

- **Generation:** `newRecoveryCode` produces 64 symbols × 5 bits = 320 bits from `getRandomValues`. Masking with `& 0x1f` is bias-free (256 = 8 × 32).
- **Storage:** HMAC-SHA-256 under the current `X2F_RECOVERY_CODE_KEYS` key, bound to the account (FU-C), of the normalized code. The route hashes `normalized(c)` and the login hashes `normalizeRecoveryCode(input)`. Both give the same dash-grouped form.
- **Input:** read up to 200 characters, then normalized. Input that is not exactly 64 or exactly 16 symbols after mapping becomes `''`, whose keyed hash is never stored, so it can never match. Throttling (429), single use (the 79-character code logs in once: the branch's test) and the 24-hour recovery hold are unchanged.
- **The 200-character cap** is generous. It is applied by `slice` before normalizing, and the Fastify body limit still bounds the request. No new parsing path; ASCII only; `symbols()` refuses anything outside the alphabet.
- **Old 16-symbol (80-bit) codes keep working** until used or replaced. That is acceptable: keyed, throttled, single use. But there is no end date. See m-3.
- **The sign-up type-back** (screen B, Backup.tsx) is a typing aid. It compares `normalizeRecoveryCode(typed)` with the shown code, entirely in the client, and the code is kept only in the flow's memory: no storage, no URL, no log. It is not a security check and does not claim to be.

### 5. Break the PGP challenge

- **Strength:** `newLoginCode` is 48 symbols (240 bits), encrypted to the account's key(s) and signed by the official key.
- **The signed text binds** the site name, the host from the checked Origin, issued-at, expires-at (5 minutes) and the purpose (`challengeText`). Origin binding is checked again at finish.
- **Verification:**
  - `consumeChallenge` makes each challenge single use;
  - the purpose, account, session and origin must match;
  - SHA-256 of the normalized input is compared with `timingSafeEqual`;
  - decoys are refused.
- **The 12-symbol input still normalizes.** It can only match a 12-symbol issue: an old challenge (TTL 5 minutes, so gone now), or the owner first-run setup code (`staff/ownerSetup.ts` derives 12 symbols and needs that path). Because the stored hash covers the whole normalized code, a 12-symbol guess can never satisfy a 48-symbol challenge. See I-2.
- **The challenge hash is unkeyed SHA-256.** At 240 bits and 5 minutes that is fine. At the owner setup code's 60 bits, a leaked `owner_setup.code_hash` could be brute-forced offline. That is pre-existing; see I-3.

### 6. The site signing key (the existing official key, R7)

- **Where the private key lives:** a file at `X2F_PGP_SIGNING_KEY_PATH`.
  - `assertSigningKeyFile` refuses a non-regular file or any group or other permission bits (it must be 0600), and the API exits before listening.
  - `loadPgpSigner` refuses a public-only or passphrase-protected key, a key whose fingerprint is not `X2F_PGP_SIGNING_FINGERPRINT`, and one that cannot sign.
  - Errors name the variable, never the key.
  - Existing tests check that no log line and no public answer contains `PRIVATE KEY` (pgp.test.ts).
- **No key is in the repo.** `git grep "BEGIN PGP PRIVATE KEY BLOCK"` finds nothing; tests generate keys (`helpers/pgpKeys.ts`).
- **Signing-only is not enforced.** `getSigningKey()` must succeed, but a key that also has an encryption subkey (or certify/encrypt flags) is accepted. X2F never decrypts with it, so this is hygiene rather than a hole. If the new helper's work makes this key "signing-only", the loader should refuse any encryption-capable subkey. See m-4.
- **The key is held decrypted in the API process.** It sits in memory in an internet-facing service, so compromising the API gives the attacker the key: they can sign challenges and, with the published fingerprint, impersonate X2F's messages. That is an accepted trade-off on main. The new work should not widen what the key signs (for example, never sign user-controlled text).

## Findings

### Blocking

None.

### Major

**M1. The creating session's sign-up window is time-only and covers every method change. The branch now routes method additions through it.**

`requireConfirm(..., { onboarding: true })` skips the confirm token for the whole of `ONBOARDING_MS` (30 minutes), for:
- `set-password` (including replacing an existing password);
- `add-method` (TOTP, WebAuthn, PGP);
- `new-recovery-codes`.

Nothing closes the window when sign-up finishes.

Probe (a temporary test, not committed; results above): the creating session replaced the account's password with no confirmation and no old password, both during sign-up and after the recovery code was made.

Scenario: a sign-up on a shared computer, or with a malicious extension, or an XSS anywhere on the origin, within 30 minutes of account creation. The attacker adds a password (or swaps one), or a TOTP, or a passkey they control. No confirmation is asked, and the new method persists. The "login-method-added" alert is the only signal, and on a brand-new account it goes to the same browser.

This is pre-existing, but sign-up v2 now relies on it for the PGP → password and → authenticator paths.

Fix (lead or owner choice):
- (a) Close the window when sign-up ends: clear `onboarding_until` when the recovery code is confirmed or the Welcome step is reached (a small API call), or at the latest at the first wallet.
- (b) Scope it: inside the window, allow *adding* a method the account lacks, but never *replacing* one. That means `set-password` without a token only when the account has no password, and no new recovery code once one exists.
- (c) Shorten it (for example to 10 minutes).

I recommend (a) plus (b).

### Minor

**m-1. A password added after PGP, past the window, fails with no confirmation path.** `Password.tsx` (`adding`) calls `authApi.setPassword({ password })` without `withConfirm`. The security-key, passkey and authenticator steps do wrap it, and their comments say so: "someone who comes back later is asked to confirm rather than refused". After 30 minutes the password step gets a 403 and shows an error. That is a UX failure, not a security one, but it pushes people to drop the password or start over. Fix: wrap it in `withConfirm({ kind: 'set-password' }, …)` like the other steps.

**m-2. S-017 ("the recovery code is required at sign-up") is enforced only in the client.** The flow cannot reach the wallet or Welcome steps without it (`needsBackup`). But an account made through the API, or a person who closes the tab after the first method, has no recovery code and nothing on the server prompts for one later apart from what the web shows. This is pre-existing. Fix, if the owner wants S-017 as a server rule: refuse trading routes, or show a standing banner, while no recovery code exists. Or accept it and note it in the register.

**m-3. Old 16-symbol recovery codes have no end date.** They are 80 bits, keyed, throttled and single use, so they are fine today. But "until used or replaced" can mean forever. Suggest asking for a new code at the next strong login when the stored code predates 12 Nov (a `recovery_codes` created-at or format marker would be needed), or setting a date.

**m-4. The official signing key is not checked to be signing-only.** See section 6. If the new work's brief says "signing-only", enforce it in `pgpSignerFromArmored`: no subkey or primary with encrypt flags. Add a test with a sign+encrypt key that is refused.

**m-5. Missing test: the 48-symbol PGP challenge at the API.** The packages test pins `newLoginCode`'s length and pattern. No API test pins that a login challenge (decrypted with the test key) holds 48 symbols. None checks that a 12-symbol code cannot complete a 48-symbol challenge. Both properties hold in the code (section 5), but nothing would catch a regression. Add both in `pgp.test.ts`.

### Info

**I-1. The R9 randomness test's comment is stale.** `recovery.test.ts` "no patterns in recovery codes" now tests 64 positions (it was 16) at the same χ² threshold of 76 (31 degrees of freedom). That is not weakened: every position is still tested at the same strictness. But the false-alarm rate rises from about 16 × 1e-5 to about 64 × 1e-5 per run, so the comment ("about one false alarm in 3,000 runs") is out of date. Update it, or raise the threshold to keep the rate.

**I-2. The 12-symbol login-code path cannot be retired** while `ownerSetup.ts` derives a 12-symbol code. If the old challenge format is ever to be dropped, give the owner setup code its own normalizer.

**I-3. The owner first-run setup code is 60 bits under unkeyed SHA-256** (`owner_setup.code_hash`). That is pre-existing and outside this branch. With a database leak before first-run setup completes, it can be brute-forced offline. Consider HMAC under a `serverKey` subkey, as the recovery codes use.

**I-4. The 200-character input cap is a deliberate change** (it was 64) to admit the 79-character dashed code. It is safe, as section 4 explains.

## Tests: weakened or not

None weakened. The length changes keep testing randomness and strictness.

- **`packages/accounts/test/loginCode.test.ts`.**
  - The patterns moved to 12 groups (login) and 16 groups (recovery).
  - The existing alphabet-coverage test for login codes is unchanged.
  - New tests:
    - 200 recovery codes are distinct, 64 symbols long and already normalized;
    - one symbol short or long at either new length is refused;
    - a `U` is refused;
    - the 12-symbol and 16-symbol old forms still normalize;
    - 201 characters is refused.
  - `'x'.repeat(65)` now fails because `x` is not in the alphabet, not because of length; the 201-character case covers length. Nothing was removed.
- **`apps/api/test/recovery.test.ts`.**
  - The `CODE` pattern moved to 16 groups.
  - The R9 χ² spread test now runs on all 64 positions at the same threshold, so it is no less strict per position. Its false-alarm comment is stale (I-1).
  - New tests: the 79-character code logs in exactly once; an old 16-symbol code stored with the current key logs in once.
- **`apps/api/test/holdV3.test.ts`.** Only the expected length changed (16 to 64).
- **`apps/web/test/signupRecoveryCode.test.tsx`.**
  - "The typed-back code without the tick does not go on" was removed.
  - Its property is still asserted in the rewritten test: without the tick, `recovery-next` is disabled and the type-back box does not exist.
  - The "another code is not this one" and "no Skip before the code" checks are kept.
- **`apps/web/e2e/setup.spec.ts`.**
  - The radio-group M8 accessibility test was replaced by a checkbox version that still checks one tab stop per box and the linked `aria-describedby` help text.
  - The method clicks moved from radios to checkboxes.
- **`apps/web/e2e/parity.ts`.** Two new `KNOWN_EXCEPTIONS` are copy-only (`SetupLogin` lead, `SetupUsername` heading), each with the owner's note as its reason. No pixel or primary rule was relaxed.

## Tests run

Under `flock ~/x2f-comms/check.lock`, in the detached worktree at 020c5cb2, after a fresh `npm ci --ignore-scripts` (audit: 0 vulnerabilities):

| Suite | Result |
|---|---|
| `@x2f/accounts` `loginCode.test.ts` | 11/11 |
| `@x2f/api` `recovery`, `holdV3`, `pgp`, `confirm` tests, plus my temporary probe `zz-review-signup2.test.ts` (three sign-up-window cases, results in sections 2 and 3) | 133/133, 5 files |
| `@x2f/web` `signupV2.test.tsx` and `signupRecoveryCode.test.tsx` | 17/17 |
| Playwright `signup-v2.spec` and `setup.spec` | 38 passed |

The probe was not committed; it was deleted with the worktree.

Not run: the full suites and `npm run check`. Not reviewed: the site-signing-key work, which is not on this head.
