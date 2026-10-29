# Design brief 2026-10-29: what was delivered

All boards are on the X2F App canvas (https://claude.ai/artifact/NRhrWVvBrSwJ1Dt8oxp4eH), row "Brief 29 Oct".
Every item has a phone board `<Name>.dc.html` and a wide board `<Name>-Wide.dc.html`; night/day is the `theme` tweak.
Variants the brief asked for are tweaks on the same board.

| Brief | Board | Tweaks |
|---|---|---|
| A1 | FlexOffer-Post | example: filled/overlap |
| A2 | FlexOffer-Quote | variant: greyed/hidden |
| A3 | MyOffers | |
| A4 | CantDoThat | |
| A5 | Feedback | view: form/sent |
| A6 | Warn-IvePaid | |
| A7 | Warn-Release | |
| A8 | Refunded | variant: buyer-cancelled/time-ran-out/moderator |
| A9 | Appeal-Notice | variant: open/filed/waiting/decided/closed |
| A10 | Lien-Notice | |
| A11 | Ban-Notice | variant: trade-ban/site-ban |
| A12 | Maintenance | |
| A13 | News | variant: plain/with-dont-show-again |
| A14 | Block | view: profile/chat/settings |
| A15 | Reviews | view: write/profile; stars: 5/10 |
| A16 | Alerts | |
| A17 | DeleteAccount | variant: blocked/allowed |
| A18 | Support | view: new/thread |
| A19 | SelfDestruct | view: trade/privacy; trade: completed/disputed |
| B | Login, Login-Backup | method / view |

## Section B fixes
- `.x2f-method-name`: no board uses it (code only). Recommended CSS: `display:inline-flex; align-items:center; min-height:44px; margin-block:-13px`; then drop the `:not(.x2f-method-name)` exclusion in `apps/web/e2e/refund.spec.ts`. All tappable method rows on boards are already 60px.
- Orange chips: Main, SellOffers (and their mirrors BuyMain, BuyOffers): selected sort chip border orange → ink.
- SetupPgpChallenge fits 844 (spacing tightened; canvas h 884 → 844).
- SetupWallet: "This first wallet works right away. Any wallet you add later asks you to confirm it's you, and we always show an alert. Want extra protection? In Security settings, you can make newly added addresses wait 24 hours before they can be paid."
- SetupTerms Fees placeholder: now the 2026-10-20 extra-XMR rule.
- SetupUsername/SetupWelcome example: lumen.k (the owner's name on OwnerSetup) → mira.k.

## Owner copy changed
- A4: added a full stop after "feedback"; title "You can't do that yet"; button "OK".
- A5: thank-you split into heading "Thank you!" + the owner's sentence (words unchanged).
- A6: owner text verbatim in two paragraphs; added title "Wait until the XMR is fully in escrow" and a 3-of-10 confirmations bar.
- A7 (final words were ours): "Is the $412.50 really in your account?" / "Only release once the money is really in your account." / "Check your own bank or Zelle app, not a screenshot. Screenshots can be faked." / "Once released, the 1.250000 XMR (about $412.50) goes to mira.k and can't be taken back."
- A1: "Buyer must have at least __ completed trades" reads "Seller must have…" on buy offers (the taker is a seller).
- A2 hidden variant: added "2 more offers aren't shown. You don't meet their rules for $600.00."
- A11: "…reach out to our moderators on Matrix (or Telegram)." (link placement). Matrix/Telegram addresses are examples.
- A12: one long sentence split into two.
- A15: "Rate the trade" → "Review the trade"; "Submit rating" → "Submit review". Stars amber (caution), not orange.
- Selected states on new boards use an ink border, not orange (orange fill only for the one primary action).

## Brief vs spec (brief followed; spec needs updating or owner decision)
- Appeal window 72 h (brief) vs 48 h on DisputeRuling; appeal reviewer = "a senior moderator who hasn't seen this case".
- Lien implies coins move at the ruling; DisputeRuling says they move after the appeal window.
- Self-destruct 30 days after end / 90 days from the dispute button vs spec 4.1 (chats 90 days after close; disputes 30 days after close). Privacy page still mentions the 6-month anonymised training copy.
- No email anywhere vs spec 6.3's opt-in PGP-encrypted email notifications.
- Reviews 1–10 option and custom comment vs spec's 1–5 + one-line note.

## Open questions for the owner
1. Orange selected outlines remain on ~12 older boards (PostOffer, SetupWallet chips, Wallet, ModQueue, StaffList, StaffOverview, Review, BadgeSettings; radios on BuyQuote, DisputeOpen, ModCase, SetupLogin, SetupBackup): switch all to ink?
2. Sort chips are 32px tall (< 44px): raise?
3. mira.k "is available" in setup although mira.k has trade history elsewhere: fine as a storyboard shortcut?
4. A6: also show the warning when the pay screen opens / when escrow already has 10 confirmations?
5. A5: how do staff reply to non-anonymous feedback?
6. A9: add a "ruling stands" decided state?
7. A8: offer "Did you pay before you cancelled? Open a dispute" when the buyer cancelled?
8. A11: is a trade ban timed / does it show an end date or reason? Can a site-banned user open Wallets? Real Matrix/Telegram addresses?
9. A14: is the blocked person told? Open trades continue until they end (assumed).
10. A15: dispute-review reasons; does the review stay visible while checked? Do the trade badges fit?
11. A13: where News lives after "don't show again" (we wrote Profile); separate planned vs emergency maintenance variant?
12. A16: Jabber alert account OMEMO fingerprint published? App list Conversations/Monal/Gajim? Battery tip Android-only?
13. A17: can a deleted username be reused? Trade records kept until their self-destruct date (assumed yes).
14. Login-Backup: during the 24-hour hold, is trading blocked (we wrote yes)?
15. A1: method price adjustment % only, or also a fixed amount with fixed-price offers? Amount-range mismatches treated like tier rules (greyed/hidden)?
16. A3: Select all with mixed states turns all on (built) or all off?

## Owner decisions, 2026-10-29 (answers to the open questions)
- Q1: all orange selected outlines → ink on every board (done, canvas v62). Stars are amber (caution) everywhere; setup progress segments ink; Feedback checkbox ink.
- Q2: 44px minimum hit area everywhere (industry standard: Apple 44pt / Android 48dp / WCAG); small controls keep their look with an enlarged invisible hit area (done).
- Q3: setup example username → `juniper.oak` (on no other board) (done).
- Q4 (A6): the "don't pay until escrow is complete" warning also shows when the pay screen opens while escrow is still confirming, as well as before "I've paid".
- Q5 (A5): staff reply to non-anonymous feedback inside the app (Support tickets / alerts). No email.
- Q6 (A9): decided appeal shows either "Decision overruled" or "Decision stands", each with a plain explanation of what happens next.
- **Cancel rule change (replaces the 2026-10-17 "buyer cancels alone"):** before funding either side can walk away. After the seller funds, the buyer can ask to cancel but it takes effect only when the seller also taps Cancel (mutual cancel); all XMR returns to the seller. The seller can never cancel alone after funding. A silent/non-paying buyer still ends in the no-show auto-refund. The moderator's automatic signature is now only for the no-show refund. **Lead: update spec 2.3, 3.1 table and 3.3 (remove "Buyer cancels (automatic)"), and Plan 3 (drop the buyer-cancel event/buyerCancelDecision and the moderator co-sign for it; mutual cancel already exists).**
- Q7 (A8): the Refunded screen for a cancelled trade offers "Did you pay before you cancelled? Open a dispute."
- **Cancel hidden after "I've paid" (owner, 2026-10-29):** once the buyer taps "I've paid" (with or without proof), the buyer's Cancel request is no longer offered, so a scammer can't talk a paid buyer into cancelling. From then on the trade ends only by release, dispute, or (per the existing rules) the seller's refund path after the confirm window. A buyer who tapped "I've paid" by mistake explains in chat or opens a dispute. The Refunded "Did you pay before you cancelled? Open a dispute" line stays for buyers who paid but cancelled before tapping "I've paid". **Lead: replaces spec 2.3 "Cancel after I've paid" (strong warning) with "no cancel after I've paid".**
- **Two-step "I've paid" (owner, 2026-10-29):** tapping "I've paid" opens a confirm sheet: "Mark this trade as paid?", a required tick "I sent exactly $412.50 by Zelle with the memo K7M2-…", the line "After this you can't cancel the trade. If something goes wrong, open a dispute.", then "Yes, mark as paid" (enabled only after the tick) or "Not yet". The buyer's "Cancel trade" link is now "Ask to cancel". Shown on the BuyerPay board (canvas v64).
- **Site news (owner, 2026-10-29):** a bell icon labelled "Site news", with a teal dot for unread posts, sits beside the X2F logo on the main screens (Main, BuyMain) and opens News. The News "don't show again" note now says "You can still read it any time under Site news, the bell at the top of the screen." (canvas v65)
- **Bans (owner, 2026-10-29):** both ban types show when they end (or "permanent") and a one-line plain reason.
- **Blocking (owner, 2026-10-29):** silent. The blocked person is not told; open trades finish normally.
- **Disputed reviews (owner, 2026-10-29):** the review stays visible, marked "Under review", until a moderator checks it against the trade; removed only if it breaks the rules.

## Foldables (owner, 2026-10-29)

The owner uses fold phones. The app must be laid out properly for them; fold-only features are welcome but optional.

- Postures: cover/folded uses the 390 phone layout; unfolded uses two panes (about 840 wide), split at the hinge; tabletop (half-folded) shows glanceable info on top and all controls on the bottom; wide screens use the desktop layout.
- Nothing goes across the hinge. Dialogs and sheets stay inside one pane.
- Folding or unfolding keeps the user's place: same screen, same scroll position, and any typed text.
- Web app: use `horizontal-viewport-segments` / `vertical-viewport-segments` and `env(viewport-segment-*)`. Where those aren't supported, fall back to two panes at 600 px wide or more.
- New boards: Fold-Offers, Fold-Trade, Fold-Tabletop, Fold-Cover (Flip cover screen), Fold-Notes.

## Backup login wait (owner, 2026-10-29)

- During the 24-hour wait after an authenticator-code login, trades that were already open can still be finished (mark paid, release, dispute). New trades, new logins and wallet changes stay blocked.
- No wait for strong logins: a security key, a recovery code, or a PGP signature plus a passkey (or PGP plus a security key).
- Decided (owner, 2026-10-29):
  - **Tabletop:** the layout turns on by itself when the phone is half-folded, and off when it is opened flat. There is no setting for it.
  - **Flip cover screen:** shows the most urgent trade, plus a "+2 more trades" line when there are others.
  - **Folding mid-trade:** the chat pane moves behind the phone header's Chat link, and any text being typed is kept.
  - **Unfolded quote button:** says "Trade", matching the phone board.
- Boards on the canvas: Fold-Notes, Fold-Offers, Fold-Trade, Fold-Tabletop, Fold-Cover and Fold-TriFold, in the "Foldables" row.

## Devices and team members (owner, 2026-10-29)

Spec 6.3 (device list and new-login alerts) should be updated to match these decisions.

**Devices**
- Up to 3 devices can be logged in at once by default.
- A new device must be approved from a device that is already logged in: "Someone is logging in on <browser, OS>. Is this you?" with **Yes, let them in** or **No, block it**.
  - The approval uses number matching: the new device shows a 2-digit number, and the user taps the same number. This stops approval spam.
  - Choosing "No" blocks that login and suggests changing the login method.
- If no logged-in device is available (for example, the only one was lost), the backup-login rules apply. A security key, PGP plus a passkey, or a recovery code gets in with no wait; an authenticator code starts the 24-hour wait.
- Optional setting "One device at a time": approving a new device logs the old one out.

**Team members** (the phase after launch; adjust from feedback)
- Up to 5 members created, and at most 3 logged in at once.
- Each member has their own login, which always needs two factors (the same rule as staff). There are no shared passwords.
- Members can work trades only: chat, mark paid, confirm payment, release, open a dispute.
- Only the account owner can change payout wallets, post or edit offers, add or remove members, or delete the account.
- Trade partners see the account username plus "replied by a team member", never which member.
- All reviews and reputation go to the one account.
- Every member action is logged and cannot be edited. The owner can switch a member off instantly.
- Legal flag for the lawyer: an account with members trading for it looks more like a business, which may affect whether X2F counts as an exchange.

## Staff pay (owner, 2026-10-29)

- **When staff are paid:** at the end of each shift, when they log out. Monthly pay is dropped. X2F adds up the shift and sends it in XMR to the staff member's payout wallet. They see the total before they confirm logging out.
- **Clawback:** if an appeal later overturns a ruling, that case's pay is taken from the next payout.
- **Large-trade bonus (senior moderators):** the owner sets a % of the trade total. It is paid on top of the per-case rate for trades at or above the large-trade limit, and there is an optional cap per case.
  - Recommended and on by default: the bonus is held until the 48 h appeal window closes, because XMR sent can't be recovered if someone leaves with a negative balance.
- **Helper pay:** the owner will decide later. It stays a flat monthly placeholder for now.
- **Board:** StaffSettings.
- **Lead:** update spec 6.6 (staff pay is "monthly" today) and the staff pay plan.

Devices and team boards are now on the canvas: LoginApprove, Devices and Team, each with a -Wide version.
