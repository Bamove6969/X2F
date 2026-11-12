/// <reference types="vite/client" />
/**
 * The buyer's payment proof, on this device (Plan 5 Task 15). PRIVACY-critical.
 *
 * 1. `prepareProof(file)`: refuse the file from its header before any decode (P5-A25), read the
 *    photo's own time (owner G16; only that leaves the device, as a UTC minute), decode it upright,
 *    scaled to PROOF_MAX_SIDE and flattened onto white (the browser half, `ProofImageDeps.decode`),
 *    OCR it on the device, and propose the automatic regions (`detectSensitive`, `padAndMerge`; the
 *    trade amount is never covered by them).
 * 2. The editor (screens/proof/BlurEditor.tsx) lets the buyer remove any region and draw their own
 *    (`manualRegion`).
 * 3. `sendProof`: `finishProof` burns the regions into a COPY of the pixels (`redact`: each region
 *    becomes its mean colour and a fixed texture, which cannot be undone), encodes that copy afresh
 *    (PNG, or JPEG 0.85 over the cap), and cleans it (`cleanImage` + `assertClean`: only the image
 *    chunks or segments survive). Then `encryptProof` under a fresh key, `PUT` the ciphertext, and
 *    post the key in a sealed `proof.attached` envelope through the chat engine.
 *
 * What never leaves the device and is never logged: the picked file, its bytes and metadata, and
 * the unredacted pixels. Nothing here calls `console`. Errors carry codes only. A failure in the
 * finishing steps never falls back to uncleaned or unredacted bytes. Proven in
 * apps/web/test/proofUpload.test.ts.
 *
 * Seams (named, not wired here):
 * - The OCR (Plan 5 Task 13, proof/ocr.ts): on this device, in one worker, from /ocr/ only. When it
 *   cannot run it answers null, so the editor opens with no regions and says so (Review Focus 3).
 * - Task 14 (proof storage), wired: `putProof` calls `PUT /v1/trades/:code/proofs/:id?kind=`
 *   (apps/api/src/proofs/routes.ts), proven end to end in apps/api/test/proofUploadWire.test.ts.
 *   The screen stays behind `VITE_X2F_PROOF_UPLOAD=1` (`proofUploadOn`, off by default) until the
 *   proof stack lands on main.
 * - Wired in the proof stack (screens/proof/AddProof.tsx): `ProofSendDeps.onPosted` is the blur check's
 *   `proofPosted(code, proofId, blurKindOf(...))`, and the code notice (`proofCodeNotice`) goes with the proof.
 */
import {
  type Box,
  type HiddenKind,
  type Keep,
  type OcrWord,
  type ProofAttachedPayload,
  type ProofKind,
  type ProofMime,
  type Region,
  PROOF_MAX_CIPHERTEXT,
  PROOF_MAX_INPUT_BYTES,
  PROOF_MAX_SIDE,
  ProofReceiveError,
  amountBoxes,
  assertClean,
  cleanImage,
  codeBoxes,
  detectSensitive,
  encryptProof,
  newProofId,
  padAndMerge,
  parseProofPayload,
  proofKeyToBase64,
  readInputHeader,
  redact,
} from '@x2f/proof';
import { ApiCallError } from '../api/client.js';
import { photoTakenAt } from './photoDate.js';

// COPY-UNSIGNED: Review Focus 3's line, as the plan words it.
export const PROOF_NO_AUTO_CHECK = "We couldn't check this image automatically. Blur anything private yourself.";
// COPY-UNSIGNED: Review Focus 2's line.
// not-a-refusal: an input check on the picked image (try another), not an X2F rule
export const PROOF_CANT_USE = "This image can't be used. Try a screenshot.";

/** The upload screen is built but its storage route (Task 14) is not: off unless the build says so. */
export function proofUploadOn(): boolean {
  // Written as the literal `import.meta.env.VITE_...` so Vite (and Vitest) replace it: a cast around
  // `import.meta` hides it from that, and the flag then reads undefined even when set to 1 (review M6,
  // proofUpload.test.ts). The vite/client reference at the top types it for the API's tests too.
  return (import.meta.env.VITE_X2F_PROOF_UPLOAD as string | undefined) === '1';
}

export type ProofInputErrorCode = 'too-large' | 'unsupported' | 'undecodable';

/** A picked file that cannot be used. The message is the code alone (never a name or bytes). */
export class ProofInputError extends Error {
  constructor(readonly code: ProofInputErrorCode) {
    super(code);
    this.name = 'ProofInputError';
  }
}

/** How the proof was blurred (the blur check's `BlurKind`, owner Q18 / P-015). */
export type BlurKind = 'auto' | 'manual' | 'both' | 'none';

/** A region in the editor: the tool's (`auto`) or the buyer's own (`manual`, kind 'manual'). */
export interface EditorRegion extends Region {
  id: string;
  source: 'auto' | 'manual';
}

/** The decoded picture and what the tool proposed. Holds no reference to the picked file. */
export interface PreparedProof {
  /** Upright, at most PROOF_MAX_SIDE a side, flattened onto white. Never changed after this, but zeroed when dropped (AddProof, review M1). */
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  /** The OCR of this picture ([] when OCR was not available): for the poster's checks only. */
  words: OcrWord[];
  ocrOk: boolean;
  /** The automatic regions, padded and merged. */
  auto: EditorRegion[];
  /** Where the trade amount and the trade code are (the own-blur warning, ProofHiddenByYou). */
  amount: Box[];
  memo: Box[];
  /** The photo's own time, a UTC minute, or null (owner G16). */
  photoTakenAt: string | null;
}

/** The browser parts, passed in so the rule is tested without a canvas. */
export interface ProofImageDeps {
  /** Decode upright (Exif orientation applied), scale to `maxSide`, flatten onto white. */
  decode(file: Blob, maxSide: number): Promise<{ rgba: Uint8ClampedArray; width: number; height: number }>;
  /** Encode pixels afresh (a canvas keeps only pixels). */
  encode(rgba: Uint8ClampedArray, width: number, height: number, mime: ProofMime): Promise<Uint8Array>;
  /** On-device OCR; null (or a throw) when it is not available. */
  ocr(rgba: Uint8ClampedArray, width: number, height: number): Promise<OcrWord[] | null>;
}

export async function prepareProof(file: Blob, keep: Keep, deps: ProofImageDeps): Promise<PreparedProof> {
  if (file.size === 0) throw new ProofInputError('undecodable');
  if (file.size > PROOF_MAX_INPUT_BYTES) throw new ProofInputError('too-large');
  // The picked file is read ONCE (review M3): the header check, the photo time and the decode all
  // use these bytes, so a file that changes on disk between reads cannot slip past the check, and
  // the decoder is told the type the check found, not the file's own. The bytes are the original
  // file, metadata included: they are zeroed on every way out (review M1). The Blob made from them
  // is the browser's copy, like the File itself, and goes with it to GC.
  const bytes = new Uint8Array(await file.arrayBuffer());
  let takenAt: string | null;
  let img: { rgba: Uint8ClampedArray; width: number; height: number };
  try {
    if (bytes.length === 0) throw new ProofInputError('undecodable');
    if (bytes.length > PROOF_MAX_INPUT_BYTES) throw new ProofInputError('too-large');
    let checked: Blob;
    try {
      checked = new Blob([bytes], { type: readInputHeader(bytes).mime });
    } catch (e) {
      if (e instanceof ProofReceiveError && (e.code === 'too-large' || e.code === 'unsupported')) throw new ProofInputError(e.code);
      throw new ProofInputError('undecodable');
    }
    // Before the decode: the time comes from the file's own metadata, which the decode drops.
    takenAt = await photoTakenAt(checked);
    try {
      img = await deps.decode(checked, PROOF_MAX_SIDE);
    } catch {
      throw new ProofInputError('undecodable');
    }
  } finally {
    bytes.fill(0);
  }
  const { rgba, width, height } = img;
  // Re-verify Z1: from here on the decoded (unblurred) pixels are ours; any failure zeroes them
  // before it is passed on, so a refused picture leaves nothing readable behind.
  try {
    if (!(width >= 1 && height >= 1 && width <= PROOF_MAX_SIDE && height <= PROOF_MAX_SIDE) || rgba.length !== width * height * 4) throw new ProofInputError('undecodable');
    let words: OcrWord[] | null;
    try {
      words = await deps.ocr(rgba, width, height);
    } catch {
      words = null;
    }
    if (words === null) return { rgba, width, height, words: [], ocrOk: false, auto: [], amount: [], memo: [], photoTakenAt: takenAt };
    const amount = amountBoxes(words, keep);
    const auto = padAndMerge(detectSensitive(words, keep), width, height, amount).map((r, i): EditorRegion => ({ ...r, id: `a${i}`, source: 'auto' }));
    return { rgba, width, height, words, ocrOk: true, auto, amount, memo: codeBoxes(words, keep.tradeCode), photoTakenAt: takenAt };
  } catch (e) {
    rgba.fill(0);
    throw e;
  }
}

let manualIds = 0;
/** Smaller than this (either side) is a tap, not a region. */
const MIN_SIDE = 4;

/** The buyer's own region from a drag between two points, clamped to the picture; null for a tap. */
export function manualRegion(a: { x: number; y: number }, b: { x: number; y: number }, width: number, height: number): EditorRegion | null {
  const x0 = Math.max(0, Math.min(a.x, b.x));
  const y0 = Math.max(0, Math.min(a.y, b.y));
  const x1 = Math.min(width, Math.max(a.x, b.x));
  const y1 = Math.min(height, Math.max(a.y, b.y));
  if (!(x1 - x0 >= MIN_SIDE && y1 - y0 >= MIN_SIDE)) return null;
  return { id: `m${++manualIds}`, source: 'manual', kind: 'manual', x0, y0, x1, y1 };
}

/**
 * `none`: nothing blurred. `manual`: only the buyer's own regions. `auto`: exactly the tool's
 * regions, untouched. `both`: the tool's regions with the buyer's changes (one added or removed).
 */
export function blurKindOf(auto: readonly EditorRegion[], regions: readonly EditorRegion[]): BlurKind {
  if (regions.length === 0) return 'none';
  const autoKept = regions.filter((r) => r.source === 'auto').length;
  const manual = regions.length - autoKept;
  if (autoKept === 0) return 'manual';
  if (manual === 0 && autoKept === auto.length) return 'auto';
  return 'both';
}

/** The ciphertext adds a 24-byte nonce and a 16-byte tag to the image. */
const SEAL_OVERHEAD = 40;

/** Burn the regions into a copy, encode it afresh and clean it. Never returns uncleaned bytes. */
export async function finishProof(
  p: PreparedProof,
  regions: readonly EditorRegion[],
  deps: Pick<ProofImageDeps, 'encode'>,
): Promise<{ bytes: Uint8Array; mime: ProofMime; width: number; height: number; hidden: HiddenKind[] }> {
  const copy = new Uint8ClampedArray(p.rgba);
  redact(copy, p.width, p.height, [...regions]);
  let mime: ProofMime = 'image/png';
  let bytes = await deps.encode(copy, p.width, p.height, mime);
  if (bytes.length + SEAL_OVERHEAD > PROOF_MAX_CIPHERTEXT) {
    mime = 'image/jpeg';
    bytes = await deps.encode(copy, p.width, p.height, mime);
  }
  copy.fill(0);
  const clean = cleanImage(bytes);
  assertClean(clean);
  if (clean.length + SEAL_OVERHEAD > PROOF_MAX_CIPHERTEXT) throw new ProofInputError('too-large');
  const hidden = [...new Set(regions.map((r) => r.kind))];
  return { bytes: clean, mime, width: p.width, height: p.height, hidden };
}

/** `PUT /v1/trades/:code/proofs/:id?kind=` (Task 14): the ciphertext alone, as octet-stream. */
export async function putProof(code: string, proofId: string, kind: ProofKind, ciphertext: Uint8Array, f: typeof fetch = globalThis.fetch): Promise<void> {
  const res = await f(`/v1/trades/${encodeURIComponent(code)}/proofs/${encodeURIComponent(proofId)}?kind=${kind}`, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { accept: 'application/json', 'content-type': 'application/octet-stream' },
    body: ciphertext as Uint8Array<ArrayBuffer>,
  });
  if (res.ok) return;
  let code_ = 'internal';
  try {
    const b = (await res.json()) as { error?: unknown };
    if (typeof b?.error === 'string') code_ = b.error;
  } catch {
    // no body
  }
  throw new ApiCallError(res.status, code_);
}

export interface ProofSendDeps extends Pick<ProofImageDeps, 'encode'> {
  put(code: string, proofId: string, kind: ProofKind, ciphertext: Uint8Array): Promise<void>;
  /** Seal `proof.attached` to buyer, seller and mod and post it in the trade's chat (chat engine). */
  postAttached(code: string, payload: ProofAttachedPayload): Promise<void>;
  /** The blur check's `proofPosted(code, proofId, blur)` (AddProof.tsx tradeProofDeps). Its failure never fails the send. */
  onPosted?(code: string, proofId: string, blur: BlurKind): Promise<void>;
}

export async function sendProof(
  a: { code: string; prepared: PreparedProof; regions: readonly EditorRegion[] },
  deps: ProofSendDeps,
): Promise<{ proofId: string; blur: BlurKind; hidden: HiddenKind[] }> {
  const proofId = newProofId();
  const fin = await finishProof(a.prepared, a.regions, deps);
  const { ciphertext, key, sha256 } = await encryptProof(fin.bytes, { code: a.code, proofId, kind: 'proof' });
  fin.bytes.fill(0);
  let keyB64: string;
  try {
    keyB64 = await proofKeyToBase64(key);
  } finally {
    key.fill(0);
  }
  await deps.put(a.code, proofId, 'proof', ciphertext);
  const env = parseProofPayload('proof.attached', {
    proofId,
    kind: 'proof',
    key: keyB64,
    sha256,
    width: fin.width,
    height: fin.height,
    mime: fin.mime,
    hidden: fin.hidden,
    photoTakenAt: a.prepared.photoTakenAt,
  });
  await deps.postAttached(a.code, env.payload as ProofAttachedPayload);
  const blur = blurKindOf(a.prepared.auto, a.regions);
  if (deps.onPosted) {
    try {
      await deps.onPosted(a.code, proofId, blur);
    } catch {
      // The blur check is a survey: the proof is sent whatever happens to it.
    }
  }
  return { proofId, blur, hidden: fin.hidden };
}
