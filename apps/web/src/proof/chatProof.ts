// The proof state BuyerPay's "Mark paid without proof?" reads, from the buyer's chat (and, until the
// chat syncs again, a proof this page has just sent: `markProofSent`, proof stack merge). Fetching and decrypting a proof is screens/proof/ChatProof.tsx's (it hands the
// plaintext straight to ProofThumb, proof-render-tripwire.test.ts).
import type { ChatSnapshot } from '../chat/engine.js';
import { latestChatSnapshot } from '../chat/payDetailsFeed.js';
import type { ProofState } from '../screens/trade/paySeams.js';
import { proofUploadOn } from './upload.js';

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


/** The ProofSource App.tsx installs (paySeams setProofSource): this trade's newest chat snapshot. */
export function chatProofState(code: string): ProofState {
  if (sentHere.has(norm(code))) return 'attached';
  return proofStateOfSnapshot(latestChatSnapshot(code), proofUploadOn());
}

const norm = (c: string): string => c.replace(/-/g, '').toUpperCase();
/** Trades this page has sent a payment proof for (memory only): 'attached' before the chat's next sync shows it. */
const sentHere = new Set<string>();
export function markProofSent(code: string): void {
  sentHere.add(norm(code));
}
