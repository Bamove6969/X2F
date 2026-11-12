import { api } from './client.js';

/**
 * P-012/P-013: the "Was this proof blurred correctly?" routes (apps/api/src/proof/blurCheck.ts).
 * The uploader's app calls `proofPosted` once it has sent a proof (only the proof id and how it was
 * blurred go to the API, never the image); each party then reads its own asks and answers them.
 *
 * NEEDS_PLAN_5_TASK_15: the proof upload flow (BlurEditor, the sealed proof in the chat) is not built
 * on main, so nothing calls these yet. When it lands: call `proofPosted` after the proof is sent,
 * then show `BlurCheck` (screens/proof/BlurCheck.tsx) for each of `pendingBlurChecks` to the
 * uploader and, on their side, to the receiver once the proof has opened.
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
