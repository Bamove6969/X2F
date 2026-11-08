# Owner decisions, 6 Nov 2026: apply these
Owner's own words are in owner-answers-page-2026-11-06.md: read them, they win over this summary. Copy changes marked DESIGN go through design first. Where a built branch disagrees, the owner's answer wins.

## claude2 (offers, prices, disputes, sessions, holds, vendor)
- Offers: market ± % only; no fixed-price offers exist; none to migrate (Q1). FlexOffer-Post is the form (Q4). Max 3 amount bands per currency, 5 payment types per offer (Q23). Everything on one offer where possible. Min trades per band: 5, 10, 25, 50 (Q27). More than one band needs a reason: tie a band to something like a trade-count requirement; keep it to the 3-band limit (Q20).
- Pairing: a vendor picks the currencies and the payment methods they deal in, separately. X2F doesn't try to pair them. The taker picks currency and method from dropdowns on the ad (Q5). This replaces the earlier method-first plan.
- Instructions: they change with the payment type picked in the dropdown, so the ad stays short (Q23). Default text idea from the owner: "Payment method chosen: Interac e-Transfer. Please post pertinent details in chat window." DESIGN for wording (Q2).
- Currency list: top five or six most common, then alphabetical, all with flags (Q28). A currency with no market rate should disappear or show a "no rate" tag in the dropdown, and come back in an instant. DESIGN picks which (Q24, Q25). Payment list expansion: own task after Task 34, legal check per type (Q30). Offers limit: exactly 3 + 3; a seventh can't be posted, no on-hold seventh (Q31).
- Prices: max source gap 3% (Q7). Hourly or faster sources only (Q8). Source not shown to users (Q34). Owner gets a notification when a currency drops or comes back, and it returns to the dropdown automatically (Q35). Wants as many currencies as possible: expand past 45 if the limits allow, using owner-followups F3 (Q9). Recommend sources from F2 (Q6).
- Disputes: buyer waits 60 minutes after marking paid, not 30; the clock pauses in maintenance, and that doesn't affect the poster's time (Q10, Q36). Poster has 60 minutes to respond to a request before it closes; once in play, 90 minutes to say the transfer is sent; slow transfer types get a custom time from research F1 plus a margin. Lead brings the table to the owner first (Q11). "Pay now" never shows before escrow is secured (Q12). Nudge frequency still to decide (Q36).
- Hold v3: changes after 24 h apply on their own (Q14). Say "username and password", never "password only" (Q14). A username + PGP login counts as strong: no hold (Q81).
- Sessions: 5-minute warning before a session ends, replacing 2 minutes; extend with the same durations using your own login methods, members too (Q73). Optional idle reminder in personal settings, on or off, own interval (Q75).
- Vendors: an account inactive 60 days closes automatically; to become a trader, open a new account (Q77). No look-alike name bans (Q79).

## claude3 (staff, proof, reputation, disputes screens)
- Owner refused on the trader site; price-health moves to the staff site (Q13). Owner login: PGP key plus security key only, PGP mandatory (Q59), always a security key for serious actions (Q52). Site isn't live until the owner activates with both security keys (Q55). Username = private login name, display name = public (Q54).
- Moderators hold a security key, a PGP key and a passkey; a new device needs two of the three (Q51). Removing staff is permanent; plus an on/off switch and days and hours (Q56). Moderator and helper permissions are granular; senior moderators always get feedback (Q60). Team members too: 3 or 4 types, 7 to 10 checkboxes each, can sit in several types (Q16, Q21).
- Bans: rules list comes later; moderators pick length for now, scam can be lifetime from the start (Q15). Verified imported amount: hard cap 100,000 (Q58).
- Proof: card numbers with commas or apostrophes blurred on pictures only (Q17). Stale date: ask for a fresh screenshot (Q42). Amount not detected: buyer can post anyway, and X2F logs it to improve detection (Q43). Trade code, amount and time are never blurred; names and account numbers are (Q50). "Was this blurred correctly?" on every proof for the first couple of months, then every tenth or twentieth; a No asks for a comment that goes to the feedback readers. Build it (Q47).
- Rulings: money moves at once, a lien covers a reversal (Q37). Feedback follows the final outcome: reversed, none; settled, stays; on appeal it's held, then decided by the result (Q40). Totals follow the final outcome (Q41).
- Disputes screen: hourglass counting down from 24 hours, saying that's the maximum before a moderator steps in, and it's usually quicker. Handle 48 h later. DESIGN (Q38). Frozen account wording: DESIGN (Q39).
- Reputation: the card shows the amount traded to date in XMR, not dollars: this changes what landed (Q63). Imported volume: a separate line per site with proof (Q64).
- Limits: feedback and tickets max 10 a day, with a message explaining it's to stop spam, DESIGN (Q67). Tickets shared across a team, feedback per member: this changes what landed (Q69).

## design
Q2, Q24, Q25, Q38, Q39, Q46 (disclaimer wording and placement), Q47 wording, Q67 message; "of 5" (Q18); the XMR line (Q63); flags in the currency list (Q28).

## Lead brings back to the owner
Explanations asked for: Q3 ranges, Q19 watcher (done), Q26, Q29 and Q33 (My offers, Task 34), Q32, Q44, Q48, Q62, Q66, Q71. Research: Q11 timing table, Q22 gift cards, Q6 sources, Q9 why 45.

# Owner follow-up decisions, 7 Nov. These override anything above.
## claude2
- Pricing: vendor picks above or below and types a percentage, max 50% either way (F1). The board follows this; the owner's 50% wins over the design limit.
- Instructions: per payment type; if blank, the automatic line shows: "Payment method chosen: Interac e-Transfer. Please post pertinent details in chat window." (F2)
- Bands: a band must have something that makes it different. What those things are is still open: propose a list to the lead. Don't allow identical bands (F3).
- Ads: a dropdown shows each payment type and each currency; the taker picks currency, then payment type, on one ad. Those items must be indexed so searches find them (F6, F7).
- Limit: 3 buy + 3 sell, shown in the vendor's settings and the ad builder (F8).
- Timing: instant payment types: 90 minutes before a dispute, replacing the 60. Same or next day: 24 h. Slow types: 48 h to 4 days, and raise the 24 h maximum (F9). Everything else in the research recommendation stands: give common payment types their own timing profile.
- Nudge: once every 15 minutes, with a sound. The owner wants the old ICQ-style car horn. Check the rights first: use an original sound in that style unless we can license it (F10).
- Prices: keep the 3-source middle value; add a 4th source after it passes a Tor check (F11). Currencies: launch with the 45, then add what Coinbase and BitPay both quote; never sanctioned currencies, and check the 45 as well, including RUB (F12).
- Gift cards: keep them. Build clear rules from what Paxful and LocalMonero required, in plain language, with evidence for disputes (F13). Card currency follows its country, short window, evidence checklist, tick-box terms.
- Session length on Devices: this session only (F18).
## claude3
- Trade code hidden by the blur: warn the poster, who can still post. Also post in the trade chat that the automated proof check saw the code obscured (F14).
- Card ending vs amount: read the words before the digits. "Trade code" or "Amount" stays clear, and the others are blurred if they look personal (F15).
- 4-point signing help after every failed claim (F16). Imported cap: 100,000 US dollars, shown converted to XMR (F17).
- Owner wants screenshots when Task 16 is ready, for the staff menu (F19).
## design
- Pick the name by vote: My offers, My listings, My ads, My posts (F5). Solve the "can't read this currency" state on the vendor's list: obvious, little reading, good looking (F4). Nudge sound in the ICQ spirit (F10). Plain gift card rules (F13).

# Owner decisions, third page, 7 Nov. Override anything above. Owner's words: owner-answers-page3-2026-11-07.md.
## claude2
- Strong logins: username + PGP key + display name is strong; username + password + TOTP + display name is strong too (G6, G34). Username is mandatory on every account, so PGP login takes a username. Team login rules unchanged.
- Hold v3: username-and-password removal of a wallet or team member takes effect at once (wallet unusable, member's access gone); it becomes permanent after 24 h (G5). Changes can be tallied on one screen with a before and after view; the 24-hour notice shows before submit; strong users skip the wait but still see the view (G29). Max 20 waiting changes (G36). During a hold the account can stay logged in and extend the session (G8). Trade on hold: both people can still enter it, chat and reach moderators, leave the screen; no coins move until a moderator decides (G7, G33). Recovery code: doesn't override the 24-hour hold or passwords; a recovery login only lets someone in to set up security again; it's for leads and moderators (G32). Every hold action is audited (G35). Team members can't see the lead's waiting changes (G31). Which changes trigger a hold: owner wants to discuss with the lead (G28): don't change this yet.
- Sessions: durations are a dropdown, nothing preselected: traders 2, 4, 8, 12 hours; vendors 2, 6, 12, 24 (G23). Note 8, not 6. A new choice starts counting immediately from now (G24). Extend with any login, including username and password (G10). Extending raises no alert (G9). After signup the person returns to the login screen, logs in and then picks a length (G25).
- Vendors: no requirement beyond a strong key, even for a beginner (G26). Can't remove the only strong method: only exchange it for another (G13). Closed account may reuse its keys, not its username or display name (G14). Banning a vendor bans its team members' entries too (G27). Auto-close stays held till the owner confirms: lead is re-explaining it (G11, G12).
- Cancels (G2): owner's rules for wording and flow; lead to confirm against the machine. Seller after escrowing with no contact: after 90 minutes and at least one nudge, a cancel button appears and XMR refunds. Before escrow: cancel at once. Buyer after escrow: may cancel, full refund, trade stays open until 10 confirmations reach the seller.
## claude3
- Moderators: all three methods required; two log in on a new device, one on a known device (G3). Security key always means a tap; owner major changes need both security keys (G4). Audit logs record every login method use, structure to come (G18).
- Proof: no readable date: try EXIF first, then the screenshot. If neither: warn the poster, allow posting, warn the seller too, with wording from design (G16); this replaces "no pop-up". Numbers in notes: read the field label before the number to decide what to blur (G17). Proofs teach the detector over the 30 days they're kept.
- Feedback: named or anonymous stays the sender's choice (G20). A revoked PGP claim can be reclaimed by an account that proves the key (G21).
- Maintenance: no "emergency" default; reason is internal; big banner; unplanned: minimal info and best guess when back; planned: 24-hour notice; 500 characters OK; disputes and their timers pause (G19).
- Incident ID: 8 to 9 characters, same as the dispute's, shown to both people at the top of the trade and to the moderator. A moderator accepting a dispute is logged at once: who and when, and when the trade was opened (G37).
## design
- Ban notice wording from G39: "We're sorry, but your account has been banned. If you feel this has been done in error, please reach out to a moderator at [Matrix] [Telegram]..." Link hover: dark ink (G40). No-date warnings (G16). Hold before-and-after view (G29). Cancel wording (G2).

# Owner decisions, third page part 2, 7 Nov (G41-G60)
## claude2
- Gift cards: the person holding the escrow has 45 minutes to check a card once its details are handed over. Proof can be video as well as photo: the sender should show logging into the card right before sending, and upload the video (G50). Cards bought within the last 30 days (G51). The card must carry its full written value; only a range card, like a Visa 200 to 500, may be partial, and that requires video proof (G52). Brand list goes to the owner first (G53).
- Refund after a buyer cancels: no dispute card. Instead warn before they pay/cancel that this is likely final (G56). Design words it.
- Team and holds: only a team lead can kick out team members; a username-and-password lead's kick takes effect at once; a delete kicks at once, deletion final after 24 h; other team changes wait 24 h (G57). When a strong lead logs in during a wait, show the changes in the before and after view with the countdown, and offer Approve now, Cancel all, or Make changes (G58). This replaces "discard".
## claude3
- "XMR traded to date" is X2F trades only; imports on their own lines (G54).
- Staff who lose their key and recovery code contact the owner, who vets them and resets them with a username and password, then they set up security again (G60). Build the owner's reset, tapped.
- Owner recovery: the owner uses a backup security key if all PGP keys are lost (G59). Lead is confirming whether one key or both.
## design
- XMR colour: Monero's true colour from getmonero.org unless design changes it (G41). Active Buy/Sell tab border: design reviews (G42). Disabled-button and sheet-title look, board items, blue note, icon corners: design's call (G43, G44, G45). Devices wording: design writes; tell the lead if the owner's input is needed (G46). Folding phones: research Pixel Fold, Samsung folds and others, and whether Back differs; design for them if different (G47). Fold label waits for final boards (G48). Gift card wording, warning before the final decision (G52, G56). Before-and-after approval view with countdown and Approve now, Cancel all, Make changes (G58).
- Matrix and Telegram addresses: set up in the next few days, near the end of design (G49).

## 7 Nov, last 7 on the remaining page (g61-g67); raw answers in ~/x2f-comms/owner-answers-raw/remaining-final
- Maintenance (g62): maintenance is a site-wide freeze, so trade timers stop. The one exception: 24-hour account holds (low-security changes) keep counting down during maintenance. The watcher question was re-asked on page 4 (LGV6jCxgWycepbWCJiAFiB).
- Fees on moderator rulings (g63): a full reversal (all funds back to the original parties) means no 1% fee; the site pays the moderator itself. A ruling that moves the trade forward, an appeal that upholds completion, or a lien all mean the trade completes and the poster pays the 1%. During an appeal, the fee waits on the outcome. Design to write the explanation for users.
- Login methods (g64): a username-and-password account has only one method, so it can't remove one. It can change it, and that is a change with a 24-hour hold: the new credentials take effect after 24 hours, so the real owner can still log in with the old ones and kick out a thief. Removing a login method on a team member is a team change, and it is also held 24 hours.
- Waiting changes view (g65): one view lists every waiting change and its effect, with a countdown for held ones. Users with strong security see the same view, but their changes apply at once. Cancelling: "Cancel all changes" or untick single changes. A cancelled change never applies, so nothing removed needs restoring.
- Seller's 90 minutes (g66): from when the escrow is fully funded. After that the seller can cancel and get the funds back. The nudge sounds help.
- Buyer cancel (g67): the buyer may cancel after escrow, until they tap "I've paid". After that only a dispute.
- Team and holds (g61): the owner needs more detail. Re-asked on page 4 (who may see, cancel or end a waiting change).

## 7 Nov, page 4 (LGV6jCxgWycepbWCJiAFiB); raw answers in ~/x2f-comms/owner-answers-raw/page4
- Imported volume (p4-1): show it in US dollars ("$X+ on <site>, verified"). No XMR conversion of imported volume. ("XMR traded to date" stays X2F trades only, G54.)
- Times (p4-2): all times are UTC only, with no time zone option, like every site. Design's UTC-only deadlines (X5) stand.
- Gift cards (p4-3): keep "Other". The lead researches a major gift card site's top 30 brands; the list = those 30 + Other.
- Owner recovery (p4-4): either backup security key alone is enough, because the key's PIN is also required. The owner will also use passkeys, PGP keys and a recovery key.
- 60-day close (p4-5, p4-6): applies to every account. An open trade or dispute pauses the clock (fine with the owner, though rare). No warning notice: the rule is explained clearly at signup, in the rules list at the end ("accounts not signed into for 60 days are closed for security; X2F is for active traders"). Design writes it more elegantly. Revisit if users complain.
- SonarQube (p4-7): the token is in the 1Password service vault, so the lead (PC only) sets it up from there. The vault token stays off cloud sessions.
- Team logins (p4-8): team members may not use a stronger login method than the team lead uses. The lead's security is the maximum for the team. Who can see, untick or cancel waiting changes, or end a hold, is a granular team permission the lead grants. Default: only the lead acts; members without the permission just see that a hold is on.
- Watcher (p4-9): always on, every 15 seconds, as built (option B). This lifts the owner hold on watcher Tasks 9 I/O, 9-view and 10, and on the trade timer code. Maintenance freezes trade timers, but 24-hour account holds keep counting (g62).

## 7 Nov, page 5 (MGSNFwwRxkhd88PQqqg1N8); raw answers in ~/x2f-comms/owner-answers-raw/page5
- Wording (p5-1): the owner wants every unsigned line, grouped by screen. Design produces the list; the lead builds pages with one screen per question.
- Cancel confirmation (p5-2): "send to design for wording". Design owns that wording, and it goes into the by-screen pages for sign-off.
- Trusted badge (p5-3): 200+ trades and 98%+ positive.
- Support headline (p5-4): "Ask an X2F staff member".
- Short lines (p5-5): the owner didn't follow them. They go into the by-screen pages with screen context.
- Gift cards (p5-6): the top 30 + Home Hardware + Canadian Tire + Other (32 + Other): Amazon, Apple, Google Play, Uber, Uber Eats, DoorDash, Walmart, Best Buy, Home Depot, Steam, PlayStation, Xbox, IKEA, Sephora, Starbucks, Airbnb, Roblox, Nintendo eShop, Visa prepaid, Mastercard prepaid, Instacart, Air Canada, Petro-Canada, Esso, SkipTheDishes, Sobeys, Winners, Lululemon, Tim Hortons, Target, Home Hardware, Canadian Tire, Other. Razer Gold is dropped.
- Removals during a hold (p5-7): low-security logins get a 24-hour hold on every important change (account, team, wallet/cash-out and the rest), removals included, so nothing applies early. During the hold, the team lead who made the changes can log back in and undo some or all of them.
- NEW RULE (p5-7): if the user has set up secure Jabber (XMPP) notifications, every change to their account sends a discreet notification that says an account change was made, without saying what. This is a new feature; it needs a design board and a build task.
- Nudges (owner, 7 Nov, chat): there is no cap of one nudge. The limit is one nudge per 15 minutes, as many as needed. The seller's refund unlocks after 90 min from full funding and at least one nudge.
- Next priority (owner, 7 Nov): once the owner has seen the working demo, the next topic is the permissions that can be set for team members.

## 8 Nov, owner comments on the prototype (https://claude.ai/artifact/JEZKgFnLH1EzhuDFh5qMJG)
- Browse: the method on the "Zelle · N buyers paying in USD" card becomes a dropdown of every payment method with live offers in the chosen currency.
- Quote: carry the offer's buyer bands (ranges) and where the amount clips onto the quote screen.
- Max button on the quote: keep.
- Trade terms: show each reader only what applies to them (no "the poster pays 1%" to the taker), line by line: responsibilities, what affects them, their options (nudge every 15 min, etc.).
- Agreement: no agreement on every trade. Users agree once, at account opening: the Terms written carefully and comprehensively, a required tick box, AND a tall, wide white signature pad (a scribble or an X is fine). Not repeated per trade.
- Front door (owner, 8 Nov): "No one gets to make it past the front door and see behind the curtains without signing an agreement, creating an account and logging in. There are no free tours for outsiders." Logged-out visitors see only login, create account (Terms + signature), recovery; the API refuses marketplace and user data without a live, fully set-up session.
- Offer amounts in XMR or fiat (owner, 8 Nov, Post an offer "Smallest trade"): each range box has an XMR / <currency> switch on its right; default XMR (the left one), selected unit bold bright orange, the other smaller and muted. A fiat-set range (e.g. $500-$3000) still sells XMR; the system converts and shows both XMR and fiat to traders, with the poster's markup (e.g. +2.5%) applied. Ad card: markup bottom-left, two rows across: the range in XMR and in fiat. Search: a box "Display amounts including vendor markup" recalculates both rows with the markup. Trade/quote screen carries the markup, the ranges, and the with/without-markup view. Lead default: min and max switch together (one unit per offer); owner may override.
- Minimum completed trades on an offer (owner, 8 Nov): choices 5, 10, 25, 50. Lead default: "No minimum" also offered, and is the default; owner may make 5 the floor.
