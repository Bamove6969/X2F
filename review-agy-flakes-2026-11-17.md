# Review: wip/agy-flakes @b51ec5b1 (agy Job 9) — 17 Nov 2026, claude3

Branch: `origin/wip/agy-flakes` b51ec5b1 (1 commit on wip/third-demo-r3 b1172d63, one commit behind its head 94337781,
which touches webauthn.test.ts/post.spec.ts only; `git merge-tree` with the head is clean).
Order: AGY-ORDERS-2.md Job 9 ("fix each at its cause (never skip a test, never loosen a security assertion). Report the
before/after counts."). Rulings checked: AGY-WORKSPACE.md §1/§5, the 17:38 RULE.

## VERDICT: APPROVE WITH MINORS

Test code only (5 e2e specs + tour.test.tsx); no product code, no money/escrow/keys/auth/fees/liens/disputes/payout code,
no new user-facing words. No `skip`, `fixme`, `retries`, `waitForTimeout` or sleeps added; no assertion was weakened:
- **Team nav strict mode — real cause fixed.** Non-exact `getByRole('link', { name: 'Trade' })` is a case-insensitive
  substring match, so it also hits "My trades" (BottomNav.tsx:13/15, DesktopShell.tsx:21/24) once /v1/account/me has
  loaded a member with the trades role; strict mode then fails depending on whether the nav had re-rendered yet.
  `exact: true` (team.spec.ts:440, trades.spec.ts:133, design-shots.spec.ts:384) is the right fix and tightens the
  locator. The extra `exact: true` on "Post offer"/"Open dispute" is harmless.
- **Tour/folded timing.** One-shot `boundingBox()!` reads taken right after `toBeVisible()` are turned into
  `expect.poll` on the same condition (tour.spec.ts:101-102, :238-243; accepted-phone.spec.ts:87-96; the existing polls at :56-66 and :255-262 are made null-safe), plus a
  `toBeVisible()` wait before reading the step count (tour.spec.ts:70). The end-state checks (56/52 px buttons, Skip above
  the nav, sheet fully on screen, card beside the ring) are unchanged; they now wait for layout to settle (webfont swap,
  sheet slide-in) instead of reading the first frame. That is waiting for the asserted condition, not loosening it.
- **tour.test.tsx:344** gives the 17-stop walk its own 30 s budget; it measures 3.8 s here (settle() = 6 x 30 ms real
  timers, 19 times), so the 5 s default was too tight under load. No sleep added.

## Minors

**M1. The Job 9 report is missing.** The order says: run the full Playwright suite 3 times, list every test that failed at
least once, report before/after counts. The READY line (to-lead.log 02:26:15) says only "e2e clean 3x consecutive",
with no list of the failing tests, no base counts and no full-suite counts. Fix: add a short `docs/agy-flakes.md` (or the
READY line) with: each test that failed on the base (spec:line, how often in 3 runs, cause), and full-suite counts before
and after (passed/failed per run).

**M2. The polls hide why a check failed.** accepted-phone.spec.ts:87-96 and tour.spec.ts:238-243 return a bare
boolean, so a real regression now reports "expected true, received false" instead of the box numbers. Fix: use
`await expect(async () => { const box = ...; expect(box!.x).toBeGreaterThanOrEqual(-0.5); ... }).toPass()` (keeps the
original per-edge messages), and add a one-line comment at each naming the cause (font swap / sheet slide-in), so the
next reader knows why it waits.

**M3. tour.test.tsx:344 budget is 8x the measured time.** 30 s is fine as a ceiling but will hide a real slowdown; 15_000
is enough for a 3.8 s test under full-suite load. Optional.

## Checks (fresh detached worktree /home/user/rv2-agy-flakes @b51ec5b1, npm ci, Node 24)
- typecheck (`npm run typecheck`, all workspaces): ok, 0 errors
- copy-lint: clean (apps/web/src, apps/staff-web/src)
- separation-check: ok
- web vitest test/tour.test.tsx, 3 runs: 20/20, 20/20, 20/20 (first-trade walk 3.78 s)
- Playwright `--repeat-each=3` accepted-phone, design-shots, team, tour, trades: 342 run, 186 passed, 0 failed,
  156 skipped (design-shots is env-gated, `X2F_DESIGN_SHOTS=1`; pre-existing gate, not added by this branch).
  Per spec: accepted-phone 18/18, team 84/84, tour 39/39, trades 45/45.
- design-shots "26 a Trades-only member" with X2F_DESIGN_SHOTS=1, `--repeat-each=3`: 3/3 passed
- Merge check with origin/wip/third-demo-r3 head 94337781: clean
