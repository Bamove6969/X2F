# Review: wip/agy-owner-ui-caps @92e11455 — 17 Nov 2026, claude3

Branch: `origin/wip/agy-owner-ui-caps` 92e11455 = one agy commit on claude2's wip/second-owner-ui-17nov afbe8098.
Only agy's commit is reviewed (`git diff afbe8098 92e11455`: PostOffer.tsx +9/-2, e2e/floating-action.spec.ts +35/-2,
4 PNGs in owner-review/fonts/after-floating/).
Order: the lead's 17 Nov order as quoted in agy's CLAIM (to-lead.log 06:28:32): an UPPERCASE bold "POST OFFER" label variant
behind a ?caps=1 / localStorage switch, mixed case by default, plus 4 Post offer screenshots. (The order text itself is not
on comms in to-agy.log or AGY-ORDERS*.md; checked against the claim and the lead's brief.)

## VERDICT: CHANGES NEEDED

The switch does what was asked and the default stays "Post offer"; nothing else changed. One blocker: reading the switch
crashes the whole Post offer screen for anyone whose browser blocks site storage.

## Blocking

**B1. Post offer goes blank when localStorage throws** — apps/web/src/screens/PostOffer.tsx:212
`(typeof localStorage !== 'undefined' && localStorage.getItem('x2f_caps') === '1')` runs on every render with no try/catch.
When the browser blocks site data (Chrome/Edge "block cookies" for the site, some embedded/private modes), merely reading
`localStorage` throws `SecurityError` (`typeof` does not guard against a throwing getter). Proven here: a Playwright probe
signed in as a vendor with `window.localStorage` made to throw: at 92e11455 `/post` renders an empty page (`pageerror:
SecurityError`, no h1, no Post offer button); with afbe8098's PostOffer.tsx in the same tree the screen renders fully.
Every other localStorage read in the app is wrapped (news-model.ts:33, courtesy.ts:18, confirmSkip.ts:27, fund.ts:74,
warned.ts:15, tour/progress.ts:11, welcomeSeen.ts:14).
Fix: move the check into a small helper that never throws, e.g.
```ts
function capsOn(search: URLSearchParams): boolean {
  if (search.get('caps') === '1') return true;
  try { return window.localStorage.getItem('x2f_caps') === '1'; } catch { return false; }
}
```
and add a Playwright case in floating-action.spec.ts: with `addInitScript` making `localStorage` throw, /post still shows
the "Post offer" button.

## Minor

**M1. Use CSS for the capitals, not a second string** — PostOffer.tsx:213/763. `'POST OFFER'` is a new user-facing string
with no `COPY-UNSIGNED` marker (the comment says `DESIGN:`), and it changes the button's accessible name to all capitals,
which some screen readers spell out. Fix: keep the text `Post offer`, put `data-caps=""` on the button when the switch is on,
and add `.post-submit[data-caps] { text-transform: uppercase; }` to apps/web/src/screens/post/PostOffer.css (next to :364).
The label is already 700 weight, so "bold" needs nothing more. Update the e2e test to check
`getComputedStyle(...).textTransform === 'uppercase'` and that the name stays "Post offer".

**M2. Can the switch leak into normal use: only by hand, but it ships to everyone** — PostOffer.tsx:210-212. Nothing in the
app sets `x2f_caps`, and `?caps=1` only lasts for that page view, so ordinary users won't see it by accident. But it is in
the production build for all users, `?caps=true` also works (undocumented), and once `x2f_caps` is set there is no in-app
way back. Fix: accept only `caps=1` (drop `'true'`), let `?caps=0` remove the key, and add a comment
`// OWNER-REVIEW switch (lead 17 Nov): remove once the owner picks a case` so it is deleted after the decision.

**M3. Screenshots committed into the code branch** — owner-review/fonts/after-floating/*.png (4 files, 43-62 KB each:
sizes are fine). Nothing under owner-review/ exists on main or on afbe8098; claude2 keeps owner screenshots on the shots
branch claude/cloud-session-queue-yrg242. If this branch lands, the PNGs land in main. Fix: `git rm -r owner-review/` on
this branch and push the 4 PNGs to claude/cloud-session-queue-yrg242 (or hand them to claude2). Keep the spec change
(`${ROOT}owner-review/...` default + mkdirSync is better than the old hard-coded /home/user path).

**M4. READY overclaims the Playwright count** — to-lead.log 06:47:30 "floating-action 6/6 passed": the 6th test (owner
screenshots) is skipped unless `X2F_OWNER_SHOTS=1`; a normal run is 5 passed, 1 skipped. Fix: report what the runner prints.

## For the lead (duplication, not a blocker)
claude2's helper already pushed CAPS screenshots with the same names to the shots branch at 04:32 UTC
(claude/cloud-session-queue-yrg242 5d1c460d: after_desktop_post_CAPS.png, after_phone_post_CAPS.png), two hours before agy's
claim. agy's PNGs are different renders (61 KB vs 71 KB desktop, from agy's machine). Decide which set the owner sees, and
whether this switch goes onto claude2's branch or stays separate; the PostOffer.tsx hunk is small and merges cleanly on afbe8098.

## Screenshots
Looked at all 4: desktop 1366x768 and phone 390x844, mixed case "Post offer" and "POST OFFER", orange floating button,
no bar behind it. Re-made here with `X2F_OWNER_SHOTS=1` into a scratch dir: same views; mixed-case files byte-size equal
to claude2's shots-branch files, so agy's set differs only by machine rendering.

## Checks (fresh detached worktree /home/user/rv4-caps, Node 24, `npm ci`)
- typecheck: all workspaces, 0 errors
- copy-lint: clean (it does not see `'POST OFFER'` as copy: see M1)
- separation-check: ok
- web vitest, related (postOffer, postOfferFlex, offersV2, offerAmounts, giftCards, accountType, selection-ink, syncFirst,
  ui, cantDoThat-lint): 10 files, 183/183 passed
- Playwright floating-action + post: 28 passed, 1 skipped (owner shots), 0 failed; owner-shots run with X2F_OWNER_SHOTS=1: 1 passed
- B1 probe (temporary spec, deleted): fails at 92e11455 (blank /post), passes with afbe8098's PostOffer.tsx
