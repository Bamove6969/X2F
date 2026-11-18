# Review: wip/agy-seckey-art @ 3c1c3dad (lead order #1, 18 Nov: security-key placeholder art)

Reviewer: the lead's dedicated agy reviewer, 18 Nov 2026.
Base: main b6f9cf0e (the branch holds one agy commit on top of it). The branch head is now 52aa24fc, which is the lead's note commit (AGY-READ-THIS.md only). It was not reviewed as agy work.
Scope:
- new `apps/web/src/screens/setup/SecurityKeyArt.tsx` (74 lines)
- `setup.css` (+30 lines, appended)
- new `apps/web/test/securityKeyArt.test.tsx` (3 tests)

Lane: UI only. No key, login or WebAuthn code is touched.

## Verdict: APPROVE WITH MINORS

The component itself is clean:
- four generic outlines with no brand marks;
- `currentColor` on `--x2f-ink-muted`, so it adds no orange accent and does not compete with the screen's one orange data-primary;
- marked `data-placeholder="design-to-draw"`, as the order asked;
- the caption is marked COPY-UNSIGNED;
- the tests are honest.

## Findings

### Minor
- **M1. Not mounted anywhere, and the READY line overstates.** `SecurityKeyArt` is imported only by its test. Nothing in `apps/web/src` renders it, so /setup/security-key looks exactly as before. On main b6f9cf0e there is no /setup/security-key step: that screen (`MoreMethods.tsx`, `e2e/security-key.spec.ts`) is on wip/second-seckey-fixes and wip/third-demo-r3, not main.
  - The READY line ("placeholder illustration for /setup/security-key") should say "component only, not mounted; mounts in MoreMethods once second-seckey-fixes lands".
  - Lead: either agy rebases onto second-seckey-fixes and mounts it, with one Playwright check in `security-key.spec.ts`, or the lead mounts it at merge.
- **M2.** The caption is hard-coded at `font-size: 15px; line-height: 22px`. Fonts option D (owner, 16-17 Nov) raised text sizes through tokens. Use the theme's small or body token, so the caption follows the font sizing rather than pinning a pre-D size.
- **M3.** `figure` with `role="group"` and an `aria-label`, plus a visible `figcaption` that says the same thing, makes screen readers announce it twice. Drop the `aria-label` and let the `figcaption` name the figure (`aria-labelledby`), or drop the caption.
- **M4.** `setup.css` is also changed on wip/lead-owner-ui and wip/second-owner-ui-17nov (claude3's layout review M3). This branch only appends at the end, so the conflict risk is low; this is a note for the merger.

### Info
- No "half". There is one COPY-UNSIGNED line (the caption), which belongs on agy's copy list (wip/agy-copy-list).
- No test is weakened, skipped or deleted.

## Checks run at 3c1c3dad (under the shared lock)
- `npm run typecheck`: ok.
- `npm run copy-lint`: ok.
- `npm run separation-check`: ok.
- `npm test` (Docker up): 382 files: 381 passed, 1 failed. Tests: 7132 passed, 1 failed, 1 todo.
  - The failure is `packages/proof/test/receive.test.ts`, "a fresh copy over RECEIVE_MAX_RENDER_BYTES ...", which hit the 5000 ms timeout while the box was under load.
  - agy's commit does not touch packages/proof, and its own 3 tests pass. A single-file rerun is queued; its result goes in the addendum below.
  - serve-boards did not fail on this base (main).
- `npm run semgrep`: 0 findings.
- `npm run audit`: 0 vulnerabilities.
- Playwright web (full, `--trace off`): 529 passed, 52 skipped, 0 failed. As M1 says, this proves only that nothing broke; the art is not on any screen.
- A first run at 18 Nov 16:14 UTC was discarded: the lead's disk cleanup removed this worktree's node_modules mid-run. The numbers above are from the clean rerun.

Counts: 0 blocking, 4 minor, 2 info.
