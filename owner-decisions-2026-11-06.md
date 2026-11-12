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

## 8 Nov, pages 6, 7, 9 (owner's full words: ~/x2f-comms/owner-answers-raw/page6-9/)
Trade rules (p6-1, p9-2, p9-4, p9-6, p9-7):
- REVERSAL: nudges are OPTIONAL, never required. A nudge is a tool to get attention, at most once per 15 minutes (it's annoying). The seller's cancel after the time to pay does NOT need a nudge. (Replaces the 7 Nov "at least one nudge" line and Job 1's nudge gate.)
- REVERSAL: no 15-minute final warning to the other party. When the time to pay has passed and the buyer hasn't tapped "I've paid", the escrower may cancel; the refund starts at once with no warning; the trade is complete once the refund has 10 confirmations. Login strength has nothing to do with cancelling.
- The time to pay is not a hard end: after it, the trade stays open until the escrower chooses to cancel; the late buyer can message and still pay. If the buyer paid late and the escrower cancels, the buyer can dispute at once.
- Once "I've paid" is tapped, the other side can no longer cancel.
- The time to pay and the dispute wait depend on the payment method. Research each method's real transfer time; show it up front where the method is picked (e.g. "this payment method can take up to 12 hours"), and the other side waits that long after "I've paid" before a dispute.
- No release time limit: the seller checks, marks complete, the XMR releases and the 1% fee is subtracted.
- No penalty for a taker who never funds (people open several trades and keep the first who answers). Add a trade rule note asking them to close the other trades out of respect; design words it.
- Moderators: chats are end-to-end encrypted and readable by the moderator only once a dispute opens; then the moderator sees everything: full chat with timestamps, proofs, and can question both parties, who must cooperate or risk a ruling against them. Owner suggests the Signal protocol; the lead decides the method.
- Blur check: for the first month, ask BOTH parties every time whether the blur removed private info and kept what matters. Lead writes the wording.
- Own-name accounts: a recommendation only, never enforced; reassure that X2F protects their identity.
- Fee (p9-1): the 1% is subtracted at completion when the XMR leaves escrow, and sent to the system wallet. Owner asked how this works when roles differ; follow-up question pending.
Teams (p7):
- Releases are logged with member name and amount (p7-1 agreed; rest of p7-1 needs explaining).
- Confirmations (p7-2): the trader's key taps ("I've paid", "Payment received"/release) get a second "Are you sure…?" pop-up with a "Do not show me this warning again" tick, per user.
- Payment details (p7-3): per payment method, the sender's side of the trade chat shows that method's required fields (e.g. Interac: full name, and email OR phone); they fill and tap Send and it arrives packaged. Research each method's required fields.
- Per-member trade-size band (p7-4): a member who can create or complete trades only does so within the band the lead sets; it applies to every related permission.
- Manager preset (p7-5): a "Manager" checkbox ticks a recommended set of boxes, which the lead can still untick individually.
- Blocking (p7-6): design A. A Blocked users list with date/time and an optional note per block; block/unblock with one click.
- Disputes (p7-7): design A; members with dispute access see everything and can answer the moderator.
- Notes (p7-8): two boxes: "can view notes on traders" and "can add notes on traders"; added notes record who and when; members can't delete.
- REVERSAL (p7-9): members may use any login method, stronger than the lead's included (replaces p4-8 "no stronger than the lead"). If the team lead uses only username+password, team changes still get the 24-hour hold even when a member with a strong login makes them.
- Member logins (p7-10): approve only the first login (design B); the granular boxes are the protection.
- Working hours (p7-11): simple "any time" or a detailed schedule (days, hours).
- Starting set (p7-12): design A (the 10 boxes); keep thinking of every possible permission and leave the rest to feedback.
- Logo (p8-1, 8 Nov): D · Wordmark (X2F in Familjen 700, one Monero-orange coin on the F). Browse page name (p8-2): "Find a trade". Header: "logo – page name" on every page.
- Fee by role (p10-1): the poster always pays 1%. Poster buying XMR: the taker escrows the trade amount; the poster receives it less 1%. Poster selling XMR: the poster escrows the trade plus 1%; the taker receives the full amount. (As built.)
- Team release (p10-2): a team member cannot confirm payment received / release on the vendor's sell trades (members won't have the lead's bank access). No such permission until lots of feedback asks for it.
- Lead to the cloud (owner, 8 Nov): the lead moves to a cloud session after the current batch lands. The owner allows one 1Password service account token in the cloud lead's environment ("If we need a single token in order to reach all of the other ones so be it"), replacing the 6 Nov rule that the vault token stays off cloud sessions. Lead recommends a dedicated vault, read-only.
- No-proof warning (owner, 8 Nov): when a buyer taps "I've paid" with no proof attached, a pop-up asks if they are sure, says proof can be instrumental in winning a dispute, and leaves it to them. Design words it. Lead default: this one always shows (it can't be silenced like the p7-2 confirm).
- Chat retention (owner, 8 Nov): chat keys and messages are kept 30 days after the trade closes (a dispute can be opened in that window), then destroyed. If a dispute happens, they are kept 90 days (owner: "being used for training purposes"), then destroyed. A dispute opened inside the 30 days stops the 30-day destruction. Lead reading: 90 days counted from the dispute closing.

## 8 Nov, page 11 (9pBDGqKsBqz6b5XWWaPxZX); owner's words in owner-answers-page11-2026-11-08.md
- Chat encryption (p11-1): no Matrix; build it ourselves on what exists.
- Keys and staff access (p11-2): one per-trade membership model, like Windows permissions: buyer and seller are members; on a dispute the assigned moderator is added and can read everything; a senior moderator or the owner can be added later and see the full history plus the first moderator's actions. An audit log (who wrote or tapped what, with times) is compiled from the start of every trade; destroyed when the trade completes without a dispute, or 90 days after the dispute or appeal is resolved. Where the keys are kept and how they're filed against the trade is to be designed.
- Deleted chats (p11-3): "No stick to what is already decided"; keys destroyed "at the 48 mark unless dispute happens". CONFLICTS with p11-9 (30th day): asked again as p11-17. Until answered the built 30-day rule stands.
- Second device (p11-4): full abilities on additional devices; consider approving a new login from a notification on an already logged-in device, with no 24-hour hold on the new device; that notice is a secure Jabber notice as well. Security rule change to confirm in design before building.
- Removed staff (p11-5): any event of any sort goes in the audit log.
- Launch trade cap (p11-6): $5,000 per trade.
- Freelance crypto review (p11-7): no; a proper audit from the site's revenue.
- GitHub security alerts (p11-8): yes. Done 8 Nov: alerts, automatic security fixes, `dependencies` label.
- Terms (p11-9): completed trades are destroyed on the 30th day; disputed orders are kept up to 90 days, privacy-tool scrubbed, and used to train admins as the site gets off the ground.
- Device copies (p11-10): purge is system wide; owner's premise is that data is live from the server. In fact devices hold a local copy: the app must erase it too.
- 90 days start (p11-11): the day the dispute closes.
- Demo (p11-12): Tailscale (done).
- Signature (p11-13, 14, 15): erased when the account closes; everyone who gets a login signs; wording: tick to agree to the rules and terms, then sign your name, then begin account creation; design writes it.
- Seller dispute before "I've paid" (p11-16): yes. The party who wants out can dispute once the XMR is escrowed and the other won't cancel; that immediately greys out the other trader's "payment sent" and shows a pop-up: do not send funds by any payment method, a dispute has been triggered and a moderator summoned. Design for wording.

### page 11, answers 17-40 (8-9 Nov)
Owner's words: owner-answers-page11-2026-11-08.md (second half). Where a line says CHANGES, the earlier rule named is replaced.
- Chat and key destruction (p11-17): completed trade without a dispute: chat and keys destroyed at 30 days, as built (C-001 stands). His "48 hours" in p11-3 was the window to file a dispute, and he now wants that window to be 72 hours. CHANGES the 48 h dispute window to 72 h. He did not say which window: the only 48 h trader dispute window built is "buyer may dispute within 48 h of a no-show refund" (28 Oct 14:05, disputeAfterRefundHours 48); the appeal window (R40, 48 h) is a different thing. Lead confirms which one before claude2 changes it. Who: claude2 (timer), design (show 72 h on the card), lead (confirm which window).
- Late "I've paid" (p11-18): yes, refund at once when the seller cancels after the time to pay is up; no extra 5-minute freeze; the buyer's remedy is a dispute, and we help them get the money back. The wait before the seller may cancel depends on the payment method (see p11-29). Confirms p9-2 as built. Who: lead helper (nothing new to build).
- Moderator login methods (p11-19): a moderator may log in with username, password, PGP key and passkey and have no security key; that is fine as long as they have all the others. CHANGES Q51/G3 ("security key, PGP key and passkey, all three"): the security key becomes optional for a moderator who has username + password + PGP + passkey. He did not ask for hardware-only passkeys, so the current check stays (synced phone passkeys allowed). Who: claude3 (staff logins, third-p4-task16 invite all-three), design (staff invite card).
- Fast badge (p11-20): counts payments sent in less than half the time allowed to pay; after 30 such payments ("let's say") the buyer earns the Fast badge. CHANGES the lead default "Fast = median of both lists" (offer-units, batch 2). He did not say which tap ends the clock; the allowed time to pay ends at "I've paid", so lead reading: measured to the "I've paid" tap; lead confirms. Who: claude3 (reputation), lead (confirm the measure point).
- Invite from a username-and-password login (p11-21): allowed. The invite goes out, the new member accepts, the lead is notified (and a secure Jabber notice); the lead may set up all of the member's settings and submit them, but they take effect only after 24 hours. That nudges leads to stronger logins, which make changes apply at once. CHANGES 30 Oct rule 47 ("invites need a strong login; password-only gets 'not allowed'"; built in hold-v3 as a refusal). Who: lead helper (hold-v3), design (invite and member-setup screens for a weak lead).
- Team hold rights (p11-22): did not answer the question as asked; said: the team-member powers are "the last remaining most underdeveloped part"; decide whether there are member types or only per-ability boxes, and make a list of every ability leads might grant. Question stays open. Who: lead + design (full abilities list, Job 1c), then back to him.
- Combined hold rules (p11-23): did not answer the question as asked; said: "it's going to be highly unlikely that someone is going to log in because they have to know both their username and their password". Question stays open (see also p11-35, which gives the owner a way out of the thief case).
- Signup username tick (p11-24): did not answer the question as asked; said: the first thing after "sign up" is the disclaimer, Terms of Service and site rules (maybe separate pages: agree to the Terms, then acknowledge the rules), then a box to sign (any signature), then "continue creating your account". Question about the live username tick stays open. Who: design (signup order: Terms, rules, signature, then account creation).
- Team member label in trade chat (p11-25): based on the lead's display name: "<lead's display name> Assistant 1", "<lead's display name> Assistant 2" (e.g. "Circa 55 Assistant 1"). CHANGES R44 / 28 Oct ("Message from Team <account> member: <member name>"): the member's own name is not shown; members are numbered. Who: design (chat label), lead helper (team chat label in code).
- What a 24-hour hold holds (p11-26): the hold is only on the changes being made; everything else keeps working as normal. A team member's weak login holds only that member's own changes (if they have the right to make them); the team account never freezes because of a member. He says himself this "might be different than how we had planned it before". CHANGES the earlier account-wide hold effects for weak-login holds: offers hidden "during every hold" (30 Oct N56), and on a hold trigger unfunded trades cancelled and mid-trade trades put on hold (30 Oct 17:00 #4). Not clear whether it also changes the recovery-code hold (24 h hold on everything, 30 Oct 00:45); lead confirms. Who: lead helper (hold-v3), design (hold screens), lead (confirm reach to recovery hold).
- First login of a new team member (p11-27): no approval by the lead (the lead already set the member up knowingly); the lead gets a notification, and a secure Jabber notice, when the member logs in for the first time. Also: build a Jabber notifications settings page where each user picks which events send them a secure Jabber notice. CHANGES p7-10 ("approve only the first login, design B"). Who: lead helper (team login, Jabber settings), design (Jabber settings page).
- Members' recovery codes (p11-28): yes, team members get their own recovery codes. CHANGES 30 Oct ("recovery codes only for the account owner, never members") and the "team lead or moderator only" part of G32. Who: lead helper (signup-team / member join), design.
- Time to pay per payment type (p11-29): research each payment method's average time to receive the money; that average becomes both the time the buyer has to send that payment type and the time before the other side may cancel. Run many research agents (he suggests about eight) across every payment type. The builder's defaults (90 min apps/instant, 3 h bank, 24 h cash by mail) are NOT approved; they stay only as placeholders until the research is in. Who: lead (research), then lead helper (launch-rules pay windows).
- Price feed down (p11-30): did not answer the question as asked; said: "This is why we decided to have multiple price feeds and even a backup one over Tor. We're hoping between the three or four different feeds we have, we should be okay." Question (no trades at all while the price is unknown?) stays open; as built, trades are refused until the price is back.
- Jabber encryption (p11-31): OMEMO is mandatory (X2F refuses to send an alert it can't encrypt), and so is Tor. Confirms 29 Oct "OMEMO Jabber over Tor only"; overrides design's "OMEMO recommended". Bears on p11-42 (own onion server), not yet answered. Who: lead helper (jabber-notices), design (remove "recommended").
- Which events send a Jabber alert (p11-32): the lead and design list every event that could be worth a Jabber notice and publish it as an artifact checklist; he ticks the ones to use and can add his own rows with a description of what each should do. Builder's defaults stand only until he has ticked the list. Who: lead + design (checklist artifact).
- Erased-chat marker (p11-33): when a device becomes active again (website, Android web app or full app), it syncs first: every change is pushed to the device before the user can do anything, which should take only a few seconds. He did not name how long the server keeps the "this chat is gone" mark (builder: 365 days); that number stays open. Who: lead helper (sync before use on login, chat-shred-2), lead (re-ask the number if needed).
- Recovery code and throttling (p11-34): "Yes: a correct recovery code always gets in", even when logins are throttled. Who: lead helper (hold-v3).
- Thief sharing the password (p11-35): add an option to the password change: enter the current password, the new password and the recovery code, and the change goes through at once with no 24-hour hold. CHANGES G32's "the recovery code does not overwrite username/password or the 24 h hold" for this case. He did not otherwise say whether he accepts the two limits (cancel each other's change; older session ends newer). Who: lead helper (hold-v3), design (password-change form with recovery code).
- Spent recovery code notice (p11-36): yes: tell the person the recovery code is now burned and that they should go to security settings and generate a new one. Note: today a new code is made automatically after a recovery login; his words have the person generate it in security settings. Lead confirms whether that changes the flow or only the wording. Who: design (notice wording), lead helper.
- Dispute room between the seller's cancel and the refund landing (p11-37): something to the effect of "The seller has cancelled this trade. XMR has begun refunding back to their wallet", with the confirmations count out of 10. Replaces "Locked in escrow" and design's "Refund on its way". Who: design (final words), claude3 (dispute screens).
- Where the demo lives (p11-38): code on GitHub, run in a Claude cloud session environment while it is being tested, reachable from claude.ai or the Android app. Who: lead.
- What was better about the previous demo (p11-39): the Claude integration: being able to comment to Claude while reviewing the prototype. He wants that on the working demo. Who: lead (comment tool on the demo).
- Raw transcripts (p11-40): no archive; the full snapshot was only to migrate the lead to the cloud. Carry on as usual. Who: lead.

### page 11, answers 41-43 (9 Nov)
- p11-41 **Authenticator app is a login method only, never a backup way in.** Recovery code is the only back way in. Matches the signup-rules build (wip/lead-signup-rules). SetupWelcome lists "Recovery codes", not "Authenticator app".
- p11-42 **Terms line about names approved; bump the Terms version.** Built on wip/lead-terms-signature 2428e51e.
- p11-43 **Open: owner asked for a fuller explanation**; question rewritten on page 11 with three choices (stall with Log out / keep trading on old Terms / open trades continue, nothing new until the owner accepts: lead's recommendation). Until he picks, front-door's current behaviour stands.

- 10 Nov: wording questions go to design, not the owner; design escalates only what truly needs him. (owner, chat)

## 12 Nov 2026 (owner, in chat)
- "Russian anything is banned": remove RUB, SBP, MIR, YooMoney and every other Russia-specific currency/method before launch (answers the sanctions question). Clarified: "When I say Russian I mean Russian not Ukrainian." The ban is Russia-specific only; Cyrillic text support (proof blur) stays, Ukrainian currency and methods stay.
- "Anything Iranian unfortunately is banned too": remove IRR and any Iran-specific payment method (e.g. Shetab cards) before launch.
- "I'm sticking to the US sanction laws": the rule for currencies/methods is US (OFAC) sanctions. Comprehensively sanctioned jurisdictions are removed; borderline programmes (sectoral or list-based) go to the owner/lawyer with a recommendation.
- "Just block their currencies and payment methods that are unique to areas on sanction lists": no Terms clause, no geo-blocking; only currencies and methods unique to US-sanctioned areas are removed.
