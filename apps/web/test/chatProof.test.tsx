// @vitest-environment happy-dom
// NEEDS_PROOF_RECEIVE, the page half: a `proof.attached` line in the chat fetches the proof's
// ciphertext (GET /v1/trades/:code/proofs/:id, Task 14), decrypts it with the sealed key and shows it
// only through ProofThumb (the receive check: header walk, size cap, metadata stripped, decode,
// redraw). Anything that does not check out is the refusal, never the bytes. And BuyerPay's
// "Mark paid without proof?" reads the chat: 'attached', 'none' or 'unavailable'.
import { act } from 'react';
import { crc32, deflateSync } from 'node:zlib';
import { encryptProof, newProofId, proofKeyToBase64, readImageHeader, type ProofAttachedPayload, type ReceiveDeps } from '@x2f/proof';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatSnapshot } from '../src/chat/engine.js';
import { PROOF_REFUSED_TITLE } from '../src/screens/proof/ProofThumb.js';
import { CHAT_PROOF_GONE, ChatProof } from '../src/screens/proof/ChatProof.js';
import { proofCheckOf, proofStateOfSnapshot } from '../src/proof/chatProof.js';
import { PROOF_MAX_CIPHERTEXT } from '@x2f/proof';
import { render } from './render.js';

const CODE = 'K7M2-9QXA-4FTR-8WPN';
const latin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  out.set(latin1(type), 4);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
function png(w: number, h: number): Uint8Array {
  const head = new Uint8Array(13);
  const v = new DataView(head.buffer);
  v.setUint32(0, w);
  v.setUint32(4, h);
  head[8] = 8;
  head[9] = 2;
  const raw = new Uint8Array(h * (1 + 3 * w)).fill(7);
  for (let y = 0; y < h; y++) raw[y * (1 + 3 * w)] = 0;
  return Buffer.concat([Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), chunk('IHDR', head), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0))]);
}

const PLAIN = png(4, 3);

/** A sealed proof as the uploader's device made it, and the ciphertext the API would serve. */
async function made(kind: 'proof' | 'evidence' = 'proof', plain = PLAIN): Promise<{ payload: ProofAttachedPayload; ciphertext: Uint8Array }> {
  const proofId = newProofId();
  const { ciphertext, key, sha256 } = await encryptProof(plain, { code: CODE, proofId, kind });
  return { ciphertext, payload: { proofId, kind, key: await proofKeyToBase64(key), sha256, width: 4, height: 3, mime: 'image/png', hidden: ['card'], photoTakenAt: null } };
}

function deps(): ReceiveDeps & { decode: ReturnType<typeof vi.fn> } {
  const decode = vi.fn(async (bytes: Uint8Array) => ({ ...readImageHeader(bytes), close: () => undefined }));
  return { decode, render: async () => png(4, 3) } as ReceiveDeps & { decode: ReturnType<typeof vi.fn> };
}

const settle = () => act(async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)); });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ChatProof', () => {
  it('fetches the ciphertext, decrypts it and shows it through the receive check only', async () => {
    const { payload, ciphertext } = await made();
    const f = vi.fn(async () => new Response(ciphertext as Uint8Array<ArrayBuffer>, { status: 200, headers: { 'content-type': 'application/octet-stream' } }));
    vi.stubGlobal('fetch', f);
    const d = deps();
    const { host } = render(<ChatProof tradeCode={CODE} proof={payload} deps={d} />);
    await settle();
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = (f.mock.calls as unknown as [string, RequestInit][])[0]!;
    expect(url).toBe(`/v1/trades/${CODE}/proofs/${payload.proofId}`);
    expect(init.credentials).toBe('same-origin');
    // The decoder got the decrypted picture (and the decrypted bytes went nowhere else).
    expect(d.decode).toHaveBeenCalledTimes(1);
    expect(Buffer.from(d.decode.mock.calls[0]![0] as Uint8Array).equals(Buffer.from(PLAIN))).toBe(true);
    const img = host.querySelector('img[data-part="proof-image"]') as HTMLImageElement;
    expect(img.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    // The key never reaches the page's markup.
    expect(host.innerHTML).not.toContain(payload.key);
  });

  it('a ciphertext that does not open with the sealed key (or another proof\'s) is refused, nothing decoded', async () => {
    const { payload } = await made();
    const other = await made();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(other.ciphertext as Uint8Array<ArrayBuffer>, { status: 200 })));
    const d = deps();
    const { host } = render(<ChatProof tradeCode={CODE} proof={payload} deps={d} />);
    await settle();
    expect(host.textContent).toContain(PROOF_REFUSED_TITLE);
    expect(host.querySelector('img')).toBeNull();
    expect(d.decode).not.toHaveBeenCalled();
  });

  it('a ciphertext for another kind (evidence re-labelled as the payment proof) is refused', async () => {
    const ev = await made('evidence');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(ev.ciphertext as Uint8Array<ArrayBuffer>, { status: 200 })));
    const d = deps();
    const { host } = render(<ChatProof tradeCode={CODE} proof={{ ...ev.payload, kind: 'proof' }} deps={d} />);
    await settle();
    expect(host.querySelector('img')).toBeNull();
    expect(d.decode).not.toHaveBeenCalled();
  });

  it('a decrypted file that fails the receive check (not the declared picture) is refused', async () => {
    const { payload, ciphertext } = await made('proof', latin1('<svg onload=alert(1)>'));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(ciphertext as Uint8Array<ArrayBuffer>, { status: 200 })));
    const { host } = render(<ChatProof tradeCode={CODE} proof={payload} deps={deps()} />);
    await settle();
    expect(host.textContent).toContain(PROOF_REFUSED_TITLE);
    expect(host.querySelector('img')).toBeNull();
  });

  it('a proof the server no longer has (404, purged) says so; no image', async () => {
    const { payload } = await made();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'not-found' }), { status: 404 })));
    const { host } = render(<ChatProof tradeCode={CODE} proof={payload} deps={deps()} />);
    await settle();
    expect(host.textContent).toContain(CHAT_PROOF_GONE);
    expect(host.querySelector('img')).toBeNull();
  });
});

describe('review M3: ChatProof records whether the proof checked out', () => {
  it('shown is ready; refused, gone or not decrypting is failed', async () => {
    const good = await made();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(good.ciphertext as Uint8Array<ArrayBuffer>, { status: 200 })));
    const r1 = render(<ChatProof tradeCode={CODE} proof={good.payload} deps={deps()} />);
    await settle();
    expect(r1.host.querySelector('img')).not.toBeNull();
    expect(proofCheckOf(good.payload.proofId)).toBe('ready');
    const gone = await made();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'not-found' }), { status: 404 })));
    render(<ChatProof tradeCode={CODE} proof={gone.payload} deps={deps()} />);
    await settle();
    expect(proofCheckOf(gone.payload.proofId)).toBe('failed');
    const bad = await made('proof', latin1('<svg onload=alert(1)>'));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(bad.ciphertext as Uint8Array<ArrayBuffer>, { status: 200 })));
    render(<ChatProof tradeCode={CODE} proof={bad.payload} deps={deps()} />);
    await settle();
    expect(proofCheckOf(bad.payload.proofId)).toBe('failed');
    expect(proofCheckOf(newProofId())).toBeUndefined();
  });
});

describe('review M5: one fetch per proof, and a bounded read', () => {
  it('a new snapshot object for the same proof (every chat poll) does not fetch, decrypt or check it again', async () => {
    const { payload, ciphertext } = await made();
    const f = vi.fn(async () => new Response(ciphertext as Uint8Array<ArrayBuffer>, { status: 200 }));
    vi.stubGlobal('fetch', f);
    const d = deps();
    const r = render(<ChatProof tradeCode={CODE} proof={payload} deps={d} />);
    await settle();
    for (let i = 0; i < 3; i++) {
      r.rerender(<ChatProof tradeCode={CODE} proof={{ ...payload, hidden: [...payload.hidden] }} deps={d} />);
      await settle();
    }
    expect(f).toHaveBeenCalledTimes(1);
    expect(d.decode).toHaveBeenCalledTimes(1);
    expect(r.host.querySelector('img')).not.toBeNull();
  });

  it('an answer that says it is over the cap is refused unread', async () => {
    const { payload } = await made();
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        // Bounded (1 MiB) so that a reader that ignores the length cannot take the test's memory.
        if (++pulled > 16) return c.close();
        c.enqueue(new Uint8Array(65536));
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200, headers: { 'content-length': String(PROOF_MAX_CIPHERTEXT + 1) } })));
    const { host } = render(<ChatProof tradeCode={CODE} proof={payload} deps={deps()} />);
    await settle();
    expect(host.textContent).toContain(PROOF_REFUSED_TITLE);
    expect(pulled).toBeLessThanOrEqual(2);
  });

  it('an endless answer with no length is cut at the cap', async () => {
    const { payload } = await made();
    let read = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        read += 65536;
        // 8 MiB, twice the cap: enough to show the cut, small enough for the test's memory.
        if (read > 8 * 1024 * 1024) return c.close();
        c.enqueue(new Uint8Array(65536));
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })));
    const { host } = render(<ChatProof tradeCode={CODE} proof={payload} deps={deps()} />);
    await settle();
    expect(host.textContent).toContain(PROOF_REFUSED_TITLE);
    expect(read).toBeLessThanOrEqual(PROOF_MAX_CIPHERTEXT + 3 * 65536);
  });
});

describe('proofStateOfSnapshot: "Mark paid without proof?"', () => {
  const snap = (lines: ChatSnapshot['lines'], phase: ChatSnapshot['phase'] = 'ready'): ChatSnapshot => ({
    phase, problem: null, role: 'buyer', counterparty: 'Sam', disputeOpen: false, paySecured: true, more: false, lines,
  });
  const line = (o: Partial<ChatSnapshot['lines'][number]>): ChatSnapshot['lines'][number] => ({ id: '1', from: 'buyer', text: '', at: null, mine: true, gapBefore: false, ...o });

  it("'attached' once the buyer's payment proof is in the chat and checked out; evidence or the seller's never counts", async () => {
    const { payload } = await made();
    const ok = () => 'ready' as const;
    expect(proofStateOfSnapshot(snap([line({ proof: payload })]), true, ok)).toBe('attached');
    expect(proofStateOfSnapshot(snap([line({ proof: payload })]), false, ok)).toBe('attached');
    const ev = (await made('evidence')).payload;
    expect(proofStateOfSnapshot(snap([line({ proof: ev })]), true, ok)).toBe('none');
    expect(proofStateOfSnapshot(snap([line({ from: 'seller', mine: false, proof: payload })]), true, ok)).toBe('none');
    expect(proofStateOfSnapshot(snap([line({ text: 'hi' })]), true, ok)).toBe('none');
  });

  it("review M3: a key line alone is not 'attached': not checked yet is 'unavailable', and a proof that is gone or refused is 'none'", async () => {
    const a = await made();
    const b = await made();
    const lines = [line({ id: '1', proof: a.payload }), line({ id: '2', proof: b.payload })];
    expect(proofStateOfSnapshot(snap(lines), true, () => undefined)).toBe('unavailable');
    expect(proofStateOfSnapshot(snap(lines), true, (id) => (id === a.payload.proofId ? 'failed' : undefined))).toBe('unavailable');
    expect(proofStateOfSnapshot(snap(lines), true, () => 'failed')).toBe('none');
    expect(proofStateOfSnapshot(snap(lines), false, () => 'failed')).toBe('unavailable');
    expect(proofStateOfSnapshot(snap(lines), true, (id) => (id === b.payload.proofId ? 'ready' : 'failed'))).toBe('attached');
  });

  it("'none' only when the chat is read in full and this build can take a proof; otherwise 'unavailable'", () => {
    expect(proofStateOfSnapshot(snap([]), true)).toBe('none');
    expect(proofStateOfSnapshot(snap([]), false)).toBe('unavailable');
    expect(proofStateOfSnapshot(snap([], 'waiting'), true)).toBe('unavailable');
    expect(proofStateOfSnapshot({ ...snap([]), more: true }, true)).toBe('unavailable');
    expect(proofStateOfSnapshot(null, true)).toBe('unavailable');
  });
});

describe('chatProofState: the source App installs for proofStateOf', () => {
  it("reads the trade's newest chat snapshot (from the pay feed or an open panel); none yet is 'unavailable'", async () => {
    const { chatProofState } = await import('../src/proof/chatProof.js');
    const { publishPaySnapshot } = await import('../src/chat/payDetailsFeed.js');
    const code = 'AAAA-BBBB-CCCC-DDDD';
    expect(chatProofState(code)).toBe('unavailable');
    const { payload } = await made();
    publishPaySnapshot(code, { phase: 'ready', problem: null, role: 'buyer', counterparty: 'Sam', disputeOpen: false, paySecured: true, more: false, lines: [{ id: '1', from: 'buyer', text: '', at: null, mine: true, gapBefore: false, proof: payload }] });
    // Review M3: the key line alone is not enough; once this device checked the proof, it is attached.
    expect(chatProofState(code.toLowerCase())).toBe('unavailable');
    const { noteProofChecked } = await import('../src/proof/chatProof.js');
    noteProofChecked(payload.proofId, true);
    expect(chatProofState(code.toLowerCase())).toBe('attached');
  });
});
