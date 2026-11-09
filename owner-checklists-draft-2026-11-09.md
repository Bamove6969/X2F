# Owner checklists, draft (9 Nov 2026)

Draft for the lead, to turn into the owner's tick page. Asked for tonight (p11-22, p11-27).
Sources: spec 2.2 to 2.4, 6.3, 6.6, 6.7; owner decisions of 6 to 8 Nov; page 11 answers 21 to 28;
design's team-permissions-review (wip/design-brief, 8 Nov, unsigned); the Jabber branch
(origin/wip/lead-jabber-notices); team code on main.

Every name and default below is a suggestion. The owner ticks, unticks, and adds his own rows.

---

## A. Secure Jabber alerts: which events send one

How to read a row:
- **Who gets it:** You (any trader), Lead (team lead), Member, Buyer, Seller, or a staff role.
- **Default:** what the box starts as on a new account. The person can change it on the
  Jabber settings page the owner asked for (p11-27).
- **Built:** "Yes" means the Jabber branch already sends something for it today.

Today's build sends only two fixed sentences, never any detail (owner rule p5-7):
- "An account change was made on your X2F account." (every "Yes" or "Partly" row)
- "A trade on your X2F account needs your attention." (dispute opened, to the buyer only)

So a per-event page means each event needs its own short sentence. Question for the owner:
may a message say what kind of event it was (for example "A new wallet was added"),
or must it stay as vague as today?

### A1. Logins and devices

| # | Tick | Event | What it means | Who gets it | Default | Built |
|---|---|---|---|---|---|---|
| 1 | [ ] | New login | Someone logged in to the account | You; Lead for members | On | No (push only) |
| 2 | [ ] | Device asks to log in | A new device wants in; approve or block it | You | On | No |
| 3 | [ ] | New device approved or blocked | A device was let in, or refused, from the prompt | You | On | No |
| 4 | [ ] | Session ending soon | Your login ends in 5 minutes unless extended | You | Off | No |
| 5 | [ ] | Member's first login | A new team member logged in for the first time | Lead | On | No |
| 6 | [ ] | Member outside hours | A member tried to log in outside their hours | Lead | On | No |

### A2. Security changes and holds

| # | Tick | Event | What it means | Who gets it | Default | Built |
|---|---|---|---|---|---|---|
| 7 | [ ] | Login method added | A passkey, key, PGP key or authenticator was added | You | On | Yes |
| 8 | [ ] | Login method removed or changed | A method was removed, or the password changed | You | On | Yes |
| 9 | [ ] | New recovery codes | A fresh set of recovery codes was made | You | On | Yes |
| 10 | [ ] | Recovery code used | Someone logged in with a recovery code | You | On | No |
| 11 | [ ] | 24-hour hold started | Changes from a weak login are waiting 24 hours | You; Lead | On | Yes |
| 12 | [ ] | Hold ended early | A strong login ended the hold | You; Lead | On | Yes |
| 13 | [ ] | Waiting changes applied | The 24 hours passed; the changes now apply | You; Lead | On | Partly |
| 14 | [ ] | Waiting change cancelled | Someone unticked or cancelled a waiting change | Lead | On | Yes |
| 15 | [ ] | Account setting changed | Display name, logout timer, one-device rule and similar | You | On | Yes |
| 16 | [ ] | Jabber alerts changed | Jabber turned on or off, or address changed | You | Always on | Yes |
| 17 | [ ] | Block list or nudges changed | You blocked or unblocked someone, or changed nudge settings | You | Off | Yes |
| 18 | [ ] | Past reputation decided | Staff accepted or refused your old-site reputation | You | On | Yes |

### A3. Wallets

| # | Tick | Event | What it means | Who gets it | Default | Built |
|---|---|---|---|---|---|---|
| 19 | [ ] | Wallet added | A payout wallet was added | You | On | Yes |
| 20 | [ ] | Wallet ready | A new wallet's 24-hour wait ended; it can be paid now | You | On | No |
| 21 | [ ] | Wallet removed | A payout wallet was removed | You | On | Yes |
| 22 | [ ] | XMR sent to your wallet | A trade released XMR to you | Buyer | On | No |
| 23 | [ ] | Refund back to you | Escrow returned your XMR to your wallet | Seller | On | No |

### A4. Team

| # | Tick | Event | What it means | Who gets it | Default | Built |
|---|---|---|---|---|---|---|
| 24 | [ ] | Invite sent | A team invite link was made | Lead | On | Yes |
| 25 | [ ] | Invite accepted | The invited person set up their login (p11-21) | Lead | On | Yes |
| 26 | [ ] | Member's abilities changed | A member's ticked boxes changed | Lead; that Member | On | Yes |
| 27 | [ ] | Member removed | A member was removed from the team | Lead | On | Yes |
| 28 | [ ] | Member's login changed | A member changed their own login methods or codes | Lead | On | Yes |
| 29 | [ ] | Member hit their limit | A trade is over the member's size band; it waits for you | Lead | On | No |
| 30 | [ ] | Member blocked a trader | A member blocked someone (you can undo it) | Lead | On | No |
| 31 | [ ] | Member opened a dispute | A member called a moderator on a trade | Lead | On | No |
| 32 | [ ] | Member changed an offer | A member posted, edited, paused or deleted an offer | Lead | Off | No |

### A5. Offers

| # | Tick | Event | What it means | Who gets it | Default | Built |
|---|---|---|---|---|---|---|
| 33 | [ ] | Offer taken | "Someone accepted your offer"; a trade has started | Offer poster | On | No |
| 34 | [ ] | Pre-trade chat | Someone messaged you about one of your offers | Offer poster | Off | No |
| 35 | [ ] | Offer paused by X2F | An offer was hidden (no market rate, hold, ban, lien) | Offer poster | On | No |

### A6. Trades: each step someone waits on

| # | Tick | Event | What it means | Who gets it | Default | Built |
|---|---|---|---|---|---|---|
| 36 | [ ] | Fund the escrow now | Trade accepted; you have 30 minutes to fund | Seller | On | No |
| 37 | [ ] | Seller didn't fund | The seller ran out of time; you are free to go | Buyer | On | No |
| 38 | [ ] | Escrow secured: pay now | Escrow is safe; your 90 minutes to pay start | Buyer | On | No |
| 39 | [ ] | Pay time running low | 15 minutes left to send payment | Buyer | On | No |
| 40 | [ ] | More time given | The seller gave you 30 more minutes | Buyer | On | No |
| 41 | [ ] | Seller is cancelling | Last 15 minutes: if you paid, tap "I've paid" now | Buyer | On | No |
| 42 | [ ] | Buyer says paid | Buyer tapped "I've paid"; check your bank | Seller | On | No |
| 43 | [ ] | Confirm time running low | Your time to confirm the payment is nearly up | Seller | On | No |
| 44 | [ ] | Seller hasn't confirmed | The seller missed the window; you can open a dispute | Buyer | On | No |
| 45 | [ ] | Cancel asked | The other side proposed a mutual cancel | Other trader | On | No |
| 46 | [ ] | Buyer cancelled | The buyer cancelled; your XMR is on its way back | Seller | On | No |
| 47 | [ ] | Tap Confirm cancel | Your XMR is fully back; confirm to close the trade | Seller | On | No |
| 48 | [ ] | Trade complete | XMR released; the trade is done | Both | On | No |
| 49 | [ ] | New trade chat message | A message arrived in an open trade | Both | Off | No |
| 50 | [ ] | Gift card handed over | Card details sent; you have 45 minutes to check it | Escrow holder | On | No |
| 51 | [ ] | Leave a review | The trade is done; rate your partner | Both | Off | No |

### A7. Disputes and rulings

| # | Tick | Event | What it means | Who gets it | Default | Built |
|---|---|---|---|---|---|---|
| 52 | [ ] | Dispute opened | A moderator was called on your trade | Both | On | Buyer only |
| 53 | [ ] | Don't send money | The other side disputed before you paid (p11-16) | Buyer | On | No |
| 54 | [ ] | Moderator joined | A moderator is now in the dispute room | Both | On | No |
| 55 | [ ] | Moderator needs you | The moderator asked you something; reply soon | Both | On | No |
| 56 | [ ] | Ruling made | The moderator decided; see the outcome | Both | On | No |
| 57 | [ ] | Appeal closing soon | A few hours left to file an appeal | Both | On | No |
| 58 | [ ] | Appeal filed | The other side appealed the ruling | Both | On | No |
| 59 | [ ] | Appeal decided | The appeal was decided | Both | On | No |
| 60 | [ ] | Trading hold on or off | A moderator paused or restored your trading | You | On | Yes |
| 61 | [ ] | Lien on or off | You must repay before trading; or the lien was lifted | You | On | No |
| 62 | [ ] | Owed XMR arrived | The losing side sent what the ruling ordered | Winner | On | No |

### A8. Staff and moderator events (staff accounts)

Today's build gives staff and owner accounts no Jabber set-up at all. These rows are all new.

| # | Tick | Event | What it means | Who gets it | Default | Built |
|---|---|---|---|---|---|---|
| 63 | [ ] | Dispute assigned | A new dispute is yours | Moderator | On | No |
| 64 | [ ] | Reply deadline near | Your first-reply deadline on a case is close | Moderator | On | No |
| 65 | [ ] | Trader replied | A trader wrote in your dispute room | Moderator | On | No |
| 66 | [ ] | Co-approval needed | A large-trade ruling waits for your approval | Senior; Owner | On | No |
| 67 | [ ] | Appeal assigned | An appeal is yours to decide | Senior; Owner | On | No |
| 68 | [ ] | Your ruling overturned | An appeal overruled you; pay will be clawed back | Moderator | On | No |
| 69 | [ ] | Shift ending | Your login hours end soon; clock out to get paid | Staff | On | No |
| 70 | [ ] | New support ticket | A ticket arrived in your category | Helper | Off | No |
| 71 | [ ] | Staff login | Someone logged in to your staff account | Staff | Always on | No |
| 72 | [ ] | Staff changed | A staff member was added, removed or switched off | Owner | On | No |

### A9. Account closing, bans, maintenance and news

| # | Tick | Event | What it means | Who gets it | Default | Built |
|---|---|---|---|---|---|---|
| 73 | [ ] | Account closing | Deletion was asked for; it is final after 24 hours | You; Lead | On | No |
| 74 | [ ] | Ban placed | A trade ban or site ban, with its end time | You; Lead | On | No |
| 75 | [ ] | Ban ended | Your account works fully again | You; Lead | On | No |
| 76 | [ ] | New Terms | New Terms must be accepted before you trade again | You | On | No |
| 77 | [ ] | Maintenance planned | X2F will be down at a set time; timers will pause | Everyone | On | No |
| 78 | [ ] | Maintenance or emergency stop | X2F is paused now, or is back | Everyone | On | No |
| 79 | [ ] | News post | A new post in Site news | Everyone | Off | No |
| 80 | [ ] | Warning banner | An amber warning went up on the site | Everyone | On | No |

### A10. Add your own

| Tick | Event (your words) | What it should do (your words) |
|---|---|---|
| [ ] | ______________________ | ______________________________ |
| [ ] | ______________________ | ______________________________ |
| [ ] | ______________________ | ______________________________ |

(The page gets an "Add another" button that adds a row like these.)

---

## B. Team member abilities: what a lead can tick for a member

How to read a row:
- **Risk:** what a careless or dishonest member could cost you. Low, Medium or High.
- **Offers / Trades:** the box's start state for each of the two bundles the owner approved
  on 29 Oct (Offers: create, delete, adjust and maintain offers. Trades: accept trades,
  upload proof, mark money sent, complete transactions).
- **Start set:** the 10 boxes every new member gets (design A, approved p7-12).
- **Ruled:** an earlier owner ruling that already fixes the box. "Lead only" means members
  never get it.

Three things apply on top of the boxes (owner rulings, not boxes):
- **Trade-size band** (p7-4): a member only handles trades inside the size the lead sets.
- **Working hours** (p7-11): "any time" or set days and hours.
- **Manager preset** (p7-5): one click ticks a recommended set; the lead can untick any.

### B1. Offers

| # | Tick | Ability | Lets the member | Risk | Offers | Trades | Ruled |
|---|---|---|---|---|---|---|---|
| 1 | [ ] | See offers | See every offer, live or paused | Low | On | On | Start set |
| 2 | [ ] | Pause or resume offers | Turn offers off and on | Medium | On | Off | 29 Oct bundle |
| 3 | [ ] | Edit prices | Change the market percentage or fixed price | High | On | Off | 29 Oct bundle |
| 4 | [ ] | Edit amounts and minimums | Change trade sizes and minimum completed trades | Medium | On | Off | 29 Oct bundle |
| 5 | [ ] | Edit payment methods | Change which methods an offer takes, and its instructions | High | On | Off | 29 Oct bundle |
| 6 | [ ] | Edit currencies | Change which currencies an offer is in | Medium | On | Off | 29 Oct bundle |
| 7 | [ ] | Post a new offer | Create an offer, within the 3 buy + 3 sell limit | Medium | On | Off | 29 Oct bundle |
| 8 | [ ] | Delete an offer | Remove an offer for good | Medium | On | Off | 29 Oct bundle |

### B2. Trades

| # | Tick | Ability | Lets the member | Risk | Offers | Trades | Ruled |
|---|---|---|---|---|---|---|---|
| 9 | [ ] | See active trades | See the account's open trades | Low | On | On | - |
| 10 | [ ] | See trade history | See past trades: amounts, partners, dates | Low | Off | On | Start set |
| 11 | [ ] | Export trade history | Download the history as a file | Medium | Off | Off | - |
| 12 | [ ] | Accept a trade | Say yes to a trade request on your offer | High | Off | On | 29 Oct bundle; needs member keys first |
| 13 | [ ] | Take someone's offer | Start a trade from another trader's offer | High | Off | On | 29 Oct bundle; needs member keys first |
| 14 | [ ] | Decline a trade | Say no to a trade request | Low | On | On | Start set |
| 15 | [ ] | Pick the payout wallet | Choose which of your wallets a trade pays into | Medium | Off | On | Your list only; needs member keys first |
| 16 | [ ] | Mark "I've paid" | Tell the seller your money was sent | High | Off | On | 29 Oct bundle |
| 17 | [ ] | Give more time | Give the buyer 30 more minutes to pay | Low | Off | On | - |
| 18 | [ ] | Cancel a trade | Cancel or agree a cancel where the rules allow | Medium | Off | On | Built in Trades role |
| 19 | [ ] | Cancel a no-show | Get the refund when the buyer never paid | Medium | Off | On | Built in Trades role |
| 20 | [ ] | Confirm cancel | Close a cancelled trade once the XMR is back | Low | Off | On | Built in Trades role |
| 21 | [ ] | Confirm payment received | Say the buyer's money arrived | High | Off | Off | Lead only (p10-2) |
| 22 | [ ] | Release XMR | Send escrowed XMR to the buyer | High | Off | Off | Lead only (p10-2) |
| 23 | [ ] | Fund the escrow | Pay XMR into escrow when you sell | High | Off | Off | Lead only until member keys exist |
| 24 | [ ] | Leave a review | Rate the partner after a trade | Medium | Off | Off | - |

### B3. Chat

| # | Tick | Ability | Lets the member | Risk | Offers | Trades | Ruled |
|---|---|---|---|---|---|---|---|
| 25 | [ ] | Read trade chats | Read the chat of any trade | Low | On | On | Start set |
| 26 | [ ] | Reply in trade chats | Write to partners as your team | Medium | On | On | Start set |
| 27 | [ ] | Read and reply to pre-trade chats | Answer people asking about your offers | Medium | On | On | - |
| 28 | [ ] | Send payment details | Send your bank or app details with the payment form | High | Off | Off | - |
| 29 | [ ] | Nudge | Send the wake-up nudge to a partner | Low | On | On | Start set |
| 30 | [ ] | Block a trader | Block someone; you see it in the log and can undo it | Medium | Off | Off | p7-6 |
| 31 | [ ] | View notes on traders | Read the account's private notes on traders | Low | Off | Off | p7-8 |
| 32 | [ ] | Add notes on traders | Add a note, signed with name and time; no deleting | Low | Off | Off | p7-8 |

### B4. Proof

| # | Tick | Ability | Lets the member | Risk | Offers | Trades | Ruled |
|---|---|---|---|---|---|---|---|
| 33 | [ ] | Upload proof | Attach a payment photo or video | Medium | Off | On | 29 Oct bundle |
| 34 | [ ] | See the partner's proof | See the proof the other side uploaded | Low | Off | On | - |
| 35 | [ ] | Answer the blur check | Say whether the blur hid private details | Low | Off | On | - |

### B5. Disputes

| # | Tick | Ability | Lets the member | Risk | Offers | Trades | Ruled |
|---|---|---|---|---|---|---|---|
| 36 | [ ] | Open a dispute | Call a moderator in on a trade | Medium | On | On | Start set |
| 37 | [ ] | Answer the moderator | See the whole dispute room and reply | High | On | On | Start set; p7-7 |
| 38 | [ ] | File an appeal | Appeal a ruling within 48 hours | Medium | Off | On | Built in Trades role |

### B6. Wallets and money

| # | Tick | Ability | Lets the member | Risk | Offers | Trades | Ruled |
|---|---|---|---|---|---|---|---|
| 39 | [ ] | See wallet names | See the wallet list (names and address endings) | Low | Off | On | - |
| 40 | [ ] | See payout amounts | See how much XMR reached your wallets | Medium | Off | Off | - |
| 41 | [ ] | See fees paid | See the 1% fees the account paid | Low | Off | Off | - |
| 42 | [ ] | Add or remove wallets | Change where your money goes | High | Off | Off | Lead only |
| 43 | [ ] | Repay a lien | Start the repayment trade that lifts a lien | High | Off | Off | - |

### B7. Team administration

| # | Tick | Ability | Lets the member | Risk | Offers | Trades | Ruled |
|---|---|---|---|---|---|---|---|
| 44 | [ ] | See the team | See who is on the team and what each may do | Low | On | On | - |
| 45 | [ ] | See the team log | See who did what, and when | Low | On | On | Start set |
| 46 | [ ] | See waiting changes | See changes waiting out a 24-hour hold | Medium | Off | Off | p4-8: lead grants it |
| 47 | [ ] | Cancel waiting changes | Untick or cancel waiting changes | High | Off | Off | p4-8; team changes asked p11-22 |
| 48 | [ ] | End a hold | Apply waiting changes now | High | Off | Off | p4-8 |
| 49 | [ ] | Invite members | Send a team invite | High | Off | Off | Lead only |
| 50 | [ ] | Remove members | Kick a member out | High | Off | Off | Lead only (G57) |
| 51 | [ ] | Change abilities | Tick or untick another member's boxes | High | Off | Off | Lead only |

### B8. Security and sessions

| # | Tick | Ability | Lets the member | Risk | Offers | Trades | Ruled |
|---|---|---|---|---|---|---|---|
| 52 | [ ] | Own login methods | Set up their own login, any strength | Low | On | On | Always on (p7-9) |
| 53 | [ ] | Own recovery codes | Make their own recovery codes | Low | On | On | Always on (p11-28) |
| 54 | [ ] | Extend own session | Stay logged in with their own login | Low | On | On | Always on (Q73) |
| 55 | [ ] | Account security settings | Change the account's logins, holds or timers | High | Off | Off | Lead only |
| 56 | [ ] | End others' sessions | Log out other devices or members | High | Off | Off | Lead only |
| 57 | [ ] | Approve new devices | Let a new device into the account | High | Off | Off | Lead only |

### B9. Account

| # | Tick | Ability | Lets the member | Risk | Offers | Trades | Ruled |
|---|---|---|---|---|---|---|---|
| 58 | [ ] | See reviews | Read the reviews on your profile | Low | On | On | Start set |
| 59 | [ ] | Reply to reviews | Post public replies in your name | Medium | Off | Off | - |
| 60 | [ ] | See support tickets | Read the account's tickets to X2F staff | Medium | Off | Off | - |
| 61 | [ ] | Open support tickets | Write to X2F staff (shared limit of 10 a day) | Low | Off | Off | Q69: shared across team |
| 62 | [ ] | Send X2F feedback | Use "How's X2F doing?" (own limit) | Low | On | On | Q69: per member |
| 63 | [ ] | Edit profile | Change the display name or profile | Medium | Off | Off | Not ruled; lead suggests lead only |
| 64 | [ ] | Change alert settings | Change the account's push and Jabber alerts | Medium | Off | Off | Lead only (lead default) |
| 65 | [ ] | Account type | Become or stop being a vendor | High | Off | Off | Lead only (design) |
| 66 | [ ] | Delete the account | Close the account for good | High | Off | Off | Lead only |

### B10. Add your own

| Tick | Ability (your words) | What it should let them do (your words) |
|---|---|---|
| [ ] | ______________________ | ______________________________ |
| [ ] | ______________________ | ______________________________ |
| [ ] | ______________________ | ______________________________ |

---

## Types or granular?

The owner asked (p11-22): different types of member, or only different ticks?
His earlier answers point both ways: two roles (29 Oct), "3 or 4 types, 7 to 10 boxes each" (Q16),
a Manager preset (p7-5), and the 10-box start set (p7-12).

**Option 1. Ticks only.** Every member is the same kind; only their ticks differ.
- Good: simplest; nothing hidden.
- Bad: 60-odd boxes to go through for every new member.

**Option 2. Types with their own boxes.** The lead puts a member in one or more types
(for example Chat, Offers, Trades, Records, Holds), then ticks boxes inside each.
Design's current boards do this.
- Good: tidy screen; matches Q16.
- Bad: "type" means two things (a folder and a job); harder to explain.

**Option 3. Ticks underneath, presets on top (recommended).** One list of boxes is the only
truth. Presets such as **Offers**, **Trades** and **Manager** are one-click starting points:
they tick a set of boxes, then the lead can tick or untick any box. The screen groups the boxes
by area (as in section B) so it stays readable.
- Good: keeps the two roles and the Manager preset the owner already approved; a new lead is
  set up in one click; nothing is ever locked into a type.
- Good: chat labels stay "Circa 55 Assistant 1" (p11-25), whatever the member's ticks.
- Bad: after a lead unticks a box, the member no longer matches any preset (the screen just says
  "Custom").

Recommendation: Option 3.
