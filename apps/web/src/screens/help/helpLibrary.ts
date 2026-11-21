/*
 * The help library (owner, 18 Nov 2026: "a help library of the questions people might ask, with
 * answers"). One data file, so the words are easy to edit: the topics, then every question with its
 * answer.
 *
 * COPY-UNSIGNED: every topic title, intro, question and answer below waits for design and the owner
 * to sign it off. DESIGNER-REVIEW: the grouping and the order.
 *
 * Rules for this file (lead brief, 18 Nov 2026):
 * - Every answer matches the code it was checked against: wip/lead-train-1 ef50b6e0 (which holds
 *   main 8e7e63d5) merged into this branch (review of 18 Nov). Each entry's `sources` lists where
 *   each fact lives, as `path:line` (or `path:first-last`) from the repository root, then a few
 *   words that are on that line. apps/web/test/helpLibrary.test.tsx checks that every entry has one
 *   and that its words are still in that file within 40 lines of the cited line (lead, 20 Nov: so
 *   adding lines to a cited file does not break it). Words that moved further but are in the file
 *   once only warn, naming the line to re-point the note to; words gone from the file fail.
 * - An answer that names a time, a limit or a count lists it in `facts`; the same test rebuilds
 *   each fact's words from the constant in the code and fails when they differ or when an answer
 *   holds a number no fact covers. A number the owner can change in settings (the offer caps, the
 *   device limit, the appeal window) is said with "normally" in front of it (review M4).
 * - Nothing the code does not do is promised. Undecided rules (who should bear the Monero network
 *   fee: the answers say only what payouts.ts does today, liens and their recovery, the
 *   per-payment-method pay windows of owner p11-29, the window to dispute a refund) are left out or
 *   say plainly that the feature is "not in the app yet" (worded so, not "not available", so
 *   copy-lint does not read an explanation as a refusal).
 * - An answer that depends on the proof-upload build flag (VITE_X2F_PROOF_UPLOAD, proof/flag.ts)
 *   has both answers in `proofUpload`; `libraryQuestions` picks one with the same `proofUploadOn`
 *   the trade screens use.
 * - Plain words, 1 to 4 sentences, never "half" about fees.
 */

import { proofUploadOn } from '../../proof/flag.js';

export type HelpTopicId = 'getting-started' | 'trading' | 'escrow' | 'disputes' | 'safety' | 'teams' | 'privacy' | 'fees';

export interface LibraryTopic {
  id: HelpTopicId;
  /** COPY-UNSIGNED */
  title: string;
  /** COPY-UNSIGNED: one line under the topic's heading. */
  intro: string;
}

export interface HelpQuestion {
  /**
   * The question's id, unique, lower case, hyphens. Never renamed once published. Its deep link is
   * /help/<topic>#faq-<id> (`FAQ_ANCHOR_PREFIX`, review m7); the first form, #<id>, still works
   * (HelpLibrary.tsx `OLD_ANCHOR_REDIRECTS`).
   */
  id: string;
  topic: HelpTopicId;
  /** COPY-UNSIGNED */
  q: string;
  /** COPY-UNSIGNED: 1 to 4 sentences. */
  a: string;
  /** Where each fact lives: `path:line[-line] words on that line`. */
  sources: readonly string[];
  /** The timers, limits and counts the answer names, by the keys of the fact table in apps/web/test/helpLibrary.test.ts. */
  facts?: readonly string[];
}

/** One answer with its own sources and facts: one side of a flag-dependent question. */
export type HelpAnswer = Pick<HelpQuestion, 'a' | 'sources' | 'facts'>;

/** A question whose answer follows the proof-upload flag (proof/flag.ts `proofUploadOn`). */
export interface FlaggedQuestion extends Pick<HelpQuestion, 'id' | 'topic' | 'q'> {
  /** COPY-UNSIGNED: `off` for a build without the upload (the default), `on` for one with it. */
  proofUpload: { off: HelpAnswer; on: HelpAnswer };
}

type Entry = HelpQuestion | FlaggedQuestion;

/** The prefix of every question's anchor, so a question id never collides with another id on the page (review m7). */
export const FAQ_ANCHOR_PREFIX = 'faq-';

/** COPY-UNSIGNED: the library's topics, in reading order. */
export const LIBRARY_TOPICS: readonly LibraryTopic[] = [
  { id: 'getting-started', title: 'Getting started', intro: 'Creating an account, logging in and your recovery code.' },
  { id: 'trading', title: 'Buying and selling', intro: 'Offers, taking a trade, paying, cancelling and chat.' },
  { id: 'escrow', title: 'Escrow and Monero', intro: 'How the escrow holds the XMR, your wallets and payouts.' },
  { id: 'disputes', title: 'Disputes and appeals', intro: 'When to call a moderator, rulings and appeals.' },
  { id: 'safety', title: 'Account safety', intro: 'Waiting changes, holds, new devices and scams to watch for.' },
  { id: 'teams', title: 'Teams', intro: 'Vendors, team members and what each can do.' },
  { id: 'privacy', title: 'Privacy', intro: 'What X2F keeps, and for how long.' },
  { id: 'fees', title: 'Fees', intro: 'Who pays the 1% fee, and when.' },
];

const T = 'packages/trade/src';
const M = `${T}/machine.ts`;
const AUTH = 'apps/api/src/auth';
const WEB = 'apps/web/src/screens';
const SPEC = 'docs/public/x2f-crypto-spec.md';

/** COPY-UNSIGNED: every question and answer. */
const ENTRIES: readonly Entry[] = [
  // ---- Getting started ------------------------------------------------------------------------
  {
    id: 'what-is-x2f',
    topic: 'getting-started',
    q: 'What is X2F?',
    a: 'X2F is a marketplace where people trade Monero (XMR) with each other for ordinary money. The seller locks the XMR in an escrow, the buyer pays outside X2F, and the seller then releases the XMR to the buyer.',
    sources: [`${SPEC}:5 the seller locks the XMR`, `${M}:694-697 case 'release-started'`],
  },
  {
    id: 'create-account',
    topic: 'getting-started',
    q: 'How do I create an account?',
    a: 'Agree to the Terms and sign them, then choose a private username and a public display name. Pick a way to log in, save your recovery code, and add the first wallet your XMR is paid to.',
    sources: [`${WEB}/setup/SetupFlow.tsx:5-9 0 Terms`, `${WEB}/setup/Terms.tsx:3-6 the signature pad`],
  },
  {
    id: 'personal-details',
    topic: 'getting-started',
    q: 'Do I need to give my name, email or phone number?',
    a: 'X2F asks for no email or phone number. To agree to the Terms you sign your name, but a scribble or an X is fine, and the signature is stored sealed and never shown. Your display name is shown to other traders, so pick one that does not identify you.',
    sources: [
      `${WEB}/setup/Terms.tsx:250 sign your name`,
      `${WEB}/setup/SignaturePad.tsx:205 A scribble or an X is fine.`,
      'apps/api/src/termsSignature.ts:12 It is never shown to other users',
      'apps/api/src/termsSignature.ts:29 At rest it is sealed',
      `${SPEC}:215 The display name is separate and public`,
    ],
  },
  {
    id: 'username-display-name',
    topic: 'getting-started',
    q: 'What is the difference between my username and my display name?',
    a: 'Your username is private: you use it to log in, and other traders never see it. Your display name is the public name other traders see on offers and trades.',
    sources: [`${WEB}/setup/SetupFlow.tsx:5-6 the private username`, `${SPEC}:215 The display name is separate and public`],
  },
  {
    id: 'login-methods',
    topic: 'getting-started',
    q: 'Which ways can I log in?',
    a: 'With a PGP key, a passkey, a security key or a password. You pick one when you sign up and can add others later in Settings. An authenticator app can be added as a second step after your password, and works only with one, so remove the app before you remove the password. Settings also refuses a removal that would leave a password with no authenticator app and no other way to log in.',
    sources: [
      `${AUTH}/methods.ts:29 PRIMARY`,
      `${WEB}/setup/Login.tsx:99 You can add others later in Settings`,
      `${AUTH}/strength.ts:25 'password', 'totp'`,
      `${AUTH}/totp.ts:176 totp-needs-password`,
      `${AUTH}/methods.ts:426 password-has-totp`,
      `${AUTH}/methods.ts:436 password-alone`,
      'apps/web/src/ui/cantDoCodes.ts:485 A password needs the authenticator app or another way to log in.',
    ],
  },
  {
    id: 'pgp-login',
    topic: 'getting-started',
    q: 'How does logging in with a PGP key work?',
    a: 'You give X2F your public key. Each time you log in, X2F shows a message locked with that key: you unlock it in your PGP app and paste in the code inside. Each code works once, for 5 minutes.',
    sources: [`${WEB}/setup/Login.tsx:31 Each time you log in, X2F shows`, `${AUTH}/pgp.ts:259 PGP_CHALLENGE_TTL_MS`],
    facts: ['pgpCodeMinutes'],
  },
  {
    id: 'pgp-keys-accepted',
    topic: 'getting-started',
    q: 'Which PGP keys does X2F accept?',
    a: 'RSA keys of 4096 bits or more, Ed25519 keys and Ed448 keys. X2F never makes keys for you and never sees your private key.',
    sources: ['packages/accounts/src/pgp.ts:28 MIN_RSA_BITS', 'packages/accounts/src/pgp.ts:158 Ed25519 and Ed448', `${WEB}/setup/Login.tsx:130 X2F never makes keys for`, `${SPEC}:42 users' PGP private keys`],
    facts: ['pgpRsaBits'],
  },
  {
    id: 'passkey-or-security-key',
    topic: 'getting-started',
    q: 'What is the difference between a passkey and a security key?',
    a: 'A passkey logs you in with your face, fingerprint or phone PIN, and Apple or Google keep it synced across your devices. A security key is a small device, like a YubiKey, that you plug in or tap, and it needs its PIN or fingerprint each time. A key with no PIN set is refused until you set one in the key\'s settings.',
    sources: [
      `${WEB}/setup/Login.tsx:37 Log in with your face`,
      `${WEB}/setup/Login.tsx:43 Log in by tapping a YubiKey`,
      `${AUTH}/webauthn.ts:63 Your key needs its PIN (or fingerprint) to log in. Set one in your key's settings`,
    ],
  },
  {
    id: 'password-rules',
    topic: 'getting-started',
    q: 'What does my password need?',
    a: 'At least 10 characters, with upper and lower case letters, a number and a symbol. X2F also checks it against a list of leaked passwords.',
    sources: ['packages/accounts/src/password.ts:7 PASSWORD_MIN', `${WEB}/setup/Login.tsx:50 a number and a symbol`, `${SPEC}:213 leaked-password list`],
    facts: ['passwordMin'],
  },
  {
    id: 'recovery-code',
    topic: 'getting-started',
    q: 'What is the recovery code?',
    a: 'It is your one backup way in if you lose your login method, and you save it while you sign up. Each code works once: after you use it, X2F gives you a new one.',
    sources: [`${AUTH}/recovery.ts:5 ONE 16-character code`, `${AUTH}/recovery.ts:9 used is replaced there by a new one`, `${WEB}/setup/SetupFlow.tsx:8 the recovery codes first, required`],
  },
  {
    id: 'session-length',
    topic: 'getting-started',
    q: 'How long do I stay logged in?',
    a: 'After each login you pick how long the session lasts: 2, 4, 8 or 12 hours on a trader account, or 2, 6, 12 or 24 hours on a vendor account. 5 minutes before it ends, X2F asks whether you want to stay logged in, and you confirm with one of your login methods.',
    sources: ['packages/accounts/src/sessionLength.ts:20 trader: [2, 4, 8, 12]', 'packages/accounts/src/sessionLength.ts:21 vendor: [2, 6, 12, 24]', 'packages/accounts/src/sessionLength.ts:45 SESSION_PROMPT_MS', 'packages/accounts/src/sessionLength.ts:5 confirming with one of the'],
    facts: ['traderSessionHours', 'vendorSessionHours', 'sessionPromptMinutes'],
  },
  {
    id: 'trader-or-vendor',
    topic: 'getting-started',
    q: 'What is the difference between a trader and a vendor account?',
    a: 'Traders take offers that vendors post, and pay no X2F fee. Vendors post offers, can add team members and pay the 1% fee on their completed trades. To become a vendor, the account needs a passkey, security key or PGP key.',
    sources: [`${WEB}/settings/accountTypeCopy.ts:19 You take offers that vendors post`, `${WEB}/settings/accountTypeCopy.ts:20 You pay the 1% fee`, 'apps/api/src/routes/accountType.ts:17 vendor-needs-key'],
    facts: ['feePercent'],
  },
  {
    id: 'vendor-switch-back',
    topic: 'getting-started',
    q: 'Can a vendor account go back to being a trader account?',
    a: 'No. To trade as a trader again, open a new account.',
    sources: ['apps/api/src/accountInactivity.ts:6-7 A vendor', `${WEB}/settings/accountTypeCopy.ts:7-8 there is no`],
  },
  {
    id: 'inactive-close',
    topic: 'getting-started',
    q: 'Will my account close if I stop using it?',
    a: 'Yes. An account nobody logs into for 60 days closes by itself, for security. An open trade or dispute pauses the count.',
    sources: ['apps/api/src/accountInactivity.ts:36 INACTIVE_MS', 'apps/api/src/accountInactivity.ts:4 An open trade or dispute pauses the clock'],
    facts: ['inactiveDays'],
  },

  // ---- Buying and selling ---------------------------------------------------------------------
  {
    id: 'how-a-trade-works',
    topic: 'trading',
    q: 'How does a trade work?',
    a: 'The seller funds the escrow with the XMR. Once the escrow is secured, the buyer sends the payment outside X2F and taps "I\'ve paid". The seller checks that the money arrived and releases the XMR to the buyer.',
    sources: [`${M}:357-373 function onChain`, `${M}:600-619 case 'mark-paid'`, `${M}:694-697 case 'release-started'`],
  },
  {
    id: 'what-is-an-offer',
    topic: 'trading',
    q: 'What is an offer?',
    a: 'An offer is a vendor\'s ad to buy or sell XMR. It lists up to 5 currencies and up to 5 payment methods, and its price follows the market price, plus or minus the vendor\'s percentage. You pick the currency and the payment method when you take it.',
    sources: [`${T}/flexOffer.ts:46 MAX_CURRENCIES`, `${T}/flexOffer.ts:44 MAX_METHODS`, `${T}/flexOffer.ts:11 market ± X% only`, `${T}/flexOffer.ts:9 the buyer picks a currency and a method at take`],
    facts: ['maxCurrencies', 'maxMethods'],
  },
  {
    id: 'who-can-post',
    topic: 'trading',
    q: 'Who can post an offer?',
    a: 'Vendor accounts post offers. A vendor can normally have 3 buy offers and 3 sell offers at a time.',
    sources: [
      'apps/web/src/session/member.ts:29 only vendor accounts post offers',
      'apps/api/src/offers/routes.ts:263 OFFER_CAP_DEFAULTS',
      'apps/api/src/offers/routes.ts:261 Owner settings override these defaults',
    ],
    facts: ['offerCapBuy', 'offerCapSell'],
  },
  {
    id: 'price',
    topic: 'trading',
    q: 'How is the price set?',
    a: 'An offer\'s price is the market price plus or minus the vendor\'s percentage, which goes up to 50% either way. The price is fixed for your trade the moment you take the offer.',
    sources: [`${T}/money.ts:12 MAX_MARGIN_BPS`, `${M}:37-38 Fixed at take (OD-5)`],
    facts: ['maxMarginPercent'],
  },
  {
    id: 'price-bands',
    topic: 'trading',
    q: 'Why does one offer show different prices for different amounts?',
    a: 'A vendor can split each currency into up to 3 bands by amount. Each band has its own price and can ask that you have 5, 10, 25 or 50 completed trades.',
    sources: [`${T}/flexOffer.ts:42 MAX_BANDS`, `${T}/flexOffer.ts:24-25 Each band has its margin`, `${T}/flexOffer.ts:61 BAND_MIN_TRADES`],
    facts: ['maxBands', 'bandMinTrades'],
  },
  {
    id: 'trade-size-limit',
    topic: 'trading',
    q: 'How big can one trade be?',
    a: 'For now, one trade can be worth up to 5,000 US dollars. Each offer also sets its own smallest and largest amounts.',
    sources: [`${T}/limits.ts:7 LAUNCH_TRADE_CAP_USD_CENTS`, `${M}:262 outside the offer limits`],
    facts: ['launchCapUsd'],
  },
  {
    id: 'taking-an-offer',
    topic: 'trading',
    q: 'What happens after I take an offer?',
    a: 'The vendor has 60 minutes to accept your trade, or it closes by itself. Once it is accepted, the escrow is set up for the seller to fund.',
    sources: [`${T}/timers.ts:3-7 setupMin: 60`, `${M}:422-423 return past(now, t.setupBy) ? close`],
    facts: ['setupMinutes'],
  },
  {
    id: 'funding-time',
    topic: 'trading',
    q: 'How long does the seller have to fund the escrow?',
    a: '30 minutes from when the escrow is ready. If it is not fully funded in time, the trade ends and anything already sent goes back to the seller.',
    sources: [`${T}/timers.ts:8 fundMin: 30`, `${M}:424-427 return { ...t, state: 'lapsed'`, `${T}/payouts.ts:88-92 lapse-refund`],
    facts: ['fundMinutes'],
  },
  {
    id: 'when-to-pay',
    topic: 'trading',
    q: 'When should I send my payment?',
    a: 'Only once the trade shows the escrow as funded and secured. Before that, do not send anything.',
    sources: [`${WEB}/trade/TradeFund.tsx:459 Pay only once the escrow is funded and secured`, `${M}:604 if (s === 'securing') return fail('too-early');`],
  },
  {
    id: 'time-to-pay',
    topic: 'trading',
    q: 'How long do I have to pay?',
    a: 'It depends on the payment method, and the trade shows the time you have. If it runs out before you tap "I\'ve paid", the seller may cancel the trade and get the XMR back.',
    sources: [`${M}:43-46 payWindowMin: number;`, `${M}:372 payBy: addMin(base(t, now), t.payWindowMin)`, `${M}:628-638 case 'request-refund'`],
  },
  {
    id: 'more-time',
    topic: 'trading',
    q: 'Can the seller give me more time to pay?',
    a: 'Yes. Once your time to pay has passed, the seller can give you 30 more minutes, up to 2 times.',
    sources: [`${T}/timers.ts:14 extendMin: 30`, `${T}/timers.ts:15 maxExtensions: 2`, `${M}:621-626 case 'extend'`],
    facts: ['extendMinutes', 'maxExtensions'],
  },
  {
    id: 'paid-late',
    topic: 'trading',
    q: 'What if I pay after my time runs out?',
    a: 'The trade stays open until the seller cancels it, so you can still tap "I\'ve paid". If the seller cancels first, the XMR usually goes back to the seller within seconds, even if you already sent your payment. You can still open a dispute straight away, and the moderator looks at it after the refund.',
    sources: [
      `${M}:605-608 after payBy the buyer may still tap`,
      `${M}:489 if (by === 'buyer' && t.settling === 'auto-refund') return open();`,
      `${M}:484-488 Usually the refund lands anyway`,
    ],
  },
  {
    id: 'ive-paid',
    topic: 'trading',
    q: 'What does "I\'ve paid" do?',
    a: 'It tells the seller your payment was sent. After you tap it, neither side can cancel the trade, so a dispute is the way to sort out a problem.',
    sources: [`${M}:617 No cancel after "I've paid"`, `${M}:203 CANCEL_STATES`, `${M}:476-480 case 'paid':`],
  },
  {
    id: 'buyer-cancel',
    topic: 'trading',
    q: 'Can I cancel a trade as the buyer?',
    a: 'Yes, at any time until you tap "I\'ve paid". If the escrow was already funded, the XMR goes back to the seller.',
    sources: [`${M}:640-645 case 'buyer-cancel'`, `${T}/payouts.ts:86 case 'buyer-cancel':`],
  },
  {
    id: 'seller-cancel',
    topic: 'trading',
    q: 'Can I cancel a trade as the seller?',
    a: 'Before you start funding the escrow, yes. After it is funded, you can cancel once the buyer\'s time to pay has passed without "I\'ve paid", and your XMR starts coming back at once. Both sides can also agree to cancel before "I\'ve paid".',
    sources: [`${M}:669-675 case 'walk-away'`, `${M}:628-638 case 'request-refund'`, `${M}:647-660 case 'propose-cancel'`],
  },
  {
    id: 'confirm-cancel',
    topic: 'trading',
    q: 'Why does a cancelled trade ask me to confirm the cancel?',
    a: 'When a buyer cancels after the escrow was funded, the seller confirms once the returned XMR has all 10 confirmations. If the seller does not, the trade closes as cancelled by itself 48 hours later.',
    sources: [`${T}/timers.ts:31 SELLER_CONFIRM_CANCEL_TIMEOUT_H`, `${T}/timers.ts:23 UNLOCK_CONFIRMATIONS`, `${M}:684-692 case 'confirm-cancel'`],
    facts: ['unlockConfirmations', 'confirmCancelHours'],
  },
  {
    id: 'nudge',
    topic: 'trading',
    q: 'What is a nudge?',
    a: 'A nudge sends the other trader an alert to get their attention. You can send one every 15 minutes, as many as you need. Nudges are optional.',
    sources: ['apps/api/src/nudge/routes.ts:16 NUDGE_GAP_MS', 'apps/api/src/nudge/routes.ts:14 There is no cap on how many', `${M}:114-115 Nudges are`],
    facts: ['nudgeMinutes'],
  },
  {
    id: 'payment-details',
    topic: 'trading',
    q: 'How do I send my payment details?',
    a: 'In the trade chat, the payment details form asks for the details your payment method needs, then sends them to the other trader in one message.',
    sources: [`${T}/payFields.ts:76 PAY_FIELDS`, 'apps/web/src/chat/ChatPanel.tsx:371 PAY_DETAILS_TITLE'],
  },
  {
    id: 'trade-chat',
    topic: 'trading',
    q: 'Can I chat with the other trader?',
    a: 'Yes. Every trade has its own chat, and messages are encrypted on your device before they are sent.',
    sources: [`${T}/chat.ts:10 CHAT_MSG_TYPE`, `${SPEC}:163 Every chat message is an envelope v2 under TK`],
  },
  {
    id: 'payment-proof',
    topic: 'trading',
    q: 'Can I upload a screenshot of my payment?',
    proofUpload: {
      off: {
        a: 'Uploading payment proof is not in the app yet. The trade screen already shows where it will go, and tapping "I\'ve paid" without proof asks you to confirm first.',
        sources: [
          'apps/web/src/proof/flag.ts:8 stays off unless the build says so',
          `${WEB}/trade/BuyerPay.tsx:382 enabled={proofUploadOn()}`,
          `${WEB}/proof/proofSlot.tsx:76 const live = enabled && secured`,
          `${WEB}/trade/NoProofSheet.tsx:7-9 Mark paid without proof`,
        ],
      },
      on: {
        a: 'Yes. Once the escrow is secured, add a screenshot or photo of your payment on the trade screen. Before it is sent, your device blurs private details for you to check and removes location and device info. It goes to the other trader encrypted in the trade chat, and in a dispute the moderator can ask you for an unblurred copy.',
        sources: [
          `${WEB}/trade/BuyerPay.tsx:382 enabled={proofUploadOn()}`,
          `${WEB}/proof/proofSlot.tsx:9 after the escrow is secured`,
          `${WEB}/proof/proofSlot.tsx:48 Private details are blurred for you to check next. Location and device info are removed.`,
          'apps/web/src/proof/upload.ts:15-16 `proof.attached` envelope through the chat engine',
          `${WEB}/dispute/seams.tsx:99 proofUploadOn() || request === null`,
          'apps/web/src/proof/upload.ts:359 Seal `proof.unblurred` to the moderator only',
        ],
      },
    },
  },
  {
    id: 'gift-cards',
    topic: 'trading',
    q: 'What are the rules for gift cards?',
    a: 'The card must have been bought in the last 30 days, carry its full written value and be in the currency of its country. The seller has 45 minutes to check a card once its details are handed over, and both sides tick the gift card terms before the trade. A range card, like a Visa 200 to 500, may be partly used only with video proof.',
    sources: [`${T}/giftCards.ts:19 GIFT_CARD_MAX_AGE_DAYS`, `${T}/giftCards.ts:22 GIFT_CARD_CHECK_MIN`, `${T}/giftCards.ts:8-9 G52: the card carries`, `${T}/giftCards.ts:13 T-081`, `${T}/giftCards.ts:29 GIFT_CARD_TERMS_VERSION`],
    facts: ['giftCardAgeDays', 'giftCardCheckMinutes', 'giftCardRangeExample'],
  },
  {
    id: 'maintenance',
    topic: 'trading',
    q: 'What happens to my trade during maintenance?',
    a: 'Its timers stop, and they carry on from where they were when maintenance ends. You can still tap "I\'ve paid", cancel as the buyer or open a dispute.',
    sources: [`${M}:220 WHILE_PAUSED`, `${M}:443-466 function onResume`],
  },

  // ---- Escrow and Monero ----------------------------------------------------------------------
  {
    id: 'how-escrow-works',
    topic: 'escrow',
    q: 'How does the escrow work?',
    a: 'Each trade gets its own Monero wallet with 3 keys: one for the buyer, one for the seller and one for a moderator from X2F. Any 2 keys together can move the XMR, and one key alone moves nothing.',
    sources: [`${SPEC}:53-57 fresh Monero 2-of-3 multisig wallet`, `${WEB}/trade/escrowCopy.ts:7-9 any 2 release it`],
    facts: ['escrowKeys', 'escrowThreshold'],
  },
  {
    id: 'who-signs',
    topic: 'escrow',
    q: 'Who signs when the XMR moves?',
    a: 'For a normal release, the seller and the buyer sign together. The moderator\'s key only ever signs together with a trader\'s: for a buyer\'s cancel, a refund after the buyer\'s time to pay ran out, or a dispute ruling.',
    sources: [
      "apps/web/src/escrow/policy.ts:107 release: { builder: 'seller', cosigner: 'buyer' }",
      "apps/web/src/escrow/policy.ts:109 'auto-refund': { builder: 'seller', cosigner: 'mod' }",
      "apps/web/src/escrow/policy.ts:110 'buyer-cancel': { builder: 'buyer', cosigner: 'mod' }",
      'apps/moderation/src/rulings.ts:1-10 Moderator rulings',
    ],
  },
  {
    id: 'escrow-keys-where',
    topic: 'escrow',
    q: 'Where is my escrow key kept?',
    a: 'Your key share is made and kept on your own device, never on X2F\'s servers. X2F holds only the moderator\'s share.',
    sources: [`${SPEC}:40 a buyer's or seller's escrow key share`, `${SPEC}:59 X2F holds`],
  },
  {
    id: 'secured',
    topic: 'escrow',
    q: 'What does "secured" mean?',
    a: 'The escrow holds the full amount, and every coin in it has 10 confirmations on the Monero network. Only then can the buyer tap "I\'ve paid".',
    sources: [`${M}:371-372 state: 'secured'`, `${T}/timers.ts:23 UNLOCK_CONFIRMATIONS`, `${M}:602-604 (owner Q12`],
    facts: ['unlockConfirmations'],
  },
  {
    id: 'check-words',
    topic: 'escrow',
    q: 'What are the check words?',
    a: 'Once the escrow is set up, both trade apps show the same 4 words. Compare them with the other trader in the chat: different words mean you are not in the same escrow, so stop and do not send anything.',
    sources: [`${T}/checkWords.ts:5-7 four words both trader apps`, `${T}/checkWords.ts:13 const WORDS = 4;`],
    facts: ['checkWords'],
  },
  {
    id: 'own-wallet',
    topic: 'escrow',
    q: 'Do I need my own Monero wallet?',
    a: 'Yes. X2F holds no wallet for your coins: a seller funds the escrow from their own wallet, and the XMR is paid out to a wallet address you add to X2F.',
    sources: [`${SPEC}:41 users' coins, or any wallet for users' coins`, `${WEB}/quote/addressCopy.ts:16 which wallet address should the XMR be sent to`],
  },
  {
    id: 'pick-payout-address',
    topic: 'escrow',
    q: 'How do I choose where my XMR goes?',
    a: 'When you take an offer, you pick one of your saved wallets for that trade. As a buyer it is where your XMR is paid; as a seller it is where your XMR goes back if the trade is cancelled.',
    sources: [`${WEB}/quote/addressCopy.ts:16 buy: 'If you buy with X2F`, `${WEB}/quote/addressCopy.ts:18 sell: 'If this trade is cancelled`],
  },
  {
    id: 'security-rating',
    topic: 'escrow',
    q: 'What is my account\'s security rating?',
    a: 'It is high when your account has a PGP key, a passkey or a security key, medium with a password and an authenticator app, and weak with a password alone. The rating decides whether you can add a new payout address while you start a trade.',
    sources: [`${AUTH}/rating.ts:25 return 'high'`, `${AUTH}/rating.ts:26 return 'medium'`, `${AUTH}/rating.ts:27 return 'weak'`, `${WEB}/quote/addressCopy.ts:26-36 addressRuleText`],
  },
  {
    id: 'new-address-in-trade',
    topic: 'escrow',
    q: 'Can I add a new payout address while I start a trade?',
    a: 'Yes, if your account is rated high: the new address can be for this trade only or saved for future trades. Other accounts add new addresses in Settings, under Your wallets, and they start working 24 hours later.',
    sources: [`${WEB}/quote/addressCopy.ts:28 Your account is rated highly secure`, `${WEB}/quote/addressCopy.ts:31 start working 24 hours after you add them`],
    facts: ['payoutWaitHours'],
  },
  {
    id: 'wallet-wait',
    topic: 'escrow',
    q: 'Why does my new wallet wait 24 hours?',
    a: 'A new address works at once when you confirm it with a PGP key, passkey or security key. Confirmed with a password, it starts working 24 hours later. The first wallet on a new account works at once.',
    sources: ['apps/api/src/wallets/routes.ts:345-352 const waits = account.had_wallet', 'apps/api/src/wallets/routes.ts:17 PAYOUT_WAIT_MS'],
    facts: ['payoutWaitHours'],
  },
  {
    id: 'one-time-address',
    topic: 'escrow',
    q: 'What is a "This trade only" address?',
    a: 'It is used for one trade and then taken off your list of wallets. It comes back only if the trade is cancelled while it is still being set up.',
    sources: [`${WEB}/quote/addressCopy.ts:63-65 oneTimeNote`],
  },
  {
    id: 'payout-time',
    topic: 'escrow',
    q: 'How long does a payout take?',
    a: 'When the seller releases, both trade apps sign the payout and it is sent to your wallet. Monero then needs 10 confirmations, about 20 minutes, before your wallet lets you spend it, and the trade shows the count.',
    sources: [`${SPEC}:63 | Release | seller | buyer |`, `${T}/timers.ts:23 UNLOCK_CONFIRMATIONS`, `${M}:727 blockSeconds = 120`, `${WEB}/trade/Released.tsx:14 live confirmations`],
    facts: ['unlockConfirmations', 'unlockMinutes'],
  },
  {
    id: 'release-is-final',
    topic: 'escrow',
    q: 'Can a release be undone?',
    a: 'No. A release is final, so the seller should release only once the money is really in their account.',
    sources: [`${WEB}/trade/escrowCopy.ts:13 Once released, the XMR`, `${WEB}/trade/ReleaseWarning.tsx:47 Only release once the money`],
  },
  {
    id: 'network-fee',
    topic: 'escrow',
    q: 'Is there a Monero network fee?',
    a: 'Yes. Every Monero payment pays a small fee to the Monero network, and it is separate from X2F\'s 1% fee. When the escrow pays out, the fee comes out of what the person receiving the trade\'s XMR gets: the buyer on a release, the seller on a refund or cancel.',
    sources: [
      `${T}/payouts.ts:7 receiving the trade's XMR and bears the network fee`,
      `${T}/payouts.ts:80 { address: f.buyerPayout, amountAtomic: toBuyer }`,
      `${T}/payouts.ts:92 return out([{ address: f.sellerRefund, amountAtomic: balance }]);`,
      'packages/escrow/src/verify.ts:177 i === 0 ? p.amountAtomic - fee',
    ],
    facts: ['feePercent'],
  },

  // ---- Disputes and appeals -------------------------------------------------------------------
  {
    id: 'when-to-dispute',
    topic: 'disputes',
    q: 'When can I open a dispute?',
    a: 'After "I\'ve paid", either side can open one once the wait for that payment method has passed; the trade shows when. Before "I\'ve paid", only the seller can open one, once the escrow is funded. A buyer who paid late can open one at once if the seller cancels.',
    sources: [`${M}:477-480 case 'paid':`, `${M}:470-476 if (by === 'buyer') return fail('too-early');`, `${M}:489 t.settling === 'auto-refund'`, 'apps/api/src/methods/profiles.ts:27-31 dispute (machine.ts `confirmBy`'],
  },
  {
    id: 'dispute-opened',
    topic: 'disputes',
    q: 'What happens when a dispute opens?',
    a: 'The XMR stays in the escrow until a moderator decides. If you are the buyer and have not paid yet, the trade tells you not to send any payment. Both of you can still chat and answer the moderator.',
    sources: [`${WEB}/dispute/DoNotPay.tsx:15-17 before tapping "I've paid"`, `${WEB}/dispute/DoNotPay.tsx:27 Don't send any payment`, 'apps/api/src/team/abilities.ts:132 Answer the moderator', `${T}/payouts.ts:26-32 A moderator-built set for a published ruling`],
  },
  {
    id: 'moderator-time',
    topic: 'disputes',
    q: 'How long until a moderator steps in?',
    a: 'X2F aims for a moderator to step in within 24 hours. The dispute screen counts the time down.',
    sources: ['packages/staff/src/dispute.ts:16 RULING_GOAL_H', `${WEB}/dispute/rules.ts:34 HOURGLASS_LINE`, `${WEB}/dispute/DisputeRoom.tsx:74-76 hourglass counting down from 24 hours`],
    facts: ['rulingGoalHours'],
  },
  {
    id: 'moderator-sees',
    topic: 'disputes',
    q: 'What does the moderator see?',
    proofUpload: {
      off: {
        a: 'The trade, the escrow and both traders, and the messages written in the dispute. The moderator can write to both of you there. The moderator can also open the trade\'s full chat, on a confirmed staff device.',
        sources: ['apps/staff-web/src/screens/ModCase.tsx:87-89 the traders, the payment proof, the escrow', 'apps/staff-web/src/screens/ModCase.tsx:96-97 "Open the full chat" asks the API for the chat key re-wrapped to this'],
      },
      on: {
        a: 'The trade, the escrow and both traders, and the messages written in the dispute. The moderator can write to both of you there, and can request unblurred proof: a copy of your payment proof with nothing blurred, sealed for the moderator only, though the moderator\'s screens do not open it yet. The moderator can also open the trade\'s full chat, on a confirmed staff device.',
        sources: [
          'apps/staff-web/src/screens/ModCase.tsx:87-89 the traders, the payment proof, the escrow',
          'apps/staff-web/src/screens/ModCase.tsx:444 Request unblurred proof from',
          `${WEB}/dispute/seams.tsx:99 proofUploadOn() || request === null`,
          'apps/web/src/proof/upload.ts:359 Seal `proof.unblurred` to the moderator only',
          'apps/staff-web/src/screens/ModCase.tsx:437 NEEDS_P5_PROOF_ENVELOPE: the proof itself is not readable here yet',
          'apps/staff-web/src/screens/ModCase.tsx:96-97 "Open the full chat" asks the API for the chat key re-wrapped to this',
        ],
      },
    },
  },
  {
    id: 'ruling-outcomes',
    topic: 'disputes',
    q: 'What can a ruling decide?',
    a: 'While the XMR is in escrow, the moderator either releases it to the buyer or returns it to the seller. The ruling takes effect at once.',
    sources: ['packages/staff/src/intent.ts:16 ESCROW_OUTCOMES', 'packages/staff/src/dispute.ts:35-36 round 1 is ruled and acts at once'],
  },
  {
    id: 'second-approver',
    topic: 'disputes',
    q: 'Does one moderator decide alone?',
    a: 'One moderator rules, except on a large trade: its ruling also needs a senior moderator or the owner to approve it.',
    sources: ['packages/staff/src/dispute.ts:212-213 needsSecond', 'apps/api/src/staff/settingsDefaults.ts:11-12 largeTradeLimitUsd', 'packages/staff/src/dispute.ts:271-272 const canApprove'],
  },
  {
    id: 'appeal',
    topic: 'disputes',
    q: 'Can I appeal a ruling?',
    a: 'Yes. Either side can appeal, normally within 48 hours of the ruling. A senior moderator or the owner who took no part in the first ruling looks at it again, and aims to decide within 48 hours.',
    sources: ['apps/api/src/staff/settingsDefaults.ts:27 appealWindowH', 'apps/api/src/staff/settingsDefaults.ts:15 Hours after a ruling in which either side may appeal', 'packages/staff/src/dispute.ts:384 too-late', 'packages/staff/src/dispute.ts:278-279 eligibleForAppeal', 'packages/staff/src/dispute.ts:17 APPEAL_GOAL_H'],
    facts: ['appealWindowHours', 'appealGoalHours'],
  },
  {
    id: 'ruling-during-appeal',
    topic: 'disputes',
    q: 'Does the ruling wait while I appeal?',
    a: 'No. The first ruling takes effect at once, even when it is appealed.',
    sources: ['packages/staff/src/dispute.ts:35-37 round 1 is ruled and acts at once', 'packages/staff/src/dispute.ts:73-76 round 1 still executes after'],
  },

  // ---- Account safety -------------------------------------------------------------------------
  {
    id: 'changes-wait',
    topic: 'safety',
    q: 'Why do some of my changes wait 24 hours?',
    a: 'When you log in with only a username and password, changes to your login methods, payout wallets, security settings, recovery code or team wait 24 hours before they apply. A login with a PGP key, passkey or security key, or a password with an authenticator code, applies them at once.',
    sources: [`${AUTH}/hold.ts:5-11 A username-and-password session's changes wait 24 h`, `${AUTH}/strength.ts:21-30 STRONG_COMBOS`, `${AUTH}/hold.ts:88 HOLD_MS`],
    facts: ['holdHours'],
  },
  {
    id: 'cancel-waiting-changes',
    topic: 'safety',
    q: 'Can I stop a change that is waiting?',
    a: 'Yes. Any of your logged-in sessions can cancel waiting changes, all at once or one by one, and a strong login can apply them now: a PGP key, passkey or security key, or a password with an authenticator code. Up to 20 changes can wait at a time.',
    sources: [`${AUTH}/hold.ts:12-14 logged-in session of the account owner cancels them`, `${AUTH}/hold.ts:14 login may approve them now (G58)`, `${AUTH}/strength.ts:21-30 STRONG_COMBOS`, `${AUTH}/holdChanges.ts:43 MAX_HOLD_CHANGES`],
    facts: ['maxHoldChanges'],
  },
  {
    id: 'recovery-login',
    topic: 'safety',
    q: 'What happens when I log in with my recovery code?',
    a: 'Every device on your account is logged out and the account is held for 24 hours: trades not funded yet are cancelled, and funded ones are paused. Logging in with a passkey, security key or PGP key that was already on the account ends the hold early.',
    sources: [`${AUTH}/hold.ts:16-21 A recovery-code login holds the account 24 h`, `${AUTH}/hold.ts:25-26 endHoldIfOwner`, `${AUTH}/recovery.ts:56 RECOVERY_HOLD_MS`],
    facts: ['recoveryHoldHours'],
  },
  {
    id: 'partner-on-hold',
    topic: 'safety',
    q: 'The other trader\'s account "has a temporary problem". What does that mean?',
    a: 'Something on their account needs sorting out first, so your trade is paused and no XMR moves for now. You can still chat with them and open a dispute.',
    sources: ['apps/api/src/trades/held.ts:11-14 the partner is told', `${M}:213-220 WHILE_PAUSED`],
  },
  {
    id: 'new-device-approval',
    topic: 'safety',
    q: 'Why do I have to approve a login on another device?',
    a: 'When you are already logged in somewhere, a login from a new device waits for your approval on a device you are logged in on. The new device shows a number, and you tap the same number on the other one within 5 minutes.',
    sources: [`${AUTH}/approval.ts:5-8 open full session on another device`, `${AUTH}/approval.ts:16-19 Number matching`, `${AUTH}/approval.ts:55 APPROVAL_TTL_MS`],
    facts: ['approvalMinutes'],
  },
  {
    id: 'device-limit',
    topic: 'safety',
    q: 'How many devices can I be logged in on?',
    a: 'Normally up to 3 at a time. You can also turn on "One device at a time" in Settings.',
    sources: [`${AUTH}/approval.ts:61 DEFAULT_MAX_DEVICES`, `${AUTH}/approval.ts:120 The owner's \`max_devices\` setting`, `${AUTH}/approval.ts:8-9 One`],
    facts: ['maxDevices'],
  },
  {
    id: 'new-device-alone',
    topic: 'safety',
    q: 'I am not logged in anywhere else. Can I log in on a new device with my password?',
    a: 'On a new device with nothing else logged in, X2F lets you in with a passkey, security key or PGP key. A password is refused there, even with an authenticator code, so the way in is your recovery code. Know what it costs first: a recovery-code login logs out every device and holds the account for 24 hours, cancelling trades not funded yet and pausing funded ones.',
    sources: [
      `${AUTH}/approval.ts:206-208 with nothing logged in to approve it`,
      `${AUTH}/approval.ts:310 approval-unavailable`,
      `${AUTH}/hold.ts:16-21 A recovery-code login holds the account 24 h`,
      `${AUTH}/recovery.ts:56 RECOVERY_HOLD_MS`,
    ],
    facts: ['recoveryHoldHours'],
  },
  {
    id: 'remembered-device',
    topic: 'safety',
    q: 'How long does X2F remember my device?',
    a: 'A device you log in on stays known for your account until it goes unused for 90 days.',
    sources: [`${AUTH}/device.ts:52-53 TRUSTED_DEVICE_TTL_MS`],
    facts: ['trustedDeviceDays'],
  },
  {
    id: 'account-frozen',
    topic: 'safety',
    q: 'Why is my account frozen?',
    a: 'A moderator can freeze trading on an account whose owner ignores a dispute or a ruling. The freeze has no end date: it is lifted once you do what the dispute asks and tell the moderator in the dispute chat.',
    sources: [`${WEB}/account/AccountFrozen.tsx:8-11 a moderator froze the account`],
  },
  {
    id: 'bans',
    topic: 'safety',
    q: 'Can my account be banned?',
    a: 'Account bans are not in the app yet. This answer will say how they work once they are.',
    sources: ['apps/api/src/bans.ts:29-30 nothing calls `recordBan` yet', 'apps/api/src/disputes/rulings.ts:59-63 Account actions on the ruling card are refused'],
  },
  {
    id: 'release-scam',
    topic: 'safety',
    q: 'How do I avoid being scammed when I sell?',
    a: 'Release only once the money is really in your account. Check your own bank or payment app, not a screenshot: screenshots can be faked.',
    sources: [`${WEB}/trade/ReleaseWarning.tsx:47 Only release once the money`, `${WEB}/trade/ReleaseWarning.tsx:49 Screenshots can be faked`],
  },
  {
    id: 'real-moderator',
    topic: 'safety',
    q: 'How do I know a message is really from a moderator?',
    a: 'Moderator messages appear only inside a disputed trade, with the moderator tag beside them. Someone who calls themselves a moderator in a normal trade chat is another trader.',
    sources: [`${WEB}/dispute/ModeratorTag.tsx:1-4 only when`],
  },
  {
    id: 'never-asks',
    topic: 'safety',
    q: 'What will X2F never ask me for?',
    a: 'Your PGP private key, your escrow key, your email or your phone number. X2F does not need any of them, so anyone asking for them in X2F\'s name is not X2F.',
    sources: [`${SPEC}:38-43 X2F never holds`, `${SPEC}:15 X2F asks for no name, email or phone`, `${WEB}/setup/Login.tsx:130 X2F never makes keys for`],
  },

  // ---- Teams -----------------------------------------------------------------------------------
  {
    id: 'what-is-a-team',
    topic: 'teams',
    q: 'What is a team?',
    a: 'A vendor account can add up to 3 team members to help run it. The vendor is the team lead and decides what each member may do.',
    sources: ['apps/api/src/team/perms.ts:25 MAX_TEAM_MEMBERS', `${WEB}/settings/accountTypeCopy.ts:20 can add team members`, 'apps/api/src/team/abilities.ts:4-9 One list of boxes'],
    facts: ['maxTeamMembers'],
  },
  {
    id: 'invite-member',
    topic: 'teams',
    q: 'How do I add a team member?',
    a: 'Send an invite from Settings, under Team; it works for 24 hours. The member then signs the Terms and sets up their own login with a PGP key, passkey or security key.',
    sources: ['apps/api/src/team/members.ts:37 INVITE_TTL_MS', `${AUTH}/methods.ts:37 kind === 'member'`, 'apps/api/src/termsSignature.ts:3-4 a team member at join'],
    facts: ['inviteHours'],
  },
  {
    id: 'member-can',
    topic: 'teams',
    q: 'What can team members do?',
    a: 'What the lead ticks for them, such as seeing, pausing, posting or deleting offers, seeing trades, marking "I\'ve paid", giving more time, cancelling where the rules allow, answering the moderator and filing an appeal. Members can also see and cancel waiting changes, and add notes on traders, if the lead allows it.',
    sources: ['apps/api/src/team/abilities.ts:92-99 offers-see', 'apps/api/src/team/abilities.ts:108-110 trades-mark-paid', 'apps/api/src/team/abilities.ts:132-133 disputes-answer', 'apps/api/src/team/abilities.ts:125 notes-add', 'apps/api/src/team/abilities.ts:143-144 hold-see'],
  },
  {
    id: 'member-never',
    topic: 'teams',
    q: 'What do team members never do?',
    a: 'Confirm a payment arrived or release XMR, add or remove wallets, invite or remove members, change members\' permissions, change the account\'s security or delete the account. Opening a dispute is also the account owner\'s.',
    sources: ['apps/api/src/team/abilities.ts:13-18 Members never confirm payment received', 'apps/api/src/team/abilities.ts:146-148 team-invite', 'apps/api/src/team/abilities.ts:165 account-delete'],
  },
  {
    id: 'member-chat',
    topic: 'teams',
    q: 'Can team members chat with traders?',
    a: 'Not yet. Trade chats and payment proof stay with the account owner until team members get their own chat keys. Taking or accepting trades and funding the escrow also wait for member keys.',
    sources: ['apps/api/src/team/abilities.ts:35-38 waits-member-keys', 'apps/api/src/team/abilities.ts:118 chat-read', 'apps/api/src/team/abilities.ts:104-105 trades-accept', 'apps/api/src/team/abilities.ts:115 trades-fund'],
  },

  // ---- Privacy ---------------------------------------------------------------------------------
  {
    id: 'what-is-stored',
    topic: 'privacy',
    q: 'What does X2F keep about me?',
    a: 'Your display name, your username stored only as a one-way code, and the signature you gave for the Terms, stored sealed. Your login methods: PGP keys kept whole as you gave them, whose user IDs may hold a name and email, other public keys, or a password kept only as a hash. Your trades with their payout addresses and your chats in encrypted form, until the trade self-destructs. X2F asks for no email or phone number.',
    sources: [
      `${SPEC}:34 password hashes`,
      `${SPEC}:215 Stored only as HMAC-SHA-256`,
      'apps/api/src/termsSignature.ts:5 Stored with the account',
      'apps/api/src/termsSignature.ts:29 At rest it is sealed',
      `${SPEC}:211 v4 keys, which are most keys in use, are stored whole, with their user IDs, which often hold a real name and email`,
      `${T}/retention.ts:6 An undisputed trade self-destructs`,
      `${SPEC}:15 X2F asks for no name, email or phone`,
    ],
  },
  {
    id: 'trade-kept',
    topic: 'privacy',
    q: 'How long is my trade kept?',
    a: 'An undisputed trade self-destructs 30 days after it closes: X2F deletes it whole, its chat and payout addresses included. A trade that had a dispute is kept until 90 days after the dispute closes, and nothing is deleted while a dispute is open. Once your trade has a date, the trade screen shows it. Reviews stay on profiles after their trade is gone.',
    sources: [
      `${T}/retention.ts:6-7 An undisputed trade self-destructs TRADE_KEEP_DAYS (30) days after it closed`,
      `${T}/retention.ts:8-10 A trade that had a dispute is kept DISPUTE_KEEP_DAYS (90) days after its LAST dispute closed`,
      `${T}/retention.ts:33 TRADE_KEEP_DAYS`,
      `${T}/retention.ts:35 DISPUTE_KEEP_DAYS`,
      'apps/api/src/retention/tradePurge.ts:24-26 deleted whole',
      `${WEB}/trade/SelfDestruct.tsx:29 This trade self-destructs on`,
      'apps/api/src/retention/tradePurge.ts:25 its reviews are detached (they are permanent)',
    ],
    facts: ['tradeKeepDays', 'tradeDisputeKeepDays'],
  },
  {
    id: 'chat-kept',
    topic: 'privacy',
    q: 'How long are chats kept?',
    a: 'A trade\'s chat is deleted 30 days after the trade closes. If the trade had a dispute, its chat is kept until 90 days after the dispute closes. A chat that never became a trade is deleted after 7 days without a message.',
    sources: [`${T}/chat.ts:22 CHAT_AFTER_CLOSE_DAYS`, `${T}/chat.ts:24 CHAT_AFTER_DISPUTE_DAYS`, `${T}/chat.ts:20 CHAT_PRETRADE_IDLE_DAYS`, 'apps/api/src/chat/retention.ts:9 30 days after an undisputed trade closes'],
    facts: ['chatAfterCloseDays', 'chatAfterDisputeDays', 'chatPretradeDays'],
  },
  {
    id: 'device-copy',
    topic: 'privacy',
    q: 'Does my device keep a copy of my chats?',
    a: 'Your device keeps no message text: each time you open a chat, it reads the messages from X2F again and decrypts them. It keeps the chat\'s keys and a short receipt for each message, encrypted. When X2F deletes a chat, your device erases that record the next time it checks with X2F, if that is within a year.',
    sources: [
      'apps/web/src/chat/engine.ts:35-36 No message text is stored on the device',
      'apps/web/src/chat/store.ts:3-5 NEVER the text',
      'apps/web/src/chat/store.ts:13 non-extractable AES-256-GCM CryptoKey',
      'apps/web/src/chat/engine.ts:64-66 Erase on purge',
      'apps/api/src/chat/retention.ts:20 is told 410',
      'apps/api/src/chat/retention.ts:23 CHAT_PURGED_MARK_DAYS',
    ],
    facts: ['chatPurgedMarkYear'],
  },
  {
    id: 'addresses-kept',
    topic: 'privacy',
    q: 'How long are payout addresses kept on a trade?',
    a: 'On an undisputed trade, until the trade self-destructs 30 days after it closes, when X2F deletes the whole trade with them. On a trade that had a dispute, they are erased 90 days after the trade closes, and never while a dispute is open.',
    sources: [
      `${T}/retention.ts:6-7 An undisputed trade self-destructs TRADE_KEEP_DAYS (30) days after it closed`,
      'apps/api/src/retention/tradePurge.ts:24-26 deleted whole',
      'apps/api/src/trades/purge.ts:5 TRADE_ADDRESS_RETENTION_MS',
      'apps/api/src/trades/purge.ts:11 Nulls `buyer_payout`',
      'apps/api/src/trades/purge.ts:11-12 never on a',
    ],
    facts: ['tradeKeepDays', 'addressDays'],
  },
  {
    id: 'who-reads-chat',
    topic: 'privacy',
    q: 'Can X2F read my chats?',
    a: 'Chats are encrypted with a key only the buyer and the seller hold, so nobody else can read them on the way or from X2F\'s main database. When a dispute opens, the key goes to X2F\'s moderation service, so the moderators handling the dispute can read the chat.',
    sources: [
      `${SPEC}:166 can decrypt a chat only after a trader's app has granted it TK`,
      'apps/web/src/chat/engine.ts:51 One key per chat, envelope v2',
      "apps/web/src/chat/engine.ts:191 this trader's signed grant of the chat key to the chat's",
      'apps/staff-web/src/screens/ModCase.tsx:96-97 "Open the full chat" asks the API for the chat key re-wrapped to this',
    ],
  },
  {
    id: 'pgp-key-name',
    topic: 'privacy',
    q: 'Can my PGP key show my name?',
    a: 'Yes. Most PGP keys carry a name or email, and X2F keeps your public key as you gave it. If you want to stay private, use a key made without your real name or email. Your profile never shows the key or its fingerprint, and a signed record you save carries the fingerprint only if you tick it.',
    sources: [
      `${SPEC}:211 v4 keys, which are most keys in use, are stored whole`,
      'apps/api/src/reputation/profile.ts:23-24 PGP fingerprint',
      `${WEB}/profile/profileCopy.ts:83-84 Off unless you tick it.`,
      `${WEB}/profile/profileCopy.ts:91 The copy on your profile never lists a PGP fingerprint.`,
    ],
  },
  {
    id: 'who-sees-profile',
    topic: 'privacy',
    q: 'Who can see my profile?',
    a: 'Anyone signed in to X2F can open your profile at /u/ followed by your display name, except a trader you blocked. It shows when you joined and whether you are online, your completed trades, your typical payment time, disputes won and lost, how much XMR you have traded if you chose to show it, your reviews with only their month and year and never who left them, the badges you show, and "Account protected with PGP" unless you hide that badge. You can also make a signed record of your trades under Settings: it stays private unless you show it on your profile, and only a copy you save can carry your PGP fingerprint, if you tick it.',
    sources: [
      'apps/web/src/App.tsx:280 path="/u/:name"',
      'apps/api/src/reputation/profile.ts:16-17 only a set-up trader (or a member of',
      'apps/api/src/reputation/profile.ts:19-20 a trader who blocked the viewer',
      `${WEB}/profile/Profile.tsx:9-13 Reviews show month and year`,
      `${WEB}/profile/profileCopy.ts:32 Disputes: none`,
      `${WEB}/profile/Profile.tsx:116 label={C.typical}`,
      `${WEB}/profile/Profile.tsx:121-123 C.traded(p.tradedOverXmr)`,
      'apps/api/src/reputation/profile.ts:23-24 opt-in rounded lines',
      'apps/api/src/reputation/profile.ts:58-59 pgpProtected',
      `${WEB}/profile/Record.tsx:5-7 optionally`,
      `${WEB}/profile/profileCopy.ts:83-84 Include my PGP fingerprint`,
      `${WEB}/profile/profileCopy.ts:91 The copy on your profile never lists a PGP fingerprint.`,
    ],
  },
  {
    id: 'terms-signature',
    topic: 'privacy',
    q: 'Who sees the signature I gave for the Terms?',
    a: 'Nobody else. It is stored sealed with your account and never shown to other traders.',
    sources: ['apps/api/src/termsSignature.ts:12 It is never shown to other users', 'apps/api/src/termsSignature.ts:29 At rest it is sealed'],
  },
  {
    id: 'closed-account-data',
    topic: 'privacy',
    q: 'What happens to my details when my account closes after 60 days?',
    a: 'Your PGP keys are deleted, so you can use the same key on a new account, and the signature you gave for the Terms is erased. Your username and display name stay taken.',
    sources: ['apps/api/src/accountInactivity.ts:24-25 keys are deleted so the person can reuse one', 'apps/api/src/accountInactivity.ts:82 terms_signature = null', 'apps/api/src/termsSignature.ts:7 erased when the account closes', 'apps/api/src/accountInactivity.ts:36 INACTIVE_MS'],
    facts: ['inactiveDays'],
  },

  // ---- Fees ------------------------------------------------------------------------------------
  {
    id: 'who-pays-fee',
    topic: 'fees',
    q: 'Who pays the X2F fee?',
    a: 'The vendor who posted the offer pays 1% of the trade amount. The trader who takes the offer pays no X2F fee.',
    sources: ['packages/core/src/fees.ts:9 X2F_FEE_BPS', `${T}/money.ts:125 sellerFundsAtomic: a.amountAtomic +`, `${WEB}/settings/accountTypeCopy.ts:19 You pay no fee`],
    facts: ['feePercent'],
  },
  {
    id: 'fee-vendor-sells',
    topic: 'fees',
    q: 'How is the fee paid when the vendor sells?',
    a: 'The vendor puts the trade amount plus 1% into the escrow. The buyer receives the trade amount less the Monero network fee, because whoever receives the trade\'s XMR pays that fee.',
    sources: [`${T}/money.ts:125 a.poster === 'seller' ? feeAtomic`, `${T}/payouts.ts:78 const toBuyer`, `${T}/payouts.ts:6-7 bears the network fee`, 'packages/escrow/src/verify.ts:177 i === 0 ? p.amountAtomic - fee'],
    facts: ['feePercent'],
  },
  {
    id: 'fee-vendor-buys',
    topic: 'fees',
    q: 'How is the fee paid when the vendor buys?',
    a: 'The seller puts the trade amount into the escrow. The vendor receives the trade amount minus 1%, and less the Monero network fee, because whoever receives the trade\'s XMR pays that fee.',
    sources: [`${T}/money.ts:125 sellerFundsAtomic`, `${T}/payouts.ts:78 f.amountAtomic - f.feeAtomic`, `${T}/payouts.ts:6-7 bears the network fee`, 'packages/escrow/src/verify.ts:177 i === 0 ? p.amountAtomic - fee'],
    facts: ['feePercent'],
  },
  {
    id: 'fee-when',
    topic: 'fees',
    q: 'When is the fee taken?',
    a: 'When a trade completes, as the XMR leaves the escrow. A cancelled or refunded trade pays no X2F fee: everything in the escrow goes back to the seller, less the Monero network fee.',
    sources: [`${T}/payouts.ts:74-83 case 'release':`, `${T}/payouts.ts:85-92 Every refund`, `${T}/payouts.ts:6-7 bears the network fee`, 'packages/escrow/src/verify.ts:177 i === 0 ? p.amountAtomic - fee'],
  },
  {
    id: 'fee-dispute',
    topic: 'fees',
    q: 'Is there a fee when a moderator rules?',
    a: 'If the ruling releases the XMR to the buyer, the trade completes and the vendor pays the 1%. If everything goes back to where it came from, there is no X2F fee. While an appeal is open, the fee waits for its outcome.',
    sources: ['packages/staff/src/dispute.ts:309-310 release-to-buyer', 'packages/staff/src/dispute.ts:318 return \'waits\';', `${T}/payouts.ts:29-32 'dispute-buyer'`],
    facts: ['feePercent'],
  },
];

/** Every question with the answer for a build with (`proofOn`) or without the proof upload. */
export function libraryQuestions(proofOn: boolean): readonly HelpQuestion[] {
  return ENTRIES.map((e): HelpQuestion => {
    if (!('proofUpload' in e)) return e;
    const { id, topic, q, proofUpload } = e;
    return { id, topic, q, ...(proofOn ? proofUpload.on : proofUpload.off) };
  });
}

/** The questions whose answer follows the proof-upload flag, with both answers (for the tests). */
export const FLAGGED_QUESTIONS: readonly FlaggedQuestion[] = ENTRIES.filter((e): e is FlaggedQuestion => 'proofUpload' in e);

/** Every question as this build answers it (proof/flag.ts `proofUploadOn`, read once at load). */
export const QUESTIONS: readonly HelpQuestion[] = libraryQuestions(proofUploadOn());
