# Review: wip/lead-seckey-main @ ae26e18b (17 Nov 2026)

**Verdict: APPROVE.**
- The 5 clean picks are patch-identical to the reviewed originals, and M1 is unchanged.
- The two ports are safe. The Login.tsx port shows only fixed sentences and does not change which methods login offers. The e2e spec lost only the success-state and label checks, which cannot apply on main.
- Neither drop leaves main less safe. Main has no demo RP-ID adoption at all, so there is nothing for M2 to fix. The MoreMethods success state is UX only.
- The trial merge onto main b6f9cf0e is clean: 0 conflicts. The full check on the merged tree is green.

Reviewer: independent security reviewer (helper). Worktree: scratchpad/rv-skm, detached at b6f9cf0e with `git merge --no-commit ae26e18b`, fresh `npm ci`. Nothing was committed on the code branch.

Context read: re-verify-second-seckey-fixes-2026-11-17.md and review-third-seckey-fix-2026-11-16.md.

## 1. Clean picks: identical to their originals
I compared `git patch-id --stable` for each pair:

| original | port | patch-id |
|---|---|---|
| 8acc3388 | ce0cc34a | same |
| fe6765c7 | 1380a036 | same |
| 88516969 | 3370e8f0 | same (raw diff differs only in blob ids and the hunk offset in cantDoCodes.ts, 603 → 644) |
| b4ae3137 | d61d6dd1 | same |
| a7322fc6 | 04bcf5e0 | same |

The resulting files on ae26e18b are also byte-identical to 64ea5c1f: `git diff 64ea5c1f ae26e18b` is empty for these files:
- `apps/api/src/auth/webauthn.ts`
- `apps/api/src/auth/attestation.ts`
- `apps/api/test/webauthn.test.ts`
- `apps/api/test/helpers/softAuthenticator.ts`
- `apps/web/src/screens/auth/keyErrors.ts`
- `apps/web/test/keyErrors.test.ts`
- `apps/web/src/screens/settings/Methods.tsx`

**M1 still holds on main's code around it:**
- **The kind is read fresh at finish.** `addKeyFinish` passes `req.auth.kind`, which comes from `requireSession`'s `join accounts a` in sessions.ts (`a.kind`, read on every request). A `member` session is refused at sessions.ts:440. Sign-up hard-codes `trader`.
- **The retry runs for traders only:** `const plain = a.accountKind === 'trader' ? withoutAttestation(...) : null` at webauthn.ts:299. For staff and owner, an unknown model still gets 403 first (line 294).
- **A retried key is stored attested=false.** `withoutAttestation` rewrites the statement to `fmt: 'none'`. `attested` needs `packed` plus x5c plus the allowlist (line 311).
- **Login filters keys by the current kind.** The assertion options use `allowed(account.kind, c)` (line 486). The verify step uses `assertCredentialAllowed(row.account_kind, …)` (lines 500, 777, 912).
- Main's changes since 4f0afa14 in this area are limited to attestation.ts, which now reads CRLF in the allowlist README. That change does not touch how the kind is read or how keys are filtered.

## 2. The two ports

### d817fbd5 (Login.tsx and Backup.tsx; keyErrors.ts and Methods.tsx are identical to 2913010c)
- **No leak of account or key information.** Login calls `keyErrorText` only when `errorCode(e) === null`, meaning the error is from neither `ApiCallError` nor `AuthApiError`: it came from the browser or the network. Server refusals still go to `setupError` unchanged.
  - Every sentence `keyErrorText` can return is a constant string. `e.message` is only tested by regex to choose between constants; it is never shown.
  - The final `refusalText(e, fallback)` returns the fallback for a non-API error (`refusalOf` → null).
  - Nothing is interpolated: no account name, credential id or AAGUID.
- **InvalidStateError ("already on your account") cannot reveal anything at sign-up.** Sign-up registration passes `exclude: []` (webauthn.ts:842). The browser raises this error locally, against its own credentials, so no server state is involved.
- **The methods offered are unchanged.** The diff is 2 lines: the import, and the text of the `setError` call. `METHODS`, `pick`, the early returns for `pgp` and `password`, and `registerWebAuthn` are untouched.
- **Types.** `pick` is narrowed to `passkey | security-key` by the early returns, and typecheck passes.
- **Backup.tsx:** the generic sentence is replaced with `keyErrorText(e, 'security-key')`. Nothing else changes.

### ae26e18b (security-key.spec.ts, ported to main's backup-step flow)
I diffed it against the 64ea5c1f version.
- **Removed:**
  - the security-key checkbox on the method picker (main has no such step);
  - the success-state block (`key-done`, "Security key added", `key-name`, `key-picture`, and "no navigation for 500 ms, then Continue");
  - the `finishes[0].label` assertion. Main's `SecurityKeyBackup` has no name field.

  All of these belong to 811a69db and KeyStep, which are not ported.
- **Kept unchanged:**
  - `starts == [{kind:'security-key'}]`;
  - exactly 1 finish;
  - transport `[usb|nfc]` and `authenticatorAttachment: 'cross-platform'` in the finish body;
  - wrong RP ID → the `KEY_ERROR.wrongAddress` alert, the URL stays on the step, and `finishes == []`;
  - 403 → the `KEY_ERROR.notAccepted` alert and 1 finish;
  - server-shaped options and the CDP virtual key.
- **Added:** a positive navigation check (`/setup/wallet` after the add), plus stubs for the route to the backup step (recovery codes and wallet rule).
- No assertion was weakened beyond the stated removals.

## 3. What was dropped
- **Demo RP-ID adoption (b444794c) with its M2 fix (85e7e274/2b51ef80): no loss.**
  - Main has no `tools/demo/` at all (0 files at b6f9cf0e). Nothing in main reads Host or X-Forwarded-* to build an RP ID.
  - `X2F_RP_ID` comes from the environment only (config.ts:204).
  - node-proxy's test asserts that it never reads forwarded headers.
  - The M2 hole only existed with b444794c. Dropping both leaves main as it was: fixed RP ID, no adoption.
- **The MoreMethods/KeyStep success state (811a69db) and the MoreMethods keyErrorText hunk: no security effect.**
  - Main has no /setup/security-key step.
  - The label was never used in a security decision (prior re-verify).
  - Owner Q4, Q5 and Q6 from the re-verify (success wording, passkey parity, m2) do not apply on main until sign-up v2 lands.

## Minor (informational, not blocking; it was already in the reviewed original)
- m1: in Settings → Methods, a 403 `method-not-allowed` on **Add a passkey** now reads "This key model isn't accepted yet. Use a different security key." Before, the screen fell through to `refusalText`'s generic sentence.
  - Trader accounts can add passkeys, so on apps/web this only shows for a kind refused there (an owner's passkey).
  - The wording is wrong in that case, but nothing is exposed.
  - Optional: have `keyErrorText` map `method-not-allowed` only when `kind === 'security-key'`. That is a copy decision for the owner or lead.

## 4. Trial merge and tests
`git merge --no-commit ae26e18b` onto b6f9cf0e: **0 conflicts**. attestation.ts and cantDoCodes.ts auto-merged.

All steps ran on the merged tree in one hold of `~/x2f-comms/check.lock`, as `flock … timeout 5400 rv-skm-run.sh`, on Node 24.22.1. The run was 13:40–14:23 UTC, which is 06:40–07:23 BC time.
- `npm run typecheck`: exit 0.
- `vitest --project @x2f/api webauthn.test.ts attestation.test.ts`: 2 files, **53 passed**, 0 failed.
- `vitest --project @x2f/web` on 7 files: **48 passed**, 0 failed. The files were keyErrors, recoveryBurned, signupNamesBack, signupRecoveryCode, task28-units, task30-refusals and backupLogin.
- Full check steps (13 Nov rule):
  - copy-lint 0;
  - separation-check 0;
  - `npx vitest run`: **382 files passed, 7137 tests passed, 1 todo, 0 failed**;
  - semgrep 0 findings (113 rules, 1322 files);
  - audit 0 vulnerabilities.
- Not run by me:
  - Playwright. This job did not ask for it. The lead's own log `seckey-main-check2.log` shows setup.spec.ts and security-key.spec.ts passing 38 of 38 on ae26e18b.
  - A physical key.
  - The demo stack.

## Owner questions
None new. Re-verify Q1–Q3 still stand (where and how the 13 Nov key was added; KEY_ERROR wording, which is COPY-UNSIGNED; staff key list). Q4–Q6 wait for sign-up v2.
