// The BuyerPay and Desktop boards' example trade (design/x2f-app/BuyerPay.dc.html,
// Desktop.dc.html) as a TradeView, for the Task 23 harness (payHarness.tsx) and e2e/pay.harness.ts.
// Only fixture builds and e2e specs import this file; a production bundle never contains it
// (apps/web/test/bundle.test.ts). Times are relative to `serverNow`.
import type { TradeView } from '../screens/trade/payTypes.js';
import { BOARD_METHOD, BOARD_TRADE } from './boards.js';

/** The server's "now" in every pay fixture. */
export const PAY_NOW = '2026-10-25T12:00:00.000Z';
const at = (min: number) => new Date(Date.parse(PAY_NOW) + min * 60_000).toISOString();

/** Task 3's Zelle profile, plus the method name the view does not carry yet (paySeams.ts `methodOf`). */
export const PAY_PROFILE = {
  id: BOARD_METHOD.id,
  name: BOARD_METHOD.name,
  whatItIs: BOARD_METHOD.whatItIs,
  landsIn: "your bank account, checked in your bank's app",
  checkPrompt: "Open your bank's app and check that the payment arrived in your account.",
  arrival: 'instant',
  confirmWindowMin: 120,
  fields: [
    { key: 'recipient', label: 'Email or US phone number', kind: 'email-or-phone' },
    { key: 'name', label: 'Name on the account', kind: 'text' },
  ],
} as const;

/** "Zelle to [SELLER ZELLE ID]" (both boards). */
export const PAY_DETAILS = [{ label: `${BOARD_METHOD.name} to`, value: '[SELLER ZELLE ID]' }];

/** The BuyerPay board: mira.k buys from satoshi_ghost; the escrow is securing, "3 of 10 · about 14 min". */
export const PAY_SECURING: TradeView = {
  code: BOARD_TRADE.code,
  role: 'buyer',
  poster: 'seller',
  state: 'securing',
  // Desktop board: "412 trades · 99% positive · releases in ~6 min", Trusted, Fast.
  counterparty: { displayName: BOARD_TRADE.seller, completedTrades: 412, online: true, lastSeenAt: at(-1), typicalMinutes: 6, positivePct: 99, badges: ['Trusted', 'Fast'], stage: 'graduated' },
  methodId: BOARD_METHOD.id,
  profile: PAY_PROFILE,
  amountAtomic: BOARD_TRADE.amountAtomic.toString(),
  fiatCents: BOARD_TRADE.fiatCents.toString(),
  lockedRate: { currency: BOARD_TRADE.currency, centsPerXmr: BOARD_TRADE.rateCentsPerXmr.toString() },
  maxFiatCents: '150000',
  grown: null,
  receivedAtomic: BOARD_TRADE.amountAtomic.toString(),
  confirmations: 3,
  releasable: false,
  releasableEtaMin: 14,
  funding: null,
  extensions: 0,
  cancelProposedBy: null,
  settling: null,
  dispute: null,
  txHash: null,
  takenAt: at(-40),
  setupBy: null,
  fundBy: null,
  fundingSeenAt: at(-6),
  securedAt: null,
  payBy: null,
  paidAt: null,
  confirmBy: null,
  finalAlertAt: null,
  finalAlertSeenAt: null,
  settleBy: null,
  releaseClaimedAt: null,
  pausedAt: null,
  closedAt: null,
  nextDeadline: null,
  serverNow: PAY_NOW,
};

/** The Desktop board: escrow secured, "You pay · 62 min left". */
export const PAY_SECURED: TradeView = {
  ...PAY_SECURING,
  state: 'secured',
  confirmations: 12,
  releasable: true,
  releasableEtaMin: 0,
  securedAt: at(-28),
  payBy: at(62),
  nextDeadline: at(62),
};

/** The Desktop board's chat (Task 20's ChatPanel stands here in the harness). */
export const PAY_CHAT = {
  // The spec 6.6 notice (Task 20 changes the Desktop board's older wording; parity.ts KNOWN_EXCEPTIONS).
  notice: 'Chats are encrypted. If a dispute is opened, a moderator can read this conversation.',
  messages: [
    { from: 'them', text: `Escrow is funded. Send via ${BOARD_METHOD.name} with ${BOARD_TRADE.code} in the memo please.` },
    { from: 'me', text: 'On it, sending now.' },
  ],
} as const;
