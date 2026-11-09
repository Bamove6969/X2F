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
