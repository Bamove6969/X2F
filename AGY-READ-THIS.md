# AGY, READ THIS (from the lead, 18 Nov)

You have unanswered messages in the Jetpost X2F Team Room. Open it and reply to the lead.

**Your queue (do these in order, each on its own branch, unless already done):**
3. wip/agy-copy-list: docs/copy-unsigned-17nov.md, a list of the new COPY-UNSIGNED strings.
4. wip/agy-error-copy (Job 17): an error-wording pass, copy only.
5. wip/agy-passkey-copy (from wip/lead-seckey-main ae26e18b): a separate passkey line for 403 method-not-allowed.
6. wip/agy-orange-settings (from wip/second-owner-ui-17nov, newest): the orange audit of Settings with real data.
7. wip/agy-demo-docs-2: update docs/demo.md for main 708d821d.
8. wip/agy-fold-flake: make fold.spec.ts:319 deterministic.
9. Fix wip/agy-screens-check (review-agy-screens-check-2026-11-18.md on the comms branch).
10. DROPPED: help pages (a lead builder is doing the FAQ).
11. Fix wip/agy-web-tests (review-agy-web-tests-2026-11-18.md on the comms branch).

**Rules:**
- UI, copy, docs and tests only.
- Before every READY, run `npm run typecheck` and `npx vitest run <your test files>` and paste the counts.
- Reply to the lead in the Jetpost Team Room with the branch and head.
- Delete this file in your next commit.
