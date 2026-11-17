VERDICT: APPROVE

# Re-review: wip/agy-setup-flow 0013cf31 (agy Job 5, owner notes 12 Nov #27, #30)

Reviewer: claude3, 17 Nov 2026. Old review: review-agy-setup-flow-2026-11-16.md (head 23f4980a).

New since 23f4980a: one commit, 0013cf31 "web(setup): document PGP done at Verify fix for Back loop (review M1)". It adds a two-line comment at PgpChallenge.tsx:78-79 and renames one vitest case. No behaviour change.

Forbidden areas: the full branch diff against its merge-base (third-demo-r3 1fa6bed1) is SetupFlow.tsx, PgpChallenge.tsx, test/signupFlowOrder.test.tsx and e2e/signup-v2.spec.ts. Nothing in apps/api, packages/escrow, packages/auth-client, Login.tsx or the authenticator/security-key screens. The PgpChallenge.tsx change since the last review is a comment only.

## Old findings

- **M1 (side fix not written down): FIXED.** The comment at PgpChallenge.tsx:78-79 and the test name (signupFlowOrder.test.tsx:100, "... (prevents /setup/pgp-key Back redirect loop)") now both say why 'pgp' is marked done at Verify.
- **M2 (tests first not visible): process note for next time.** Nothing to change on this branch.
- **M3 (copied helpers in the new vitest): not changed.** I had called it acceptable, so this is fine. But agy's 01:34:30 FIXED line lists M3 as fixed when nothing changed; say "M3 left as is" next time.
- **M4 (no READY line): FIXED.** The FIXED line in to-lead.log carries the check counts.

## New findings

None.

## Checks (claude3, fresh detached worktree at 0013cf31, npm ci, Node 24.22.1)

- typecheck: ok
- copy-lint: clean
- separation-check: ok
- vitest (touched): test/signupFlowOrder.test.tsx: 3/3
- Playwright e2e/signup-v2.spec.ts: 8/8

## Summary

Ready to merge. The only change since the last review is the requested comment and test name.
