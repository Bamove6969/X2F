import { api } from './client.js';

/**
 * P-012/P-013: the "Was this proof blurred correctly?" routes (apps/api/src/proof/blurCheck.ts).
 * The uploader's app calls `proofPosted` once it has sent a proof (only the proof id and how it was
 * blurred go to the API, never the image); each party then reads its own asks and answers them.
 *
 * Proof stack: the upload calls `proofPosted` after the proof is sent (screens/proof/AddProof.tsx
 * tradeProofDeps), and the API announces only a stored proof of the caller's side.
 * Plan 5 Task 15: the uploader is asked at once when `proofPosted` answers `ask` (AddProof's sent
 * screen mounts `BlurCheck`; DESIGNER-REVIEW, no board). NEEDS_BLUR_CHECK_SCREEN: the receiver's ask
 * (`pendingBlurChecks`, once the proof has opened) and an uploader's ask missed on a reload are not
 * mounted yet: no board says where.
 */
export type BlurKind = 'auto' | 'manual' | 'both' | 'none';

export interface BlurCheckAsk {
  proofId: string;
  role: 'uploader' | 'receiver';
}

const base = (code: string) => `/v1/trades/${encodeURIComponent(code)}`;

export function proofPosted(code: string, proofId: string, blur: BlurKind): Promise<{ ask: boolean }> {
  return api<{ ask: boolean }>(`${base(code)}/proofs/${encodeURIComponent(proofId)}/blur-check`, { method: 'POST', body: { blur } });
}

export async function pendingBlurChecks(code: string): Promise<BlurCheckAsk[]> {
  return (await api<{ checks: BlurCheckAsk[] }>(`${base(code)}/blur-checks`)).checks;
}

export async function answerBlurCheck(code: string, proofId: string, a: { correct: boolean; comment?: string }): Promise<void> {
  await api(`${base(code)}/blur-checks/${encodeURIComponent(proofId)}`, { method: 'POST', body: a });
}
