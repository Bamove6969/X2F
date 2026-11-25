/**
 * The offer card's words for a poster that the sign-up's trader card preview also shows (review of
 * wip/lead-note-196, owner demo note #199): the amber New badge a member wears until Graduated, and
 * the trade count. In their own module so the setup screens take them without OfferCard's CSS.
 */
import type { IconName } from '../../ui/icons.js';

export interface BadgeInfo {
  label: string;
  icon: IconName;
  tone: 'escrow' | 'caution';
  meaning: string;
}

export const NEW_BADGE: BadgeInfo = { label: 'New', icon: 'sprout', tone: 'caution', meaning: 'new to X2F, still on starter limits' };

/** The word after a completed-trade count on the card: "1 trade", "0 trades", "212 trades". */
export function tradesWord(n: number): 'trade' | 'trades' {
  return n === 1 ? 'trade' : 'trades';
}
