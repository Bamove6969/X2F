# Build review: screenshot packs vs boards, 5 Nov 2026

Reviewer: Claude Design. Inputs: the four packs under `main-app/docs/design-screens/` (`2026-11-02-loginapprove-v2`, `2026-11-02`, `2026-11-01-devices`, `2026-11-01-c11`; 76 PNGs, every one looked at, night and day), the 1 Nov review (`design-brief/docs/design-review-screens-2026-11-01.md`), the boards in `design/lead/project/*.dc.html` with their renders in `shots/<Board>.<night|day>.png`, `design-visual-system-v2.md` and `design-conventions.md`.

Where a shot number exists in two packs, the newer pack is the current state and the older one is listed only for what changed. Tags: **DRIFT** (differs from the board) · **RULE** (breaks the system) · **STALE** (follows a superseded decision) · **OK**. Token names are the board tokens.

Boards that are themselves off the rules (so the build should not copy them): DisputeRoom and DisputeRuling still show dates without year or UTC ("Fri 16 Oct, 10:14", "Thu 15 Oct, 14:30"); LoginApprove says "Chrome, Windows" while Devices says "Firefox on Linux" (the build's "Chrome on Windows" form is fine, keep it app-wide); MyOffers-Wide shows a nav rail while the build's wide shell is a top bar (treated as the app's shell, not a finding). MemberPermissions (2 Nov, Draft copy) replaces the Offers/Trades role checkboxes with presets and per-permission switches; the build still has two checkboxes. The lead should confirm which is current before the build team touches Team again.

---

## 1. Shared problems X1–X9: status

| Code | Status | Evidence in these packs |
|---|---|---|
| **X1** orange selection | **PARTLY** | FIXED: number tiles and radio cards in 06/08/10 (2px `--ink` on `--surface-raised`), MyOffers checkboxes and the ticked-card ring in 31/32, the active "Profile" tab in 31–35 and "Trade" tab in 26 (ink text, ink top bar). STILL: 19 (the "Offers" checkbox is an orange filled square), 26 (the selected "USD" currency chip and "Most buyers" sort chip have an orange border), 61 (PostOffer "Sell XMR" and "Market ± %" segments behind the sheet have an orange border). |
| **X2** CantDoThat shell | **PARTLY** | FIXED in the c11 pack: 04, 20, 25, 61 now have the icon tile, grab handle, no X, OK as the 56px `--monero` primary. STILL in 33 (2 Nov pack): an X close at top right, OK is an outlined button, no icon tile, no grab handle. Two different popup components are in the build; 33 must use the one 61 uses. |
| **X3** orange focus ring | **STILL** | 62: the focused textarea has a 2px orange ring. No other input is focused in these packs. Fix: `:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px }`. |
| **X4** native controls | **STILL** | 19: `<fieldset>` "Roles" with the browser's grooved border, native `<select>` "Every member". 62: `<fieldset>` "What is it?" with three 13px native radios on one line, a 13px native checkbox "Send anonymously". No change since 1 Nov. |
| **X5** dates and times | **PARTLY** | FIXED: 06/08/10 show `2 Nov 2026, 08:59 UTC` in mono. STILL: 04 ("Fri 3:00 PM"), 58 ("Fri 16 Oct, 10:14"), 59 ("Thu 15 Oct, 14:30", "Sat 17 Oct, 14:30", "10:02", "09:40 to 13:55", all without year or UTC). |
| **X6** invite expiry at the epoch | **not covered** | Shots 16, 17 and 23 were not reshot and 19 shows no invite expiry. Cannot confirm. |
| **X7** mono timer spacing | **STILL** | 59: "47 h 58 min left" is set entirely in mono (wide gaps around h/min). 01's `05:00` is fine. Fix: digits in mono, "h"/"min" in body text. |
| **X8** centred "Time to pay" card | **not covered** | No trade-room shot in these packs. |
| **X9** old hold wording | **STILL** | 04: "a login with only one way of proving it's you", "an authenticator code set up before the hold", "A backup login uses up that recovery code and makes the hold last 24 hours from then". 20: "logged in with only one way of proving it's you", "your password and authenticator code" offered as a way to invite members. Both contradict the 1 Nov tiers (Weak / Strong / Armored vault; passkey, security key or PGP key only; a recovery code always starts a 24 h hold). |

---

## 2. Per shot

### Pack `2026-11-02-loginapprove-v2` (newest; supersedes the same numbers in `2026-11-01-devices`)

Board: LoginApprove (`side=new` for 01–03, `side=existing` for 06–10), LoginApprove-Wide for 06w, Devices-Wide for 11w.

**01-login-approve-number** — mostly to the board now.
- OK: compact header, h2 28/32 "Approve this login on a device you're already using", caution-washed hero card with "YOUR NUMBER" chip, mono 72 number, helper line, clock status line with mono timer, 56px "Where do I approve it?" row with chevron, outline card "No other device with you?", Cancel in the footer. Day fine.
- DRIFT: the outline card is cut down. Board: body "Log in with your passkey, security key or PGP key instead. Any of those proves it's you without an approval.", button **"Use a passkey, security key or PGP key"** (48px, `1px solid var(--line)`), then the 13px muted line "Only have your username and password? Then your recovery code is the way in, and it starts a 24-hour hold." Built: only a button "Log in with a backup instead." Fix: add the two lines and rename the button.
- DRIFT: missing the muted room line "You can be logged in on up to 3 devices at once. You're on 2 now, so there's room for this one." (14/20 `--ink-muted`, under the "Where do I approve it?" row) and the muted paragraph "Only team leads approve new devices. Until this one is approved, it can't log in. Nothing else changes: your other devices and your team carry on as usual."
- Changed since 2026-11-01-devices: header went from 24px "Log in" to the compact 15/20 muted title; the hero card gained the caution wash, border and chip (was a plain `--surface` card with a muted label); the outline card got its `--line` border.

**02-login-approve-let-in**
- OK: 56px escrow icon tile (radius 16), h2 "You're in", Continue primary. Day fine.
- DRIFT: body is "Your other device approved this login." Board: "Your other device approved this login. Chrome on Windows is now one of your devices." Add the second sentence.
- Changed since 2026-11-01-devices: the bare 24px check icon became the 56px tile; compact header.

**03-login-approve-blocked**
- OK: matches the board (danger icon tile, h2 "This login was blocked", the two 16/24 lines, the 15/22 muted "If it was you, try again…", "Try again" primary). "Log in with a backup" as a muted tertiary under it is an addition the board does not have but it breaks no rule. Day fine.
- Changed since 2026-11-01-devices: bare icon became the 56px tile; compact header.

**06-security-approve-ask**
- OK: caution chip "NEW LOGIN", h2 24/30, `<dl>` box on `--surface-raised` with Device / Time / Where and the full "Not shown…" sentence, mono UTC time, 72px mono tiles with the selected one ringed in ink, danger-confirm "No, block it" (tinted fill, `--danger` border), mono `04:00` timer. Day: contrast fine, the danger button reads well.
- DRIFT (small): chip text. Board: "NEW LOGIN · TEAM LEAD ACCOUNT". Built: "NEW LOGIN". Use the board text, or confirm with the lead that the suffix was dropped.
- Note: "Yes, let them in" is the orange primary here while the board shows it as a `--surface-raised` button. The board render has no tile selected, so its button is in the resting state; with a tile selected the primary fill is right. OK.
- Changed since 2026-11-01-devices: the label became a chip; the `<dl>` rows got dividers; date moved to 08:59 UTC.

**06w-security-approve-ask-wide**
- OK: 520px dialog centred over the dimmed app, same content as 06.
- DRIFT: the two buttons stack. Board LoginApprove-Wide puts "Yes, let them in" and "No, block it" side by side in a 2-column row (48px each). Fix: `grid-template-columns: 1fr 1fr; gap: 12px` on wide.
- Changed since 2026-11-01-devices: the three tiles no longer all carry a 1px ink border (that read as all selected); only the chosen one is ringed. Good.

**07-security-approve-done**
- OK: 56px escrow tile, h2 "Chrome on Windows is logged in", "You can see your devices and log any of them out in Devices." with Devices as the link, Done primary. Matches the board. Day fine.

**08-security-approve-at-limit**
- OK: only the one note shows now (the one-at-a-time contradiction is gone). Caution callout with triangle icon, selected tile ringed in ink.
- DRIFT (copy): "You're logged in on the most devices allowed. Next you'll choose one to log out." Board: "You're logged in on 3 devices, the most allowed. Next you'll choose one to log out." Put the "3" back; it tells the user the limit.
- Changed since 2026-11-01-devices: the callout icon went from an info circle to the caution triangle (right for a caution callout).

**10-security-approve-choose-device**
- OK: chip "NEW LOGIN · CHROME ON WINDOWS", h2 "Choose a device to log out", body matches the board, 64px radio cards on `--surface-raised` with a 20px dot, name 16/600 and note ("This device · active now" / "Last active 3 days ago"), selected card ringed in ink, primary "Log it out and let them in", danger "No, block it". Day fine.
- Fixture: the first device is named "Browser on Linux". Devices (11) calls it "Browser on Linux" too, but every board uses a browser name ("Firefox on Linux"). Name the fixture device "Firefox on Linux" in both.
- No visible change since 2026-11-01-devices.

**11w-security-devices-wide**
- Identical to the 2026-11-01-devices shot; see 11 below for the content findings. The two-column split (Devices | Options) follows Devices-Wide.
- DRIFT: "How a new device gets in" has one card of the board's three (missing "No other device with you?" with "Log in another way", and "Only have your username and password?" with the LAST RESORT chip and "How the hold works"), and the one card has no "See the approval prompt" chevron link.
- DRIFT: Options has no "Stay logged in for" row (board: label, "Not set", four 48px chips 2 h / 4 h / 6 h / 12 h on `--surface-raised` with `1px solid var(--line)`, nothing pre-selected, hint "When this time is up, we'll ask you to confirm it's you to stay logged in. If you don't, you're logged out."). The default is an OPEN owner item, so leave nothing selected; the row itself is decided.

### Pack `2026-11-02` (My offers)

Board: MyOffers, MyOffers-Wide, Fold-MyOffers. The CantDoThat board for 33.

**31-myoffers-list** — rebuilt to the board; the 1 Nov grid, switch, checkbox and tab-bar findings are fixed.
- OK: 52×32 `role=switch` (ink track on, `--surface-raised` + `--line` off), 24px checkboxes in 44px rows, "Select all" card with hint, fixed column grid, off card transparent with `1px dashed var(--line)`, status line 13/600 ink/muted, footnote with "3 buying and 3 selling offers" (matches the board's draft copy), "Post an offer" and the tab bar pinned, active tab in ink. Day fine.
- DRIFT: no per-offer **Edit** link. Board: "Edit" (underlined, 15/600, `--ink`) at the right end of the status line on every card.
- DRIFT: the header order and size. Board: back row, then "3 of 5 offers on" 13/16 muted, then h1 "My offers" 28/32 Familjen 700. Built: 18px "My offers" with the count under it. Use the key-screen header (v2 §5).
- RULE (small): an unticked checkbox in night renders as a filled `--surface-raised` square with no visible border, so it looks like a disabled control. Give it `1px solid var(--line)` (the board's box is outlined). Day is fine.

**31w-myoffers-wide-list**
- DRIFT: the wide page is the phone layout centred at 448px. Board MyOffers-Wide is a table list: header row (checkbox | ON | Select all | PRICE | PER TRADE | STATUS), each offer a 64px row with the switch, title block, price, per-trade range, status and Edit, "Post an offer" top right (48px, min-width 160), footnote under the table.
- RULE: the footnote is cut off behind the pinned "Post an offer" footer (the first line is half visible at y≈714). Add `padding-bottom` equal to the footer height to the scroll area, on wide and on phone.

**32-myoffers-selected-bar** — fixed.
- OK: sticky 56px bar above the tab bar ("2 selected · Clear · Turn on · Turn off"), replaces "Post an offer" while a selection exists, selected cards get the 2px ink ring, tri-state "Select all" with "Some selected: 2 of 3." Day fine.

**32w-myoffers-wide-selected-bar**
- DRIFT: the board puts the selection bar at the top of the content column ("2 selected" left, "Turn on" / "Turn off" / "Clear" right, 48px buttons), above the table. Built pins it to the bottom of the viewport.
- RULE: same footnote clipping as 31w.

**33-myoffers-hold-refused** — the hold state behind the sheet is right; the sheet is the old shell.
- OK (behind): header "Trading hold · all offers paused", caution callout "Your offers are paused during a trading hold…", every switch disabled, "Paused · trading hold" chip per card. This is the MyOffers board's hold variant.
- RULE (X2): the sheet has an X close and an outlined OK, no icon tile, no grab handle. Use the CantDoThat component from 61: 56px `--monero` OK, no X.
- RULE: the title "You can't turn offers on during a trading hold" is 9 words (limit 6). Fix: "Offers are paused" with the body "They stay paused until the hold ends. Trades already started carry on."
- RULE (small): the "Paused · trading hold" chip is an outlined pill. v2 §7: `background: color-mix(in srgb, var(--caution) 14%, transparent); color: var(--caution)`, no border.

**34-myoffers-hold-summary** — fixed.
- OK: no contradictory per-row text, caution (not danger) banner, header reads the hold, chips on every card, Post an offer and tab bar pinned. Day fine.
- RULE: the footnote is clipped behind the footer ("…Turned-off offers stay" is the last visible line). Same `padding-bottom` fix as 31w.
- RULE (small): same outlined chip as 33.

**35-myoffers-empty**
- OK: tab bar pinned, "0 of 0 offers on" gone, "Post an offer" is the one primary. Day fine.
- DRIFT: the empty state is a 24px icon, a 20px title and one line. v2 §16: 56px icon tile (radius 16, `--surface-raised`), title Familjen 24/30 700 "No offers yet", one 16/24 muted sentence "Post an offer to buy or sell XMR. You can have 3 buying and 3 selling offers.", padding 48 24, gap 12.

**54-fold-884-myoffers**
- RULE (owner: nothing across the hinge): a single 448px column is still centred on the hinge (x≈442). The tab bar is now pinned (fixed).
- DRIFT: board Fold-MyOffers is two panes of 412 + 16 + 412: left pane the phone list ("Select all", cards with a chevron on the selected card, footnote, "Post an offer" pinned), right pane the selected offer ("Selling XMR · USD", "Last edited …", On/off row with switch, PRICE block, PAYMENT METHODS block, per-trade `<dl>`, "Edit offer" pinned). Each pane keeps its own 16px gutter; dialogs stay inside one pane.
- RULE: a ~340px empty band between the footnote and the footer; the list should scroll inside the pane and the footer sit at the pane bottom.

### Pack `2026-11-01-devices` (only the shots not superseded by `loginapprove-v2`)

Board: Devices.

**11-security-devices** — Devices is now its own screen; the 1 Nov structure findings are fixed.
- OK: back + h1 "Devices and sessions", meter card "2 of 3 devices logged in" with three pills and "One more device can log in.", "Your devices" with 40px icon tiles, "This device" chip, "Active now" / "Last active 3 days ago", outlined "Log out all other devices", Options card with a 52×32 switch. Day fine.
- DRIFT: the board's per-row "Log out" is a danger tertiary text button (`--danger`, 15/600, 44px). Built: an outlined ink button. Either is a real 44px control; follow the board.
- DRIFT: missing the intro line under the h1 ("See where you're logged in, log devices out, and choose how long a session lasts.").
- DRIFT: Options lacks "Stay logged in for" (see 11w). "How a new device gets in" has one of three cards and no chevron links (see 11w).
- Fixture: "Browser on Linux" → "Firefox on Linux".

**11w-security-devices-wide** — same as the loginapprove-v2 copy; see above.

**30-team-owner-devices-member-session**
- OK: the member session is in its own card with the `--team` tint and border, a `--team` initials avatar, "Team member" chip, "Firefox on Linux · Active now", a "Log out" button, and the "Manage roles and invites in Team" row. Day fine.
- DRIFT: the meter still says "2 of 3 devices logged in" with one own device (Pixel 8) listed, so the member's session is being counted. Board: "Team members' logins don't count toward your 3 devices." Fix: count own devices only ("1 of 3", one filled pill, "Two more devices can log in.").
- DRIFT: the card is missing the board's lines "Team members' logins don't count toward your 3 devices." and the lock note "Switching a member off or on needs a two-factor method you've already set up: a passkey, security key or PGP key.", the per-member **"Can log in"** switch (52×32, `--ink` track), and the **"Log out all team members"** button (48px, `1px solid var(--team)`, `--team` text).
- RULE (small): the "Team member" chip is outlined. Board chip: `color-mix(var(--team) 14%, transparent)` fill, `--team` text, no border.

### Pack `2026-11-01-c11`

Boards: CantDoThat, RecoveryHold, Team, TeamRefusal, Main (for 26), DisputeRoom, DisputeRuling, PostOffer (behind 61), Feedback.

**04-login-hold-refused**
- OK (shell): the CantDoThat shell is right now (icon tile, handle, no X, orange OK). Day fine.
- STALE (X9) and RULE (X5): the body is still the 7-sentence paragraph with "Fri 3:00 PM", "only one way of proving it's you" and "authenticator code set up before the hold". Fix: body "This device can log in after `6 Nov 2026, 15:00 UTC`. Your account is on a 24-hour hold." plus a link "See the hold" to the RecoveryHold screen. Nothing more in the sheet.
- DRIFT: the hold itself still has no screen. Board RecoveryHold: "Account on hold" h1, "HOLD ENDS IN" chip with the mono 40/44 countdown and caution bar, "Your recovery code was used to log in", "Everyone is logged out", "Your open trades", "Ask us to remove the hold" (Matrix / Telegram rows), "How the hold ends", primary "End the hold early", "Back to log in".

**19-team-full-invite-disabled**
- OK: at 3 of 3 the note "You have 3 members, the most allowed. Remove one to add another." shows and "Make an invite link" is disabled (the 1 Nov dead-end popup is gone).
- RULE (X1): the "Offers" checkbox is orange-filled. `accent-color: var(--ink)`, 24px box in a 44px label row.
- RULE (X4): `<fieldset>` "Roles" with the native grooved border; native `<select>` "Every member". Label 13/16 600 uppercase muted, no border; select 44px, radius 6, `1px solid var(--line)`, `--surface-raised`.
- RULE: "Roles" sits at x≈218 / 216 / 247 across the three member rows, is grey text, and is under 44px. Fixed right-aligned action column; each action a 44px button.
- DRIFT: the name field and checkboxes stay enabled while the invite is disabled; disable the whole form, or hide it behind the note.
- DRIFT: the Team board is member cards (40px `--team` avatar, "Team member" chip, status dot + "Logged in · active 4 min ago", a `role=switch` per member, "Edit what they can do" row with "N of 19 allowed · preset", "Member since <date>", "Remove"), the info lists, and one primary "Add a member" at the bottom that opens a sheet. The built page is still an inline form. See the MemberPermissions note at the top: get the lead's call on roles vs permissions before rebuilding.
- STALE (owner question from 1 Nov still open): "Chat shows it as 'Team <your name> member: <their name>'" vs the board's "Your username, with a Team member label on chat replies a member sends. Never which member."

**20-team-refused-weak-session**
- OK (shell): CantDoThat shell fixed.
- STALE: still a CantDoThat popup instead of the **TeamRefusal** board: page banner "THIS DEVICE'S LOGIN IS WEAK / You logged in here with just your username and password…", sheet with chip "PASSKEY, SECURITY KEY OR PGP KEY NEEDED", h2 "You can't add members from this device", the Weak (this device) / Strong (needed) / Armored vault (also works) ladder, body "Add a passkey, security key or PGP key. Then use it to log in on this device.", primary "Add another way to log in", tertiary "Not now".
- STALE (X9): the copy says "only one way of proving it's you" and offers "your password and authenticator code" as enough. Under 1 Nov a password + authenticator is not Strong; only a passkey, security key or PGP key is.
- RULE: the title "This can't be done on the team" is vague. Until TeamRefusal is built: "Needs a Strong login".

**25-team-member-owner-only**
- OK (shell): CantDoThat shell fixed. Day fine.
- DRIFT: the screen behind is still empty `--ground`. Keep the previous screen under the scrim and return to it on OK.
- RULE: title "This can't be done on the team" does not say what happened. Fix: "Only the owner can do this".

**26-team-member-trades-only-nav**
- OK: "Post offer" is gone from the member's tab bar (the 1 Nov 26 refusal is replaced by hiding the entry). The active "Trade" tab is ink with an ink top bar. Day fine.
- RULE (X1): the selected "USD" chip and the "Most buyers" chip have an orange border. Selected chip = `2px solid var(--ink)` on `--surface-raised`.
- DRIFT (Main board): currency is a chip row; the board uses a currency `<select>` beside the search. The "Site news" bell with the teal dot next to the X2F wordmark is still missing.
- Open from 1 Nov: Wallets is still in the member's tab bar; a member can never use it (board Team: "Only you can: Change payout wallets"). Hide it for members.

**58-dispute-room** — reshot with a working chat (fixed); the room content still differs from the board.
- OK: the moderator card, the system lines, the moderator bubble in `--mod`, the composer, a readable day variant.
- DRIFT: no hero status block. Board: "IN DISPUTE" danger chip + key mark, "1.250000 XMR" hero amount with "locked in escrow", inner block "Replied in 38 min · ruling due by …". Built: two chips in a row and a plain line.
- RULE: "1.25 XMR" → "1.250000 XMR" (6 decimals, digits mono, "XMR" in `--monero-ink` 600).
- RULE (X5): "Fri 16 Oct, 10:14" → `16 Oct 2026, 10:14 UTC` in mono (the board is wrong here too; do not copy it).
- DRIFT: "Block satoshi_ghost" is still a bare text row in the message list. Move it into the header More menu (Block / Report) as on Block `view=chat`.
- DRIFT: Evidence shows only "Trade chat". Board: "Your Zelle screenshot" and "Trade chat". The ask card "sarah.v asked you for the unblurred proof. Only she will see it. satoshi_ghost won't." with the primary **"Send unblurred proof to sarah.v"** is missing, so the screen has no primary.
- DRIFT (copy): notice "Chats are encrypted. If a dispute is opened, a moderator can read this conversation." → during a dispute: "A moderator can read this whole chat." Moderator card "They can read" → board "She can read". Composer placeholder "Message" → "Message satoshi_ghost and sarah.v". Header is missing "· Example" after "Zelle".

**59-dispute-ruling** — the 1 Nov STALE finding is fixed.
- OK: "Goes to Cake Wallet, address ending …k3Fz." with no appeal-window delay; "If an appeal overturns the ruling, you get a lien. You can't trade until you pay the XMR back." Appeal window 48 h. Day: the purple reads fine.
- DRIFT: no hero. Board: `--mod` chip "RULING: RELEASE TO THE BUYER", result headline 32/36 "1.250000 XMR goes to you", key mark in `--mod`, moderator stamp in an inner block; then a tinted "Reason" card with the shield tile. Built: one outlined card with a 13px label and a 24px line.
- RULE: "1.25 XMR" → "1.250000 XMR".
- RULE (X7): "47 h 58 min left" is all mono. Digits mono, words body.
- RULE (X5): "Thu 15 Oct, 14:30", "Sat 17 Oct, 14:30", "10:02", "09:40 to 13:55" → `15 Oct 2026, 14:30 UTC` form (the board is also wrong here).
- DRIFT (copy, small): the Reason ends "shows the same payment." Board: "…shows the same payment, sent from an account in mira.k's name."

**61-cantdothat-post-offer**
- OK: the CantDoThat shell matches the board (icon tile, handle, h2 24/30, body, feedback block with the link, 56px orange OK, no X). Title "This offer can't be posted" is 5 words. Day fine.
- RULE (X1, behind the sheet): PostOffer "Sell XMR" and "Market ± %" segments have an orange border. Selected segment = `1px solid var(--ink)` on `--surface-raised` (PostOffer `sideBtn`).

**62-feedback-form** — unchanged since 1 Nov.
- DRIFT (Feedback board): no back header; title is a 16px "Feedback". Board: 44px back, label "Feedback" 13/16 muted, h1 "Tell us what you think" 28/32, body "A complaint, feedback, a recommendation, anything at all. Every message is read.", a card with "YOUR MESSAGE" label and a 9-row textarea with the "0 of 2000 characters" mono counter, "Send anonymously" as a 24px checkbox in a 44px `--surface-raised` row with the hint "Sent with your username, mira.k, so we can follow up if needed.", Send pinned in the footer (disabled until there is text).
- RULE (X4): "What is it?" is a `<fieldset>` with three 13px native radios on one line (hit areas under 44px). The board has no type picker: drop it, or make it three 44px radio rows with `accent-color: var(--ink)`.
- RULE (X3): orange focus ring on the textarea. RULE: the textarea is 2 lines; min-height 96 (board: 9 rows, 240px).
- RULE: the Send button sits in the page flow, not pinned in the footer.

**63-feedback-thanks** — unchanged since 1 Nov.
- DRIFT (Feedback `view=sent`): title is a 16px "Feedback sent" and a long paragraph. Board: h1 "Thank you!" 28/32, "Every message is read." , the line "Sent as mira.k." (or "Sent anonymously."), primary Done, secondary "Write another".

---

## 3. Verdict

**Ship-ready as built** (nothing above a small copy or fixture fix): 03, 06, 07, 08, 10 (LoginApprove v2 pack); 32, 34 (My offers); 61 (CantDoThat shell). 01, 02 and 11 are one copy pass away (missing board sentences, no layout work). 31 needs only the Edit link and the header.

**Not ready:** 04 and 20 (old hold copy, wrong board), 19 (orange checkbox, fieldset, inline form), 25 (empty background), 33 (old popup shell), 54 (across the hinge), 58 and 59 (no hero, 2-decimal XMR, dates), 62 and 63 (Feedback board not used), 31w/32w (phone layout on wide, clipped footnote), 30 (member session counted in the owner's 3).

**Five most important fixes, in order**

1. **Hold and Strong-login copy (X9) and the two missing screens**: replace the 04 body with the two-sentence version and link it to a RecoveryHold screen; replace the 20 popup with TeamRefusal. Every sentence that says "only one way of proving it's you" or treats password + authenticator as enough goes.
2. **One CantDoThat component**: 33 must use the 61 shell (no X, orange 56px OK, icon tile, handle, ≤6-word title). Also 25: keep the previous screen behind the scrim; retitle 20/25.
3. **Finish X1/X3/X4 in the shared parts**: ink accent on all checkboxes and radios (19, 62), ink border on selected chips and segments (26, 61), ink focus ring (62), no `<fieldset>` borders and no native `<select>` (19, 62). These are three CSS rules plus two components.
4. **Dispute room and ruling (58, 59)**: the v2 hero block (chip + key mark + "1.250000 XMR" headline), 6-decimal XMR, `D Mon YYYY, HH:MM UTC` dates, mono digits only in the timer, Block moved to the More menu, the missing "Send unblurred proof to sarah.v" card and the Zelle evidence row.
5. **Wide and fold My offers (31w, 32w, 54)**: the table layout from MyOffers-Wide with the selection bar on top, two 412px panes from Fold-MyOffers with nothing on the hinge, and `padding-bottom` under the pinned footer so the footnote is never clipped (also 34 on phone).

After those: 30's device count and "Can log in" switches, Devices' missing "Stay logged in for" row and the two "How a new device gets in" cards, the Feedback board (62/63), the MyOffers Edit link and empty state (31, 35), the LoginApprove outline-card copy (01) and the 02 second sentence.
