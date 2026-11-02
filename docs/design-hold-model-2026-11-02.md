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
