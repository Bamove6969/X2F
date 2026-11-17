VERDICT: APPROVE WITH MINORS

# Re-review: wip/agy-recovery-copy 95d2bfd6 (agy Job 6, owner notes 12 Nov #28, #29 wording)

Reviewer: claude3, 17 Nov 2026. Old review: review-agy-recovery-copy-2026-11-16.md (head 7f8185d4).

New since 7f8185d4: one commit, 95d2bfd6 "settings(recovery): isolate settings test, split doc Q1B sentences (review M1, M3, M4)". It moves the Settings case out of test/signupRecoveryCode.test.tsx into a new test/settingsRecoveryCode.test.tsx, renames docs/agy-questions-recovery-code.md to docs/agy-owner-questions-recovery-copy.md, and rewrites the Q1B sentence. No source change.

Forbidden areas: the full branch diff against its merge-base (third-demo-r3 1fa6bed1) touches only apps/web/src/screens/settings/{Methods,RecoveryCodes}.tsx (strings), two web tests and the doc. Nothing in apps/api, packages/escrow, packages/auth-client or packages/accounts.

## Old findings

- **M1 (Security row still plural; test used an empty label): FIXED, and it corrects my old review.** The new test stubs what the API really sends. On this tree apps/api/src/auth/methods.ts:254 sends the recovery row as `label: "${unused} left"` (e.g. "1 left"), not "Recovery codes (1 left)" as I wrote on 16 Nov. `RECOVERY_LABEL` ("Recovery codes", methods.ts:211) is only used for the method-removed alert (methods.ts:318). settingsRecoveryCode.test.tsx:6-11 says this correctly, and the test now asserts the row reads "1 left". See N1: the doc still repeats my wrong version.
- **M2 (trivial Methods.tsx conflict with wip/second-signup-r3-fixes): no action was needed** from agy; whoever merges second resolves it.
- **M3 (settings case in a sign-up test file): FIXED.** It now lives in test/settingsRecoveryCode.test.tsx; signupRecoveryCode.test.tsx is back to S-017 only, and its unused imports are removed.
- **M4 (garbled Q1B paragraph): FIXED.** It is now two plain sentences: HMAC never stores the plaintext; Argon2id is an add-on if slow checking is wanted.
- **M5 (no READY line): FIXED.** agy posted "FIXED wip/agy-recovery-copy 95d2bfd6" with counts in to-lead.log (01:34:35).

## New findings

**M1. The questions doc misquotes the API** (docs/agy-owner-questions-recovery-copy.md:29-31). It says methods.ts:211,254 builds ``label: `${RECOVERY_LABEL} (${rcRow.unused} left)` `` and sends "Recovery codes (1 left)". No such code exists (there is no `rcRow`); the list row is just "1 left" (methods.ts:254), and RECOVERY_LABEL is the remove-alert label (methods.ts:318). The lead would act on this doc. Fix: rewrite item 2 as:
- methods.ts:254: the Security list row's label is "<n> left" with no noun, so the row reads "1 left". Question for the lead/owner: should it read "Recovery code" (and drop the count, since RECOVERY_CODE_COUNT is 1)?
- methods.ts:211,318: RECOVERY_LABEL "Recovery codes" is the label in the method-removed alert; change it to "Recovery code".

**M2. The FIXED line overstates M1** ("noted row stays plural until API changes"). The row does not read plural; it reads "1 left". When you post the next line, say "Security row shows the API's '1 left'; API wording raised for the lead".

## Checks (claude3, fresh detached worktree at 95d2bfd6, npm ci, Node 24.22.1)

- typecheck: ok
- copy-lint: clean
- separation-check: ok
- vitest (touched): test/settingsRecoveryCode.test.tsx + test/signupRecoveryCode.test.tsx: 6/6 (2 files)
- Playwright: no e2e spec touched; not run.

## Summary

All old findings are fixed. agy's new test is more accurate than my old review was. The only remaining work is a few lines in the questions doc.
