# Guided tours: shell and stops (brief item 2, 12 Nov)

Worker T2 (tour-stops). Source: to-design-2026-11-12.md item 2, owner comment 47, and the owner's 12 Nov additions (staff tour, team-member tour, X2F's own look).
Pages, selectors and roles come from origin/main:
- web app: `apps/web/src/App.tsx`, `ui/BottomNav.tsx`, `ui/DesktopShell.tsx`, `session/member.ts`;
- staff web: `apps/staff-web/src/ui/StaffShell.tsx` and `packages/staff/src/roles.ts` (`NAV`, `navFor`, `GRANTABLE_PERMS`);
- team abilities: `apps/api/src/team/abilities.ts`.

Every card title and body below is **COPY-UNSIGNED**, and so are the shell labels.

Who does what: the animated isometric 3D scenes and all motion values belong to T1's motion board. This file covers the still shell and every stop.
Owner, 12 Nov: the tours use X2F's own look. Only the 3D quality and polish come from the Trust Wallet reference. The shell, the cards and the arrows use our tokens, our type and our shapes.

---

## 1. Tour shell: READY

Boards (new; the head designer adds them to canvas.json):

| Board | Size | Sits next to | Props |
|---|---|---|---|
| `TourShell.dc.html` | 390 × **2220** (phone frame 844, then the arrow strip and notes 1376) | Landing (and BuyMain) | `theme` night/day; `view` stop / next-screen / all-set / replay; `step` 1–7 |
| `TourShell-Wide.dc.html` | 1280 × **1474** (wide frame 800, then the strip and notes 674) | Landing-Wide (and Desktop) | same |

The board can be clicked through: Next and Back step through the 7 stops of page 1 (Find a trade), Skip tour closes the tour, and Restart starts it again. On this board, Next screen goes straight to the end card, because only page 1 is drawn.

### Parts (data-part names for the build)
| Part | data-part | Spec |
|---|---|---|
| Scrim | `tour-overlay` | Full screen, `var(--scrim)`, with a hole cut 6 px round the element, radius 14 (an SVG even-odd path, so no box-shadow is needed). Everything behind it is `inert` while the tour runs. |
| Highlight ring | `tour-ring` | The hole's outline, 2 px `--ink`, radius 14: the same "selected" language as everywhere else. Never orange, no glow, no shadow. |
| Arrow | `tour-arrow` | One curved stroke, 2.5 px `--ink`, round caps, an open chevron head. It fills the 40 px gap between the ring and the card, centred on the element (phone) or on the element's middle (wide). |
| Card | `tour-card` (`role="dialog"`, `aria-modal`) | `--surface`, 1 px `--line` border, radius 16, padding 20, gap 12. Phone: x 16, full width less 32. Wide: 340 wide. |
| Page bars | inside the card | One pill bar per page, 4 px tall, gap 4. The current page is `--ink`, done pages are `--ink-muted`, pages still to come are `--surface-raised`. aria-label "Page 1 of 8, Find a trade". |
| Step count | `tour-count` | Mono 14, `--ink-muted`, for example "3 of 7": this stop out of the stops on this page. Per page, so the number never looks long. |
| Title | `#tour-t` | Familjen 22/28 700. |
| Body | `#tour-b` | 17/26, `--ink`. One step bigger than the app's 16 (owner: fonts "noticeably" bigger). At most 2 short sentences. |
| Skip tour | `tour-skip` | A text button, 15/600, `--ink-muted`, on the left. |
| Back | `tour-back` | Secondary, 48 high. Turned off only on stop 1 of page 1. On stop 1 of a later page, Back returns to the last stop of the page before. |
| Next | `tour-next` | Primary (`--monero`), 48 high, min-width 112. This is the only orange on screen while the tour runs. |
| Replay row | `tour-replay` | Settings, Help group: "Take the tour again", with "A quick walk through each screen" under it. |

### Button rules
- Next moves to the next stop on the same page.
- On a page's last stop the button reads **Next screen**, and the app goes to the next page in the tour.
- On the last stop of the last page it reads **Finish**, and the **You're all set** card follows.
- You're all set card:
  - a 56 px tile with an `--escrow` tick;
  - every page bar filled;
  - "You're all set" in Familjen 28/32;
  - the body "That's the tour. You can take it again any time from Settings, under Help.";
  - a primary **Get started** button that closes the tour on Find a trade;
  - links to FAQ, Getting started and Support underneath, so there's no bare space.
- Skip tour closes the tour at once. A status line then shows "Tour closed. Take it again any time from Settings, under Help." with a **Restart** button. It stays for 6 s, or until the next tap.

### Arrow side rule
- The **arrow side** is the card edge the arrow leaves from.
- Phone:
  - **top** (the card sits below the element) when the card fits below and still clears the tab bar;
  - otherwise **bottom** (the card sits above the element).
- Wide:
  - **left** (the card sits right of the element). This is the default, because the column ends at x 880 and the card needs 340 + 40;
  - **right** (the card sits left of the element) only when the element's right edge is past 900;
  - the card's top is clamped inside the frame, so the arrow always meets the card.
- The state strip on both boards draws all four sides.

### Entry and replay
- Start: the landing screen's **Take the tour** (brief item 1) opens page 1, stop 1. "Skip and get started" never starts it.
- Replay:
  - web: Settings, Help, **Take the tour again** (`tour-replay`); on wide it is also under the rail's Help;
  - staff web: a **Take the tour again** link in the rail foot (`.x2f-staff__foot`), under Log out;
  - team member: the same Settings row as the trader, which runs the member tour.
- The tour remembers the last stop on this device. If it is left half done, the replay row reads "Carry on the tour" until it is finished.
- Keyboard:
  - → and Enter mean Next, ← means Back, Esc means Skip tour;
  - focus moves to the card title at each stop and stays inside the card;
  - each stop is announced through the dialog's label and description.
- Tour mode changes nothing. Buttons behind the scrim are inert. Pages that need data the person doesn't have yet (Offers, Offer details, the Trade room, My trades) show the example from `apps/web/src/fixtures` with a neutral **Example** chip under the header.
- Motion: owned by T1. The hooks are `tour-overlay` (scrim), `tour-ring`, `tour-arrow` and `tour-card`, plus the 3D scene layer T1 places behind the card. With reduced motion, the parts swap instantly.

---

## 2. Trader tour (web app): READY

- Pages for a **trader** account: 1–8.
- A **vendor** account also gets the pages marked V, in the order shown. Its count reads "of 11".
- "Phone / Wide" in the Arrow column gives the arrow side for each layout.
- On every page, the last stop reads Next screen. The last stop of the tour reads Finish.

### Page 1 · Find a trade · `/buy` (MethodList, BUY_COPY; board BuyMain)
| # | Element (selector / component) | Title | Card text | Arrow | Button |
|---|---|---|---|---|---|
| 1 | Logo and screen name: `.x2f-browse__brand` (`Logo`; wide: `.x2f-rail__head`) | Where you are | The X2F logo sits top left on every screen, with the screen's name beside it. Tap the logo to come back here. | top / left | Next |
| 2 | Site news: `[data-part="news-bell"]` (NewsBell) | Site news | News from the X2F team lands here. A dot means there's something you haven't read yet. | top / left | Next |
| 3 | Buy or sell: `[role=tablist][aria-label="Buy or sell"].x2f-segment` | Buy or sell | Buy gets you XMR. Sell turns your XMR into cash. Everything below changes to match. | top / left | Next |
| 4 | Active trades, the My trades row (board BuyMain; not on main's MethodList yet) | Your trades | Every trade in progress lives here. The yellow tag tells you when one is waiting on you. | top / left | Next |
| 5 | Market price card, with the currency control (`RadioChips` `#browse-currency`; board BuyMain "Market price") | Market price | Today's XMR price in your currency. Each offer sets its price a little above or below it. | top / left | Next |
| 6 | Search and Sort: `.x2f-browse__filters` plus the Sort `RadioChips` | Find how you pay | Search every payment method, or sort them by most sellers, best rate or A to Z. | bottom / left | Next |
| 7 | First method row: `.x2f-method` (live section) | Pick a payment method | Each one shows how many sellers take it and their best price. Tap one to see the offers. | bottom / left | **Next screen** |

### Page 2 · Offers · `/buy/:methodId` (OffersRoute → OfferList, OfferCard; board BuyOffers; Example)
| # | Element | Title | Card text | Arrow | Button |
|---|---|---|---|---|---|
| 1 | Header and market line: `.x2f-browse__header`, `[data-part="market-updated"]` | One way to pay | Every seller here takes this method. The market price stays on show so you can compare. | top / left | Next |
| 2 | Seller: `.x2f-offer__who` (name, `[data-part="online"]`, `.x2f-offer__badges`) | Who you'd trade with | Their name, badges and whether they're online now. Tap the name to see their profile and reviews. | top / left | Next |
| 3 | Price: `.x2f-offer__price` with `[data-part="markup"]` | Their price | What they ask per XMR, and how far that is from the market price. | top / left | Next |
| 4 | Limits and time: `.x2f-offer__limits`, `.x2f-offer__time` | How much and how fast | The smallest and largest trade they take, and how long they usually take to release. | bottom / left | Next |
| 5 | Take button: `.x2f-offer__action` | Have a look | Tap to see your exact amount before anything is agreed. Starting a trade is always free. | bottom / left | **Next screen** |

### Page 3 · Offer details · `/buy/:methodId/:offerId` (Quote, BuyQuote; board BuyQuote; Example)
| # | Element | Title | Card text | Arrow | Button |
|---|---|---|---|---|---|
| 1 | Amount: `section[aria-label="Amount"].x2f-quote__amount` | Your amount | Type how much you want to pay. You'll see exactly how much XMR you get. | top / left | Next |
| 2 | Wallet: `.x2f-quote__wallets` (WalletPicker) | Where your XMR goes | Pick one of your saved wallets. Your XMR goes straight there when the trade ends. | top / left | Next |
| 3 | What you get: `section[aria-label="What you get"].x2f-quote__card` | The full sum | Rate, network fee and what you receive, all in one place. No surprises later. | bottom / left | Next |
| 4 | Terms: `[data-part="what-applies"]` (WhatApplies) | This seller's terms | The rules for this trade, like how long you have to pay. Have a read before you start. | bottom / left | Next |
| 5 | Request button: `.x2f-quote__footer` ("Request to buy XMR") | Send your request | The seller says yes, then their XMR is locked in escrow. You only pay after that. | bottom / left | **Next screen** |

### Page 4 · Trade room · `/trade/:code` (TradeRoom → BuyerPay; boards BuyerPay, TradeFund; Example)
| # | Element | Title | Card text | Arrow | Button |
|---|---|---|---|---|---|
| 1 | Header: `.x2f-trade-header` (TradeHeader) | Your trade | The trade code and payment method stay at the top. Back takes you to My trades. | top / left | Next |
| 2 | Progress: `[aria-label="Trade progress"].x2f-timeline` (TradeTimeline) | Where things stand | Each step lights up as the trade moves on, so you always know what's next. | top / left | Next |
| 3 | Escrow: `[aria-label="Escrow confirmations"].x2f-escrow` | Safe in escrow | The seller's XMR is locked here. Nobody can move it alone, not even X2F. | top / left | Next |
| 4 | Pay card and timer: `.x2f-pay-card` (`aria-label="Payment details"`), `.x2f-pay-timer` | Pay the seller | Send exactly this amount, the way shown, before the timer runs out. | bottom / left | Next |
| 5 | Chat: `.x2f-room__chat` (TradeChatButton) | Chat | Talk to the other trader here. Chats are end-to-end encrypted. | bottom / left | Next |
| 6 | Actions: `.x2f-action-bar` (I've paid, Add proof) | Tell them you've paid | Once the money's sent, add proof and tap I've paid. Stuck? You can open a dispute. | bottom / left | **Next screen** |

### Page 5 · My trades (board MyTrades; no route on main yet, the BuyMain row links to it; Example)
| # | Element | Title | Card text | Arrow | Button |
|---|---|---|---|---|---|
| 1 | "Active trades" list | Trades in progress | Your open trades, newest first. Tap one to jump back into it. | top / left | Next |
| 2 | Status chip on a row ("Fund escrow", "Check payment") | What's needed | Each trade says what happens next, and who has to do it. | top / left | Next |
| 3 | "Recent" list | Done and dusted | Finished and cancelled trades stay here, so you can look back any time. | bottom / left | **Next screen** |

### Page 6 · Wallets · `/wallets` (Wallets.tsx; board Wallet)
| # | Element | Title | Card text | Arrow | Button |
|---|---|---|---|---|---|
| 1 | Bottom tab or rail: `.x2f-bottom-nav__tab[href="/wallets"]` (wide: `.x2f-rail__link`) | Wallets | Your Monero wallets live under this tab. | bottom / left | Next |
| 2 | List: `[aria-label="Linked wallets"]` `.x2f-wallet-row` | Your wallets | Where your XMR is paid out. Each shows its name and the end of its address. | top / left | Next |
| 3 | Add: `.x2f-wallets__add` | Add a wallet | Paste an address from any Monero wallet app to add it here. | bottom / left | **Next screen** |

### Page 7 · Profile · `/profile` (board Profile; the tab exists, the page is not routed on main yet)
| # | Element | Title | Card text | Arrow | Button |
|---|---|---|---|---|---|
| 1 | Name and badges ("Badges", "Choose badges") | How others see you | Your name and the badges you've earned. You choose which badges show. | top / left | Next |
| 2 | "Recent reviews" | Reviews | What people said after trading with you. Good trades build your name. | bottom / left | **Next screen** |

### V1 · Post an offer · `/post` (PostOffer; board PostOffer; vendor only, shown when `mayPostOffers`)
| # | Element | Title | Card text | Arrow | Button |
|---|---|---|---|---|---|
| 1 | "I want to" (Buy XMR / Sell XMR) and `[aria-label="Payment methods"]` | What you trade | Pick buy or sell, and the ways you'll take payment. | top / left | Next |
| 2 | "Your price" (`.post-margin-box`, Market ± Vendor markup) | Your price | Follow the market with your own markup, so your price moves with it. | top / left | Next |
| 3 | "Trade size and terms" (`.post-amount`, `.post-mintrades`) | Who and how much | Set the smallest and largest trade, and who can trade with you. | bottom / left | Next |
| 4 | Preview: `[aria-label="Preview"].post-preview` | How others see it | This is your offer as traders will see it. You only pay a fee once it's posted. | bottom / left | **Next screen** |

### V2 · My offers · `/profile/offers` (MyOffers; board MyOffers; vendor only)
| # | Element | Title | Card text | Arrow | Button |
|---|---|---|---|---|---|
| 1 | `[data-part="offer"]` | Your offers | Every offer you've posted, with whether it's on or off right now. | top / left | Next |
| 2 | `[data-part="switch"]` | On or off | Turn an offer off when you're away, and back on when you're ready. | top / left | Next |
| 3 | `[data-part="post"]` | Post another | You can have up to 3 buy and 3 sell offers at once. | bottom / left | **Next screen** |

### Page 8 · Settings · `/settings/security` (Security.tsx; board Settings) · the last page for a trader
| # | Element | Title | Card text | Arrow | Button |
|---|---|---|---|---|---|
| 1 | Login methods and `[data-part="devices-link"]` | Keep it locked | Your login methods, devices and recovery code. A security key or PGP is the strongest. | top / left | Next |
| 2 | Alerts and sounds row (Alerts) | Never miss a trade | Turn on Nudges so a new trade wakes you. Jabber alerts work too. | top / left | Next |
| 3 | Help group and `[data-part="tour-replay"]` | Help is here | FAQ, Support and this tour all live here. Replay it whenever you like. | bottom / left | **Finish** (trader) / Next screen (vendor) |

### V3 · Team · `/settings/team` (Team.tsx; board Team; vendor only, the last page for a vendor)
| # | Element | Title | Card text | Arrow | Button |
|---|---|---|---|---|---|
| 1 | `[data-part="team-members"]` | Your team | People who help run your account. Each one has their own login. | top / left | Next |
| 2 | `[data-part="team-invite"]` | Add a member | Send an invite link, then pick exactly what they're allowed to do. | top / left | Next |
| 3 | `[data-part="team-log"]` | Every action recorded | See who did what, and when. Nothing a member does is hidden from you. | bottom / left | **Finish** |

---

## 3. Staff tours (staff-web): READY

How the staff tours work:
- The pages come from `NAV` / `navFor(role, grants)`, so each tour covers only that menu. A granted `feedback.read` adds the Feedback page to a helper's or moderator's tour.
- The staff web is wide-first (the rail in StaffShell), so arrows are left unless noted.
- The tour starts on a staff member's first login (after Invite, or after OwnerSetup for the owner). Replay is the rail foot link.
- Pages that are only a `PageTitle` on main (Disputes, Performance, Training library, Activity log, Settings) take their stops from the board named. Their selectors become real when Plan 4 Tasks 17–20 land.

### Shared shell stops (S): the start of every staff tour
| # | Element | Title | Card text | Arrow | Button |
|---|---|---|---|---|---|
| S1 | `.x2f-staff__brand` (X2F Staff) | Welcome to X2F Staff | This is where the X2F team works. Only staff can get in, and only during your login hours. | left | Next |
| S2 | `nav[aria-label="Staff"].x2f-staff__nav` | Your pages | These are the pages your role uses. You only see what you need. | left | Next |
| S3 | `[data-part="user-chip"]` (RoleChip) | That's you | Your name and role. Your role decides which pages and actions you have. | left | Next |
| S4 | `[data-part="session-countdown"]` (shown in tour mode) | Session time | When your session is close to ending, a countdown appears here. Wrap up before it hits zero. | left | Next |
| S5 | Log out (`.x2f-staff__foot` Button) and the tour-replay link | Logging out | Log out when you step away. You can replay this tour from the link just below. | left | **Next screen** (the helper's ends here: see below) |

### 3a. Helper (`NAV.helper = []`): 1 page, plus Feedback if granted
| # | Page · element | Title | Card text | Arrow | Button |
|---|---|---|---|---|---|
| S1, S3, S4 | as above (S2 is left out: the menu is empty) | | | left | Next |
| H1 | Home · `[data-part="nothing-for-role"]` (NothingForRole) | More on the way | There's nothing here for helpers just yet. When the owner turns on support tickets for you, they'll appear in the menu. | top | Next |
| S5 | as above | | | left | **Finish**, or Next screen with Feedback |
| F1 | Feedback · `[data-part="mood-counts"]` (only with `feedback.read`) | How's X2F doing? | How traders rated X2F over the last 30 days, at a glance. | top | Next |
| F2 | Feedback · "Messages" list | What traders said | Their own words. Read them, spot problems early, and flag anything urgent to the owner. | top | **Finish** |

### 3b. Moderator (`NAV.mod = disputes, training, log`; plus Feedback if granted)
| # | Page · element | Title | Card text | Arrow | Button |
|---|---|---|---|---|---|
| S1–S5 | shell | | | left | … Next screen |
| D1 | Disputes · "Take next case" (board ModQueue) | Take the next case | One tap gives you the oldest case nobody has yet. | left | Next |
| D2 | Disputes · the queue table (Amount, Method, Opened by, Assigned to) | The queue | Every open dispute. Unassigned ones are waiting for someone like you. | top | Next |
| D3 | Disputes · "Overdue" chip | Watch the clock | Overdue means a reply deadline has passed. Those come first. | left | **Next screen** |
| C1 | Case (board ModCase) · "First reply due in" | Your first reply | Say hello to both traders before this runs out. | left | Next |
| C2 | Case · Traders / Trade / Escrow facts | The facts | Who's involved, what was agreed, and where the XMR is. | left | Next |
| C3 | Case · "Payment proof", "Request the original proof" | Check the proof | Look at what each side sent. Ask for the original if a picture looks off. | left | Next |
| C4 | Case · "Full chat", "Message both traders" | Talk it through | Read the whole chat and write to both traders at once. | left | Next |
| C5 | Case · "Your ruling", "Send ruling for approval" | Your ruling | Pick the outcome and explain it. Big trades need a second approval before they count. | left | **Next screen** |
| T1 | Training library · `.x2f-staff-page__title` (no board yet) | Training library | Guides for handling cases. Start here when a case is new to you. | top | **Next screen** |
| L1 | Activity log · "Show", "Trade code" filters (board StaffLog) | Find what happened | Search by trade code to see every step of a case. | top | Next |
| L2 | Activity log · "When / What happened" list | The record | Everything on your cases is logged, so you can always check back. | top | **Finish**, or Next screen with Feedback |
| F1–F2 | Feedback (granted only) | as in 3a | | top | … **Finish** |

### 3c. Senior moderator (`NAV.senior = disputes, training, log, feedback`)
This is the moderator tour (D1–D3, C1–C5, T1, L1–L2), with these changes:

| # | Page · element | Title | Card text | Arrow | Button |
|---|---|---|---|---|---|
| D4 (after D3) | Disputes · "Need a second approval" (ModQueue) | Second approvals | Big rulings wait here for a senior's yes. Check them before your own cases. | left | **Next screen** (D3 then reads Next) |
| C6 (after C5) | Case · "Account action", "Freeze trading" (`accounts.freeze`, `accounts.ban`) | Account action | You can freeze a trader's trading, or ban them, when a case calls for it. Every action is logged. | left | **Next screen** (C5 then reads Next) |
| R1 (new page after Case) | Past reputation check (board StaffImportVerify, `reputation.verify`) | Check past trades | Confirm the trading history a new trader brings from another site. | top | **Next screen** |
| F1–F2 | Feedback (always for seniors) | as in 3a | | top | … **Finish** |

### 3d. Owner (all nine pages)
| # | Page · element | Title | Card text | Arrow | Button |
|---|---|---|---|---|---|
| S1–S5 | shell | | | left | … Next screen |
| O1 | Overview (board StaffOverview) · "Emergency stop", "Pause all new trades" | Emergency stop | Pauses every new trade at once. Use it only when something's really wrong. | left | Next |
| O2 | Overview · "Maintenance mode" | Maintenance | Take the site down for planned work, with a message for traders. | left | Next |
| O3 | Overview · "Announcement banner" | Announcements | Put a short notice at the top of every trader's screen. | left | Next |
| O4 | Overview · "News for traders" (`.x2f-link` to `/overview/news`, NewsEditor) | News | Write the posts traders see under Site news. | left | Next |
| O5 | Overview · "Earnings" (This month, All time) | Earnings | What X2F has earned in fees, by month. | left | Next |
| O6 | Overview · "Ruling waiting for you" (Notifications) | Needs you | Anything waiting for your approval shows up here first. | left | **Next screen** |
| D1–D4 | Disputes | as in 3b and 3c | | | … **Next screen** |
| P1 | Staff · "Add staff member" (board StaffList) | Add staff | Create an invite link for a new helper or moderator. | left | Next |
| P2 | Staff · the table (Role, Login hours, Status) | Your team | Everyone's role, login hours and status at a glance. | top | Next |
| P3 | Staff · grants `.x2f-check` (StaffGrants: tickets, feedback) | Extra access | Give one person extra access, like support tickets or feedback. | left | **Next screen** |
| M1 | Performance · "Moderators" table (board StaffPerformance) | How cases go | Each moderator's cases, reply times and rulings overturned on appeal. | top | Next |
| M2 | Performance · "Period" | Pick a period | Compare this week, last month or all time. | left | **Next screen** |
| Q1 | Prices · "XMR price sources" (Prices.tsx `[data-part="price-settings"]`) | Price sources | Where the XMR price comes from. Several sources keep it honest. | top | Next |
| Q2 | Prices · `[data-part="paused"]` "Paused currencies" | Paused currencies | A currency pauses when its rate can't be trusted. Traders see that it's paused. | top | **Next screen** |
| T1 | Training library (`training.write`) | Training library | Write and update the guides your staff learn from. | top | **Next screen** |
| L1 | Activity log · "Show everything" (`log.read.all`) | Everything, logged | Every event on the site, from every staff member. | top | Next |
| L2 | Activity log · "When / What happened" | The record | Filter by trade code or person to follow any thread. | top | **Next screen** |
| F1–F2 | Feedback | as in 3a | | top | … **Next screen** |
| G1 | Settings · "Staff pay" (board StaffSettings) | Staff pay | Set what helpers and moderators earn. | left | Next |
| G2 | Settings · "Rulings" (Appeal window, First response deadline) | Case rules | How long traders have to appeal, and how fast moderators must reply. | left | Next |
| G3 | Settings · "Fee wallet", "Owner keys" | Money and keys | Where fees are swept and which keys can approve. Every change needs your key. | left | **Finish** |

---

## 4. Team-member tour (a member logged in to a vendor's account): READY

How this tour is built:
- It uses the trader shell on the vendor's web app. `memberOf(session)` is not null.
- A stop shows only when the member's set holds the listed ability, and that ability's screen works for members today.
- Boxes that are `not-built`, `waits-member-keys` or `waits-member-chat-key` get **no stop** until their screens exist: chat, proof, taking or accepting trades, funding, review, nudge, notes. When a box goes live, its stop is added.
- Pages without a single shown stop are left out, and the page bars count only the pages that are left.
- Note: the web app gates on the member's `roles` (offers, trades) today. When the web reads abilities, the "Shows when" column is the rule.

| Page | # | Element | Shows when | Title | Card text | Arrow | Button |
|---|---|---|---|---|---|---|---|
| Find a trade `/buy` | 1 | `.x2f-browse__brand` | always | Whose account this is | You're working in this vendor's account under your own login. Everything you do goes in the team log. | top / left | Next |
| | 2 | `.x2f-segment` | always | Browse offers | See offers to buy or sell, just like any trader. | top / left | Next |
| | 3 | `.x2f-bottom-nav` / `.x2f-rail` | always | Your tabs | You only see the tabs your access covers. Ask the account owner if you need more. | bottom / left | **Next screen** |
| My offers `/profile/offers` | 1 | `[data-part="offer"]` | `offers-see` | The account's offers | Every offer on this account, and whether each is on or off. | top / left | Next |
| | 2 | `[data-part="switch"]` | `offers-pause` | On or off | Turn offers off and back on when the team needs to. | top / left | Next |
| | 3 | `[data-part="select"]`, delete | `offers-delete` | Tidy up | Select an offer to remove it for good. | top / left | Next |
| | 4 | `[data-part="post"]` | `offers-post` | Post an offer | Start a new offer for the account, within its 3 buy and 3 sell. | bottom / left | **Next screen** |
| Post an offer `/post` | 1–4 | as V1 | `offers-post` (Post offer tab: `mayPostOffers`) | as V1 | as V1, with stop 4's last line changed to "The account pays the fee once it's posted." | | … **Next screen** |
| My trades | 1 | "Active trades" | `trades-see-active` | Open trades | The account's trades that are in progress right now. | top / left | Next |
| | 2 | "Recent" | `trades-see-history` | Past trades | Finished trades: amounts, partners and dates. | bottom / left | **Next screen** |
| Trade room `/trade/:code` (MemberRoom) | 1 | StatusCard and `[data-part="member-waiting"]` | `trades-see-active` | Following a trade | Watch each step here. Anything that moves the XMR is done on the owner's device. | top / left | Next |
| | 2 | Give more time (SellerRefund extend) | `trades-extend` | More time | Give the buyer 30 more minutes to pay when they ask. | bottom / left | Next |
| | 3 | `[data-part="member-dispute"]` (DisputeEntry) | `disputes-answer` | If it goes wrong | If a trade party opens a dispute, you can follow it and answer the moderator. | bottom / left | **Next screen** |
| Dispute room `/trade/:code/dispute` (DisputeRoom; Example) | 1 | `[aria-label="Dispute status"]`, `.dispute-deadline` | `disputes-answer` | The dispute | Where it stands and when the next reply is due. | top / left | Next |
| | 2 | `[aria-label="Evidence"].dispute-evidence-chips` | `disputes-answer` | Evidence | What each side has shown the moderator. | top / left | Next |
| | 3 | `.dispute-see-ruling` | `disputes-appeal` | Rulings and appeals | Read the ruling. You have 48 hours to appeal if it looks wrong. | bottom / left | **Next screen** |
| Wallets `/wallets` | 1 | `[aria-label="Linked wallets"]` | `wallets-see` | Where payouts go | The account's wallets, by name and the end of the address. Only the owner can change them. | top / left | **Next screen** |
| Account changes `/settings/changes` (HoldChanges) | 1 | `[data-part="account-changes"]` | `hold-see` | Waiting changes | Changes to the account wait 24 hours before they apply, for safety. | top / left | Next |
| | 2 | Cancel a change (`.x2f-button--tertiary`) | `hold-cancel` | Stop a change | If a change looks wrong, cancel it before it applies. | bottom / left | Next / **Next screen** |
| | 3 | End the hold now | `hold-end` | Apply it now | Skip the wait when you're sure the change is right. | bottom / left | **Next screen** |
| Feedback `/feedback` | 1 | message field and `[data-part="feedback-sent-as"]` | `feedback-send` | Tell us how it's going | Send X2F your thoughts. It goes with your own name, not the account's. | top / left | **Next screen** |
| Settings `/settings/security` (always the last page) | 1 | Login methods | always (`own-login-methods`) | Your own login | You log in with your own methods. Make them strong: a security key or PGP is best. | top / left | Next |
| | 2 | Recovery code | always (`own-recovery-codes`) | Your recovery code | Your own backup way in. Write it down and keep it safe. | top / left | Next |
| | 3 | `[data-part="tour-replay"]` | always | Help is here | FAQ, Support and this tour live here. Replay it whenever you like. | bottom / left | **Finish** |

The smallest tour (the 10-box start set) is Find a trade, Dispute room 1–2 (`disputes-answer`), My trades 2 (`trades-see-history`) and Settings: 4 pages.

---

## Checks
- `node design/tools/check-board.js`: TourShell OK, TourShell-Wide OK.
- `MEASURE=1 tools/render-board.js`: before.root equals root on both boards, in every view:
  - TourShell: 2220 = 2220;
  - TourShell-Wide: 1474 = 1474.
- Rendered and looked at in night and day: stop, next-screen, all-set and replay.
- No existing board was changed, so nothing needed a backup.

## For the owner (one question)
On pages a new trader has no data for yet (Offers, Offer details, the Trade room, My trades), should the tour show a clearly marked **Example**? That's the default here. The alternative is to skip those pages until the person has a real trade.

## Head designer ruling (12 Nov)
- Pages where a new trader has no data yet (Offers, Offer details, Trade room, My trades): show the tour on clearly marked "Example" content. Design decides this; it doesn't need the owner.
