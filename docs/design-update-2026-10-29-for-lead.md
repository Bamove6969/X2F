# Design update for the lead, 29 Oct 2026

From: the design session in the cloud. The owner asked me to bring you up to date.
Branch `wip/design-brief` in bamove6969/x2f. Nothing is merged; that is your call.

## Where to look

- **Canvas** (all boards, night and day): https://claude.ai/artifact/NRhrWVvBrSwJ1Dt8oxp4eH
  It is private to the owner's account. If you can't open it, ask the owner to share it with you.
- **Board source files:** `docs/design-boards/` on this branch. These are the same files as on the canvas, including `canvas.json`. They are `.dc.html` design boards, readable as markup.
- **Full record:** `docs/design-brief-2026-10-29-response.md`. It has every board, every copy change, the brief-vs-spec conflicts and every owner answer.

## Later the same day: final owner answers (all applied to boards)

Full list: "Remaining open questions, answered" in the response doc.

1. **Coins move at once.** A release or a ruling sends the XMR right away; nothing is held until the appeal window closes.
   - A dispute can be opened up to 48 h after a trade ends, and an appeal up to 48 h after a ruling.
   - Whoever loses gets a lien: no trading until they pay it back.
   - If a ruling is overturned, the person who received the coins gets the lien.
   - The appeal window is **48 h**. The brief's 72 h is dropped.
   - Boards: DisputeRuling, Appeal-Notice, Lien-Notice, SetupTerms §5.
   - Please check: ModCase still offers "Trading hold on the losing side, until the appeal window closes". It probably becomes the lien. The board was left unchanged.
2. **Site ban.**
   - A banned user can log in only while something is unfinished: an open trade, a lien, a payout still arriving or an open appeal. After that, they're locked out completely.
   - The Matrix and Telegram appeal contacts are still to be decided, and show as placeholders.
   - Board: Ban-Notice (`business` tweak).
3. **Maintenance** has two versions (`variant` tweak):
   - Planned: start and end times.
   - Emergency: "back soon", with all trade timers paused.
4. **Reviews.**
   - Stars are 1–5 only.
   - Disputing a review takes a required free-text reason; there's no reason list for now.
5. **Alerts.**
   - Jabber is OMEMO only, sent over Tor through X2F's onion address.
   - The X2F alert account's OMEMO fingerprint is shown so users can check it.
   - Suggested apps: Conversations, Monal and Gajim.
   - The battery tip shows on Android only.
6. **No email anywhere.** Remove spec 6.3's opt-in PGP email alerts.
7. **Retention.**
   - Trade chats are kept 30 days after the trade ends.
   - Dispute records are kept 90 days, used for training, with private details auto-blurred.
   - The 6-month copy is dropped.
   - Spec 4.1, Terms and privacy text need updating. Boards: SelfDestruct, SetupTerms.
8. **Deleted accounts.**
   - The username is never reused.
   - Past trade and dispute records stay until they auto-delete.
   - Board: DeleteAccount.
9. **Flexible offers.**
   - Payment-method price changes are a percent of the market rate only.
   - A method outside the buyer's amount shows greyed out with the reason, e.g. "PayPal: up to $500", never hidden.
   - Boards: FlexOffer-Post, FlexOffer-Quote.
   - The whole-offer "Fixed price" option is unchanged. The owner's answer was about method adjustments.
10. **Staff pay** is paid at the end of each shift, when they log out, with clawback.
    - Senior moderators get a large-trade bonus: a % of the trade total, with an optional cap.
    - By default the bonus is held 48 h.
    - Board: StaffSettings. Spec 6.6 says "monthly" today.

All open design questions are now answered.

## Still in progress (not finished yet)

- **Team members:** the rules are agreed (section 6 below) and the Team boards are on the canvas. It's planned for the phase after launch.
- **Devices:** the rules are agreed (section 5), and the LoginApprove and Devices boards are on the canvas.
- **Foldables:** six boards are on the canvas, but they haven't been checked in a real browser yet. The fold rules aren't added to existing boards yet. Only the new Fold-* boards show them.
- **Open questions:** the questions still open with the owner are listed at the end. I'll send another update when they're answered and the boards above are done.

## Spec and plan changes you need to make

These are owner decisions that change the spec or plans. Please apply them; the design side doesn't edit the spec on main.

1. **Cancelling, which replaces "buyer cancels alone" from 17 Oct:**
   - Before the seller funds the escrow, either side can walk away.
   - After funding, the buyer can **ask** to cancel. The cancel happens only if the seller also taps Cancel, and all XMR goes back to the seller.
   - The seller can never cancel alone after funding.
   - A buyer who never pays still ends in the no-show auto-refund. The moderator's automatic signature is now used only for that refund.
   - Spec: 2.3, the 3.1 table and 3.3 (remove "Buyer cancels (automatic)").
   - Plan 3: drop the buyer-cancel event, `buyerCancelDecision` and the moderator co-sign for it. Mutual cancel already exists.
2. **No cancel after "I've paid":**
   - Once the buyer taps "I've paid", their "Ask to cancel" option disappears.
   - A buyer who tapped it by mistake explains in chat or opens a dispute.
   - This replaces the spec 2.3 "Cancel after I've paid" warning.
3. **"I've paid" takes two steps:**
   - Tapping it opens a confirm sheet with a required tick: "I sent exactly $412.50 by Zelle with the memo …".
   - It says plainly that you can't cancel after this.
   - "Yes, mark as paid" is enabled only after the tick.
   - The buyer's "Cancel trade" link is renamed "Ask to cancel".
   - Board: BuyerPay.
4. **Backup login wait (spec 6.3):**
   - **When the wait applies:** only after a login with an authenticator code.
   - **What it blocks:** new trades, new logins and wallet changes. Trades already open can still be finished (mark paid, release, dispute).
   - **No wait for:** a security key, a recovery code, or PGP plus a passkey or security key.
   - Board: Login-Backup.
5. **Devices (spec 6.3 device list and alerts):**
   - **Limit:** up to 3 devices logged in at once.
   - **Approving a new device:** it must be approved from a device that is already logged in. The approval uses number matching: the new device shows a 2-digit number and the user taps the same one. "No, block it" blocks the login.
   - **No logged-in device:** the backup-login rules apply.
   - **Optional setting:** "One device at a time", where approving a new device logs out the old one.
6. **Team members, a new feature for the phase after launch:**
   - **Size:** up to 5 created, at most 3 logged in at once.
   - **Login:** each member has their own two-factor login, the same rule as staff.
   - **Permissions:** members can only work trades: chat, mark paid, confirm, release, dispute. Only the account owner can change payout wallets, offers, members, or delete the account.
   - **What trade partners see:** "replied by a team member", never which member.
   - **Reputation and log:** one reputation for the whole account, and every member action is logged.
   - **Legal flag for the lawyer:** an account with staff trading for it looks more like a business. That may affect whether X2F counts as an exchange.
7. **Bans, blocks and reviews:**
   - Bans show an end date (or "Permanent") and a one-line reason.
   - Blocking is silent: the blocked person isn't told, and open trades finish normally.
   - A disputed review stays visible, marked "Under review", until a moderator checks it.
8. **Smaller decisions:**
   - **Pay-screen warning:** "don't pay until escrow is complete" also shows on the pay screen while escrow is confirming.
   - **Feedback replies:** staff reply to feedback inside the app, never by email.
   - **Appeals:** an appeal ends in either "Decision overruled" or "Decision stands", each with a plain explanation.
   - **Refunded screen:** it offers "Did you pay before you cancelled? Open a dispute."
   - **Site news:** a bell labelled "Site news" sits beside the logo, with a teal dot for unread posts.
   - **My offers:** each offer has its own tick box, and "Select all" only selects. A bar with "Turn on" and "Turn off" applies to the ticked offers. Offers that are turned off stay off until the user turns them back on.
   - **Deleted usernames:** never reused (recommended to the owner; the owner did not object).
9. **Brief vs spec, still open:**
   - the 72 h appeal (brief) vs 48 h (DisputeRuling)
   - self-destruct timings vs spec 4.1
   - the 6-month training copy
   - no email vs spec 6.3
   - 1–10 stars

   See the response doc's "Brief vs spec" section.

## Foldable phones (new requirement)

The owner uses a Pixel 9, 10 and 11 Pro Fold. Galaxy Z Fold, the Samsung tri-fold and the iPhone Fold should work too. The layout changes with the screen and the fold:

| Screen | Layout |
|---|---|
| Cover screen, or under 600 px | phone layout |
| 600–999 px | two panes, split at the hinge |
| 1000 px and over | wide, or three panes on a tri-fold |
| Half-folded (tabletop) | turns on automatically: top half shows info only, bottom half has all controls and the chat |
| Flip cover screen | small card for the most urgent trade, plus "+2 more trades" |

Rules for all of these:
- Nothing sits across the hinge. Dialogs stay inside one pane.
- Folding or unfolding keeps the screen, the scroll position and typed text. When folded mid-trade, the chat moves behind the Chat link.
- Web: use `horizontal-viewport-segments` / `vertical-viewport-segments` with `env(viewport-segment-*)` where supported (Chrome on Android). Use width-only breakpoints elsewhere (Safari on iPhone Fold).

## Boards that are new or changed since the brief response

| Change | Boards |
|---|---|
| New | Fold-Notes, Fold-Offers, Fold-Trade, Fold-Tabletop, Fold-Cover, Fold-TriFold |
| Changed | BuyerPay, Main, BuyMain, News, Refunded, Ban-Notice(-Wide), Block(-Wide), Reviews(-Wide), MyOffers(-Wide), Login-Backup(-Wide) |
| New (devices and team) | LoginApprove, Devices, Team (each with a -Wide version); StaffSettings changed (shift-end pay, large-trade bonus) |

Not yet checked in a real browser: the Fold boards and the new MyOffers. Text fit was estimated.

## Still open with the owner

- Alerts settings: Jabber OMEMO fingerprint, the app list, and the Android battery tip
- Delete account: whether trade records are kept until the self-destruct date
- FlexOffer: whether price adjustment is by percentage only or also by a fixed amount
- Site ban: whether the user can still open Wallets, and the real Matrix/Telegram addresses
- Reviews: the dispute reasons
- Maintenance: planned and emergency versions (recommended to the owner, awaiting an answer)
