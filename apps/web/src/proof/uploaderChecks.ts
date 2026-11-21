// The checks the proof POSTER's own app runs on their screenshot before sending it (owner items 63
// and 64, 2026-11-02 04:08; owner 2026-11-02 08:17 for the own-blur warning; built on the kit
// 2026-11-03, Q21). The screen that shows them is Plan 5 Task 15's BlurEditor: on **Send proof** it
// calls `uploadPrompts` with the OCR words of the ORIGINAL screenshot (Task 13's `ocr`, the same
// words `detectSensitive` read), the trade, the uploader's own `kind: 'manual'` regions and the
// photo's own time (`photoTakenAt`, owner G16), then:
// - `popup: 'not-current'` -> <ProofNotCurrent>; nothing is sent (Q42: "No, ask for a fresh
//   screenshot"; `POSTER_BLOCKED_WHEN_OUT_OF_RANGE`, lead default pending owner p11-143).
// - `date: 'not-found'` -> `posterDateLine(date)` beside the preview; posting still allowed (G16).
// - `popup: 'no-amount'` -> <ProofNoAmount>; its Send proof sends, with an explanation or none
//   (optional, lead default pending owner p11-141; the explanation goes nowhere yet).
// - `hidden.amount` / `hidden.memo` -> <ProofHiddenByYou> beside the preview; posting still allowed.
// - P-020: with the proof, `proofCodeNotice(hidden)` -> `chatClient().sendNotice(chat, notice)` in
//   the trade's chat when not null (AddProof.tsx sendCodeNotice, after the proof is sent; proof stack).
// The seller's card (Task 16) runs its own check on the blurred image and trusts none of this.
import { type Box, type OcrWord, type ProofCheck, type ProofExpected, amountBoxes, checkProof, codeBoxes } from '@x2f/proof';
import type { ChatNoticeId } from '../chat/notices.js';

export type UploaderPopup = 'not-current' | 'no-amount';

/**
 * Lead default pending owner p11-143 (review 2026-11-10 finding 3): a proof dated outside the trade
 * blocks the send with item 63's pop-up (Q42 "No, ask for a fresh screenshot"), on the same date
 * verdict the seller's card gets (`checkProof`/`proofDate`, the photo's own time included), even
 * when the rest of the screenshot cannot be read.
 */
export const POSTER_BLOCKED_WHEN_OUT_OF_RANGE = true;

/**
 * Which pop-up the proof poster sees, or null. A date outside the trade (item 63) comes first: a new
 * screenshot may show the amount too. No amount at all (item 64) is the second. None for: an
 * unreadable screenshot whose date is not out of range (the editor's own "couldn't check this image"
 * line, Task 15), a different amount (item 62: the seller decides, nothing prompts), or no date
 * found (owner G16: `posterDateLine` warns and posting stays allowed).
 */
export function uploaderPopup(c: ProofCheck): UploaderPopup | null {
  if (POSTER_BLOCKED_WHEN_OUT_OF_RANGE && c.date === 'out-of-range') return 'not-current';
  if (!c.readable) return null;
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
 * The pop-up, the date verdict and the own-blur warning for one screenshot. `words` are the OCR of
 * the original (the automatic blur never hides the amount, so only the uploader's own blur can, and
 * that is the warning, not the no-amount pop-up). `takenAt` is the photo's own time (`photoTakenAt`,
 * as a Date) or null. `date` is the one date verdict: the same as `proofDate(words, takenAt,
 * expected)` and as the seller's `checkProof` with the same time, and the pop-up follows it; show
 * `posterDateLine(date)` with it.
 */
export function uploadPrompts(
  words: OcrWord[],
  expected: ProofExpected,
  manual: readonly Box[],
  takenAt: Date | null,
): { popup: UploaderPopup | null; date: ProofCheck['date']; hidden: { amount: boolean; memo: boolean } } {
  const check = checkProof(words, expected, [], takenAt);
  const keep = { tradeCode: expected.tradeCode, fiatCents: expected.fiatCents, exponent: expected.exponent };
  return { popup: uploaderPopup(check), date: check.date, hidden: hiddenByUploader(manual, amountBoxes(words, keep), codeBoxes(words, expected.tradeCode)) };
}

/**
 * P-020: the chat notice the poster's app sends with the proof when the poster's own blur covered
 * the trade code (`uploadPrompts(...).hidden`), else null. NEEDS_PLAN_5_TASK_15: the BlurEditor
 * sends it through `chatClient().sendNotice` right after the proof; until then nothing calls this.
 */
export function proofCodeNotice(hidden: { amount: boolean; memo: boolean }): ChatNoticeId | null {
  return hidden.memo ? 'proof-code-hidden' : null;
}
