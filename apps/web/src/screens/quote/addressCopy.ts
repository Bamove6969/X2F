// Owner demo note #6 (16 Nov 2026; docs/trade-wallet-note6.md) and his answers of 17 Nov: the words above the wallet list on
// the quote (the screen where the amount is entered), and on the new-address sheet. Owner, 26 Nov
// 2026: no passwords and no waits, so a new address works as soon as it is confirmed. Owner, 27 Nov
// 2026: no security rating any more (every trader account holds two kinds of login method, one a
// key), so every account owner may add a new address right on the quote; only a team member, who
// never adds wallets (`wallets-manage` is the lead's), is pointed to Settings.
//
// COPY-UNSIGNED: every string in this file (owner note #6 asks for the message; the owner signs the
// final words, docs/trade-wallet-note6.md Q8).

export { DEFAULT_TAG } from '../walletsCopy.js';

/** The owner's question, in each quote's own terms. COPY-UNSIGNED */
export const PAYOUT_QUESTION = {
  /** BuyQuote: the buyer's XMR is paid out to this address. */
  buy: 'If you buy with X2F, which wallet address should the XMR be sent to?',
  /** SellQuote: the seller funds from this wallet, and a refund goes back to it. */
  sell: 'If this trade is cancelled, which wallet address should your XMR go back to?',
} as const;

/**
 * The smaller text under the question: `canAddHere` is true for the account's own owner (the quote
 * offers the new-address sheet), false for a team member. COPY-UNSIGNED
 */
export function addressRuleText(canAddHere: boolean): string {
  if (canAddHere) {
    return 'Pick a saved address, or add a new one right here for the trade you are starting. A new address can be for this trade only or saved for future trades.'; // COPY-UNSIGNED
  }
  return 'Pick a saved address. New addresses are added in Settings, under Your wallets.'; // COPY-UNSIGNED
}

/** The new-address sheet (the account's owner, never a team member). COPY-UNSIGNED */
export const NEW_ADDRESS = {
  open: 'Add a new address',
  title: 'Add a new address',
  name: 'Name',
  nameHint: 'A name you will remember it by, like Savings. X2F stores this name, so keep it neutral.',
  address: 'Monero address',
  keepLegend: 'Use it for',
  oneTime: 'This trade only',
  // Review 17 Nov M3: the restore runs only for a cancel in setup (owner Q10; extending it is OQ2). COPY-UNSIGNED
  oneTimeNote: 'It is not listed again once this trade uses it. It comes back only if the trade is cancelled while it is still being set up.',
  saved: 'Future trades too',
  savedNote: 'It stays in Your wallets.',
  save: 'Save address',
  /** A saved address the API reports as not usable yet: when it starts working. */
  waits: (when: string) => `Saved. This address starts working from ${when}, so pick a saved address for this trade.`,
  /** The API answered with an address other than the one typed: nothing is picked. */
  mismatch: 'X2F answered with a different address from the one you typed, so it was not picked for this trade. Check Your wallets in Settings before you trade.',
} as const;

/** The name a new address gets when the person leaves it empty. COPY-UNSIGNED */
export const DEFAULT_NEW_NAME = 'Trade address';
