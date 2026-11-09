# Security review: the staff invite signs the Terms (Plan 4 Task 16, owner p11-14)

- Branch: wip/lead-staff-invite-terms, worktree /home/user/X2F/.claude/worktrees/staff-invite-terms
- SHA reviewed: 0b0b7cdb on 26639876 (batch 4 integration head), one commit
- Date: 2026-11-09
- Reviewer: independent security reviewer, read-only on code. Context: review-terms-signature-2026-11-08.md (R2, R5, R6), review-p4-t11-t16-2026-11-08.md, rules R1-R44.

## Verdict: APPROVED (no blocking findings; 3 minor, 3 info, 4 owner questions carried forward)

The new public route gives away nothing but the Terms version and costs what the trader's `GET /v1/terms` costs. The staff account step runs the trader's validator, limits, sealing and erase unchanged, and no invite step can be reached without it. The staff web step reuses the trader's text, version constant and pad through the kit, refuses a version the bundle does not carry, and re-shows the step when the server says the Terms changed. Every new sentence is marked. Nothing here needs an owner decision to land; the owner questions below are the earlier review's, now sharper because this branch makes the flow usable for real staff.

## Tests run (serialised runner, this worktree)

- `npx vitest run --project @x2f/staff-web apps/staff-web/test/inviteTerms.test.tsx apps/staff-web/test/screens.test.tsx`: 2 files, 28 passed (log scratchpad/logs/sec-staffweb-terms-232050.log).
- `npx vitest run --project @x2f/api apps/api/test/staff/members.test.ts apps/api/test/staff/matrix.test.ts`: 2 files, 120 passed (log scratchpad/logs/sec-api-staff-terms-*.log). The matrix walked `GET` and `HEAD /staff/v1/terms` as all 11 callers.
- `npx tsc -p apps/staff-web --noEmit`: clean. `npx tsc -p apps/api --noEmit`: clean.
- `npm run separation-check`: ok. `npm run copy-lint`: "apps/web/src, apps/staff-web/src clean".
- Not run: Playwright, apps/web vitest (apps/web and packages are untouched by the commit: `git diff 26639876 HEAD --stat -- apps/web packages` is empty).

## Checked and sound

### (1) The public route
- `apps/api/src/staff/invites.ts:194`: `app.get('/staff/v1/terms', pub, async (req) => ({ version: req.server.deps.config.termsVersion }))`. One config read, no database, no body, no token. It answers exactly what the trader's `apps/api/src/routes/account.ts:302` answers, from the same `X2F_TERMS_VERSION` (`config.ts:225`, capped at 32 characters).
- Rate limiting: identical to the trader route, which is to say none beyond the process (neither takes a `budgets` token; the API has no per-IP limiter, `grep rate` finds only `staff/keyTap.ts`). Acceptable: it is cheaper than the invite's `GET …/accept/:token`, which does a DB lookup before its `start.take()` (`invites.ts:171`).
- Headers: the staff app's hooks give it `cache-control: no-store`, the security headers and `STAFF_CSP` (`staff/app.ts:117-123`). The origin hook skips safe methods, as for every GET.
- Privilege matrix: `test/staff/routes.ts:69` lists it as `perm: 'public-invite', allowed: 'public'`. `guard.ts:135-136` fails startup if a public route runs `requireStaff`; `matrix.test.ts:71-76` fails if the table and the registered routes differ; `:88-95` calls it as all 11 callers (anonymous, trader, member, every staff state) with GET and HEAD and refuses any guard code or 5xx. Passed.

### (2) Server-side validation, storage, erasure, and no skip
- Same validator: `invites.ts:205` `assertTermsAccepted(deps, b.acceptedTerms, b.termsSignature)` is the trader finishes' function (`auth/password.ts:201`, `pgp.ts`, `webauthn.ts`): `assertTermsVersion` then `checkTermsSignature` (`accounts.ts:309-318`, `termsSignature.ts:101-128`). Same limits: `SIGNATURE_MAX_BYTES` 64 KiB, `MAX_BOX`, `MAX_TYPED_NAME`, the route's `bodyLimit: SIGNED_BODY_LIMIT` (`invites.ts:197`). Same storage: `createAccount` seals with AES-256-GCM under `subkey('terms-signature')` with the account id as AAD (`accounts.ts:362-368`, `termsSignature.ts:138-146`), the one `insert into accounts`. Erased on staff removal: `staff/members.ts:290` `eraseTermsSignature(c, id)` inside the remove transaction (unchanged by this branch).
- Order: invite lookup (404 `invite-invalid`), `wrong-state` if an account exists, `register.take()`, Terms, then names (`invites.ts:201-206`). A bad signature spends a register token but writes nothing; `members.test.ts:213-222` proves all four 400s (`terms-not-accepted` x2, `signature-required`, `signature-invalid`) and that the same invite then takes the names, with `openTermsSignature` reading back the sealed value under the new account id (`:226-231`).
- Cannot be skipped by calling a later step directly: `key/start`, `key/finish`, `pgp/start`, `pgp/finish` and `finish` all begin with `accountOfInvite(i)` (`invites.ts:222,232,252,263,281`), which throws 409 `wrong-state` while `account_id` is null (`:92-95`), and `account_id` is set only inside the `/account` transaction after `assertTermsAccepted` (`:211-213`). The disabled flag (`:212`) keeps a half-made account out of login until `finish`.
- Cannot be skipped by resuming: `GET …/accept/:token` returns `resume: null` until `account_id` is set (`:173-185`), and the page shows the Terms step for `resume === null` (`Invite.tsx:84-86`) and goes to the keys only for a non-null resume (`:88-91`), by which point the signature is on the row. A second `/account` call answers 409 (`members.test.ts:234-236`); the page treats `wrong-state` there as "already made, carry on" (`Invite.tsx:148-151`), which is correct because a row exists only if it was signed.
- The `NEEDS_P4_TASK16` tripwire (`members.test.ts:530-538`) is now green by content, not by weakening: it reads `Invite.tsx` for both field names.

### (3) The staff-web step and the one-door rule
- No copied Terms text: `TermsStep.tsx:23` imports `KEY_POINTS, PRIVACY_HEADING, TERMS, TERMS_DRAFT_NOTE, TERMS_TEXT_VERSION` and `SignaturePad` from `./kit.js`; `kit.ts:24-25` re-exports them from `apps/web/src/screens/setup/termsText.js` and `SignaturePad.js`. `inviteTerms.test.tsx:52-62` asserts the rendered key points, draft note, every heading and the paragraph count equal the trader constants.
- Version check against the bundle: `TermsStep.tsx:80` `stale = version !== null && version !== TERMS_TEXT_VERSION`; `:81` `ready` requires `!stale` and a loaded version; `:159` the tick is disabled when stale; `:187` `onAccept` is guarded again. The version sent is the server's, which `ready` has forced equal to the bundle's. A failed load keeps Continue disabled (fails closed; test "a failed version load says so").
- Stale handling is the trader's sentence and action (`TermsStep.tsx:127-134` vs `Terms.tsx:189-196`: "The Terms have been updated. Reload the page to read the new version."). Tested for a direct stale load and for a change to a version the page does not carry after a refusal (two tests).
- Terms-changed-meanwhile (review M3): `Invite.tsx:140-146` on 400 `terms-not-accepted` clears the held signature, sets `termsChanged`, returns to `step 'terms'`; the step remounts with fresh state, re-reads `GET /staff/v1/terms`, and shows "The Terms changed while you were reading…" only when the reloaded version is the bundle's (`TermsStep.tsx:122-126`), the stale notice otherwise. The test checks the second GET, the unticked box, `data-empty="true"` on the pad, the kept names and the second account body. The trader's `Could not save that` branch is not needed here because the names call owns its own fault text.
- The signature lives only in React state (`Invite.tsx:71`); `grep localStorage|sessionStorage apps/staff-web/src` finds nothing.
- Separation: `npm run separation-check` ok. Note that tool checks moderation/API/web secrets, not staff-web imports; the one-door rule is a convention (see finding 1).

### (4) COPY-UNSIGNED
- Every sentence that is not the trader's word for word carries the marker: the file header (`TermsStep.tsx:18`), `TERMS_CONTINUE` (`:30`), the intro (`:102`), the help line (`:178`), the step headings in `Invite.tsx:14,203`. The reused sentences ("The Terms changed while you were reading…", the stale notice, "Scroll to the end to continue", "I have read and agree to the…", "Could not load the Terms version." / "Try again", "End of Terms. Version …") are identical to `Terms.tsx`. `npm run copy-lint` is clean over both apps. No new refusal text: `terms-not-accepted` goes back to the step, never to `CantDoThat` or a fault (tested).

### (5) No direct apps/web import in the staff bundle
- `grep -rn "web/src" apps/staff-web/src` outside `ui/kit.ts`: `TermsStep.tsx:24` (`setup.css`) and `main.tsx:6-9` (fonts, tokens, base.css, screens.css). All stylesheets; no component or module. See finding 1.

## Findings

### Minor

**1. A stylesheet import from apps/web outside the kit, and no tripwire for the one-door rule.**
- `apps/staff-web/src/ui/TermsStep.tsx:24` imports `../../../web/src/screens/setup/setup.css` directly. `kit.ts:1-6` says components come through the kit "never from apps/web directly" so the kit can move to a package by changing one file; `main.tsx` already imports four apps/web stylesheets directly, so this follows precedent for CSS and breaks nothing. But if the kit moves, this import and main.tsx's four are the ones a search would miss. No test enforces the rule for `.ts/.tsx` imports either (`apps/staff-web/test` has no tripwire; `tools/separation-check.ts` does not cover staff-web).
- Fix (engineering, optional now): move the `setup.css` import next to the others in `main.tsx`, and add a small tripwire test that fails on any `web/src` specifier in `apps/staff-web/src` outside `ui/kit.ts` and `main.tsx`.

**2. No API test asserts what `GET /staff/v1/terms` returns.**
- The matrix proves it is public and never crashes (`< 500`, no guard code) and the staff-web tests mock it. Nothing in `apps/api/test` checks the body is `{ version: config.termsVersion }` and nothing else (grep finds the route only in `routes.ts:69`). The handler is one line, so the risk is drift: a later "helpful" addition (text, headings) would pass the matrix.
- Fix: one assertion in `members.test.ts` next to the Terms test: `expect((await invitee().get('/staff/v1/terms')).json()).toEqual({ version: t.deps.config.termsVersion })`.

**3. (Carried from review 2026-11-08 R2, now live.) An abandoned invite keeps a signature on a disabled account.**
- `/account` seals the signature onto a disabled staff account (`invites.ts:211-212`). `DELETE /staff/v1/invites/:id` only sets `cancelled_at` (`:158`); nothing sweeps `staff_invites` or deletes half-made accounts (`grep staff_invites apps/api/src` finds no delete; `auth/challenges.ts:85-93` sweeps other tables only). Before this branch no staff invite could complete, so no such row could be made from the web; now every cancelled or expired invite that got past the names leaves a signature for good, against p11-13 "erase it when the account closes".
- Fix (engineering, once the owner confirms the retention in Q1): on cancel, and in a sweep for invites expired with `account_id` set and `used_at` null, call `eraseTermsSignature` (or delete the half-made account; nothing references it before `finish`), and add a test.

### Info

**4. Staff sign once, never again (review R5).** `auth/sessions.ts:426` enforces `terms-required` for trader and member sessions only; a staff member keeps working after a version bump with the old version on the row, and finish does not re-check the version against the one stored at `/account` (`invites.ts:280-300`), so an invite that spans a bump finishes under the older text. Unchanged by this branch; owner Q2.

**5. The Terms text still never mentions the signature, and the step asks to "sign your name" (review R4).** `TermsStep.tsx:103` and the trader's `Terms.tsx:247` intro both say "sign your name"; `termsText.ts` section 7 says X2F never asks for a name. The pad's `autoComplete="off"` (`SignaturePad.tsx:168`) stands. The staff wording follows the owner's p11-15 sentence, so nothing to change here without the owner; Q3.

**6. Deployment.** The staff API process reads the same `X2F_TERMS_VERSION` as the trader API; if it is ever deployed with a different value from the web bundle's `TERMS_TEXT_VERSION` (2026-11-09), every invite page shows the stale notice and no staff invite completes (fails closed). `docs/dev-setup.md` already says deploys must set it; worth a line in the staff runbook.

## Owner questions (carried, with a recommendation)

1. How long may a signature stay on a half-made staff account whose invite was cancelled or expired? Recommendation: erase it at cancel and at expiry (finding 3), matching p11-13.
2. Should staff re-sign when the Terms version changes, as traders and members do (finding 4)? Recommendation: yes, via a staff re-accept route and a `terms-required` check in the staff session guard; otherwise p11-14's "everyone who gets a login signs" means "signs once".
3. The Terms section 7 vs "sign your name" (finding 5): does the next Terms edit say that a signature (not necessarily a real name) is taken, sealed and erased at close?
4. (Review R6) The owner's own account has no signature by design; does "everyone" include the owner?

## User-facing strings added (all marked COPY-UNSIGNED; no board)

- `TermsStep.tsx:103`: "Staff sign the Terms too. Read them to the end. If you agree to X2F's rules and terms, tick the box, sign your name and continue."
- `TermsStep.tsx:30`: "Continue" (the step's button; also substituted into the trader's help line at `:179`).
- `Invite.tsx:204`: "1. Terms of Service"; `:214`: "2. Your names"; `:236`: "3. Your login keys" (renumbered).
