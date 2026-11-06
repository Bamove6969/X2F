# X2F design brief for Claude Design (2026-10-29)

Paste this into the **X2F App** canvas (https://claude.ai/artifact/NRhrWVvBrSwJ1Dt8oxp4eH) and use the
**X2F** design system. Phone first (every board at the standard phone sizes), wide screen second.
Night theme first, light theme as the swap, same as the existing boards. Keep the existing voice: plain,
short sentences, no jargon. Words in quotes below are the owner's own copy; keep them unless they break
the copy rules, and say so if you change any.

## A. New screens and parts (none exist yet)

1. **Flexible offer: posting (PostOffer)**
   - Price tiers: each row = amount range (from–to) + price (% above/below market). A "+" adds a tier
     (up to 5). Per-tier option: "Buyer must have at least __ completed trades".
   - Several payment methods in one offer: pick methods; each has its own payment instructions and an
     optional price adjustment (e.g. "PayPal +2%").
   - Errors inline: overlapping ranges.
2. **Flexible offer: in the lists and the quote**
   - The buyer types an amount; every offer shows its final price for that amount and method.
   - On taking an offer: a dropdown to pick one of the trader's methods.
   - Offer not available for this buyer (tier rule): greyed with the reason, or hidden (show both options).
3. **My offers**: a list of all my offers, each with an on/off toggle, plus "Select all" to turn all on or
   all off.
4. **"Can't do that" popup** (one shared component, used everywhere the app says no), e.g.
   "Sorry, you're limited to 2 offers per side (buying or selling) for each currency."
   Every one ends with: "If you feel this feature can be improved please leave **feedback**" ("feedback"
   is a link).
5. **Feedback form**: free text (complaint, feedback, recommendation, anything), a "Send anonymously"
   checkbox, Send. After sending: "Thank you! Each and every comment is appreciated and reviewed to help
   make this community a better place for us all"
6. **Warning popup before "I've paid"** (buyer): "We strongly recommend that you do not send payment
   until all confirmations are complete and you've received confirmation that the XMR is fully in escrow.
   The way our system is designed, we can help you get back the XMR you were trading for if anyone tries
   to scam you, but recovering a payment you've sent is much harder and sometimes impossible."
7. **Warning popup before "Received, release"** (seller): only release once the money is really in your
   account; check your own bank or app, not a screenshot (screenshots can be faked); once released the
   XMR goes to the buyer and can't be taken back. (Owner's style; final words are yours.)
8. **Refunded screen** (buyer): one screen, a clear reason for each case: buyer cancelled; payment time
   ran out, so the seller cancelled and everything in escrow went back to the seller; a moderator decided
   the dispute.
9. **Dispute outcome + appeal**: outcome notice with "Don't agree with the moderator's decision? Request an
   appeal. You have 72 hours (until <exact date and time>)." A **File appeal** button on that trade's page
   and in the completed-trades list; it disappears after 72 hours. States: appeal filed, waiting for an
   independent reviewer, decided.
10. **Lien notice**: "Your trading is paused until you repay <amount> XMR to <name> (appeal decision)",
    with a Repay button that starts a repayment trade.
11. **Ban notices** (shown on a successful login):
    - Trade ban: can't start or join new trades.
    - Timed site ban: "Your account is temporarily banned and will be fully operational again on <exact
      date and time>." plus "If you don't agree with this decision or feel it was made in error, please
      reach out to our moderators" with a Matrix (or Telegram) link.
12. **Emergency stop / maintenance**: the offer lists empty with a message: the system has been taken down
    for unscheduled but necessary maintenance and will be back as soon as possible; check **News** or join
    our Matrix/Telegram.
13. **News inbox**: shown at login; posts newest first, each with its date; new vs already seen is clear.
    (Maybe a "don't show me this again" checkbox: show it as an optional variant.)
14. **Block a trader**: action on a trader's profile and in the trade chat; a blocked list in settings to
    unblock. The blocked person can't see your offers, take them, message you, or see you're online.
15. **Reviews**: after a trade: star rating (show 1–5 and 1–10 variants; owner hasn't chosen), templated
    comments, badges that describe the trade, a custom comment. On a profile: totals ("42 completed, 98%
    positive"), reviews, badges. "Dispute this review" for the person reviewed.
16. **Alerts settings**: phone push on/off; a loud alarm with the default sound, upload your own sound,
    volume slider; Android "use battery freely so you never miss a trade alert" (recommended for
    de-Googled phones); OMEMO Jabber over Tor (address entry + short setup steps). No email anywhere.
17. **Delete my account**: in settings; blocked with a clear reason while a trade or dispute is open;
    a strong confirm step.
18. **Support tickets**: pick a category (and a last one, "Everything else"), write the question, see
    replies from Helpers.
19. **Self-destruct**: in the trade room, "This trade self-destructs on <date>" (30 days after it ends;
    disputes 90 days from the dispute button). Privacy page states this plainly; no delete choices.

## B. Fixes to existing boards (waiting)

- Tap size: the shared payment-method name (`.x2f-method-name`) was set to 44px tall by the lead; the
  owner leaves the final call to you.
- Missing boards: Login and Login/backup.
- Orange chips on two boards (orange is reserved for one live marker).
- PGP artboard height.
- SetupWallet: stale 24-hour wording. SetupTerms: Fees placeholder on extra XMR.
- SetupUsername: the "lumen.k is available" example.

## C. What to send back

Boards on the X2F App canvas named after the items above (e.g. "FlexOffer-Post", "CantDoThat",
"Appeal-Notice"), each with phone + wide versions and night + light. Note any copy you changed and why.
