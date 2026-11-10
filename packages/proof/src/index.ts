// @x2f/proof: pure proof logic shared by the web app and the moderation tools
// (Plan 5 Tasks 7-9). No I/O, no Node-only APIs (it runs in browsers), no clock reads.
export type { OcrWord } from './ocr.js';
export { type Box, type DetectOptions, type HiddenKind, type Keep, REVIEW_NOTE_NUMBER_LABELS, type Region, UPI_IDS, amountBoxes, codeBoxes, detectSensitive, detectSensitiveText } from './detect.js';
export type { NumberLabelKind } from './numberLabels.js';
export { padAndMerge, redact } from './redact.js';
export { CleanError, type CleanErrorCode, assertClean, cleanImage } from './clean.js';
export { parseAmounts } from './amounts.js';
export { type PhotoTime, readPhotoTime, readPhotoTimeFrom } from './photoDate.js';
export { type CardLine, type CardTrade, DATE_OUT_OF_RANGE_IF_EITHER, type ProofCheck, type ProofExpected, checkProof, posterDateLine, proofCardLines, proofDate } from './check.js';
export {
  type ProofBinding,
  type ProofErrorCode,
  type ProofKind,
  PROOF_KINDS,
  PROOF_MAX_CIPHERTEXT,
  ProofError,
  decryptProof,
  encryptProof,
  isProofId,
  newProofId,
} from './seal.js';
export {
  type ProofAttachedPayload,
  type ProofEnvelope,
  type ProofMime,
  type ProofSealArgs,
  type ProofUnblurredPayload,
  PROOF_MAX_SIDE,
  PROOF_RECIPIENTS,
  isUtcSecond,
  toUtcSecond,
  parseProofPayload,
  proofKeyFromBase64,
  proofKeyToBase64,
  sealProofEnvelope,
} from './payloads.js';
export {
  type ImageHeader,
  type ProofReceiveErrorCode,
  type ReceiveBitmap,
  type ReceiveDeclared,
  type ReceiveDeps,
  type ReceiveMime,
  type ReceivedProof,
  ProofReceiveError,
  RECEIVE_MAX_BYTES,
  RECEIVE_MAX_RENDER_BYTES,
  RECEIVE_MAX_SIDE,
  RECEIVE_MIMES,
  readImageHeader,
  receiveProof,
  sniffImage,
} from './receive.js';
