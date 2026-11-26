# Owner's hold model (relayed by the lead, 1–2 Nov 2026). It replaces earlier hold ideas.

## What starts a 24 h hold
Only these two things:
1. **A submitted change from a password-only session.** The change is to login methods or payout wallets.
2. **A recovery-code login.**

Nothing else starts a hold. Team members can never start one.

### 1. Password-only change flow (team lead, logged in with username + password only)
- **Before any change:** a pop-up warns that the change will start a 24 h hold because of low security. It strongly recommends adding stronger security now (passkey, security key and/or PGP) so this doesn't happen again.
- **Making changes:** they then make all their changes.
- **Review:** they see a REVIEW list of every change, with the total count.
- **Submit message:** roughly, "Click submit to make the changes official and begin the 24-hour hold."
- **When changes apply:** only AFTER the 24 h.
- **Ending early discards the changes:** if the lead ends the hold early with a strong login method they held before the hold, the changes are DISCARDED.
- **What Submit does:** it starts the hold, and everyone on the account (the lead and all members) is logged out.

### 2. Recovery-code login
- A pop-up explains the hold.
- It has Matrix/Telegram links ("[address to come]") to ask for confirmation over secure Jabber via Tor, so the hold can be removed.

## During a hold
- **Logged out:** EVERYONE on the account is logged out (the lead and members). Nobody can be logged in.
- **Trades in motion:** the system checks each trade's stage. The trade partner is told there's "a technical issue with the other trader's account".
  - **Escrow not yet funded:** the trade is cancelled. The partner is encouraged to trade with someone else for now.
  - **Mid-trade (escrow funded):** the trade is put on hold. A pop-up tells the user to contact a moderator on Matrix/Telegram with incident ID #xxxxxxxxxxx. The moderator decides how to proceed.

## How a hold ends
- **The lead's strong methods:** the lead uses a strong method they held BEFORE the hold. If the hold came from the password-only change flow, this discards the submitted changes.
- **Automatically:** the hold auto-ends after 24 h. Submitted changes then take effect.
- **A moderator:** contacted by the lead or a member, a moderator can EXTEND the hold, or help vet the lead back in so they can change security methods.

## New devices (team lead only)
- **Approval:** a new device needs approval: "Is this you?", sent to the app or an already-logged-in device, with 2-digit number matching.
- **Not approved:** the device simply can't log in yet. There is NO hold, and everyone else carries on as usual.
- **Unchanged:** the 3-device limit and "One device at a time".

## Team members
- **Approval:** the lead must approve every new team member, on their first login, via a notification.
- **Refusal:** if the lead refuses, nobody else is affected, and the new member is removed from the list.
- **Limits:** members can never start a hold and can never change wallet addresses.

## Obsolete
The "queued changes" screen on other devices (BlockQueued) is obsolete: everyone is logged out during a hold, so nobody can block anything.

## Decided (owner, directly to design, 2 Nov)
- When a password-only change starts a hold, the account owner is notified immediately on every channel they set up (push, secure Jabber and others). The notification lists each change.
- Still open: whether password-only changes to payout wallets or login methods should apply automatically after 24 h, or need a moderator or the owner's recovery code to confirm first.

## Decided (owner, directly to design, 2 Nov): no other device to approve from
- If the team lead has no logged-in device to approve a new login (for example the phone was lost or broken, the battery is dead, or every session timed out), they can log in with a strong method instead: PGP, a security key or a passkey. No approval is needed.
- Only those three count for this. A password, or a password plus an authenticator, does not.
- A password-only account in that situation has only the recovery code left, which starts the 24 h hold. This follows from the existing rules.

## Confirmed (owner, directly to design, 2 Nov): several devices at once
- The team lead can be logged in on up to 3 devices at the same time. Each new device must be approved.
- "One device at a time" is an optional switch, off by default. It is never forced on the lead.

## Decided (owner, directly to design, 2 Nov): accounts and bans
- **Account types:**
  - Trader: the default. Takes offers.
  - Vendor: posts offers.
  - To become a vendor, the account holder flips a switch in Settings > Account type. This needs a Strong login (a passkey, security key or PGP key).
- **Team members:** vendor accounts only.
- **Idle logout:**
  - Traders choose 2, 4, 6 or 12 h.
  - Vendors choose 2, 6, 12 or 24 h.
  - Every session ends after 24 h at most.
  - The session length is asked on every login, from a drop-down with nothing pre-selected.
- **Ban list:** usernames, PGP key fingerprints (including subkeys) and secure Jabber accounts. A banned one can never be used again.
- **Not tracked:** Monero addresses, payment details, IP addresses and device fingerprints.
- Team members' sessions do not count toward the lead's 3 devices (owner, 2 Nov).
- The lead can log out one member's session, or all of them with "Log out all team members". "Log out all other devices" covers only the lead's own devices (owner, 2 Nov).
- Switching a team member on or off needs a Strong login. A session with just a username and password gets the 24 h hold pop-up instead (owner, 2 Nov). The weakest possible login is username + password; username and Trade Tag are always separate and both required.
- Hold warning pop-ups also say: the only way around the hold is to message a moderator on Matrix or Telegram and ask to be verified over a secure Jabber channel (owner, 2 Nov).
- Trade chat: the trade partner sees only "replied by a team member", never which member. The lead always sees the member's name, in the chat and in the audit log (owner, 2 Nov).
- **Two-factor wording:** sensitive actions say "Needs a two-factor method you've already set up: a passkey, security key or PGP key." "Strong login" is no longer used as a requirement. Weak / Strong / Armored vault remain only as the signup chart's tier names (owner, 2 Nov).
- **Authenticator apps (TOTP):** count with a password for logging in (the Strong tier). They are not enough for the sensitive actions: ending a hold early, logging in with no other device, team invites, roles and on/off, and switching to vendor. The signup screen explains this when only an authenticator is picked (owner, 2 Nov).
- Team member replies in trade chat use the team blue (--team) bubble in both views, so a member replying is obvious (owner, 2 Nov).
- **Team member permissions are per member** (owner, 2 Nov). They replace the two roles: the lead switches each action on or off, starting from a preset if they like. The only things never available to members are the owner-only items: wallets, team, login and security, sessions, account type, and deleting the account.
- **No auto-accept:** every trade must be accepted by the account that posted the ad. "Accept a new trade" can be granted to members (owner, 2 Nov).
- Release XMR can be granted to a member. Every sensitive permission shows a warning when switched on, saying what it allows. Adding a member or changing permissions always needs a passkey, security key or PGP key (owner, 2 Nov).
- **Sessions** (owner, 2 Nov):
  - There is no fixed maximum. A session logs out only after the chosen idle time with no activity.
  - Traders choose 2, 4, 6 or 12 h; vendors choose 2, 6, 12 or 24 h.
  - After 24 h of continuous use, the user confirms with a passkey, security key or PGP key and stays logged in.
  - Trader screens never mention 24 hours.
  - Open: what happens on accounts with no passkey, security key or PGP key.
- **Sessions, revised** (owner, 2 Nov; replaces the entry above):
  - The chosen time is the session length.
  - When it runs out, the app asks the user to confirm with a passkey, security key or PGP key to extend by the same time. With no answer, the user is logged out.
  - No fixed maximum. This applies to traders and vendors.
  - Open: how long the prompt waits, and what happens on accounts with no passkey, security key or PGP key.
- Extending a session can also be confirmed with the password plus an authenticator code (owner, 2 Nov). Open: accounts with only a username and password.
- Username + password accounts can extend a session too, so any login method works for extending (owner, 2 Nov).
- **Payment proofs** (owner, 2 Nov):
  - An encrypted unblurred copy of the uploaded original is kept for moderators.
  - Without a dispute, it is deleted 48 h after the trade ends.
  - With a dispute, it is deleted when the ruling's 48 h appeal window closes.
  - Blur templates are kept as a database: proof-screen layouts with the private areas blanked. No real proofs are stored.
  - Open: whether traders are told the copy is kept (design recommends yes).
- Traders are told that the unblurred copy is kept: "We keep an encrypted unblurred copy that only a moderator can open, and only if there's a dispute. It's deleted automatically when the trade is over." This is also to go in the privacy text and Terms (owner, 2 Nov).
- **Hold model, revised** (owner, 2 Nov):
  - A change submitted from a username and password session no longer logs anyone out and pauses no trades. The account keeps working as normal; only the changes wait 24 h.
  - Ending early with a passkey, security key or PGP key the user already had discards the changes.
  - The owner is still notified on every channel.
  - Only a recovery-code login logs everyone out and pauses or cancels trades.
- Waiting changes can be cancelled by anyone logged in, including with just a username and password (owner, 2 Nov).
- **Offers and disputes** (owner, via the lead, 2 Nov):
  - Up to 3 buy and 3 sell ads per vendor. One ad covers every currency the vendor supports.
  - Tier amounts are converted at the market rate and shown in the chosen currency.
  - The buyer can open a dispute 30 minutes after tapping "I've paid" (minimum; some payments take up to 30 min to arrive). Correction from the owner, 2 Nov.
- **Cancel, reviews and trade volume** (owner, via the lead, 2 Nov ~01:20):
  - **Cancel:** the buyer can cancel a trade on their own ("Cancel trade", spec option B). This replaces the 29 Oct "Ask to cancel" / mutual-cancel design. The trade stays open with a status like "Returning XMR to the seller" until all confirmations of the XMR coming back are in.
  - **Reviews:** a review shows as soon as the trade is marked complete. There is no blind-reveal wait. "Skip review" shows nothing to anyone.
  - **Trade volume line, opt-in:** "Completed over $X in trades to date" on Profile and ads. Buying and selling are added, rounded down in $10,000 steps up to $90,000+, then $100,000+, then $50,000 steps ($150,000+, $200,000+ …). A settings toggle turns it on.
- **Answers, 2 Nov (via the lead):**
  - OfferAd buttons: "Request to buy XMR" / "Request to sell XMR".
  - Every cancel, including a buyer's, is recorded in one cancel figure. Only moderators see it (ModCase). It is never public.
  - The volume line includes verified past-reputation volume from other sites.
  - A trade with a skipped review still counts as completed.

## Multi-currency offers (owner with claude2 overnight, relayed by the lead 2 Nov)

Supersedes the earlier "limits converted at the market rate" note and the "≈" figures on OfferAd.

- The vendor types amount bands **per currency**. Nothing is converted or rounded.
- Pricing is **market ± % only**. There are no fixed-price offers.
- At most **5 currencies** per offer. A currency with no market price is hidden for that currency only.
- Buyers filter first by currency and payment method and see prices in the filtered currency.
- Bands are contiguous with no overlap: 200–400, then 401–600.
- Payment instructions are per payment type **and** per currency where they differ (Bank transfer: USD = account + routing, EUR = IBAN/SEPA).
- Spec: `docs/superpowers/specs/2026-11-02-task34-multi-currency.md` on `wip/second-p3-task34`.
- Boards: PostOffer, FlexOffer-Post (+Wide), OfferAd (+Wide).

## Decided (owner, via the lead, 2 Nov ~15:00 UTC)
- **Offers:** market ± % only, no fixed price (confirmed). Bands are whole currency units and the next band starts one unit later (500, then 501).
- **Past reputation:** imported LocalMonero history counts toward the opt-in "Completed over $X" line through a dollar figure a moderator checks and enters.
- **Trading hold, new rule:** an open dispute never blocks trading. A moderator freezes trading only when someone ignores a dispute (about 48 h with no reply) or ignores a ruling. The moderator writes in the dispute what the person must do to get trading back (for example pay X to Y); the person does it and messages the moderators, who check and lift the freeze. A freeze has **no end time**: My offers says "until the hold ends" with no date. Moderator tools come in Plan 4.
- **Payment instructions:** per payment type and per currency where they differ (bank: USD routing, EUR IBAN, GBP sort code).
- Boards updated for these: MyOffers (+Wide, Fold-MyOffers): hold notice without a date, sample "Fixed price" offer now follows the market; ModCase: the ruling's account action reads "Freeze trading on the losing side · only if they ignore the dispute or the ruling · no end time". Canvas v112.

## Decided (owner, via the lead, 2 Nov ~16:30 UTC)
- **Trading freeze:** only a separate, later action after someone has actually ignored the dispute (about 48 h) or the ruling. Not an option on the ruling card. ModCase: removed from the ruling's account actions; drawn as its own "Freeze trading" card (placeholder until Plan 4).
- **ProofBlur:** the uploader can only add blur, never remove an automatic blur ("unless we get good feedback as to why to backtrack"). The automatic blur never hides the amount. If the uploader's own blur covers the amount or memo, a warning shows (draft: "The amount is hidden, so the seller may not be able to check your payment."); they can still post. Boards default to add-only; both OPEN boxes are now Decided.
- **"Stay logged in?" prompt:** waits 2 minutes. SessionExtend OPEN box is now Decided.
- Still open: member-permission presets, template blanking, SetupTerms step count, incident-ID format.
