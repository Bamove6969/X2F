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
export const TERMS_TEXT_VERSION = '2026-10-17';

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
  'Dispute records are kept for 30 days.',
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
      'You pick a public username and a private login name. Keep your login method and any backup safe. X2F has no way to reset them for you, so if you lose them you may lose the account and its reputation. Your coins stay safe in your own wallet either way.',
      'One person, one account. Do not sell, share or lend your account.',
    ],
  },
  {
    heading: '3. Trades and escrow',
    paragraphs: [
      'Your coins stay in your own wallet, except while they are locked in a trade’s 2-of-3 escrow. X2F holds one of the three escrow keys and can never move coins on its own.',
      'You decide whom you trade with and on what terms. Read the other trader’s terms before you take an offer.',
      // not-a-refusal: Terms text
      'Only the seller funds the escrow, and funding it is a commitment to the trade. The buyer pays the fiat exactly as the trade says and marks it paid. The seller confirms the payment and releases the XMR. A release cannot be undone.',
      'Never release coins before you have checked that the money has arrived in your own account. A screenshot is not a payment.',
      'Each trade has timers. When a timer runs out, the trade moves on as the trade screen explains, for example a refund to the seller when the buyer does not pay in time.',
    ],
  },
  {
    heading: '4. Fees',
    paragraphs: [
      'You pay X2F 1% of each completed trade from your own ads. Taking an offer is free.',
      'Monero network fees are paid as the trade screen shows. X2F does not set them.',
    ],
  },
  {
    heading: '5. Disputes and moderators',
    paragraphs: [
      'If something goes wrong, either side can open a dispute within the times the trade screen shows. A moderator then reads the trade and its chat, asks for evidence and decides where the escrow goes.',
      'Chats are encrypted. If a dispute is opened, a moderator can read that trade’s conversation, and every read is logged.',
      'You can appeal a decision once, within the window shown with the decision.',
    ],
  },
  {
    heading: PRIVACY_HEADING,
    paragraphs: [
      'X2F keeps only what a trade needs, and deletes it after a set time. X2F does not track you, does not use analytics and removes location and device details from uploads.',
      'No IP addresses are logged, even in disputes. Dispute records are kept for 30 days after the dispute closes, then deleted.',
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
      'Do not use X2F for money from crime, to hide where money came from, or to break the law where you live.',
      'Do not cheat, threaten or mislead other traders, and do not ask them to trade outside X2F.',
      'Do not try to break, overload or get around X2F’s security.',
      'X2F may pause or close an account that breaks these rules. Coins in escrow are then settled by a moderator under the dispute rules.',
    ],
  },
  {
    heading: '9. Liability, changes and law',
    paragraphs: [
      'X2F is provided as it is. Trading carries risk, including the risk that the other trader acts in bad faith and that the price of Monero changes. Take care, and only trade what you can afford to lose.',
      'When these Terms change, X2F shows them again at your next login, and trading waits until you accept the new version.',
    ],
  },
];
