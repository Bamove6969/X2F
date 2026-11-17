// Owner demo note #6 (16 Nov 2026; docs/trade-wallet-note6.md) and his answers of 17 Nov: the words above the wallet list on
// the quote (the screen where the amount is entered), and on the new-address sheet. The account's
// rating comes from the API alone (GET /v1/account/me `securityRating`, apps/api/src/auth/rating.ts);
// the screen only chooses which words to show and whether to offer the inline add. The API decides
// whether a new address works at once, waits 24 hours or is staged.
//
// COPY-UNSIGNED: every string in this file (owner note #6 asks for the message; the owner signs the
// final words, docs/trade-wallet-note6.md Q8).

import type { SecurityRating } from '@x2f/auth-client';
export { DEFAULT_TAG } from '../walletsCopy.js';

/** The owner's question, in each quote's own terms. COPY-UNSIGNED */
export const PAYOUT_QUESTION = {
  /** BuyQuote: the buyer's XMR is paid out to this address. */
  buy: 'If you buy with X2F, which wallet address should the XMR be sent to?',
  /** SellQuote: the seller funds from this wallet, and a refund goes back to it. */
  sell: 'If this trade is cancelled, which wallet address should your XMR go back to?',
} as const;

/**
 * The smaller text under the question, by the account's rating (three levels, owner 17 Nov 2026).
 * `null` (an older API build, or the rating not known yet) gives the general rule, with no inline add
 * and no tip. COPY-UNSIGNED
 */
export function addressRuleText(rating: SecurityRating | null): string {
  if (rating === 'high') {
    return 'Your account is rated highly secure. Pick a saved address, or add a new one right here for the trade you are starting. A new address can be for this trade only or saved for future trades.';
  }
  if (rating === 'medium') {
    return 'Your account is rated medium: a password with an authenticator app. Pick a saved address. New addresses are added in Settings, under Your wallets, and start working 24 hours after you add them.';
  }
  if (rating === 'weak') {
    return 'Your account is rated weak: it logs in with a password and no other method. Pick a saved address. New addresses are added in Settings, under Your wallets, and start working 24 hours after you add them.';
  }
  return 'To use a different XMR address for each trade: a highly secure account picks a saved address or adds a new one for the trade it is starting. Any other account adds new addresses in Settings, where they start working 24 hours after they are added.';
}

/**
 * The "?" tip for weak and medium accounts (owner, 17 Nov 2026: "some sort of a ? Mark or just
 * something that they can click on ... for more info"). Written from his words without refusal
 * wording. COPY-UNSIGNED
 */
export const ADDRESS_TIP = {
  /** The button's accessible name (its visible text is "?"). */
  label: 'Why is there no option to add a new address here?',
  body: (rating: 'weak' | 'medium') =>
    `Adding a new address while you start a trade depends on your account's security rating, and yours is rated ${rating}. You have two options:`,
  settings: 'Add the new address in Settings, under Your wallets, and wait 24 hours for it to become active.',
  settingsLink: 'Go to Your wallets',
  stronger: 'Or raise the security of your account with a passkey, a security key or a PGP key. Then there is no wait, and you can add new addresses right when you start a trade.',
  strongerLink: 'Add a login method',
} as const;

/** The new-address sheet (highly secure accounts only). COPY-UNSIGNED */
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
