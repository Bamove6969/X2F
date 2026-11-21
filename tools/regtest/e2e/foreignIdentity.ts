/**
 * Plan 3 Task 31, "swapped participants": a trade identity registration for `role` in trade
 * `code` with a fresh key pair and a valid proof, which no trader's device holds. The spec puts it
 * in place of the buyer's own registration, standing in for an API that swaps the buyer's
 * identity. Here, not in apps/web, because only the escrow worker may mint trade identities there
 * (tools/separation-check.ts).
 */
import { generateIdentity, signProof } from '../../../packages/protocol/src/identity.js';
import { identityProofBytes } from '../../../packages/trade/src/attestation.js';

export async function foreignIdentityRegistration(code: string, role: 'buyer' | 'seller'): Promise<{ signPublic: string; boxPublic: string; proof: string }> {
  const other = await generateIdentity();
  const proof = await signProof(other, identityProofBytes(code, role, other.signPublic, other.boxPublic));
  return { signPublic: other.signPublic, boxPublic: other.boxPublic, proof };
}
