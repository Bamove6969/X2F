/**
 * The Terms of Service text shown in the Terms screen's scroll box, under the SetupTerms board's
 * headings. The final text waits for the lawyer (plan Task 28, Revision 2026-10-15 "Terms board").
 * Where the board has a "[TERMS TEXT: …]" placeholder, this draft states the product's own rules
 * from the spec instead (KNOWN_EXCEPTIONS.SetupTerms in e2e/parity.ts), so the screen says
 * something true; the board's own sentences (the key points, section 7) are kept word for word.
 * The server only knows the version (`GET /v1/terms`); whoever publishes new Terms changes this
 * text and the server's version together.
 */
/**
 * The version of the text below (review fix round M4). The server's `X2F_TERMS_VERSION` must be
 * this value: when `GET /v1/terms` names another one, this bundle is out of date (an old tab, or a
 * deploy that changed one without the other), and the Terms screen refuses to take an "I accept"
 * for a version whose text it does not show. Change both together.
 */
// 2026-11-12: the owner's 16 /setup comments applied (comms terms-draft-2026-11-12.md). COPY-UNSIGNED.
export const TERMS_TEXT_VERSION = '2026-11-12';

export interface TermsSection {
  heading: string;
  paragraphs: string[];
}

/** The board's note above the text, until the lawyer's text replaces the draft. */
export const TERMS_DRAFT_NOTE = "[Placeholder: the final text comes from X2F's lawyer.]";

/** The board's key points, shown above the full text. */
export const KEY_POINTS: readonly string[] = [
  'X2F never holds your coins.',
  'If you post an ad, you pay a 1% fee when the trade completes.',
  'Moderators can read your trade chat only if a dispute is opened.',
  // Design 9 Nov (p11-9, canvas v161; owner 8 Nov 30/90 ruling): two lines in place of
  // "Dispute records are kept for 30 days." COPY-UNSIGNED.
  'Completed trades are erased on day 30.',
  'Disputed trades are kept up to 90 days, cleaned by our privacy tool, to train our moderators.',
  'No IP addresses are logged.',
  'We answer lawful warrants with the little we have.',
  // S-043 (owner p4-6, build spec j33a section 1, 9 Nov): the 60-day rule, last, saying why. COPY-UNSIGNED
  'X2F is built to last, for people who trade regularly, so an account not signed into for 60 days is closed.',
];

/** The heading of the section the tick box's "Privacy Policy" points at. */
export const PRIVACY_HEADING = '6. Privacy and data';

export const TERMS: TermsSection[] = [
  {
    heading: '1. What X2F is',
    paragraphs: [
      'X2F is a place where people trade Monero (XMR) for cash, bank transfers and payment apps with each other. X2F is a facilitator. It is not a party to your trades, it is not a bank or an exchange, and it never holds your coins.',
    ],
  },
  {
    heading: '2. Your account',
    paragraphs: [
      'You need an account to trade or post an ad. X2F never asks for an email address or a phone number.',
      // COPY-UNSIGNED: owner's /setup comment 9fe3fa43 (12 Nov, "Public display name"); the names
      // the setup screens use (username private, display name public). Terms draft 2026-11-12 item 1.
      'You pick a private username, which you type to log in and only you see, and a public display name, which is how other traders see you. Keep your login method and any backup safe. X2F has no way to reset them for you, so if you lose them you may lose the account and its reputation. Your coins stay safe in your own wallet either way.',
      // COPY-UNSIGNED: owner's comment 4e04a245 (team members are allowed). Draft item 2.
      'One person, one account. If you want others to help you trade, set them up as team members of your account: each team member gets their own login. Do not sell, share or lend your account or your own login.',
    ],
  },
  {
    heading: '3. Trades and escrow',
    paragraphs: [
      // COPY-UNSIGNED: the last sentence answers the owner's comment e79231ba (lead call, draft Q-1).
      'Your coins stay in your own wallet, except while they are locked in a trade’s 2-of-3 escrow. X2F holds one of the three escrow keys and can never move coins on its own. Escrow payments are ordinary Monero transactions, so amounts and addresses stay hidden on the blockchain.',
      'You decide whom you trade with and on what terms. Read the other trader’s terms before you take an offer.',
      // COPY-UNSIGNED: owner's comment ca2b6a83 ("disrupted" read as "disputed"; draft item 4, Q-3).
      // not-a-refusal: Terms text
      'Only the seller funds the escrow, and funding it is a commitment to the trade. The buyer pays exactly as the trade says, with the payment method that was requested, posts proof of payment and marks the trade paid once the payment is complete. The seller confirms that the payment has arrived through that payment method and releases the XMR, which goes straight to the buyer’s own wallet. A release cannot be undone, but it can be disputed.',
      // COPY-UNSIGNED: owner's comment aaf06c2f. Draft item 5.
      'A screenshot counts as proof, but it is not a guarantee: anything can be edited these days. Always check that the payment has arrived in your own account before you release the escrow.',
      // COPY-UNSIGNED: owner's comment 7a830826; the 2 hours is his example, not a set time (p11-29
      // research pending); the refund starts at once (10 confirmations); the late-buyer sentence is
      // p11-18 (lead call, draft Q-5 to Q-7).
      'Each trade has timers, and they are based on the payment method chosen. For example, if a payment method is usually instant but can take up to 2 hours, the buyer gets 2 hours to mark the trade paid through that payment method. If that time is up and the buyer has not marked the trade paid, the seller can cancel the trade, and the refund of all the escrowed XMR to the seller’s wallet starts at once. If you paid late and the seller cancels, open a dispute and we will help you get your money back. The trade screen always shows the time left.',
    ],
  },
  {
    heading: '4. Fees',
    paragraphs: [
      // COPY-UNSIGNED: owner's comment 10475770; the poster pays 1% (p10-1), taking is free, no fee on
      // a full reversal (g63). Draft item 7.
      'X2F collects a fee of 1% of the total amount traded, paid in XMR when the trade completes. Whoever posts the ad pays it. If you post an ad to sell XMR, you pay 1% of the XMR you sell. If you post an ad to buy XMR, you pay 1% of the XMR you buy. Taking someone else’s ad is free. If a moderator fully reverses a trade, there is no fee. Very simple.',
      'Monero network fees are paid as the trade screen shows. X2F does not set them.',
    ],
  },
  {
    heading: '5. Disputes and moderators',
    paragraphs: [
      // COPY-UNSIGNED: owner's comment d1c8cb70; how long after completion is the owner's (draft Q-8).
      'If something doesn’t go as planned, or you and the other trader disagree and don’t manage to sort it out yourselves, either of you can open a dispute, both during the trade and for a short time after it completes. The trade screen shows how long you have. A moderator then reads the trade and its chat, asks for evidence and decides the outcome.',
      // COPY-UNSIGNED: owner's comment 9cdeeb48; appeal access is p11-2 (lead call, draft Q-9).
      'Chats are encrypted. If a dispute is opened, the moderator assigned to it can decrypt the trade’s chat and has full access to the whole conversation and the record of what happened in the trade. If the decision is appealed, a senior moderator or X2F’s owner can see the same. We log every action our moderators take, so we can audit our own staff and make sure of the best outcome for everyone. A moderator’s goal is to see the trade completed. If that is not possible, the next best outcome is a full reversal of the trade, as if it never happened.',
      // COPY-UNSIGNED: owner's comment 358d1d75 ("speak" read as "appeal"); one appeal, final (D-010),
      // no part in the first decision (R37). Draft item 10.
      'If you are not satisfied with the moderator’s decision, you can appeal it once, within the time shown with the decision. A senior moderator who had no part in the first decision then reviews all the information and makes a final, binding decision.',
    ],
  },
  {
    heading: PRIVACY_HEADING,
    paragraphs: [
      // The owner asked to keep "X2F does not track you ..." (comment d1a46566). COPY-UNSIGNED.
      'X2F keeps only what a trade needs, and deletes it after a set time (below). X2F does not track you, does not use analytics and removes location and device details from uploads.',
      'No IP addresses are logged, even in disputes.',
      // COPY-UNSIGNED: owner's comments d1a46566 and 9a1b5c46 (30/90 days, p11-9, p11-11). "The trade",
      // not his "all data", and the training copy erased at day 90 too: lead's interim wording,
      // waiting on the owner (draft Q-12, Q-13).
      'X2F keeps a completed trade available for review for 30 days after it ends, then erases it for good, chat included. A disputed trade is kept for 90 days after the dispute closes. During that time it is scrubbed of personal and confidential information by our internal privacy tool and used to train our moderators. At the 90-day mark it is erased for good.',
    ],
  },
  {
    heading: '7. Police and government requests',
    paragraphs: [
      // not-a-refusal: Terms text
      "If police or a government sends us a lawful request for data backed by a warrant, we will provide what little information we hold. That is exactly why we don't log IP addresses or ask for your name, phone number or email address: we can't hand over what we never collect. [Lawyer to word this.]",
    ],
  },
  {
    heading: '8. Prohibited use',
    paragraphs: [
      // COPY-UNSIGNED: owner's comment 32b26d90 (AML/CFT). Draft item 13.
      'Do not use X2F for money from crime, to hide where money came from, to break anti-money-laundering or counter-terrorist-financing (AML/CFT) laws, or to break the law where you live. That’s not what X2F was built for.',
      // COPY-UNSIGNED: owner's comment f9de831e. Draft item 14.
      'Do not cheat, threaten or mislead other traders, and never ask them to trade or chat outside X2F. Doing so loses you all the protections X2F offers.',
      'Do not try to break, overload or get around X2F’s security.',
      // COPY-UNSIGNED: owner's comment e5caa606, with "without always giving a reason" and the ban
      // notice's contact route (G39): lead's interim wording, waiting on the owner (draft Q-15).
      'X2F may pause or close any account at its own discretion, without warning and without always giving a reason. If we believe an account is a threat to the site or to our users, we will act to protect them and ourselves. We do not take the security of our users lightly. If you think we got it wrong, you can reach out to a moderator. Coins in escrow are then settled by a moderator under the dispute rules.',
    ],
  },
  {
    heading: '9. Liability, changes and law',
    paragraphs: [
      'X2F is provided as it is. Trading carries risk, including the risk that the other trader acts in bad faith and that the price of Monero changes. Take care, and only trade what you can afford to lose.',
      // COPY-UNSIGNED: owner's comment 4f01cb96; "feedback about the site", so it is not read as trade
      // feedback (draft Q-16). Draft item 16.
      'Remember, X2F is a new platform. We are evolving based on your feedback, and every rule can be reconsidered and changed for the good of the site and our users. We strongly encourage you to send us feedback about the site and help shape X2F. When these Terms change, X2F shows them again at your next login, and trading waits until you accept the new version.',
    ],
  },
];
