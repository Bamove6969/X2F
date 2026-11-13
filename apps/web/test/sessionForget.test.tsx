// @vitest-environment happy-dom
// Every way a session ends forgets what this tab kept for it (review of proof-tripwire-2, T-I2 and T-I3):
// - logOut clears even when POST /v1/logout throws (lead: dropping drafts then is accepted; the person
//   asked to log out);
// - a 401 not-authenticated from any call but `me` (the session-gone listener) clears too;
// - the chat snapshots payDetailsFeed keeps (proof lines carry their keys) are cleared on both, and a
//   trade's snapshot goes when its last ChatPanel unmounts with no pay card listening.
import { newProofId, type ProofAttachedPayload } from '@x2f/proof';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiCallError, api } from '../src/api/client.js';
import type { ChatSnapshot } from '../src/chat/engine.js';
import { setChatClient } from '../src/chat/client.js';
import { latestChatSnapshot, panelPublishing, publishPaySnapshot } from '../src/chat/payDetailsFeed.js';
import { chatProofState, proofCheckOf } from '../src/proof/chatProof.js';
import { forgetLocalSession, logOut, type PushEnv } from '../src/push/usePush.js';
import { postProofToChat } from '../src/screens/proof/AddProof.js';
import '../src/session/useSession.js';

const ready = (lines: ChatSnapshot['lines']): ChatSnapshot => ({ phase: 'ready', problem: null, role: 'buyer', counterparty: 'Sam', disputeOpen: false, paySecured: true, more: false, lines });
const payload = (): ProofAttachedPayload =>
  ({ proofId: newProofId(), kind: 'proof', key: 'A'.repeat(43), sha256: 'a'.repeat(64), width: 4, height: 3, mime: 'image/png', hidden: [], photoTakenAt: null }) as unknown as ProofAttachedPayload;
const line = (p: ProofAttachedPayload): ChatSnapshot['lines'][number] => ({ id: '1', from: 'buyer', text: '', at: null, mine: true, gapBefore: false, proof: p });

/** A proof sent on `code` from this tab, with its snapshot published. */
async function sent(code: string): Promise<ProofAttachedPayload> {
  const p = payload();
  const after = ready([line(p)]);
  setChatClient({ sync: async () => after, send: async () => after, sendPay: async () => after, sendProof: async () => after, sendNotice: async () => after });
  await postProofToChat(code, p, async () => 'CHAT1');
  expect(chatProofState(code)).toBe('attached');
  expect(latestChatSnapshot(code)).toBe(after);
  return p;
}

const pushEnv = (apiImpl: PushEnv['api']): PushEnv => ({ serviceWorker: undefined, hasPushManager: false, Notification: undefined, api: apiImpl });

afterEach(() => {
  setChatClient(null);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  forgetLocalSession();
});

describe('logOut (T-I2)', () => {
  it('forgets the sent proofs and the chat snapshots even when POST /v1/logout throws', async () => {
    vi.stubEnv('VITE_X2F_PROOF_UPLOAD', '1');
    const code = 'LOGF-AAAA-BBBB-CCCC';
    const p = await sent(code);
    await expect(logOut(pushEnv(async () => {
      throw new TypeError('network down');
    }))).rejects.toThrow('network down');
    expect(proofCheckOf(p.proofId)).toBeUndefined();
    expect(latestChatSnapshot(code)).toBeNull();
    expect(chatProofState(code)).toBe('unavailable');
  });

  it('and when it goes through', async () => {
    const code = 'LOGO-AAAA-BBBB-CCCC';
    await sent(code);
    await logOut(pushEnv(async <T,>() => undefined as T));
    expect(latestChatSnapshot(code)).toBeNull();
  });
});

describe('the session-gone listener (T-I2)', () => {
  it('a 401 not-authenticated from a call forgets the sent proofs and the chat snapshots', async () => {
    const code = 'GONE-AAAA-BBBB-CCCC';
    const p = await sent(code);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'not-authenticated' }), { status: 401, headers: { 'content-type': 'application/json' } })));
    await expect(api('/v1/offers')).rejects.toBeInstanceOf(ApiCallError);
    expect(proofCheckOf(p.proofId)).toBeUndefined();
    expect(latestChatSnapshot(code)).toBeNull();
  });
});

describe("payDetailsFeed's snapshots (T-I3)", () => {
  it('forgetLocalSession clears every trade\'s snapshot', () => {
    publishPaySnapshot('SNAP-AAAA-BBBB-CCCC', ready([]));
    publishPaySnapshot('SNAP-DDDD-EEEE-FFFF', ready([]));
    forgetLocalSession();
    expect(latestChatSnapshot('SNAP-AAAA-BBBB-CCCC')).toBeNull();
    expect(latestChatSnapshot('SNAP-DDDD-EEEE-FFFF')).toBeNull();
  });

  it("a trade's snapshot goes when its last ChatPanel unmounts and no pay card listens", () => {
    const code = 'PANL-AAAA-BBBB-CCCC';
    const one = panelPublishing(code);
    const two = panelPublishing(code);
    publishPaySnapshot(code, ready([line(payload())]));
    one();
    expect(latestChatSnapshot(code)).not.toBeNull();
    two();
    expect(latestChatSnapshot(code)).toBeNull();
  });
});
