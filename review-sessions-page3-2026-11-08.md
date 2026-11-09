# Security review, 8 Nov 2026: wip/lead-sessions, wip/third-owner-page3, wip/third-semgrep-triage

Independent read-only review against origin/main. I changed no code and ran no tests: every finding below comes from reading the code at the SHAs listed.

| Branch | SHA | Merge base | vs main (5c4c8773) | Verdict |
|---|---|---|---|---|
| wip/lead-sessions | 52a45fb7 | cbf8e50e | 1 conflict: apps/api/test/schema.test.ts | **Approve** (Minor only) |
| wip/third-owner-page3 | 180dac99 | cbf8e50e | clean (merge-tree 0948c885) | **Changes required** (2 Important) |
| wip/third-semgrep-triage | 680cbaed | 90baa68e | conflicts in all 7 files | **Do not merge**: main already has it, stronger |

There are no Critical findings. lead-sessions and third-owner-page3 merge cleanly with each other (merge-tree b9c33081).

## Migrations
- lead-sessions adds 307_session_length, 311_idle_reminder and 313_session_length_8h. No other origin/wip/* branch and not main carries 307, 311 or 313. The only other 3xx numbers on wip branches are 315 and 316 (one branch each). The numbers are clear.
- 307 drops `accounts.idle_hours`. Main (5c4c8773) and every origin/wip/* branch use it only inside files lead-sessions itself rewrites (routes/account.ts, auth/sessions.ts, auth/hold.ts, the accounts package). There are no outside users. The only drift is wip/lead-proto `apps/web/src/proto/fakeApi.ts`, which still fakes `logoutTimer`: prototype only, not security.
- page3 and semgrep-triage have no migrations.

---

## 1. wip/lead-sessions @ 52a45fb7: Approve

How it merges with main: one conflict in `apps/api/test/schema.test.ts`, where the expected migration lists need the union (main adds 113, 119, 122; the branch adds 307, 311, 313) and the 010 test needs the branch's form (the `idle_hours` assertion is gone). Everything else auto-merges. Main's new code (chat retention, release claim, semgrep) does not use the retired logout timer or `sessionPolicy`.

What I checked and found sound:
- **No revival.** `requireSession` still refuses on `expires_at`, `revoked_at`, realm (`app`), disabled account and member liveness. Both writers, `PUT /v1/account/session/length` and `POST /v1/account/session/extend`, call `requireLiveSessionInTx` (account lock plus `revoked_at is null and expires_at > now`) before the update. A revoke or an expiry in flight therefore acts for nobody. Extend is behind `requireConfirm({kind:'extend-session'})`, whose token is single-use and bound to session, account and action hash. Recovery sessions are refused there too.
- **No stretching without proof.** In routes/account.ts, around lines 395-405 on the branch, a later end needs `confirm-required`, except for the first choice within 10 minutes of the login with `length_hours` null (lead decision 6 Nov). Every write sets `length_hours`, so the free first choice happens once. A shorter choice can never move the end later: `end > old.expires_at` is the test.
- **Members.** `confirmerOf` (auth/confirm.ts) lets a member reach the PGP and WebAuthn confirm routes only for `extend-session` (`MEMBER_CONFIRM_ACTIONS`); anything else gets 403 `owner-only`. Proof is checked against the member's own login account (`personAccountId`). The token is still issued to the team session. `/v1/confirm/password` keeps the default `member` gate (fail closed). The finish routes re-run `confirmerOf` on the server-stored action.
- **Stale Terms.** `staleTermsOnlyToExtend` keeps R10 for every action except `extend-session`, by the same `body.action` that `parseConfirmAction` later reads (exact shape `{kind}`).
- **G10.** The TOTP skip applies only when `action.kind === 'extend-session'` (auth/password.ts:278). Every other confirm still needs the code.
- **Owner rules.** Q73 (5 minutes, `SESSION_PROMPT_MS`), G8 (no `requireNotHeld` on extend), G9 (extend writes no alert), G10, G23 (2/4/8/12 and 2/6/12/24 by `account_type`, column widened by 313), G24 (`now + hours`) and F18 (this session only) all match. Staff, owner and recovery sessions keep their fixed idle and absolute policies. `staff/login.ts:49` guards the now-nullable policy.

### Minor
- **S-m1. Extending keeps the same token, and trader sessions no longer have an absolute cap.** Where: `refreshSessionCookie`, auth/sessions.ts:~117, and extend at routes/account.ts:~436-455. Scenario: a session cookie copied once (disk or profile theft, a shared machine) stays valid for as long as the real person keeps tapping "Stay logged in". Under the old 30-day absolute limit it died on its own. The owner chose "no fixed maximum", so this is defence in depth, not a rule breach. Fix: issue a fresh token on extend, the same way `openSession` revokes the token a browser presents. Update the session's `token_hash` under the account lock and set the new cookie. The other tabs share the cookie, so nothing breaks.
- **S-m2. A stream can outlive a shortened session by up to 10 minutes.** Where: events/routes.ts, lifetime `setTimeout` at ~line 121, from `req.auth.expiresAt`. Scenario: `GET /v1/events` reads the old end, then `PUT session/length` shortens and runs `closeSession` before the stream attaches, so there is nothing to close. The post-attach check (`expires_at > now`) passes on the new end, but the stream's lifetime is still the old end, capped at `MAX_STREAM_MS` (10 min). The account's events keep flowing after the session has ended. The window is narrow and self-inflicted. Fix: have the post-attach query return `expires_at` and take the earlier of that and the old end for the lifetime.
- **S-m3. G25 not met: sign-up still leaves the person logged in.** Where: sign-up routes call `startSession(..., firstSession: true)`, for example auth/pgp.ts registerFinish. SessionLength.tsx:8 only skips the length question. The owner (G25) wants the person sent back to the login screen "as though they're not even logged in" to test their credentials, then asked for the length. Today the sign-up session runs 2 hours unchosen. Not a weakness in itself, but an owner-rule mismatch. Fix, or confirm with the owner: end the sign-up session once setup finishes, then go to Login. The setup steps that rely on the 30-minute onboarding window need checking first.
- **S-m4. Forward note on G9: a member's extend will need the team's working hours.** The owner says that when a team lead sets working hours, members "won't be able to extend the session anyway". Team working hours (p7-11) aren't built. When they land, `POST /v1/account/session/extend` and `PUT session/length` must refuse outside them. Record it on the working-hours task.

---

## 2. wip/third-owner-page3 @ 180dac99: Changes required

How it merges with main: clean (merge-tree 0948c885, no conflicts); clean with lead-sessions too. It also commits a build artefact, `packages/staff/tsconfig.tsbuildinfo` (Minor P-m3).

What I checked and found sound:
- **G3, one factor on a known device (`knownDeviceRule`, staff/login.ts).** It applies only to mod and senior roles holding all three methods (`holdsAllThree`). The owner and helpers keep two. It runs after the first factor has verified and after `staffLoginCheck` (switched off, hours), inside `completeLogin` before any pending row is made. It uses `trusted_devices` (HMAC of the httpOnly `__Host-` device cookie, 90 days). It is wired only on the staff routes; the trader webauthn and PGP mounts never pass it. Security key plus passkey is a pair for staff only, and the second step lists passkeys only after a pending row whose first method was a security key.
- **G4, second owner tap.** `consumeSecondOwnerTap` compares `credentialId` values that both come from `b64url(row.credential_id)` (verifyWebAuthnAssertion), so the canonical stored id is compared. A non-canonical base64url id from the same key cannot pass as a second key. Both taps are bound to the same intent and consumed in the same transaction. `remove-staff` is tapped and bound to the person (perm `staff.manage`).
- **G19.** The maintenance kind is now required (400 without it), and traders read "Unplanned maintenance".

### Important
- **P-I1. G4 gap: the owner's PGP keys change with one key tap, so the two-key rule can be walked around.**
  Where: staff/account.ts:41-47 (`pgpAddKeyRoutesAt` inTx: one `add-pgp-key` tap) and staff/account.ts:71-74 (the second tap is required only when `methodType === 'security-key'`). ownerKeys.ts:90 covers only adding a security key.
  Owner rule: G4 says the owner must produce "both security keys if he's going to be making any major changes like changing one of his keys or something like that". The owner logs in with PGP plus a security key (Q59), so his PGP key is one of his keys.
  Scenario: someone with a live owner session and one of the owner's security keys (stolen, or the second one left in a drawer) adds their own PGP key with one tap, then removes the owner's PGP key(s) with one tap each. Their own PGP key plus that security key is now the owner login, and the real owner can't log in with his PGP. The security-key changes this branch protects can't be done this way, but the account still changes hands.
  Fix: for `req.staff.role === 'owner'`, require `consumeSecondOwnerTap` on `add-pgp-key` (in the inTx) and on `remove-method` for every `methodType`, not only security-key. Add tests for owner PGP add and remove with one tap, with the same key twice, and with two keys.
- **P-I2. G3 gap: a moderator can still log in on a new device with two PGP keys and no hardware key.**
  Where: auth/methods.ts:83-96 (`pairAllowed`: for kind 'staff', two PGP factors with disjoint key sets are a pair) and `needsAfter('staff', pgp)` offering `'pgp'`. The test asserts it at apps/api/test/methods.test.ts:257: `pairAllowed('staff', pgp('a'), pgp('b'))` is true.
  Owner rule: G3 says "All three are required. Two of them are required to log in on a new device". Q51 says moderators hold a security key, a PGP key and a passkey, and a new device needs two of the three. "Two of the three" means two different methods. Two PGP keys are one method, usually on the same keyring on the same laptop.
  Scenario: a moderator's laptop (or keyring backup) is taken. It holds two of their PGP private keys, so the thief logs in as that moderator from any new device, with no security key and no passkey. With a security key and passkey always one of the pair, that is impossible.
  Fix: for staff with role mod or senior (`THREE_METHOD_ROLES`), refuse a PGP+PGP pair at the second step. `pairAllowed` doesn't know the role, so add a role check in the staff path, for example an option on `completeLogin` used by `staffLoginRoutes`, and drop `'pgp'` from what `needs` tells a moderator after a PGP first step. Helpers can keep two PGP keys until the owner says otherwise.

### Minor
- **P-m1. A moderator could register one YubiKey as both the "security key" and the "passkey".** Where: webauthn.ts:111-122 (a staff passkey uses attestation `none`, so the server can't see the authenticator). `excludeCredentials` is advisory: a client that removes it can register the same physical key a second time as a resident passkey. The key-plus-passkey pair (methods.ts:89) is then one device plus its PIN. Only the moderator can do this to their own account, and it still needs the PIN. Fix: either accept it and document it, or request `direct` attestation for staff passkeys and refuse one whose AAGUID is on the security-key allowlist (this catches the common case).
- **P-m2. Existing moderators without all three methods are not brought into line.** `holdsAllThree` is enforced on invite accept (invites.ts:265), on set-role (members.ts:231) and on removal (account.ts:76-84), but not on switch-on, and not at login for moderators who joined before G3. Those moderators simply keep the two-factor login; they don't get the one-factor shortcut. Fix: check on switch-on too, and list the moderators who are missing a method so the owner can follow up.
- **P-m3. Build artefact committed.** `packages/staff/tsconfig.tsbuildinfo` is in the branch. Drop it and add it to .gitignore.
- **P-m4. R1 needs a ruling update.** R1 in docs/superpowers/rulings-and-lessons.md, and the `completeLogin` doc comment (login.ts:41), still say staff "always need two factors". Record G3's known-device exception as a ruling so later reviews don't flag it as a bypass.

---

## 3. wip/third-semgrep-triage @ 680cbaed: do not merge (superseded)

How it merges with main: content conflicts in all 7 files it touches (.github/workflows/semgrep.yml, .npmrc, attestation.ts, leaked.ts, e2e/parity.ts, quoteModel.ts, proof/detect.ts). Main already carries the same triage from wip/lead-semgrep-cloud (2b77328d), and main's version is stronger in two places:
- it pins the semgrep container by digest (`semgrep/semgrep@sha256:2e45…`), where the branch pins only the checkout action;
- in `codePattern` (packages/proof/src/detect.ts:~274), main escapes every non-class character before marking the `nosemgrep`. The branch leaves the characters raw, with a comment asserting the input is validated.

I checked each suppression in the branch for whether it hides a real issue. None does. Each regex is built from constants (HEADINGS, NAME_LABELS through `alternation`), from a number (`exponent`) or from escaped test text, and SHA-1 is only the HIBP lookup key. The codePattern one is the weakest, which is why main's escaped version is the one to keep. Recommendation: close the branch.

Note for the lead (main, not these branches): `.npmrc` `min-release-age=7` is weaker than the binding 14-day rule (rulings, Toolchain). npm's floor is 7 days, while the rule asks 14 for every dependency. Either set it to 14 or note that the 14 days stay a manual check.

---

## Re-verify 2213ae8a (wip/third-owner-page3): APPROVED

Worktree agent-a7cf3edc7272187d6, HEAD 2213ae8a (= origin/wip/third-owner-page3, local branch name `p3`), tree clean, nothing changed. Fixes are 4 commits on top of merge 2f9aa34a; that merge touches auth/staff only with two `nosemgrep` comments (attestation.ts, leaked.ts). Tests run: apps/api/test/staff/login.test.ts and apps/api/test/staff/account.test.ts, 52/52 pass. members.test.ts and methods.test.ts not run (load limit); read only.

- **P-I1: fixed.** `add-pgp-key` (account.ts inTx) and `remove-method` for every method type now call `consumeSecondOwnerTap` when `role === 'owner'`.
  - Same key replayed: refused. Reusing the same tapId fails because `consumeKeyTap` is a single conditional UPDATE on `used_at is null`. A second, fresh tap by the same key fails because the stored `credential_id` values match (409 `both-owner-keys-required`). Both cases are tested for add and for remove.
  - First tap on failure: everything runs in one `withTx` (pgpAddKeyRoutesAt: lock, inTx, applyPgpKey; DELETE: lock, taps, checks, applyRemoval). A missing or bad second tap rolls back the first, so it is left unused, still bound to the intent and session, and gone after 2 minutes. That gives an attacker nothing, and nothing gets stored.
  - Other routes that write owner methods: I checked every write to pgp_keys and webauthn_credentials.
    - The owner security-key add (ownerKeys.ts) already needed both taps.
    - The trader-site add and remove routes, and hold-end `applyChange`, sit behind trader `requireSession`, which refuses staff-app sessions on the trader API (`row.app !== realm.app`).
    - Invite accept and team join never make owner credentials.
    - The login-time PGP armor refresh only merges material for the same fingerprint. That needs the primary key's signature, so it is unchanged and not a path.
    - G59 (owner backup-key recovery) and G60 (owner reset of staff) are not built on this branch. When they land, they must keep both owner keys for any change to owner methods (or be the owner's G59 rule). Lead: please flag this to whoever builds them.
- **P-I2: fixed.** `pgpPairRule` returns true for mod and senior. In `completeLogin` it sets `{ pgpPair: false }` for kind staff before both the first step (`needsAfter` → `['security-key','passkey']`) and the second step (`pairAllowed` refuses PGP+PGP). The trader branch returns before this, so the `else if` → `if` change is safe. Both staff mounts pass it: `/staff/v1/login/security-key` and `/staff/v1/login/pgp`. They are the only staff login mounts. A second step on a trader mount gets 401, because `kinds` excludes staff and the pending row is bound to the `app`.
  - WebAuthn first, then PGP: this is a key+PGP or passkey+PGP pair. That is two different methods, so it is correctly allowed. The option goes through on that path too.
  - Helpers keep the two-PGP pair, and the helper test passes. Members are unaffected (`kind === 'staff'` only). The role is read fresh at the second step.
- **P-m1: fixed as far as attestation `none` allows.** A staff passkey whose AAGUID is non-zero and on the staff allowlist gets 409 `passkey-is-security-key`. (`isAllowed(..,'packed',..)` is only there to get past the `fmt !== 'none'` guard.)
  - **Stated plainly:** a staff passkey is registered with attestation `none`, so its AAGUID is the client's word. A client that forges or zeroes the AAGUID gets the same YubiKey through as a "passkey". Some browsers zero it under `none` on their own, which the spec allows. The check catches the honest common case only. Also, only the staff allowlist is checked, not the owner list (nit).
  - **Owner question (recommended):** should staff passkeys require attestation? Requesting `direct` alone does not close the gap, because a hostile client can still answer with fmt `none`. Closing it means refusing every staff passkey without a verified certificate chain. That rules out synced phone and password-manager passkeys (iCloud, Google), which give no usable attestation. Only an allowlisted hardware passkey of a second model would then be accepted. That is a user-facing security rule, so it is the owner's call. Context for him: only the moderator can do this to their own account, and the PIN is still needed. My suggestion is to accept best-effort and document it, unless the owner wants hardware-only passkeys for moderators.
- **P-m2: fixed.**
  - switch-on: `holdsAllThree` is checked inside the tx before `consumeKeyTap`, so a refusal (409 `all-three-methods-required`) leaves the tap unused.
  - `listMembers` gives `missingMethods` for mod and senior (attested key, PGP, passkey), and `[]` for everyone else and for invites. Its counts match `holdsAllThree`.
  - Nit (pre-existing, both places): the PGP count includes revoked or expired keys, so a moderator whose only PGP key has expired shows as complete. Not blocking.
- **P-m3: fixed.** `packages/staff/tsconfig.tsbuildinfo` is deleted and `*.tsbuildinfo` is gitignored.
- **P-m4: fixed.** The R1 amendment by G3 is in rulings-and-lessons.md (known device; never two PGP keys for a moderator; owner and helpers always use two), and the `completeLogin` and methods.ts comments are updated. Nit: the line is labelled R1 and sits between R30 and R31.

Verdict: **APPROVED** for merge. Open items:
1. The owner question on P-m1 above.
2. G59 and G60, when built, must keep G4's two-key rule.

## Re-verify c8c84e7f (sessions S-m1..S-m4, 8 Nov 2026)

Read-only re-check of `git diff 52a45fb7 c8c84e7f`, session parts only (commits 5234b2da, 978a2bb3, 28ef1109, 4daa49b5, 64b8238b). The worktree HEAD is c8c84e7f, which is `origin/wip/lead-sessions`. Note: the worktree's local branch is named `ls`, and the local `wip/lead-sessions` ref is stale at 1971a424. Tests run: `apps/api/test/sessionLength.test.ts` passed 34/34, and `apps/api/test/sessions.test.ts` passed 28/28.

- **S-m1: fixed.**
  - **Old token's lifetime.** `prev_token_until` is set to the session's `expires_at` read `for update` before the extend. `requireSession` caps the presented old token at `min(prev_token_until, expires_at)`. So the old token never outlives the old end, and a later shortening, expiry or revoke ends it too. `/me` (overview) and the event stream (`req.auth.expiresAt`) both use that capped end.
  - **Can an attacker force a rotation?** No. Extend needs a confirm token (`requireConfirm`, `extend-session`), so the person must re-prove a login method. A cookie alone cannot rotate or extend. Rotation does not help an old token: it gets no new end, and each extend drops anything older than the previous token.
  - **Logout and a new login.** Both revoke by `token_hash = $1 or prev_token_hash = $1` (`logoutRoute`, `openSession`). So either token ends the whole session and its streams.
  - **Routes that still match only one hash.** Only approval.ts: the "own session" check, `devicesInUse` and `makeRoom`. It does not matter for security, because it fails closed. A login that presents the old token inside its short window is treated as a new device, and `openSession` still revokes that session. Worst case is UX: the device limit could log out one other session, or list this browser in the `logged-out-by-new-device` alert. This needs a browser that kept the old cookie after the new Set-Cookie, so it is rare. Nit, not blocking. Confirm tokens are bound to `session_id`, so they are unaffected.
  - **Two extends at once.** They run one after the other: `requireLiveSessionInTx` takes the account lock, then `select … for update` on the session. Each needs its own single-use confirm token. If the responses arrive out of order, the browser can keep the first new token. That token is now the previous one and stays valid until the first extend's end, which is about the same as the second's. The next extend recovers. Benign.
  - **Cookie attributes.** Unchanged: `COOKIE_ATTRS`, `maxAge = TRADER_COOKIE_MS`. The cookie is set only after the transaction commits.
  - **Migration 314.** `prev_token_hash` is unique, and a check constraint pairs it with `prev_token_until`. Fine.
- **S-m2: fixed.** The post-attach check returns `expires_at`, and the stream's lifetime uses the earlier of that and `req.auth.expiresAt`. A shortening after the check finds the attached stream and closes it (M1). This also caps a stream opened with the old token at its old end.
- **S-m3 (G25): fixed for the normal path.**
  - **Server-side logout.** Start trading calls `POST /v1/logout`, which revokes the session row on the server (by either token), not just the client state. If that call fails, the next login revokes the session the cookie names (`openSession`), and Log in does not skip itself for a live session.
  - **returnTo.** It comes from `returnToFrom` (that is, `safeReturnTo`), and `startTradingPath` runs `safeReturnTo` again on the nested `/wallets?add=1&returnTo=…`. Login reads it through `returnToFrom`. An over-long nested value falls back to the default. No open redirect.
  - **Setup order.** Backup and first wallet come before Welcome and still run in the sign-up session and its 30-minute window. Logout happens only on Start trading. Someone already logged in who opened setup to add a wallet stays logged in.
  - **Residual nit, not blocking.** `registered` is in-memory setup state. If the page is reloaded on Welcome, or the tab is closed before Start trading, the sign-up session is not ended and runs its unchosen 2 hours, as it did before this fix. If the owner wants G25 to hold even then, Welcome could key off the server's `onboarding_until` or first-session flag instead of client state.
- **S-m4: recorded.** There are TODO comments on `PUT session/length` and `POST session/extend`. It still has to be carried onto the team working-hours task (p7-11).

Verdict: **APPROVED** for merge. Open items, none blocking:
1. The S-m3 reload/close nit above.
2. The approval.ts old-token nit.
3. Copy S-m4 onto the working-hours task.
