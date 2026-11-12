// My trades (register D-005): the words of a trade row. No board yet (the Desktop board left its
// "My trades" card out until the list existed): every line here is lead wording until the owner
// signs it off (COPY-UNSIGNED), and the look is the kit's until design restyles it (DESIGNER-REVIEW).
import { formatFiat, formatXmr } from '@x2f/trade';
import type { TradeState } from '../../api/trade.js';
import type { IconName } from '../../ui/icons.js';
import type { Tone } from '../../ui/StatusChip.js';
import { formatDateTime } from '../../ui/dates.js';
import type { TradeListItem, TradeListStatus } from './api.js';

export const TRADES_TITLE = 'My trades'; // COPY-UNSIGNED

/** The two tabs, in order. COPY-UNSIGNED */
export const TAB_LABEL: Readonly<Record<TradeListStatus, string>> = { open: 'Open', completed: 'Completed' };

/**
 * The tones a row may take: never the moderator's (spec 6.6: that look stays on the dispute screens;
 * re-verify trades-list B2), so the row draws each with a literal (Trades.tsx `StateChip`).
 */
export type RowTone = Extract<Tone, 'caution' | 'escrow' | 'neutral'>;

/** A state as a chip: a word, a tone and an icon (StatusChip: never colour alone). COPY-UNSIGNED, DESIGNER-REVIEW (tones). */
export const STATE_LABEL: Readonly<Record<TradeState, { text: string; tone: RowTone; icon: IconName }>> = {
  setup: { text: 'Setting up', tone: 'caution', icon: 'clock' },
  funding: { text: 'Waiting for escrow', tone: 'caution', icon: 'clock' },
  securing: { text: 'Escrow confirming', tone: 'caution', icon: 'clock' },
  secured: { text: 'Escrow secured', tone: 'escrow', icon: 'shield-check' },
  paid: { text: 'Paid, waiting for release', tone: 'caution', icon: 'clock' },
  settling: { text: 'Releasing', tone: 'escrow', icon: 'shield-clock' },
  released: { text: 'Completed', tone: 'escrow', icon: 'check-circle' },
  refunded: { text: 'Refunded', tone: 'neutral', icon: 'undo' },
  lapsed: { text: 'Expired', tone: 'neutral', icon: 'clock' },
  cancelled: { text: 'Cancelled', tone: 'neutral', icon: 'close' },
  disputed: { text: 'In dispute', tone: 'caution', icon: 'alert' },
};

/** "Buying 1.250000 XMR" / "Selling 1.250000 XMR": the caller's side and the amount. COPY-UNSIGNED */
export function sideLine(t: Pick<TradeListItem, 'role' | 'amountAtomic'>): string {
  return `${t.role === 'buyer' ? 'Buying' : 'Selling'} ${formatXmr(t.amountAtomic)} XMR`;
}

/** "$412.50": the trade's fiat total in its own currency. */
export function fiatLine(t: Pick<TradeListItem, 'fiatCents' | 'currency'>): string {
  return formatFiat(t.fiatCents, t.currency);
}

/** "Ended 1 Nov 2026, 12:15 UTC" once closed, else "Started …" (the take). COPY-UNSIGNED */
export function whenLine(t: Pick<TradeListItem, 'takenAt' | 'closedAt'>): string {
  return t.closedAt !== null ? `Ended ${formatDateTime(t.closedAt)}` : `Started ${formatDateTime(t.takenAt)}`;
}

/** An empty tab. COPY-UNSIGNED */
export const EMPTY: Readonly<Record<TradeListStatus, { title: string; text: string }>> = {
  open: { title: 'No open trades', text: 'Trades you start or that start on your offers show here until they end.' },
  completed: { title: 'No completed trades', text: 'Trades show here once they end, until X2F deletes them.' },
};

export const LOAD_FAILED = 'Your trades could not be loaded.'; // COPY-UNSIGNED
export const RETRY = 'Try again'; // COPY-UNSIGNED
export const SHOW_MORE = 'Show more'; // COPY-UNSIGNED
