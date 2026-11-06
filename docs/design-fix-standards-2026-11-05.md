# Fix brief (read fully, then your group's findings file)

You are applying cohesion fixes to X2F design boards. Files: `/tmp/claude-0/-home-user-X2F/e5516970-d0c8-5c45-96e2-44b38e46c984/scratchpad/design/lead/project/<Board>.dc.html`. Rules: `design-visual-system-v2.md` and `design-conventions.md` in this folder. Your findings: `findings-<GROUP>.md` in this folder. Edit ONLY the boards listed in your group. Never touch `canvas.json`.

## What to apply
- Every **P1** and **P2** in your findings, unless listed under "Leave for the owner" below.
- **P3** when it is a one-line change. Skip P3 items that need a redesign.
- The **shared standards** below override any finding that disagrees with them. They exist so five groups land on one look.

## Shared standards (apply wherever your boards touch them)
1. **Wide nav rail:** six items, in this order: Trade, Post offer, Wallets, Profile, Settings, Help. Copy the rail markup and icons verbatim from `Devices-Wide.dc.html`. Current item = the one this screen lives under (settings screens: Settings; trade screens: Trade; offer boards: Post offer; profile/review boards: Profile).
2. **Timers and durations:** never mm:ss. Digits in mono, units in body: `<span mono>4</span> min <span mono>59</span> s`, `<span mono>1</span> h <span mono>52</span> min`, `<span mono>24</span> h hold`. Drop seconds from anything over an hour. Use the existing mono span style the board already uses for digits.
3. **Wordmark "X2F":** plain `var(--ink)`, no orange "2".
4. **Switches:** on = `var(--ink)` track with `var(--ground)` knob; off = `--surface-raised` track, `--ink-muted` knob; disabled = off look plus `disabled` attribute. Never `--team` or `--escrow` for on.
5. **Selection:** 2px `var(--ink)` border on `var(--surface-raised)`. Never a tone colour ring, never orange.
6. **Dates:** `6 Nov 2026, 15:00 UTC` in mono, always year and UTC, no weekday. Times alone: `14:05 UTC` in mono.
7. **Amounts:** XMR always 6 decimals; digits mono; unit "XMR" in body 600 `var(--monero-ink)`. Fiat beside it mono muted.
8. **Usernames:** body text, never mono, never uppercased (chips must not contain a username).
9. **No email anywhere**, including example chat lines. Use the replacement wording in your findings.
10. **Terms:** "owner" for the account holder (not "team lead" / "account holder"); "team member" for support staff; "moderator" only in disputes; "senior moderator" for appeals; button label "Open dispute"; tertiary "Back to my trades"; "band" not "tier" for price bands; "Authenticator app" (no "(TOTP)"); sensitive actions "need a passkey, security key or PGP key"; weak-login chip word "WEAK LOGIN".
11. **Hero for "escrow secured, buyer must pay now":** caution tone, chip "Pay now". Hero = chip + key mark row, one big thing (timer or amount), lead below. Never a 24px headline plus a hero number in the same hero.
12. **Disabled-primary hint:** one 13/18 muted centred line under the primary.
13. **Setup stepper done colour:** `var(--ink)`.
14. **Pre-login wide layout:** the `Login-Backup-Wide.dc.html` pattern (centred wordmark, centred column, forms max 720).
15. **Design notes, "… are examples." captions, DECIDED/OPEN asides:** always below the app root in the Design notes section, never inside the app.
16. **Callouts:** §12; add a 15/20 600 title when the text is more than one sentence.
17. **No dashed borders** except upload rows (`--line`) and OPEN boxes (`--caution`). No `box-shadow` except the nav inset.
18. **Placeholders** like `[address to come]`, `[RATE]`, `[SELLER ZELLE ID]`: show a realistic masked example in the UI and put the undecided value in an OPEN box in the notes.

## Leave for the owner (do NOT change; add or keep an OPEN box in the notes if there isn't one)
- Password rule wording: use the spec rule on both SetupPassword and SignupSecurity ("At least 10 characters, with upper and lower case letters, a number and a symbol."), keep SignupSecurity's OPEN pwRule box.
- Ban-Notice: whether bans have an end date. Keep the tweak; add an OPEN box.
- BadgeSettings "On hover" vs "On tap". Keep "On hover"; add an OPEN box.
- PostOffer vs FlexOffer-Post: keep both boards live; no superseded banner.
- Any sentence the findings mark as possibly the owner's words (Warn-IvePaid long sentence, Maintenance copy): leave it.
- DisputeRoom "ruling due by": keep the deadline (the product has one), fix only the date format.
- DisputeOpen "A moderator usually replies within 4 hours.": keep, write it as "within <mono>4</mono> h".

## Process
1. Read the rules, then your findings, then each board you change (Read before Edit).
2. Make the edits with the Edit tool. Keep tweaks, states, OPEN boxes and sc-if/sc-for logic working. All UI stays markup.
3. If a board's content grows or shrinks, update the root height and `$preview.height` in data-props to match (phone min 844, wide min 800).
4. After editing a board run `node /tmp/claude-0/-home-user-X2F/e5516970-d0c8-5c45-96e2-44b38e46c984/scratchpad/design/tools/check-board.js <board>` and fix anything it reports (a `&#160;`/`&#8220;` entity "hex" warning is a false positive; `</colgroup>` with `<col>` is a false positive).
5. Render every changed board night and day: `node /tmp/claude-0/-home-user-X2F/e5516970-d0c8-5c45-96e2-44b38e46c984/scratchpad/design/tools/render-board.js <board> /tmp/claude-0/-home-user-X2F/e5516970-d0c8-5c45-96e2-44b38e46c984/scratchpad/shots2/<Board>.<theme>.png <theme>` (create `shots2` if needed) and LOOK at each PNG with Read. Fix what looks wrong. Check nothing is clipped at the bottom.
6. Write `/tmp/claude-0/-home-user-X2F/e5516970-d0c8-5c45-96e2-44b38e46c984/scratchpad/review/fixed-<GROUP>.md`: boards changed (one line each: what), findings skipped and why, COPY-UNSIGNED (every new or changed user-facing sentence), and open questions for the owner. Return a 5-line summary.

## Addendum (5 Nov): resuming after an interrupted run
An earlier fixer run on your group was killed mid-way. Some boards in your group may already carry part of the fixes. Before editing a board, Read it and compare against the findings: apply what is still missing, don't redo what is done, and don't undo a done fix. Boards in the repo's last committed state are at `/tmp/claude-0/-home-user-X2F/ef124731-52c6-41bb-ac1c-a482489088e9/scratchpad/design-brief/docs/design-boards/` if you need the "before" version (read only). Save after every board so nothing is lost if you are interrupted again. Write `fixed-<GROUP>.md` incrementally: append a line per board as you finish it.
