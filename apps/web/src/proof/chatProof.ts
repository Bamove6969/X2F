// The proof state BuyerPay's "Mark paid without proof?" reads, from the buyer's chat: a proof counts
// once ChatProof checked it on this page, or this page sent it (AddProof postProofToChat, noteProofSent).
// Fetching and decrypting a proof is screens/proof/ChatProof.tsx's (it hands the plaintext straight
// to ProofThumb, proof-render-tripwire.test.ts).
import type { ChatSnapshot } from '../chat/engine.js';
import { latestChatSnapshot } from '../chat/payDetailsFeed.js';
import type { ProofState } from '../screens/trade/paySeams.js';
import { proofUploadOn } from './flag.js';

export type ProofCheck = 'ready' | 'failed';
/** Proof ids this page fetched, decrypted and checked (ChatProof), or sent itself: ids only, no key or bytes. */
const checks = new Map<string, ProofCheck>();

/** ChatProof's verdict on a proof (review M3): shown through ProofThumb, or gone, refused or not decrypting. */
export function noteProofChecked(proofId: string, ok: boolean): void {
  checks.set(proofId, ok ? 'ready' : 'failed');
}

export function proofCheckOf(proofId: string): ProofCheck | undefined {
  return checks.get(proofId);
}

const norm = (c: string): string => c.replace(/-/g, '').toUpperCase();
/** The payment proofs this page sent, by trade (ids only): the chat-receive re-verify, R1 and R2. */
const sent = new Map<string, Set<string>>();

/** A log-out (push/usePush.ts forgetLocalSession): this tab forgets the ids it sent and checked (re-verify V-I1). */
export function forgetSentProofs(): void {
  sent.clear();
  checks.clear();
}

/**
 * A payment proof this page sent and the chat took (AddProof postProofToChat): checked, since its
 * bytes are this device's own cleaned copy (R1), and counted for its trade even before a snapshot
 * with its line arrives (R2).
 */
export function noteProofSent(code: string, proofId: string): void {
  noteProofChecked(proofId, true);
  const key = norm(code);
  const ids = sent.get(key) ?? new Set<string>();
  ids.add(proofId);
  sent.set(key, ids);
}

/**
 * BuyerPay's "Mark paid without proof?" (T-079) from the buyer's chat snapshot:
 * - 'attached': a payment proof (kind 'proof') from the buyer is in the chat AND ChatProof could
 *   show it on this page (fetched, decrypted and receive-checked), or this page sent it
 *   (`checked`; lead 2026-11-12, review M3);
 * - 'none': the chat is open and read to its end, has no payment proof from the buyer at all, and
 *   this build's proof slot can take one (`uploadOn`);
 * - 'unavailable': anything else (no snapshot yet, the chat not ready or still loading, a proof not
 *   checked yet, or one that is purged, missing or refused, or no working proof slot): never asked
 *   on a guess.
 */
export function proofStateOfSnapshot(snap: ChatSnapshot | null, uploadOn: boolean, checked: (proofId: string) => ProofCheck | undefined = proofCheckOf): ProofState {
  if (snap === null || snap.phase !== 'ready' || snap.more) return 'unavailable';
  const ids = snap.lines.filter((l) => l.from === 'buyer' && l.proof?.kind === 'proof' && l.missing !== true).map((l) => l.proof!.proofId);
  if (ids.some((id) => checked(id) === 'ready')) return 'attached';
  if (ids.length > 0) return 'unavailable';
  return uploadOn ? 'none' : 'unavailable';
}

/** The ProofSource App.tsx installs (paySeams setProofSource): this trade's newest chat snapshot. */
export function chatProofState(code: string): ProofState {
  // A proof this page sent for this trade is attached, whatever the latest snapshot holds (R2).
  if ((sent.get(norm(code))?.size ?? 0) > 0) return 'attached';
  // The proof slot can take a proof only in a build with the upload (one flag function, review M4).
  return proofStateOfSnapshot(latestChatSnapshot(code), proofUploadOn());
}
