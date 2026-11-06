# X2F: all open owner questions, 6 Nov 2026

Reply with a question ID and your choice, or OK to take the recommendation. The blocking questions are in the lead's message; full detail is below.

# From claude2 (IDs: C2-...)

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

# From claude3 (IDs: C3-...)

Replaces owner-questions-claude3-2026-11-02.md. Checked against owner-answers-*.md: answered or moot items are removed (list at the bottom).
Each question has options, my recommendation, and what it blocks. A short answer such as "OK" or "B" is enough.
**BLOCKING** = one of my branches cannot land until it is answered. **LATER** = the branch lands with the default shown; the answer changes it afterwards.

---

## BLOCKING

### Proof pictures (privacy)

**1. Should card numbers written with commas or apostrophes be blurred on proof pictures?** Today a card number written like 4,111,111,111,111,111 or 4'111'1111'1111'1111 stays visible on a payment screenshot. Numbers written with spaces or dashes are already blurred.
- A: blur them on pictures only. Review notes stay relaxed, as you said.
- B: leave them visible.
- **Rec: A.** It is the same kind of leak the lead just ordered fixed: the blur rules must never leave a card number readable.
- Blocks: landing of the three proof branches (proof core, envelope, smart check).

---

## LATER

### Disputes and rulings

**2. When does the money move after a moderator rules?**
- A: only after the 48-hour appeal window closes.
- B: straight away, and a lien covers it if the appeal reverses the ruling.
- Your earlier answer (A1) was B, and the dispute branches are built that way. Does B still stand?
- **Rec: B (as built).**
- Blocks: nothing lands wrong, but the ruling task (next in my queue after the moderator tools) builds on this answer.

**3. Disputes have a 24-hour goal and a 48-hour hard deadline. Do traders see the 48-hour "ruling due by" time, and when?** Built: traders first see "aiming to rule by" the 24-hour goal. The 48-hour deadline appears only once the goal has passed.
- A: as built.
- B: always show both.
- C: never show the 48-hour deadline.
- **Rec: A.**
- Blocks: nothing (dispute screens).

**4. The message shown when a trader's account is frozen still says it is on hold "while a dispute is open". That contradicts your rule that disputes never block trading.** Proposed draft: "A moderator has frozen your account. Open your dispute to see what you need to do to get it back."
- A: use the draft.
- B: your own wording.
- **Rec: A.**
- Blocks: nothing. It is wording; I fix it when the freeze is built.

**5. "Overturned" erases a trade's reviews. Does that cover only an appeal that reverses the first ruling, or also a later dispute that reverses a finished trade?** The second case would be a trade that was released, then late money turned up and the moderator ruled for a refund.
- A: appeals only (as built).
- B: both.
- **Rec: B.** In both cases the sale did not stand, so reviews of it are not true.
- Blocks: nothing now. It applies when rulings are built.

**6. Does an overturned trade still count toward a trader's dollar total and completed-trade count?** You said "it depends which way it's overturned".
- A: the total follows the FINAL outcome. A trade counts only if it ended as a real completed sale; otherwise it is removed.
- B: keep counting every settled trade.
- **Rec: A.** Built today: B, until the ruling task can tell the final outcome.
- Blocks: nothing now (the ruling task).

### Proof pictures and pop-ups (all marked "designer must review")

**7. If the payment screenshot's date is not recent, should the buyer be able to send it anyway?**
- A: no, ask for a fresh screenshot (built, the plan's default).
- B: allow "send anyway" with a warning.
- **Rec: A.** A buyer with a real payment can take a new screenshot.
- Blocks: nothing.

**8. If no amount can be found on the screenshot, the buyer is asked to explain. Is the explanation required, and who reads it?**
- A: optional; the seller and any moderator see it.
- B: required; the seller and any moderator see it.
- C: optional and used only to improve the detector.
- **Rec: A.**
- Blocks: nothing.

**9. If the buyer's own blur covers the trade code (the memo), show a warning as we do for the amount?** Draft: "The trade code is hidden, so the seller may not be able to match your payment." The buyer can still post.
- A: yes, with this draft.
- B: amount warning only.
- **Rec: A.**
- Blocks: nothing.

**10. If no date at all can be read on the screenshot, show no pop-up (built)?**
- A: no pop-up (built).
- B: ask the buyer to confirm the payment date.
- **Rec: A.** Many banking apps don't show a date.
- Blocks: nothing.

**11. Disclaimer under proof uploads (item 65): the wording and where it sits are drafts.**
- A: keep the draft, placed under the upload button; the designer places it finally.
- B: you give the wording.
- **Rec: A.**
- Blocks: nothing.

**12. Should the receiver of a blurred proof get a "was this blurred correctly?" button, recording whether each blur was automatic or added by the buyer, read by a Helper? Build the back end now?**
- A: back end now, screens with the proof screens.
- B: later.
- **Rec: A.**
- Blocks: nothing (new feature).

### Staff tools

**13. Should the OWNER account also be kept off the trader website, like staff?** Built: the owner can still sign in on the trader site, because your price-health page lives there. Staff and moderators are refused there.
- A: yes, refuse the owner too, and move the price-health page to the staff site.
- B: no, keep it as built.
- **Rec: A.** Same rule for every staff-level login.
- Blocks: nothing. The staff split is ready with B; switching to A is one line plus moving that page.

**14. When a staff member signs in on a new computer, should it need approval from a computer they are already signed in on, as traders' logins do?** Not built on the staff site yet.
- A: yes, build it as a follow-up.
- B: not needed for staff.
- **Rec: A.** You said owner and moderators can be on several computers, with approval.
- Blocks: nothing now.

**15. For the most serious staff actions (approving a ruling, adding an owner key), should the security key also ask for its PIN or fingerprint, not just a touch?**
- A: PIN or fingerprint for rulings and owner keys; a touch for everything else.
- B: a touch for everything (built).
- C: PIN or fingerprint for every staff action.
- **Rec: A.** Most security keys have a PIN.
- Blocks: nothing now (the ruling step).

**16. How long do we keep records of staff security-key taps?**
- Rec: delete unused ones after 24 hours. Keep used ones for rulings as long as the ruling record (90 days). Keep other used ones 90 days.
- A: as recommended.
- B: other periods.
- Blocks: nothing (nothing is deleted yet).

**17. First-time owner setup asks for a username AND a separate private login name.** The design board shows one field; the staff site needs both.
- A: two fields, as built.
- B: one field used for both.
- **Rec: A.** The login name stays private, so it can't be guessed from the public name.
- The same two fields apply to staff invites.

**18. Owner first-time setup allows 10 code tries an hour for the whole site, counting right and wrong tries. A stranger could keep using up the tries and hold setup off.**
- A: as built (setup happens once, at launch, and the code prints on the server).
- B: count only wrong tries.
- **Rec: A.**
- Blocks: nothing.

**19. Removing a staff member: is it permanent, so they can never be switched back on?**
- A: permanent (built). They get a new invite if they come back.
- B: reversible.
- **Rec: A.**
- Blocks: nothing.

**20. Site maintenance: when no type is chosen, the notice defaults to "emergency", and the message may be up to 500 characters. During maintenance all dispute timers pause.**
- A: as built.
- B: change the default or the limit.
- **Rec: A.**
- Blocks: nothing.

**21. Is there an upper limit on the dollar figure a moderator enters when verifying someone's trades on another site?** A typo with extra zeros would show at once on that trader's offers.
- A: no limit (built).
- B: a hard cap per claim, refused above it.
- C: above a set amount, the owner must confirm.
- **Rec: B.** You name the amount; I suggest $10,000,000.
- Blocks: nothing. The moderator screen is not built yet.

### Reviews and the dollar line

**22. Wording on offer cards: is "$90,000+ in trades to date" OK?**
- A: as written.
- B: your wording.
- **Rec: A.** It matches your "more than the number" rule.
- Blocks: nothing.

**23. Imported volume from other sites: one combined dollar line on the offer card, or one line per site?**
- A: one combined line on the offer card, and a per-site breakdown on the profile.
- B: split on the card.
- **Rec: A.**
- Blocks: nothing.

### Past reputation (PGP key claims)

**24. If one account's claim on a PGP key is revoked, may a DIFFERENT account then claim the same key?**
- A: no (built). A key stays tied to the first account.
- B: yes, after a moderator checks it.
- **Rec: A.**
- Blocks: nothing.

**25. Show the 4-point signing help (key format, computer clock, sign don't encrypt, up-to-date software) on every failed claim?**
- A: yes (built).
- B: only on some failures.
- **Rec: A.**
- Blocks: nothing.

### Feedback form

**26. Keep the cap of 5 feedback sends a day per person?** You said "otherwise unlimited". Your one-ticket-at-a-time answer was about support tickets.
- A: keep 5 a day (built).
- B: remove it and keep only the 30-second gap.
- **Rec: A.** It stops one person flooding the inbox.
- Blocks: nothing.

**27. Wording when someone sends feedback twice within 30 seconds.** Today they see "Too many tries. Try again in 1 minute." That sounds like a security block and overstates the wait.
- A: "You just sent feedback. You can send more in 30 seconds." Keep "You've sent 5 today. You can send more tomorrow." for the daily cap.
- B: as today.
- **Rec: A.**
- Blocks: nothing.

**28. A team's members share their team's feedback limits (5 a day and one per 30 seconds). Give each member their own?**
- A: keep shared (built).
- B: per member.
- **Rec: A** for now.
- Blocks: nothing.

---

## Removed (answered or moot since 11-02)
- 11-02 Q2 (failed save still waits 30 s): moot. A failed save now gives the 30 s back (fixed on the form branch).
- Q3, Q4: answered (Q4 final, "more than the number").
- Q6: answered (a trade whose reviews are erased can't be reviewed again).
- Q8, Q9, Q10: answered and built.
- Q13 to Q17: answered (notes stay relaxed; the amount stays clear).
- Q18b: OK, as read.
- Q19: answered (staff refused on the trader site). Only the owner part is left (13 above).
- Q20, Q21: answered.
- Q23: merged into 3.
- Q1a (support tickets one at a time): answered; Plan 4 Task 30, not mine.

# From design (IDs: D-...)

Every open owner question design holds, as of canvas v118. Nothing on this list has been answered yet. Each has an OPEN box on its board. BLOCKING means a board can't be final, or the build can't copy it, until the owner answers.

**1. Member-permission presets: BLOCKING**
- Question: what does each of the four team presets switch on?
- Options: the draft mapping on MemberPermissions (Chat only = chat; Offers manager = chat + offers; Trade handler = chat + accept trades + mark paid; Everything allowed = all, including Release XMR), or the owner's own mapping.
- Recommendation: the draft mapping. Keep Release XMR only in Everything allowed, with its warning.
- Blocks: MemberPermissions (+Wide) and building team permissions.

**2. Blur templates: also blank the trade code, amount and time? LATER**
- Question: should the stored blur templates also blank the trade code, amount and time, as well as names and account numbers?
- Options: yes, blank all three; or blank names and account numbers only.
- Recommendation: yes. A template should hold no detail from any real trade.
- Blocks: the ProofBlur template note and the template database. Nothing on screen changes.

**3. SetupTerms step count: BLOCKING**
- Question: does agreeing to the Terms count as an onboarding step?
- Options: "of 5" (Terms is a gate before step 1) or "of 6" (Terms is step 1).
- Recommendation: "of 5". Terms is a yes/no gate, not setup work.
- Blocks: the step label on every Setup* board, SignupSecurity and SetupPgpChallenge ("3 of 5 · part 2").

**4. Incident ID: LATER**
- Question: what does an incident ID look like, and does the held account also see the incident pop-up?
- Options: format, a short code like `INC-7Q4K` (drawn) or a date-based one like `2026-11-06-014`. Pop-up, partners only (drawn) or partners and the held account.
- Recommendation: the short code; partners only. The held account already gets the hold notice.
- Blocks: TradeTechIssue copy only.

**5. Bans with an end date: BLOCKING**
- Question: does a ban end on a date, or last until a moderator lifts it?
- Options: timed ("Ends 14 Nov 2026, 14:05 UTC", the current default); or not timed ("Permanent · until a moderator lifts it"); or both, chosen per ban by the moderator.
- Recommendation: both, per ban. A moderator picks timed or permanent when banning. Ban-Notice already draws both (`ends` tweak).
- Blocks: Ban-Notice (+Wide) and the moderator ban tool.

**6. Badge visibility middle option: LATER**
- Question: what is the middle choice between always showing and hiding a badge?
- Options: "On hover" (the spec's word), "On tap" (phones can't hover), or drop the middle option.
- Recommendation: drop it. Hover and tap behave differently, and two choices are clearer.
- Blocks: BadgeSettings only.

**7. Matrix and Telegram addresses: LATER**
- Question: what are X2F's real Matrix and Telegram addresses?
- Options: none. The owner supplies them. `#x2f-help:example.org` and `@x2f_help` are examples.
- Recommendation: none. We need the real ones before launch.
- Blocks: Ban-Notice, HoldChange, TradeTechIssue and Maintenance copy, at launch.

**8. Password-only changes after 24 h: BLOCKING**
- Question: after the 24 h wait, do password-only changes to login methods, wallets or team apply on their own?
- Options: apply on their own; or need a moderator or the recovery code to confirm.
- Recommendation: apply on their own, as HoldChange shows. Anyone logged in can cancel during the 24 h, and the owner is alerted on every channel.
- Blocks: HoldChange (+Wide) and the hold logic in the build.

**9. Which "Post an offer" ships: BLOCKING**
- Question: which offer form do we build?
- Options: PostOffer (one price ± % per currency, simpler) or FlexOffer-Post (bands per currency, each with its own ± %).
- Recommendation: FlexOffer-Post. The owner's band rules (whole units, next band +1, up to 5 currencies) only fit there.
- Blocks: building offer posting; question 11 depends on it.

**10. Session length: tiles or drop-down: LATER**
- Question: the owner said "drop-down, nothing pre-selected". Design drew four tiles instead. Which one?
- Options: tiles (one tap, choices visible), or a drop-down (the owner's word).
- Recommendation: tiles, still with nothing pre-selected. This is a visual call, but it changes the owner's word, so we're asking.
- Blocks: SessionLength (+Wide), SignupSecurity, Devices. The build can start with either one.

**11. New: pairing payment methods with currencies: BLOCKING (with 9)**
- Question: when a vendor posts an offer, do they pick payment methods first and then the currencies each one takes, or currencies first and then the methods for each?
- Options: method-first (a card per method, the currencies it takes ticked inside, instructions per currency only where they differ); or currency-first (a USD | EUR switch, with methods and instructions under each currency, as FlexOffer-Post draws now).
- Recommendation: method-first, the same as claude2. Instructions belong to the method and differ by currency only sometimes (bank transfer: USD routing vs EUR IBAN). Bands stay per currency in their own section with the USD | EUR switch.
- Blocks: FlexOffer-Post (+Wide) redraw (design, about 1 day after the answer) and the offer form build.

**12. New: the glance says "Pay now" while the trade room says wait for escrow: BLOCKING (build fix, rule check)**
- Question: may a trade glance (Desktop list, Fold cover, notifications) ever say "Pay now" before escrow is secured?
- Options: no, the glance always shows the trade room's own state ("Securing escrow" first, "Pay now" only once escrow is secured); or keep a separate, earlier glance.
- Recommendation: no. The glance must mirror the trade room. Telling a buyer to pay before the coins are locked is the one mistake that loses them money. The boards already draw it this way: "Pay now" is the escrow-secured state on Desktop and the Fold boards. This is a build bug to fix, and the owner only needs to confirm the rule.
- Blocks: the glance in the build. No board change is needed.

**Still COPY-UNSIGNED** (unchanged until signed): every COPY-UNSIGNED line in the five `fixed-*.md` files, all of Settings and FAQ, and the Ban-Notice lines listed above (6 Nov evening).


# From the lead's parked branches (built the cautious way; these can wait)
## hold-v3
1. PGP-alone sessions: their changes still queue like password-only ones. Today's 10-29 rule is kept; v3 says "username+password-only".
2. Which changes queue: all of today's security changes are queued, not only login methods, wallets and team. That includes login name, one-device, logout timer, recovery code and wallet adds. Wallet removal and member removal stay immediate, because they only take access away.
3. A later submission resets every waiting change to 24 h from the latest submission (one date).
4. Submitted changes survive the revocation of the session that staged them; drafts do not.
5. Team members cannot see or cancel the lead's waiting changes (owner-only routes).
6. A recovery-code login discards waiting password-only changes.
7. Partner may still leave a held trade (buyer cancel or seller walk-away); everything else is refused. Chat and disputes stay open.
8. The new recovery code can be revealed by any full lead session opened after its use, a password-only one included. It is sealed with the TOTP key store under its own context.
9. TOTP backup login is removed (owner: TOTP-only login not allowed).
10. Password+TOTP on a new device with only weak sessions open still goes in (the R2 N-I3 rule kept). Only "no device at all" requires passkey, key or PGP.
11. Incident ID for the moderator pop-up: not built.
12. Moderator end/extend: alerts only, no audit row. Sessions are untouched on end.
13. Cap of 20 changes per account (`too-many-changes`).

## sessions
1. How long does the prompt wait before logout? It is the named constant `SESSION_PROMPT_MS`, drafted at 2 min.
2. Should the Devices setting change only this session (as built), or also something like a default? The board leaves the default undecided.
3. Should a longer length chosen mid-session add time at once (that would need a proof), or from the next confirm (as built)?
4. Should team members be able to extend with their own login methods?
5. Should signup ask for the session length too?
6. Should any idle logout remain on top of the session length? Today there is none.

## vendor
1. Other vendor requirements (e.g. N completed trades)? Built: a key only.
2. Switching back to trader: what happens to live offers and the team? Built: not possible yet (400). The UI says "comes later".
3. Does a password-only or recovery-code login affect vendor status? Built: no effect. The switch itself needs a confirm with a passkey, security key or PGP key, but no strong session (PGP-alone sessions can switch).
4. Migration: accounts with offers or team but no key stay traders with grandfathered offers (listed, can pause/remove, can't relist) and their team kept (can't invite or change roles). Should they instead be vendors anyway, or have their offers paused?
5. Bans: should look-alikes of a banned display name be refused too (like staff names)? Should a timed or lifted ban (Plan 4 `ban-lifted`) remove entries? Built: forever, no removal function. Should banning a vendor also ban its members' logins and keys? Not done.
6. Rotating out an X2F_LOGIN_NAME_KEYS key retires the bans tagged under it (there is no plaintext to re-tag from). Keep old keys in the ring.
7. Session lengths per type (trader 2/4/6/12, vendor 2/6/12/24) are not part of this branch.


# Wording to sign or reject (added from design's audit, 6 Nov)
- Ban-Notice: contact rows now say "Message a moderator on Matrix" (they said "Message the team"), plus new hero copy and an "Account banned" chip. All marked Draft copy. Design reverts anything rejected.
