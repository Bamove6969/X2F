# Security review: Terms signature at account opening

- Branch: origin/wip/lead-terms-signature
- SHA reviewed: dec84c4a86752de4a1f802646ce9790e695c02c2
- Against: origin/main 1ffa1930 (also the merge base)
- Date: 2026-11-08
- Reviewer: independent security reviewer, read-only. This file is the record; the earlier review's record was lost.

## Verdict: CHANGES REQUIRED

Finding 1 stops the branch passing `npm run check`, so it cannot land as it stands. Findings 2 to 4 are privacy problems in what the signature collects, how it is kept and what the Terms tell the person. Finding 4 and part of 2 need the owner's decision (questions at the end). The core mechanics are sound: no bypass on any trader sign-up path, no reader of the data, strict validation.

## Test results

- `@x2f/api`: 79 files, 1,869 tests passed.
- `@x2f/web`: 90 files, 1,303 tests passed.
- `@x2f/auth-client`: 6 files, 76 tests passed.
- Typecheck: FAILS in `apps/api`, `apps/web` and `packages/auth-client` (finding 1, the only errors).
- Throwaway probes of `checkTermsSignature` (findings 6 and 7) were run in the review checkout and removed. The full `npm run check` was not run, as instructed.

## Important

### 1. The branch does not typecheck: `String.prototype.isWellFormed` is outside the configured lib
- `apps/api/src/termsSignature.ts:103`, `apps/web/src/screens/setup/signature.ts:74` (added by a22ebc6c, the earlier review's fix).
- `tsc --noEmit` fails in `apps/api`, `apps/web` and `packages/auth-client` with TS2550 (`lib` is ES2023 in web and auth-client; `target` ES2022 in tsconfig.base.json). main has no use of it. Vitest strips types, so the tests pass and hide this.
- Scenario: `npm run check` fails at its typecheck step, so the "READY" commit cannot pass the merge gate. Separately, the client calls it at runtime in an effect on every keystroke of the typed fallback; browsers without it (before Chrome 111, Firefox 119, Safari 16.4) get a TypeError on that screen.
- Fix: in both files replace the call with a regex that needs no newer lib: `/[\uD800-\uDFFF]/u.test(name)` (with the `u` flag it matches lone surrogates only, a valid pair is one code point). Keep the existing lone-surrogate tests. Do not widen `lib` instead, since that leaves the browser problem.

### 2. The typed fallback asks for the person's name and autofills their real one, against what the Terms promise
- `apps/web/src/screens/setup/SignaturePad.tsx:159,208` ("Type your name to sign") and `:166` (`autoComplete="name"`).
- `apps/web/src/screens/setup/termsText.ts:91` (section 7) says: "we don't log IP addresses or ask for your name, phone number or email address: we can't hand over what we never collect."
- Scenario: a user of a pseudonymous site who cannot or does not want to draw taps "Type your name to sign". The browser offers the legal name from its autofill profile; one tap stores it against the account (see finding 3), and the Terms they just agreed to say X2F never asks for it. This is the one place in sign-up that links an account to a real identity, and the design nudges it. A warrant answer or a database leak then yields it. The same concern is smaller for drawn signatures: a person's real signature is identifying, and "Sign here" invites it, although the help line's "A scribble or an X is fine" helps.
- The server cannot tell, and should not try: the fix is at the point of asking.
- Fix: remove `autoComplete="name"` (use `autoComplete="off"`). Reword the button and label so a name is not requested, and state in the help line that a real name is not needed and shouldn't be used (the owner's own "a scribble or an X is fine" applies to the typed form too; initials or the username would do). Wording goes through design and the owner, per the 6 Nov rule on unsigned lines.

### 3. The signature is stored in plain text
- `apps/api/migrations/316_terms_signature.sql:9`, `apps/api/src/accounts.ts:327`, `apps/api/src/routes/account.ts:301`.
- `terms_signature` is plain `jsonb`: a typed name is readable as text, a drawn signature as coordinates that redraw it exactly. The project already protects less sensitive material from a database or backup leak: PGP public keys are AES-256-GCM sealed under a subkey (`auth/pgp.ts:124` `sealKey`), and login names are stored only as keyed tags.
- Scenario: a database dump, a stolen backup or a compelled copy gives every signature and typed name, linked to display names, with no application key needed.
- Fix: seal it like `sealKey`: AES-256-GCM under a new subkey (for example `subkey(config, 'terms-signature')`), account id as AAD so a ciphertext can't be moved to another row, stored as `bytea`. Nothing reads it today, so nothing else changes; adjust the size check to the sealed length. A later staff route would open it in memory.

### 4. The signature is never deleted, and the Terms neither disclose it nor allow for it
- Claim in the code: "goes when the account row goes" (`316_terms_signature.sql:3`, `termsSignature.ts:5`). On main nothing deletes a trader's account row: the only deletes in `apps/api/src` are of `member` accounts (`team/members.ts:237,289`) and there is no account-deletion route.
- The 60-day close, on origin/wip/lead-vendor (`apps/api/src/accountInactivity.ts:67`), keeps the row: it sets `disabled_at`, `closed_at`, `closed_reason` and deletes PGP keys only. Once both branches land, a closed account's signature stays for good.
- `termsText.ts:83` (section 6) says "X2F keeps only what a trade needs, and deletes it after a set time." `termsText.ts` is unchanged by this branch, so the document being signed never mentions that a signature is taken or kept.
- Scenario: a person closes out or goes inactive; their signature, possibly their real name, stays indefinitely, contrary to the text they signed.
- Fix: (a) owner decides how long a signature lives after an account closes (question 1); (b) clear it in the close: add `terms_signature = null` to the update in `closeDueAccounts` when lead-vendor lands, or the agreed retention job, and in any future account deletion; (c) add the signature to section 6 and correct section 7, with a Terms version bump (lawyer and design wording). A bump also makes existing accounts sign (finding 8).

## Minor

### 5. A live session can overwrite the signature at any time, at the same version
- `apps/api/src/routes/account.ts:301`. The update has no check that the version actually changed, so repeating `POST /v1/account/terms` with the current version replaces the signature and moves `terms_accepted_at`. It is open to any trader session including recovery-level ones (`allowRecovery: true`); the UI only sends it after `terms-required`.
- Scenario: a stolen or recovery session silently replaces the record of what was signed and when; or the holder rewrites it later.
- Fix: add `and terms_version is distinct from $2` to the update, so a signature is only written when the version changes. Answer 204 either way, and add a test.

### 6. Deeply nested JSON makes the signature check throw: a 500 instead of a 400
- `apps/api/src/termsSignature.ts:90`. `JSON.stringify(value)` runs before any shape check. Verified by running it: `{"a":[[[…]]]}` nested 5,000 deep (10 KB) throws `RangeError: Maximum call stack size exceeded`.
- Scenario: reachable without logging in on all three register routes (the Terms version is public), and the raised body limit fits this easily. It gives a 500 and an error log line per request (`app.ts:211`). No data leaks and it costs little, but a malformed input should be a 400.
- Fix: test `o.kind` and the exact keys first, then measure only the fields actually used; or catch `RangeError` and throw `signature-invalid`. Add a test.

### 7. The invisible-character filter is a short list and blank names still pass
- `apps/api/src/termsSignature.ts:82,84`, `apps/web/src/screens/setup/signature.ts:66,68`. Verified by running the check: each of U+00AD, U+034F, U+115F, U+1160, U+17B4, U+180E, U+2065, U+2800, U+3164, U+FE0F, U+FFA0, U+FFF9, U+1BCA0, U+1D173, U+E0100 is accepted, alone as the whole name and inside one.
- Scenario: a typed "signature" that displays as nothing, the case the earlier fix meant to close. Impact is low since nothing renders it today.
- Fix: in both files, base the refusal on classes: refuse `\p{Default_Ignorable_Code_Point}` and `\p{Cf}` apart from ZWNJ and ZWJ, and treat U+2800 and those as non-visible in `NO_VISIBLE`.

### 8. Accounts already at the current Terms version are not asked to sign
- `apps/api/src/auth/sessions.ts:378` checks only `terms_version`; the migration comment accepts this ("they sign at their next Terms change"). `TERMS_TEXT_VERSION` is unchanged at 2026-10-17, so such an account has no signature and no prompt, against the owner's 8 Nov front-door rule.
- Only matters if real accounts exist before the next version change. Finding 4's bump closes it.

### 9. `createAccount` lets a trader be created without a signature
- `apps/api/src/accounts.ts:314,327`. `termsSignature` is optional and a missing value quietly stores null while `terms_version` is set. All three trader callers pass it today, so nothing is exposed; a future trader path would fail silently.
- Fix: make the argument required when `kind` is `'trader'` (a discriminated union), so the compiler catches it.

### 10. The signature binds to a version label, not to the text
- `apps/web/src/screens/setup/termsText.ts:16`. The version is a hand-kept string ("change both together") and no test pins the text to it, so an edit without a bump means past signatures point at words the person never saw. The text is also still the placeholder draft (`TERMS_DRAFT_NOTE`), so signatures taken now bind to a placeholder.
- Fix: add a test pinning a SHA-256 of the Terms text next to `TERMS_TEXT_VERSION`, so a text edit fails until the version moves. Final text before launch is already planned.

## Confirmed safe

- **Every trader sign-up needs a signature.** `assertTermsAccepted` is the first check in all three finishes (`auth/password.ts:201`, `auth/pgp.ts:701`, `auth/webauthn.ts:818`), before hashing, challenge use or writes. They are the only trader callers of `createAccount`, and `accounts.ts:322` is the only `insert into accounts` in `apps/api/src`. Old clients get 400 `signature-required`: it fails closed.
- **Staff and members** are created with `termsVersion: null` (`staff/invites.ts:180`, `team/members.ts:373`), deliberately, see question 2.
- **No reader.** No route, staff route, export or `select *` returns the column; only the insert and the update touch it, and a test asserts it is absent from `me`. Moderation has its own database. `x2f_purge` has no grant on `accounts`.
- **Logs.** `req.body` is redacted, request logging is off, and `logError` keeps only the error type and code, so a Postgres `detail` carrying row values is not logged.
- **Set for another account.** The insert binds to the new account; the update binds to `req.auth.accountId` and `kind = 'trader'`. Member sessions are refused (`owner-only`, no `member` option on the route). A signature is plain data with no cryptographic binding, so it could be copied to a person's own new account, which is inherent in the design and harmless.
- **Terms version binding.** The version is compared with the server's before the write and stored in the same statement as the signature. A version change mid-sign-up sends the person back and clears the pad (`padKey`, `update({ terms: null })` on all three paths).
- **Shape and size.** Strict linear grammar (`M`/`L`, integers, no leading zeros, at most 4 digits, inside the box), exact key sets, 64 KiB cap with a database backstop. No image decoding, so no decompression risk. SVG or script text is refused. It is rendered nowhere; a future staff view should draw it only as a `<path d>` from re-validated data.
- **Body limits.** Raised limits don't weaken earlier caps: password is capped at 1,024 characters before NFC and hashing (`checkPassword`), the device label is cut to 60 by `cleanLabel`.
- **Timing and enumeration.** The signature check depends on no account state and runs before name checks; the start routes and auth-client's logic are unchanged (types and one extra argument only).
- **Client storage.** The signature lives only in React state for the setup flow, not in `localStorage` or `sessionStorage`. No IP, user agent or fingerprint is stored with it.
- **Migration.** 316 is unique across origin/main and all origin/wip/* (clear of 120-122; nearest are 315 and 324 on lead-offer-units). Additive, no default, no grants, no rewrite.

## Questions for the owner

1. How long should a signature be kept once an account closes (60-day close or otherwise): deleted at close, or kept for a set time as proof of agreement? The Terms must then say so.
2. Should team members sign? They are created without Terms or a signature and act on the signed account of their team's owner. The 8 Nov front-door rule says nobody gets in without signing; staff are the same case.
3. The typed fallback: is it acceptable to drop "name" entirely (for example "Type your initials or anything you like to sign")?

## User-facing strings added (all unsigned; no board shows the pad)

- `Terms.tsx:220`: "Then sign in the white box with your finger, a pen or the mouse. A scribble or an X is fine. I accept needs both the tick and your signature."
- `SignaturePad.tsx`: "Sign here"; "Clear"; "Type your name to sign" (button and field label); "Draw instead"; aria-label "Signature box".

No new error text is shown: the `signature-*` codes are marked as input checks in `cantDoCodes.ts` and fall back to each screen's existing message.

## Re-verify e07cb506 (cloud lead reviewer, 9 Nov)

- Branch: wip/lead-terms-signature, head e07cb506 (7 commits on 909f87fb; front-door 6a5949a6 merged in at ece0ec1d). Read-only review.
- Owner answers applied: p11-13 (erase at close), p11-14 (everyone with a login signs), p11-15 and p11-9 (design wording), Terms version 2026-11-09.

### Verdict: APPROVED WITH MINOR (one merge-gate fix belongs to front-door)

The mechanics are correct. Members sign at join/finish and at a Terms re-accept, and the signature is sealed to their own login account. Staff sign at the invite account step. A bad member signature leaves the join code usable. Staff removal erases the signature, and member removal and expired sign-ups delete the row, so it goes with it. The merge keeps front-door's member-Terms behaviour. The version bump is consistent. Nothing below blocks this branch on security grounds. R1, R2 and R3 should be fixed or tracked before the 60-day close and Task 16 land. Prior finding 4(c) (the Terms text never mentions the signature) is still open and needs the owner, the lawyer and design (R4).

### Tests run (serialised runner, this worktree)
- `apps/api/test/team.test.ts`: 41 passed.
- `apps/api/test/staff/members.test.ts`: 22 passed.
- `apps/api/test/frontDoor.test.ts`: 19 passed.
- `tsc -p apps/api --noEmit` and `tsc -p apps/web --noEmit`: clean.
- `npm run copy-lint`: 1 problem, `Landing.tsx:25` (see "Copy-lint failure" below).
- Not run: `termsSignature.test.ts` (I read the tripwire instead), web vitest and Playwright. Those changes are mechanical stubs, also only read.

### Checked and sound
- **Erase on close, every path on this branch.**
  - Staff removal (`staff/members.ts:268`) calls `eraseTermsSignature` inside the removal transaction. Switch-off keeps the signature, which is right because switch-off can be undone. A test covers both cases and checks that only the removed person's signature goes.
  - Member removal (`team/members.ts:238` `deleteMemberLogin`) and `purgeTeamLeftovers` (`:290`) delete the `member` account row, so the signature goes with it.
  - No `accounts.closed_at` exists on this branch, and there is no trader deletion route or moderator disable write in `apps/api/src`.
  - The tripwire regex in `termsSignature.test.ts` matches the 60-day close statement on wip/lead-vendor (`update accounts a set disabled_at = $1, closed_at = $1, ...`, inside a template literal with no backtick in between). The tripwire is file-level and only matches the `closed_at =` form; see R3.
- **Members.**
  - `join/finish` runs `checkTermsSignature` before `checkTeamJoinCode`, so a missing or invalid signature returns 400 and the same code still works. The test proves this for both errors.
  - The version comes from the challenge payload. The signature is sealed by `createAccount` to the new member account id. The test opens it under that id and checks that opening it under the team owner's id throws.
  - On re-accept (`routes/account.ts`, member branch), the account id comes from `team_members` by `req.auth.memberId`, with `kind = 'member'` and `terms_version is distinct from $2`. Repeating the current version answers 204 and changes nothing, as for a trader. Tested.
  - `sessions.ts` still requires `member_terms_version` to be current, so the bump makes existing members sign.
- **Staff.** `assertTermsAccepted` runs at `/staff/v1/invites/accept/:token/account`, after the invite lookup and before names are checked or anything is written. The tests cover all four 400s and confirm nothing is made. `bodyLimit` is raised to `SIGNED_BODY_LIMIT`. The `NewAccountTerms` union now forces version and signature for every kind except `owner`, and the `@ts-expect-error` cases in `login-tags.test.ts` lock that in.
- **Merge resolution.** `POST /v1/account/terms` keeps front-door's `member: 'any'`, the member's own-account write and the trader write. It adds the signature, the body limit and the distinct-version guard to both. `assertTermsVersion` (version only) is used at `join/start`, where front-door had the two-argument `assertTermsAccepted`, and at `join/finish` alongside the new signature check. Behaviour is unchanged apart from the member signature and the member's write now only happening on a version change (deliberate, consistent with finding 5).
- **Version bump.** Web `TERMS_TEXT_VERSION`, the e2e `TERMS_VERSION`, the text-hash pin in `termsSignature.test.tsx` and `docs/dev-setup.md` all read 2026-11-09. The API test fixtures stay at 2026-10-17, and nothing ties them to the web constant:
  - no API, package or tools test imports `termsText`;
  - no e2e starts the real API;
  - the remaining `2026-10-17` strings in web tests (`frontDoor.test.tsx`, `client.test.ts`, `shell.spec.ts`) are routing or refusal stubs that never accept.
  - Deploys must set `X2F_TERMS_VERSION=2026-11-09` (docs say so).
- **Parity exceptions.** The three `SetupTerms` entries (`parity.ts`) apply to that board only, name the newer canvas version and why, and drop texts that are still on the 26 Oct board mirror (`boardTexts` throws if an exception goes stale). No security effect.

### Copy-lint failure on Landing.tsx:25 (front-door's)
- The line came in with front-door. It is identical at 6a5949a6 and still unfixed at origin/wip/lead-front-door eb2a86bb.
- Rule: neither an apostrophe nor an exclamation mark. It is the refusal rule in `tools/copy-lint.ts`: `REFUSAL_WORDS` matches `can’t`, so "X2F can’t move them alone." is judged a refusal that must go through `CantDoThat` or carry a pragma. It is a promise, not a refusal.
- Fix (on front-door, then re-merge): add `// not-a-refusal: a promise about the escrow, not a rule that stops the user` on the line above in `LANDING_COPY.promises`. Then raise the ratchet in `apps/web/test/cantDoThat-lint.test.ts` from `<= 52` to `<= 53` with a dated reason; the tree has 52 pragmas today, so without the raise that test fails. Rewording instead would be a copy change for design and the owner.

### Findings

**R1. Minor (lands with wip/lead-vendor): a closed team account leaves its members' logins and their signatures behind.**
- Once the 60-day close lands, `closeDueAccounts` closes `kind = 'trader'` rows only. A vendor's `team_members` rows stay live, so `purgeTeamLeftovers` never deletes their `member` login accounts, and their sealed signatures stay. Those members can no longer act (the team account is disabled), but their logins are not closed and nothing erases their signatures. p11-13 says erase at close. The tripwire passes, because the same file erases the trader's own signature.
- Fix, when lead-vendor merges: in the same transaction, mark the team's members removed (`removed_at`) and delete their member login rows, or call `eraseTermsSignature` for each. Also extend the tripwire or add a test that a closed team account leaves no member signature.

**R2. Minor: an abandoned staff invite leaves a disabled staff account holding a signature, for good.**
- `/account` now stores a signature on a disabled half-made staff account. If the invite is then cancelled (`DELETE /staff/v1/invites/:id`) or expires before `finish`, nothing deletes or erases that account. No sweep touches `staff_invites`. Before this branch the row held only names; now it also holds the person's signature.
- Fix: on cancel, and in a retention sweep for invites expired with `account_id` set and `used_at` null, erase the signature (or delete the half-made account if nothing references it).

**R3. Minor: the close tripwire is narrow.**
- It checks per file, not per statement: a file that erases anywhere passes all its closes.
- It recognises a close only by `update accounts ... closed_at =`. A permanent close written another way would be missed: a column-list `set (..., closed_at) = (...)`, a SQL function, or a ban that only sets `disabled_at`.
- Acceptable as a tripwire. Better: a DB test that runs each close job or route and asserts `terms_signature is null`. Do that when the 60-day close lands.

**R4. Minor (owner, lawyer, design; prior finding 4(c) still open): the Terms text never says a signature is taken, kept, or erased at close.**
- Section 7 (`termsText.ts:97`) still says X2F doesn't "ask for your name", while the new design copy says "sign your name" twice: the SetupTerms intro and the pad baseline "Sign your name here with your finger or mouse." The typed fallback still reads "Type your name to sign". `autoComplete` is now `off`, which is good.
- This is the owner's own p11-15 wording, so it is not reverted here. But it now asks for the very name the Terms say X2F never collects, and the version was bumped without disclosing the signature.
- Recommendation for the next Terms edit: say in section 6 that a signature is kept sealed and erased when the account closes. Say in section 7 (or in the pad's help line) that the signature need not be a real name.

**R5. Minor (lead or owner question): staff sign at the invite only, never again at a Terms change.**
- `sessions.ts` enforces `terms-required` only when `kind = 'trader'`, which covers traders and members. Staff with an older version, and staff created before this branch with a null version, are never asked again. p11-14 says "everyone who gets a login signs".
- If staff should re-sign at a version change, the staff API needs a re-accept route and a check. Owner question.
- The staff web invite page does not send the Terms yet. It is guarded by the `NEEDS_P4_TASK16` tripwire. Until Task 16 adds the Terms step, a staff invite cannot be completed (400 `terms-not-accepted`): it fails closed.

**R6. Info.**
- `join/finish` and the staff `/account` step spend a `register` budget token before the signature check. A bad signature costs a token but not the code. That matches the trader register routes.
- The owner's own account has no signature by design (`NewAccountTerms` `owner`). p11-14 reads "everyone", so the lead may want the owner to confirm this.
