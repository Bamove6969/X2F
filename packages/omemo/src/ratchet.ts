/**
 * X3DH session set-up and the Double Ratchet, exactly as libsignal-protocol-java does them
 * (RatchetingSession, RootKey, ChainKey, SessionCipher; session version 3), so that an OMEMO 0.3
 * client decrypts what this produces. Both directions are built: the sender only ever uses Alice's
 * first message (docs/jabber/omemo-plan.md, section 2.8), the tests run both sides.
 *
 * - Master secret (Alice): 0xFF×32 ‖ DH(IK_A, SPK_B) ‖ DH(EK_A, IK_B) ‖ DH(EK_A, SPK_B) ‖ [DH(EK_A, OPK_B)];
 *   HKDF(zero salt, "WhisperText", 64) → root key, chain key (Alice's receiving chain for SPK_B;
 *   Bob's sending chain). Alice then takes one ratchet step with a fresh ratchet key.
 * - Ratchet step: HKDF(salt = root key, DH(our ratchet, their ratchet), "WhisperRatchet", 64) →
 *   new root key, chain key.
 * - Message keys: HKDF(zero salt, HMAC(chain key, 0x01), "WhisperMessageKeys", 80) → AES-256 key,
 *   MAC key, IV; the next chain key is HMAC(chain key, 0x02).
 * - The plaintext is AES-256-CBC with PKCS#7 padding; the message is `message.ts`'s SignalMessage.
 *
 * A failed decryption leaves the state untouched (libsignal decrypts on a copy and commits after).
 */
import { createCipheriv, createDecipheriv } from 'node:crypto';
import { hkdf, hmac } from './kdf.js';
import {
  encodePreKeyMessage, encodeSignalMessage, parseSignalMessage, verifySignalMessageMac, type ParsedSignalMessage,
} from './message.js';
import { x25519, x25519KeyPair, type KeyPair } from './x25519.js';

const DISCONTINUITY = Buffer.alloc(32, 0xff);
/** libsignal keeps this many receiving chains and this many skipped message keys per chain. */
export const MAX_RECEIVING_CHAINS = 5;
export const MAX_SKIPPED_KEYS = 2000;

export interface MessageKeys {
  cipherKey: Buffer;
  macKey: Buffer;
  iv: Buffer;
  index: number;
}

export interface Chain {
  key: Buffer;
  index: number;
}

export interface PendingPreKey {
  preKeyId?: number;
  signedPreKeyId: number;
  /** Raw 32-byte base public key. */
  baseKey: Buffer;
}

export interface SessionState {
  rootKey: Buffer;
  /** Raw 32-byte identity public keys. */
  localIdentity: Buffer;
  remoteIdentity: Buffer;
  sendingRatchet: KeyPair;
  sendingChain: Chain;
  /** Newest last. */
  receivingChains: Array<{ ratchetKey: Buffer; chain: Chain }>;
  previousCounter: number;
  skipped: Array<{ ratchetKey: Buffer; keys: MessageKeys }>;
  /** Set for Alice: every message she sends is a PreKeySignalMessage until the peer answers (never, for X2F). */
  pendingPreKey: PendingPreKey | null;
  localRegistrationId: number;
}

export function createChain(rootKey: Uint8Array, dh: Uint8Array): { rootKey: Buffer; chain: Chain } {
  const out = hkdf(dh, 'WhisperRatchet', 64, rootKey);
  return { rootKey: out.subarray(0, 32), chain: { key: out.subarray(32, 64), index: 0 } };
}

export function messageKeys(chain: Chain): MessageKeys {
  const out = hkdf(hmac(chain.key, Buffer.from([0x01])), 'WhisperMessageKeys', 80);
  return { cipherKey: out.subarray(0, 32), macKey: out.subarray(32, 64), iv: out.subarray(64, 80), index: chain.index };
}

export const nextChain = (chain: Chain): Chain => ({ key: hmac(chain.key, Buffer.from([0x02])), index: chain.index + 1 });

function deriveInitial(parts: Uint8Array[]): { rootKey: Buffer; chain: Chain } {
  const out = hkdf(Buffer.concat([DISCONTINUITY, ...parts]), 'WhisperText', 64);
  return { rootKey: out.subarray(0, 32), chain: { key: out.subarray(32, 64), index: 0 } };
}

export interface AliceParameters {
  ourIdentity: KeyPair;
  ourBaseKey: KeyPair;
  /** Raw 32-byte public keys from the peer's bundle. */
  theirIdentity: Buffer;
  theirSignedPreKey: Buffer;
  theirOneTimePreKey?: Buffer;
  /** The ids that go into the PreKeySignalMessage. */
  signedPreKeyId: number;
  preKeyId?: number;
  registrationId: number;
  /** Alice's first ratchet key; fresh unless a test passes one. */
  ourSendingRatchet?: KeyPair;
}

/** Alice (the one who fetched a bundle): the session is ready to send; its first messages are PreKeySignalMessages. */
export function initAlice(p: AliceParameters): SessionState {
  const initial = deriveInitial([
    x25519(p.ourIdentity.privateKey, p.theirSignedPreKey),
    x25519(p.ourBaseKey.privateKey, p.theirIdentity),
    x25519(p.ourBaseKey.privateKey, p.theirSignedPreKey),
    ...(p.theirOneTimePreKey ? [x25519(p.ourBaseKey.privateKey, p.theirOneTimePreKey)] : []),
  ]);
  const sendingRatchet = p.ourSendingRatchet ?? x25519KeyPair();
  const step = createChain(initial.rootKey, x25519(sendingRatchet.privateKey, p.theirSignedPreKey));
  return {
    rootKey: step.rootKey,
    localIdentity: p.ourIdentity.publicKey,
    remoteIdentity: p.theirIdentity,
    sendingRatchet,
    sendingChain: step.chain,
    receivingChains: [{ ratchetKey: p.theirSignedPreKey, chain: initial.chain }],
    previousCounter: 0,
    skipped: [],
    pendingPreKey: { ...(p.preKeyId === undefined ? {} : { preKeyId: p.preKeyId }), signedPreKeyId: p.signedPreKeyId, baseKey: p.ourBaseKey.publicKey },
    localRegistrationId: p.registrationId,
  };
}

export interface BobParameters {
  ourIdentity: KeyPair;
  ourSignedPreKey: KeyPair;
  ourOneTimePreKey?: KeyPair;
  /** Raw 32-byte public keys from the PreKeySignalMessage. */
  theirIdentity: Buffer;
  theirBaseKey: Buffer;
  registrationId: number;
}

/** Bob (who received a PreKeySignalMessage): his sending ratchet is his signed prekey. */
export function initBob(p: BobParameters): SessionState {
  const initial = deriveInitial([
    x25519(p.ourSignedPreKey.privateKey, p.theirIdentity),
    x25519(p.ourIdentity.privateKey, p.theirBaseKey),
    x25519(p.ourSignedPreKey.privateKey, p.theirBaseKey),
    ...(p.ourOneTimePreKey ? [x25519(p.ourOneTimePreKey.privateKey, p.theirBaseKey)] : []),
  ]);
  return {
    rootKey: initial.rootKey,
    localIdentity: p.ourIdentity.publicKey,
    remoteIdentity: p.theirIdentity,
    sendingRatchet: p.ourSignedPreKey,
    sendingChain: initial.chain,
    receivingChains: [],
    previousCounter: 0,
    skipped: [],
    pendingPreKey: null,
    localRegistrationId: p.registrationId,
  };
}

function cbcEncrypt(keys: MessageKeys, plaintext: Uint8Array): Buffer {
  const c = createCipheriv('aes-256-cbc', keys.cipherKey, keys.iv);
  return Buffer.concat([c.update(plaintext), c.final()]);
}

function cbcDecrypt(keys: MessageKeys, ciphertext: Uint8Array): Buffer {
  const d = createDecipheriv('aes-256-cbc', keys.cipherKey, keys.iv);
  return Buffer.concat([d.update(ciphertext), d.final()]);
}

/**
 * Encrypts one message, advancing the sending chain. The result is a SignalMessage, or a
 * PreKeySignalMessage wrapping it while `pendingPreKey` is set.
 */
export function encrypt(state: SessionState, plaintext: Uint8Array): Buffer {
  const keys = messageKeys(state.sendingChain);
  const message = encodeSignalMessage(
    { ratchetKey: state.sendingRatchet.publicKey, counter: state.sendingChain.index, previousCounter: state.previousCounter, ciphertext: cbcEncrypt(keys, plaintext) },
    keys.macKey, state.localIdentity, state.remoteIdentity,
  );
  state.sendingChain = nextChain(state.sendingChain);
  if (state.pendingPreKey === null) return message;
  return encodePreKeyMessage({
    registrationId: state.localRegistrationId,
    ...(state.pendingPreKey.preKeyId === undefined ? {} : { preKeyId: state.pendingPreKey.preKeyId }),
    signedPreKeyId: state.pendingPreKey.signedPreKeyId,
    baseKey: state.pendingPreKey.baseKey,
    identityKey: state.localIdentity,
    message,
  });
}

function clone(s: SessionState): SessionState {
  return {
    ...s,
    receivingChains: s.receivingChains.map((c) => ({ ratchetKey: c.ratchetKey, chain: { ...c.chain } })),
    sendingChain: { ...s.sendingChain },
    skipped: [...s.skipped],
    pendingPreKey: s.pendingPreKey === null ? null : { ...s.pendingPreKey },
  };
}

/** The message keys for `counter` on the chain for `theirRatchetKey`, advancing it and storing skipped keys. */
function keysFor(s: SessionState, theirRatchetKey: Buffer, counter: number): MessageKeys {
  let entry = s.receivingChains.find((c) => c.ratchetKey.equals(theirRatchetKey));
  if (entry === undefined) {
    const receiving = createChain(s.rootKey, x25519(s.sendingRatchet.privateKey, theirRatchetKey));
    const newRatchet = x25519KeyPair();
    const sending = createChain(receiving.rootKey, x25519(newRatchet.privateKey, theirRatchetKey));
    s.rootKey = sending.rootKey;
    entry = { ratchetKey: theirRatchetKey, chain: receiving.chain };
    s.receivingChains.push(entry);
    while (s.receivingChains.length > MAX_RECEIVING_CHAINS) {
      const dropped = s.receivingChains.shift()!;
      s.skipped = s.skipped.filter((k) => !k.ratchetKey.equals(dropped.ratchetKey));
    }
    s.previousCounter = Math.max(s.sendingChain.index - 1, 0);
    s.sendingRatchet = newRatchet;
    s.sendingChain = sending.chain;
  }
  if (entry.chain.index > counter) {
    const i = s.skipped.findIndex((k) => k.ratchetKey.equals(theirRatchetKey) && k.keys.index === counter);
    if (i < 0) throw new Error('ratchet: duplicate or too old message');
    return s.skipped.splice(i, 1)[0]!.keys;
  }
  if (counter - entry.chain.index > MAX_SKIPPED_KEYS) throw new Error('ratchet: message too far ahead');
  while (entry.chain.index < counter) {
    s.skipped.push({ ratchetKey: theirRatchetKey, keys: messageKeys(entry.chain) });
    entry.chain = nextChain(entry.chain);
  }
  if (s.skipped.length > MAX_SKIPPED_KEYS) s.skipped.splice(0, s.skipped.length - MAX_SKIPPED_KEYS);
  const keys = messageKeys(entry.chain);
  entry.chain = nextChain(entry.chain);
  return keys;
}

/** Decrypts a SignalMessage (parsed or raw bytes); throws, leaving `state` as it was, on any failure. */
export function decrypt(state: SessionState, message: Uint8Array | ParsedSignalMessage): Buffer {
  const m = message instanceof Uint8Array ? parseSignalMessage(message) : message;
  const work = clone(state);
  const keys = keysFor(work, m.ratchetKey, m.counter);
  if (!verifySignalMessageMac(m, keys.macKey, work.remoteIdentity, work.localIdentity)) throw new Error('ratchet: bad mac');
  const plaintext = cbcDecrypt(keys, m.ciphertext);
  // The peer has our identity and base key now: later messages need no prekey wrapper.
  work.pendingPreKey = null;
  Object.assign(state, work);
  return plaintext;
}
