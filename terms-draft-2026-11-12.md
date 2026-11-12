# Terms wording draft from the owner's /setup comments, 2026-11-12

**Status: every proposed paragraph below is COPY-UNSIGNED.** It goes to design and to the lawyer before it ships. Nothing here is built.

**Sources.**
- The owner's 16 comments on the signup Terms screen (`/setup`, `data-screen="setup-terms"`): `owner-demo-notes-2026-11-12.jsonl`, the entries with pathname `/setup`.
- The current text: `apps/web/src/screens/setup/termsText.ts` on `origin/main` 8246e64b (`TERMS_TEXT_VERSION = '2026-11-09'`).
- The rulings checked: `owner-decisions-2026-11-06.md`, `owner-answers-*.md`, and R37 and R40 in `docs/superpowers/rulings-and-lessons.md`.

**How the CSS paths map.** Each comment's CSS path is `div.x2f-terms > section.x2f-terms__section:nth-of-type(N) > p.x2f-terms__p:nth-of-type(M)`. In that path:
- `section:nth-of-type(N)` is `TERMS[N-1]`, the section headed "N. …". The draft note above the sections is a `<p>`, not a `<section>`, so it does not shift the count.
- `p:nth-of-type(M)` is paragraph M of that section.

**The owner's general instruction** (on `#terms-sign-help`, the signature help line), verbatim:
> "All comments I leave are recommendations to be discussed amongst lead and designer and if needed to come to me with questions"

So each proposal below is a recommendation for the lead and design, and the questions go to him only where they are needed.

**When this ships:** the text and the server's `X2F_TERMS_VERSION` change together, and `TERMS_TEXT_VERSION` gets a new date. Every account then signs again at its next login, as built. The key points above the box may need matching edits; see Q-K at the end.

---

## 1. Section 2 "Your account", paragraph 2 (comment 9fe3fa43)

**Current:**
> You pick a public username and a private login name. Keep your login method and any backup safe. X2F has no way to reset them for you, so if you lose them you may lose the account and its reputation. Your coins stay safe in your own wallet either way.

**Owner, verbatim:**
> Public display name

**Proposed (COPY-UNSIGNED):**
> You pick a private username, which you type to log in and only you see, and a public display name, which is how other traders see you. Keep your login method and any backup safe. X2F has no way to reset them for you, so if you lose them you may lose the account and its reputation. Your coins stay safe in your own wallet either way.

**Note:** the current text is also out of step with what is built. The setup screens on main call the private one "username" ("You type this to log in. Only you see it.", Username.tsx) and the public one "display name" (DisplayName.tsx). The proposal uses the built names. No question.

---

## 2. Section 2 "Your account", paragraph 3 (comment 4e04a245)

**Current:**
> One person, one account. Do not sell, share or lend your account.

**Owner, verbatim:**
> I don't want them to think they can't have team members so maybe some wording except if you choose to setup additional team members.

**Proposed (COPY-UNSIGNED):**
> One person, one account. If you want others to help you trade, set them up as team members of your account: each team member gets their own login. Do not sell, share or lend your account or your own login.

**Note:** this matches what is built: team members join with their own login account and sign the Terms themselves (MemberInvite, review 2026-11-08 F1). No conflict.

---

## 3. Section 3 "Trades and escrow", paragraph 1 (comment e79231ba)

**Current:**
> Your coins stay in your own wallet, except while they are locked in a trade's 2-of-3 escrow. X2F holds one of the three escrow keys and can never move coins on its own.

**Owner, verbatim:**
> Are these different methods or are they features:
>
>
> Key Characteristics & Implementations
>
> • Non-Custodial Design: Modern implementations—such as Onyx-Escrow, XmrBazaar Escrow, or decentralized platforms like Haveno—aim to be non-custodial or client-side (often executing via WebAssembly or browser-native scripts) so the escrow coordinator never actually holds or steals the raw funds.
> • Peer-to-Peer Trading: It is commonly used on P2P marketplaces (such as XMR Local) to prevent exit scams by either the buyer or the seller.
> • Privacy Preserved: While a 2-of-3 multisig structure coordinates who signs off on the spend, the underlying Monero transactions still leverage ring signatures and stealth addresses on-chain to keep transaction amounts and participants hidden from outside observers.
> Are you looking to use a specific platform for a trade, or do you need help understanding how to set up a manual CLI/GUI Monero multisig wallet?

**This is a question, not wording.** The answer for him: these are not different methods. They are features of the one method this paragraph already describes, 2-of-3 Monero multisig escrow. X2F has all three:
- It is non-custodial: X2F holds one key of three and cannot move coins alone. The wallets also run in the trader's own browser, in WebAssembly.
- It is used peer to peer, which is the point of the site.
- On-chain privacy comes from Monero itself.

The products named (Onyx-Escrow, XmrBazaar, Haveno, XMR Local) are other platforms. They should not appear in our Terms.

**Proposed (COPY-UNSIGNED):** keep the current paragraph, and optionally add one sentence that makes the privacy point:
> Your coins stay in your own wallet, except while they are locked in a trade's 2-of-3 escrow. X2F holds one of the three escrow keys and can never move coins on its own. Escrow payments are ordinary Monero transactions, so amounts and addresses stay hidden on the blockchain.

**Q-1 (for the lead to answer him, or design to take):** should the added sentence go in? I recommend yes: it says something true and reassuring without naming anyone else. The lawyer should check that "stay hidden" does not over-promise.

---

## 4. Section 3 "Trades and escrow", paragraph 3 (comment ca2b6a83)

**Current:**
> Only the seller funds the escrow, and funding it is a commitment to the trade. The buyer pays the fiat exactly as the trade says and marks it paid. The seller confirms the payment and releases the XMR. A release cannot be undone.

**Owner, verbatim:**
> Exactly with the method that was requested, posts proof, and marks it paid upon completion. The seller confirms receipt of chosen payment method and releases XMR which are immediately transferred to buyers external wallet. A release cannot be undone but can be disrupted.

**Proposed (COPY-UNSIGNED):**
> Only the seller funds the escrow, and funding it is a commitment to the trade. The buyer pays exactly as the trade says, with the payment method that was requested, posts proof of payment and marks the trade paid once the payment is complete. The seller confirms that the payment has arrived through that payment method and releases the XMR, which goes straight to the buyer's own wallet. A release cannot be undone, but it can be disputed.

**Typo:** "disrupted" is taken as "disputed" (lead's reading).

**Q-2 (proof):** "posts proof" makes proof part of every trade. On main, proof upload is built but switched off (`VITE_X2F_PROOF_UPLOAD`, off), and the rulings allow posting a proof the checker doubts (Q43, G16). Is proof expected on every trade, or only when there is one? If it is optional, the wording becomes "posts proof of payment where they can".

**Q-3 ("immediately transferred"):** the XMR leaves escrow as soon as the seller releases, but it is a Monero transaction that needs network confirmations before the buyer can spend it. I wrote "goes straight to the buyer's own wallet" rather than "immediately". The owner can confirm.

**Q-4 ("can be disputed"):** this is consistent with the rulings: a dispute after a release is decided by a moderator, and restitution goes through a lien (Q37, R40). R40 also says "coins of a settled trade are never moved again". So a dispute after a release cannot pull back the released coins; it can only order the loser to repay. The lawyer should make sure "can be disputed" is not read as "can be reversed on-chain".

---

## 5. Section 3 "Trades and escrow", paragraph 4 (comment aaf06c2f)

**Current:**
> Never release coins before you have checked that the money has arrived in your own account. A screenshot is not a payment.

**Owner, verbatim:**
> A screenshot is considered proof but not a guarantee, anything can be photoshopped these days. Always check to make sure payment has arrived before you release the escrow.

**Proposed (COPY-UNSIGNED):**
> A screenshot counts as proof, but it is not a guarantee: anything can be edited these days. Always check that the payment has arrived in your own account before you release the escrow.

**Note:** I changed "photoshopped" to "edited" because it is a trademark; design can keep "photoshopped" if wanted. No conflict.

---

## 6. Section 3 "Trades and escrow", paragraph 5 (comment 7a830826)

**Current:**
> Each trade has timers. When a timer runs out, the trade moves on as the trade screen explains, for example a refund to the seller when the buyer does not pay in time.

**Owner, verbatim:**
> and these timers are based on the individual payment method chosen. So if a payment method selected is typically instant but can take up to 2 hours to complete then we will give the buyer 2 hours to at least indicate they have sent the funds via the chosen payment method. Once the time granted to buyer is up and if the buyer has not marked the trade paid the seller will have the option of cancelling the trade and immediately having all escrowed funds returned to their wallet.

**Proposed (COPY-UNSIGNED):**
> Each trade has timers, and they are based on the payment method chosen. For example, if a payment method is usually instant but can take up to 2 hours, the buyer gets 2 hours to mark the trade paid through that payment method. If that time is up and the buyer has not marked the trade paid, the seller can cancel the trade, and the refund of all the escrowed XMR to the seller's wallet starts at once. The trade screen always shows the time left.

**Note:** the current example ("a refund to the seller when the buyer does not pay in time") is wrong for what was ruled. The refund is not automatic: the seller chooses to cancel (owner reversal: "the time to pay is not a hard end"). His wording fixes that.

**Q-5 (times not decided yet):** the per-payment-method times are being researched (p11-29). The builder's defaults (90 min, 3 h, 24 h) are not approved, so the 2-hour figure stays an example and no real numbers go in the Terms. Agreed?

**Q-6 ("immediately … returned"):** the refund starts at once, but it needs 10 confirmations before the trade is complete (owner reversal, p11-37: "XMR has begun refunding back to their wallet", with a confirmations count). I wrote "starts at once".

**Q-7 (late buyer):** the rulings let a late buyer still pay, and if the seller then cancels, the buyer can dispute (p11-18). Should one sentence say so here? I recommend yes: "If you paid late and the seller cancels, open a dispute and we will help you get your money back."

---

## 7. Section 4 "Fees", paragraph 1 (comment 10475770)

**Current:**
> You pay X2F 1% of each completed trade from your own ads. Taking an offer is free.

**Owner, verbatim:**
> X2F collects a 1% fee of the total amount traded in XMR. If you are a seller posting an ad you pay a 1% fee of the total amount of the XMR you sell in the trade. Vice versa, if you are a buyer posting an ad to buy XMR you will pay a 1% fee off the total amount traded. Very simple.

**Proposed (COPY-UNSIGNED):**
> X2F collects a fee of 1% of the total amount traded, paid in XMR when the trade completes. Whoever posts the ad pays it. If you post an ad to sell XMR, you pay 1% of the XMR you sell. If you post an ad to buy XMR, you pay 1% of the XMR you buy. Taking someone else's ad is free. If a moderator fully reverses a trade, there is no fee. Very simple.

**Note:** this is consistent with the rulings and with what is built: the poster always pays 1% (p10-1), the fee is subtracted at completion (p9-1), and taking is free.

**Additions to his text, both from rulings:**
- "Taking someone else's ad is free." This was in the current text and is his recorded ruling.
- "If a moderator fully reverses a trade, there is no fee." This is g63. The rest of g63 (an appeal that upholds completion or a lien means the fee is paid; during an appeal the fee waits) is left to design's fee explanation, as g63 itself says.

Whether to keep "Very simple." is design's call.

---

## 8. Section 5 "Disputes and moderators", paragraph 1 (comment d1c8cb70)

**Current:**
> If something goes wrong, either side can open a dispute within the times the trade screen shows. A moderator then reads the trade and its chat, asks for evidence and decides where the escrow goes.

**Owner, verbatim:**
> If something doesn't go as planned or during a disagreement between parties that cannot be resolved on your own a dispute may be started both during the trade and for a short period even after the trade completes.

**Proposed (COPY-UNSIGNED):**
> If something doesn't go as planned, or you and the other trader disagree and cannot sort it out yourselves, either of you can open a dispute, both during the trade and for a short time after it completes. The trade screen shows how long you have. A moderator then reads the trade and its chat, asks for evidence and decides the outcome.

**Q-8 (how long after completion):** "a short period" has no fixed length in the rulings, and they point two ways:
- 8 Nov chat retention: "kept 30 days after the trade closes (a dispute can be opened in that window)".
- p11-17: he wants a 48-hour dispute window changed to 72 hours. The lead has not yet confirmed which window that is.

The Terms only say "the trade screen shows how long you have", so they stay true either way. But the owner should confirm the length before launch.

I also changed "decides where the escrow goes" to "decides the outcome", because after a release there is no escrow left (see Q-4).

---

## 9. Section 5 "Disputes and moderators", paragraph 2 (comment 9cdeeb48)

**Current:**
> Chats are encrypted. If a dispute is opened, a moderator can read that trade's conversation, and every read is logged.

**Owner, verbatim:**
> The moderator that the chat is assigned to can decrypt the chat and have full access to all conversations and logs of what has transpired. We also log all actions of our moderators so we can audit our own staff to make sure the best outcome for all parties. The goal of the moderator is to see the trade completed unless that outcome is not possible and then the next best outcome would bea full reversal of the trade, like it never happened.

**Proposed (COPY-UNSIGNED):**
> Chats are encrypted. If a dispute is opened, the moderator assigned to it can decrypt the trade's chat and has full access to the whole conversation and the record of what happened in the trade. If the decision is appealed, a senior moderator or X2F's owner can see the same. We log every action our moderators take, so we can audit our own staff and make sure of the best outcome for everyone. A moderator's goal is to see the trade completed. If that is not possible, the next best outcome is a full reversal of the trade, as if it never happened.

**Typo:** "bea" is fixed to "be a".

**Note:** I kept "if a dispute is opened". His wording leaves it out, but the key point above the box says "Moderators can read your trade chat only if a dispute is opened", and the access model (p11-2) adds the moderator only on a dispute.

**Q-9:** the sentence about the senior moderator or the owner seeing the chat on appeal is an addition from p11-2. Should it stay? I recommend yes, for honest disclosure.

**Q-10 (lawyer):** "a full reversal … as if it never happened" is about the money only. Feedback and totals follow the final outcome (Q40, Q41), and a dispute record is kept 90 days. The lawyer should check that "as if it never happened" does not promise that the records are erased too.

---

## 10. Section 5 "Disputes and moderators", paragraph 3 (comment 358d1d75)

**Current:**
> You can appeal a decision once, within the window shown with the decision.

**Owner, verbatim:**
> If you are not satisfied with the outcome of our moderator you can speak the decision within the timeframe stated and then a senior moderator will intervene and review all information and make a final, binding decision.

**Proposed (COPY-UNSIGNED):**
> If you are not satisfied with the moderator's decision, you can appeal it once, within the time shown with the decision. A senior moderator who had no part in the first decision then reviews all the information and makes a final, binding decision.

**Typo:** "speak" is taken as "appeal" (lead's reading).

**Note:** this is consistent with the rulings:
- One appeal, final (D-010).
- 48 hours (R40). I left the number out and said "the time shown", so the Terms stay true if it changes.
- "No part in the first decision" is R37.

I kept "once" from the current text, because the rulings allow one appeal. The rulings also let the owner decide an appeal ("another senior mod or the owner"). If that should be said, the wording becomes "a senior moderator (or X2F's owner) …". That is the owner's call, so it is a small question (Q-11).

---

## 11. Section 6 "Privacy and data", paragraph 1 (comment d1a46566)

**Current:**
> X2F keeps only what a trade needs, and deletes it after a set time. X2F does not track you, does not use analytics and removes location and device details from uploads.

**Owner, verbatim:**
> X2F keeps trades available for review for 30 days and then all data is purged. Disputes trades are kept for 90 days, scrubbed of personal and confidential information with our internal privacy tool, and then used for training moderators. At the 90 day mark they are completely purged. Keep the part after this about "X2F does not track....."

He asks to keep this line exactly:
> X2F does not track you, does not use analytics and removes location and device details from uploads.

**Proposed (COPY-UNSIGNED):**
> X2F keeps only what a trade needs, and deletes it after a set time (below). X2F does not track you, does not use analytics and removes location and device details from uploads.

His retention wording goes into paragraph 3 of this section (next item), where the retention sentence already is. His later comment on that paragraph asks for exactly that.

---

## 12. Section 6 "Privacy and data", paragraph 3 (comment 9a1b5c46)

**Current:**
> Completed trades, chat included, are erased for good on day 30 after they end. Disputed trades are kept for up to 90 days after the dispute closes, with private details removed by our privacy tool, and used to train our moderators while X2F grows.

**Owner, verbatim:**
> I didn't see this before I wrote my previous comment so just make sure it includes a variation of what I was saying and I'm happy.

**Proposed (COPY-UNSIGNED)**, merging his wording from item 11:
> X2F keeps a completed trade available for review for 30 days after it ends, then erases it for good, chat included. A disputed trade is kept for 90 days after the dispute closes. During that time it is scrubbed of personal and confidential information by our internal privacy tool and used to train our moderators. At the 90-day mark it is erased for good.

**Note:** this is consistent with the rulings: 30 days (C-001, p11-17), 90 days from the dispute closing (8 Nov, p11-9, p11-11), and scrubbed for training (p11-9).

**Q-12 ("all data is purged"):** I narrowed his "all data" to "the trade". What outlives the 30 days by ruling:
- your feedback and trade totals, which are your reputation (Q40, Q41);
- the account itself, closed only after 60 days without a login.

Saying "all data" would over-promise. The lawyer should confirm.

**Q-13 (the training copy):** "used to train our moderators" and "erased for good" at 90 days together mean the scrubbed training copy is also deleted at day 90. That is my reading of "At the 90 day mark they are completely purged." Is that right, or does a scrubbed copy stay for training? If it stays, both the Terms and the key point change.

---

## 13. Section 8 "Prohibited use", paragraph 1 (comment 32b26d90)

**Current:**
> Do not use X2F for money from crime, to hide where money came from, or to break the law where you live.

**Owner, verbatim:**
> Or to violate AML/CFT laws. That's not what the site was designed for.

**Proposed (COPY-UNSIGNED):**
> Do not use X2F for money from crime, to hide where money came from, to break anti-money-laundering or counter-terrorist-financing (AML/CFT) laws, or to break the law where you live. That's not what X2F was built for.

**Q-14 (lawyer):** naming AML/CFT laws is right as a prohibition. But the lawyer should check it cannot be read as a promise that X2F screens users, since X2F collects no identity (section 7 and the key points).

---

## 14. Section 8 "Prohibited use", paragraph 2 (comment f9de831e)

**Current:**
> Do not cheat, threaten or mislead other traders, and do not ask them to trade outside X2F.

**Owner, verbatim:**
> And never ask them to trade or chat outside of X2F - doing so loses you all protections the site offers.

**Proposed (COPY-UNSIGNED):**
> Do not cheat, threaten or mislead other traders, and never ask them to trade or chat outside X2F. Doing so loses you all the protections X2F offers.

No conflict.

---

## 15. Section 8 "Prohibited use", paragraph 4 (comment e5caa606)

**Current:**
> X2F may pause or close an account that breaks these rules. Coins in escrow are then settled by a moderator under the dispute rules.

**Owner, verbatim:**
> ...any account at our own discretion without warning and without reason. If we feel and account is a threat to the site or to our users we will take actions to protect them and ourselves. We do not take the security of our users lightly.

**Proposed (COPY-UNSIGNED):**
> X2F may pause or close any account at its own discretion, without warning and without giving a reason. If we believe an account is a threat to the site or to our users, we will act to protect them and ourselves. We do not take the security of our users lightly. Coins in escrow are then settled by a moderator under the dispute rules.

**Typo:** "and account" is fixed to "an account".

**Note:** I kept the escrow sentence, so a pause can never strand a counterparty's coins.

**Q-15 (conflicts with his ban rulings):**
- The ban notice he approved (G39) says "If you feel this has been done in error, please reach out to a moderator", which implies the user can learn why and contest it.
- Moderators pick a ban length from a rules list that is still to come (Q15).

"Without reason" sits awkwardly with both, and the lawyer should check whether "without reason" holds up under consumer law where users live. My recommendation: "without warning, and without always giving a reason", plus a pointer to the ban notice's contact route.

---

## 16. Section 9 "Liability, changes and law", paragraph 2 (comment 4f01cb96)

**Current:**
> When these Terms change, X2F shows them again at your next login, and trading waits until you accept the new version.

**Owner, verbatim:**
> Remember, this is a new platform so we are evolving based on feedback and no rule is permanent and without consideration for change for the betterment of the site and our users. We strongly recommend and ask that you leave feedback and help shape this platform.

**Proposed (COPY-UNSIGNED)**, keeping the current sentence and adding his:
> Remember, X2F is a new platform. We are evolving based on your feedback, and every rule can be reconsidered and changed for the good of the site and our users. We strongly encourage you to leave feedback and help shape X2F. When these Terms change, X2F shows them again at your next login, and trading waits until you accept the new version.

**Q-16 (where does site feedback go?):** "feedback" also names the trade-rating feature. Where should users send feedback about the site: a support ticket, or the Matrix or Telegram contact from the ban notice? The sentence should name the channel, or say "contact us", so it isn't read as trade feedback.

**Lawyer:** "every rule can be … changed" is fine, because the re-acceptance at next login (the second sentence) is what makes a change binding. Keep that sentence.

---

## Questions, in one list

- **Q-1:** Add the Monero privacy sentence to the escrow paragraph? Recommend yes.
- **Q-2:** Is proof of payment expected on every trade, or only where the buyer has one? (Proof upload is off on main.)
- **Q-3:** Release wording: "goes straight to the buyer's own wallet" rather than "immediately"? (It needs network confirmations.)
- **Q-4 (lawyer):** "can be disputed" must not read as "can be reversed on-chain". Restitution is through a lien (R40).
- **Q-5:** Keep the 2-hour figure as an example only, until the payment-method research (p11-29) is in?
- **Q-6:** A cancelled trade's refund "starts at once" and completes after 10 confirmations, not "immediately returned". OK?
- **Q-7:** Add the late-buyer sentence (they can dispute if the seller cancels after a late payment, p11-18)? Recommend yes.
- **Q-8:** How long after completion can a dispute be opened? 30 days (8 Nov retention line) or 72 hours (p11-17, window not yet confirmed)?
- **Q-9:** Say that a senior moderator or the owner can see the chat on appeal (p11-2)? Recommend yes.
- **Q-10 (lawyer):** "As if it never happened" is about money only. Feedback, totals and the 90-day record follow the rulings.
- **Q-11:** Mention that the owner may also decide an appeal?
- **Q-12 (lawyer):** "All data is purged" is narrowed to "the trade". Reputation and the account outlive day 30.
- **Q-13:** Is the scrubbed training copy deleted at day 90 too? (My reading: yes.)
- **Q-14 (lawyer):** The AML/CFT prohibition must not imply that X2F screens users.
- **Q-15:** "Without reason" conflicts with the G39 ban notice and the Q15 rules list. Recommend "without always giving a reason".
- **Q-16:** Which channel is "leave feedback" (support ticket, Matrix, Telegram)?
- **Q-K (design):** the key points above the box. "Completed trades are erased on day 30" and "Disputed trades are kept up to 90 days…" still match. "Moderators can read your trade chat only if a dispute is opened" still matches, because of the kept qualifier in item 9. "If you post an ad, you pay a 1% fee when the trade completes" matches. No key point has to change unless Q-13 or Q-8 goes the other way.

## Added 12 Nov (owner: "I'm sticking to the US sanction laws"; "Crimea is under Russian control")
Proposed new line (COPY-UNSIGNED, lawyer to confirm): "You may not use X2F if you are in, or acting for anyone in, a country or region under comprehensive US sanctions, including Russia, Iran, Cuba, North Korea and the occupied regions of Ukraine (Crimea, Donetsk and Luhansk)."
X2F does not track location, so this is a Terms rule, not a technical block.
