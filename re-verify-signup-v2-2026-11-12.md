# Re-verify: `wip/lead-signup-v2` at 74814e0e (sign-up v2 review fixes), security, 12 Nov 2026

Reviewer: independent reviewer (cloud helper). I made no code edits to the branch. The work ran in a detached worktree, `rv-signup2b`, at 74814e0e, after a fresh `npm ci --ignore-scripts` (audit: 0 vulnerabilities). The worktree and its node_modules were removed afterwards.

- **Previous approved base:** 020c5cb2. See review-signup-v2-2026-11-12.md.
- **Delta:** two commits (44cc8760 and 74814e0e), 33 files, +665/-411.

## Verdict

**NOT READY.** The M1(b) fix can be bypassed.

The "a method may be added, never replaced or doubled" rule is checked only when a ceremony starts (`/start`), not when it writes (`/finish`). The window lets a session hold up to three open TOTP enrolments, and any number of PGP or WebAuthn add challenges, so:
- a session can open several token-less ceremonies while it still holds none of a kind, then finish them all;
- those challenges also survive `onboarding/end`.

The one-request routes (password, recovery code) have the same gap between check and write, so two parallel requests both pass.

My probe asserted all of this; the results are under R1 below.

The other parts are sound:
- M1(a) works, including the scoping;
- m-1, m-4 and m-5 are real fixes;
- the test edits do not weaken anything;
- every suite asked for passes.

The merge onto main 4f0afa14 is **not** clean: two conflicts. Both are mechanical, and the resolved tree typechecks and passes (see Merge).

## Findings

### Major

**R1. M1(b) is enforced at the ceremony's start, not at its write. A method can still be replaced or doubled with no confirm token, including after `onboarding/end`.**

`onlyIfNew(kind)` is the `onboarding` predicate of `requireConfirm` on these routes:
- `POST /v1/account/totp/start`
- `POST /v1/account/pgp/start`
- `POST /v1/account/webauthn/start`
- `PUT /v1/account/password`
- `POST /v1/account/recovery-codes`

For the three two-step methods, the write happens in `/finish`, and `/finish` re-checks neither the predicate nor the window:
- `totp.ts` `enrolFinish` upserts with `on conflict (account_id) do update`;
- `pgp.ts` `addKeyFinish` calls `applyPgpKey`;
- `webauthn.ts` `addKeyFinish` calls `applyCredential`.

Probe results (a temporary test using the branch's own `signedUp()` helper; not committed, and deleted with the worktree):

| # | Steps, all in the creating session with no confirm token | Result |
|---|---|---|
| P4 | TOTP start A, start B; finish B (TOTP now set; a third start is correctly 403 `confirm-required`); then finish A | **200**. A's secret silently replaced B's (1 row). |
| P5 | TOTP start in the window; `POST /v1/account/onboarding/end`; then finish | **200**. Enrolled after the window was closed. |
| P6 | PGP add start with key 1, start with key 2, finish both | **200, 200**. The account holds **2** PGP keys. |
| P7 | Two parallel `PUT /v1/account/password` on an account with no password | **200, 200**. The second silently replaced the first. |
| P8 | Two parallel `POST /v1/account/recovery-codes` on an account with no code | **200, 200**. Only one live code remains, so one of the two answers showed a dead code. |
| P9 | WebAuthn start with `kind: 'Passkey'` | 400 `bad-request`. No case or kind mismatch is possible. |
| P10 | `onboarding/end` twice | Idempotent; `onboarding_until` stays null. |

WebAuthn was not probed. By the code it is the same as P6: `storeChallenge` at start, `applyCredential` at finish, and no re-check in between. So a second passkey, or a second security key, can be added freely.

**Impact.** This is the exact scenario of the original M1: someone with the creating session's cookie inside its 30 minutes (a shared device, an extension, XSS).
- With P4, they can replace the person's authenticator app *after* the person enrolled it, with no confirmation. They need only a start they opened earlier; it stays open for 5 minutes.
- With P5, closing the window at Welcome does not stop a ceremony that is already open.

The fix's own claim ("never replaced or doubled", `helpers/accounts.ts`, `signupWindow.test.ts`) is therefore not true at the API.

**Fix (engineering; no behaviour choice):**
1. When `requireConfirm` lets a start through on the window, record that in the challenge payload (for example `window: true`).
2. In each `/finish`, inside the transaction and after the account row is locked (`gateChange` locks it already), re-check that the account has none of that kind, and that the window is still open. If either fails, refuse with 403 `confirm-required`.
3. Have `endOnboarding` mark this session's open `add-totp`, `add-key` (PGP and WebAuthn) challenges used, at least the token-less ones.
4. For `PUT /v1/account/password` and `POST /v1/account/recovery-codes`, run the "none yet" check again inside the write transaction under the account lock, so a parallel twin loses.
5. Add P4 to P8 as tests in `signupWindow.test.ts`.

### Minor

**R2. Main has moved; the branch needs a merge or rebase.** Merging onto 4f0afa14 gives two conflicts:
- `packages/auth-client/src/index.ts`: main added `teamLimitsAction`; the branch added `formatRecoveryInput`;
- `packages/auth-client/test/flows.test.ts`: both sides added a clause to the `NOT_AUTH_CLIENT` comment.

The resolution keeps both sides, and the resolved tree passes (see Merge).

### Info

- **I-a. The `.well-known` link relies on the API serving the web origin.** In production `serveWeb` serves the web, and the e2e server does the same, so the route resolves. If a separate reverse proxy is ever put in front, it must forward `/.well-known/x2f-signing-key.asc`. Nothing tests the link end to end; the e2e checks only the `href`.
- **I-b. The signing-only check uses `getEncryptionKey()` at load time.** A subkey dated in the future, or one that becomes valid later, would pass the load and could encrypt later. This is very unlikely for a key the operator makes; enforcing it on key flags, whatever the date, would close it.
- **I-c. The removed setup.spec I1 test.** See test item 4.

### Owner or lead items (as instructed)

- **m-2 (the recovery code is required only by the client).** Accepted for now and recorded as a follow-up. Not blocking.
- **m-3 (old 16-symbol codes never expire).** Accepted. Confirmed: no path still issues 16-symbol codes. `newRecoveryCode()` (64 symbols) is the only generator. The only insert into `recovery_codes` is `recovery.ts` `applyRecoveryCodes`, and every caller uses it: `newCodes`, `renewRecoveryCode`, and the S-110 password change through `renewRecoveryCode`. The 16-symbol length survives only in `normalizeRecoveryCode`, for reading old codes.
- **The reload-on-backup re-confirm.** Accepted. It is what M1(b) intends: a second code is a replacement.

## Fix by fix

**M1(b): not complete.** See R1.
- The start-time predicate is right as far as it goes:
  - `HOLDS` covers all six kinds;
  - WebAuthn takes the kind from the body through the strict `credentialKind`, and `/finish` stores the kind the challenge recorded (`ch.method`), so start and finish cannot disagree;
  - the predicate reads `req.auth.accountId`, so another account's methods never count.
- **Delete-then-add is not a bypass.** `DELETE /v1/account/methods/:type/:id` always redeems a confirm token (`methods.ts`, with no `onboarding` option), so emptying a kind first itself needs confirmation.
- **No route still uses `onboarding: true`.** A grep finds only the five `onlyIfNew` uses.

**M1(a): works.** `endOnboarding` runs `update sessions set onboarding_until = null where id = $1` with `req.auth.sessionId` only.
- **No other user's window.** It cannot touch another session or account; the branch's test and my P10 both check this.
- **No reopening.** `onboarding_until` is set only in the session insert when `firstSession && !member`. `firstSession: true` is passed only by the two registration finishes (`password.ts:235`, `pgp.ts:827`); every login, approval and recovery path passes `false`. Token rotation keeps the same row.
- **The live-session exemption is safe.** The route only narrows the caller's own rights and writes nothing else. A request racing a revoke clears a column on a revoked row, which changes nothing. The route needs a full session (anonymous gets 401) and is behind the global Origin check.
- **Web side.** `EndSignup` calls it on reaching Welcome, after the wallet step. That matters because the first-wallet exemption needs the window. The call is best effort; the 30-minute expiry is the backstop.
- **The gap.** Open ceremonies survive the end (R1, P5).

**m-1: fixed.** `Password.tsx` now wraps the call in `withConfirm({ kind: 'set-password' }, …, prove)`, and a confirm abort is not shown as an error. The new e2e test checks that a 403 `confirm-required` opens the confirm sheet with the PGP method and shows no error.

**m-4: fixed.**
- `GET /.well-known/x2f-signing-key.asc` sends only `pgpSigner.publicArmored`, which is `key.toPublic().armor()`.
- It cannot fail, so it has no error path that could leak a file path or the key.
- It answers `application/pgp-keys; charset=utf-8` with `cache-control: public, max-age=3600`. The global `no-store` hook applies only to `/v1/*`, so it does not override this.
- The test asserts the body equals the public armor, contains no `PRIVATE KEY`, and has the configured fingerprint.
- `pgpSignerFromArmored` now refuses any key from which `getEncryptionKey()` returns a key (see I-b). It is tested with a default sign+encrypt key. The test signer is now subkey-free, and a test pins that.

**m-5: fixed.** The new `pgp.test.ts` test decrypts a real login challenge and checks:
- the code is 48 symbols in 12 groups;
- its first 12 symbols are refused with 401 `code-invalid`;
- that refusal used the challenge up.

**I-1: fixed.** The comment was updated (64 positions, about 1 in 1,500).

## Tests: weakened or not

None weakened.

- **The six API tests now given `confirmTokenFor`:**
  - `pgp.test.ts` binding and key-in-use;
  - `recovery.test.ts`, twice;
  - `totp.test.ts`, the late, s2 and R9 re-enrolments;
  - `webauthn.test.ts` I2.

  Each one is now a genuine second or replacement method, which M1(b) correctly sends to confirmation. Each test's subject is something else: binding, key-in-use, code replacement, expiry, the security-key limit, or R9 randomness. Every assertion is unchanged. `confirmTokenFor` mints a token through the real `issueConfirmToken`, bound to the cookie's own session and the exact action, so `redeemConfirm` still checks it. Confirmation itself stays covered by `confirm.test.ts` and the confirm-start tests.
- **`setup.spec` I1, removed.** It checked the UI sentence for a second PGP key already on another account, on the backup step's "Add another backup" panel. That panel no longer exists (a lead call), so the test cannot be kept as it was.
  - The server property is fully covered by the API test the builder cites: `pgp.test.ts` "adding a key already on another account → key-in-use at finish" (409 `key-in-use`). It passes.
  - What is no longer tested is UI copy only: a distinct sentence for `key-in-use` when a second key is added in Settings. No Settings test covers it, and the sign-up `KEY_IN_USE` sentence (`task28-units`, setup.spec `register/pgp/finish`) is still covered.
  - So this is acceptable on security, with a small UX coverage gap for whoever owns Settings.
- **The board check moved to the recovery-code screen.** `expectParity(page, 'SetupBackup')` still runs. The two new `KNOWN_EXCEPTIONS` (`Add {{choice}}`, `Skip for now`) are copy that no longer exists, each with the lead call as its reason. No pixel or primary rule was relaxed. The test now also asserts that no `[data-backup]` and no `backup-skip` exist.
- **signup-v2.spec.**
  - The per-row 44 px check of the login methods was replaced by `expectPhoneLayout`. That is not weaker: each row is a label holding a visible 22 px checkbox, and `expectPhoneLayout` fails such a checkbox unless its label is at least 44 px tall. It also now checks the whole step, and "New to PGP?" at 44 px.
  - The call list grew to include `wallets` and `onboarding-end`, so the end call is asserted.
- **signupRecoveryCode.test.** `expect(api.go).not.toHaveBeenCalled()` was dropped, because the flow now goes straight to the wallet; the rewritten test asserts `go('wallet')`. Nothing else was removed.
- **task28-units.** `BACKUPS` is gone with its step. The test now asserts that it no longer exists, and signupV2.test renders the step to check that no other backup is offered.
- **New: `signupWindow.test.ts`.** It is correct for single sequential requests, but it does not cover R1's cases.

## Tests run

All runs were under `flock ~/x2f-comms/check.lock`, with `timeout` inside the lock, in the detached worktree at 74814e0e.

| Suite | Result |
|---|---|
| `@x2f/api`, 17 files: `signupWindow`, `pgp`, `recovery`, `recoveryRulings`, `totp`, `webauthn`, `confirm`, `holdV3`, `coolingOff` (the route-classification tripwire), `password`, `methods`, `signup-rules`, `banList`, `deviceApproval`, `login-tags`, `team`, `sessions` | **608/608** |
| `@x2f/web`: `signupV2`, `signupRecoveryCode`, `task28-units`, `goodToken` | **43/43** |
| `@x2f/auth-client`, all 6 files | **77/77** |
| Playwright (Chromium at /opt/pw-browsers/chromium, `--trace off`): `signup-v2.spec`, `setup.spec`, `login.spec` | **64 passed** |
| `tsc --noEmit`: api, web | clean |
| Probe `zz-review-probe.test.ts` (P4 to P10, temporary) | 7/7 ran; results as in R1 |

Not run: the full suites, and `npm run check`.

## Merge onto main 4f0afa14

`git merge-tree` reports two conflicts (R2). I resolved them in the throwaway worktree by keeping both sides. On the resolved tree:
- `tsc --noEmit` is clean for api, web and auth-client;
- `@x2f/auth-client` passes 77/77;
- `@x2f/api` `signupWindow`, `coolingOff`, `pgp` and `pastrep` (both route-classification tripwires) pass 215/215.

Nothing was committed or pushed.
