/**
 * The Terms of Service text shown in the Terms screen's scroll box, under the SetupTerms board's
 * headings. The final text waits for the lawyer (plan Task 28, Revision 2026-10-15 "Terms board").
 * Where the board has a "[TERMS TEXT: …]" placeholder, this draft states the product's own rules
 * from the spec instead (KNOWN_EXCEPTIONS.SetupTerms in e2e/parity.ts), so the screen says
 * something true; the board's own sentences (the key points, section 7) are kept word for word,
 * except where the owner reworded them (demo notes 13 Nov: section 7's "a government agency").
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
// 2026-11-14: the owner's demo notes of 13 Nov (comms owner-demo-notes-2026-11-13.jsonl, screen
// setup-terms) applied in his words, tidied for grammar and spelling only. COPY-UNSIGNED.
// 2026-11-23: the owner's demo notes of 16-17 Nov (#93, #102-#107, screen setup-terms) applied in his
// words, tidied for grammar only. The #92 legal pass applied nothing: every suggestion beyond his
// words is a proposal in docs/terms-legal-review-2026-11-23.md, waiting on him. COPY-UNSIGNED.
// 2026-11-25: the owner's demo notes of 23 Nov (#114-#123) and 25 Nov (#177-#185, screen setup-terms)
// applied in his words, tidied for grammar only. COPY-UNSIGNED.
// 2026-11-25b: owner demo note #189 (25 Nov): section 7 is his note #184 paragraph, section 6 names
// the uploads' metadata, and the key points are six one-liners (drafts awaiting his OK). One version
// move for the whole note. COPY-UNSIGNED.
// 2026-11-25b also carries owner demo note #203 (25 Nov, section 1): "X2F is a meeting place." in place of
// "X2F is a facilitator.", and note #204: "allows them to interact" for "lets them interact", note #206: "X2F is not party to your trades", note #207 (section 2): "private user ID", and note #209 (section 2): the active-trade exception, "Blockchain" lower-cased as elsewhere, note #210 (section 3): "under what conditions", and note #211 (section 3): "being lost or confused or from being taken", note #212 (section 7): the lawyer placeholder removed, note #213 (section 8): security or site policies, note #214: "protect the site and our users", note #215: the escrow-settling sentence removed from the account-closure paragraph, and note #216: the risks sentence in his words ("valuev etc.... and more" tidied to "value, and more"), note #217: "to play a role in the shaping of the future of X2F", note #218: the closing line about re-accepting removed, and note #222: the top lawyer placeholder removed; 25b was never released, so the label stays. COPY-UNSIGNED.
// 2026-11-25c: the owner's full-length Terms, word for word (25 Nov, in chat after demo note #223). COPY-UNSIGNED.
export const TERMS_TEXT_VERSION = '2026-11-25c';

/**
 * A paragraph of the text, or a paragraph followed by a bulleted list (owner demo notes 13 Nov,
 * setup-terms: "add this in bullet form").
 */
export type TermsParagraph = string | { text: string; bullets: readonly string[] };

/** A paragraph's own words, without its bullets. */
export function paragraphText(p: TermsParagraph): string {
  return typeof p === 'string' ? p : p.text;
}

export interface TermsSection {
  heading: string;
  paragraphs: TermsParagraph[];
}

/** The board's note above the text, until the lawyer's text replaces the draft. */
/** Owner demo note #222 (25 Nov): the lawyer placeholder at the top is gone ("Get rid of this too"); empty shows nothing. */
export const TERMS_DRAFT_NOTE = '';

/** The board's key points, shown above the full text. */
export const KEY_POINTS: readonly string[] = [
  // COPY-UNSIGNED: draft one-liners for owner demo note #189 (25 Nov), replacing notes #109-#185's
  // longer points; awaiting his OK.
  'X2F never holds your XMR: it sits in a 2-of-3 multisig escrow, and any two of the buyer, the seller and X2F must agree to move it.',
  'Whoever posts the ad pays a 1% fee when the trade completes. Taking an ad is free.',
  'Moderators step in only when asked. Opening a dispute lets that moderator decrypt the trade and its chat.',
  'Trades without a dispute are deleted after 30 days. Disputed trades are scrubbed and deleted after 90.',
  'We never track you: no IP addresses, email, phone numbers or device details are logged or stored.',
  'An account not signed into for 60 days or longer is closed automatically.',
];

/** The heading of the section the tick box's "Privacy Policy" points at. */
export const PRIVACY_HEADING = '6. Privacy and data';

export const TERMS: TermsSection[] = [
  // Owner, 25 Nov 2026 (in chat, after demo note #223): the whole full-length Terms replaced with his
  // "updated modern version", word for word. Earlier per-note history is in git. COPY-UNSIGNED.
  {
    heading: "1. What X2F is",
    paragraphs: [
      "X2F is a peer-to-peer marketplace where privacy-focused individuals and groups can buy and sell Monero (XMR) directly with one another using cash, bank transfers, or their preferred payment apps. X2F simply provides the venue, built-in 2-of-3 multisig escrow, and moderator dispute resolution to help trades happen safely. X2F is not a party to your trades, is not a bank, exchange, or money services business, and never holds custody of your funds.",
    ],
  },
  {
    heading: "2. Your account",
    paragraphs: [
      "You need an account to trade or post an ad. Because X2F is built for privacy, we never ask for an email address or phone number. Instead, you create a private user ID (used only to log in) and a public display name that other traders see.",
      // not-a-refusal: Terms text that explains how X2F works, not a rule the reader ran into
      "Keep your login credentials and recovery codes secure. While your XMR stays in your own wallet—or locked in on-chain 2-of-3 multisig escrow during an active trade—your account age and reputation cannot be restored if you lose access. X2F cannot reset your credentials for you.",
      "One person, one account. Do not sell, share, or lend your login. If you operate with a team, add them as team members so each person has their own separate credentials. Accounts that remain inactive (not signed into) for 60 days or longer are closed automatically.",
    ],
  },
  {
    heading: "3. Trades and escrow",
    paragraphs: [
      "X2F holds one of the three keys in a trade’s 2-of-3 multisig escrow and can never move funds on its own. Because escrow settlements are standard Monero transactions, amounts and addresses remain private on the blockchain.",
      "You choose whom to trade with and under what terms—always read a vendor's conditions before accepting an offer. Only the seller funds the escrow, which commits them to the trade. The buyer must then pay using the exact method requested, upload proof of payment if required, and mark the trade as paid.",
      // not-a-refusal: Terms text that explains how X2F works, not a rule the reader ran into
      "Screenshots are helpful, but they can be forged. Sellers must verify that funds have actually arrived in their own account before releasing escrow. Marking a trade complete automatically sends the XMR to the buyer’s external wallet, minus X2F’s 1% fee. Once XMR is released from escrow, the blockchain transaction is irreversible—if a dispute is opened afterward, moderators can review the case and take action against a bad actor's account, but X2F cannot pull back funds already sent to an external wallet.",
      {
        text: "Every trade has a countdown timer displayed on the trade screen based on the chosen payment method. If the timer expires before the buyer marks the trade paid, the seller can cancel the trade and reclaim their escrowed XMR. If you are running close to the deadline:",
        bullets: [
          // not-a-refusal: Terms text that explains how X2F works, not a rule the reader ran into
          "Complete the payment and mark the trade paid before the clock runs out so the trade cannot be canceled.",
          "Message the other trader immediately if there is a delay so they know you are active.",
          "Use the audio \"nudge\" feature if the other trader is unresponsive.",
        ],
      },
      // not-a-refusal: Terms text that explains how X2F works, not a rule the reader ran into
      "If you send payment after the timer expires and the seller cancels the trade—and you cannot resolve it between yourselves—open a dispute so a moderator can review the payment proof and mediate a fair resolution.",
    ],
  },
  {
    heading: "4. Fees",
    paragraphs: [
      "X2F charges a 1% fee in XMR on completed trades. Whoever posts the ad pays the fee, which is deducted automatically when the trade finishes—if a trade doesn't complete, or if a moderator fully reverses it, X2F collects nothing. Whether you post an ad to buy or to sell, the 1% fee applies to the ad creator; responding to someone else's ad is always free. Standard Monero network transaction fees apply as shown on the trade screen and are not set by X2F.",
    ],
  },
  {
    heading: "5. Disputes and moderators",
    paragraphs: [
      // not-a-refusal: Terms text that explains how X2F works, not a rule the reader ran into
      "If a trade goes wrong and you cannot resolve it directly with the other party, either trader can open a dispute during the trade or within the post-trade window shown on the trade screen.",
      // not-a-refusal: Terms text that explains how X2F works, not a rule the reader ran into
      "Trade chats are encrypted, and no IP addresses are logged even during a dispute. When a dispute is opened, the assigned moderator is granted temporary decryption access to the trade chat and evidence to review what happened. A moderator’s primary goal is to see valid trades completed, or to execute a full reversal if the trade cannot be salvaged.",
      "If either party disagrees with a ruling, they may request one appeal. A senior moderator will review the case with the same access and issue a final, binding decision. All moderator actions are logged internally for auditing and accountability.",
    ],
  },
  {
    heading: PRIVACY_HEADING,
    paragraphs: [
      "Completed trade records are accessible for 30 days, after which all trade data is permanently purged. Disputed trades are retained for up to 90 days after resolution—stripped of identifying details via our internal privacy-scrubbing tool for moderator training and auditing—and are permanently purged at the 90-day mark with no exceptions. X2F uses no analytics or tracking, logs no IP addresses, and automatically strips Exif and device metadata from uploaded payment proofs.",
    ],
  },
  {
    heading: "7. Law enforcement and legal requests",
    paragraphs: [
      // not-a-refusal: Terms text that explains how X2F works, not a rule the reader ran into
      "Because X2F is engineered around privacy-by-design, we do not collect IP addresses, plaintext chat logs, or personal identifying records. We respect the rule of law and comply with valid, binding legal orders from courts with proper jurisdiction; however, any response is strictly limited to whatever minimal, non-identifying technical data exists on our servers at that moment. Our infrastructure and operations are based in jurisdictions with strong statutory privacy protections and strict judicial standards for cross-border requests.",
    ],
  },
  {
    heading: "8. Prohibited use",
    paragraphs: [
      "Do not use X2F to launder proceeds of crime, obscure illicit funds, violate anti-money-laundering or counter-terrorist-financing (AML/CFT) laws, or break any applicable laws in your jurisdiction.",
      "Do not defraud, threaten, or mislead other users, and never take trades or negotiations off-platform—doing so forfeits all escrow and dispute protections. Do not attempt to bypass X2F’s security controls, disrupt the service, or exploit platform rules.",
      "X2F reserves the right to pause, restrict, or terminate any account at its discretion, with or without prior notice, to protect the platform and its users. If you believe an account action was made in error, you may contact a moderator for review.",
    ],
  },
  {
    heading: "9. Disclaimers, changes and governing law",
    paragraphs: [
      "X2F is provided \"as is\" and \"as available.\" Peer-to-peer cryptocurrency trading carries inherent risks, including counterparty fraud and XMR price volatility—never trade more than you can afford to lose.",
      "Because X2F is an evolving platform, we may update these Terms from time to time. When we do, we will highlight the changes and ask you to review and accept them before continuing to use the service.",
    ],
  },
];
