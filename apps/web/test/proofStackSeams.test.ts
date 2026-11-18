// The proof stack's seams between its branches (wip/lead-proof-stack):
// - the upload's onPosted is the blur check's proofPosted (wip/lead-proof-check): only the proof id and
//   the blur kind go to the API;
// - with the proof, the code notice (wip/lead-proof-code's proofCodeNotice) goes into the trade's chat
//   when the poster's own blur covers the memo with the trade code, and only then; a notice that
//   fails never fails the proof.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setChatClient, type ChatClient } from '../src/chat/client.js';
import { sendCodeNotice, tradeProofDeps } from '../src/screens/proof/AddProof.js';

const CODE = 'K7M2-9QXA-4FTR-8WPN';
const CHAT = 'C3PO-R2D2-BB8X-K2SO';
const ID = '0123456789ABCDEFGHJKMNPQR0';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  setChatClient(null);
  vi.unstubAllGlobals();
});

function fakeChat(): ChatClient & { sendNotice: ReturnType<typeof vi.fn> } {
  const snap = {} as never;
  return { sync: vi.fn(async () => snap), send: vi.fn(async () => snap), sendPay: vi.fn(async () => snap), sendProof: vi.fn(async () => snap), sendNotice: vi.fn(async () => snap) };
}

describe('the upload announces the sent proof to the blur check (onPosted -> proofPosted)', () => {
  it('POSTs only { blur } for the proof id', async () => {
    const f = vi.fn(async () => json(200, { ask: true }));
    vi.stubGlobal('fetch', f);
    const deps = tradeProofDeps();
    expect(deps.onPosted).toBeTypeOf('function');
    await deps.onPosted!(CODE, ID, 'both');
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = (f.mock.calls as unknown as [string, RequestInit][])[0]!;
    expect(url).toBe(`/v1/trades/${CODE}/proofs/${ID}/blur-check`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ blur: 'both' });
  });
});

describe('the code notice goes with the proof (proofCodeNotice -> sendNotice)', () => {
  it('when the poster hid the memo with the trade code: the fixed notice, in the trade chat', async () => {
    const c = fakeChat();
    setChatClient(c);
    vi.stubGlobal('fetch', vi.fn(async () => json(200, { chat: CHAT })));
    await sendCodeNotice(CODE, { amount: false, memo: true });
    expect(c.sendNotice).toHaveBeenCalledWith(CHAT, 'proof-code-hidden');
  });

  it('not when only the amount, or nothing, was hidden by the poster', async () => {
    const c = fakeChat();
    setChatClient(c);
    vi.stubGlobal('fetch', vi.fn(async () => json(200, { chat: CHAT })));
    await sendCodeNotice(CODE, { amount: true, memo: false });
    await sendCodeNotice(CODE, { amount: false, memo: false });
    expect(c.sendNotice).not.toHaveBeenCalled();
  });
});
