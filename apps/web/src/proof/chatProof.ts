// NEEDS_PROOF_RECEIVE: the proof state BuyerPay's "Mark paid without proof?" reads, from the
// buyer's chat. Fetching and decrypting a proof is screens/proof/ChatProof.tsx's (it hands the
// plaintext straight to ProofThumb, proof-render-tripwire.test.ts).
import type { ChatSnapshot } from '../chat/engine.js';
import { latestChatSnapshot } from '../chat/payDetailsFeed.js';
import type { ProofState } from '../screens/trade/paySeams.js';

/**
 * BuyerPay's "Mark paid without proof?" (T-079) from the buyer's chat snapshot:
 * - 'attached': a payment proof (kind 'proof') from the buyer is in the chat;
 * - 'none': the chat is open and read to its end, has none, and this build's proof slot can take
 *   one (`uploadOn`);
 * - 'unavailable': anything else (no snapshot yet, the chat not ready or still loading, or no
 *   working proof slot): never asked on a guess.
 */
export function proofStateOfSnapshot(snap: ChatSnapshot | null, uploadOn: boolean): ProofState {
  if (snap === null || snap.phase !== 'ready' || snap.more) return 'unavailable';
  if (snap.lines.some((l) => l.from === 'buyer' && l.proof?.kind === 'proof' && l.missing !== true)) return 'attached';
  return uploadOn ? 'none' : 'unavailable';
}

/** The proof slot can take a proof only in a build with the upload (VITE_X2F_PROOF_UPLOAD=1, wip/lead-proof-upload). */
export function proofUploadBuilt(): boolean {
  return (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_X2F_PROOF_UPLOAD === '1';
}

/** The ProofSource App.tsx installs (paySeams setProofSource): this trade's newest chat snapshot. */
export function chatProofState(code: string): ProofState {
  return proofStateOfSnapshot(latestChatSnapshot(code), proofUploadBuilt());
}
