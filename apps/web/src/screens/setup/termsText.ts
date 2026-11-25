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
export const TERMS_TEXT_VERSION = '2026-11-23';

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
export const TERMS_DRAFT_NOTE = "[Placeholder: the final text comes from X2F's lawyer.]";

/** The board's key points, shown above the full text. */
export const KEY_POINTS: readonly string[] = [
  // Owner demo note #115 (23 Nov, on this key point): his explanation added after it, in his words;
  // "The coins sit are held" tidied to "The coins are held". COPY-UNSIGNED.
  // Owner demo notes #177 and #178 (25 Nov): first sentence, "Your coins" and "agree and" in his words. COPY-UNSIGNED.
  'X2F is never in possession of your cryptocurrency (XMR). Your coins are held directly on the blockchain inside a special smart address (a multisig address) that is mathematically locked by three separate private keys: one held by the buyer, one by the seller, and one by X2F (the mediator). To move the coins out of that address, any two of those three keys must agree and cryptographically sign off on the transaction.',
  // Owner demo note #116 (23 Nov, on this key point), his words. COPY-UNSIGNED.
  // Owner demo note #179 (25 Nov): "on X2F" added, his words. COPY-UNSIGNED.
  'If you post an ad, whether to sell or buy on X2F, you pay a 1% fee when the trade completes. Traders who just click on ads and engage in trades pay no fees.',
  // Owner demo note #118 (23 Nov): a new point between the fee and the chat ones, his words; a comma
  // and "if" added for grammar. COPY-UNSIGNED.
  // Owner demo note #180 (25 Nov): "trade intervention", not "site". COPY-UNSIGNED.
  'Moderators are at your disposal if something goes wrong, if you feel the need for trade intervention, or just to make sure a trade ends smoothly.',
  // Owner demo note #117 (23 Nov, on this key point), his words. COPY-UNSIGNED.
  // Owner demo note #181 (25 Nov), his words; "mod" written "moderator" and "&" as "and". COPY-UNSIGNED.
  'Moderators can read your trade chat only if their presence is requested and a dispute is opened, which gives that particular moderator the ability to unlock and decrypt the trade and have full access to all communications that have transpired so far.',
  // Design 9 Nov (p11-9, canvas v161; owner 8 Nov 30/90 ruling): two lines in place of
  // "Dispute records are kept for 30 days." COPY-UNSIGNED.
  // Owner demo note #119 (23 Nov, on this key point), his words. COPY-UNSIGNED.
  // Owner demo note #182 (25 Nov): "all trades that have no disputes", his words. COPY-UNSIGNED.
  'To adhere to our privacy policy and to maintain strong confidentiality, all trades that have no disputes will be deleted on the 30th day after completion.',
  // Owner demo note #120 (23 Nov, on this key point), his words. COPY-UNSIGNED.
  'Disputed trades will be kept up to 90 days, but first scrubbed by our in-house privacy tool to remove any personal and confidential information, and then used to train our moderators. They are deleted on the 90th day.',
  // Owner demo note #121 (23 Nov, on this key point), his words. COPY-UNSIGNED.
  'We don’t track you. We never log or save your IP address, location, device details, email, or phone number. You stay completely anonymous, and there is no personal data on our servers to leak or share.',
  // Owner demo note #102 (17 Nov, f0aabdaf, on this key point): "... with what very little information
  // we collect." COPY-UNSIGNED
  // Owner demo note #122 (23 Nov, on this key point): his paragraph in place of the #102 line. COPY-UNSIGNED.
  // not-a-refusal: Terms text
  'Our zero-log architecture is designed so that we do not collect or retain IP addresses, message contents, or personal identifying records. While we comply with valid, binding legal orders from courts of competent jurisdiction, any disclosure is strictly limited to the minimal, non-identifying operational data technically present on our servers at the time of the request. Furthermore, our corporate entity and server infrastructure are domiciled in privacy-focused jurisdictions with strong statutory data-protection laws and rigorous judicial standards for cross-border legal requests.',
  // S-043 (owner p4-6, build spec j33a section 1, 9 Nov): the 60-day rule, last, saying why. COPY-UNSIGNED
  // Owner demo note #123 (23 Nov, on this key point), his words. COPY-UNSIGNED.
  'X2F is built as a lasting community, for people who trade regularly, so an account not signed into for 60 days is closed automatically.',
];

/** The heading of the section the tick box's "Privacy Policy" points at. */
export const PRIVACY_HEADING = '6. Privacy and data';

export const TERMS: TermsSection[] = [
  {
    heading: '1. What X2F is',
    paragraphs: [
      // COPY-UNSIGNED: owner demo notes 13 Nov, his opening and the draft's married ("find a way to
      // marry them without overlap"). Owner demo note #93 (16 Nov, e596a8e5 and his reply 150862d3): a
      // period after "with each other", and the next sentence starts "Here they can exchange their".
      'X2F is a place where like-minded, privacy-focused individuals or groups come together to trade Monero (XMR) with each other. Here they can exchange their hard-earned XMR for cash, bank transfers or the payment app that suits them, or, vice versa, buy XMR and pay for it in the way that is easiest or most convenient for them. X2F is a facilitator. It just brings those people together and lets them interact safely and securely, with a built-in escrow system and moderators to resolve disputes if one should ever happen. It is not a party to your trades, it is not a bank or an exchange, and it never holds your coins.',
    ],
  },
  {
    heading: '2. Your account',
    paragraphs: [
      // COPY-UNSIGNED: owner demo notes 13 Nov.
      'You need an account to trade or post an ad, but with X2F being completely privacy-focused, you are never asked for an email address or a phone number.',
      // COPY-UNSIGNED: owner's /setup comment 9fe3fa43 (12 Nov, "Public display name"); the names
      // the setup screens use (username private, display name public). Terms draft 2026-11-12 item 1.
      // From "Keep your": owner demo notes 13 Nov.
      'You pick a private username, which you type to log in and only you see, and a public display name, which is how other traders see you. Keep your login details and recovery codes safe and private. While your wallet and funds may be secure, your account age and reputation are irreplaceable. X2F has no way to reset them for you, so if you lose them you may lose the account without a way to recover it, but we provide you with ample, highly secure methods to protect the sanctity of your account. Your coins stay safe in your own wallet either way.',
      // COPY-UNSIGNED: owner's comment 4e04a245 (team members are allowed). Draft item 2.
      'One person, one account. If you want others to help you trade, set them up as team members of your account: each team member gets their own login. Do not sell, share or lend your account or your own login.',
    ],
  },
  {
    heading: '3. Trades and escrow',
    paragraphs: [
      // COPY-UNSIGNED: the last sentence answers the owner's comment e79231ba (lead call, draft Q-1).
      'Your coins stay in your own wallet, except while they are locked in a trade’s 2-of-3 escrow. X2F holds one of the three escrow keys and can never move coins on its own. Escrow payments are ordinary Monero transactions, so amounts and addresses stay hidden on the blockchain.',
      // COPY-UNSIGNED: from "Read the": owner demo notes 13 Nov.
      'You decide whom you trade with and on what terms. Read the vendor’s terms before you take an offer. Buyer and seller beware. Educating yourself on how everything works will help keep you from ever being disadvantaged or, hopefully, from being taken advantage of, but regardless, our moderators are here to see that fair endings = happy endings.',
      // COPY-UNSIGNED: owner's comment ca2b6a83 ("disrupted" read as "disputed"; draft item 4, Q-3);
      // from "instantly undone": owner demo notes 13 Nov. Owner demo notes #103-#105 (17 Nov, 3b5808fc,
      // 8889fe12, 001b37f2): a period after "requested", his proof sentence, his seller sentence and
      // his transfer sentence, in place of the draft's "posts proof ... releases the XMR, which goes
      // straight to the buyer's own wallet".
      // not-a-refusal: Terms text
      'Only the seller funds the escrow, and funding it is a commitment to the trade. The buyer pays exactly as the trade says, with the payment method that was requested. A buyer will also be requested to post proof of their payment for extra reassurance and then mark the trade paid once the payment is complete. The seller then checks their account, or whichever method they chose to get paid by, and only after confirming with their own eyes that they have received the payment do they mark the trade completed. Marking a trade complete automatically transfers the XMR to the buyer’s off-site wallet, minus the 1% fee paid to X2F. A release cannot be instantly undone, but it can be disputed and the funds recovered, to the best of our abilities, for the slighted party. Hopefully the moderator will end the trade amicably and it will end as a normal trade, but in the event things aren’t so straightforward, our team is here to help.',
      // COPY-UNSIGNED: owner's comment aaf06c2f. Draft item 5.
      'A screenshot counts as proof, but it is not a guarantee: anything can be edited these days. Always check that the payment has arrived in your own account before you release the escrow.',
      // COPY-UNSIGNED: owner's comment 7a830826; the 2 hours is his example, not a set time (p11-29
      // research pending); the refund starts at once (10 confirmations); the late-buyer sentence is
      // p11-18 (lead call, draft Q-5 to Q-7).
      // Owner demo notes 13 Nov: his ending of the example, his cancel sentence and his bullets; the
      // late-buyer sentence becomes the last bullet ("add this in bullet form").
      {
        text: 'Each trade has timers, and they are based on the payment method chosen. For example, if a payment method is usually instant but can take up to 2 hours, the buyer gets 2 hours to mark the trade paid using the payment method requested. If the allotted time has run out, whoever started the trade can immediately cancel and receive the funds from escrow deposited back into their account. If the clock has nearly run out, always make sure to:',
        bullets: [
          'Send the payment as requested and mark it paid, preventing any ability for the other party to cancel when the time has run out.',
          'Communicate with the other trader and let them know you may be delayed in sending, so as to prevent them from having their fingers on the cancellation button at the first opportunity they get.',
          'Stay in contact with them and respond when reached out to, or, if you are the one not getting a response, feel free to send an audio cue, what we like to call a “nudge”, to grab their attention.',
          // Owner demo note #106 (17 Nov, d1e42dcc, on this bullet): his sentence in place of "If you
          // paid late and the seller cancels, open a dispute and we will help you get your money
          // back."; the draft's last sentence (the time left) is kept.
          // not-a-refusal: Terms text
          'If for some reason you don’t pay until after your allotted time runs out, the seller triggers a cancellation that automatically refunds the XMR to the seller, and you can’t figure it out amicably between yourself and the other trader, then this is a scenario when you would call upon a moderator to help settle the dispute, whether that means seeing the XMR transferred to you or a refund of the payment you made. The outcome will always be fair. The trade screen always shows the time left.',
        ],
      },
    ],
  },
  {
    heading: '4. Fees',
    paragraphs: [
      // COPY-UNSIGNED: owner's comment 10475770; the poster pays 1% (p10-1), taking is free, no fee on
      // a full reversal (g63). Draft item 7. Reworded by the owner's demo notes 13 Nov.
      'X2F collects a fee of 1% of the total amount traded, paid in XMR when the trade completes. Whoever posts the ad is responsible for the bill, which will be automatically deducted, pending the completion of the trade. We don’t get paid unless you both do. If you post an ad to sell XMR, you pay 1% of the XMR you sell. If you post an ad to buy XMR, you pay 1% of the XMR you buy. Responding to someone else’s ad is always free, whether you are a trader or a vendor. If a moderator fully reverses a trade, there is no fee. Very simple.',
      'Monero network fees are paid as the trade screen shows. X2F does not set them.',
    ],
  },
  {
    heading: '5. Disputes and moderators',
    paragraphs: [
      // COPY-UNSIGNED: owner's comment d1c8cb70; how long after completion is the owner's (draft Q-8).
      'If something doesn’t go as planned, or you and the other trader disagree and don’t manage to sort it out yourselves, either of you can open a dispute, both during the trade and for a short time after it completes. The trade screen shows how long you have. A moderator then reads the trade and its chat, asks for evidence and decides the outcome.',
      // COPY-UNSIGNED: owner's comment 9cdeeb48; appeal access is p11-2 (lead call, draft Q-9). The
      // appeal sentence, the goal and "the same as though ...": owner demo notes 13 Nov.
      'Chats are encrypted. If a dispute is opened, the moderator assigned to it can decrypt the trade’s chat and has full access to the whole conversation and the record of what happened in the trade. If either party is not satisfied with the outcome of the dispute, an appeal can be requested, in which a senior moderator will make the final, binding decision, with the same access. We log every action our moderators take, so we can audit our own staff and make sure of the best outcome for everyone. A moderator’s goal is ultimately to see a trade through to completion. If that is not possible, the next best outcome is a full reversal of the trade, the same as though the trade never happened to begin with.',
      // COPY-UNSIGNED: owner demo notes 13 Nov ("because of the changes above we really only need to
      // say here"), in place of comment 358d1d75's paragraph.
      'An appeal can be requested only once per dispute and, as mentioned, decisions are final and binding. Our moderators are incredibly fair, and we are confident that we will find the outcome that is best for everyone.',
    ],
  },
  {
    heading: PRIVACY_HEADING,
    paragraphs: [
      // COPY-UNSIGNED: owner demo notes 13 Nov: his 30/90 wording, and "keep all of this" for the
      // tracking sentence (comment d1a46566); the old third paragraph is "now redundant".
      'X2F only provides access to completed trades for 30 days, after which the entirety of the trade is purged. The only exception to this is if there is a dispute, in which case the dispute is kept for 90 days after completion, after being scrubbed with our internal privacy tool, and used for training moderators. At the 90-day mark it is all purged, no exceptions. X2F does not track you, does not use analytics and removes location and device details from uploads.',
      'No IP addresses are logged, even in disputes.',
    ],
  },
  {
    heading: '7. Police and government requests',
    paragraphs: [
      // Owner demo note #107 (17 Nov, de4e3eea): "within the scope of the writ." after "what little
      // information we hold".
      // not-a-refusal: Terms text
      "If police or a government agency sends us a lawful request for data backed by a warrant, we will provide what little information we hold within the scope of the writ. That is exactly why we don't log IP addresses or ask for your name, phone number or email address: we can't hand over what we never collect. [Lawyer to word this.]",
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
