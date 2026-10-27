/**
 * Signed, encrypted, padded envelopes for escrow messages between buyer, seller and moderator,
 * carried by an untrusted relay.
 *
 * - The plaintext is canonical JSON {type, payload}, padded (0x80 then zeros) to the smallest
 *   bucket of 256/1024/4096/16384/65536 bytes (R9). The relay sees no type and no exact size.
 * - It is encrypted ONCE with crypto_secretbox under a fresh content key K; K is wrapped for each
 *   recipient with crypto_box under one shared nonce. The signed envelope carries
 *   kh = generichash(32, K), so every recipient provably decrypts the same plaintext (R15).
 * - `slots` always holds all three roles; non-recipients get random bytes of the same length (R16).
 * - Ed25519 detached signature over "x2f/envelope/v1\0" + canonical JSON of every field but sig.
 * - Browser-safe: libsodium base64/hex and TextEncoder only, no Node-only APIs.
 */
import sodium from 'libsodium-wrappers';
import { ROLES, type Role } from '@x2f/core';
import { ProtocolError } from './errors.js';
import type { Identity } from './identity.js';
import { canonicalJson, decodePayload, encodePayload } from './payload.js';
import { ReplayGuard } from './replay.js';
import { MAX_TRADE_LEN, hasExactKeys, isPlainObject, isRole, isValidSeq, isValidTrade } from './roles.js';

export interface PublicKeys {
  signPublic: string;
  boxPublic: string;
}

export type Participants = Record<Role, PublicKeys>;

export interface Envelope {
  readonly v: 1;
  readonly trade: string;
  readonly from: Role;
  readonly seq: number;
  /** base64 crypto_box of K (48 bytes) per role; random bytes for non-recipients. */
  readonly slots: Readonly<Record<Role, string>>;
  /** base64 24-byte crypto_box nonce shared by all slots. */
  readonly nonce: string;
  /** lower-case hex generichash(32, K). */
  readonly kh: string;
  /** base64 secretbox of the padded plaintext. */
  readonly ct: string;
  /** base64 24-byte secretbox nonce. */
  readonly ctNonce: string;
  /** lower-case hex Ed25519 detached signature. */
  readonly sig: string;
}

export interface SealArgs {
  trade: string;
  from: Role;
  seq: number;
  type: string;
  payload: unknown;
  to: readonly Role[];
  me: Identity;
  participants: Participants;
}

export interface OpenArgs {
  me: Identity;
  myRole: Role;
  participants: Partial<Participants>;
  trade: string;
  guard: ReplayGuard;
  /** Accept envelopes whose `from` is `myRole` (re-reading one's own messages). Default false. */
  allowSelf?: boolean;
}

export interface Opened {
  type: string;
  payload: unknown;
  /** The verified sender: use this, never the raw frame's `from`. */
  from: Role;
}

const SIG_DOMAIN = 'x2f/envelope/v1\0';
/** The exact own keys of an Envelope, the set checkShape demands (exported for the API-side chat check). */
export const ENVELOPE_KEYS = ['v', 'trade', 'from', 'seq', 'slots', 'nonce', 'kh', 'ct', 'ctNonce', 'sig'] as const;
const INNER_KEYS = ['type', 'payload'] as const;
const BUCKETS = [256, 1024, 4096, 16384, 65536] as const;
const MAX_PADDED = 65536;
const KEY_LEN = 32;
const NONCE_LEN = 24;
const MAC_LEN = 16;
const SLOT_LEN = KEY_LEN + MAC_LEN;
const CT_LENS: ReadonlySet<number> = new Set(BUCKETS.map((b) => b + MAC_LEN));
const b64Len = (bytes: number): number => 4 * Math.ceil(bytes / 3);
const CANONICAL_B64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const LOWER_HEX = /^[0-9a-f]*$/;
// ignoreBOM keeps a leading BOM in the output, so the canonical comparison rejects it.
const utf8Decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const utf8Encoder = new TextEncoder();

const bad = (msg: string): ProtocolError => new ProtocolError('bad-signature', msg);
const toB64 = (b: Uint8Array): string => sodium.to_base64(b, sodium.base64_variants.ORIGINAL);

// ── Padding ─────────────────────────────────────────────────────────────

function pad(data: Uint8Array): Uint8Array {
  if (data.length + 1 > MAX_PADDED) throw new ProtocolError('too-large', 'Plaintext too large');
  const bucket = BUCKETS.find((b) => b >= data.length + 1) ?? MAX_PADDED;
  const out = new Uint8Array(bucket);
  out.set(data);
  out[data.length] = 0x80;
  return out;
}

function unpad(data: Uint8Array): Uint8Array {
  if (!(BUCKETS as readonly number[]).includes(data.length)) throw bad('Invalid plaintext: bad padding');
  let i = data.length - 1;
  while (i >= 0 && data[i] === 0) i--;
  if (i < 0 || data[i] !== 0x80) throw bad('Invalid plaintext: bad padding');
  // The bucket must be the smallest that fits, exactly as pad() chooses.
  if (BUCKETS.find((b) => b >= i + 1) !== data.length) throw bad('Invalid plaintext: bucket too large');
  return data.subarray(0, i);
}

// ── Strict decoding (every failure is ProtocolError naming the field only) ──

function hexField(v: unknown, len: number, field: string): Uint8Array {
  if (typeof v !== 'string' || v.length !== len * 2 || !LOWER_HEX.test(v)) {
    throw bad(`Invalid ${field}: expected ${len} bytes lower-case hex`);
  }
  try {
    return sodium.from_hex(v);
  } catch {
    throw bad(`Invalid ${field}: bad hex`);
  }
}

function b64Field(v: unknown, okLen: (n: number) => boolean, maxChars: number, field: string): Uint8Array {
  if (typeof v !== 'string' || v.length > maxChars || !CANONICAL_B64.test(v)) throw bad(`Invalid ${field}: bad base64`);
  let bytes: Uint8Array;
  try {
    bytes = sodium.from_base64(v, sodium.base64_variants.ORIGINAL);
  } catch {
    throw bad(`Invalid ${field}: bad base64`);
  }
  // Re-encoding must reproduce the input exactly (rejects non-zero trailing bits).
  if (toB64(bytes) !== v) throw bad(`Invalid ${field}: non-canonical base64`);
  if (!okLen(bytes.length)) throw bad(`Invalid ${field}: bad length`);
  return bytes;
}

/** Validate a participant's hex keys and that boxPublic is the X25519 conversion of signPublic. */
function participantKeys(p: unknown, field: string): { sign: Uint8Array; box: Uint8Array } {
  if (!isPlainObject(p)) throw bad(`Invalid ${field}`);
  const sign = hexField(p['signPublic'], sodium.crypto_sign_PUBLICKEYBYTES, `${field}.signPublic`);
  const box = hexField(p['boxPublic'], sodium.crypto_box_PUBLICKEYBYTES, `${field}.boxPublic`);
  let derived: Uint8Array;
  try {
    derived = sodium.crypto_sign_ed25519_pk_to_curve25519(sign);
  } catch {
    throw bad(`Invalid ${field}.signPublic`);
  }
  if (!sodium.memcmp(derived, box)) throw bad(`Invalid ${field}: boxPublic does not match signPublic`);
  return { sign, box };
}

type Unsigned = Omit<Envelope, 'sig'>;

function signedMessage(u: Unsigned): Uint8Array {
  const body = {
    v: u.v,
    trade: u.trade,
    from: u.from,
    seq: u.seq,
    slots: { buyer: u.slots.buyer, seller: u.slots.seller, mod: u.slots.mod },
    nonce: u.nonce,
    kh: u.kh,
    ct: u.ct,
    ctNonce: u.ctNonce,
  };
  return utf8Encoder.encode(SIG_DOMAIN + canonicalJson(body));
}

// ── seal ────────────────────────────────────────────────────────────────

/** Two roles sharing a signPublic or boxPublic would let one key speak for both. */
function assertDistinctKeys(participants: Partial<Participants>, where: string): void {
  const sign = new Set<string>();
  const box = new Set<string>();
  for (const role of ROLES) {
    if (!Object.prototype.hasOwnProperty.call(participants, role)) continue;
    const p = participants[role] as unknown;
    if (!isPlainObject(p)) continue;
    const sp = p['signPublic'];
    const bp = p['boxPublic'];
    if (typeof sp === 'string') {
      if (sign.has(sp.toLowerCase())) throw new TypeError(`${where}: two roles share a signPublic`);
      sign.add(sp.toLowerCase());
    }
    if (typeof bp === 'string') {
      if (box.has(bp.toLowerCase())) throw new TypeError(`${where}: two roles share a boxPublic`);
      box.add(bp.toLowerCase());
    }
  }
}

/**
 * Seal `{type, payload}` for the roles in `to`. Throws TypeError on invalid arguments or an
 * unrepresentable payload, ProtocolError('too-large') when the plaintext exceeds 65535 bytes.
 *
 * Only recipients can decrypt. A sender who wants to re-read its own message later must
 * include itself in `to` (and open it with `allowSelf: true`); otherwise its own slot is
 * random bytes and open() gives 'not-for-me'.
 */
export async function seal(a: SealArgs): Promise<Envelope> {
  await sodium.ready;
  if (typeof a.type !== 'string') throw new TypeError('seal: type must be a string');
  if (!isValidTrade(a.trade)) throw new TypeError('seal: invalid trade');
  if (!isRole(a.from)) throw new TypeError('seal: unknown from role');
  if (!isValidSeq(a.seq)) throw new TypeError('seal: seq must be a non-negative safe integer');
  if (!Array.isArray(a.to) || a.to.length === 0) throw new TypeError('seal: `to` must name at least one recipient');
  for (const r of a.to) if (!isRole(r)) throw new TypeError('seal: unknown recipient role');
  if (!isPlainObject(a.participants)) throw new TypeError('seal: invalid participants');

  const keys = {} as Record<Role, { sign: Uint8Array; box: Uint8Array }>;
  for (const role of ROLES) {
    try {
      keys[role] = participantKeys(a.participants[role], role);
    } catch {
      throw new TypeError(`seal: invalid participant keys for ${role}`);
    }
  }
  assertDistinctKeys(a.participants, 'seal');
  const mine = a.participants[a.from];
  if (a.me.signPublic !== mine.signPublic || a.me.boxPublic !== mine.boxPublic) {
    throw new TypeError('seal: identity does not match participants[from]');
  }
  const { signSecret, boxSecret } = a.me;
  if (
    !(signSecret instanceof Uint8Array) ||
    signSecret.length !== sodium.crypto_sign_SECRETKEYBYTES ||
    !sodium.memcmp(signSecret.subarray(32), keys[a.from].sign)
  ) {
    throw new TypeError('seal: signSecret does not match signPublic');
  }
  if (!(boxSecret instanceof Uint8Array) || boxSecret.length !== KEY_LEN) {
    throw new TypeError('seal: boxSecret does not match boxPublic');
  }
  let boxPub: Uint8Array;
  try {
    boxPub = sodium.crypto_scalarmult_base(boxSecret);
  } catch {
    throw new TypeError('seal: invalid boxSecret');
  }
  if (!sodium.memcmp(boxPub, keys[a.from].box)) throw new TypeError('seal: boxSecret does not match boxPublic');

  const inner = canonicalJson({ type: a.type, payload: encodePayload(a.payload) });
  const padded = pad(utf8Encoder.encode(inner));

  // One content key, one ciphertext for everyone.
  const key = sodium.randombytes_buf(KEY_LEN);
  const ctNonce = sodium.randombytes_buf(NONCE_LEN);
  const nonce = sodium.randombytes_buf(NONCE_LEN);
  const slots = {} as Record<Role, string>;
  let ct: Uint8Array;
  let kh: string;
  try {
    ct = sodium.crypto_secretbox_easy(padded, ctNonce, key);
    const recipients = new Set<Role>(a.to);
    for (const role of ROLES) {
      slots[role] = toB64(
        recipients.has(role)
          ? sodium.crypto_box_easy(key, nonce, keys[role].box, boxSecret)
          : sodium.randombytes_buf(SLOT_LEN),
      );
    }
    kh = sodium.to_hex(sodium.crypto_generichash(32, key, null));
  } finally {
    sodium.memzero(key);
    sodium.memzero(padded);
  }

  const unsigned: Unsigned = {
    v: 1,
    trade: a.trade,
    from: a.from,
    seq: a.seq,
    slots,
    nonce: toB64(nonce),
    kh,
    ct: toB64(ct),
    ctNonce: toB64(ctNonce),
  };
  const sig = sodium.to_hex(sodium.crypto_sign_detached(signedMessage(unsigned), signSecret));
  return { ...unsigned, sig };
}

// ── open ────────────────────────────────────────────────────────────────

const CT_MAX_CHARS = b64Len(MAX_PADDED + MAC_LEN);

/**
 * Copy exactly `keys` from an untrusted object into a fresh null-prototype object, reading
 * each property once through its descriptor (no getters run; Proxy `get` traps are never
 * used). Accessors, non-enumerable or symbol keys, extra or missing keys are rejected. Any
 * exception (e.g. from a Proxy trap) becomes bad-signature. Only the snapshot is used after.
 */
function snapshot(o: unknown, keys: readonly string[], field: string): Record<string, unknown> {
  try {
    if (typeof o !== 'object' || o === null || Array.isArray(o)) throw new Error('not an object');
    const proto = Object.getPrototypeOf(o) as unknown;
    if (proto !== Object.prototype && proto !== null) throw new Error('not plain');
    const own = Reflect.ownKeys(o);
    if (own.length !== keys.length) throw new Error('key count');
    const out = Object.create(null) as Record<string, unknown>;
    for (const k of own) {
      if (typeof k !== 'string' || !keys.includes(k) || Object.prototype.hasOwnProperty.call(out, k)) throw new Error('key');
      const d = Object.getOwnPropertyDescriptor(o, k);
      if (d === undefined || !('value' in d) || d.enumerable !== true) throw new Error('accessor');
      out[k] = d.value;
    }
    return out;
  } catch {
    throw bad(`Invalid ${field}: bad shape`);
  }
}

interface Snapshot extends Unsigned {
  readonly sig: string;
}

/** Shape: snapshot, primitive types and length caps before any decoding. */
function checkShape(e: unknown): Snapshot {
  const s = snapshot(e, ENVELOPE_KEYS, 'envelope');
  const { v, trade, from, seq, nonce, kh, ct, ctNonce, sig } = s;
  if (v !== 1) throw bad('Invalid v');
  if (typeof trade !== 'string' || trade.length > MAX_TRADE_LEN) throw bad('Invalid trade');
  if (typeof from !== 'string' || from.length > 16) throw bad('Invalid from');
  if (!isValidSeq(seq)) throw bad('Invalid seq');
  const slots = snapshot(s['slots'], ROLES, 'slots');
  for (const r of ROLES) {
    const v2 = slots[r];
    if (typeof v2 !== 'string' || v2.length > b64Len(SLOT_LEN)) throw bad(`Invalid slots.${r}`);
  }
  const capped: Array<[string, unknown, number]> = [
    ['nonce', nonce, b64Len(NONCE_LEN)],
    ['ctNonce', ctNonce, b64Len(NONCE_LEN)],
    ['kh', kh, 64],
    ['sig', sig, 128],
    ['ct', ct, CT_MAX_CHARS],
  ];
  for (const [name, val, max] of capped) {
    if (typeof val !== 'string' || val.length > max) throw bad(`Invalid ${name}`);
  }
  return Object.freeze({
    v: 1,
    trade,
    from: from as Role,
    seq,
    slots: Object.freeze({ buyer: slots['buyer'] as string, seller: slots['seller'] as string, mod: slots['mod'] as string }),
    nonce: nonce as string,
    kh: kh as string,
    ct: ct as string,
    ctNonce: ctNonce as string,
    sig: sig as string,
  });
}

/** Parse the decrypted plaintext; it must be exactly the canonical text seal would produce. */
function parsePlaintext(padded: Uint8Array): Omit<Opened, 'from'> {
  const text = utf8Decoder.decode(unpad(padded));
  const parsed = JSON.parse(text) as unknown;
  if (!isPlainObject(parsed) || !hasExactKeys(parsed, INNER_KEYS) || typeof parsed['type'] !== 'string') {
    throw new Error('bad inner shape');
  }
  const opened = { type: parsed['type'], payload: decodePayload(parsed['payload']) };
  // Rejects duplicate keys, key order, whitespace, escapes, number forms and a BOM.
  if (canonicalJson({ type: opened.type, payload: encodePayload(opened.payload) }) !== text) {
    throw new Error('non-canonical plaintext');
  }
  return opened;
}

/**
 * Verify and decrypt an envelope from the relay. `e` is untrusted input of any shape; it is
 * snapshotted once and only the snapshot is used. Every rejection of `e` is a ProtocolError:
 * shape → wrong-trade → not-participant → field encodings → signature → self ('not-for-me'
 * unless `allowSelf`) → unwrap ('not-for-me') → kh → decrypt/unpad/canonical parse → replay
 * (checked and committed only after full success). Invalid OpenArgs throw TypeError.
 *
 * Message identity is (trade, from, seq), or kh + ct for content; never a hash of the wire
 * bytes, which are not unique (e.g. JSON formatting of the envelope itself).
 */
export async function open(e: unknown, a: OpenArgs): Promise<Opened> {
  await sodium.ready;
  if (!isRole(a.myRole)) throw new TypeError('open: unknown myRole');
  if (!(a.guard instanceof ReplayGuard)) throw new TypeError('open: guard must be a ReplayGuard');
  if (!isPlainObject(a.participants)) throw new TypeError('open: invalid participants');
  assertDistinctKeys(a.participants, 'open');

  const env = checkShape(e);

  if (env.trade !== a.trade || a.guard.trade !== a.trade) throw new ProtocolError('wrong-trade', 'Envelope is for another trade');

  const from = env.from;
  const sender = isRole(from) && Object.prototype.hasOwnProperty.call(a.participants, from) ? a.participants[from] : undefined;
  if (!isRole(from) || sender === undefined) throw new ProtocolError('not-participant', 'Sender is not a participant');

  const senderKeys = participantKeys(sender, 'participants[from]');
  for (const r of ROLES) b64Field(env.slots[r], (n) => n === SLOT_LEN, b64Len(SLOT_LEN), `slots.${r}`);
  const slot = b64Field(env.slots[a.myRole], (n) => n === SLOT_LEN, b64Len(SLOT_LEN), `slots.${a.myRole}`);
  const nonce = b64Field(env.nonce, (n) => n === NONCE_LEN, b64Len(NONCE_LEN), 'nonce');
  const ctNonce = b64Field(env.ctNonce, (n) => n === NONCE_LEN, b64Len(NONCE_LEN), 'ctNonce');
  const ct = b64Field(env.ct, (n) => CT_LENS.has(n), CT_MAX_CHARS, 'ct');
  const kh = hexField(env.kh, 32, 'kh');
  const sig = hexField(env.sig, sodium.crypto_sign_BYTES, 'sig');

  let verified = false;
  try {
    verified = sodium.crypto_sign_verify_detached(sig, signedMessage(env), senderKeys.sign);
  } catch {
    verified = false;
  }
  if (!verified) throw bad('Invalid sig');

  if (from === a.myRole && a.allowSelf !== true) {
    throw new ProtocolError('not-for-me', 'Envelope is from this role (pass allowSelf to read it)');
  }

  let key: Uint8Array;
  try {
    key = sodium.crypto_box_open_easy(slot, nonce, senderKeys.box, a.me.boxSecret);
  } catch {
    throw new ProtocolError('not-for-me', 'Envelope is not addressed to this role');
  }

  let padded: Uint8Array;
  try {
    if (key.length !== KEY_LEN || !sodium.memcmp(sodium.crypto_generichash(32, key, null), kh)) {
      throw bad('Invalid kh: content key does not match');
    }
    try {
      padded = sodium.crypto_secretbox_open_easy(ct, ctNonce, key);
    } catch {
      throw bad('Invalid ct: decryption failed');
    }
  } finally {
    sodium.memzero(key);
  }

  let opened: Omit<Opened, 'from'>;
  try {
    opened = parsePlaintext(padded);
  } catch {
    throw bad('Invalid plaintext');
  } finally {
    sodium.memzero(padded);
  }

  if (!a.guard.accept(from, env.seq)) throw new ProtocolError('replay', 'Sequence number already seen');
  return { type: opened.type, payload: opened.payload, from };
}
