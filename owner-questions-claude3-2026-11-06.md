# Open owner questions from claude3, 2026-11-06

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

**29. Owner setup page: the design shows the PGP key as "(optional)", but your earlier answer (A9) and the system require it.** Built: required, and the "(optional)" label is dropped.
- A: required (built).
- B: truly optional.
- **Rec: A.**
- Blocks: nothing.

**30. On the staff site, the "leave feedback" link in the "you can't do that" box goes to the owner's feedback inbox, so a moderator who taps it sees "nothing to show for your role".**
- A: on the staff site, send staff feedback to the same feedback form traders use.
- B: hide the link on the staff site.
- **Rec: A.**
- Blocks: nothing.

**31. The staff feedback list shows each sender only as "Named" or "Anonymous", never which account sent it.** Is that right for the owner's view?
- A: yes (built).
- B: show the account name for named feedback.
- **Rec: B.** "Named" means the sender chose to be identified.
- Blocks: nothing.

**32. The owner's staff menu has 8 items: Feedback is added before Settings (the plan listed 7). The News editor sits under Overview.** Neither placement is on a design board.
- A: as built; the designer places them finally.
- B: other placement.
- **Rec: A.**
- Blocks: nothing.

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
