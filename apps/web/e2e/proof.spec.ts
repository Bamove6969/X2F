// Plan 5 Task 15 end to end in a real browser: the buyer adds a payment proof in the trade room
// (BuyerPay's proof slot, VITE_X2F_PROOF_UPLOAD=1 in this build), checks the blur (the on-device OCR
// proposes the regions; the buyer takes one off and draws one of their own), and sends it. On a
// fixtures-mode build served with the real CSP, with the real chat engine in the escrow worker and
// page.route stand-ins for the trade, proof and chat APIs. The seller and the moderation service are
// played here with libsodium and @x2f/protocol: the test checks the chat key record the browser makes,
// opens what the browser posted (envelope v2 under that key, decision 16) as the
// seller, fetches nothing but the PUT body it recorded, and decrypts it with the envelope's key.
//
// Proven: the PUT body is ciphertext (no image magic, no file name, octet-stream); the envelope is a
// proof.attached the seller opens; the seller's picture is the blurred copy, exactly as the buyer
// left the regions (the card, IBAN and email covered, the phone the buyer uncovered left as it was,
// the buyer's own region covered, the amount and the trade code untouched); the blur check is asked
// and answered with the proof id only.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { expect, test, type Page, type Route } from '@playwright/test';
import { decryptProof, parseProofPayload, proofKeyFromBase64, type ProofAttachedPayload } from '@x2f/proof';
import { openChat, openChatKeyRecord, ReplayGuard, verifyChatKeyRecord, type ChatEnvelopeV2, type ChatKeyRecord, type Identity, type Participants } from '@x2f/protocol';
import { attestationBytes, channelFor, chatIdentityProofValid, type Attestation } from '@x2f/trade';
import type { FastifyInstance } from 'fastify';
import sodium from 'libsodium-wrappers';
import { PAY_SECURED } from '../src/fixtures/payBoard.js';
import type { GroundTruth } from './fixtures/proofs/make.js';
import { startFixtures } from './fixtures-serve.js';
import { signedIn } from './session.js';

const PORT = 4341;
const BASE = `http://127.0.0.1:${PORT}`;
const CODE = PAY_SECURED.code;
const CHAT = 'C7AT-2M9Q-XA4F-TR8W';
const FIXTURE = fileURLToPath(new URL('./fixtures/proofs/bank-labelled.png', import.meta.url));

let server: FastifyInstance;
let modKey: { publicKey: Uint8Array; privateKey: Uint8Array };

function identity(): Identity {
  const kp = sodium.crypto_sign_keypair();
  return {
    signPublic: sodium.to_hex(kp.publicKey),
    boxPublic: sodium.to_hex(sodium.crypto_sign_ed25519_pk_to_curve25519(kp.publicKey)),
    signSecret: kp.privateKey,
    boxSecret: sodium.crypto_sign_ed25519_sk_to_curve25519(kp.privateKey),
  };
}

test.beforeAll(async () => {
  test.setTimeout(300_000);
  await sodium.ready;
  modKey = sodium.crypto_sign_keypair();
  process.env.VITE_MOD_SIGNING_PUBLIC = sodium.to_hex(modKey.publicKey);
  process.env.VITE_X2F_PROOF_UPLOAD = '1';
  server = await startFixtures(PORT, 'dist-fixtures-proof');
});
test.afterAll(async () => {
  await server?.close();
});
test.beforeEach(async ({ page }) => {
  await signedIn(page);
});

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

interface World {
  puts: { url: string; headers: Record<string, string>; body: Buffer }[];
  posted: ChatEnvelopeV2[];
  /** The chat key record the browser made (decision 16: proof.attached is v2 under the chat key). */
  record: () => ChatKeyRecord | null;
  announced: { url: string; body: unknown }[];
  answers: { url: string; body: unknown }[];
  seller: Identity;
  channel: string;
  participants: () => Participants | null;
}

/** The trade, proof and chat APIs for one secured trade in which the browser is the buyer. */
async function stub(page: Page): Promise<World> {
  const channel = await channelFor(CHAT, 'chat');
  const seller = identity();
  const mod = identity();
  const registered: { signPublic: string; boxPublic: string; proof: string }[] = [];
  const envelopes: { id: string; senderRole: string; envelope: ChatEnvelopeV2; at: string }[] = [];
  let record: ChatKeyRecord | null = null;
  let attestation: { attestation: Attestation; sig: string } | null = null;
  const participants = (): Participants | null => {
    const me = registered[0];
    return me ? { buyer: { signPublic: me.signPublic, boxPublic: me.boxPublic }, seller: { signPublic: seller.signPublic, boxPublic: seller.boxPublic }, mod: { signPublic: mod.signPublic, boxPublic: mod.boxPublic } } : null;
  };
  const w: World = { puts: [], posted: [], record: () => record, announced: [], answers: [], seller, channel, participants };
  const at = '2026-10-28T12:00:00.000Z';

  await page.route(`**/v1/trades/${CODE}`, json(PAY_SECURED));
  await page.route(`**/v1/trades/${CODE}/chat`, json({ chat: CHAT, role: 'buyer' }));
  await page.route(`**/v1/trades/${CODE}/proofs/*`, async (r) => {
    if (r.request().method() !== 'PUT') return json({ error: 'not-found' }, 404)(r);
    w.puts.push({ url: r.request().url(), headers: r.request().headers(), body: r.request().postDataBuffer() ?? Buffer.alloc(0) });
    return r.fulfill({ status: 204 });
  });
  await page.route(`**/v1/trades/${CODE}/proofs/*/blur-check`, async (r) => {
    w.announced.push({ url: r.request().url(), body: r.request().postDataJSON() });
    return json({ ask: true })(r);
  });
  await page.route(`**/v1/trades/${CODE}/blur-checks/*`, async (r) => {
    w.answers.push({ url: r.request().url(), body: r.request().postDataJSON() });
    return r.fulfill({ status: 204 });
  });
  await page.route(`**/v1/trades/${CODE}/blur-checks`, json({ checks: [] }));
  // The chat engine's calls come from the escrow worker: routed on the context, which covers workers.
  await page.context().route('**/v1/chats/**', async (r) => {
    const url = new URL(r.request().url());
    const path = url.pathname.replace(`/v1/chats/${CHAT}`, '');
    const method = r.request().method();
    if (path === '' && method === 'GET') {
      return json({ chat: CHAT, role: 'buyer', offerId: '00000000-0000-4000-8000-000000000000', counterparty: { displayName: PAY_SECURED.counterparty }, tradeCode: CODE, disputeOpen: false, tradeSecuredAt: PAY_SECURED.securedAt, attested: attestation !== null, mySignPublic: registered[0]?.signPublic ?? null, createdAt: at, lastMessageAt: null })(r);
    }
    if (path === '/identity' && method === 'POST') {
      const body = r.request().postDataJSON() as (typeof registered)[number];
      if (!(await chatIdentityProofValid(CHAT, 'buyer', body))) return json({ error: 'bad-proof' }, 400)(r);
      if (registered.length > 0) return json({ error: 'identity-exists' }, 409)(r);
      registered.push(body);
      const a: Attestation = { v: 1, trade: CHAT, channels: { chat: channel }, participants: participants()!, issuedAt: new Date().toISOString() };
      attestation = { attestation: a, sig: sodium.to_hex(sodium.crypto_sign_detached(attestationBytes(a), modKey.privateKey)) };
      return json({ ok: true, role: 'buyer' }, 201)(r);
    }
    // The chat key record (design build task 5): the browser, first here, makes it; the stand-in
    // checks it as the API does (signed by the attested buyer, for this chat) and keeps the first.
    if (path === '/key' && method === 'GET') return record ? json({ record })(r) : json({ error: 'no-key' }, 404)(r);
    if (path === '/key' && method === 'POST') {
      if (!attestation) return json({ error: 'chat-not-ready' }, 409)(r);
      if (record) return json({ error: 'key-exists' }, 409)(r);
      try {
        const rec = await verifyChatKeyRecord(r.request().postDataJSON(), { chat: channel, participants: participants()! });
        if (rec.by !== 'buyer') return json({ error: 'bad-key-record' }, 400)(r);
        record = rec;
      } catch {
        return json({ error: 'bad-key-record' }, 400)(r);
      }
      return json({ ok: true }, 201)(r);
    }
    if (path === '/attestation' && method === 'GET') return attestation ? json(attestation)(r) : json({ status: 'pending' }, 202)(r);
    if (path === '/envelopes' && method === 'GET') {
      const after = BigInt(url.searchParams.get('after') ?? '0');
      return json({ envelopes: envelopes.filter((e) => BigInt(e.id) > after), more: false })(r);
    }
    if (path === '/envelopes' && method === 'POST') {
      const env = r.request().postDataJSON() as ChatEnvelopeV2;
      w.posted.push(env);
      const id = String(envelopes.length + 1);
      envelopes.push({ id, senderRole: 'buyer', envelope: env, at });
      return json({ id }, 201)(r);
    }
    return json({ error: 'not-found' }, 404)(r);
  });
  return w;
}

/** RGB(A) pixels of an 8-bit PNG (any filter), as RGB triples. */
function pngPixels(b: Uint8Array): { w: number; h: number; rgb: Uint8Array; types: string[] } {
  const buf = Buffer.from(b);
  const types: string[] = [];
  const idat: Buffer[] = [];
  let w = 0;
  let h = 0;
  let colorType = 0;
  for (let at = 8; at < buf.length; ) {
    const len = buf.readUInt32BE(at);
    const type = buf.toString('latin1', at + 4, at + 8);
    types.push(type);
    const data = buf.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') [w, h, colorType] = [data.readUInt32BE(0), data.readUInt32BE(4), data[9]!];
    if (type === 'IDAT') idat.push(data);
    at += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp]! : 0;
      const up = y > 0 ? out[(y - 1) * stride + x]! : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp]! : 0;
      const v = line[x]!;
      let p = 0;
      if (f === 1) p = a;
      else if (f === 2) p = up;
      else if (f === 3) p = (a + up) >> 1;
      else if (f === 4) {
        const pa = Math.abs(up - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + up - 2 * c);
        p = pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
      }
      out[y * stride + x] = (v + p) & 255;
    }
  }
  const rgb = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) rgb.set(out.subarray(i * bpp, i * bpp + 3), i * 3);
  return { w, h, rgb, types };
}

type Box = { x0: number; y0: number; x1: number; y1: number };
/** The share of a box's pixels that differ from the original by more than a rounding step. */
function changed(a: Uint8Array, b: Uint8Array, w: number, box: Box): number {
  let n = 0;
  let all = 0;
  for (let y = box.y0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++) {
    const i = (y * w + x) * 3;
    all++;
    if (Math.max(Math.abs(a[i]! - b[i]!), Math.abs(a[i + 1]! - b[i + 1]!), Math.abs(a[i + 2]! - b[i + 2]!)) > 3) n++;
  }
  return n / all;
}

test('the buyer adds a payment proof, checks the blur and sends it: the seller decrypts exactly the blurred copy', async ({ page }) => {
  test.setTimeout(180_000);
  const w = await stub(page);
  await page.addInitScript(
    ({ amountAtomic, fiatCents }) => {
      window.__x2fFixtureEscrow = { phase: 'ready', amountAtomic, fiatCents, deal: { poster: 'seller', takeAmountAtomic: amountAtomic } };
      window.__x2fRealChat = true;
    },
    { amountAtomic: PAY_SECURED.amountAtomic, fiatCents: PAY_SECURED.fiatCents },
  );
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/trade/${CODE}`);
  await expect(page.locator('main[data-screen="trade"]')).toHaveAttribute('data-trade-state', 'secured');

  // Pick the screenshot: the editor opens with the tool's regions over the private details.
  await page.locator('[data-part="add-proof"] input[type="file"]').setInputFiles(FIXTURE);
  const editor = page.locator('[data-part="blur-editor"]');
  await expect(editor).toBeVisible({ timeout: 60_000 });
  await expect(editor).toContainText('Check your proof');
  const gt = JSON.parse(await readFile(`${FIXTURE}.json`, 'utf8')) as GroundTruth;
  const mark = (kind: string) => gt.marks.find((m) => m.kind === kind)! as unknown as Box;
  const surface = page.locator('[data-part="blur-surface"]');
  const s = (await surface.boundingBox())!;
  const regions = page.locator('[data-part="blur-region"][data-source="auto"]');
  expect(await regions.count()).toBeGreaterThanOrEqual(4);

  // Take the blur off the phone number (the buyer decides it may show).
  const phone = mark('phone');
  let tookOff = false;
  for (const r of await regions.all()) {
    const b = (await r.boundingBox())!;
    const cy = ((b.y + b.height / 2 - s.y) / s.height) * gt.height;
    if (cy > phone.y0 && cy < phone.y1) {
      await r.click();
      tookOff = true;
      break;
    }
  }
  expect(tookOff).toBe(true);

  // Draw one of their own over the labels left of the name.
  const own: Box = { x0: 24, y0: 100, x1: 120, y1: 138 };
  await page.locator('[data-part="add-blur"]').click();
  await expect(surface).toHaveAttribute('data-drawing', 'true');
  // Clicking the button below the picture can scroll the page: measure the picture again.
  await surface.scrollIntoViewIfNeeded();
  const s2 = (await surface.boundingBox())!;
  const toPage2 = (x: number, y: number) => ({ x: s2.x + (x / gt.width) * s2.width, y: s2.y + (y / gt.height) * s2.height });
  const a = toPage2(own.x0, own.y0);
  const b = toPage2(own.x1, own.y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('[data-part="blur-region"][data-source="manual"]')).toHaveCount(1);

  await page.locator('[data-part="send-proof"]').click();
  await expect(page.locator('[data-part="proof-sent"]')).toBeVisible({ timeout: 60_000 });

  // One PUT: ciphertext, octet-stream, no file name or image magic.
  expect(w.puts).toHaveLength(1);
  const put = w.puts[0]!;
  const proofId = new URL(put.url).pathname.split('/').at(-1)!;
  expect(new URL(put.url).search).toBe('?kind=proof');
  expect(put.headers['content-type']).toBe('application/octet-stream');
  expect(JSON.stringify(put.headers)).not.toContain('bank-labelled');
  // Ciphertext is random: a short byte run turns up somewhere in it by chance now and then, so check
  // that it does not start with an image header (a file's magic is at its start), not that the bytes
  // appear nowhere. The seller's decrypt below proves the plaintext is the blurred copy.
  expect(put.body.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
  expect(put.body.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))).toBe(false);

  // The chat: one proof.attached, envelope v2 under the chat key (decision 16), which the seller
  // opens with its own copy of the key (the key and facts only).
  expect(w.posted).toHaveLength(1);
  expect(w.posted[0]!.v).toBe(2);
  const tk = await openChatKeyRecord(w.record()!, 'seller', w.seller);
  const opened = await openChat(w.posted[0]!, { tk, trade: w.channel, participants: w.participants()!, guard: new ReplayGuard(w.channel) });
  expect(opened.type).toBe('proof.attached');
  const p = parseProofPayload('proof.attached', opened.payload).payload as ProofAttachedPayload;
  expect(p.proofId).toBe(proofId);
  expect(p.kind).toBe('proof');
  expect(p.hidden).toEqual(expect.arrayContaining(['card', 'iban', 'email', 'manual']));
  expect(JSON.stringify(w.posted)).not.toContain(p.key);

  // The seller's picture: blurred exactly where the buyer left it.
  const plain = await decryptProof(new Uint8Array(put.body), await proofKeyFromBase64(p.key), { code: CODE, proofId, kind: 'proof', sha256: p.sha256 });
  const sent = pngPixels(plain);
  expect(sent.types.filter((t) => t !== 'IDAT')).toEqual(['IHDR', 'IEND']);
  const orig = pngPixels(await readFile(FIXTURE));
  expect([sent.w, sent.h]).toEqual([orig.w, orig.h]);
  for (const k of ['card', 'iban', 'email']) expect(changed(sent.rgb, orig.rgb, orig.w, mark(k)), k).toBeGreaterThan(0.5);
  expect(changed(sent.rgb, orig.rgb, orig.w, own), 'own region').toBeGreaterThan(0.3);
  for (const k of ['phone', 'amount', 'code']) expect(changed(sent.rgb, orig.rgb, orig.w, mark(k)), k).toBeLessThan(0.02);

  // The blur check: announced with the blur kind, asked, answered with the proof id only.
  expect(w.announced).toEqual([{ url: `${BASE}/v1/trades/${CODE}/proofs/${proofId}/blur-check`, body: { blur: 'both' } }]);
  await page.locator('[data-part="blur-check-answers"]').getByRole('button', { name: 'Yes' }).click();
  await expect(page.locator('[data-part="blur-check-thanks"]')).toBeVisible();
  expect(w.answers).toEqual([{ url: `${BASE}/v1/trades/${CODE}/blur-checks/${proofId}`, body: { correct: true } }]);
  expect(errors).toEqual([]);
});
