/**
 * The Terms of Service text shown in the Terms screen's scroll box. The final text waits for the
 * lawyer (plan Task 28, Revision 2026-10-15 "Terms board"); this draft states the product's own
 * rules from the spec so the screen can be built and tested. The server only knows the version
 * (`GET /v1/terms`); whoever publishes new Terms changes this text and the server's version together.
 */
export interface TermsSection {
  heading: string;
  paragraphs: string[];
}

export const TERMS_DRAFT_NOTE = 'Draft for review. The final Terms of Service replace this text before launch.';

export const TERMS: TermsSection[] = [
  {
    heading: '1. What X2F is',
    paragraphs: [
      'X2F is a place where people trade Monero (XMR) for cash, bank transfers and payment apps with each other. X2F is a facilitator. It is not a party to your trades, it is not a bank or an exchange, and it never holds your coins.',
      'Your coins stay in your own wallet, except while they are locked in a trade’s 2-of-3 escrow. X2F holds one of the three escrow keys and can never move coins on its own.',
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
    heading: '3. Trading',
    paragraphs: [
      'You decide whom you trade with and on what terms. Read the other trader’s terms before you take an offer.',
      'Only the seller funds the escrow. The buyer pays the fiat exactly as the trade says and marks it paid. The seller confirms the payment and releases the XMR.',
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
    heading: '5. Disputes',
    paragraphs: [
      'If something goes wrong, either side can open a dispute within the times the trade screen shows. A moderator then reads the trade and its chat, asks for evidence and decides where the escrow goes.',
      'Chats are encrypted. If a dispute is opened, a moderator can read that trade’s conversation.',
      'You can appeal a decision once, within the window shown with the decision.',
    ],
  },
  {
    heading: '6. What you must not do',
    paragraphs: [
      'Do not use X2F for money from crime, to hide where money came from, or to break the law where you live.',
      'Do not cheat, threaten or mislead other traders, and do not ask them to trade outside X2F.',
      'Do not try to break, overload or get around X2F’s security.',
      'X2F may pause or close an account that breaks these rules. Coins in escrow are then settled by a moderator under the dispute rules.',
    ],
  },
  {
    heading: '7. Privacy',
    paragraphs: [
      'X2F keeps only what a trade needs, and deletes it after a set time. X2F does not track you, does not use analytics and removes location and device details from uploads.',
    ],
  },
  {
    heading: '8. Changes to these Terms',
    paragraphs: [
      'When these Terms change, X2F shows them again at your next login, and trading waits until you accept the new version.',
    ],
  },
  {
    heading: '9. No guarantee',
    paragraphs: [
      'X2F is provided as it is. Trading carries risk, including the risk that the other trader acts in bad faith and that the price of Monero changes. Take care, and only trade what you can afford to lose.',
    ],
  },
];
