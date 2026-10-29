# Community room and staff verification (parked)

Ideas agreed with the owner on 2026-10-15, parked until the app is finished. Not part of the MVP.

## Where

- A public community room on **Matrix**, not Telegram, because Telegram requires a phone number and X2F promises no phone number. A Telegram room may be added later for reach.
- X2F runs **its own Matrix server** (for example `x2f.chat`) with public sign-up closed, so only X2F can create accounts there, and only staff get them. Community members join from any other server, such as matrix.org.

## Why display names don't prove anything

On Matrix anyone can set any display name and picture, including an exact copy of a moderator's. The account address (`@sarah:x2f.chat`) is unique, and only X2F can create addresses ending in `:x2f.chat`. The room's moderator label can only be granted by the room's admins, but it shows only inside that room, never in private messages.

## Pinned rules (draft)

> **How to get help from X2F staff**
>
> 1. Ask in this channel. Never post payment details, wallet addresses or trade codes here.
> 2. A moderator will reply to you here by name. Real moderators have the moderator label next to their name in this room.
> 3. The moderator will privately send you a 3-character code: a number, a letter and a symbol, for example **4K#**. Post that code here.
> 4. Wait for the same moderator to confirm it here. Only continue with the account that sent the confirmed code.
> 5. Real staff accounts always end in **:x2f.chat**. If the address ends in anything else, it's not staff, whatever the name or picture says.
> 6. Staff will never ask for your password, your private key, your recovery codes, or for you to send coins anywhere. Disputes are only ever decided inside the X2F app.
>
> If someone messages you claiming to be staff without following these steps, block them and report them here.

Code rules: no look-alike characters (0/O, 1/l/I); each code works once and expires after 15 minutes. It is a matching check, not a secret, so 3 characters are enough.

The same rules live on a Help page inside the app, where scammers can't edit them, together with an "Our staff" list of every real staff account address.

## Support beyond the room

- In-app help center (searchable), plus a **Talk to a person** button that opens a private support ticket.
- **Helpers:** a staff level that answers questions in the room and in tickets, with no access to dispute evidence and no power to rule. Added by the owner like moderators.
- Optional later: an AI help bot, only if it runs on X2F's own server (privacy), answers general how-to questions only, never touches disputes, and hands off to a person.
- People may post "I opened a dispute" in the room as a nudge, but the app should show each dispute's queue position and response deadline so nobody needs to.
- Option still open: finishing conversations inside the app's support tab instead of Matrix private messages (strongest against impersonation).
