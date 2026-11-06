// @x2f/proof: pure proof logic shared by the web app and the moderation tools
// (Plan 5 Tasks 7-9). No I/O, no Node-only APIs (it runs in browsers), no clock reads.
export type { OcrWord } from './ocr.js';
export { type Box, type DetectOptions, type HiddenKind, type Keep, type Region, UPI_IDS, amountBoxes, detectSensitive, detectSensitiveText } from './detect.js';
export { padAndMerge, redact } from './redact.js';
export { CleanError, type CleanErrorCode, assertClean, cleanImage } from './clean.js';
export { parseAmounts } from './amounts.js';
