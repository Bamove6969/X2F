// NEEDS_PLAN_5_TASK_14, wired: the web app's proof upload (apps/web/src/proof/upload.ts `sendProof`
// and `putProof`, unchanged) against the API's real proof route (apps/api/src/proofs/routes.ts),
// through an inject-backed fetch with the buyer's own session. What the seller then reads back
// decrypts, with the key from the envelope, to the blurred and cleaned picture only. The screen
// stays behind VITE_X2F_PROOF_UPLOAD (off by default): this test turns nothing on.
import { deflateSync, inflateSync } from 'node:zlib';
import { decryptProof, proofKeyFromBase64, type ProofAttachedPayload } from '@x2f/proof';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { ApiCallError } from '../../web/src/api/client.js';
import { type EditorRegion, type PreparedProof, proofUploadOn, putProof, sendProof } from '../../web/src/proof/upload.js';
import { Browser, ORIGIN } from './helpers/totp.js';
import { driveTo, seedTrade } from './helpers/trades.js';
import { tradeApp } from './helpers/tradeApp.js';

let app: FastifyInstance;
let deps: Deps;
let trader: Awaited<ReturnType<typeof tradeApp>>['trader'];

beforeAll(async () => {
  ({ app, deps, trader } = await tradeApp());
});
afterAll(async () => {
  await app.close();
});

/** A fetch that sends to the test app with `b`'s cookies, as the browser would on this origin. */
function fetchAs(b: Browser): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = { origin: ORIGIN };
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const body = init?.body;
    const res = await app.inject({
      method: (init?.method ?? 'GET') as 'GET' | 'PUT',
      url: String(input),
      headers,
      cookies: b.cookies,
      ...(body instanceof Uint8Array ? { payload: Buffer.from(body) } : {}),
    });
    const out = new Headers();
    for (const [k, v] of Object.entries(res.headers)) if (typeof v === 'string') out.set(k, v);
    return new Response(res.statusCode === 204 ? null : new Uint8Array(res.rawPayload), { status: res.statusCode, headers: out });
  }) as typeof fetch;
}

const W = 60;
const H = 40;
function pixels(): Uint8ClampedArray {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    px[i] = (x * 7 + y * 13) & 255;
    px[i + 1] = (x * 3 + y * 29 + 11) & 255;
    px[i + 2] = (x * y + 101) & 255;
    px[i + 3] = 255;
  }
  return px;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b: Uint8Array) => {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  out.set(data, 8);
  out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
/** A real RGBA PNG, with a tEXt chunk the pipeline must clean off. */
function encodePng(rgba: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  const ih = Buffer.alloc(13);
  ih.writeUInt32BE(w, 0);
  ih.writeUInt32BE(h, 4);
  ih[8] = 8;
  ih[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ih), chunk('tEXt', Buffer.from('Comment\0GPS 52N', 'latin1')), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0))]);
}
function decodePng(b: Uint8Array): { types: string[]; rgba: Buffer } {
  const buf = Buffer.from(b);
  const types: string[] = [];
  const idat: Buffer[] = [];
  let w = 0;
  let h = 0;
  for (let at = 8; at < buf.length; ) {
    const len = buf.readUInt32BE(at);
    const type = buf.toString('latin1', at + 4, at + 8);
    types.push(type);
    const data = buf.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') [w, h] = [data.readUInt32BE(0), data.readUInt32BE(4)];
    if (type === 'IDAT') idat.push(data);
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) raw.copy(rgba, y * w * 4, y * (w * 4 + 1) + 1, (y + 1) * (w * 4 + 1));
  return { types, rgba };
}

const REGION: EditorRegion = { id: 'a0', source: 'auto', kind: 'card', x0: 10, y0: 10, x1: 30, y1: 20 };
const prepared = (): PreparedProof => ({ rgba: pixels(), width: W, height: H, words: [], ocrOk: true, auto: [REGION], amount: [], memo: [], photoTakenAt: null });
const inside = (x: number, y: number) => x >= 10 && x < 30 && y >= 10 && y < 20;

async function securedTrade() {
  const seller = await trader();
  const buyer = await trader();
  const { trade } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
  await driveTo(deps, trade, 'secured');
  return { seller, buyer, code: trade.code };
}

describe('the web proof upload against the real proof route (NEEDS_PLAN_5_TASK_14 wired)', () => {
  it('the flag stays off by default', () => {
    expect(proofUploadOn()).toBe(false);
  });

  it("sendProof's PUT is stored as ciphertext; the seller reads it back and decrypts the blurred, cleaned copy only", async () => {
    const { buyer, seller, code } = await securedTrade();
    const posted: ProofAttachedPayload[] = [];
    const r = await sendProof(
      { code, prepared: prepared(), regions: [REGION] },
      {
        encode: async (rgba, w, h) => encodePng(rgba, w, h),
        put: (c, id, kind, ct) => putProof(c, id, kind, ct, fetchAs(buyer.browser)),
        postAttached: async (_c, p) => void posted.push(p),
      },
    );
    expect(r.blur).toBe('auto');
    const row = (await deps.db.query<{ ciphertext: Buffer; uploader_role: string; kind: string }>('select ciphertext, uploader_role, kind from trade_proofs where id = $1', [r.proofId])).rows[0]!;
    expect(row).toMatchObject({ uploader_role: 'buyer', kind: 'proof' });
    expect(row.ciphertext.includes(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(false);

    const res = await fetchAs(seller.browser)(`/v1/trades/${code}/proofs/${r.proofId}`);
    expect(res.status).toBe(200);
    const ct = new Uint8Array(await res.arrayBuffer());
    expect(Buffer.from(ct).equals(row.ciphertext)).toBe(true);
    const p = posted[0]!;
    const plain = await decryptProof(ct, await proofKeyFromBase64(p.key), { code, proofId: r.proofId, kind: 'proof', sha256: p.sha256 });
    const d = decodePng(plain);
    expect(d.types).toEqual(['IHDR', 'IDAT', 'IEND']);
    const orig = pixels();
    let changed = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const same = d.rgba[i] === orig[i] && d.rgba[i + 1] === orig[i + 1] && d.rgba[i + 2] === orig[i + 2];
      if (inside(x, y)) changed += same ? 0 : 1;
      else expect(same).toBe(true);
    }
    expect(changed).toBeGreaterThan(150);
  });

  it("the route's refusals reach the web as ApiCallError codes (wrong-party, proof-exists)", async () => {
    const { buyer, seller, code } = await securedTrade();
    const id = '0'.repeat(25) + '0';
    const ct = new Uint8Array(64);
    await expect(putProof(code, id, 'proof', ct, fetchAs(seller.browser))).rejects.toMatchObject({ status: 403, code: 'wrong-party' });
    await putProof(code, id, 'proof', ct, fetchAs(buyer.browser));
    const again = await putProof(code, id, 'proof', ct, fetchAs(buyer.browser)).catch((e: unknown) => e);
    expect(again).toBeInstanceOf(ApiCallError);
    expect(again).toMatchObject({ status: 409, code: 'proof-exists' });
  });
});
