// The gift-card rules' words (J-17; owner G50-G52 of 7 Nov, F13, T-081). Every sentence here is a
// COPY-UNSIGNED placeholder: design writes the in-app gift-card rules text (J-31, T-058; owner G52
// "turn to designer to find out how to word all that"). The keys and which side sees which come
// from @x2f/trade giftCards.ts; when design's words land, bump GIFT_CARD_TERMS_VERSION there.
import {
  GIFT_CARD_CHECK_MIN,
  GIFT_CARD_MAX_AGE_DAYS,
  type GiftCardEvidenceKey,
  type GiftCardRole,
  type GiftCardTermKey,
} from '@x2f/trade';

// DESIGN: wording (all of this file). COPY-UNSIGNED
export const GIFT_CARD_COPY = {
  /** True until design signs the words (a test pins it, so signing is a deliberate change). */
  unsigned: true,
  termsTitle: 'Gift card terms',
  termsHint: 'Tick each one to go on.',
  evidenceTitle: 'Evidence to keep',
  evidenceHint: 'If anything goes wrong, a moderator looks at these.',
  rangeCardOnly: 'For a range card, like a Visa 200 to 500',
  videoComing: 'Video upload is coming.',
} as const;

const SENDER: Record<string, string> = {
  'bought-within-30-days': `The card was bought in the last ${GIFT_CARD_MAX_AGE_DAYS} days.`,
  'full-written-value':
    'The card holds the full value written on it. A range card, like a Visa 200 to 500, may hold part of its range, and then I send a video of me logging in to it.',
  'country-currency': "The card is from this offer's country, in that country's currency.",
  'check-window': `The other trader has ${GIFT_CARD_CHECK_MIN} minutes to check the card once I hand over its details.`,
};

const CHECKER: Record<string, string> = {
  'check-window': `I check the card within ${GIFT_CARD_CHECK_MIN} minutes of getting its details.`,
  'check-before-release': "I check the card's balance myself before I release.",
  'country-currency': "The card is from this offer's country, in that country's currency.",
};

const EVIDENCE: Record<GiftCardEvidenceKey, string> = {
  receipt: 'The receipt, showing the day the card was bought',
  'card-photo': 'A photo of the card, showing the value written on it',
  'login-video': 'A video of you logging in to the card right before you send it',
  'check-result': 'What you saw when you checked the card',
};

/** The tick box's words for `role`; '' for a key that side never sees. */
export function giftCardTermText(role: GiftCardRole, key: GiftCardTermKey): string {
  return (role === 'sender' ? SENDER : CHECKER)[key] ?? '';
}

export function giftCardEvidenceText(key: GiftCardEvidenceKey): string {
  return EVIDENCE[key];
}
