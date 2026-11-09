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
