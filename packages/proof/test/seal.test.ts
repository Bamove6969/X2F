import { createHash } from 'node:crypto';
import { ProtocolError, ReplayGuard, generateIdentity, open, seal, type Identity, type Participants } from '@x2f/protocol';
import { describe, expect, it } from 'vitest';
import {
  PROOF_MAX_SIDE,
  ProofError,
  decryptProof,
  encryptProof,
  newProofId,
  parseProofPayload,
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
const b64 = (b: Uint8Array): string => Buffer.from(b).toString('base64');

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

  it('refuses invalid arguments before touching any bytes', async () => {
    const proofId = newProofId();
    await expect(encryptProof(image(), { code: 'not a code', proofId, kind: 'proof' })).rejects.toThrow(TypeError);
    await expect(encryptProof(image(), { code: CODE, proofId: 'x', kind: 'proof' })).rejects.toThrow(TypeError);
    await expect(encryptProof(image(), { code: CODE, proofId, kind: 'other' as ProofKind })).rejects.toThrow(TypeError);
  });
});

describe('newProofId', () => {
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
    const payload = { proofId, key: b64(enc.key), sha256: enc.sha256, width: 1170, height: 2532, mime: 'image/png' };
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
    const key = new Uint8Array(Buffer.from(parsed.payload.key, 'base64'));
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
    const payload = { proofId, kind: 'proof', key: b64(enc.key), sha256: enc.sha256, width: 1170, height: 2532, mime: 'image/jpeg', hidden: ['card', 'email'] };
    const env = await seal({ trade: CHANNEL, from: 'buyer', seq: 1, type: 'proof.attached', payload, to: ['buyer', 'seller', 'mod'], me: ids.buyer, participants: parts });
    const opened = await open(env, { me: ids.seller, myRole: 'seller', participants: parts, trade: CHANNEL, guard: new ReplayGuard(CHANNEL) });
    const parsed = parseProofPayload(opened.type, opened.payload);
    expect(parsed).toEqual({ type: 'proof.attached', payload });
  });
});

describe('parseProofPayload', () => {
  const KEY = b64(new Uint8Array(32).fill(7));
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

  it('accepts both shapes', () => {
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
    for (const key of [b64(new Uint8Array(31)), b64(new Uint8Array(33)), '', KEY.replace(/=$/, ''), `${KEY.slice(0, -2)}9=`, 7]) {
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
