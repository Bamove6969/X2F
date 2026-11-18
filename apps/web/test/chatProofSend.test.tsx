// @vitest-environment happy-dom
// "Mark paid without proof?" after a send (re-verify of the proof stack, V-I3 and V-I1; the reviewer's
// probe, committed): a send that fails or whose outcome is uncertain never marks the trade attached,
// a proof sent on one trade never makes another attached, and a log-out forgets what this tab sent.
import { newProofId, type ProofAttachedPayload } from '@x2f/proof';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatSnapshot } from '../src/chat/engine.js';
import { ChatFailed, setChatClient, type ChatFailure } from '../src/chat/client.js';
import { publishPaySnapshot } from '../src/chat/payDetailsFeed.js';
import { chatProofState, proofCheckOf } from '../src/proof/chatProof.js';
import { forgetLocalSession } from '../src/push/usePush.js';
import { postProofToChat } from '../src/screens/proof/AddProof.js';

const ready = (lines: ChatSnapshot['lines']): ChatSnapshot => ({ phase: 'ready', problem: null, role: 'buyer', counterparty: 'Sam', disputeOpen: false, paySecured: true, more: false, lines });
const payload = (): ProofAttachedPayload =>
  ({ proofId: newProofId(), kind: 'proof', key: 'A'.repeat(43), sha256: 'a'.repeat(64), width: 4, height: 3, mime: 'image/png', hidden: [], photoTakenAt: null }) as unknown as ProofAttachedPayload;
const client = (sendProof: () => Promise<ChatSnapshot>) =>
  setChatClient({ sync: async () => ready([]), send: async () => ready([]), sendPay: async () => ready([]), sendProof, sendNotice: async () => ready([]) });

afterEach(() => {
  setChatClient(null);
  vi.unstubAllEnvs();
});

describe('a send that does not go through leaves the state at none (V-I3)', () => {
  const FAILED: readonly ChatFailure[] = ['uncertain', 'refused', 'not-ready', 'bad-proof', 'slow-down', 'too-large', 'unavailable'];
  for (const code of FAILED) {
    it(`a ${code} send never marks the trade attached`, async () => {
      vi.stubEnv('VITE_X2F_PROOF_UPLOAD', '1');
      const c = `PR${code.length}A-BBBB-CCCC-${code.slice(0, 4).toUpperCase().padEnd(4, 'X')}`;
      publishPaySnapshot(c, ready([]));
      const p = payload();
      client(async () => {
        throw new ChatFailed(code);
      });
      await expect(postProofToChat(c, p, async () => 'CHATX')).rejects.toThrow();
      expect(proofCheckOf(p.proofId)).toBeUndefined();
      expect(chatProofState(c)).toBe('none');
    });
  }

  it("the trade's chat failing to open never marks it attached", async () => {
    vi.stubEnv('VITE_X2F_PROOF_UPLOAD', '1');
    const c = 'OPEN-FAIL-AAAA-BBBB';
    publishPaySnapshot(c, ready([]));
    client(async () => ready([]));
    await expect(postProofToChat(c, payload(), async () => {
      throw new ChatFailed('unavailable');
    })).rejects.toThrow();
    expect(chatProofState(c)).toBe('none');
  });
});

describe('trades are kept apart (V-I3)', () => {
  it('a proof sent on one trade never makes another attached; the code is matched however it is written', async () => {
    vi.stubEnv('VITE_X2F_PROOF_UPLOAD', '1');
    const a = 'TRDA-AAAA-AAAA-AAAA';
    const b = 'TRDB-BBBB-BBBB-BBBB';
    publishPaySnapshot(a, ready([]));
    publishPaySnapshot(b, ready([]));
    client(async () => ready([]));
    await postProofToChat(a, payload(), async () => 'CHATA');
    expect(chatProofState(a)).toBe('attached');
    expect(chatProofState(a.toLowerCase().replace(/-/g, ''))).toBe('attached');
    expect(chatProofState(b)).toBe('none');
  });
});

describe('a log-out forgets what this tab sent (V-I1)', () => {
  it('forgetLocalSession clears the sent proofs and their checks', async () => {
    vi.stubEnv('VITE_X2F_PROOF_UPLOAD', '1');
    const c = 'LOGO-UTAA-BBBB-CCCC';
    publishPaySnapshot(c, ready([]));
    const p = payload();
    client(async () => ready([]));
    await postProofToChat(c, p, async () => 'CHATL');
    expect(chatProofState(c)).toBe('attached');
    expect(proofCheckOf(p.proofId)).toBe('ready');
    forgetLocalSession();
    expect(proofCheckOf(p.proofId)).toBeUndefined();
    // The chat snapshot goes with it (T-I3), so the state waits for the next read: never 'attached'.
    expect(chatProofState(c)).toBe('unavailable');
  });
});
