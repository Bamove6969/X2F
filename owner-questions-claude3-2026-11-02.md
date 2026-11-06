# Questions for the owner from claude3 — 2026-11-02 afternoon

Each question has my recommendation. "OK" or a number plus a short answer is enough.

## Feedback form
1. The form now allows 1 send per 30 s per person. There is also a cap of 5 sends a day per person. You said "otherwise unlimited": remove the 5-a-day cap? **Rec: keep it** (stops one person flooding the inbox).
2. If our database fails while saving, the send doesn't count toward the 5, but the person still waits 30 s before trying again. OK? **Rec: OK.**

## Reviews and the "Completed over $X" line
3. Wording: "Completed over $90,000 in trades to date" or "$90,000+ in trades to date"? **Rec: keep "over".** It is now true at the exact number: $90,000.00 exactly shows "over $80,000".
4. A total of exactly $10,000 shows nothing (it has to be over $10,000). OK? **Rec: OK.**
5. "Overturned" (the review gets erased): does it mean only an appeal that reverses the first ruling? Or also a later dispute that goes the other way? Example: the trade was released, late money turned up, and the moderator ruled for a refund. **Rec: both.**
6. Once a trade's review is erased: nobody can review that trade again, and any "Skip review" on it is erased too. Confirm? **Rec: yes.**
7. Should an overturned trade still count toward the dollar total? **Rec: yes, keep counting it.** The trade still happened; the rule so far is that a settled dispute counts whoever won.
8. Imported volume from other sites counts only once a moderator enters the verified dollar figure. Should it also wait until the moderator has approved the claim itself, or count as soon as the claim is signed? **Rec: approved claims only.**
9. Who may enter that verified dollar figure: moderators only, or the owner as well? **Rec: owner too.**
10. A trader with zero trades on X2F but verified imported volume: does the line show from imported volume alone? **Rec: yes.**

## Past reputation (PGP key claims)
11. If account A's claim on a key is revoked, can account B then claim the same key? **Rec: no.** A key stays tied to the first account that claimed it.
12. The 4-point signing help list shows on every key and signature refusal. OK? **Rec: OK.**

## Personal details in review notes and proofs
13. Phone numbers written in groups, like "612 345 678", currently get through in review notes (they are still blurred in proof images). This came from your "numbers with separators up to ~9 digits are allowed" rule. Refuse them, since notes refuse all personal details? **Rec: refuse** grouped 9-digit numbers that look like phones (3-3-3 or 3-2-2-2 with spaces). Keep allowing amounts like 1,250,000.
14. Comma-grouped numbers over 9 digits in notes (1,234,567,890): refuse? **Rec: refuse.**
15. Should the apostrophe count as a thousands separator too (Swiss style, 1'250'000)? **Rec: yes.**
16. "Notes refuse ALL personal details": does that also cover @handles, street addresses, and names after a label like "Name:"? Proof images already blur these. **Rec: yes.**
17. Proof images: the automatic blur keeps the amount clear when it sits next to a word like "Amount", "Total" or "Paid" (in 14 languages). A bare number equal to the amount with no label is still blurred, since it might be a reference number. OK? **Rec: OK.**
18. Proof images: if the uploader blurs the amount themselves, that blur may grow slightly when it merges with nearby automatic blurs. OK? **Rec: OK.**

## Staff tools
19. Staff accounts can still log in on the normal trader website (they need the separate staff site for staff work). Block staff logins on the trader site? **Rec: block staff and moderators. Keep the owner able to log in there** (the owner's price-health page lives on the trader site).

If any Plan 4 build step needs a decision that isn't in the plan, I build the plan's default, mark it OWNER-Q and keep going. I'll send you those in batches.

## Parked items you've already answered (the lead was going to confirm how to build them)
20. Item 62, a buyer pays less than asked: my reading of your answer is that nothing changes on the seller's card and no prompt is shown; the seller decides whether to accept or dispute. Correct? **Rec: yes.**
21. Items 63 ("screenshot not current") and 64 ("no amount found") pop-ups to the person posting the proof, plus item 65's disclaimer: the designer is out until Wednesday. Build them now using the existing design kit, with the designer restyling later? Or wait for the designer? **Rec: build now.**

## New (2026-11-03)
22. Proof IMAGES: card-length numbers written with commas or apostrophes (4,111,111,111,111,111 or 4111'1111'1111'1111) are not blurred today. Blur them? **Rec: yes, on images only** (notes stay relaxed as you said).
23. Disputes: the 24 h is built as the GOAL; traders still see a hard "ruling due by" of 48 h. Keep 24 h goal + 48 h deadline? **Rec: yes.**
