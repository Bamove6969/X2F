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
- Switching a team member on or off needs a Strong login. A session with just a username and password gets the 24 h hold pop-up instead (owner, 2 Nov). The weakest possible login is username + password; username and display name are always separate and both required.
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
