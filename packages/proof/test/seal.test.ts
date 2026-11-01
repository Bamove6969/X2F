import { createHash } from 'node:crypto';
import sodium from 'libsodium-wrappers';
import { ProtocolError, ReplayGuard, generateIdentity, open, seal, type Identity, type Participants } from '@x2f/protocol';
import { describe, expect, it } from 'vitest';
import {
  PROOF_KINDS,
  PROOF_MAX_CIPHERTEXT,
  PROOF_MAX_SIDE,
  PROOF_RECIPIENTS,
  ProofError,
  decryptProof,
  encryptProof,
  isProofId,
  newProofId,
  parseProofPayload,
  proofKeyFromBase64,
  proofKeyToBase64,
  sealProofEnvelope,
  type ProofKind,
} from '../src/index.js';

const CODE = 'K7M2-9QXA-4FTR-8WPN';
const OTHER_CODE = 'K7M2-9QXA-4FTR-8WPM';
const NONCE_BYTES = 24;
const TAG_BYTES = 16;

const image = (n = 1000): Uint8Array => {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (i * 31 + 7) & 0xff;
  return b;
};
const hex = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
const b64 = (b: Uint8Array): Promise<string> => proofKeyToBase64(b);

async function proofCode(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ProofError) return e.code;
    throw e;
  }
  return 'no error';
}

function payloadCode(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof ProofError) return e.code;
    throw e;
  }
  return 'no error';
}

describe('encryptProof / decryptProof', () => {
  it('round trips every kind, with the plaintext sha256 as lower-case hex', async () => {
    for (const kind of ['proof', 'evidence', 'unblurred'] as const) {
      const plain = image();
      const proofId = newProofId();
      const { ciphertext, key, sha256 } = await encryptProof(plain, { code: CODE, proofId, kind });
      expect(key.length).toBe(32);
      expect(sha256).toBe(hex(plain));
      expect(ciphertext.length).toBe(NONCE_BYTES + plain.length + TAG_BYTES);
      const out = await decryptProof(ciphertext, key, { code: CODE, proofId, kind, sha256 });
      expect(Buffer.from(out).equals(Buffer.from(plain))).toBe(true);
    }
  });

  it('binds the normalized trade code: the same code typed without dashes or in lower case still opens', async () => {
    const proofId = newProofId();
    const { ciphertext, key, sha256 } = await encryptProof(image(), { code: CODE, proofId, kind: 'proof' });
    const out = await decryptProof(ciphertext, key, { code: 'k7m29qxa4ftr8wpn', proofId, kind: 'proof', sha256 });
    expect(out.length).toBe(1000);
  });

  it('a ciphertext moved to another trade code, proof id or kind is bad-ciphertext', async () => {
    const proofId = newProofId();
    const { ciphertext, key, sha256 } = await encryptProof(image(), { code: CODE, proofId, kind: 'proof' });
    expect(await proofCode(decryptProof(ciphertext, key, { code: OTHER_CODE, proofId, kind: 'proof', sha256 }))).toBe('bad-ciphertext');
    expect(await proofCode(decryptProof(ciphertext, key, { code: CODE, proofId: newProofId(), kind: 'proof', sha256 }))).toBe('bad-ciphertext');
    for (const kind of ['evidence', 'unblurred'] as const) {
      expect(await proofCode(decryptProof(ciphertext, key, { code: CODE, proofId, kind, sha256 }))).toBe('bad-ciphertext');
    }
  });

  it('one flipped byte anywhere (nonce, body, tag) is bad-ciphertext', async () => {
    const proofId = newProofId();
    const a = { code: CODE, proofId, kind: 'proof' as ProofKind };
    const { ciphertext, key, sha256 } = await encryptProof(image(), a);
    for (const at of [0, NONCE_BYTES - 1, NONCE_BYTES, NONCE_BYTES + 500, ciphertext.length - 1]) {
      const bad = ciphertext.slice();
      bad[at] = (bad[at] ?? 0) ^ 0x01;
      expect(await proofCode(decryptProof(bad, key, { ...a, sha256 }))).toBe('bad-ciphertext');
    }
  });

  it('a wrong key, a truncated or an empty ciphertext is bad-ciphertext', async () => {
    const proofId = newProofId();
    const a = { code: CODE, proofId, kind: 'proof' as ProofKind };
    const { ciphertext, key, sha256 } = await encryptProof(image(), a);
    const other = key.slice();
    other[0] = (other[0] ?? 0) ^ 0x80;
    expect(await proofCode(decryptProof(ciphertext, other, { ...a, sha256 }))).toBe('bad-ciphertext');
    expect(await proofCode(decryptProof(ciphertext.subarray(0, NONCE_BYTES + TAG_BYTES - 1), key, { ...a, sha256 }))).toBe('bad-ciphertext');
    expect(await proofCode(decryptProof(new Uint8Array(0), key, { ...a, sha256 }))).toBe('bad-ciphertext');
    expect(await proofCode(decryptProof(ciphertext, key.subarray(0, 31), { ...a, sha256 }))).toBe('bad-ciphertext');
  });

  it('checks sha256 after decrypting: a mismatching hash is refused', async () => {
    const proofId = newProofId();
    const a = { code: CODE, proofId, kind: 'proof' as ProofKind };
    const { ciphertext, key } = await encryptProof(image(), a);
    expect(await proofCode(decryptProof(ciphertext, key, { ...a, sha256: hex(image(999)) }))).toBe('bad-ciphertext');
  });

  it('two encryptions of the same image use different keys and nonces', async () => {
    const proofId = newProofId();
    const a = { code: CODE, proofId, kind: 'proof' as ProofKind };
    const one = await encryptProof(image(), a);
    const two = await encryptProof(image(), a);
    expect(Buffer.from(one.key).equals(Buffer.from(two.key))).toBe(false);
    expect(Buffer.from(one.ciphertext.subarray(0, NONCE_BYTES)).equals(Buffer.from(two.ciphertext.subarray(0, NONCE_BYTES)))).toBe(false);
    expect(Buffer.from(one.ciphertext).equals(Buffer.from(two.ciphertext))).toBe(false);
    expect(one.sha256).toBe(two.sha256);
  });

  it('encryptProof refuses invalid arguments with a TypeError', async () => {
    const proofId = newProofId();
    await expect(encryptProof(image(), { code: 'not a code', proofId, kind: 'proof' })).rejects.toThrow(TypeError);
    await expect(encryptProof(image(), { code: CODE, proofId: 'x', kind: 'proof' })).rejects.toThrow(TypeError);
    await expect(encryptProof(image(), { code: CODE, proofId, kind: 'other' as ProofKind })).rejects.toThrow(TypeError);
  });

  it('pins the layout and AAD: raw libsodium opens nonce || AEAD output with the literal AAD (M1)', async () => {
    await sodium.ready;
    const proofId = newProofId();
    const plain = image(777);
    // A lower-case, space-separated code: the AAD carries the normalized, dashed form.
    const { ciphertext, key } = await encryptProof(plain, { code: 'k7m2 9qxa 4ftr 8wpn', proofId, kind: 'evidence' });
    const aad = new TextEncoder().encode(`x2f/proof/v1\0K7M2-9QXA-4FTR-8WPN\0${proofId}\0evidence`);
    const out = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ciphertext.subarray(24), aad, ciphertext.subarray(0, 24), key);
    expect(Buffer.from(out).equals(Buffer.from(plain))).toBe(true);
  });

  it('refuses a ciphertext over PROOF_MAX_CIPHERTEXT (4 MiB) as bad-ciphertext (N1)', async () => {
    expect(PROOF_MAX_CIPHERTEXT).toBe(4 * 1024 * 1024);
    const proofId = newProofId();
    const a = { code: CODE, proofId, kind: 'proof' as ProofKind };
    const { key, sha256 } = await encryptProof(image(), a);
    expect(await proofCode(decryptProof(new Uint8Array(PROOF_MAX_CIPHERTEXT + 1), key, { ...a, sha256 }))).toBe('bad-ciphertext');
    // A genuine ciphertext (right key and AAD) one byte over the limit is refused...
    const over = await encryptProof(image(PROOF_MAX_CIPHERTEXT - NONCE_BYTES - TAG_BYTES + 1), a);
    expect(over.ciphertext.length).toBe(PROOF_MAX_CIPHERTEXT + 1);
    expect(await proofCode(decryptProof(over.ciphertext, over.key, { ...a, sha256: over.sha256 }))).toBe('bad-ciphertext');
    // ...and one exactly at the limit decrypts.
    const at = await encryptProof(image(PROOF_MAX_CIPHERTEXT - NONCE_BYTES - TAG_BYTES), a);
    expect(at.ciphertext.length).toBe(PROOF_MAX_CIPHERTEXT);
    expect((await decryptProof(at.ciphertext, at.key, { ...a, sha256: at.sha256 })).length).toBe(PROOF_MAX_CIPHERTEXT - NONCE_BYTES - TAG_BYTES);
  });

  it('decryptProof refuses invalid arguments with a TypeError: sha256 must be 64 lower-case hex (N2, N3)', async () => {
    const proofId = newProofId();
    const a = { code: CODE, proofId, kind: 'proof' as ProofKind };
    const { ciphertext, key, sha256 } = await encryptProof(image(), a);
    for (const bad of [sha256.toUpperCase(), sha256.slice(0, 63), `${sha256}0`, '', 7]) {
      await expect(decryptProof(ciphertext, key, { ...a, sha256: bad as string })).rejects.toThrow(TypeError);
    }
    await expect(decryptProof([...ciphertext] as unknown as Uint8Array, key, { ...a, sha256 })).rejects.toThrow(TypeError);
    await expect(decryptProof(ciphertext, [...key] as unknown as Uint8Array, { ...a, sha256 })).rejects.toThrow(TypeError);
    await expect(decryptProof(ciphertext, key, null as unknown as typeof a & { sha256: string })).rejects.toThrow(TypeError);
    await expect(decryptProof(ciphertext, key, { ...a, code: 'nope', sha256 })).rejects.toThrow(TypeError);
  });

  it('no error message carries the proof id or the trade code (N3)', async () => {
    const proofId = newProofId();
    const a = { code: CODE, proofId, kind: 'proof' as ProofKind };
    const { ciphertext, key, sha256 } = await encryptProof(image(), a);
    const msgs: string[] = [];
    const grab = async (p: Promise<unknown>): Promise<void> => {
      try {
        await p;
      } catch (e) {
        msgs.push((e as Error).message);
      }
    };
    await grab(decryptProof(ciphertext, key, { ...a, code: OTHER_CODE, sha256 }));
    await grab(decryptProof(ciphertext, key, { ...a, sha256: 'A'.repeat(64) }));
    await grab(encryptProof(image(), { code: CODE, proofId: `${proofId}X`, kind: 'proof' }));
    await grab(encryptProof(image(), { code: `${CODE}X`, proofId, kind: 'proof' }));
    try {
      parseProofPayload('proof.unblurred', { proofId, key: 'x', sha256, width: 1, height: 1, mime: 'image/png' });
    } catch (e) {
      msgs.push((e as Error).message);
    }
    expect(msgs).toHaveLength(5);
    for (const m of msgs) {
      expect(m).not.toContain(proofId);
      expect(m).not.toContain(CODE);
      expect(m.replace(/-/g, '')).not.toContain(CODE.replace(/-/g, ''));
    }
  });
});

describe('proof key base64 (M3)', () => {
  it('round trips a 32-byte key through padded standard base64 and parseProofPayload', async () => {
    const { key, sha256 } = await encryptProof(image(), { code: CODE, proofId: newProofId(), kind: 'proof' });
    const s = await proofKeyToBase64(key);
    expect(s).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    const p = parseProofPayload('proof.unblurred', { proofId: newProofId(), key: s, sha256, width: 10, height: 10, mime: 'image/png' });
    expect(Buffer.from(await proofKeyFromBase64(p.payload.key)).equals(Buffer.from(key))).toBe(true);
    // Bytes that encode to + and / in the standard alphabet.
    const odd = new Uint8Array(32).fill(0xfb);
    expect(await proofKeyToBase64(odd)).toContain('+');
    expect(Buffer.from(await proofKeyFromBase64(await proofKeyToBase64(odd))).equals(Buffer.from(odd))).toBe(true);
  });

  it('refuses keys that are not 32 bytes and base64 that is not canonical padded standard', async () => {
    await sodium.ready;
    await expect(proofKeyToBase64(new Uint8Array(31))).rejects.toThrow(TypeError);
    const key = new Uint8Array(32).fill(0xfb);
    const good = await proofKeyToBase64(key);
    const urlsafe = sodium.to_base64(key); // libsodium's default: URL-safe, no padding
    const long = sodium.to_base64(new Uint8Array(33), sodium.base64_variants.ORIGINAL);
    for (const s of [urlsafe, good.slice(0, -1), long, '', `${good.slice(0, -2)}9=`]) {
      expect(await proofCode(proofKeyFromBase64(s)), s).toBe('bad-payload');
    }
    // parseProofPayload refuses the same strings.
    expect(payloadCode(() => parseProofPayload('proof.unblurred', { proofId: newProofId(), key: urlsafe, sha256: 'a'.repeat(64), width: 1, height: 1, mime: 'image/png' }))).toBe('bad-payload');
  });
});

describe('newProofId', () => {
  it('isProofId and PROOF_KINDS are exported (N4)', () => {
    expect(isProofId(newProofId())).toBe(true);
    expect(isProofId('abc')).toBe(false);
    expect(isProofId(7)).toBe(false);
    expect(PROOF_KINDS).toEqual(['proof', 'evidence', 'unblurred']);
  });
  it('is 16 random bytes as 26 Crockford base32 characters, different every time', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const id = newProofId();
      expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{25}[048CGMRW]$/);
      ids.add(id);
    }
    expect(ids.size).toBe(200);
  });
});

async function participants(): Promise<{ ids: Record<'buyer' | 'seller' | 'mod', Identity>; parts: Participants }> {
  const ids = { buyer: await generateIdentity(), seller: await generateIdentity(), mod: await generateIdentity() };
  const pk = (i: Identity): { signPublic: string; boxPublic: string } => ({ signPublic: i.signPublic, boxPublic: i.boxPublic });
  return { ids, parts: { buyer: pk(ids.buyer), seller: pk(ids.seller), mod: pk(ids.mod) } };
}

describe('sealed key payloads (Plan 1 seal/open)', () => {
  const CHANNEL = 'K7M2-9QXA-4FTR-8WPN';

  it('a proof.unblurred envelope sealed by the buyer opens for the mod identity and throws not-for-me for the seller', async () => {
    const { ids, parts } = await participants();
    const plain = image(4000);
    const proofId = newProofId();
    const enc = await encryptProof(plain, { code: CODE, proofId, kind: 'unblurred' });
    const payload = { proofId, key: await b64(enc.key), sha256: enc.sha256, width: 1170, height: 2532, mime: 'image/png' };
    expect(parseProofPayload('proof.unblurred', payload).payload).toEqual(payload);
    const env = await seal({
      trade: CHANNEL,
      from: 'buyer',
      seq: 0,
      type: 'proof.unblurred',
      payload,
      to: ['mod'],
      me: ids.buyer,
      participants: parts,
    });

    const opened = await open(env, { me: ids.mod, myRole: 'mod', participants: parts, trade: CHANNEL, guard: new ReplayGuard(CHANNEL) });
    expect(opened.from).toBe('buyer');
    const parsed = parseProofPayload(opened.type, opened.payload);
    expect(parsed.type).toBe('proof.unblurred');
    const key = await proofKeyFromBase64(parsed.payload.key);
    const out = await decryptProof(enc.ciphertext, key, { code: CODE, proofId: parsed.payload.proofId, kind: 'unblurred', sha256: parsed.payload.sha256 });
    expect(Buffer.from(out).equals(Buffer.from(plain))).toBe(true);

    let err: unknown;
    try {
      await open(env, { me: ids.seller, myRole: 'seller', participants: parts, trade: CHANNEL, guard: new ReplayGuard(CHANNEL) });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ProtocolError);
    expect((err as ProtocolError).code).toBe('not-for-me');
  });

  it('a proof.attached envelope sealed to buyer, seller and mod opens for the seller and parses', async () => {
    const { ids, parts } = await participants();
    const proofId = newProofId();
    const enc = await encryptProof(image(), { code: CODE, proofId, kind: 'proof' });
    const payload = { proofId, kind: 'proof', key: await b64(enc.key), sha256: enc.sha256, width: 1170, height: 2532, mime: 'image/jpeg', hidden: ['card', 'email'] };
    const env = await seal({ trade: CHANNEL, from: 'buyer', seq: 1, type: 'proof.attached', payload, to: ['buyer', 'seller', 'mod'], me: ids.buyer, participants: parts });
    const opened = await open(env, { me: ids.seller, myRole: 'seller', participants: parts, trade: CHANNEL, guard: new ReplayGuard(CHANNEL) });
    const parsed = parseProofPayload(opened.type, opened.payload);
    expect(parsed).toEqual({ type: 'proof.attached', payload });
  });
});

describe('parseProofPayload', () => {
  // Padded standard base64 of 32, 31 and 33 bytes of 0x07 (literals: no Buffer, no sodium.ready).
  const KEY = `${'BwcH'.repeat(10)}Bwc=`;
  const KEY31 = `${'BwcH'.repeat(10)}Bw==`;
  const KEY33 = 'BwcH'.repeat(11);
  const SHA = 'a'.repeat(64);
  const attached = (): Record<string, unknown> => ({
    proofId: newProofId(),
    kind: 'evidence',
    key: KEY,
    sha256: SHA,
    width: 800,
    height: 600,
    mime: 'image/png',
    hidden: [],
  });
  const unblurred = (): Record<string, unknown> => ({ proofId: newProofId(), key: KEY, sha256: SHA, width: 800, height: 600, mime: 'image/jpeg' });
  const bad = (type: string, p: unknown): string => payloadCode(() => parseProofPayload(type, p));

  it('accepts both shapes', async () => {
    expect(Buffer.from(await proofKeyFromBase64(KEY)).equals(Buffer.alloc(32, 7))).toBe(true);
    expect(bad('proof.attached', attached())).toBe('no error');
    expect(bad('proof.unblurred', unblurred())).toBe('no error');
    expect(bad('proof.attached', { ...attached(), hidden: ['name', 'account', 'card', 'iban', 'address', 'phone', 'email', 'handle', 'manual'] })).toBe('no error');
    expect(bad('proof.attached', { ...attached(), width: PROOF_MAX_SIDE, height: 1 })).toBe('no error');
  });

  it('refuses an extra filename field, and any other extra or missing field', () => {
    expect(bad('proof.attached', { ...attached(), filename: 'IMG_0001.PNG' })).toBe('bad-payload');
    expect(bad('proof.unblurred', { ...unblurred(), filename: 'IMG_0001.PNG' })).toBe('bad-payload');
    expect(bad('proof.unblurred', { ...unblurred(), hidden: [] })).toBe('bad-payload');
    expect(bad('proof.unblurred', { ...unblurred(), kind: 'unblurred' })).toBe('bad-payload');
    for (const k of Object.keys(attached())) {
      const p = attached();
      delete p[k];
      expect(bad('proof.attached', p)).toBe('bad-payload');
    }
  });

  it('refuses keys that are not exactly 32 bytes of canonical base64', () => {
    for (const key of [KEY31, KEY33, '', KEY.replace(/=$/, ''), `${KEY.slice(0, -2)}9=`, 7]) {
      expect(bad('proof.attached', { ...attached(), key })).toBe('bad-payload');
      expect(bad('proof.unblurred', { ...unblurred(), key })).toBe('bad-payload');
    }
  });

  it('refuses a malformed proof id, sha256, size or mime', () => {
    const cases: Array<[string, unknown]> = [
      ['proofId', 'abc'],
      ['proofId', newProofId().toLowerCase()],
      ['proofId', `${newProofId().slice(0, 25)}1`],
      ['sha256', 'A'.repeat(64)],
      ['sha256', 'a'.repeat(63)],
      ['width', 0],
      ['width', PROOF_MAX_SIDE + 1],
      ['height', 1.5],
      ['height', '600'],
      ['mime', 'image/webp'],
      ['mime', 'image/gif'],
    ];
    for (const [k, v] of cases) {
      expect(bad('proof.attached', { ...attached(), [k]: v }), `${k}=${String(v)}`).toBe('bad-payload');
      expect(bad('proof.unblurred', { ...unblurred(), [k]: v }), `${k}=${String(v)}`).toBe('bad-payload');
    }
  });

  it('proof.attached: kind is proof or evidence, hidden is a set of HiddenKind', () => {
    expect(bad('proof.attached', { ...attached(), kind: 'unblurred' })).toBe('bad-payload');
    expect(bad('proof.attached', { ...attached(), hidden: ['ssn'] })).toBe('bad-payload');
    expect(bad('proof.attached', { ...attached(), hidden: ['card', 'card'] })).toBe('bad-payload');
    expect(bad('proof.attached', { ...attached(), hidden: 'card' })).toBe('bad-payload');
  });

  it('refuses unknown types and non-objects', () => {
    expect(bad('chat.msg', attached())).toBe('bad-payload');
    expect(bad('proof.attached', null)).toBe('bad-payload');
    expect(bad('proof.attached', [attached()])).toBe('bad-payload');
    expect(bad('proof.attached', Object.assign(Object.create({ evil: 1 }) as object, attached()))).toBe('bad-payload');
  });
});

describe('sealProofEnvelope (M2)', () => {
  const CHANNEL = 'K7M2-9QXA-4FTR-8WPN';
  const guard = (): ReplayGuard => new ReplayGuard(CHANNEL);

  it('fixes the recipients by type', () => {
    expect(PROOF_RECIPIENTS).toEqual({ 'proof.attached': ['buyer', 'seller', 'mod'], 'proof.unblurred': ['mod'] });
  });

  it('proof.unblurred opens for the mod only: not-for-me for the seller and for the buyer who sealed it', async () => {
    const { ids, parts } = await participants();
    const proofId = newProofId();
    const enc = await encryptProof(image(), { code: CODE, proofId, kind: 'unblurred' });
    const payload = { proofId, key: await proofKeyToBase64(enc.key), sha256: enc.sha256, width: 100, height: 200, mime: 'image/png' as const };
    const env = await sealProofEnvelope({ type: 'proof.unblurred', payload }, { trade: CHANNEL, from: 'buyer', seq: 3, me: ids.buyer, participants: parts });
    const opened = await open(env, { me: ids.mod, myRole: 'mod', participants: parts, trade: CHANNEL, guard: guard() });
    expect(parseProofPayload(opened.type, opened.payload)).toEqual({ type: 'proof.unblurred', payload });
    for (const [role, allowSelf] of [['seller', false], ['buyer', false], ['buyer', true]] as const) {
      let err: unknown;
      try {
        await open(env, { me: ids[role], myRole: role, participants: parts, trade: CHANNEL, guard: guard(), allowSelf });
      } catch (e) {
        err = e;
      }
      expect(err, `${role} allowSelf=${String(allowSelf)}`).toBeInstanceOf(ProtocolError);
      expect((err as ProtocolError).code).toBe('not-for-me');
    }
  });

  it('proof.attached opens for buyer (allowSelf), seller and mod', async () => {
    const { ids, parts } = await participants();
    const enc = await encryptProof(image(), { code: CODE, proofId: newProofId(), kind: 'proof' });
    const payload = { proofId: newProofId(), kind: 'proof' as const, key: await proofKeyToBase64(enc.key), sha256: enc.sha256, width: 1, height: 1, mime: 'image/jpeg' as const, hidden: [] };
    const env = await sealProofEnvelope({ type: 'proof.attached', payload }, { trade: CHANNEL, from: 'buyer', seq: 0, me: ids.buyer, participants: parts });
    for (const role of ['buyer', 'seller', 'mod'] as const) {
      const o = await open(env, { me: ids[role], myRole: role, participants: parts, trade: CHANNEL, guard: guard(), allowSelf: true });
      expect(o.type).toBe('proof.attached');
    }
  });

  it('refuses caller-chosen recipients, type or payload in the seal arguments, and an invalid payload', async () => {
    const { ids, parts } = await participants();
    const enc = await encryptProof(image(), { code: CODE, proofId: newProofId(), kind: 'unblurred' });
    const payload = { proofId: newProofId(), key: await proofKeyToBase64(enc.key), sha256: enc.sha256, width: 1, height: 1, mime: 'image/png' as const };
    const base = { trade: CHANNEL, from: 'buyer' as const, seq: 0, me: ids.buyer, participants: parts };
    for (const extra of [{ to: ['buyer', 'seller', 'mod'] }, { to: ['mod'] }, { type: 'proof.attached' }, { payload }]) {
      await expect(sealProofEnvelope({ type: 'proof.unblurred', payload }, { ...base, ...extra } as typeof base)).rejects.toThrow(TypeError);
    }
    let code = 'no error';
    try {
      await sealProofEnvelope({ type: 'proof.unblurred', payload: { ...payload, filename: 'a.png' } as typeof payload }, base);
    } catch (e) {
      if (e instanceof ProofError) code = e.code;
    }
    expect(code).toBe('bad-payload');
  });
});
