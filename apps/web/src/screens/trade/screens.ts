/**
 * Every trade-room screen module, imported for its `registerTradeScreen` calls (TradeRoom.tsx
 * explains the slot interface). Each task owns exactly one line here, separated by blank lines so
 * parallel branches merge without conflicts: replace your own comment with your import.
 */

import './TradeFund.js'; // Task 22: TradeFund, BuyerWaitFund, SetupStatus

import './BuyerPay.js'; // Task 23: BuyerPay, SellerWaiting

import './releaseScreens.js'; // Task 24: SellerConfirm, Released

import './refundScreens.js'; // Task 25: SellerRefund, FinalAlert

import '../dispute/DisputeSlot.js'; // Task 27: DisputeRoom/DisputeRuling (disputed)

import './Refunded.js'; // Task 27 (design results 2 Nov): the buyer's refunded view, Refunded board

import './SellerCancelConfirm.js'; // Task 39: the seller's Confirm cancel after a buyer's cancel
