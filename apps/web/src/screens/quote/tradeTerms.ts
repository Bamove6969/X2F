// "What applies to you" (build spec j31a section 1, owner T-034 / T-080, 9 Nov 2026; boards
// BuyQuote, SellQuote(+Wide), OfferAd(+Wide) on wip/design-brief, whose WA_DATA is byte-identical
// on all five). One list per reader: a role sees only its own lines. The X2F fee lines are in the
// two poster lists only; the several-trades courtesy line is in the two taker lists only; the nudge
// line is in all four, under Your options. Information only, no agree step.
//
// Every line below is the board's, word for word. COPY-UNSIGNED (the owner signs it on the wording
// pages).
//
// The board's "[lead writes the wording]" line (the first-weeks privacy-tool check, p9-8 / Q47,
// P-012/P-013) is BLUR_CHECK_LINE: page 11's recommended wording, not answered yet (COPY-UNSIGNED),
// after the "privacy tool hides..." line in the four lists.

import { proofUploadOn } from '../../proof/flag.js';

/** Who is reading: a taker on a sell ad is `buyer-taker`, on a buy ad `seller-taker`; posters look at a trade on their own ad. */
export type TermsRole = 'seller-taker' | 'buyer-taker' | 'poster-selling' | 'poster-buying';

export interface TermsGroup {
  title: 'Your responsibilities' | 'What affects you' | 'Your options';
  lines: readonly string[];
}

/** The subtitle under "What applies to you". COPY-UNSIGNED */
export const TERMS_SUBTITLE: Record<TermsRole, string> = {
  'seller-taker': "You're selling to a buy ad · information only",
  'buyer-taker': "You're buying from a sell ad · information only",
  'poster-selling': 'A trade on your sell ad · information only',
  'poster-buying': 'A trade on your buy ad · information only',
};

// not-a-refusal: the nudge is encouraged (owner p6-1); "at most once every" is its pace, not a rule that stops anyone.
const nudge = (who: 'Buyer' | 'Seller') => `${who} gone quiet? Nudge them: it often brings them back and saves starting over. Optional, at most once every 15 minutes.`;
// not-a-refusal: how long a moderator takes, not a rule.
const MODERATOR_TIME = 'In a dispute, a moderator steps in within 24 hours at most.';
const COURTESY = "Opened trades with several people to see who answers first? Close the others once you've picked one, so they aren't left waiting.";
const PAYMENT_DETAILS = "Send your payment details from the card in the trade chat: it asks for that method's fields and posts them as one message.";
const PICK_TYPE = 'Pick the currency, then the payment type, on the ad.';
const GIFT_CHECK = 'Gift card: check it within 45 minutes of getting its details.';
const GIFT_SEND = 'Gift card: bought in the last 30 days, full written value, and a video of you logging into it before you send.';
const PAY_NOW = 'Pay only when "Pay now" shows; it never shows before the escrow is secured.';
const TAP_PAID = 'Tap "I\'ve paid" once the money is sent.';
const OWN_NAME = 'We recommend paying from an account in your own name: it lowers the chance of the payment being frozen. We protect your identity either way.';
const POST_PROOF = 'Post proof with the trade code, amount and time visible.';
const ANSWER_60 = 'Answer a trade request within 60 minutes, or it closes.';
const NO_FEE_REVERSAL = 'No fee on a full reversal; during an appeal the fee waits for the outcome.';
const MAINTENANCE = 'Maintenance pauses the trade timers.';
const ON_HOLD = 'On hold, you can both still enter, chat and reach a moderator; no coins move until a moderator decides.';
const RULING = 'A ruling moves the coins at once; a lien covers a reversal.';
const FEEDBACK = 'Feedback and your totals follow the final outcome.';
/** COPY-UNSIGNED: page 11's first option for the blur-check line (P-012/P-013); the owner has not answered yet. */
export const BLUR_CHECK_LINE = 'For the first weeks we ask after every proof whether our privacy tool hid the right details. It takes one tap.';
const TAIL = [MAINTENANCE, ON_HOLD, MODERATOR_TIME, RULING, FEEDBACK] as const;

/** What the seller (either role) is told about the buyer's side. */
const SELLER_AFFECTS = [
  'The buyer only sees "Pay now" once your escrow is secured.',
  'The buyer can cancel until they tap "I\'ve paid"; your XMR comes back.',
  'After "I\'ve paid", the buyer waits for the payment method\'s transfer time before a dispute (Zelle: 90 min). It\'s shown where the method is picked.',
  'Once the buyer taps "I\'ve paid", neither of you can cancel.',
  'After the time to pay, the buyer can still pay until you cancel. If they paid and you cancel, they can dispute at once.',
  'Before the XMR is released, a pop-up asks you to confirm the payment arrived. You can turn it off.',
  'Proofs show the trade code, amount and time; our privacy tool hides names and account numbers.',
  BLUR_CHECK_LINE,
  "You're warned if a proof has no readable date.",
  ...TAIL,
] as const;

/** What the buyer (either role) is told, after the lines only a taker gets. */
const BUYER_AFFECTS = [
  'Our privacy tool hides names and account numbers in your proof; the trade code, amount and time stay visible.',
  BLUR_CHECK_LINE,
  "If our privacy tool hides the trade code, or there's no readable date, you're warned and can still post.",
  'Once you tap "I\'ve paid", neither of you can cancel.',
  'After the time to pay, the trade stays open until the seller cancels: you can still message and pay. If you paid and they cancel, you can dispute at once.',
  'Before "I\'ve paid" goes through, a pop-up asks you to confirm. You can turn it off.',
  ...TAIL,
] as const;

const SELLER_OPTIONS = [
  'Before you fund: cancel at once.',
  'If the time to pay expires with no "I\'ve paid", the trade is still open. You can cancel for a full refund (it starts right away and is done at 10 confirmations), wait for them to reply, or nudge them every 15 min.',
] as const;

const BUYER_OPTIONS = [
  'Cancel until you tap "I\'ve paid"; you\'re warned first that it\'s likely final.',
  'After "I\'ve paid", only a dispute, after the payment method\'s transfer time (Zelle: 90 min, shown where you pick the method).',
  "Post proof even if the amount isn't detected; X2F logs it to improve.",
] as const;

/** The four lists, in the board's order. */
export const TRADE_TERMS: Record<TermsRole, readonly TermsGroup[]> = {
  'seller-taker': [
    { title: 'Your responsibilities', lines: ['Fund the escrow in full.', PAYMENT_DETAILS, PICK_TYPE, GIFT_CHECK] },
    { title: 'What affects you', lines: SELLER_AFFECTS },
    { title: 'Your options', lines: [COURTESY, nudge('Buyer'), ...SELLER_OPTIONS] },
  ],
  'buyer-taker': [
    { title: 'Your responsibilities', lines: [PAY_NOW, PICK_TYPE, 'Follow the payment instructions for the type you picked.', TAP_PAID, OWN_NAME, POST_PROOF, GIFT_SEND] },
    { title: 'What affects you', lines: ["Amounts can be shown with or without the vendor's markup.", 'The ad may need 5, 10, 25 or 50 completed trades from you.', ...BUYER_AFFECTS] },
    { title: 'Your options', lines: [COURTESY, nudge('Seller'), ...BUYER_OPTIONS] },
  ],
  'poster-selling': [
    { title: 'Your responsibilities', lines: [ANSWER_60, 'Fund the escrow in full.', PAYMENT_DETAILS, GIFT_CHECK] },
    { title: 'What affects you', lines: ['You escrow the trade plus 1% (the X2F fee); the buyer gets the full amount.', NO_FEE_REVERSAL, ...SELLER_AFFECTS] },
    { title: 'Your options', lines: [nudge('Buyer'), ...SELLER_OPTIONS] },
  ],
  'poster-buying': [
    { title: 'Your responsibilities', lines: [ANSWER_60, PAY_NOW, TAP_PAID, OWN_NAME, POST_PROOF, GIFT_SEND] },
    { title: 'What affects you', lines: ['You receive the XMR less 1% (the X2F fee) and the network fee for your payout.', NO_FEE_REVERSAL, ...BUYER_AFFECTS] },
    { title: 'Your options', lines: [nudge('Seller'), ...BUYER_OPTIONS] },
  ],
};

/** A line cut into text and numbers; the board sets each number in the mono face (split on /\d+(?:[.,]\d+)*%?/). */
export function termsParts(line: string): { text: string; mono: boolean }[] {
  return line
    .split(/(\d+(?:[.,]\d+)*%?)/)
    .filter((t) => t !== '')
    .map((text) => ({ text, mono: /^\d/.test(text) }));
}

/**
 * What the quote screen shows (review of the proof stack, S-M2, lead 12 Nov): TRADE_TERMS without
 * BLUR_CHECK_LINE unless the build has the proof upload. The line promises an ask (BlurCheck) that is
 * not mounted yet, in words not signed yet (page 11), so it waits behind the same flag.
 */
export function termsFor(role: TermsRole): readonly TermsGroup[] {
  if (proofUploadOn()) return TRADE_TERMS[role];
  return TRADE_TERMS[role].map((g) => ({ ...g, lines: g.lines.filter((l) => l !== BLUR_CHECK_LINE) }));
}

