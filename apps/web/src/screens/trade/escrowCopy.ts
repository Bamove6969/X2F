/**
 * Two lines the trade screens say about the escrow, shared with the first-trade tour's example
 * screens (tour/FirstTradeStage.tsx), so the example says word for word what the real screen says
 * and each line's `not-a-refusal` reason is given once (review 12 Nov, B4).
 */

/** Fund (TradeFund, "Escrow ready: 3 keys, any 2 release it"). */
// not-a-refusal: explains the escrow keys
export const ONE_KEY_ALONE = "One key alone can't move anything.";

/** Check and release (SellerConfirm's hint under the hold button). */
// not-a-refusal: explains that a release is final
export const RELEASE_IS_FINAL = 'Press and hold for 1.5 seconds. Once released, the XMR can’t be taken back.';
