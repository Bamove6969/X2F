// The checks the proof POSTER's own app runs on their screenshot before sending it (owner items 63
// and 64, 2026-11-02 04:08; owner 2026-11-02 08:17 for the own-blur warning; built on the kit
// 2026-11-03, Q21). The screen that shows them is Plan 5 Task 15's BlurEditor: on **Send proof** it
// calls `uploadPrompts` with the OCR words of the ORIGINAL screenshot (Task 13's `ocr`, the same
// words `detectSensitive` read), the trade, and the uploader's own `kind: 'manual'` regions, then:
// - `popup: 'not-current'` -> <ProofNotCurrent>; nothing is sent (OWNER-Q: block, as the owner's
//   "redo proof and resubmit" reads, or allow a send anyway?).
// - `popup: 'no-amount'` -> <ProofNoAmount>; its Send proof sends with the explanation.
// - `hidden.amount` / `hidden.memo` -> <ProofHiddenByYou> beside the preview; posting still allowed.
// The seller's card (Task 16) runs its own check on the blurred image and trusts none of this.
import { type Box, type OcrWord, type ProofCheck, type ProofExpected, amountBoxes, checkProof, codeBoxes } from '@x2f/proof';

export type UploaderPopup = 'not-current' | 'no-amount';

/**
 * Which pop-up the proof poster sees, or null. A date outside the trade (item 63) comes first: a new
 * screenshot may show the amount too. No amount at all (item 64) is the second. None for: an
 * unreadable screenshot (the editor's own "couldn't check this image" line, Task 15), a different
 * amount (item 62: the seller decides, nothing prompts), or no date found (plan default: the plan
 * and the owner give no prompt for it).
 */
export function uploaderPopup(c: ProofCheck): UploaderPopup | null {
  if (!c.readable) return null;
  if (c.date === 'out-of-range') return 'not-current';
  if (c.amount.status === 'not-found') return 'no-amount';
  return null;
}

function overlaps(a: Box, b: Box): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/** Whether the uploader's own blur covers any part of the amount or the memo (the trade code). */
export function hiddenByUploader(manual: readonly Box[], amount: readonly Box[], memo: readonly Box[]): { amount: boolean; memo: boolean } {
  const hits = (boxes: readonly Box[]): boolean => boxes.some((b) => manual.some((m) => overlaps(m, b)));
  return { amount: hits(amount), memo: hits(memo) };
}

/**
 * The pop-up and the own-blur warning for one screenshot. `words` are the OCR of the original (the
 * automatic blur never hides the amount, so only the uploader's own blur can, and that is the
 * warning, not the no-amount pop-up).
 */
export function uploadPrompts(
  words: OcrWord[],
  expected: ProofExpected,
  manual: readonly Box[],
): { popup: UploaderPopup | null; hidden: { amount: boolean; memo: boolean } } {
  const check = checkProof(words, expected, []);
  const keep = { tradeCode: expected.tradeCode, fiatCents: expected.fiatCents, exponent: expected.exponent };
  return { popup: uploaderPopup(check), hidden: hiddenByUploader(manual, amountBoxes(words, keep), codeBoxes(words, expected.tradeCode)) };
}
