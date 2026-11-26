# Terms legal review, 23 Nov 2026 (owner note #92)

For: the owner. From: the lead's builder, on branch `wip/lead-note-terms` (Terms text v2026-11-23,
`apps/web/src/screens/setup/termsText.ts`).

**This is not legal advice.** It is a careful read of the draft for clarity, consistency and
places where the words say something the app does not do, written with a severity x likelihood
risk method (the legal skill you added, note #92). Please have a lawyer check the whole Terms before
launch. The draft still says "[Placeholder: the final text comes from X2F's lawyer.]" and
"[Lawyer to word this.]", and those should stay until that happens.

## What is already in v2026-11-23 (not proposals)

These are applied in the text. They are your own words, with only the grammar tidied:

- #93: in section 1, a period after "with each other", and the next sentence starts "Here they can exchange their ...".
- #102: the key point now reads "We answer lawful warrants with what very little information we collect."
- #103, #104 and #105: in section 3, paragraph 3, a period after "requested", then your proof sentence, your "the seller then checks ... with their own eyes ... mark the trade completed" sentence, and "Marking a trade complete automatically transfers the XMR to the buyer's off-site wallet, minus the 1% fee paid to X2F."
- #106: in section 3, the last timer bullet is now your late-payment sentence. "The trade screen always shows the time left." is kept at its end.
- #107: section 7 now says "... we will provide what little information we hold within the scope of the writ."

Grammar tidies only: in #93, "to buy XMR" became "buy XMR" (the sentence now starts "Here they can exchange"). In #103, "and then marks the trade paid" became "and then mark the trade paid" (it follows "will be requested to post"). In #105, "The marking of s trade complete" became "Marking a trade complete", and "buyers" became "buyer's". In #106 the run-on sentence became one sentence, "the trader" became "the other trader" (the same words section 5 uses), and "Whether that be ..." was joined to the sentence before it.

No other wording was changed. Everything below is a proposal: **accept or reject each one by number**. A proposal that is accepted means a new Terms version, and everyone gets asked again (see the end of this page).

Risk scale used: Severity (S) 1-5 x Likelihood (L) 1-5. 1-4 GREEN, 5-9 YELLOW, 10-15 ORANGE, 16-25 RED.

## Proposals

### 1. The 1% comes out of the buyer's XMR only when the buyer posted the ad (section 3, note #105). S3 x L4 = 12 ORANGE

- **Current:** "Marking a trade complete automatically transfers the XMR to the buyer's off-site wallet, minus the 1% fee paid to X2F."
- **Proposed:** "Marking a trade complete automatically transfers the XMR to the buyer's off-site wallet. If the buyer posted the ad, the 1% fee paid to X2F comes out of that XMR. If the seller posted it, the seller paid the 1% on top when funding the escrow, so the buyer gets the full amount."
- **Why:** The code is `packages/trade/src/payouts.ts:74`, `toBuyer = poster === 'seller' ? amount : amount - fee`. When a seller's ad is taken, the buyer is not charged the fee, but the sentence as written tells every buyer they are. Section 4 already says the poster pays, so the two sections contradict each other. A wrong statement about a fee is the kind of thing consumer-protection rules care about.

### 2. "Mark the trade completed" and "release" are the same step, but the text uses both words (section 3). S2 x L3 = 6 YELLOW

- **Current:** "... only after confirming with their own eyes that they have received the payment do they mark the trade completed. ... A release cannot be instantly undone ..."
- **Proposed:** "... only after confirming with their own eyes that they have received the payment do they release the XMR, marking the trade completed. ... A release cannot be instantly undone ..."
- **Why:** In the app the seller's button and screens say "release" ("Press and hold ... Once released, the XMR can't be taken back", "XMR released"). Without this change, the next sentence's "A release" has nothing to refer to. In a legal text, one name per step avoids arguments about what was agreed.

### 3. A release cannot be disputed in the app (section 3). S4 x L3 = 12 ORANGE

- **Current:** "A release cannot be instantly undone, but it can be disputed and the funds recovered, to the best of our abilities, for the slighted party. Hopefully the moderator will end the trade amicably ..."
- **Proposed:** "A release by the seller is final: it cannot be undone or disputed once the XMR is sent to the buyer's wallet. (A moderator's release in a dispute can still be appealed.) If something goes wrong before that, our team is here to help."
- **Alternative:** keep the sentence and build disputes after a release. That is a product change and needs lead and security review.
- **Why:** In the code, a released trade is closed and any dispute is refused (`packages/trade/src/machine.ts:463-504`, where `released` falls to `default: fail('wrong-state')`). Promising a remedy the app cannot give is the most likely source of complaints. This is agy's question #2 (docs/agy-terms-decisions.md on `wip/agy-terms-questions`), with claude3's review fix M2.

### 4. The dispute window after a trade ends (section 5). S3 x L4 = 12 ORANGE

- **Current:** "... either of you can open a dispute, both during the trade and for a short time after it completes. The trade screen shows how long you have."
- **Proposed:** "... either of you can open a dispute while the trade is open. If the seller cancelled after the time to pay ran out and you had paid, you can still open one for 48 hours after the refund. Once the seller has released the XMR, the trade is closed and cannot be disputed. The trade screen shows how long you have."
- **Why:** The code gives no dispute after a completion (see proposal 3). After a refund, only the buyer can dispute, for 48 hours (`TIMERS.disputeAfterRefundHours = 48`, `packages/trade/src/timers.ts:19`, used at `machine.ts:489-500`). Also, during the trade the timing differs by stage. Before "I've paid", the seller can dispute at once and the buyer cannot (`machine.ts:466-470`). After "I've paid", either side waits the payment method's full time (`machine.ts:472-476`). While the seller's cancel refund is still settling, a buyer who paid late can dispute at once (`machine.ts:484`). Whether the Terms should say that much detail is your call.

### 5. Who can cancel when the time to pay runs out (section 3, timer paragraph). S3 x L4 = 12 ORANGE

- **Current:** "If the allotted time has run out, whoever started the trade can immediately cancel and receive the funds from escrow deposited back into their account."
- **Proposed:** "If the allotted time has run out and the buyer has not marked the trade paid, the seller can immediately cancel the trade and have the XMR in escrow refunded to the seller's own wallet."
- **Why:** Only the seller can cancel after the time to pay (`packages/trade/src/machine.ts:616-626`, `request-refund`). The refund goes to the seller's own wallet, and X2F has no "account" balance. Your own #106 bullet already says "the seller triggers a cancellation", so the paragraph and its bullet now contradict each other. Small extra point: before marking paid, the buyer can also cancel at any time (`buyer-cancel`, `machine.ts:628-633`). The XMR then goes back to the seller too, and the Terms could say so. This is agy's question #1.

### 6. "The outcome will always be fair" is an absolute promise (section 3, note #106). S3 x L3 = 9 YELLOW

- **Current:** "... whether that means seeing the XMR transferred to you or a refund of the payment you made. The outcome will always be fair."
- **Proposed:** "... whether that means seeing the XMR transferred to you or a refund of the payment you made. A moderator will look at the proof from both sides and decide fairly. Until the seller does what the moderator decides, they cannot trade on X2F."
- **Why:** "Always" is a guarantee, and a user who lost a dispute can quote it back at you. Also, X2F cannot force the money back. After the automatic refund (the moderation service co-signs in about 5 seconds, `machine.ts:478-484`), the XMR is already in the seller's wallet. The moderator's remedy is an order to the seller. The proposed wording says what X2F means to do. Note that **no lien check exists in the code yet**: the API never refuses a trade with a `lien` code. The `lien` entry in `apps/web/src/ui/cantDoCodes.ts:83` is only a guessed placeholder, waiting for Plan 4's lien work. So "they cannot trade on X2F" is true only once that lands. Until then, drop the last sentence or build the lien first.

### 7. Data retention: the words say "entirety ... purged", but the code keeps a stripped record (section 6 and the key points). S4 x L4 = 16 RED

- **Current (section 6):** "X2F only provides access to completed trades for 30 days, after which the entirety of the trade is purged. The only exception to this is if there is a dispute, in which case the dispute is kept for 90 days after completion, after being scrubbed with our internal privacy tool, and used for training moderators. At the 90-day mark it is all purged, no exceptions."
- **Current (key points):** "Completed trades are erased on day 30." and "Disputed trades are kept up to 90 days, cleaned by our privacy tool, to train our moderators."
- **Proposed (section 6):** "X2F gives access to a completed trade and its chat for 30 days after the trade ends. After that, the chat, its messages and the payment proofs in it are permanently purged. If there was a dispute, the disputed trade's chat is kept for 90 days after the dispute (or the trade, if later) closes, and is then purged. The wallet addresses used in a trade are deleted 90 days after it ends. What stays is a stripped record of each trade (its code, the two accounts, the amounts and how it ended), so trade counts and reputation keep working."
- **Proposed (key points):** "Trade chats are erased 30 days after the trade ends." and "Disputed chats are kept up to 90 days after the dispute closes."
- **Why:** This is the most important item on the list. A privacy statement that says more than the code does is a classic data-protection and consumer-protection problem. The code differs in three ways:
  - (a) The 90 days run from the dispute's close, not from completion (`packages/trade/src/chat.ts:199`).
  - (b) The `trades` row is never deleted. Wallet addresses are nulled at 90 days for every trade (`apps/api/src/trades/purge.ts:5,20-31`), and only the chat is purged at 30 days (`apps/api/src/chat/retention.ts`).
  - (c) There is no scrubbed training copy of disputes in the code today. The only "privacy tool" is the proof blur check.
- **Alternative:** change the code to match your words: delete the whole trade row and keep only counters. Either the words or the code has to move. This is agy's question #4.

### 8. Say plainly what X2F does collect (section 6; note #102 and section 7). S3 x L3 = 9 YELLOW

- **Current:** The Terms say what X2F does *not* collect: no email, no phone, no IP addresses, no analytics. They also say "we don't ... ask for your name". They never say what X2F *does* hold.
- **Proposed:** Add a paragraph to section 6: "What we do keep: your username and Trade Tag, your login keys (never your password itself), the Terms version you accepted with your signature, your ads, your trades and their encrypted chats for the times above, your ratings, and a log of what our moderators do. Uploads have location and device details removed."
- **Why:** A "we collect very little" promise (#102) is easier to defend when it lists the little. The sign-up asks for a signature, and its fallback is "Type your name to sign" (`apps/web/src/screens/setup/SignaturePad.tsx:163`), stored with the acceptance (`apps/api/src/accounts.ts:369`). That can be a real name, so "we don't ask for your name" needs a lawyer's eye. Most privacy laws expect a list of what is kept, why, and for how long. The lead should confirm the list against the schema before it goes in.

### 9. "No IP addresses are logged": scope it to what X2F controls. S4 x L2 = 8 YELLOW

- **Current:** "No IP addresses are logged, even in disputes." and the key point "No IP addresses are logged."
- **Proposed:** "X2F's servers do not log IP addresses, even in disputes."
- **Why:** The API keeps none (`apps/api/src/auth/nameCheck.ts:15`, `apps/api/src/bans.ts:9`). The hosting provider, any CDN or proxy, and the Monero and XMPP networks are outside the app code. Before launch, someone should confirm the hosting setup does not log either. If it does, this sentence (and section 7's "That is exactly why we don't log IP addresses") must change.

### 10. "Writ" and "warrant": one word (section 7, note #107). S2 x L3 = 6 YELLOW

- **Current:** "If police or a government agency sends us a lawful request for data backed by a warrant, we will provide what little information we hold within the scope of the writ."
- **Proposed:** "... backed by a warrant or court order, we will provide what little information we hold within the scope of that warrant or order."
- **Why:** A writ and a warrant are different legal instruments, and using both in one sentence invites the question of which one applies. Requests can also come as court orders or production orders, not only warrants. A lawyer should also say whether X2F tells the user about a request when the law allows it, and how that fits the warrant canary question (lawyer-questions.md #1). The "[Lawyer to word this.]" marker stays.

### 11. Closing accounts "without always giving a reason" (section 8). S3 x L3 = 9 YELLOW

- **Current:** "X2F may pause or close any account at its own discretion, without warning and without always giving a reason."
- **Proposed:** No wording yet. Your own words were "without reason", and that question (p11-222) is still open with you. The lawyer should look at whichever version you pick.
- **Why:** In many places (for example the EU and the UK), a consumer contract term that lets the business end the service at will, with no reason, can be judged unfair and not binding. Wording such as "if we believe an account breaks these Terms or puts users or X2F at risk" is usually easier to defend. The sentence that coins in escrow are settled under the dispute rules already helps.

### 12. Section 9 is called "Liability, changes and law", but it has no liability limit and no law clause. S4 x L3 = 12 ORANGE

- **Current:** "X2F is provided as it is. Trading carries risk ... only trade what you can afford to lose." (There is no limitation of liability, governing law, courts, age or eligibility clause.)
- **Proposed:** Keep your words, and ask the lawyer to add (1) who may use X2F (age 18+, and not where the law forbids it), (2) a limitation of liability, (3) which country's law applies and where disputes with X2F itself are heard, and (4) that nothing in the Terms takes away rights the user has by law.
- **Why:** The heading promises "law", and the board's placeholder asked for "eligibility". These clauses are standard, and they are lawyer's text by nature. (4) also makes the "final, binding" wording in proposal 13 safer.

### 13. Who decides appeals, and what "final, binding" means (section 5). S3 x L3 = 9 YELLOW

- **Current:** "... an appeal can be requested, in which a senior moderator will make the final, binding decision, with the same access." and "decisions are final and binding".
- **Proposed:** "... an appeal can be requested within the time shown with the decision, in which a senior moderator or X2F's owner, who had no part in the first decision, will make the final decision on X2F, with the same access."
- **Why:** In the code, both senior moderators and the owner can take appeals (`packages/staff/src/appealReviewers.ts:47-58`, `apps/api/src/disputes/appeals.ts:34`). The window is 48 hours by default (`appealWindowH`, `packages/staff/src/dispute.ts:336`). "Binding" can be read as giving up the right to go to court, which consumer law often does not allow. "Final on X2F" says the same thing for the platform. This is agy's question #5.

### 14. When the fee is charged without a normal completion (section 4). S2 x L2 = 4 GREEN

- **Current:** "We don't get paid unless you both do. ... If a moderator fully reverses a trade, there is no fee."
- **Proposed:** "We don't get paid unless the trade completes. ... If a moderator reverses a trade before the escrow is released, there is no fee."
- **Why:** Two rare cases charge the fee: a moderator's release overturned on appeal, and a "seller sends the XMR" ruling (`packages/staff/src/dispute.ts:301-323`). Low risk, but the sentence is absolute. This is agy's question #6.

### 15. Put the 60-day close in the body, not only in the key points (section 2). S3 x L3 = 9 YELLOW

- **Current:** Only the key point says "an account not signed into for 60 days is closed". The full text does not mention it.
- **Proposed:** Add to section 2: "X2F is built to last, for people who trade regularly, so an account that has not been signed into for 60 days is closed automatically, with no warning. An open trade or dispute pauses the 60 days, and they count from your last login or your last trade's end, whichever is later. A closed account cannot be reopened."
- **Why:** The key points are a summary, and the body is the contract. A rule that closes accounts without warning should be in the body. The code is `apps/api/src/accountInactivity.ts:1-12`: no warning, paused by open trades, counted from the later of login and trade close. Check "cannot be reopened" with the lead.

### 16. Smaller clarity points. S1-2 x L2-3, GREEN to YELLOW

- a. Section 2: "X2F has no way to reset them for you". "Them" now follows "account age and reputation". Proposed: "X2F has no way to reset your login details for you" (16 Nov review Q6).
- b. Section 3: "Read the vendor's terms before you take an offer." In X2F, "vendor" is an account tier, and ads from ordinary traders have terms too. Proposed: "Read the ad poster's terms before you take an offer." (review Q7).
- c. Section 3: "fair endings = happy endings". A symbol in a legal text. Proposed: "fair endings make happy endings".
- d. Section 3, #105: "off-site wallet". Elsewhere the Terms say "your own wallet". Proposed: "the buyer's own (off-site) wallet", so one name is used throughout.
- e. Section 5: "Our moderators are incredibly fair, and we are confident ..." is fine as a statement of intent. A lawyer may prefer "We train our moderators to be fair". Low risk.

## Questions to hand the lawyer as well

- Whether a non-custodial 2-of-3 escrow in which X2F holds one key, plus a 1% fee, makes X2F a VASP, money transmitter or exchange anywhere it operates (see lawyer-questions.md #2). The Terms say "it is not a bank or an exchange", and that statement needs to be true where X2F is registered.
- Whether accepting by a drawn or typed signature is enough for the target countries, and how long the signature must be kept.
- Whether "Prohibited use" (AML/CFT) needs more, given that X2F does no identity checks by design.

## Version bump and re-asking (how v2026-11-23 reaches users)

- `TERMS_TEXT_VERSION` is now `2026-11-23`. When the server's `X2F_TERMS_VERSION` is set to the same value on deploy, every trader (and team member) who accepted 2026-11-14 or earlier is refused with `terms-required` at their next session check (`apps/api/src/auth/sessions.ts:470-474`). The app then shows the Terms again, and trading waits until they accept (as section 9 says).
- **Only traders are re-asked.** That check runs only for `kind === 'trader'` (`sessions.ts:470`). Staff and owner accounts are NOT asked again: staff accept the Terms once at their invite, and the owner never signs them. If staff should re-accept new versions too, that needs a code change.
- Deploy note: the server's `X2F_TERMS_VERSION` and the web build must change together. If they differ, the sign-up's Terms screen shows "Reload" forever (`apps/web/src/screens/setup/Terms.tsx:106`). See `docs/dev-setup.md`.
- The demo sets `X2F_TERMS_VERSION` from `TERMS_TEXT_VERSION` automatically (`tools/demo/demo.ts:176`).
- Any proposal accepted above changes the text again, so it needs another version (for example `2026-11-2x`) and another round of re-acceptance. It is better to accept or reject them all in one go.
