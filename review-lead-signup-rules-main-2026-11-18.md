# Review: wip/lead-signup-rules-main @ ec766b7d vs main 75f7b5b4 (18 Nov 2026)

Independent security reviewer, one round. Verdict: **APPROVE** (no blockers; minors and owner questions below).

Scope: the seckey merge (47a8ca66), the owner's 16 Nov login rules (TOTP only with a password,
password never alone, UV required on every passkey and security key in the API and the moderation
gate), `lookAlikeKey` / `staffNameKey`, and the push.test flake fix.

## Merge
- The seckey head ae26e18b (and 1e151624) is already an ancestor of main 75f7b5b4. The two-dot and
  three-dot diffs against 75f7b5b4 are identical (26 files, +833/-59), so the merge reverts nothing on main.
- `git merge-tree` of ec766b7d with today's origin/main 708d821d is clean.

## What I checked, and what holds
**Password alone / TOTP without a password**
- `removable` (methods.ts) runs with the account row `FOR UPDATE`. It runs at the route and again in
  `applyRemoval`, which is also the write of a staged (hold) removal. Parallel removals are
  serialised. A staged removal that has gone stale is re-checked when it applies, then dropped
  (holdChanges `settleChangesInTx`: an ApiError is rolled back to the savepoint and reported in
  `dropped`).
- TOTP enrolment checks for a password at start (a preHandler, before the confirm token is spent),
  then again at finish and in `applyTotp` under the same account lock. So "remove password" racing
  "finish TOTP" cannot leave TOTP without a password. A staged enrolment whose password went in the
  meantime is dropped when it applies.
- `password-has-totp` fires only for `found.type === 'password'`. `password-alone` counts only PGP
  keys usable now, plus remaining passkeys, security keys and TOTP. A password and TOTP alone keep both.
- No other path deletes a password, TOTP, PGP key or credential: recovery.ts deletes only recovery
  codes, trusted devices and sessions. Members are deleted whole. Staff, members and the owner can
  never hold a password or TOTP (`allowedMethods`, R2), so these rules do not touch them.
- Tests added: methods.test (expired key and revoked key do not count; a usable key does) and
  totp.test (start, finish, apply, password removal while TOTP is on, the second-factor login).

**User verification**
- Only three call sites verify with simplewebauthn: api webauthn.ts (registration and assertion) and
  moderation gate registry.ts and verify.ts. All four calls now pass `requireUserVerification: true`,
  unconditionally. The trader's no-attestation retry reuses the same `verify` closure, so UV is
  still checked there.
- Login, discoverable login, add-key, confirm/step-up, staff and owner key taps (`finishKeyTap` →
  `verifyWebAuthnAssertion`), the invite key registration (`webauthnRegistrationOptions`) and the
  gate all go through those calls. The options ask for `required` everywhere: `registrationOptionsFor`,
  `buildAssertionOptions`, and discoverable login at L673.
- Gate: an owner create-invite tap without UV invites nobody. A staff registration or tap without
  UV is refused. Both have tests (gate.test, new describe).

**Tests not weakened**
- In the seckey attestation tests, `userVerified: false → true` and `'preferred' → 'required'`. The
  subject of those tests is attestation, and with the new rule a key without UV would fail for the
  wrong reason. The UV refusal now has its own tests: a trader security key without UV is refused
  at registration and at login (webauthn.test), all kinds × account kinds ask for `required`, and
  the gate tests above.
- The one removed assertion (methods.test "TOTP can go" beside a lone password) is now the
  owner-ruled opposite: 409 `password-alone`. That makes it stricter, not weaker.
- coolingOff C2 gives the fixture a PGP key so that the passkey can still be removed. The subject
  of that test (staging) is unchanged.
- push.test: subscriptions are drawn until clean of "EUR" and "X2F", plus an afterEach cleanup and
  a 500-draw self-test. The leak checks are unchanged.

**Names**
- `staffNameKey` (fold, then strip non-letters and non-digits) is used on both sides of every
  staff/owner comparison: sign-up (`assertNewNames`, which covers the password, PGP and WebAuthn
  sign-ups and the staff invite account) and team members (`checkMemberName`).
- INVISIBLE covers Default_Ignorable plus the Hangul fillers. The display-name regex is ASCII-only
  anyway, so these are defence in depth.

## Findings (none blocking)
**M1 (pre-existing, not introduced here): staff impersonation by order of arrival.** The staff
check runs only when a trader or member name is created. A staff member who accepts an invite
after a trader called `Mira_K` exists can take `Mira.K`. `assertNewNames` compares a new name
only with staff and owner names, and `assertDisplayNameFree` matches the exact `display_key`. The
trader then looks like staff. The fix is a behaviour choice (refuse the staff name, or rename or
flag the trader), so I list it as owner question Q1. Recommendation: at invite accept and owner
setup, refuse a staff display name whose `staffNameKey` matches any existing account.

**m1: lockout for keys without a PIN is not surfaced.** UV is now required on every login and
every tap. A key registered earlier with UV `preferred` and no PIN fails in one of two ways:
- If the browser cannot get UV (the person cancels PIN setup, or a U2F-only trader key), the
  result is a generic 401 `webauthn-failed`, shown as "The key's answer couldn't be checked.
  Try again, or use a different key." Nothing mentions a PIN.
- Staff and the owner have no reset (R2). Their keys are attested FIDO2 models on the allowlist,
  so browsers will normally offer to set a PIN. A trader with only a U2F-only key and no recovery
  codes would be locked out.

No stored flag records whether a credential was registered with UV, so the server cannot warn
ahead of time. Owner question Q2.

**m2: legacy credentials still count as standing alone.** `password-alone` counts every stored
passkey and security key. A key registered before the UV rule that cannot do UV logs no one in
now, but it still lets TOTP go beside a password (the expired-PGP-key reasoning, applied to
credentials). This is narrow, and it depends on m1.

**m3: the gate logs historical taps.** `syncRegistry` re-verifies every used registry tap on each
sync. Owner taps from before the rule, made without UV, now fail and are logged each time as
`gate.refused.bad-signature`. The gate state they already applied stays (it is persisted), so
this is log noise only. An invite that is still open and whose key registered without UV before
deploy now joins nobody, with only a log line. That staff member would need a new invite.

**m4: sign-up still creates a password-only account.** `/v1/register/password` succeeds with a
password and nothing else (signup-rules.test registers that way), and the server enforces the
rule only on removal. Already listed as an owner question by `second` (17 Nov 03:35: "legacy
password-only accounts at login"); repeated here for completeness.

**n1:** The F4 fold is the owner's list (0/o, 1/l/i, rn/m) plus Latin look-alikes. ASCII pairs
such as vv/w and cl/d are not folded. That follows the owner's ruling and is not a defect; noted
in case the owner wants to widen it.

## Owner questions
- Q1 (M1): Should a staff or owner display name be refused when it look-alike-matches an existing
  trader or member? Recommendation: yes, refuse at invite accept and owner setup.
- Q2 (m1): Should staff and the owner get a notice before deploy to check that their keys have a
  PIN set, and should `webauthn-failed` on a key login mention the PIN? Recommendation: both.
  The copy would be COPY-UNSIGNED.

## Tests run (ec766b7d, `nice -n 10`, outside the lock per the 18 Nov rule)
- @x2f/api: webauthn 45/45, methods 45/45, totp 30/30, password 46/46, signup-rules 9/9,
  team 81/81, coolingOff 97/97, push 91/91.
- @x2f/accounts: username + methodPartners 136/136.
- @x2f/moderation: gate 61/61.
- @x2f/web: totpNeedsPassword 6/6.
- tsc --noEmit clean: apps/api, apps/moderation, apps/web, packages/accounts, packages/auth-client.
- NOT run: the full `npm run check`. It was not in this job's scope, so the lead should run it
  under the lock before landing.
