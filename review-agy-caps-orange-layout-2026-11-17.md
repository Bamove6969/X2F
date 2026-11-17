# Review: wip/agy-layout 950834b2 (fix round) — 17 Nov 2026, independent reviewer for the lead

Scope change from the lead (mid-review): agy's `wip/agy-owner-ui-caps` 92e11455 and `wip/agy-orange-audit` 735d4784 are
**dropped** (claude2's `wip/second-owner-ui-17nov` accffc9b does the CAPS switch and the orange audit, owner-reviewed). This file
keeps its planned name but reviews only `wip/agy-layout` **950834b2** (3 agy commits on `wip/third-demo-r3` 1fa6bed1; the fix round
for review-agy-layout-2026-11-17 B1-B3, M1-M6).

## VERDICT: APPROVE WITH MINORS — 0 blocking, 1 minor (merge note), 2 nits

**Scope**: within agy's lane. Only apps/web CSS, ScreenHeader names, DesktopShell `PRE_LOGIN`, tests, e2e and one docs file.
No money, keys, login security or disputes code. `PRE_LOGIN` only picks the wide frame (rail vs centred) via `wideFrameOf`
(App.tsx:97/100); it gates nothing, and a signed-out visitor still gets the centred frame through App.tsx's `outside`.

**Tests**: nothing weakened, skipped or deleted versus the base. goodToken gains the checklist-tick and no-local-hex asserts;
ownerLayout gains the screen-name, wide-frame, welcome-card and /buy spacing cases; two Playwright cases were added.

## Every earlier finding is fixed

- **B1 fonts**: the #43 `[data-screen='session-length']` block and the help-link `font-size: 15px; font-weight: 600` are gone. The
  #43 test is gone and the describe is renamed "/buy spacing (owner #48)". The doc has its §4 line. Against 1fa6bed1 the branch now
  changes **no** font-size, font-weight, font-family or @fontsource dependency. The atkinson/familjen packages in its lockfile come
  from the base, not from agy.
- **B2 help links follow the lead's 12 Nov call**: HelpLinks.tsx and SessionLength.tsx are unchanged from the base, so both
  /login and /session-length use the front-door placeholders (HelpLinks.tsx:4-8, HelpTopic.tsx:3-7). The test still asserts the four
  `/help/<topic>` links. Doc §3 now gives option 1 as the lead's call (the current state) and option 2 as signed-in links, noting the
  team-member Settings problem. It says "not built; waiting for the owner or the lead". The call is followed, not reversed.
- **B3**: `/settings/idle-reminder` is named "Idle reminder" (ScreenHeader.tsx and the ownerLayout test).
- **M1-M3**: the doc fixes are done. **M4**: the DESIGNER-REVIEW marker is back on the checklist. **M5**: there is a comment above
  PRE_LOGIN and a line in the FIXED post. **M6**: two Playwright checks were added: the pgp-key textarea is wider than 480 px at
  1280x800, and at 360x800 the /login help links are a 2x2 grid of >= 44 px links with no sideways scroll. The pgp check would fail
  on the old 480 px column.

## Fonts must match owner option D

This branch sits on 1fa6bed1, which is older than fonts D (`wip/second-fonts` a3ded295: DM Sans + DM Mono). It does not carry the
fonts, so it must land after or on top of D, never as a font source. I merged it in a scratch worktree (not pushed) onto
a3ded295, onto 735d4784 (which contains a3ded295) and onto accffc9b. All three merges auto-merge except for one place:

**M1. Merge conflict in setup.css `.x2f-welcome__check`: keep D's 17px.** agy's side carries the base's `font-size: 16px`, but
fonts D set it to 17px. The correct resolution keeps agy's `padding: var(--x2f-space-4)`, border, radius and background and adds
**`font-size: 17px`**. If the lead takes agy's side wholesale, part of fonts D is silently undone. With that resolution the merged
tree has no font change over fonts D. I tested the merged tree on 735d4784 (which contains a3ded295): `tsc -p apps/web` is clean,
and the web vitest files ownerLayout, goodToken, fonts, wideShell and sessionLength give **5 files, 52/52 passed**.

Nits: screens.css ends with two stray blank lines where the #43 block was. Doc §3 still lists #38 under the help-link notes, but
the quote is now correct ("move everything down").

## Checks (fresh worktree, Node 24.22.1, `npm ci`, under the single test lock)

`npm run check` on 950834b2:
- typecheck: 20/20 workspaces clean
- copy-lint: clean (apps/web/src, apps/staff-web/src)
- separation-check: ok
- vitest, all projects: 392/393 files, **7267 passed, 1 failed**, 1 todo (7269)
- semgrep / npm audit: semgrep 0 findings (113 rules, 1364 files); npm audit --omit=dev 0 vulnerabilities

The one failure is `apps/web/test/serve-boards.test.ts > capture-refs > every board has a reference shot from its current
.dc.html`, which reports "BuyMain / Main: board changed since refs/*.png was captured". agy did not cause it. The test hashes only
`design/x2f-app/*.dc.html` against `refs/manifest.json`, and the branch changes nothing under `design/` relative to 1fa6bed1. It is
the same serve-boards red that batch 10a found on approved heads. The refs still need recapturing (tools/parity/capture-refs.ts)
by whoever owns design/ before main is green. `tools/check.sh` is `set -e`, so this red stopped it before semgrep and audit. I ran
those two separately under the lock (result above).

I did not run Playwright (setup.spec, shell.spec). agy reports 2/2 for the two new cases.

## Owner / lead questions (unchanged from the first layout review, still open)

1. Doc §3: should /session-length show signed-in help links? It is not built, and the lead's 12 Nov call stands until someone
   answers.
2. Doc §2: /setup/security-key art: keep the 4 generic outlines, or commission illustrations? That screen is claude2's.

There are no new owner questions.
