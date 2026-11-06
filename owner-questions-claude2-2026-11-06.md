# Owner questions held by claude2, 6 Nov 2026

Checked against every owner-answers-*.md file (up to 3 Nov) and the lead's 2 Nov answers. Old numbers from my
2 Nov list are in brackets, e.g. [#3]. BLOCKING = one of my branches cannot land until it is answered.
Questions marked "(from my review of X's branch)" came out of my helpers' reviews of claude3's and the lead's
branches; the branch owner may list the same question too.

Removed as answered or moot: [#1] band coverage (answered 2 Nov), [#22] fixed-price switch (market price only,
answered 2 Nov), the hold end time (no end time, answered 2 Nov), the form-limit privacy question (claude3 fixed
it at 70821e98). Technical points (heading tags, npm audit, several API servers, the order of landing the reviews
branches, tap-start permission checks) are not owner questions and are left with the lead.

---

## BLOCKING

### Offers in several currencies (Task 34, lands last, API and web together)

**B1 [#3]. When offers become market-price only, what happens to existing offers that use a fixed price?**
- Options: (a) remove them, and the vendor posts again; (b) turn each into a market-price offer at +0%.
- Recommendation: (a). A fixed price turned into "market +0%" could be far from what the vendor meant.
- Blocks: Task 34 landing (the database change runs once, on every existing offer).

**B2 [#38]. If a vendor chooses different payment instructions per currency and leaves one currency's box empty, what should happen?**
- Options: (a) the offer can't be posted until the box is filled; (b) that currency uses the shared instructions; (c) post it with empty instructions.
- Recommendation: (a). Option (c) means a buyer pays with no instructions; (b) can show the wrong bank details.
- Blocks: Task 34 web (the fix round being built now).

**B3 [#32]. The design board and the server allow different ranges. Which ranges are right?**
- Today: the price margin is ±10% on the board but ±50% on the server; the extra for one payment type is -5% to +10% on the board but ±20% on the server; the board allows 5 amount bands per currency, the server 10.
- Options: (a) the server follows the board; (b) the board follows the server; (c) other numbers.
- Recommendation: (a). Tightening later would break offers that are already posted.
- Blocks: Task 34 landing.

### Price feeds (where X2F gets Monero prices; lands after these are answered)

**B4 [OC1]. Which outside price services may X2F fetch prices from?**
- Options: (a) only the ones used today; (b) also fetch the same services' direct pages as a backup; (c) add a further service (CoinPaprika) after we confirm it works over Tor; (d) add more only if we want more currencies (B7).
- Recommendation: (b) now, and (c) once the Tor check passes.
- Blocks: price feeds landing.

**B5 [OC2]. If two price sources disagree, how big a gap is allowed before X2F shows no price for that currency?**
- Options: no limit (today), 2%, 3%, 5%.
- Recommendation: 3%. Past that, no price is shown and trades in that currency wait.
- Blocks: price feeds landing.

**B6 [OC3]. May X2F use sources that update only once a day (for currencies nobody updates hourly)?**
- Options: (a) no, hourly or faster only; (b) yes, with a few days' allowance over weekends.
- Recommendation: (a), unless B7 adds currencies that only daily sources cover; then (b).
- Blocks: price feeds landing.

**B7 [OC4]. Which currencies does X2F price?**
- Options: keep today's 45; add every currency an enabled source covers.
- Recommendation: keep the 45.
- Blocks: price feeds landing.

### Buyer disputes and the 3+3 offer cap (cap-dispute)

**B8 [#16]. A buyer can open a dispute 30 minutes after marking paid. Should that 30 minutes pause while X2F is down for maintenance?**
- Today it keeps running, so a buyer could dispute right after maintenance even though the seller only had a few minutes to check. Every other trade deadline already pauses.
- Options: (a) pause it like the others; (b) leave it running.
- Recommendation: (a). This is a change from my 2 Nov recommendation; the reviewer showed it is unfair to the seller.
- Blocks: cap-dispute landing.

**B9 (new, from the cap-dispute review). Is the 30-minute wait the same for every payment type, including bank wires that can take up to 24 hours?**
- The owner said 30 minutes is a minimum ("others similar or longer").
- Options: (a) 30 minutes for every payment type; (b) longer for slow payment types (for example, half the seller's confirm time).
- Recommendation: (a) for now, and review it after launch feedback.
- Blocks: cap-dispute landing.

### Staff logins (from my review of claude3's Plan 4 Task 4)

**B10. Staff accounts will be refused on the trader site. Should the owner's own account be refused there too?**
- Options: (a) yes, the owner uses only the staff site; (b) no, the owner may also trade.
- Recommendation: (a). It matches "staff accounts are staff-only" (owner, 3 Nov).
- Blocks: claude3's Task 4 landing (its fix decides who is let in).

---

## LATER

### Offers in several currencies (Task 34)

**L1 [#31 + owner note #2]. On the post-an-offer screen, does the vendor pick the payment type first and then its currencies, or the currency first and then its payment types?**
- Options: payment type first; currency first.
- Recommendation: payment type first. Instructions belong to a payment type and change by currency (bank transfer in USD vs EUR). The lead is taking this to the owner and design.
- Blocks: the new picker (a follow-up; the current form lands without it).

**L2 [#30]. Should a vendor be able to set more than one amount band per currency now?**
- Options: (a) not until Task 35 (the form hides "Add a band"); (b) allow it now.
- Recommendation: (a). Built that way.
- Blocks: nothing.

**L3 [#37]. Should a team member who is not allowed to manage offers see an offer's payment instructions?**
- This happens today on main, before Task 34.
- Options: (a) only people allowed to manage offers; (b) everyone on the team.
- Recommendation: (a). It's a privacy matter.
- Blocks: nothing (existing behaviour; a small follow-up if (a)).

**L4 [#36]. Is a gift card limited to the currency of its country?**
- Options: yes; no.
- Recommendation: yes.
- Blocks: nothing.

**L5 [#7]. Are these limits right: 10 amount bands per currency, 10 payment types per offer, 1000 characters per set of instructions?**
- Recommendation: keep. Built that way.

**L6 [#4]. If a currency has no market price right now, the offer page opens without a rate, and the explanation pop-up appears when the buyer taps Trade. Is that right?**
- Recommendation: yes. Built that way.

**L7 [#5]. Is this wording right for that pop-up: "There's no market price for {currency} right now, so this trade can't start. This is usually temporary. Try again soon, or pick another currency."?**
- Recommendation: sign it off.

**L8 [#6]. Should My offers flag an offer as partly hidden when one of its currencies has no price right now?**
- Recommendation: yes.

**L9 [#33]. Is the minimum number of past trades per band a choice of 0, 5, 10 or 50?**
- Recommendation: keep.

**L10 [#34]. Should the currency choices follow the board: USD, EUR, GBP, CAD, AUD, then "More"?**
- Recommendation: yes.

**L11 [#35]. Should My offers show the name of every payment type on an offer?**
- Recommendation: yes.

**L12 [#8]. Should the list of 109 payment types be expanded?**
- Recommendation: as its own task after Task 34, with a legal check of each new type.

### Price feeds

**L13 [OC5]. Should users see which price source was used?**
- Recommendation: no.

**L14 [OC6]. Should the owner get an alert when a currency falls back to a backup price source?**
- Recommendation: yes, for the owner only. Not built yet; a small follow-up.

### Buyer disputes and the offer cap

**L15 [#14]. Is this wording right for the offer cap: "You can have 3 buying and 3 selling offers." and, on a paused offer, "Stayed off: over the offer limit."?**
- Recommendation: sign it off.

**L16 (new). Is this wording right for the seller: "{buyer} can ask a moderator to step in from 30 minutes after marking paid."?**
- Recommendation: sign it off.

**L17 [#15]. Should the screens say "3" as a fixed number until the owner's settings page exists?**
- Recommendation: yes.

**L18 [#17]. Should the My offers note "Each offer can cover several currencies." stay hidden until Task 34 lands?**
- Recommendation: yes.

### Looks (for design, through the lead)

**L19 [#18]. What colour should a link turn when the pointer is over it?** Recommendation: the dark ink colour.

**L20 [#19]. What colour should "XMR" be next to an amount?** Recommendation: orange until design decides.

**L21 [#20]. Should the active Buy/Sell tab have a 2-pixel dark border?** Recommendation: yes.

**L22 [#21]. Should the new disabled-button and sheet-title look be used everywhere in the app?** Recommendation: keep.

**L23 [#23]. Some board items are not built on the offers screens (market price card with a currency choice, an icon per payment type, section counts, a Site news link, a Deposit row, the empty-search heading with "Post an offer"). Build them?** Recommendation: design decides the order.

**L24. Should design confirm two looks added with offers v2: the blue "information" note, and rounder corners on every icon button?** Recommendation: yes, confirm.

### Devices screen wording (for design)

**L25 [#24-28]. The Devices screen needs wording for five things:**
- the team card when there are no team members;
- "unless you switch them off";
- "2 of 1 devices";
- the "Back to log in" label;
- the sentence about how long a session lasts.

Recommendation: design writes them.

### From my reviews of others' branches

**L26 (from my review of the lead's fold branch). While the escrow is still confirming, the folded screen says "Pay now … then tap I've paid", but the trade room says to wait. What should the folded screen say?**
- Recommendation: a neutral "Escrow confirming" with no "tap I've paid", and design draws the state. The lead has already sent this to the owner and design.

**L27 (fold). Is it fine that a folding phone opened flat has no Back button, as on the board?**
- Recommendation: yes.

**L28 (fold). Should the payment label change to the 6 Nov board's "Pay now"?**
- Recommendation: wait until the fold boards are final.

**L29 (from my review of claude3's feedback form limit). Team members share one account, so they share one 30-second wait and one daily limit of 5. Is that right?**
- Recommendation: yes, for the first version.

**L30 (form limit). Someone who sends again within 30 seconds is told "Too many tries. Try again in 1 minute." Should they get their own message, in seconds?**
- Recommendation: yes. The wording is the owner's to sign.

**L31 (from my review of claude3's traded totals). Should a moderator-verified dollar figure for imported trades have a maximum, so a typo can't show a huge number on every offer card?**
- Recommendation: yes, a hard cap per claim; the owner picks the number.

**L32 (traded totals). Does "overturned" mean only an appeal that reverses the first ruling?**
- Recommendation: yes, as built.
- claude3's own Q7, whether an overturned trade leaves the traded total, is the same topic.

**L33 (from my review of claude3's proof blur). A card's "ending 1234" is left visible when 1234 equals the trade amount. OK?**
- Recommendation: yes.

**L34 (proof blur). Review notes allow numbers of up to about 9 digits (owner, 2 Nov). That also lets through some 9-digit phone numbers (for example Polish and Czech mobiles) and short account numbers. But a later answer says to refuse all personal details in notes. Which rule wins?**
- Recommendation: refuse anything shaped like a phone or account number, and allow plain amounts.

**L35 (from my review of claude3's Plan 4 Task 5). Should approving a ruling, or using an owner key, need a PIN or fingerprint on top of the security-key tap?**
- Recommendation: yes for both.

**L36 (Task 5). How long are the records of security-key taps kept?**
- Recommendation: 90 days, like disputes, then erased.

**L37 (from my review of claude3's Plan 4 Task 4). Approving a new device for a staff login (owner Q19a) is not built yet. Is it needed before the staff site opens?**
- Recommendation: yes.

---

Count: 10 BLOCKING, 37 LATER (47 in all; L25 covers five wording items).
