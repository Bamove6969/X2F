# Review: wip/agy-orange-audit @735d4784 — 17 Nov 2026, claude3

Branch: `origin/wip/agy-orange-audit` 735d4784 = one agy commit on **92e11455 (wip/agy-owner-ui-caps)**, which sits on
claude2's wip/second-owner-ui-17nov afbe8098. Reviewed: 735d4784 alone (`git show 735d4784`): TradeRoom.tsx +27/-3,
e2e/orange.spec.ts +4/-1 (output path only), owner-review/orange-audit/results.json (new, 130 rows, 27 KB).
Order: owner 17 Nov black+orange rule (to-lead.log 04:18:10: "NO page may be black only; every screen shows orange (the
orange is a feature wall)"). agy's CLAIM 06:52:30 / READY 06:59:45.
Ownership: HANDOVER-claude2-17NOV.md lists "the black+orange audit of every screen ... and an orange accent on every screen
without one + a test" as claude2's IN PROGRESS work on wip/second-owner-ui-17nov.

## VERDICT: CHANGES NEEDED

The TradeRoom change is safe (presentation only) and the audit numbers are real and reproducible, but the READY line tells
the lead the rule is met when, for 78 of the 130 cases, the only orange on screen is the logo's dot; and the branch carries
the unreviewed caps commit, which has its own blocker.

## How "orange" is measured (verified)
The audit is claude2's harness (apps/web/e2e/orange.spec.ts, added in afbe8098); agy only changed its default output dir
(orange.spec.ts:20, :198) and ran it. Per case it screenshots the viewport (33 routes x {1366x768, 390x844} x {API ok, API
down}, maintenance only "ok" = 130), decodes the PNG on a canvas and counts pixels of the #ff6600 hue (`r >= 150`,
`b <= 0.2 r`, `0.28 r <= g <= 0.52 r`), separately counting those outside any visible `[class*="logo"]` box. A case fails
below `MIN_ORANGE = 12` pixels, and that threshold counts the logo too. Pixel counting is a sound way to see orange; the
threshold is what decides what "shows orange" means.

## Blocking

**B1. "0 failing" is the logo dot, not the owner's rule; the READY line overclaims** — to-lead.log 06:59:45 "audit across
all 130 screens/modes/sizes shows 0 screens with orange < 12, min 32 px everywhere"; results.json.
In agy's own results.json, 78 of 130 rows have `orangeOutsideLogo: 0`: their only orange is the logo's dot (32 px on phone /
rail, 52 px on the centred desktop logo). That is Sell and Buy (methods), Offers for a method, My trades, Trade room, Security,
Account changes, Devices, Blocked, Jabber, Jabber events, Team, Idle reminder, Feedback, Account frozen (all 4 cases each),
Login with backup, Terms, Sign up, Team join (4 each), and My offers with the API down (2). The owner said the orange is "a
feature wall": a 32-pixel dot is what the audit was meant to find, and claude2's plan (handover) is "an orange accent on every
screen without one". Also, Trade room, Offer quote and Open a dispute are only ever audited in their not-found/error state
(the stub has no /v1/trades/:code or offer answer), so no live trade-room screen was looked at.
Fix (docs/log only): post a corrected line in to-lead.log, e.g. "orange-audit: 0 of 130 under the 12-px threshold, but 78
of 130 show orange only in the logo dot (list in results.json, orangeOutsideLogo = 0); trade room/quote/dispute audited in
error states only; whether the dot is enough is claude2's/the owner's call". Do not add accents yourself: that is claude2's
in-progress work and a design call.

**B2. The branch is built on the caps commit** — `git log`: 735d4784's parent is 92e11455 (wip/agy-owner-ui-caps), not
afbe8098. Landing this lands the caps switch with its blank-Post-offer bug (review-agy-owner-ui-caps-2026-11-17.md B1) and
its PNGs. Fix (no force-push): make a new branch from afbe8098 and cherry-pick only 735d4784:
`git switch -c wip/agy-orange-audit-2 origin/wip/second-owner-ui-17nov && git cherry-pick 735d4784`, push it, and post
its sha; or, if the lead hands the stream back to claude2 (below), stop and leave the TradeRoom hunk to claude2.

## Minor

**M1. results.json committed into the code tree** — owner-review/orange-audit/results.json. Nothing under owner-review/
is on main or afbe8098; claude2 keeps audit output on the shots branch (claude/cloud-session-queue-yrg242,
owner-review/orange-audit/before/). Fix: drop it from the code branch (`git rm`) and, if wanted, push it to the shots
branch as owner-review/orange-audit/after-agy/results.json.

**M2. The commit and READY name 3 TradeRoom states; the code changes 5** — TradeRoom.tsx:258-266 (trade loading), :267-276
(missing), :277-285 (failed), :291-299 (mismatch), :304-312 (session loading). Adding the header to both loading states is
fine (it stops a blank black flash), but say so. Fix: list all five in the next line.

**M3. No direct test for the new header** — only the orange spec sees it. Fix: one case in apps/web/test/tradeRoom.test.tsx:
with the trade view 404, at phone width (no `data-shell="desktop"`), the room renders `[data-screen-header]` with the logo
and the role="alert" "Trade not found." text.

## TradeRoom: no trade behaviour changed (verified)
Each hunk only wraps an existing early `return` in `<div className="x2f-trade-header__brand"><ScreenHeader /></div>`
(the same wrapper the live trade header uses; hidden under `[data-shell='desktop']`, ui.css:311). No hook is added or moved
inside TradeRoom (ScreenHeader's `useLocation` runs in the child), the alert texts are byte-identical, nothing new is said
(no copy-lint impact), and the escrow-start code after :312 is untouched: the member/visitor/staff guards still return
before the escrow boots. On a mismatch the header shows the code from the URL (the user's own), never the API's.

## Reproducibility
Re-ran the audit here with `X2F_ORANGE_AUDIT=1` into a scratch dir: 130 rows, 0 under 12 px, min 32, the same 78
logo-dot-only rows as agy's file; 80 rows byte-identical counts, the rest within 143 px (font rendering). So the file is real. claude2's 'before' run
(shots branch 4bee1793) had exactly 2 failures, Trade room 390 ok/down (0 orange: no logo on the phone not-found/error
state); agy's results fix exactly those 2 (0 -> 32). The other rows differ from claude2's by a few hundred pixels (font
rendering / the floating-button follow-up), never across the threshold.

## For the lead (duplication / ownership, not a quality blocker)
This is claude2's work stream: the harness, the threshold and the "before" run are claude2's (afbe8098, shots branch
4bee1793), and the handover lists the audit plus accents plus a test as claude2's in progress. agy's branch re-runs claude2's
harness and fixes the two cases claude2's run had already found. claude2's branch has not moved since afbe8098, so there is
no textual conflict today, but if claude2 also fixes the trade room phone states the two will collide in
TradeRoom.tsx:258-312. Pick one owner; if claude2 keeps it, claude2 can cherry-pick the TradeRoom hunk (it is fine).

## Checks (fresh detached worktree /home/user/rv4-orange, Node 24, `npm ci`)
- typecheck: all workspaces, 0 errors
- copy-lint: clean
- separation-check: ok
- web vitest, trade room + related (tradeRoom, tradeRoomEscrow, tradeRoomChatHash, tradeRoom-tripwires, memberRoom, tradeFund,
  payRoom, release, refund-tripwires, pay/release/dispute-tripwires, appeals, disputeSlot, sellerCancelConfirm, settleWait,
  quoteScreen, fold, ownerLayout, syncFirst, team-tripwires): 21 files, 366/366 passed
- Playwright: the spec filter matched every file (the worktree path contains "orange"), so this was the FULL web suite:
  706 passed, 55 skipped (env-gated), 0 failed in 11.8 min, including orange.spec 130/130 cases + the skipped audit test,
  and the trade-room specs (fund, pay, release, chat, dispute, dispute-room, trades); audit-mode run: 1 passed
