// Owner demo note #6 (16 Nov 2026; docs/trade-wallet-note6.md): the words above the wallet list on
// the quote (the screen where the amount is entered), and on the new-address sheet. The account's
// rating comes from the API alone (GET /v1/account/me `securityRating`, apps/api/src/auth/rating.ts);
// the screen only chooses which words to show and whether to offer the inline add. The API decides
// whether a new address works at once, waits 24 hours or is staged.
//
// COPY-UNSIGNED: every string in this file (owner note #6 asks for the message; the owner signs the
// final words, docs/trade-wallet-note6.md Q8).

import type { SecurityRating } from '@x2f/auth-client';

/** The owner's question, in each quote's own terms. COPY-UNSIGNED */
export const PAYOUT_QUESTION = {
  /** BuyQuote: the buyer's XMR is paid out to this address. */
  buy: 'If you buy with X2F, which wallet address should the XMR be sent to?',
  /** SellQuote: the seller funds from this wallet, and a refund goes back to it. */
  sell: 'If this trade is cancelled, which wallet address should your XMR go back to?',
} as const;

/**
 * The smaller text under the question, by the account's rating. `null` (an older API build, or the
 * rating not known yet) gives the general rule, with no inline add. COPY-UNSIGNED
 */
export function addressRuleText(rating: SecurityRating | null): string {
  if (rating === 'secure') {
    return 'Your account is rated secure. Pick a saved address, or add a new one right here for the trade you are starting. A new address can be for this trade only or saved for future trades.';
  }
  if (rating === 'weak') {
    return 'Your account is rated weak: it logs in with a password and no other method. Pick a saved address. New addresses are added in Settings, under Your wallets, and start working 24 hours after you add them. Add a passkey, security key, PGP key or authenticator app to rate your account secure.';
  }
  return 'To use a different XMR address for each trade: a secure account picks a saved address or adds a new one for the trade it is starting. Any other account adds new addresses in Settings, where they start working 24 hours after they are added.';
}

/** The new-address sheet (secure accounts only). COPY-UNSIGNED */
export const NEW_ADDRESS = {
  open: 'Add a new address',
  title: 'Add a new address',
  name: 'Name',
  nameHint: 'A name you will remember it by, like Savings. X2F stores this name, so keep it neutral.',
  address: 'Monero address',
  keepLegend: 'Use it for',
  oneTime: 'This trade only',
  oneTimeNote: 'It is not listed again once this trade uses it.',
  saved: 'Future trades too',
  savedNote: 'It stays in Your wallets.',
  save: 'Save address',
  /** A saved address that waits (confirmed with a password): when it starts working. */
  waits: (when: string) => `Saved. This address starts working from ${when}, so pick a saved address for this trade.`,
} as const;

/** The name a new address gets when the person leaves it empty. COPY-UNSIGNED */
export const DEFAULT_NEW_NAME = 'Trade address';
