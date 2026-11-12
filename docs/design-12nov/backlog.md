# Backlog boards, 12 Nov (worker T6)

This answers the brief's backlog items for appeals, completed trades, staff, staff pay, sync, bans and the proof editor. Wording for teams, appeals, sync and bans comes from `docs/wording/*.md` where it is settled. Every new or changed string here is **COPY-UNSIGNED** until the owner reads it. Labels have no colons, there is no email anywhere, and contact goes through Matrix or Telegram.

Boards live in `S/canvas/project/`. Existing boards were backed up to `S/bak-w13-backlog/`. canvas.json is untouched: the head designer places the new boards (see the end of this file).

Tokens are always `--x2f-*` (board names: `--ink`, `--surface`, ...). Sizes are px. Mono means Atkinson Hyperlegible Mono.

---

## 1. Appeals: READY

**Boards:** Refunded and Refunded-Wide (new `appeal` tweak, shown with variant=moderator), plus Appeal-Notice and Appeal-Notice-Wide (open line).

**File appeal below the trade screen** (D-005; the build's FileAppeal.tsx slot in TradeRoom). It sits under the ruling card and above the footer actions.
- Line, 15/22 on the phone and 16/24 on wide: "Don't agree with the moderator's decision? You can appeal until 31 Oct 2026, 14:05 UTC." The time is in mono.
- Button: "File appeal". It is a 48 px outline button (1 px `--line`, radius 12, 16/600): full width on the phone, 160 min on wide. It opens the dispute page's appeal form (Appeal-Notice, writing).
- The button goes at the deadline. The build already re-renders on time.

**The two waiting lines** (lead-appeals DisputeRuling, D-011). The card is a surface card, radius 16, padding 16 20, with a 40 px caution clock tile and `role=status`.
- The filer sees: "Your appeal is waiting for an independent reviewer."
- The other trader sees: "The appeal is waiting for an independent reviewer."
- Under either line, 14/20 muted: "A senior moderator or the owner who hasn't seen this case will look at it. You'll get an alert when it's decided."
- Link: "See the appeal" (44 px tap area). It opens Appeal-Notice.

**Closed state:** "The appeal window closed on 31 Oct 2026, 14:05 UTC. This ruling is final." This follows w11-88.

**Ruling card link:** it now reads "Read the full ruling". It used to read "Read the ruling and appeal".

**Appeal-Notice open line:** it now reads "Don't agree with the moderator's decision? You can appeal until 31 Oct 2026, 14:05 UTC." The "47 h 40 min left" chip stays. Its filed and waiting steps already had "Waiting for an independent reviewer".

**Board fix:** the notes column on Refunded-Wide was squeezed into the flex row and could not be seen. The root now wraps, so the notes sit under the screen.

## 2. Completed-trades list (My trades): READY

**Boards:** MyTrades and MyTrades-Wide, with a new `tab` tweak (open, completed).
- **Tabs:** "Open 3" and "Completed 1,284", matching the build's `?tab=completed`. They sit under the stat tiles as a 2-up segment.
  - Each tab is 44 high, radius 10, inside a radius 14 `--surface` tray with 4 px padding.
  - The selected tab has a 2 px `--ink` border, `--surface-raised` and weight 600. The other tab is muted.
  - Counts are in mono. The control uses `role=tablist`.
  - On wide the segment is 360 wide.
- **Headings:** "Open trades" and "Completed trades". The stat tile now reads "open".
- **Completed tab:** every ended trade, newest first: completed, refunded, cancelled, expired and decided disputes. "Show more" is a 48 px outline button, full width on the phone and 240 on wide.
- **D-005 row:** the decided-dispute row keeps "You can appeal until 8 Nov 2026, 14:05 UTC" with **File appeal** until the 48 hours end. After that it shows "The 48 hours to appeal ended on …".
- **Tab bar:** the phone keeps the bottom tab bar on /trades, with Trade selected. This answers the lead's D-005 question: yes, show it.

## 3. Staff: READY

**StaffList (owner):**
- **Reset security:** a 44 px quiet text button with a 16 px key icon, shown under Switch off on every active member's row.
  - It opens a danger confirm with the title "Reset dmitri_k's security?" and the body "Do this only after you've checked it's really them, for example on a call. Their passkeys, security keys, PGP keys and known devices stop working at once, and they're logged out everywhere. Their open cases go back to the queue. Their names, role, login hours and signed Terms stay."
  - Its buttons are "Tap key and reset" (danger, one tap, intent `reset-staff-security`) and "Cancel".
- **After the reset:** a `--mod` panel titled "Reset link for dmitri_k" with the line "Their old keys are gone. Send them this link privately. It works once and ends in 24 h. They add new keys, then log in as before." It also has the link field, "Copy link" and "See the reset page". The row's status becomes "Reset sent" with a caution dot.
- **Invite lines (D-070):**
  - Moderators and seniors: "They set up a PGP key and a passkey. A security key, such as a YubiKey, is optional."
  - Helpers: "They set up two keys: a security key or passkey and a PGP key, or two PGP keys."
  - The old "a new device asks for two of their three" is dropped, because the login rule for a moderator with no key is still the lead's to confirm.
- Tweak: confirm = none, remove, reset or reset-link.

**StaffInvite (new board, solo page, 1280).** The logo and screen name sit top-left. Tweaks: link (invite, reset) and step (keys, done).
- **Moderator invite card (new method rule):** one card, "3. Your login keys", on a `--mod` 6 % tint with a 40 % border. Its line is the build's own: "Moderators log in with a passkey and a PGP key. A hardware security key, such as a YubiKey, is optional." It has three 72 px rows:
  - PGP key: **Required** tag (`--mod`).
  - Passkey: **Required** tag. Note: "On your phone or computer, not on the security key."
  - Security key: **Optional** tag (neutral). Note: "Lets you approve rulings with a tap."
  - An added row shows "Added" with an escrow tick.
  - "Finish" is 56 px. It stays inactive (aria-disabled, `--surface-raised`) until PGP and passkey are both added, with the hint "Add a PGP key and a passkey to finish." Once they are added, the hint reads "You can add a security key later in Settings."
- **Reset page (D-032):**
  - Screen name "Reset your login". h1 "Set up your login again".
  - Sub: "The owner reset your login. Add new keys to get back in. Your names, role, login hours and signed Terms stay as they were."
  - Caution box: "Your old keys no longer work" / "Your passkeys, security keys and PGP keys were removed and you were logged out everywhere. Your open cases went back to the queue."
  - There are no Terms or names steps. The card title is "Your login keys", with no step number.
  - Done: "Your login is set up again", the key check code and "Log in".
  - It **never** says "You're invited as Moderator". The invite keeps w11-19.
- **Both:** a line "This … link works once. It ends on 13 Nov 2026, 14:05 UTC." and a "Help with keys" list with three links, so the page is not bare.

## 4. Staff pay: READY

**StaffMyPay (new, 1280, moderator rail).** Tweak: sheet (none, pay, owed, no-price, add).
- **Rail:** the item "My pay". The rail foot shows "On shift since 09:02 UTC", a primary **Clock out** button and "Clock out at the end of your shift to be paid. Logging out or closing the app doesn't pay."
- **Page:**
  - h1 "My pay" / "You're paid in XMR when you clock out. Closing the app doesn't clock you out."
  - Three tiles: "Not paid yet", "Paid in November" and "Your rate".
  - **Not paid yet:** a table of Case, What, When and Amount. A clawback row is in `--danger` with a minus: "Taken back: your ruling was overturned on appeal". Clock out sits in the card head.
  - **Payouts:** each row has a status chip, "Waiting to send" (caution) or "Sent" (escrow).
  - **Shifts:** the How column reads "Clocked out, paid", "Logged out, not paid" or "Logged out automatically. Not a clock-out: that pay waited."
  - **Payout addresses:** up to 5, shown in mono, with "Remove" and "Add an address".
- **Clock-out sheet:** a centred dialog 520 wide, radius 16, padding 28, title "Clock out" (Familjen 24/30).
  - **pay:**
    - The item lines: "3 disputes completed since your last paid clock-out" (escrow tick) and "1 taken back after a ruling was overturned on appeal" (danger x).
    - A total box: "You've earned" then "0.024200 XMR" in mono 32/40, with "$8.00 at today's price" under it.
    - The thank-you in Familjen 20/26: "Thank you. We couldn't do it without you."
    - "Send it to": radio cards, min 56 px. The newest address is chosen: 2 px `--ink` border and a filled dot. Below them is "+ Another address".
    - The primary button is 56 px: "Send my pay and clock out". Under it, quiet "Not yet".
    - Foot line: "Clocking out logs you out. The total holds for 5 minutes; after that it's worked out again."
  - **owed:** a caution box with "Nothing is paid this time" / "Rulings overturned on appeal took back more than you earned since. The rest, 0.012100 XMR, comes off your next pay." Then "Thank you for your time today." and a primary "Clock out".
  - **no-price:** a caution box with "Your pay waits for your next clock-out" / "The XMR price isn't available just now. Nothing is lost: everything here is paid next time." Then a primary "Clock out".
  - **add:** "Add a payout address". Paste field "Monero address", then "Approve 83bH9K…tR7mVq with your passkey or security key." and the button "Approve and add" / "Back".
  - **Motion:** the scrim fades in over 150 ms. The dialog rises 8 px and fades in over 200 ms, ease-out. With reduced motion there is no rise.
  - These words tighten ClockOut.tsx: the colon thank-you becomes two sentences, and "decisions overruled" becomes "rulings overturned". The build's faults ("Your pay could not be worked out just now. Try again.", the 5-minute re-quote lines) are kept.

**StaffPaySetup (new, 1280, owner rail with Settings selected).** Tweak: rates (set, unset).
- **Pay rates:** "Moderator, per case" / "Senior moderator, per case" (USD in XMR), "Large trade from" (USD), and "Senior moderator's share of a large trade's fee" (% of the 1% X2F fee). The example is "10% of the fee on a $4,000 trade is $4.00."
  - Fields are 48 high, in mono and right-aligned.
  - Save button: "Tap key and save". Beside it: "New rates count from the next case completed. Every change is in the activity log."
  - unset: a caution box "No pay rates yet" / "Staff can't be paid for their cases until you set these."
- **Who is owed:** each member's unpaid net and status chip ("On shift", "Owes, left 3 Nov" in danger).
- A link "Fee wallet and payroll settings" goes to StaffSettings.

**D-046 (first staff login):** StaffLogin [stage welcome] has it. I brought it in line with settled-register-calls:
- The card title is now "You're a moderator". It was "Your role: Moderator".
- The hours line now reads "Your login hours are Mon–Fri, 09:00–17:00 UTC."
- Card 3 adds "If you leave before then, you still owe it."

## 5. Sync before acting: READY

**Boards:** BuyerPaidWaiting and BuyerPaidWaiting-Wide, with a new `sync` tweak (off, updating, stale). The words are the build's own (SyncGate.tsx).
- **updating:** "Updating…" with an 18 px spinner (one turn per 900 ms, linear).
  - It sits under the trade header on the phone and above the deal strip on wide.
  - Style: `--surface-raised`, 1 px `--line`, radius 12, min 44 high, 15/20 `--ink-muted`, `role=status`.
  - The screen stays readable and links still work. Buttons are held (aria-disabled, cursor progress).
  - No banner shows for a sync under 400 ms (design ask, so a quick sync doesn't flash).
- **stale:** "Couldn't update just now. What you see may be out of date." with a 44 px pill "Try again".
  - Style: a 1 px `--caution` border, an 8 % caution tint, a triangle icon and `role=alert`. Buttons work again.
- **Motion:** the banner fades in over 150 ms and leaves when a sync succeeds.
- The same banner goes on every gated screen: the trade room and its dispute, Post offer, offers and quote, and My offers.

## 6. Bans: READY

**Ban-Notice and Ban-Notice-Wide** (site and trade ban) now follow the AccountFrozen layout. The logo and screen name sit top-left: "Account banned" for a site ban, "Trade ban" for a trade ban. The D-020 words are unchanged. "Reason" now shows only the general text (w11-102, `BAN_REASON_TEXT`): "Breaking the Terms of Service", "Problems in trades", "Abuse of other traders" or "Account security". New tweak: `reason`.

**Trade-ban popup:** CantDoThat and CantDoThat-Wide, with a new tweak `example` = trade-ban.
- Title: "You can't trade right now".
- Text, as in the build's `tradeBanText`: "Your account is banned from trading until 14 Nov 2026, 14:05 UTC. Reason: Problems in trades. Trades you already started carry on." The permanent form is "…permanently banned from trading. Reason: …".
- The feedback callout is swapped for "Think this is a mistake? See your ban notice to reach a moderator." The words "ban notice" link to Ban-Notice. The OK button stays.

**StaffBan (new, 1280, senior moderator rail with "Accounts").** Tweaks: offence (first, second, third) and state (form, placed).
- **Header:** h1 "Ban nightowl_44" with the sub "Trader since Mar 2026 · 212 trades · 1 earlier ban".
- **Earlier bans:** a card with the line "Each one counts as an offence. The third is a ban for life."
- **Kind:** radio cards with a 2 px `--ink` border when selected:
  - "Trade ban": "They can log in, look at offers and use their wallets, but can't start or join trades."
  - "Site ban": "They can log in only to finish open trades and payouts."
- **Rule broken:** the five BAN_RULES, each showing "Trader sees: <general reason>". Under them: "The trader sees only the general reason (shown under each rule), never the rule or your note."
- **How long:** 44 px chips "24 h", "7 days", "30 days" and "Pick a date", plus "For life" for scamming only. The end time shows in mono. At the third offence the choice is locked to a danger box: "For life" / "This is their third offence, so the ban is for life. Only a moderator lifting it ends it."
- **Staff note (optional):** hint "Only staff see this. It's never shown to the trader. Up to 500 characters."
- **Preview box:** "What nightowl_44 will see", giving the D-020 headline, the reason and the end, with "See their notice".
- **Action:** "Tap key and ban" (danger), with a line beside it about what happens at once. "Cancel".
- **placed:** "Trade ban in force" with "Tap key and lift ban" and "Lifting ends it now. It still counts as an offence."

## 7. Proof editor ("Check your proof"): READY

**Boards:** ProofBlur and ProofBlur-Wide. This board is the editor, so I didn't draw a new one. New tweak: `image` (checked, not-checked, cant-use).
- **Title:** it stays "Check your payment proof". The build's h2 "Check your proof" should take the board's title.
- **Tap a box to remove it:** with Remove blur on, a blur you added goes in one tap. A privacy-tool blur follows `removeAuto` (add-only by default). The build removes any box in one tap and should follow this.
- **"Add blur":** this is the existing tool.
- **"Choose another":** a 44 px text button at the end of the line under the image. It drops the image and opens the picker again.
- **not-checked:** there are no Auto boxes. A caution notice sits above the image: "We couldn't check this image automatically. Blur anything private yourself." The privacy-tool question is skipped, and the footer is the plain Send.
- **cant-use:**
  - A caution alert: "This image can't be used. Try a screenshot."
  - A dashed picker slot (min 120, radius 16) with the title "Choose another" and the hint "Private details are blurred for you to check next. Location and device info are removed."
  - The tip: "A screenshot from your bank or payment app works best. Photos of a screen, very large files and some image types can't be read."
  - A "Good proof shows" card: "The amount, and when you paid" / "Who you paid, by which method" / "The trade code, if you put it in the memo", plus "How proof is checked".
  - "Back to the trade".
  - There are no tools and no Send.

---

## Boards and heights (defaults, night)

New boards: the head designer adds these to canvas.json.

| board | w × h | sits next to |
|---|---|---|
| StaffInvite | 1280 × 1657 | after OwnerSetup (row y 24482) |
| StaffMyPay | 1280 × 2333 | after StaffSettings |
| StaffPaySetup | 1280 × 1445 | after StaffMyPay |
| StaffBan | 1280 × 1641 | after StaffLog |

Changed boards and their new default heights. Update canvas.json `h` where it differs:

| board | old → new |
|---|---|
| MyTrades | 2365 → 2165 |
| MyTrades-Wide | 1557 → 1399 |
| Refunded | 1665 → 2075 |
| Refunded-Wide | 1241 → 1193 |
| BuyerPaidWaiting | 2934 → 3340 |
| BuyerPaidWaiting-Wide | 2114 → 2324 |
| CantDoThat | 1195 → 1623 |
| CantDoThat-Wide | 1119 → 1275 |
| Ban-Notice | 1791 → 2071 |
| Ban-Notice-Wide | 1257 → 1411 |
| ProofBlur | 5033 → 5481 |
| ProofBlur-Wide | 2755 → 2969 |
| StaffList | 2174 → 2489 |

Appeal-Notice (+Wide) and StaffLogin keep their heights.

**Checks:** check-board.js prints OK for all 20 boards. With MEASURE, before.root equals root in night and day, with two exceptions that were already true of the old boards: CantDoThat (+Wide) and the trade-ban Ban-Notice-Wide keep a fixed screen frame with the popup positioned over it. I rendered the PNGs in both themes and checked them visually. They are in `S/t6/`.

## Questions for the lead (not the owner)

1. **Payout address approval.** Adding a payout address is a security-key tap in the build, but a moderator's security key is now optional (D-070). Without a passkey path, a moderator with no key can never be paid. Design draws "passkey or security key".
2. **Staff pay setup fields.** StaffSettings' "Staff pay" block (helper per month, most per case, bonus as a % of the trade total) doesn't match the pay API (mod and senior per case, threshold, the senior's share of the fee). StaffPaySetup follows the API. Which one stands?
3. **One-method login.** Confirm the login rule for a moderator who has no security key, so the invite line can say it again.
