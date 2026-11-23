/**
 * The trader tour: "your first trade" (owner, 12 Nov 2026: the trader tour is only "how to do your
 * first trade"; design, wip/design-brief b3b8315b docs/design-12nov/tour-stops.md §2 and
 * tour-motion.md §4-5). It follows one pretend sell trade from start to finish on example screens
 * (FirstTradeStage.tsx), and the person watches the app being used.
 *
 * COPY-UNSIGNED: the 17 card texts are design's, used exactly as written (tour-stops.md §2, "must be
 * used exactly as written"). Do not edit them here; change them on the design branch first.
 *
 * The trade room (owner, 16 Nov 2026, demo note #100: the tour showed no trading window with its
 * chat): two stops after Fund, on the pretend trade's room, the two people in the chat and a few
 * lines back and forth. 19 stops in all.
 */
import type { TourDef, TourStep } from './engine.js';
import { FirstTradeStage } from './FirstTradeStage.js';

const t = (sel: string) => `[data-part="tour-stage"] [data-tour="${sel}"]`;

/** Design's 17 stops, in order (tour-stops.md §2). */
export const FIRST_TRADE_TEXT = [
  "First, decide why you're here: to buy Monero or to sell it.",
  "Let's pretend we're selling. Tap Sell.",
  'Next, pick the currency you want to be paid in.',
  'Then pick how you want to be paid.',
  "X2F hides every offer you don't qualify for yet. If a buyer only trades with people who have 10 or more completed trades, a brand-new account won't see that offer. Everything you see, you can take right now.",
  'Here are the offers open to you.',
  "Each card tells you about the trader: the badges they've earned...",
  "...how far above the market price they'll pay: this one pays 2% above market...",
  '...and the trade sizes they accept: this one takes $50 to $1,000. In other currencies we convert at the real exchange rate, with nothing added.',
  "Let's take this one. Tap the offer.",
  "Enter how much you want to sell. You'll see exactly what you get.",
  'Send your request. The buyer accepts, and the trade starts.',
  'Now lock your Monero in escrow. Scan this code with your wallet, or copy the address and amount.',
  "Once it's secured, the buyer is told to pay you. Nobody can touch the coins while the trade is open.",
  "The buyer sends $200 by Cash App and taps I've paid. Check your Cash App: only your own account proves the money arrived.",
  'Got the money? Press and hold to release. The Monero goes to the buyer.',
  "That's your first trade. Rate the buyer, and you're done. Buying works the same way, the other way round.",
] as const;

/**
 * COPY-UNSIGNED: the trade room's two cards (demo note #100), written by the lead, not by design;
 * awaiting design and the owner.
 */
export const TRADE_ROOM_TEXT = [
  'Every trade gets its own room. The chat is just for the two of you: you and the buyer.',
  'Agree the details here. The buyer says when the money is on its way, and you reply. Chats are encrypted; a moderator reads one only if a dispute is opened.',
] as const;

const at = (i: number, s: Omit<TourStep, 'id' | 'body'>): TourStep => ({ id: `first-trade-${i + 1}`, body: FIRST_TRADE_TEXT[i]!, ...s });
const room = (i: number, s: Omit<TourStep, 'id' | 'body'>): TourStep => ({ id: `trade-room-${i + 1}`, body: TRADE_ROOM_TEXT[i]!, ...s });

export const FIRST_TRADE_TOUR: TourDef = {
  id: 'first-trade',
  flow: 'story',
  label: 'First trade tour',
  endPath: '/sell',
  pages: [
    {
      id: 'find',
      name: 'Find a trade',
      path: null,
      stage: FirstTradeStage,
      steps: [
        at(0, { target: t('seg'), alternate: [t('buy'), t('sell')], placement: 'auto' }),
        at(1, { target: t('sell'), tap: t('sell'), placement: 'auto' }),
        at(2, { target: t('market'), tap: t('cur'), placement: 'auto' }),
        at(3, { target: t('methods'), tap: t('cash'), placement: 'auto' }),
        at(4, { target: null, icon: 'eye-off', placement: 'center' }),
      ],
    },
    {
      id: 'offers',
      name: 'Offers',
      path: null,
      stage: FirstTradeStage,
      steps: [
        at(5, { target: t('ohead'), placement: 'auto' }),
        at(6, { target: t('badges'), placement: 'auto' }),
        at(7, { target: t('pct'), placement: 'auto' }),
        at(8, { target: t('limits'), placement: 'auto' }),
        at(9, { target: t('offer1'), tap: t('offer1'), placement: 'auto' }),
      ],
    },
    {
      id: 'quote',
      name: 'Quote',
      path: null,
      stage: FirstTradeStage,
      steps: [
        at(10, { target: t('amount'), tap: t('field'), then: t('receive'), thenAfter: 1200, placement: 'auto' }),
        at(11, { target: t('request'), tap: t('request-button'), placement: 'auto' }),
      ],
    },
    {
      id: 'fund',
      name: 'Fund',
      path: null,
      stage: FirstTradeStage,
      steps: [
        at(12, { target: t('qr'), placement: 'auto' }),
        at(13, { target: t('status'), placement: 'auto' }),
      ],
    },
    {
      id: 'room',
      name: 'Trade room',
      path: null,
      stage: FirstTradeStage,
      steps: [
        room(0, { target: t('members'), placement: 'auto' }),
        room(1, { target: t('chat'), placement: 'auto' }),
      ],
    },
    {
      id: 'check',
      name: 'Check and release',
      path: null,
      stage: FirstTradeStage,
      steps: [
        at(14, { target: t('paid'), then: t('tick'), thenAfter: 500, placement: 'auto' }),
        at(15, { target: t('release'), placement: 'auto' }),
      ],
    },
    {
      id: 'released',
      name: 'Released',
      path: null,
      stage: FirstTradeStage,
      steps: [at(16, { target: null, icon: 'tick', placement: 'center' })],
    },
  ],
};
