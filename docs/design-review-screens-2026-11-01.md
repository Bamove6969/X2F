# Design review: built screens vs boards, 1 Nov 2026

Reviewer: Claude Design. Input: `docs/design-screens/2026-11-01/` (65 screens, night + day), boards in `design/lead/project/*.dc.html`, `design/CONVENTIONS.md`, the 29 Oct owner decisions, and the 1 Nov brief (`design/brief-1101.md`). Where the two disagree, the 1 Nov brief wins.

I looked at all 65 night shots. I also checked 16 day shots: 01, 06, 11, 14, 27, 34, 36, 43, 47, 53, 55, 57, 58, 59, 60 and 64.

Tags: **DRIFT** (differs from board) · **RULE** (breaks the system) · **STALE** (follows a superseded decision) · **NEEDS_DESIGN** (no board; where to take it) · **SUGGEST** (optional polish).
Token names below are the board tokens (`--ink`, `--monero`, …). "Board" = `design/lead/project/<file>`.

---

## 0. Problems that repeat across many shots (fix once, in shared parts)

These come from shared components, so each one fixes many screens. In the per-shot list they are cited by code (X1–X9) and not repeated.

- **X1 RULE: orange used to show selection.** The selected number tile (06/08), device choice (10), checkboxes (14/17/18/38/43), radio (57), sort and currency chips (27/53), PostOffer segments (26/61) and the active bottom tab "Profile" (31–35/54) all use a `--monero` border, text or fill. Boards use a 2px `--ink` border on `--surface-raised` for selected tiles and chips (LoginApprove `numStyle`, PostOffer `sideBtn`, Main sort chips). Checkboxes use `accent-color: var(--ink)` (BuyerPay `#paid-check`). The 29 Oct Section-B fix already moved selected chips from orange to ink. **Fix:** selected = `border: 2px solid var(--ink); background: var(--surface-raised)`. Checkbox/radio = `accent-color: var(--ink)`. Active tab = `color: var(--ink)` plus a 2px `--ink` top bar. Keep `--monero` for the one primary fill only.
- **X2 DRIFT: the CantDoThat popup is not like the board** (04, 09, 19, 20, 25, 26, 33, 61). The board (CantDoThat.dc.html) has no X close, and **OK is the primary**: 56px, `--monero` fill, `--on-monero` text. Built: an X is added and OK is an outlined button. **Fix:** remove the X (OK and scrim-tap close it), make OK the filled primary, and keep the feedback line as is. Titles stay per code but must be ≤ 6 words and say what happened (see per-shot).
- **X3 RULE: focus ring is orange** (15, 22, 62 and other inputs). Boards use `outline: 2px solid var(--ink); outline-offset: 2px` on `:focus-visible`. **Fix:** change the global input focus style.
- **X4 RULE: unstyled native controls.** `<fieldset>`/`<legend>` show the browser's grooved border (14, 16, 17, 18, 62). Native radios and checkboxes are 13px (62, 64 wallet radios, which also render dark-filled in day). Native `<select>` is used for timeout and activity filter (13, 18). **Fix:** use a 13/16 600 uppercase `--ink-muted` label with no border. Make each control a 24px box inside a ≥44px `<label>` row. Selects match board inputs: 44px, radius 6, `1px solid var(--line)`, `--surface-raised`.
- **X5 RULE: dates and times break CONVENTIONS.** Examples: "Fri 3:00 PM" (04/05/12/13), "30 Oct, 10:03 UTC" with no year (17/18), "27 Oct 2026, 12:00" with no UTC and already in the past (45/48), "Fri 16 Oct, 10:14" and "Thu 15 Oct" (58/59). **Fix:** always `D Mon YYYY, HH:MM UTC` in mono, e.g. `6 Nov 2026, 15:00 UTC`. Fixtures should use dates after 1 Nov 2026 for future deadlines.
- **X6 RULE: invite expiry shows the Unix epoch.** "Invite works until 1 Jan, 00:00 UTC" (16, 17, 23). The fixture clock is at 0. **Fix:** set it to now + 24 h, e.g. `2 Nov 2026, 22:50 UTC`.
- **X7 RULE: mono timer spacing.** "1 h 52 min", "25 min", "1 h 2 min" and "Dispute opens in2 h" are set in Atkinson Mono, which leaves wide gaps around h/min (28, 36, 39, 40, 41, 43, 55, 56). **Fix:** set the unit words in the body font and only the digits in mono (`<span class=mono>1</span> h <span class=mono>52</span> min`), or use the board's `61:48` clock form for counts under 2 h. Fix the missing space in 39.
- **X8 DRIFT: the trade-room "Time to pay" card is centred.** The board (BuyerPay `section[aria-label="Payment timer"]`) is a row: label, mono 28/32 value and note on the left, the 56px ring on the right, `justify-content: space-between`, 16px padding. Built stacks the ring under the text and indents the text to x≈84, off the 16px grid (36, 37, 41, 49, 51, 56). **Fix:** follow the board row.
- **X9 STALE: the hold sentences use the old wording.** "a login with only one way of proving it's you", "an authenticator code set up before the hold" (04, 05, 12, 13, 20). The 1 Nov brief names the tiers **Weak / Strong / Armored vault**. A recovery code always starts a 24 h hold. Logging in with an authenticator alone is not allowed. **Fix (draft copy for the owner):** "You logged in with a Weak login (password only), so changes wait 24 hours, until `6 Nov 2026, 15:00 UTC`. Trades already open can still be finished. Log in with a Strong method you had before the hold to end it now." For a recovery-code login, use the RecoveryHold board text.

---

## 1. New-device approval and the 24 h hold (01–13)

Boards: **LoginApprove.dc.html** (side=new: waiting/approved/blocked; side=existing: ask/choose/approved/blocked; devices: 2 in use / 3 in use / one at a time), **Devices.dc.html**, **RecoveryHold.dc.html**, **BlockQueued.dc.html**. So NEEDS_DESIGN_DEVICES is covered by existing boards.

**Board is stale itself:** LoginApprove side=new says "A security key, a recovery code, or your PGP key plus a passkey gets you in with no wait. An authenticator code starts a 24-hour wait." Under the 1 Nov brief a recovery code **always** starts a 24 h hold, and an authenticator alone is not a login. Draft replacement: "Log in with a backup instead. A security key, a passkey or your PGP key gets you in right away. A recovery code starts a 24-hour hold."

### 01-login-approve-number
- DRIFT: The number is 18px body text. The board shows "YOUR NUMBER" label plus **mono 72/80 500** in a centred `--surface` card (24px 16px padding) with the helper line in 15/22 `--ink-muted`. **Fix:** follow the board.
- DRIFT: The header has no back chevron, and "Log in" is 16px. Board: 44px back link plus h1 24/30 600. The whole flow is boxed in a card, while the board uses a full screen with Cancel in a footer (`border-top: 1px solid var(--surface-raised)`).
- DRIFT: "Where do I approve it?" is centred grey text. Board: a 56px left-aligned `--surface` row in 16px 600 with a chevron that expands three steps.
- DRIFT: The link is the wrong element. Built: "I don't have my other device" is a grey label and "Log in with a backup instead." is the orange link. Board: **"I don't have my other device"** is the link (`--monero-ink`, 600, 44px), followed by the muted explainer listing the no-wait methods, which is missing here. Use the 1 Nov copy above.
- DRIFT: The room note is missing: "You can be logged in on up to 3 devices at once. You're on 2 now, so there's room for this one." The clock icon is missing from the status line. The timer shows "5:00". Board: mono `04:59`.

### 02-login-approve-let-in
- DRIFT: Missing the 32px `--escrow` check icon and the sentence "Chrome, Windows is now one of your devices."

### 03-login-approve-blocked
- DRIFT: Missing the 32px `--danger` shield icon. The board footer link "Log in with a backup" is `--ink-muted` 15px, not orange.
- STALE: The backup methods it leads to must follow the 1 Nov rules (see above).

### 04-login-hold-refused
- X2, X5, X9.
- RULE: The body is 7 sentences (~110 words) in a sheet, against CONVENTIONS "plain, short sentences". **Fix:** keep it to 2 sentences plus a link: "This device can log in after `6 Nov 2026, 15:00 UTC`. Your account is on a 24-hour hold." Add the link "End the hold early" to the RecoveryHold `pick-method` step.
- NEEDS_DESIGN (CANTDOTHAT): CantDoThat covers the shell. The hold state itself is the **RecoveryHold.dc.html** board (countdown, "You're offline to everyone", contacts, end early).

### 05-backup-login-hold-note
- DRIFT/NEEDS_DESIGN: This is a bare paragraph (title 16px, body 14px `--ink-muted`). It should land on **RecoveryHold.dc.html** `step=hold`: "Account on hold" h1, `Hold ends in` countdown with caution bar, "You're offline to everyone", the Matrix/Telegram/Jabber contacts, "End the hold early", and "Changes waiting".
- X5, X9.

### 06-security-approve-ask
- DRIFT: The hierarchy is flipped. Board: label "NEW LOGIN" (13/16 uppercase `--ink-muted`) plus **h2 24/30** "Someone is logging in on Chrome, Windows. Is this you?". Built: title "New login" and the question in body text. An X close is added; the board has none.
- DRIFT: The Device/Time/Where rows sit loose, right-aligned. Board: stacked `<dl>` in a `--surface-raised` box (16px padding, 12px gap). "Where" was shortened. Board copy: "Not shown. X2F doesn't log IP addresses, so we can't show where."
- DRIFT: Number tiles are 48×48 and left-aligned. Board: three equal columns, 72px tall, mono 28/32. RULE X1 on the selected tile.
- DRIFT: "No, block it" is a pink text link. Board: 56px button, `2px solid var(--danger)`, transparent fill, `--danger` text.
- DRIFT: The timer "4:00" should be mono `04:59` in `--ink`. Device name: board "Chrome, Windows", built "Chrome on Windows". Pick one form app-wide.
- Day: OK (contrast fine).

### 07-security-approve-done
- DRIFT: Board h2 "Chrome, Windows is logged in". Then "You can see your devices and log any of them out in **Devices**." with Devices as a link, and a **Done** button. Built: title "New login", the button "OK", and "Settings, Security" as plain text.

### 08-security-approve-at-limit
- DRIFT: Both notes show together, which contradicts itself: with "One device at a time" on, the account can never be at 3 of 3. **Fix:** show only the one-at-a-time note: "One device at a time is on, so letting them in logs this device out." Fix the fixture or the logic.
- DRIFT: The device-limit note copy. Board: "You're logged in on 3 devices, the most allowed. Next you'll choose one to log out."
- X1.

### 09-security-approve-too-many-devices
- DRIFT: The board has no refusal here. "Yes" at the limit goes straight to the **choose** step (shot 10). This popup is a dead end: it says "Choose one to log out", but the only button is OK. **Fix:** remove it and route Yes to the choose step.
- X2.

### 10-security-approve-choose-device
- DRIFT: "Choose a device to log out" is a small label. Board: h2 24/30 under the label "NEW LOGIN · CHROME, WINDOWS". Body copy per board: "You can be logged in on 3 devices at once. To let Chrome, Windows in, one of these has to be logged out."
- DRIFT: Options are centred plain buttons. Board: radio cards, min 64px, `--surface-raised`, a 20px radio dot, the name in 16/600 and a note ("This device · active now" / "Last active 3 days ago"). X1 on the selected one.
- DRIFT: "No, block it" should be the 56px outlined danger button (as in 06).

### 11-security-devices
- DRIFT: Devices is a card inside the long Security page. Board **Devices.dc.html** is its own screen: back link "Back to settings", h1 "Devices". **Fix:** make Security a list that links to Devices.
- DRIFT: Missing pieces: the 3-pill meter next to "LOGGED IN · 2 OF 3", phone/computer icons, the "Last active …" and "Logged in <date>" lines, a real **Log out** button per row (outlined, aria-label "Log out Chrome on Android"; built uses pink text), the **"Log out all other devices"** 56px danger-outlined button, and "Lost your only device? Log in with a backup."
- DRIFT: "One device at a time" is a full-width "Off" button. Board: a `role="switch"` 52×32 track (on: `--escrow` track, `--ground` knob; off: `--surface-raised` + `--line`) beside the label and hint.
- Day: OK.

### 12-security-hold-banner
- DRIFT: The "hold banner" is plain muted text above the page. **Fix:** a banner with `1px solid var(--caution)`, radius 12, 12px padding, an 18px caution icon, a 14/20 sentence, and a link "See the hold" to RecoveryHold. Use the RecoveryHold board countdown style if the screen is the hold home.
- X5, X9.
- DRIFT: The Login methods card shows "Password · Remove" **and** "Set a password", which contradicts itself. "Create recovery code**s**" is plural, but the 1 Nov brief makes one recovery code required for everyone. Copy: "See your recovery code" / "Make a new recovery code".
- STALE: Removing the password must be blocked if it would leave the account with authenticator-only or no login (1 Nov "not allowed" tiers). Show the refusal text "Add at least a password, but we recommend the other options."

### 13-security-held-change
- X5, X9 for the held note.
- STALE/verify: The "Inactivity timeout" select shows "12 hours". The 1 Nov rule is that traders pick **2–12 h idle**, with 24 h absolute. Make sure the options are exactly 2, 4, 6, 8, 10 and 12 hours (no 24 h idle, no 30 days). Add the line "You're always logged out after 24 hours."
- RULE: The Settings list card (Blocked traders / Team) has ~32px of empty space above the first row, and the rows have no chevrons. **Fix:** 16px card padding, 56px rows, a 20px chevron in `--ink-muted`.

---

## 2. Team members (14–30)

Boards: **Team.dc.html** / Team-Wide, **TeamRefusal.dc.html**. NEEDS_DESIGN_TEAM is partly covered.

**Boards are stale (lead to update; reviewer did not edit):** Team.dc.html says "Coming after launch", "Up to 5 members", "2 of 5", "You have 5 members, the most allowed", and has no roles. TeamRefusal says "2 of 5" with roles "Trader / Chat only". **1 Nov:** team at launch, max **3**, roles **Offers / Trades**. The built screens follow 1 Nov (3 members, Offers/Trades), which is right. The boards need a v2 with the role picker, the invite-link sheet and 3-member limits.

### 14-team-owner-invite-form
- DRIFT: There is no back header ("Team" is 16px and sits 16px from the top). Board: back link plus h1 24/30, an intro, then the member list, then sections, then a **primary "Add a member"** at the bottom that opens a sheet. Built puts the invite form inline in the page. **Fix:** move the invite into a sheet (Team board `isName` step plus a role picker).
- RULE: X1 (orange filled checkboxes) and X4 (fieldset border).
- STALE: "Trades: … mark payments sent, **cancel** and open disputes". Since 29 Oct a buyer can only **ask to cancel**, and the seller can only propose. **Fix:** "Trades: take offers, chat, mark payments sent, ask to cancel and open disputes."
- STALE/owner question: "Chat shows it as 'Team <your name> member: <their name>'" goes against the 29 Oct decision "Trade partners see the account username plus 'replied by a team member', never which member." Confirm with the owner. If 29 Oct stands, change the copy to "Trade partners see your username and 'replied by a team member', never this name."
- Owner question: "Releasing or securing coins still happens on your own device" goes against Team board "What members can do: Release XMR from escrow". If the owner-device rule is new, add it to the brief and the board.
- Day: same issues; contrast OK.

### 15-team-owner-invite-confirm
- X3. Otherwise fine.
- SUGGEST: Confirm with a Strong method (passkey/key/PGP), not a password. The weak-session rule (shot 20) already blocks Weak logins, so asking for the password here adds friction without proof.

### 16-team-owner-invite-link
- DRIFT: The link appears inside the invite form, above an emptied form and a disabled "Make an invite link", which is confusing. Board `isLink` sheet: h2 "Send Aurora.K this link", a mono URL box, **Copy link**, then three bullets: "It works once and expires in 24 hours, at <date>." / "Send it privately, for example in an encrypted chat. Anyone who has the link can use it." / "When they open it, they set up their own login with two factors…". Then **Done**.
- X6. The invite row action should be **"Cancel invite"** (board), not "Remove". "Roles" is grey text with a hit area under 44px.

### 17-team-owner-members
- RULE: "Roles" sits at a different x in each row (≈198 / 200 / 282). Use a fixed right-aligned action column. Each action needs a ≥44px outlined small button (board: "Remove" button with aria-label "Remove desk_sam").
- DRIFT: Missing the per-member **switch** "<name> can work trades" (owner 29 Oct: "the owner can switch a member off instantly"), the 40px initial avatar, and the status dot and line ("Logged in · active 4 min ago" / "Switched off" in `--danger`).
- DRIFT: At 3 of 3 the invite form is still live. Board pattern: disable "Add a member" and show "You have 3 members, the most allowed. Remove one to add another." (update the board number from 5 to 3).
- X5, X6.

### 18-team-owner-activity-log
- X4, X5. Content fine. SUGGEST: the board has the log behind an "Activity log" link. A separate screen keeps the Team page short.

### 19-team-refused-too-many-members
- DRIFT: The board never lets you get here. With 3 members the button is disabled and the note is shown (see 17). Keep the popup only as a server fallback. The title "This can't be done on the team" is awkward. **Fix:** "Your team is full". X2.

### 20-team-refused-weak-session
- DRIFT: The board **TeamRefusal.dc.html** exists and isn't used. It has a page banner "This device's login is Weak / You logged in here with a password only. Team changes need a Strong login." plus a sheet: label "NEEDS A STRONG LOGIN", h2 "You can't invite members from this device", the Weak → Strong → Armored vault ladder ("This device" / "Needed" / "Also works"), primary **"Add another way to log in"** and secondary "Not now".
- STALE: X9 ("only one way of proving it's you").

### 21-team-join-invite
- RULE: The "Your PGP public key" textarea is one line (44px). **Fix:** min-height 160px, mono 14/20, `spellcheck=false`.
- SUGGEST: The button "Send me a message" is vague. Use "Send me a code to decrypt". There is no back or close. Add a header close that goes to Log in.

### 22-team-join-pgp-code
- RULE: The code input has no visible label. Add "Code from the message" (13/16 label). X3.
- SUGGEST: Rename the secondary "Send me a message" to "Send a new message".

### 23-team-join-second-way
- X6 ("Finish before 1 Jan, 00:00 UTC").

### 24-team-join-invite-gone
- DRIFT/NEEDS_DESIGN: Dead end: one muted line, no icon, no action. **Fix:** a 32px `--danger` link-off icon, h2 "This invite link doesn't work", the body "It was already used, it ran out after 24 hours, or it was copied only in part. Ask the account owner for a new one.", and a secondary "Go to log in".

### 25-team-member-owner-only
- DRIFT: The screen behind is empty black (the popup sits on nothing). **Fix:** keep the previous screen behind it and return there on OK. Title: "Only the owner can do this". X2.
- SUGGEST: Hide Wallets from the member's tab bar instead of refusing after the tap.

### 26-team-member-role-refused
- DRIFT: A Trades-only member can open PostOffer and only gets refused on submit. **Fix:** hide or disable "Post offer" for members without Offers. If it's opened anyway, refuse on entry.
- Copy (draft): "Your role is Trades. Posting offers needs the Offers role. Ask the account owner to add it."
- X1 (PostOffer segments behind: board `sideBtn` selected = `1px solid var(--ink)` + `--surface-raised`). X2.

### 27-team-member-offer-taken-notice
- Notice fine.
- DRIFT on the Main screen behind: currency is shown as a chip row, but board **Main.dc.html** uses a currency `<select>` beside the search. The **"Site news" bell with teal dot** beside the X2F logo is missing (owner 29 Oct). X1 on the selected USD and "Most buyers" chips (confirmed in day).

### 28-team-member-trade-waiting
- DRIFT: "Waiting for mira.k to pay" contradicts the line below ("Waiting for the account owner's device. It sets up, secures…"). The buyer can't pay before the escrow is secured. **Fix:** title "Waiting for the owner's device", body "It secures the XMR. Then mira.k can pay."
- RULE: X7 ("25 min"). "Propose cancel" is a bare left text label in the footer. Board footer actions are 44px text buttons in `--ink-muted`; make it a real button.
- NEEDS_DESIGN (TEAM, TradeRoom): No board. Base it on BuyerPay/SellerConfirm with an info banner "You're working this trade for <account>. Securing and releasing happen on the owner's device."

### 29-team-member-trade-cancel-proposed
- Fine. SUGGEST: make "Withdraw" a 44px outlined small button so it reads as an action.

### 30-team-owner-devices-member-session
- DRIFT: Same Devices drift as 11.
- Owner question: the member's session is counted in the owner's "2 of 3" devices. Members have their own limit (at most 3 logged in at once, Team board). **Fix:** list member sessions in a separate group "Team member sessions · 1 of 3", each with "Log out", and leave them out of the owner's device count.

---

## 3. My offers (31–35, 54)

Board: **MyOffers.dc.html** / MyOffers-Wide. NEEDS_DESIGN_MYOFFERS is **covered**.

### 31-myoffers-list
- DRIFT: The On/Off control is an outlined text button. Board: `role="switch"` 52×32 (on: `--ink` track, `--ground` knob; off: `--surface-raised` + `--line`, `--ink-muted` knob).
- DRIFT: The tick boxes are 34×48 rounded rectangles. Board: a 24px checkbox inside a 44px label. "Select all" is a button. Board: a tri-state checkbox plus "Select all" and the hint line.
- RULE: The text column starts at x=86 / 101 / 86. **Fix:** a fixed grid of checkbox 44 | content | switch 52, with 16px gaps.
- DRIFT: The status line is 16/600, louder than the title. Board: 13px 600, `--ink` when on and `--ink-muted` when off. An off card should be transparent with `1px dashed var(--line)`, an on card `--surface`. The per-offer **Edit** link is missing. The footnote is missing "You can have 2 offers per side (buying or selling) for each currency."
- X1 (active tab).

### 32-myoffers-selected-bar
- RULE: The selection bar sits in the page flow, and the orange "Post an offer" is cut off behind the tab bar. **Fix:** a sticky bar above the tab bar ("2 selected · Clear · Turn on · Turn off", 56px, `--surface`, `border-top: 1px solid var(--surface-raised)`) that replaces "Post an offer" while a selection exists. Selected cards get `box-shadow: inset 0 0 0 2px var(--ink)`. "Clear" needs ≥44px.

### 33-myoffers-hold-refused
- DRIFT: The summary contradicts the popup. It says "2 offers turned on. 1 offer stayed as they were…" (also ungrammatical), while the popup says "your offers stay off". It is also in `--danger` for an information message.
- Copy (draft): "Trading hold: no offers were turned on. They stay hidden until the dispute is resolved." Show it in a `--caution` banner. X2.

### 34-myoffers-hold-summary
- DRIFT: The rows mix "On, hidden while your account has a trading hold" and "Stayed off: …". The header still says "2 of 3 offers on". **Fix:** during a hold the header reads "Trading hold · all offers hidden", and each row status reads "Hidden · trading hold" (13px `--caution`). Day: the danger summary reads as an error; use caution.

### 35-myoffers-empty
- RULE: The tab bar floats mid-screen right under the button. Pin it to the bottom.
- DRIFT: "0 of 0 offers on" should be hidden. Empty state: a 32px icon, h2 "No offers yet", "Post an offer to buy or sell XMR. You can have 2 per side for each currency.", and the primary "Post an offer".

### 54-fold-884-myoffers
- RULE: A single 448px column is centred **across the hinge** (x≈442). Owner: "Nothing goes across the hinge." The tab bar is not pinned (empty band below).
- NEEDS_DESIGN (MYOFFERS fold): Not on a board. Proposal: list in the left pane (the 390 layout), and the selected offer's summary plus Edit (FlexOffer-Post) in the right pane. Below 600px wide, use the phone layout in one pane. All 31 issues also apply.

---

## 4. Trade room (36–50)

Boards: **BuyerPay**, **Warn-IvePaid**, **Warn-Release**, **SellerConfirm**, **Refunded**, **Review**, **Block**, **Fold-Trade**.

**Boards are stale or lack parity (lead):** Warn-IvePaid's background still says "Cancel trade", and its "I've already paid" marks the trade paid in one step. It should open the "Mark this trade as paid?" sheet. BuyerPay, SellerConfirm, Review, Main, PostOffer, DisputeOpen/Room/Ruling have **no theme tweak and use raw hex** (night only), against CONVENTIONS. SellerConfirm, DisputeOpen and DisputeRuling say "1.25 XMR". CONVENTIONS says 6 decimals ("1.250000 XMR"); the built screens are right where they use 6 decimals.

### 36-trade-buyer-pay-securing
- STALE: "Cancel trade" should be **"Ask to cancel"** (owner 29 Oct; BuyerPay footer). Same in 51.
- X8, X7. Day: fine.

### 37-trade-pay-warning
- Matches Warn-IvePaid. An X close is added (board has none; drop it or keep it consistently).
- STALE check: "I've already paid" must open the two-step sheet (38), not mark the trade paid.

### 38-trade-paid-confirm-sheet
- Copy matches the owner. X1: the checkbox should use `accent-color: var(--ink)`.
- DRIFT: "Not yet" is text. Board: a 48px outlined button (`1px solid var(--line)`).

### 39-trade-marked-paid
- RULE: "Dispute opens in2 h" (X7) should be "Dispute opens in 2 h".
- DRIFT/NEEDS_DESIGN: After paying, the main element is still "Send exactly", plus a disabled "Marked as paid" button. **Fix:** a status card at the top: check icon in `--escrow`, "You marked this as paid", "satoshi_ghost has up to 2 h to check and release." (the Fold-Tabletop `paid` state is the reference). Collapse the payment details under it. Drop the disabled button.

### 40-trade-seller-proposed-cancel
- SUGGEST: "Chat" is the orange primary here because the header lost its Chat link. Put Chat back in the header (as on every room board) and leave no primary while waiting. X7 ("1 h 2 min").

### 41-trade-buyer-cancel-proposal
- X8.
- Copy (draft, a safety line): "satoshi_ghost asked to cancel. If you agree, the XMR goes back to them and the trade ends. **Don't agree if you've already paid.**" Accept is outlined and Decline is text, which is fine. Make Decline ≥44px.

### 42-trade-release-warning
- Matches Warn-Release. An X close is added. Fine.

### 43-trade-seller-confirm
- DRIFT: Missing the SellerConfirm card "We checked mira.k's screenshot" (Shows $412.50, the right amount / Note says K7M2-…, this trade's code / Sender name hidden by mira.k), shown when proof exists. Missing the board's hint "Look for a $412.50 payment with the note K7M2-9QXA-4FTR-8WPN in your bank."
- X1 (checkbox), X7. Day: orange checkbox with a white tick is ~3:1. Using ink fixes it.

### 44-trade-seller-cancel-returning
- STALE: "mira.k cancelled before paying" sounds like the old "buyer cancels alone" rule. Since 29 Oct, after funding the buyer can only ask, and the seller agrees. If this is the before-secured walk-away (allowed for both sides), say so.
- Draft copy: "mira.k cancelled before the escrow was secured. When it reaches 10 confirmations, tap Confirm cancel to send the 1.250000 XMR back to you."
- DRIFT: Use the BuyerPay confirmations bar (6px track, `--escrow` fill, mono "4 of 10") instead of the text line. Cut the empty space in the card.
- NEEDS_DESIGN: No board. Build it from the Refunded board layout (chip, h1, lead, "What happened" timeline) plus the BuyerPay bar.

### 45-trade-seller-cancel-confirm
- DRIFT: The body still says "once it has all its confirmations" and shows **4 of 10** while Confirm is enabled. Update to 10 of 10 and "All 10 confirmations are in."
- X5: "27 Oct 2026, 12:00" is in the past and has no UTC. Use `3 Nov 2026, 12:00 UTC`.

### 46-trade-seller-cancel-done
- SUGGEST: Chip "Cancelled together" (Refunded board). Add the amount "1.250000 XMR is back at your refund address", and the footer links "Find another offer" / "Back to my trades" (Refunded board).

### 47-trade-released-buyer
- Top half matches Review. The rating card and "How's X2F doing?" are missing (known: Plan 5).
- RULE: No exit (no back, no Done). Until ratings ship, add "Back to my trades" (secondary, 48px). Day OK.

### 48-trade-buyer-refunded
- DRIFT: The board is **Refunded.dc.html** `variant=time-ran-out`. Built is bare text. Missing:
  - chip "Payment time ran out" (built: "REFUNDED" with a check in `--escrow`, which reads as success);
  - lead with "1.250000 XMR (about $412.50)" and the seller's name instead of "the original owner";
  - a "What happened" timeline card with UTC times;
  - a `<dl>` with Trade amount and "Charged to you: Nothing";
  - a dispute card "Did you send the money anyway?" with an outlined danger "Open dispute" (built: a centred pink text link);
  - footer "Find another offer" / "Back to my trades".
- X5. The fixture header "Buying from mira.k" is wrong: mira.k is the buyer in the other shots. Use satoshi_ghost.

### 49-trade-chat-sheet
- DRIFT: "Block satoshi_ghost" is a bare text row between the notice and the messages, where it's easy to hit by mistake. Board **Block.dc.html** `view=chat` puts it in a header **More** menu (`aria-haspopup="menu"`: Block / Report). X7 behind.
- SUGGEST: Add the retention line from the owner (29 Oct): "Chats are deleted 30 days after the trade ends."

### 50-trade-chat-other-device
- DRIFT: Read-only shows no messages at all. **Fix:** show the history read-only and, in place of the composer, "This chat is open on Pixel 8. Reply from there." Move "Block" into More as in 49.

---

## 5. Foldables (51–56)

Boards: **Fold-Trade**, **Fold-Offers**, **Fold-Cover**, **Fold-Tabletop**, Fold-Notes. NEEDS_DESIGN_FOLD_GLANCE is **covered** by Fold-Cover and Fold-Tabletop.

### 51-fold-884-trade-room
- STALE: "Cancel trade" should be "Ask to cancel" (Fold-Trade has it, with the sheet "Ask nightowl_44 to cancel?").
- DRIFT: The chat pane is a short card ending under 2 messages. Fold-Trade: a full-height pane with the header "Online · 212 trades · 99% positive · Trusted", the messages scrolling, and the composer pinned at the bottom. The **Send button touches the right screen edge** (no 16px gutter, RULE).
- DRIFT: Missing the Fold-Trade "Trade progress" stepper (Escrow funded · You pay · seller confirms · XMR released) and the timer line "of 90 min · ends 31 Oct 2026, 14:05 UTC". X8.

### 52-fold-884-trade-seller-confirm
- Same chat-pane issues as 51 (pane height, Send at the edge). Left pane: as 43.

### 53-fold-884-offers-list
- RULE: A single list runs full width **across the hinge**.
- DRIFT: Fold-Offers has two panes: the offer list on the left (each row `aria-pressed`) and the selected offer's quote on the right (You pay / You receive / wallet / rate / **Trade**).
- X1 ("Best price" chip, confirmed in day). Four "Trade/Message" buttons per list get noisy. In two-pane mode the list rows are selectable, and only the quote pane has the one orange **Trade**.

### 55-fold-cover-trade-card
- DRIFT: Fold-Cover shows:
  - top line "X2F · +2 more trades" (owner decision);
  - a status chip ("PAY NOW", `--caution`);
  - the amount in mono 28/32;
  - XMR in mono `--ink-muted`;
  - timer and note ("62 min left" / "Send by Zelle, then tap I've paid");
  - the button "Open on main screen";
  - "Open your phone to keep going."

  Built is missing the chip, "+N more", the note and the button. The phone room header **bleeds in under the card**, cut off at 380px (RULE overflow). Day: same.

### 56-fold-tabletop-trade
- DRIFT/RULE: The top half shows only title, amount and time, with a large empty band. The bottom half repeats the phone room (header and "Time to pay" a second time), and **"I've paid" is off-screen**. Fold-Tabletop: the top half is the status chip, the big timer, "Send exactly $412.50", To / Memo, and "Copy memo". The bottom half is "Add payment proof", **I've paid**, Ask to cancel / Open dispute, and the chat. No duplication.
- RULE: The composer has an unlabelled bell icon button. Add `aria-label` or remove it (no board element).

---

## 6. Disputes (57–59)

Boards: **DisputeOpen**, **DisputeRoom**, **DisputeRuling**.

### 57-dispute-open
- Close to the board. X1 (selected radio card: orange border and dot; board radio uses ink). "1.25 XMR" should be "1.250000 XMR" (CONVENTIONS). Day: same.

### 58-dispute-room
- DRIFT: The shot shows the error "Couldn't open the chat. Check your connection and try again." The real room isn't visible: no moderator message, no "Send unblurred proof to sarah.v", no composer. **Reshoot** with a working chat fixture.
- DRIFT: The "Evidence in this dispute" list is missing "Your Zelle screenshot" and "Unblurred copy · moderator only". The notice says "If a dispute is opened…" while in a dispute. Use "A moderator can read this whole chat."
- RULE: The moderator purple (`#b69cff`, from the board) has no token and no day value. Built day uses a darker purple, which is fine but ad hoc. **Fix:** add `--staff` to the THEMES (night `#b69cff`, day `#5b3fc4`) and use it on both boards and app. X5 ("Fri 16 Oct, 10:14").

### 59-dispute-ruling
- STALE: "To Cake Wallet…, **once the appeal window closes**" and "If nobody appeals, the XMR is released when the window closes" are wrong. Owner 29 Oct: coins move as soon as the ruling is made, and if an appeal overturns it, the receiver gets a lien. Board copy: "Sent to Cake Wallet, address ending …k3Fz". Appeal note: "The XMR has already moved; if they overturn the ruling, the other trader gets a lien until they pay it back."
- RULE: `--staff` token as in 58. X5, X7 ("47 h 58 min"). 48 h is correct.

---

## 7. News, feedback, CantDoThat, block (60–65)

Boards: **News**, **CantDoThat**, **Feedback**, **Block** (all with -Wide). NEEDS_DESIGN_NEWS / CANTDOTHAT / BLOCK are **covered**.

### 60-news
- DRIFT (News.dc.html):
  - header close X ("Close News"), h1 "News", "3 new · 4 posts" and **Mark all as read**, label "NEWEST FIRST";
  - posts are **collapsible**, and a new post is marked by `box-shadow: inset 3px 0 0 var(--escrow)` on `--surface`, not an outlined "NEW" pill;
  - seen posts have the "Read" label and a transparent card with a `--surface-raised` border;
  - post titles 18/24, not 24.
- X5 (dates without UTC).
- Copy: "Trades in escrow are safe" should be the owner's maintenance rule: "Payment timers pause while we're down, so no trade runs out of time." When logged in, add the `with-dont-show-again` variant ("Don't show me this again" plus the owner's note about the Site news bell).

### 61-cantdothat-post-offer
- X2. X1 behind (PostOffer segments). Title "This offer can't be posted" is fine as COPY-UNSIGNED.

### 62-feedback-form
- DRIFT (Feedback.dc.html `view=form`): back link plus "Feedback" label, h1 "Tell us what you think", body "A complaint, feedback, a recommendation, anything at all. Every message is read.", **9-row textarea** with a counter (built: 2 lines), "Send anonymously" as a 24px checkbox in a 44px row with the hint.
- RULE: The added "What is it?" radio group is native 13px radios crammed on one line with a fieldset border (X4, hit areas < 44). Either drop it (the board has none) or use three 44px radio rows. X3.

### 63-feedback-thanks
- DRIFT (Feedback `view=sent`): h1 "Thank you!" (built: a 16px "Feedback sent" title). Missing the line "Sent as mira.k." / "Sent anonymously." and the secondary "Write another".

### 64-block-ask-on-quote
- DRIFT (Block.dc.html confirm sheet): The block confirm is inline, unstyled text at the bottom of the quote. The two buttons are run together ("Block satoshi_ghostCancel", RULE: no spacing, hit areas < 44). Board: a sheet with h2 "Block nightowl_44?", the list, "They won't be told…", "Open trades with them aren't affected…", "You can unblock them any time…", then a 56px **danger-outlined "Block nightowl_44"** and an outlined Cancel.
- STALE/copy: "while they're signed in" isn't in the board or the owner decision (blocking is silent and permanent until undone). Remove it.
- RULE: "XMR" next to the amount is `--monero-ink` text, which is orange used for a non-action. Use `--ink-muted`. The wallet radios render as dark native squares in day (X4).

### 65-blocked-traders
- DRIFT: The back link "Settings" is missing. The copy differs from the board. Board: "To block someone, open their profile or your trade chat with them and tap More." Built: "This applies while they're signed in. To block someone, open one of their offers and tap Block." Remove "while they're signed in" (as in 64). The entry points should match the board (profile and chat More menu, plus the quote as built).

---

## 8. Summary

### Counts (each tagged finding in sections 0–7)

The nine cross-cutting X items each count once, even though they show on many shots. A finding with two tags (e.g. DRIFT/NEEDS_DESIGN) counts under both. "Copy (draft)" lines are fixes, not separate findings.

| Category | Count |
|---|---|
| DRIFT | 67 |
| RULE | 35 |
| STALE | 14 |
| NEEDS_DESIGN | 7 |
| SUGGEST | 9 |
| Owner questions (not tagged) | 3 |

NEEDS_DESIGN markers that already have a board: DEVICES (LoginApprove, Devices, RecoveryHold), CANTDOTHAT (CantDoThat), TEAM (Team, TeamRefusal, but those boards are stale), MYOFFERS (MyOffers), FOLD_GLANCE (Fold-Cover, Fold-Tabletop), NEWS (News), BLOCK (Block).

Still with no board:
- the team member trade room (28);
- the invite-gone page (24);
- the seller cancel-return flow (44–46);
- the after-I've-paid buyer state (39);
- MyOffers on a fold (54);
- Team v2 (3 members, Offers/Trades roles, invite-link sheet).

### Top 10 fixes, in priority order

1. **Fix the trade cancel wording and rules everywhere** (36, 51 "Cancel trade" → "Ask to cancel"; 14 role text "cancel" → "ask to cancel"; 44–46 "mira.k cancelled" → the mutual/pre-secure wording). Also fix the Warn-IvePaid board so "I've already paid" opens the two-step sheet.
2. **Fix the dispute ruling text** (59): coins move at once, there is no hold until the appeal window closes, and an overturned ruling creates a lien. Reshoot 58 with a working chat.
3. **Bring the hold and login copy in line with 1 Nov** (X9: Weak/Strong/Armored vault; recovery code is always a 24 h hold; no authenticator-only login). Point 04/05/12 at the **RecoveryHold** board. Update the LoginApprove board's backup line. Check the 2–12 h idle-timeout options (13).
4. **Use TeamRefusal for 20**, and make the boards match 1 Nov (Team/TeamRefusal: 3 members, Offers/Trades). Settle with the owner the member-name-in-chat question (14) and whether release stays on the owner's device.
5. **Stop using orange for selection** (X1) in tiles, checkboxes, radios, chips and the active tab: a 2px `--ink` border with `--surface-raised`, and `accent-color: var(--ink)`.
6. **Make the CantDoThat shell match the board** (X2): no X, OK as the filled primary. Remove the dead-end popups (09: go to the device chooser; 19: disable invite at 3/3; 26: hide Post offer for Trades-only members).
7. **Foldables: nothing across the hinge** (53, 54 two panes per Fold-Offers). Fix 56 tabletop so "I've paid" is in the bottom half and the top half shows the glance info. Fix 55 cover to match Fold-Cover ("+2 more trades", status chip, "Open on main screen", no bleed). Give the 51/52 chat a full-height pane with the Send gutter.
8. **Rebuild MyOffers to the board** (31–35): real switches, 24px checkboxes, an aligned grid, a sticky selection bar, the tab bar pinned to the bottom, and a non-contradictory hold summary in `--caution`.
9. **Rebuild the new-device approval screens to LoginApprove** (01, 06, 10): number in mono 72, 72px number tiles, h2 hierarchy, `<dl>` box, danger-outlined "No, block it", radio-card device chooser. Make Devices its own screen with the switch, meter and "Log out all other devices" (11, 30).
10. **Fill in the thin result screens from their boards**: Refunded (48, full time-ran-out variant), Block confirm sheet (64, spaced buttons, drop "while they're signed in"), Feedback (62/63), News (60), the after-I've-paid status (39), and the X5/X6/X7 date, epoch and mono-timer fixes.
