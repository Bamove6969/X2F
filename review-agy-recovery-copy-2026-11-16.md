VERDICT: APPROVE WITH MINORS

# Review: wip/agy-recovery-copy 7f8185d4 (agy Job 6, owner notes 12 Nov #28, #29 wording)

Reviewer: claude3, 16 Nov 2026.

Scope: 2 commits on origin/wip/third-demo-r3 1fa6bed1, 4 files, +140/-8:
- Settings > Security (Methods.tsx, RecoveryCodes.tsx): five strings changed to the singular, each marked COPY-UNSIGNED.
- One vitest added.
- docs/agy-questions-recovery-code.md added.

The code's length and how it is made are untouched. agy stayed out of packages/accounts and apps/api and listed the two plural strings there for the lead:
- confirmAction.ts:100 "make new recovery codes"
- methods.ts:211 "Recovery codes"

It rightly left the owner's verbatim Terms sentence (termsText.ts:76) alone. Every other web string already said "recovery code".

I spot-checked six claims in the questions doc against the code:
- 64 symbols (loginCode.ts:23)
- RECOVERY_CODE_COUNT = 1 (recovery.ts:59)
- no auto-dash on /login/backup (BackupLogin.tsx:90) or on Methods.tsx:244
- a reload makes a new code (Backup.tsx:19-21)
- the two plural strings in the API

All six are correct. The doc correctly reports that both owner asks (a 4x longer code, and typing it back after writing it down) are already built, and keeps the real open choices for the owner and the lead.

## Findings

**M1. The real Security screen still reads plural.** Methods.tsx:135 renders `m.label || LABELS[m.type]`, and the API sends "Recovery codes (1 left)" (apps/api/src/auth/methods.ts:211,318). So the new `LABELS` entry is never shown in practice. The new vitest passes `label: ''`, which tests a path the app does not take. agy did flag the API string for the lead, which is the right call. Add a note in the test, and in the READY line, that the row stays plural until methods.ts changes.

**M2. A small text conflict with wip/second-signup-r3-fixes** in Methods.tsx (the buttons block next to "Add an authenticator app"). It is trivial; whichever branch merges second resolves it.

**M3. Settings tests sit in a sign-up test file** (test/signupRecoveryCode.test.tsx, the last case). That file's describe block is "S-017: the recovery code is required at sign-up", but the new case tests Settings. Move it to a settings test file.

**M4. One paragraph in the doc is garbled** (docs/agy-questions-recovery-code.md Q1B, the "strictly stronger" sentence). It mixes the HMAC case with the Argon2id option. Split it into two plain sentences.

**M5. No READY line.** agy posted only a CLAIM in to-lead.log; post the READY line when back.

## Checks (claude3, detached worktree at 7f8185d4)

- typecheck: ok
- copy-lint: clean
- separation-check: ok
- vitest apps/web: 2217 passed, 1 failed. The failure is serve-boards.test.ts capture-refs (stale BuyMain/Main reference shots). It fails the same way on every branch cut from third-demo-r3, so it is not agy's.
- Playwright e2e/security.spec.ts + e2e/recovery.spec.ts: 27/27

## How agy compares

This is at our standard. The wording change is small and correct, the scope discipline is good, and the questions doc is accurate and useful to the lead. The one miss is a test that does not use what the API really sends.
