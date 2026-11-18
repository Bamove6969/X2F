# Review: wip/agy-rail-members @ fa6d10ad (lead order #2, 18 Nov: hide owner-only links from members on the rail)

Reviewer: the lead's dedicated agy reviewer, 18 Nov 2026.
Base: wip/lead-owner-ui f06301cf (the branch holds one agy commit on top of it, as the order said). The branch head is now 1172f66d, which is the lead's note commit (AGY-READ-THIS.md only). It was not reviewed as agy work.
Scope:
- `apps/web/src/ui/DesktopShell.tsx`: a new `member` prop on DesktopRail and DesktopShell;
- `apps/web/src/App.tsx`: one line, passes `memberOf(session) !== null`;
- `apps/web/test/wideShell.test.tsx`: one test renamed and one added.

Lane: UI only. It hides links and does not change who may open a route: OwnerOnly and the API still refuse members. No money, keys or login code is touched.

## Verdict: APPROVE WITH MINORS

The change is small and correct for the desktop rail. The minors are a load flicker, the phone tab bar left as it was, and an owner/lead question on Settings.

## Findings

### Minor
- **M1. Links flicker on load for members.** `member={memberOf(session) !== null}` is false while the session is still loading, so a member's rail first shows Wallets and Settings and then drops them. `mayPostOffers` already avoids this for Post offer by returning false while loading (member.ts:24-28, "C11 review N2: a Trades-only member saw it appear and vanish on each cold load"). Do the same here: treat `loading` as "not known yet" and leave the owner-only links out until the session has loaded. Add a test for a loading session.
- **M2. The phone tab bar is not changed.** `ui/BottomNav.tsx` still shows Wallets to a team member, and Wallets is OwnerOnly. Its own comment cites design review 2026-11-01 shot 26: "no tab that only leads to a refusal". Desktop and phone now disagree. Either apply the same filter to BottomNav, with a test, or say in the READY line that the phone is left for the lead.
- **M3. Hiding Settings also hides member-usable settings (owner/lead question, not agy's call).** The rail's Settings link goes to /settings/security, which is OwnerOnly. But /settings/blocked, /settings/jabber, /settings/jabber/events, the idle reminder and /session-length are not OwnerOnly. With the link gone, a member has no way from the rail to the settings it can use. Recommendation: point the member's Settings link at a page the member can open, rather than removing it. The lead or owner decides.
- **M4. A test was renamed.** "leaves out Post offer for a team member without the Offers role" became "... for a trader/vendor without the Offers role", with the same expectation. That is accurate, since `mayPostOffers` is also false for a trader account (member.ts:30), and the member case is now covered by the new test, so nothing is weakened. Mention the rename in the READY line so the lead isn't surprised.

### Info
- No user-facing copy is added. No "half". No orange or data-primary is changed.
- The comments are accurate: Wallets and Security are wrapped in `OwnerOnly` (Wallets.tsx:248, Security.tsx).

## Checks run at fa6d10ad (under the shared lock)
- `npm run typecheck`: ok.
- `npm run copy-lint`: ok.
- `npm run separation-check`: ok.
- `npm test` (Docker up): 375 files, 375 passed. Tests: 6988 passed, 1 todo, 0 failed (serve-boards is green on this base).
- `npm run semgrep`: 0 findings.
- `npm run audit`: 0 vulnerabilities.
- Playwright web (full, `--trace off`): 548 passed, 52 skipped, 0 failed.

Counts: 0 blocking, 4 minor, 2 info.
