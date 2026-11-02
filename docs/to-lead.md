# Design → lead

Messages from the design session to the lead. Newest at the bottom, each entry dated. The lead reads this file on `wip/design-brief`.

## 2 Nov 2026, ~15:10 UTC

Received your four decisions. Logged in `docs/design-hold-model-2026-11-02.md` (last section) and applied to the boards; canvas v112, this commit.

**Boards changed**
- MyOffers, MyOffers-Wide: hold notice now "Nobody can see or take them until the hold ends. A moderator wrote in your dispute what to do to get trading back. Trades already started carry on." No date. Sample "Cash by mail · Fixed price" offer now follows the market (no fixed-price offers exist).
- Fold-MyOffers: same sample fix.
- ModCase: account action "Freeze trading on the losing side · only if they ignore the dispute or the ruling · no end time · write what they must do to get it back". Full freeze tooling is Plan 4; this is a placeholder for the rule.
- No other board shows a hold "during a dispute". Lien-Notice and Appeal-Notice describe liens and appeals, not trading freezes; unchanged.

**OPEN list (§5 of the handoff): what blocks design**
Nothing blocks. Boards exist for every item with an OPEN box. The ones whose answer changes a board, in priority order:
1. §5 #1 member-permission presets (MemberPermissions shows a draft mapping).
2. §5 #9 and #10 ProofBlur: can the buyer remove an automatic blur; warn when amount or memo is blurred; blank code, amount and time on templates.
3. §5 #12 SetupTerms: step "of 5" or "of 6".
4. §5 #2 "Stay logged in?" wait (draft 2 min).
5. §5 #7 incident-ID format.
The rest (#3, #4, #5, #6, #8, #11, #13) change copy only or are moot.

**New question for the owner, from today's rule**
- ModCase: should the freeze be a ruling-time option at all, or only a separate action taken later when someone ignores the dispute or ruling? Design drew it as an option on the ruling card for now, with the note above.

**Nothing else waiting.** Send the screenshot pack when ready; I'll review against v2 and reply here.

## 2 Nov 2026, ~19:40 UTC

Applied the three answers (freeze as a separate later action, add-only blur with amount/memo warning, 2 min prompt). Canvas v113. Boards: ModCase, ProofBlur (+Wide), SessionExtend (+Wide). Logged in the decisions file.

Also in this commit: `--mod`/`--team` tokens added to the THEMES of 10 boards that lacked them (no visual change).

**Cohesion pass under way.** All 126 boards rendered night and day and reviewed against v2: 41 P1, 168 P2, 65 P3 findings. Fixes are being applied now; expect a larger board commit and a new canvas version by 3 Nov. Two new owner questions came out of it (bans with an end date or not; "On hover" vs "On tap" for badge visibility). A progress page for the owner is published separately.
