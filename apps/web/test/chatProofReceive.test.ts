// NEEDS_PROOF_RECEIVE (Plan 5 Task 15, receiving half): a chat opens `proof.attached` (the proof's
// key and facts, sealed to buyer, seller and mod; the picture itself is ciphertext on the API).
// Rules on the receiving device, whatever the sender's device did:
// - kind 'proof' (the payment proof) only from the buyer;
// - kind 'evidence' only from a trader, and only while a dispute is open;
// - `proof.unblurred` is never a chat line (it is sealed to the moderator only);
// - a malformed payload is refused.
// A refused one is a ChatError('bad-message'): the engine marks it refused for good (no line).
import { newProofId, proofKeyToBase64, sealProofEnvelope, type ProofAttachedPayload } from '@x2f/proof';
import { type Envelope, type Identity, type Participants, seal } from '@x2f/protocol';
import sodium from 'libsodium-wrappers';
import { beforeAll, describe, expect, it } from 'vitest';
import { ChatError, chatChannel, newChatState, openChatMessage } from '../src/chat/chatCrypto.js';
import { newTradeCode, type Role } from '@x2f/core';

async function testIdentity(): Promise<Identity> {
  await sodium.ready;
  const kp = sodium.crypto_sign_keypair();
  return {
    signPublic: sodium.to_hex(kp.publicKey),
    boxPublic: sodium.to_hex(sodium.crypto_sign_ed25519_pk_to_curve25519(kp.publicKey)),
    signSecret: kp.privateKey,
    boxSecret: sodium.crypto_sign_ed25519_sk_to_curve25519(kp.privateKey),
  };
}
const pub = (i: Identity) => ({ signPublic: i.signPublic, boxPublic: i.boxPublic });

let ids: Record<Role, Identity>;
let participants: Participants;
let channel: string;

beforeAll(async () => {
  ids = { buyer: await testIdentity(), seller: await testIdentity(), mod: await testIdentity() };
  participants = { buyer: pub(ids.buyer), seller: pub(ids.seller), mod: pub(ids.mod) };
  channel = await chatChannel(newTradeCode());
});

export async function attached(over: Partial<ProofAttachedPayload> = {}): Promise<ProofAttachedPayload> {
  return {
    proofId: newProofId(),
    kind: 'proof',
    key: await proofKeyToBase64(new Uint8Array(32).fill(9)),
    sha256: 'cd'.repeat(32),
    width: 300,
    height: 120,
    mime: 'image/png',
    hidden: ['card'],
    photoTakenAt: null,
    ...over,
  };
}

const sealFrom = (from: Role, payload: ProofAttachedPayload, seq = 0): Promise<Envelope> =>
  sealProofEnvelope({ type: 'proof.attached', payload }, { trade: channel, from, seq, me: ids[from], participants });

const open = (env: unknown, role: Role, o: { disputeOpen?: boolean } = {}) =>
  openChatMessage(env, { role, me: ids[role], participants, state: newChatState(channel), modMayPost: o.disputeOpen === true, evidenceAllowed: o.disputeOpen === true });

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ChatError ? e.code : (e as Error).name;
  }
};

describe('openChatMessage: proof.attached', () => {
  it("the buyer's payment proof opens for the seller (and the buyer's other device) as a proof line, no text", async () => {
    const p = await attached();
    const env = await sealFrom('buyer', p);
    for (const role of ['seller', 'buyer'] as const) {
      const r = await open(env, role);
      expect(r.message).toEqual({ from: 'buyer', seq: 0, text: '', proof: p });
    }
  });

  it("the moderator's chat identity opens it too, inside a dispute", async () => {
    const p = await attached();
    const r = await open(await sealFrom('buyer', p), 'mod', { disputeOpen: true });
    expect(r.message.proof).toEqual(p);
  });

  it('a payment proof from the seller (or the moderator) is refused', async () => {
    expect(await codeOf(open(await sealFrom('seller', await attached()), 'buyer'))).toBe('bad-message');
    expect(await codeOf(open(await sealFrom('mod', await attached()), 'buyer', { disputeOpen: true }))).toBe('bad-message');
  });

  it('evidence: either trader while a dispute is open; refused outside one, and from the moderator', async () => {
    const ev = await attached({ kind: 'evidence' });
    expect(await codeOf(open(await sealFrom('seller', ev), 'buyer'))).toBe('bad-message');
    expect((await open(await sealFrom('seller', ev), 'buyer', { disputeOpen: true })).message.proof).toEqual(ev);
    expect((await open(await sealFrom('buyer', ev), 'seller', { disputeOpen: true })).message.proof).toEqual(ev);
    expect(await codeOf(open(await sealFrom('mod', ev), 'buyer', { disputeOpen: true }))).toBe('bad-message');
  });

  it('a malformed proof.attached is refused (an extra field, a short key)', async () => {
    const p = await attached();
    const env = await seal({ trade: channel, from: 'buyer', seq: 0, type: 'proof.attached', payload: { ...p, extra: 1 }, to: ['buyer', 'seller', 'mod'], me: ids.buyer, participants });
    expect(await codeOf(open(env, 'seller'))).toBe('bad-message');
    const short = await seal({ trade: channel, from: 'buyer', seq: 0, type: 'proof.attached', payload: { ...p, key: 'AAAA' }, to: ['buyer', 'seller', 'mod'], me: ids.buyer, participants });
    expect(await codeOf(open(short, 'seller'))).toBe('bad-message');
  });

  it('proof.unblurred is never a line: a trader cannot even open it, and the moderator gets no chat line from it', async () => {
    const { proofId, key, sha256, width, height, mime } = await attached();
    const env = await sealProofEnvelope({ type: 'proof.unblurred', payload: { proofId, key, sha256, width, height, mime } }, { trade: channel, from: 'buyer', seq: 0, me: ids.buyer, participants });
    expect(await codeOf(open(env, 'seller'))).not.toBe('ok');
    expect(await codeOf(open(env, 'mod', { disputeOpen: true }))).toBe('bad-message');
  });
});
