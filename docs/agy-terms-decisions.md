> **Status (2026-11-26):** superseded by `docs/terms-legal-review-2026-11-23.md`, which carries all six questions below (its proposals 3, 5, 6, 7, 13 and 14). Kept for the record that review cites. Line numbers refer to Terms v2026-11-14 and are stale; the Terms text on main is newer.

# Owner Decision Page — Six Terms of Service vs. Product Questions (`termsText.ts` `v2026-11-14`)

In `apps/web/src/screens/setup/termsText.ts` (`TERMS_TEXT_VERSION = '2026-11-14'`), six sentences from the 12–13 Nov demo notes describe behaviour that differs from how the X2F code works today.

Per the project rule (*make no product or wording judgment calls on our own*), the current Terms text on the branch keeps your sentences as written (`COPY-UNSIGNED`). Below are the **six questions** in plain language, showing:
1. **What the Terms say today** (`apps/web/src/screens/setup/termsText.ts`)
2. **What the code actually does today** (with exact `file:line` references)
3. **Option A — Change the Terms wording** to match how X2F works today
4. **Option B — Change the product / code** to match the sentence

---

## Summary Table

| # | Topic | Terms Line (`termsText.ts`) | Core Mismatch Between Wording & Code |
|---:|---|---|---|
| **1** | [Who cancels on payment timeout](#1-who-cancels-on-payment-timeout) | Section 3, para 5 (`:100`) | Says *"whoever started the trade"* can cancel and get escrow deposited *"into their account"*. In the app, **only the seller** funds escrow and cancels after the payment timer (`request-refund`), and the XMR goes back to the **seller's external wallet** (X2F holds no account balances). A vendor posts an ad; another trader takes it. |
| **2** | [`"funds recovered"` after release](#2-funds-recovered-after-release) | Section 3, para 3 (`:91`) | Says after release *"it can be disputed and the funds recovered, to the best of our abilities"*. In code, once released on the Monero blockchain, the trade is closed and neither side can open a dispute (`machine.ts:462-504, :202`); the only reversal after coins moved is an appeal overturning a moderator's Round 1 release (`dispute.ts:321-323`), which puts a lien on the account that must pay. |
| **3** | [`"help you get your money back"` when paid late](#3-help-you-get-your-money-back-when-paid-late) | Section 3, para 5, bullet 4 (`:105`) | Says *"open a dispute and we will help you get your money back"*. Usually the seller's cancel refund is co-signed within ~5 seconds before the late buyer opens the dispute (`machine.ts:478-484`), so escrow is already refunded to the seller; the moderator can order the seller to send XMR or return fiat via a **lien** (`intent.ts:12`), but cannot guarantee recovery if the seller abandons their account. |
| **4** | [90 days after completion vs. after dispute closes (and what is purged)](#4-90-days-after-completion-vs-after-the-dispute-closes) | Section 6, para 1 (`:137`) | Says *"the entirety of the trade is purged"* at 30 days and disputed trades are kept *"90 days after completion"* then *"all purged, no exceptions"*. In code: (a) the 90-day clock starts 90 days after the dispute (or trade, if later) closes (`chat.ts:199`); (b) at 30/90 days the **encrypted chat** and **wallet addresses** are purged (`chat/retention.ts:71`, `trades/purge.ts:20`), while the core `trades` row (amounts/status for trade counts & reputation) stays; and (c) no internal privacy tool or training copy exists in code today. |
| **5** | [Appeals by senior moderator vs. senior moderator or owner](#5-appeals-by-senior-moderator-vs-owner) | Section 5, para 2 (`:126`) | Says *"a senior moderator will make the final, binding decision, with the same access"*. In code (`appealReviewers.ts:47-58`, `appeals.ts:30-37`), **both senior moderators and X2F's owner** (anyone not involved in Round 1) can review an appeal and decrypt the disputed trade's chat (the design gives them this access; the chat-reading part is not built yet, `staffRoutes.ts:30-34`). |
| **6** | [`"We don't get paid unless you both do"`](#6-we-dont-get-paid-unless-you-both-do) | Section 4, para 1 (`:115`) | Says *"We don't get paid unless you both do."* On normal completion, the 1% fee is collected on-chain. There are two cases where the fee is charged without simple completion: a Round 1 release overturned on appeal (1% fee was already paid on-chain, `payouts.ts:71-77`), and `seller-sends-xmr` after a refund (fee is owed by the poster under `fees_owed, not built yet`, `dispute.ts:301-303`). `seller-returns-fiat` charges `'none'` (`dispute.ts:311`), matching the Terms. |

---

<a id="1-who-cancels-on-payment-timeout"></a>
## 1. Who Cancels on Payment Timeout

### Current Terms Sentence (`apps/web/src/screens/setup/termsText.ts:100`)
> *"If the allotted time has run out, whoever started the trade can immediately cancel and receive the funds from escrow deposited back into their account."*

### What the Code Does Today
- **Who starts a trade vs. who funds escrow:** A vendor posts an ad to buy or to sell; another trader takes it (`apps/api/src/trades/take.ts`). Regardless of who posted the ad or who started the trade, **only the seller locks XMR into the 2-of-3 escrow** (`apps/web/src/screens/setup/termsText.ts:91`, `packages/trade/src/payouts.ts:60` `sellerFundsAtomic`).
- **Who can cancel when the buyer's payment timer (`payBy`) runs out:** In `packages/trade/src/machine.ts:616-626` (`case 'request-refund'`), **only the seller** (`if (by !== 'seller') return fail('wrong-party')`) can trigger `"Cancel and get refund"` once `payBy` has passed without the buyer tapping `"I've paid"`. (Before `"I've paid"`, the buyer can voluntarily cancel at any time via `buyer-cancel` at `machine.ts:628-633`, which also refunds the escrow to the seller.)
- **Where the refunded XMR goes:** In `packages/trade/src/payouts.ts:81-88`, every cancel or refund sweeps the full escrow balance back to `sellerRefund` — the **seller's own external Monero wallet** (after 10 Monero network confirmations, `packages/trade/src/timers.ts:23` `UNLOCK_CONFIRMATIONS = 10`), never into an X2F "account" balance (Section 1: *"X2F never holds your coins"*).
- Also note: the 4th bullet of the same paragraph (`termsText.ts:105`) says *"If you paid late and the seller cancels..."*, which assumes the seller is the one who cancels on timeout.

### Options for the Owner
- **Option A — Change the Terms wording to match the app (claude3's 16 Nov review, Q3, recommends this.)**
  Replace *"whoever started the trade can immediately cancel and receive the funds from escrow deposited back into their account"* with (`COPY-UNSIGNED`):
  > *"If the allotted time has run out and the buyer has not marked the trade paid, the seller can immediately cancel the trade and have the XMR in escrow refunded back to the seller’s own wallet."*
- **Option B — Change the product so whoever started the trade can cancel after the time runs out.**
  Because only the seller puts XMR into escrow, the escrow would still have to go back to the seller; if you meant something else by *"whoever started the trade"*, say what.

---

<a id="2-funds-recovered-after-release"></a>
## 2. `"funds recovered"` After Release

### Current Terms Sentence (`apps/web/src/screens/setup/termsText.ts:91`)
> *"The seller confirms that the payment has arrived through that payment method and releases the XMR, which goes straight to the buyer’s own wallet. A release cannot be instantly undone, but it can be disputed and the funds recovered, to the best of our abilities, for the slighted party."*

### What the Code Does Today
- **No dispute after release in current code:** Once the seller releases, the trade is closed (`released`) and neither side can open a dispute (`packages/trade/src/machine.ts:462-504, :202`). In `onDispute` (`machine.ts:462-504`), only `securing`, `secured`, `paid`, `settling`, and `refunded` are handled; a `released` trade falls to `default: return fail('wrong-state')` (`machine.ts:502-503`).
- **The only post-settlement reversal in current code:** The only reversal after coins have moved on-chain is an appeal overturning a moderator's Round 1 `release-to-buyer` (`packages/staff/src/dispute.ts:321-323`), which puts a restitution lien on the account that must pay.
- **On-chain finality:** When the seller releases escrow (`packages/trade/src/machine.ts:682-686`, `packages/trade/src/payouts.ts:69-80`), a 2-of-3 Monero transaction sends the XMR directly to the buyer's external wallet address (`buyerPayout`). Neither X2F nor a moderator holds a key to the buyer's personal wallet, and Monero transactions cannot be reversed on-chain.

### Options for the Owner
- **Option A — Change the Terms wording to match the app (`COPY-UNSIGNED`):**
  Clarify that a release is final on the blockchain:
  > *"A Monero release cannot be undone or disputed once sent to the buyer’s wallet; the trade is complete."*
- **Option B — Add a dispute after release to the product:**
  This would require: adding a dispute window after a release, creating a "buyer returns XMR / buyer's payment was reversed" ruling outcome with a lien on the buyer, and undergoing lead and security review because this touches disputes and liens code.

---

<a id="3-help-you-get-your-money-back-when-paid-late"></a>
## 3. `"help you get your money back"` When Paid Late

### Current Terms Sentence (`apps/web/src/screens/setup/termsText.ts:105`)
> *"• If you paid late and the seller cancels, open a dispute and we will help you get your money back. The trade screen always shows the time left."*

### What the Code Does Today
- **Late buyer payment race (`packages/trade/src/machine.ts:478-484, 593-596`):**
  - After the payment timer (`payBy`) expires, the buyer can still tap `"I've paid"` **until** the seller taps `"Cancel and get refund"` (`request-refund`).
  - Once the seller taps `"Cancel and get refund"`, the trade enters `settling` (`auto-refund`), and the moderation service automatically co-signs the seller's refund on its first pass (within ~5 seconds, `apps/moderation/src/autoRefund.ts`).
- **What happens when the late buyer opens a dispute (`machine.ts:478-484`, `packages/staff/src/intent.ts:9-20`):**
  - If the buyer opens the dispute within the 48-hour post-refund dispute window (`TIMERS.disputeAfterRefundHours = 48` in `packages/trade/src/timers.ts:19`, `machine.ts:498`), the XMR has almost always already returned to the seller's external wallet.
  - The moderator reviews the buyer's payment proof and, if the buyer really paid before/as the seller cancelled, rules `seller-returns-fiat` or `seller-sends-xmr` (`packages/staff/src/intent.ts:12`), placing a **lien** on the seller's X2F account until the seller sends the fiat back (or sends the XMR).
  - However, because X2F is non-custodial and holds neither the buyer's fiat nor the seller's refunded XMR, if a dishonest seller walks away from their X2F account permanently, X2F can ban the seller and record the lien, but cannot force their bank or wallet to return the buyer's fiat.

### Options for the Owner
- **Option A — Change the Terms wording slightly so it does not read as a financial guarantee if the seller abandons their account (`COPY-UNSIGNED`):**
  > *"• If you paid late and the seller cancels, open a dispute right away: a moderator will review your proof of payment and require the seller to return your payment or complete the trade before they can use X2F again. The trade screen always shows the time left."*
- **Option B — Keep `"open a dispute and we will help you get your money back"` (`termsText.ts:105`) or change the product:**
  - Keeping the sentence as-is is friendly and says *"help you"* (not *"guarantee"*), provided the lawyer is comfortable with it.
  - If changing the product so the escrow XMR is still held when a buyer paid late: the moderation service (`apps/moderation/src/autoRefund.ts`) would have to wait a grace period (the owner removed the earlier 15-minute delay on 8 Nov, p6-1; how long, if at all, is the owner's call) before co-signing the seller's refund so a late buyer has time to click *"I paid late / Open dispute"* while the XMR is still locked in 2-of-3 escrow.

---

<a id="4-90-days-after-completion-vs-after-the-dispute-closes"></a>
## 4. 90 Days After Completion vs. After the Dispute Closes (and What Is Purged)

### Current Terms Sentence (`apps/web/src/screens/setup/termsText.ts:137`)
> *"X2F only provides access to completed trades for 30 days, after which the entirety of the trade is purged. The only exception to this is if there is a dispute, in which case the dispute is kept for 90 days after completion, after being scrubbed with our internal privacy tool, and used for training moderators. At the 90-day mark it is all purged, no exceptions."*

### What the Code Does Today
There are three differences between this paragraph and the retention code:
1. **When the 90-day clock starts (`packages/trade/src/chat.ts:199`, `apps/api/src/chat/retention.ts:44-63`):**
   - The 90-day retention timer runs from **90 days after the dispute (or the trade, if later) closes** (`packages/trade/src/chat.ts:199`), **not** from trade completion alone. And if a dispute is still open, `purgeChats` (`apps/api/src/chat/retention.ts:126-127`) never deletes it while open.
2. **What is deleted at day 30 and day 90 (`apps/api/src/chat/retention.ts:71-141`, `apps/api/src/trades/purge.ts:5-31`):**
   - **Day 30 (undisputed trade):** `purgeChats` deletes the `chats` row and cascades to all chat identities, attestations, and encrypted messages, and issues a `chat_shred_orders` row. **However**, the `trades` row itself is **not** deleted, and `buyer_payout` / `seller_refund` Monero addresses on `trades` are kept until **day 90** (`TRADE_ADDRESS_RETENTION_MS = 90 * 24 * 3_600_000` in `apps/api/src/trades/purge.ts:5,20-31`).
   - **Day 90:** `purgeTradeAddresses` sets `buyer_payout = null, seller_refund = null` on `trades` closed more than 90 days ago, and `purgeChats` deletes disputed chats. The stripped `trades` row (trade code, buyer/seller account IDs, XMR/fiat amounts, and final state) remains in PostgreSQL to back completed-trade counts and reputation (`apps/api/src/traders/tradedTotal.ts`).
3. **No privacy tool or training copy in code:**
   - There is no internal privacy tool or training copy in the code today.

### Options for the Owner
- **Option A — Change the Terms wording to match the retention code (`COPY-UNSIGNED`):**
  > *"X2F only provides access to completed trades and their chats for 30 days after the trade ends, after which the trade chat and uploads are permanently purged. The only exception is if there is a dispute, in which case the disputed trade chat is kept for 90 days after the dispute (or trade, if later) closes. At the 90-day mark the disputed chat and wallet addresses are purged, leaving only the anonymised trade totals needed for account reputation."*
- **Option B — Change the product / retention code to match the Terms sentence:**
  1. Shorten `TRADE_ADDRESS_RETENTION_MS` in `apps/api/src/trades/purge.ts:5` from **90 days to 30 days** for undisputed trades so wallet addresses are nulled at day 30 alongside the chat; and
  2. Roll completed trade counts/volume into aggregate counters on `accounts` and delete the `trades` row completely at day 30 (undisputed) and day 90 (disputed).

---

<a id="5-appeals-by-senior-moderator-vs-owner"></a>
## 5. Appeals by Senior Moderator vs. Senior Moderator or Owner

### Current Terms Sentence (`apps/web/src/screens/setup/termsText.ts:126`)
> *"If a dispute is opened, the moderator assigned to it can decrypt the trade’s chat and has full access to the whole conversation and the record of what happened in the trade. If either party is not satisfied with the outcome of the dispute, an appeal can be requested, in which a senior moderator will make the final, binding decision, with the same access."*

### What the Code Does Today
- **Who can review and decide an appeal (`packages/staff/src/appealReviewers.ts:47-58`, `apps/api/src/disputes/appeals.ts:30-37`, `apps/api/src/disputes/staffRoutes.ts:30-34, 100, 130-134`):**
  - `appealReviewers` (`packages/staff/src/appealReviewers.ts:55`) and `reviewerCandidates` (`apps/api/src/disputes/appeals.ts:34`, `where m.role in ('senior', 'owner')`) allow **either a senior moderator or X2F's owner** (provided they had no involvement in Round 1, per rule R37 in `appealReviewers.ts:28-39`) to take an appeal and publish the final Round 2 ruling (the design gives them this access; the chat-reading part is not built yet, `staffRoutes.ts:30-34`).
- **Timing and independence:**
  - An appeal must be requested within the appeal window setting, 48 hours by default (`packages/staff/src/dispute.ts:336`).
  - The appeal reviewer must have had no part in the first decision (`packages/staff/src/appealReviewers.ts:28-39`).

### Options for the Owner
- **Option A — Change the Terms wording to disclose that a senior moderator or X2F's owner (uninvolved in Round 1) decides appeals within the window (`COPY-UNSIGNED`):**
  > *"...If either party is not satisfied with the outcome of the dispute, an appeal can be requested within the time shown with the decision, in which a senior moderator (or X2F’s owner) who had no part in the first decision will make the final, binding decision, with the same access."*
- **Option B — Change the product / code so only `senior` moderators (and never `owner`) handle appeals:**
  Keep `termsText.ts:126` saying *"a senior moderator"* only, and change `packages/staff/src/appealReviewers.ts:55` and `apps/api/src/disputes/appeals.ts:34` from `role in ('senior', 'owner')` to `role === 'senior'`.

---

<a id="6-we-dont-get-paid-unless-you-both-do"></a>
## 6. `"We don't get paid unless you both do"`

### Current Terms Sentence (`apps/web/src/screens/setup/termsText.ts:115`)
> *"X2F collects a fee of 1% of the total amount traded, paid in XMR when the trade completes. Whoever posts the ad is responsible for the bill, which will be automatically deducted, pending the completion of the trade. We don’t get paid unless you both do. ... If a moderator fully reverses a trade, there is no fee."*

### What the Code Does Today
- **Normal completion:** When a trade completes normally, the 1% fee output and the buyer's XMR payout are swept together on-chain (`packages/trade/src/payouts.ts:70-80`).
- **Standard reversal:** When a trade finishes by refund, cancellation, or a Round 1 moderator reversal (`dispute-seller`) while XMR is still in escrow (`payouts.ts:81-88`), 100% of escrow returns to `sellerRefund` and **X2F collects 0 fee**. That matches *"If a moderator fully reverses a trade, there is no fee."*
- **Two cases where a fee is charged without simple completion:**
  1. **Round 1 release overturned on appeal (`packages/staff/src/dispute.ts:321-323`):** The Round 1 release already paid the 1% fee on-chain (`packages/trade/src/payouts.ts:71-77`, `dispute-buyer`). When overturned on appeal, `rulingFee()` returns `'poster-pays'`.
  2. **`seller-sends-xmr` after a refund (`packages/staff/src/dispute.ts:310`):** `rulingFee()` returns `'poster-pays'`. Here the fee is owed by the poster under `fees_owed, not built yet` (`dispute.ts:301-303`).
- **`seller-returns-fiat` after a timeout refund:** `rulingFee()` returns `'none'` (`packages/staff/src/dispute.ts:311`), which charges no fee and matches the Terms.

### Options for the Owner
- **Option A — Keep `"We don't get paid unless you both do"` as the general rule and clarify in the reversal sentence (`COPY-UNSIGNED`):**
  > *"...We don’t get paid unless the trade completes. ... If a moderator reverses a trade before the escrow is released, there is no fee."*
- **Option B — Change the product / fee rule (`packages/staff/src/dispute.ts:291-328`) so X2F never charges (or refunds) the 1% fee on any reversed trade:**
  In `packages/staff/src/dispute.ts:321-323`, if a Round 1 `release-to-buyer` is overturned on appeal to `refund-to-seller`, change `rulingFee` from `'poster-pays'` to `'none'` (and have X2F credit/refund the 1% fee that went to `feeWallet` in Round 1).

---

## Appendix: Six Minor Copy Questions from the 16 Nov Review (`review-third-demo-r3-and-terms-r3b-2026-11-16.md`)

For completeness, the remaining copy questions from the 16 Nov review of `termsText.ts` (`v2026-11-14`) are listed for your sign-off:

1. **Section 1, para 1 (`termsText.ts:65`, review Q5):**
   - Your 13 Nov note (`d1156603`) wrote *"for the payment method that suits them"*; merging with the earlier draft produced *"for cash, bank transfers or the payment app that suits them"*.
   - **Question:** Keep *"cash, bank transfers or the payment app that suits them"*, or use your phrase *"cash, bank transfers or whatever payment method suits them"*?
2. **Section 2, para 2 (`termsText.ts:76`, review Q6):**
   - Reads: *"While your wallet and funds may be secure, your account age and reputation are irreplaceable. X2F has no way to reset them for you..."* — because *"them"* now comes right after *"account age and reputation"*, it can read as resetting reputation rather than login details.
   - **Question:** Change *"reset them for you"* to *"reset your login details for you"*?
3. **Section 3, para 2 (`termsText.ts:87`, review Q7):**
   - Reads: *"Read the vendor’s terms before you take an offer."* In X2F, `"vendor"` is a specific account tier (`/settings/account-type`).
   - **Question:** Keep *"the vendor’s terms"*, or say *"the other trader’s terms"* / *"the ad poster’s terms"*?
4. **Section 4, para 1 (`termsText.ts:115`, review Q8):**
   - Your 13 Nov note (`1c176a20`) wrote: *"Responding to someone else’s ad is always free. You are a trader or a vendor."* The branch joined those into: *"Responding to someone else’s ad is always free, whether you are a trader or a vendor."*
   - **Question:** Confirm this combined sentence is what you wanted.
5. **Capitalising `"Terms"` (`Terms.tsx:247`, `TermsStep.tsx:102`, `termsText.ts:167`, review Q11):**
   - In 13 Nov note #21 (`0b68b013`), you asked: *"Should the word terms be capitalized?"* The branch capitalised `"Terms"` wherever it refers to the Terms of Service document itself (and kept lowercase `"terms"` when referring to an offer's trade terms).
   - **Question:** Confirm you are happy with capitalised `"Terms"` for the Terms of Service.
6. **Section 6, para 1 (`termsText.ts:137`, review Q4):**
   - The draft includes: *"X2F keeps only what a trade needs."*
   - **Question:** Confirm whether to keep this sentence.
