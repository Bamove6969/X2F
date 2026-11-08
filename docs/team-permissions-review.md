# Team permissions: what a member can do, and what we recommend

For the owner. 8 Nov 2026. Written by design from the MemberPermissions, Team, MemberApproval, TeamRefusal, TeamChat and HoldChange boards (canvas v131), your decisions of 6 and 7 Nov (Q16, G57, p4-8, p5-7) and the lead's notes.

How the model works today, in one paragraph: a vendor's team lead switches a member into one or more **types** (Chat, Offers, Trades, Records, Holds and waiting changes), then ticks what the member may do inside each type. Every label below is design's proposal and is unsigned. Saving needs the lead's passkey, security key or PGP key; from a username-and-password login, team changes wait 24 hours. Only the lead can remove a member. A member can never use a stronger login than the lead does. The trade partner is never told which member is replying, only "Team member".

Risk key used below: **money** (XMR or a trade's cash can move or be lost), **reputation** (your profile, reviews or dispute record can suffer), **privacy** (someone sees things only you should see), **none** (read-only or harmless).

---

## 1. The 34 permissions today

Grouped by type, in the board's order. SENSITIVE marks what the board flags with a warning and a confirm step before it turns on.

### Chat (7)

| Permission | What it lets a member do | Risk if granted |
|---|---|---|
| Read trade chats | Open and read the chat of any trade on your account. | Privacy: they read your partners' messages and payment details. |
| Reply in trade chats | Write to trade partners as your team. | Reputation: a rude or wrong reply is yours in the partner's eyes. |
| Send payment details in chat | Post your bank, Zelle, e-Transfer or similar details to a buyer. | Money: wrong or swapped details send a buyer's cash elsewhere. |
| Upload proof in chat | Attach a payment screenshot or video on your behalf. | Reputation: a bad or fake proof can lose a dispute. |
| Nudge the other trader | Send the 15-minute reminder (the horn) to the partner. | None, beyond annoying a partner. |
| See the trader's profile notes | Read the private notes you keep on traders. | Privacy: your own notes about people. |
| Block a trader | Stop a trader from taking your offers or messaging you. | Reputation: blocking a good customer costs business; hard to notice. |

### Offers (8)

| Permission | What it lets a member do | Risk if granted |
|---|---|---|
| See all offers | View every buy and sell offer on the account, live or paused. | None. |
| Turn offers on or off | Pause or resume offers. | Money: offers go dark (lost trades) or live when you don't want them. |
| Edit prices | Change the above/below-market percentage on offers. | Money: a bad percentage sells your XMR cheap or buys dear. |
| Edit amount bands | Change the trade-size bands and their trade-count minimums. | Money: lets big trades in from unproven traders. |
| Edit payment types and instructions | Change which payment methods an offer takes and what the buyer is told. | Money: wrong instructions send cash to the wrong place; a new method may be one you can't handle. |
| Edit currencies | Change which currencies an offer is posted in. | Money: a currency you can't receive, or losing one you can. |
| Post a new offer | Create a new offer (within your 3 buy + 3 sell). | Money and reputation: a new offer is a public promise in your name. |
| Delete an offer | Remove an offer for good. | Money: loss of a working offer and its history. |

### Trades (9)

| Permission | What it lets a member do | Risk if granted |
|---|---|---|
| Accept a trade | Take a trade request so escrow can be funded. | Money: commits your XMR to escrow. |
| Decline a trade | Turn a trade request down. | Reputation: declined traders go elsewhere. |
| Mark "I've paid" | When your account is the buyer, tell the seller you've sent the cash. | Money: a false "paid" starts the dispute clock and can be ruled against you. |
| Confirm payment received | When your account is the seller, say the cash has arrived. | Money: this is the step right before release; a wrong confirm releases XMR for cash you never got. |
| **Release XMR** · SENSITIVE | Send the escrowed XMR to the buyer. | Money: the one irreversible action. The board warns: "Only for someone you trust fully." |
| Ask to cancel | Request to cancel a trade, or cancel where the rules allow a refund. | Money and reputation: cancels count against you and can refund the other side. |
| Open a dispute | Call a moderator in on a trade. | Reputation: disputes show on your record; a needless one wastes a moderator's time. |
| Reply in a dispute | Answer the moderator in the dispute room. | Money and reputation: what they say decides the ruling. |
| Leave feedback | Rate the partner after a trade. | Reputation: feedback is public and counted per member (Q69). |

### Records (7)

| Permission | What it lets a member do | Risk if granted |
|---|---|---|
| See trade history | Read the list of past trades. | Privacy: amounts, partners and dates of your business. |
| Export trade history | Download the history as a file. | Privacy: a copy leaves X2F and your control. |
| See team activity log | Read who on the team did what, and when. | Privacy: other members' actions; low risk, mostly useful. |
| See payout amounts | See how much XMR left the account to your wallets. | Privacy: your earnings. |
| See reviews | Read the reviews on your profile. | None (they are public). |
| Reply to reviews | Post public replies to reviews. | Reputation: a public reply in your name. |
| See support tickets | Read the account's tickets to X2F staff. | Privacy: tickets may hold security or dispute detail; tickets are shared across the team (Q69). |

### Holds and waiting changes (3)

Your decision p4-8: off for members unless granted. Without these a member only sees that a hold is on, with no list and no countdown.

| Permission | What it lets a member do | Risk if granted |
|---|---|---|
| See waiting changes | See the list of changes waiting out the 24-hour hold, before and after, with the countdown. | Privacy: the lead's login, wallet and team changes. |
| Untick or cancel waiting changes | Stop one or all waiting changes from applying. | Money: cancelling can block a security fix the lead wanted; it can also save the account from a thief's changes. |
| End a hold | Close the 24-hour hold early so the changes apply now. | Money and security: the hold exists to give you time to catch a thief; ending it removes that time. |

Count: 7 + 8 + 9 + 7 + 3 = **34**. The board's heading line reads "In 2 of 5 types · 9 of 34 things allowed" for the sample member.

---

## 2. Never available to members

The board's footer line reads: "Never available to members: wallets, security, sessions, team settings, account type and deleting the account." Why each stays with the lead:

- **Wallets.** The payout wallet is where the money goes; whoever controls it controls everything the team does. The Team board already promises "Members can never change payout wallets."
- **Security.** Login methods, PGP keys, recovery codes. Letting a member change these is letting them lock you out.
- **Sessions.** Setting the account's session lengths and ending other people's sessions. Members do manage their own session and can extend it with their own login (your Q73); they can't touch anyone else's.
- **Team settings.** Inviting, approving, removing or re-permissioning members. Otherwise one member could promote themselves or kick others; you decided only the lead removes members (G57).
- **Account type.** Becoming or ceasing to be a vendor changes the fees, limits and rules for the whole account.
- **Deleting the account.** Final, and with your 24-hour hold it is the one change a thief most wants.

Design also recommends adding one word to that line, so it matches p4-8: "Never available to members: wallets, security, sessions, team settings, account type and deleting the account. **Starting a hold** is the lead's too." (Members can be granted seeing, unticking or ending a hold, but never making one: a hold is started by a change the lead makes.)

---

## 3. Defaults

Important: today's board does **not** show defaults. Its three views (offers-and-chat, trades-with-release, everything) are examples to show the layout. The Team, TeamRefusal and MemberApproval boards still show the older four presets as starting points (Chat only 2 of 34, Offers manager 5, Trade handler 9, Everything allowed 34). A real default for a freshly approved member has never been decided. Design recommends the following, built on one rule: **a new member can talk and look, but cannot move money or change public things until you tick it.**

| Type | Permission | Default for a new member |
|---|---|---|
| Chat | Read trade chats | On |
| Chat | Reply in trade chats | On |
| Chat | Send payment details in chat | Off |
| Chat | Upload proof in chat | Off |
| Chat | Nudge the other trader | On |
| Chat | See the trader's profile notes | Off |
| Chat | Block a trader | Off |
| Offers | See all offers | On |
| Offers | Turn offers on or off | Off |
| Offers | Edit prices | Off |
| Offers | Edit amount bands | Off |
| Offers | Edit payment types and instructions | Off |
| Offers | Edit currencies | Off |
| Offers | Post a new offer | Off |
| Offers | Delete an offer | Off |
| Trades | Accept a trade | Off |
| Trades | Decline a trade | On |
| Trades | Mark "I've paid" | Off |
| Trades | Confirm payment received | Off |
| Trades | Release XMR | Off (and stays off until you confirm the warning) |
| Trades | Ask to cancel | Off |
| Trades | Open a dispute | On |
| Trades | Reply in a dispute | On |
| Trades | Leave feedback | Off |
| Records | See trade history | On |
| Records | Export trade history | Off |
| Records | See team activity log | On |
| Records | See payout amounts | Off |
| Records | See reviews | On |
| Records | Reply to reviews | Off |
| Records | See support tickets | Off |
| Holds | See waiting changes | Off (your decision, p4-8) |
| Holds | Untick or cancel waiting changes | Off (your decision, p4-8) |
| Holds | End a hold | Off (your decision, p4-8) |

That is 10 of 34 on by default. Reasoning per type:

- **Chat.** A new member's job is usually to answer customers, so reading, replying and nudging are on; payment details, proofs, your private notes and blocking all carry money or lasting consequences, so they wait for your tick.
- **Offers.** Seeing the offers is needed to answer questions about them, but every edit changes what you are publicly promising or the price you get, so all edits stay off.
- **Trades.** Declining, opening a dispute and answering a moderator protect you rather than cost you, so they are on; accepting, marking paid, confirming received, releasing, cancelling and feedback all move money or your record, so they are off.
- **Records.** History, the team log and public reviews let a member do their job and see their own actions; exports, payout amounts, replying publicly and tickets reveal or speak for the account, so they are off.
- **Holds and waiting changes.** Off by your decision: the hold is your safety net against a stolen login, and a member who can end it is a hole in that net.

---

## 4. Open questions for the owner

Each with design's recommendation first, then the question in two lines.

**Q-A. Release XMR without the lead's tap.**
Recommendation: allow it only with the tick as drawn, with the warning and confirm step, and log every release with the member's name. Do not add a per-release lead tap, which would make a release-capable member pointless.
Question: should any member ever release XMR without you tapping each release? The board allows it once you tick the SENSITIVE box and confirm.

**Q-B. Block a trader at member level.**
Recommendation: keep it as a tick, off by default; a block made by a member should appear in the team log with a one-tap undo for the lead.
Question: should a member be able to block a trader, or should blocking stay the lead's? A block quietly loses you a customer, but front-line staff are the ones who meet the abuse.

**Q-C. Members seeing your profile notes.**
Recommendation: keep it a tick, off by default, and rename it to say whose notes they are: "See your notes on traders."
Question: should members ever read the private notes you keep on traders? They help a member spot a known problem, but they are your words.

**Q-D. Posting a new offer.**
Recommendation: keep the tick, off by default; a member's new offer should show "Posted by desk_ana" in your My offers list and the team log.
Question: should a member be able to post a new offer in your name, inside your 3 + 3 limit? A new offer is a public promise and uses one of your six slots.

**Q-E. Per-member trade limits (an amount cap).**
Recommendation: yes, add one optional cap per member, in XMR, on Accept, Confirm payment received and Release; above the cap the trade waits for you. This needs a new field on the member's permissions screen and a build task.
Question: should you be able to say "desk_ana may handle trades up to 0.5 XMR, nothing bigger"? Today a tick is all or nothing.

**Q-F. Time-boxing a member (login hours, like staff).**
Recommendation: yes, reuse the staff on/off switch plus days and hours (Q56) for members; it is the same control, built once. Default: always on.
Question: should a member's permissions only work during set hours and days? Staff already get this; members do not.

**Q-G. Telling the partner a team member is replying.**
Recommendation: keep today's rule exactly: the partner sees "Team member · satoshi_ghost's team" and never a name. The lead sees the name and so does the audit log.
Question: should the partner ever learn which member replied, or that a member rather than you did? Today they learn the second but never the first.

**Q-H. Approving a member's first login (MemberApproval).**
Recommendation: approval stays for every member's first login, and also for a member's first login on a new device. It is cheap for you and it is the moment a stolen invite link gets caught.
Question: the MemberApproval board is a lead's approval of a member's first login after they use the invite link. Should that stay for all members and all new devices, or only for brand-new members?
Note: the board's approved state reads "You start as Trade handler (9 of 34 allowed)", a preset; with Q16 it should read what you actually ticked.

**Q-I. "End a hold" and the 24-hour rule.**
Recommendation: "End a hold" should mean "apply the waiting changes now", and it should only work from a passkey, security key or PGP key login, the same strength the lead would need. From a username-and-password login the tick is dead.
Question: a member with "End a hold" can collapse the 24 hours you gave yourself to catch a thief. Should the tick exist at all for a member, and if so should it need a strong login every time?

**Q-J. Members seeing the lead's waiting changes (G31 vs p4-8).**
Recommendation: p4-8 wins: a member sees the list only with the "See waiting changes" tick; the HoldChange aside citing G31 as absolute should be updated.
Question: on 7 Nov you said team members can't see the lead's waiting changes (G31), and later that seeing them is a permission the lead grants (p4-8). Confirm p4-8 is the rule.

**Q-K. Removals: at once or after 24 hours (G57 vs p5-7).**
Recommendation: one rule for every waiting change, including removals: nothing applies early, and the lead can untick any of them during the wait (p5-7, as the HoldChange board now draws it).
Question: G57 says a lead's kick-out from a username-and-password login takes effect at once and is final after 24 h; p5-7 says removals wait like everything else. Which stands? The boards follow p5-7.

**Q-L. The Team board's four presets.**
Recommendation: drop the presets from Team, TeamRefusal and MemberApproval; show the member's type count and ticked count ("In 2 of 5 types · 9 of 34 allowed") and let "Edit what they can do" open the full checkbox screen. Or keep them as one-tap starting points that just pre-tick boxes.
Question: Q16 replaced presets with types and checkboxes, but three boards still name Chat only, Offers manager, Trade handler and Everything allowed. Keep them as shortcuts, or remove them?

**Q-M. Which permissions count as sensitive.**
Recommendation: only Release XMR gets the warning and confirm; add Confirm payment received as a second, since it is the step that leads straight to release. Nothing else.
Question: MemberPermissions warns only on Release XMR; the Team board's preset text also calls accepting trades, confirming payments and posting or editing offers sensitive. Which list is right?

**Q-N. Types and box counts versus Q16.**
Recommendation: accept five types with uneven counts (7, 8, 9, 7, 3); the fifth came from your own p4-8 and three rights is all a hold needs.
Question: on 6 Nov you asked for three or four types with 7 to 10 boxes each. The board now has five, and Holds has three. Is that fine?

**Q-O. The member's "a hold is on" view.**
Recommendation: a one-line banner for members without hold rights: "A 24-hour hold is on this account. Ask satoshi_ghost." No count, no countdown.
Question: p4-8 says a member without hold permissions "just sees that a hold is on", but no board draws that view. Is the one-line banner what you meant?

**Q-P. Moderator contact in the hold warning (HoldChange OPEN).**
Recommendation: the Matrix address first, Telegram second, both as links with dark-ink hover (G40); until supplied the warning says "or message a moderator".
Question: which Matrix and Telegram addresses should the warning show? You said they'd be set up near the end of design (G49).

**Q-Q. Shared tickets versus member feedback (Q69) on this screen.**
Recommendation: show "See support tickets" to members only with the tick (off by default), and count each member's feedback separately, as decided.
Question: tickets are shared across a team and feedback is per member. Should the daily limit of 10 (Q67) count a member's tickets against the whole team's 10, as decided, even when the lead has used them up?

---

## Summary

- 34 permissions in five types, as the board draws them; only Release XMR is marked sensitive, and the three hold rights are off for members by your decision.
- No defaults exist today, only examples and old presets; design recommends 10 of 34 on for a new member: read, reply, nudge, see offers, decline, dispute, answer a moderator, and see history, the team log and reviews.
- 17 questions for you; the three that change screens most are per-member amount caps, login hours for members, and dropping or keeping the four presets.
