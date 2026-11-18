/**
 * Trade chat, one key per chat (design-chat-membership-keys-2026-11-08 sections 2 and 3; design build
 * task 3). REVIEW-PROTOCOL: a protocol change, reviewed on its own. Pure: no storage, no network.
 *
 * - `newChatKey()`: TK, 32 random bytes, made by the first trader device that opens the chat.
 * - `chatKeyHash(TK)`: `tkh`, lower-case hex `crypto_generichash(32, "x2f/chat-key/v1\0" || TK)`, the
 *   fingerprint every member checks once per chat.
 * - `wrapChatKey(boxPublic, TK)` / `unwrapChatKey(pair, wrap, tkh)`: a member's locked copy of TK,
 *   `crypto_box_seal` (`sealTo`) to that member's X25519 key, as canonical base64; unwrapping checks the
 *   copy hashes to the pinned `tkh`, so a copy of some other key never opens a chat.
 * - `sealChat` / `openChat`: envelope v2. One ciphertext under TK for every member:
 *   `crypto_aead_xchacha20poly1305_ietf` of the padded canonical `{type, payload}` (the v1 buckets),
 *   with associated data `"x2f/chat/v2\0" || trade || "\0" || from || "\0" || seq` (NUL-separated, so
 *   no two (trade, from, seq) give the same bytes), and an Ed25519 signature by the sender's attested
 *   chat identity over `"x2f/chat-envelope/v2\0"` + canonical JSON of every other field. No slots, no
 *   per-message key: whoever can read one message can read them all (design section 9, R16).
 * - Signed statements, Ed25519 over a domain string + canonical JSON, all strictly decoded:
 *   - the key record (`x2f/chat-key-record/v1\0`): "TK with fingerprint tkh, locked to the buyer's and
 *     the seller's attested chat identities", signed by its creator (buyer or seller);
 *   - a dispute grant (`x2f/chat-grant/v1\0`, design T1): the disputer's `{chat, by, tkh, wrap,
 *     disputeAt}`, `wrap` being TK sealed to the moderator's chat identity;
 *   - a dispute notice (`x2f/chat-dispute-notice/v1\0`, design T2): the moderator's `{chat, disputeSeq,
 *     openedAt, openedBy}`.
 *   The design names the grant's and the envelope's domains; the key record's and the notice's are this
 *   module's (same pattern), listed for the reviewer.
 *
 * The escrow `signals` channel keeps envelope v1 (`envelope.ts`) unchanged. Browser-safe.
 */
import sodium from 'libsodium-wrappers';
import { ROLES, type Role } from '@x2f/core';
import {
  assertDistinctKeys,
  b64Field,
  hexField,
  pad,
  parsePlaintext,
  participantKeys,
  snapshot,
  type Opened,
  type Participants,
} from './envelope.js';
import { ProtocolError } from './errors.js';
import type { Identity } from './identity.js';
import { canonicalJson, encodePayload } from './payload.js';
import { ReplayGuard } from './replay.js';
import { MAX_TRADE_LEN, isPlainObject, isRole, isValidSeq, isValidTrade } from './roles.js';
import { SEALED_OVERHEAD, openSealed, sealTo, type BoxKeyPair } from './sealed.js';

export const CHAT_KEY_BYTES = 32;
const NONCE_LEN = 24;
const MAC_LEN = 16;
const BUCKETS = [256, 1024, 4096, 16384, 65536] as const;
const CT_LENS: ReadonlySet<number> = new Set(BUCKETS.map((b) => b + MAC_LEN));
const WRAP_LEN = CHAT_KEY_BYTES + SEALED_OVERHEAD;
const b64Len = (bytes: number): number => 4 * Math.ceil(bytes / 3);
const CT_MAX_CHARS = b64Len(65536 + MAC_LEN);
const utf8 = new TextEncoder();
const toB64 = (b: Uint8Array): string => sodium.to_base64(b, sodium.base64_variants.ORIGINAL);
const bad = (msg: string): ProtocolError => new ProtocolError('bad-signature', msg);

const TKH_DOMAIN = 'x2f/chat-key/v1\0';
const AD_DOMAIN = 'x2f/chat/v2\0';
const ENVELOPE_DOMAIN = 'x2f/chat-envelope/v2\0';
const RECORD_DOMAIN = 'x2f/chat-key-record/v1\0';
const GRANT_DOMAIN = 'x2f/chat-grant/v1\0';
const NOTICE_DOMAIN = 'x2f/chat-dispute-notice/v1\0';

export const CHAT_ENVELOPE_V2_KEYS = ['v', 'trade', 'from', 'seq', 'nonce', 'ct', 'sig'] as const;

export interface ChatEnvelopeV2 {
  readonly v: 2;
  /** The chat's channel (`channelFor(chat, 'chat')`), as the attestation names it. */
  readonly trade: string;
  readonly from: Role;
  readonly seq: number;
  /** base64 24-byte XChaCha20 nonce. */
  readonly nonce: string;
  /** base64 AEAD ciphertext of the padded plaintext (bucket + 16). */
  readonly ct: string;
  /** lower-case hex Ed25519 signature. */
  readonly sig: string;
}

// ── TK, tkh, wraps ──────────────────────────────────────────────────────

export async function newChatKey(): Promise<Uint8Array> {
  await sodium.ready;
  return sodium.randombytes_buf(CHAT_KEY_BYTES);
}

function assertKey(tk: unknown, where: string): asserts tk is Uint8Array {
  if (!(tk instanceof Uint8Array) || tk.length !== CHAT_KEY_BYTES) throw new TypeError(`${where}: the chat key must be ${CHAT_KEY_BYTES} bytes`);
}

/** `tkh`: 64 lower-case hex characters. */
export async function chatKeyHash(tk: Uint8Array): Promise<string> {
  await sodium.ready;
  assertKey(tk, 'chatKeyHash');
  const msg = new Uint8Array(TKH_DOMAIN.length + CHAT_KEY_BYTES);
  msg.set(utf8.encode(TKH_DOMAIN));
  msg.set(tk, TKH_DOMAIN.length);
  try {
    return sodium.to_hex(sodium.crypto_generichash(32, msg, null));
  } finally {
    sodium.memzero(msg);
  }
}

/** TK sealed to one member's X25519 key, as canonical base64 (80 bytes). */
export async function wrapChatKey(boxPublic: string, tk: Uint8Array): Promise<string> {
  await sodium.ready;
  assertKey(tk, 'wrapChatKey');
  return toB64(await sealTo(boxPublic, tk));
}

/**
 * Opens a member's wrap and checks it against the pinned `tkh`. A wrap not for this key, malformed,
 * or of some other key: ProtocolError (`not-for-me`, or `bad-signature` for a tkh mismatch).
 */
export async function unwrapChatKey(me: BoxKeyPair, wrap: unknown, tkh: string): Promise<Uint8Array> {
  await sodium.ready;
  const bytes = b64Field(wrap, (n) => n === WRAP_LEN, b64Len(WRAP_LEN), 'wrap');
  const want = hexField(tkh, 32, 'tkh');
  const tk = await openSealed(me, bytes);
  if (tk.length !== CHAT_KEY_BYTES || !sodium.memcmp(sodium.from_hex(await chatKeyHash(tk)), want)) {
    sodium.memzero(tk);
    throw bad('Invalid wrap: the chat key does not match tkh');
  }
  return tk;
}

// ── envelope v2 ─────────────────────────────────────────────────────────

function additionalData(trade: string, from: Role, seq: number): Uint8Array {
  return utf8.encode(`${AD_DOMAIN}${trade}\0${from}\0${seq}`);
}

function envelopeMessage(u: Omit<ChatEnvelopeV2, 'sig'>): Uint8Array {
  return utf8.encode(ENVELOPE_DOMAIN + canonicalJson({ v: u.v, trade: u.trade, from: u.from, seq: u.seq, nonce: u.nonce, ct: u.ct }));
}

/** Checks the identity's secrets match its public keys (as v1 seal does), so a mixed-up identity never signs. */
function signerSecret(me: Identity, expected: { signPublic: string } | undefined, where: string): Uint8Array {
  if (expected !== undefined && me.signPublic !== expected.signPublic) throw new TypeError(`${where}: identity does not match the participant`);
  if (typeof me.signPublic !== 'string' || !/^[0-9a-f]{64}$/.test(me.signPublic)) throw new TypeError(`${where}: invalid signPublic`);
  const { signSecret } = me;
  if (!(signSecret instanceof Uint8Array) || signSecret.length !== sodium.crypto_sign_SECRETKEYBYTES || !sodium.memcmp(signSecret.subarray(32), sodium.from_hex(me.signPublic))) {
    throw new TypeError(`${where}: signSecret does not match signPublic`);
  }
  return signSecret;
}

export interface SealChatArgs {
  trade: string;
  from: Role;
  seq: number;
  type: string;
  payload: unknown;
  tk: Uint8Array;
  /** The sender's attested chat identity (the moderator's, for a moderator message). */
  me: Identity;
}

export async function sealChat(a: SealChatArgs): Promise<ChatEnvelopeV2> {
  await sodium.ready;
  if (typeof a.type !== 'string') throw new TypeError('sealChat: type must be a string');
  if (!isValidTrade(a.trade)) throw new TypeError('sealChat: invalid trade');
  if (!isRole(a.from)) throw new TypeError('sealChat: unknown from role');
  if (!isValidSeq(a.seq)) throw new TypeError('sealChat: seq must be a non-negative safe integer');
  assertKey(a.tk, 'sealChat');
  const secret = signerSecret(a.me, undefined, 'sealChat');
  const padded = pad(utf8.encode(canonicalJson({ type: a.type, payload: encodePayload(a.payload) })));
  const nonce = sodium.randombytes_buf(NONCE_LEN);
  let ct: Uint8Array;
  try {
    ct = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(padded, additionalData(a.trade, a.from, a.seq), null, nonce, a.tk);
  } finally {
    sodium.memzero(padded);
  }
  const unsigned = { v: 2 as const, trade: a.trade, from: a.from, seq: a.seq, nonce: toB64(nonce), ct: toB64(ct) };
  return { ...unsigned, sig: sodium.to_hex(sodium.crypto_sign_detached(envelopeMessage(unsigned), secret)) };
}

export interface OpenChatArgs {
  tk: Uint8Array;
  trade: string;
  /** The attested chat identities (signing keys are what is checked). */
  participants: Partial<Participants>;
  guard: ReplayGuard;
}

/**
 * Verifies and decrypts a v2 chat envelope. Order: shape (snapshot, caps) → wrong-trade →
 * not-participant → encodings → signature → AEAD (with the AD) → padding and canonical parse →
 * replay (committed last). Every member reads every message, its own included: TK is shared.
 */
export async function openChat(e: unknown, a: OpenChatArgs): Promise<Opened> {
  await sodium.ready;
  assertKey(a.tk, 'openChat');
  if (!(a.guard instanceof ReplayGuard)) throw new TypeError('openChat: guard must be a ReplayGuard');
  if (!isPlainObject(a.participants)) throw new TypeError('openChat: invalid participants');
  assertDistinctKeys(a.participants, 'openChat');
  const s = snapshot(e, CHAT_ENVELOPE_V2_KEYS, 'envelope');
  if (s['v'] !== 2) throw bad('Invalid v');
  const trade = s['trade'];
  const from = s['from'];
  const seq = s['seq'];
  if (typeof trade !== 'string' || trade.length > MAX_TRADE_LEN) throw bad('Invalid trade');
  if (typeof from !== 'string' || from.length > 16) throw bad('Invalid from');
  if (!isValidSeq(seq)) throw bad('Invalid seq');
  if (typeof s['nonce'] !== 'string' || typeof s['ct'] !== 'string' || typeof s['sig'] !== 'string') throw bad('Invalid fields');
  if (trade !== a.trade || a.guard.trade !== a.trade) throw new ProtocolError('wrong-trade', 'Envelope is for another chat');
  const sender = isRole(from) && Object.prototype.hasOwnProperty.call(a.participants, from) ? a.participants[from] : undefined;
  if (!isRole(from) || sender === undefined) throw new ProtocolError('not-participant', 'Sender is not a participant');
  const keys = participantKeys(sender, 'participants[from]');
  const nonce = b64Field(s['nonce'], (n) => n === NONCE_LEN, b64Len(NONCE_LEN), 'nonce');
  const ct = b64Field(s['ct'], (n) => CT_LENS.has(n), CT_MAX_CHARS, 'ct');
  const sig = hexField(s['sig'], sodium.crypto_sign_BYTES, 'sig');
  const u = { v: 2 as const, trade, from, seq, nonce: s['nonce'], ct: s['ct'] };
  let ok = false;
  try {
    ok = sodium.crypto_sign_verify_detached(sig, envelopeMessage(u), keys.sign);
  } catch {
    ok = false;
  }
  if (!ok) throw bad('Invalid sig');
  let padded: Uint8Array;
  try {
    padded = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ct, additionalData(trade, from, seq), nonce, a.tk);
  } catch {
    throw bad('Invalid ct: decryption failed');
  }
  let opened: Omit<Opened, 'from'>;
  try {
    opened = parsePlaintext(padded);
  } catch {
    throw bad('Invalid plaintext');
  } finally {
    sodium.memzero(padded);
  }
  if (!a.guard.accept(from, seq)) throw new ProtocolError('replay', 'Sequence number already seen');
  return { type: opened.type, payload: opened.payload, from };
}

// ── signed statements ───────────────────────────────────────────────────

const TKH_HEX = /^[0-9a-f]{64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const isIso = (v: unknown): v is string => typeof v === 'string' && ISO.test(v) && !Number.isNaN(Date.parse(v));
const isTrader = (v: unknown): v is 'buyer' | 'seller' => v === 'buyer' || v === 'seller';

async function signStatement(domain: string, body: Record<string, unknown>, me: Identity, where: string): Promise<string> {
  await sodium.ready;
  const secret = signerSecret(me, undefined, where);
  return sodium.to_hex(sodium.crypto_sign_detached(utf8.encode(domain + canonicalJson(body)), secret));
}

/** Snapshot + field checks + signature check against `signer`; returns the body without `sig`. */
async function verifyStatement(
  domain: string,
  raw: unknown,
  keys: readonly string[],
  check: (s: Record<string, unknown>) => boolean,
  signer: (s: Record<string, unknown>) => unknown,
  what: string,
): Promise<Record<string, unknown>> {
  await sodium.ready;
  const s = snapshot(raw, keys, what);
  if (s['v'] !== 1 || !check(s)) throw bad(`Invalid ${what}`);
  const pk = participantKeys(signer(s), `${what} signer`);
  const sig = hexField(s['sig'], sodium.crypto_sign_BYTES, `${what}.sig`);
  const body: Record<string, unknown> = {};
  for (const k of keys) if (k !== 'sig') body[k] = s[k];
  let ok = false;
  try {
    ok = sodium.crypto_sign_verify_detached(sig, utf8.encode(domain + canonicalJson(body)), pk.sign);
  } catch {
    ok = false;
  }
  if (!ok) throw bad(`Invalid ${what}.sig`);
  return { ...body, sig: s['sig'] };
}

const wrapOk = (v: unknown): boolean => {
  try {
    b64Field(v, (n) => n === WRAP_LEN, b64Len(WRAP_LEN), 'wrap');
    return true;
  } catch {
    return false;
  }
};

export interface ChatKeyRecord {
  v: 1;
  chat: string;
  tkh: string;
  by: 'buyer' | 'seller';
  wrapBuyer: string;
  wrapSeller: string;
  sig: string;
}
export const CHAT_KEY_RECORD_KEYS = ['v', 'chat', 'tkh', 'by', 'wrapBuyer', 'wrapSeller', 'sig'] as const;

/** The creator's signed key record: TK locked to the buyer's and the seller's attested chat identities. */
export async function makeChatKeyRecord(a: { chat: string; by: 'buyer' | 'seller'; tk: Uint8Array; me: Identity; participants: Participants }): Promise<ChatKeyRecord> {
  await sodium.ready;
  if (!isValidTrade(a.chat)) throw new TypeError('makeChatKeyRecord: invalid chat');
  if (!isTrader(a.by)) throw new TypeError('makeChatKeyRecord: by must be buyer or seller');
  assertKey(a.tk, 'makeChatKeyRecord');
  signerSecret(a.me, a.participants[a.by], 'makeChatKeyRecord');
  for (const r of ROLES) participantKeys(a.participants[r], r);
  const body = {
    v: 1 as const,
    chat: a.chat,
    tkh: await chatKeyHash(a.tk),
    by: a.by,
    wrapBuyer: await wrapChatKey(a.participants.buyer.boxPublic, a.tk),
    wrapSeller: await wrapChatKey(a.participants.seller.boxPublic, a.tk),
  };
  return { ...body, sig: await signStatement(RECORD_DOMAIN, body, a.me, 'makeChatKeyRecord') };
}

/** Verifies a key record's shape and its creator's signature (it cannot check the wraps: only their holders can). */
export async function verifyChatKeyRecord(raw: unknown, a: { chat: string; participants: Partial<Participants> }): Promise<ChatKeyRecord> {
  const body = await verifyStatement(
    RECORD_DOMAIN, raw, CHAT_KEY_RECORD_KEYS,
    (s) => s['chat'] === a.chat && typeof s['tkh'] === 'string' && TKH_HEX.test(s['tkh']) && isTrader(s['by']) && wrapOk(s['wrapBuyer']) && wrapOk(s['wrapSeller']),
    (s) => a.participants[s['by'] as Role],
    'key record',
  );
  return body as unknown as ChatKeyRecord;
}

/** Opens this trader's own copy from a verified record (checked against the record's tkh). */
export async function openChatKeyRecord(rec: ChatKeyRecord, role: 'buyer' | 'seller', me: BoxKeyPair): Promise<Uint8Array> {
  return unwrapChatKey(me, role === 'buyer' ? rec.wrapBuyer : rec.wrapSeller, rec.tkh);
}

export interface ChatGrant {
  v: 1;
  chat: string;
  by: 'buyer' | 'seller';
  tkh: string;
  wrap: string;
  disputeAt: string;
  sig: string;
}
export const CHAT_GRANT_KEYS = ['v', 'chat', 'by', 'tkh', 'wrap', 'disputeAt', 'sig'] as const;

/** A trader's dispute grant (design T1): TK sealed to the moderator's attested chat identity. */
export async function makeChatGrant(a: { chat: string; by: 'buyer' | 'seller'; tk: Uint8Array; disputeAt: string; me: Identity; participants: Participants }): Promise<ChatGrant> {
  await sodium.ready;
  if (!isValidTrade(a.chat)) throw new TypeError('makeChatGrant: invalid chat');
  if (!isTrader(a.by)) throw new TypeError('makeChatGrant: by must be buyer or seller');
  if (!isIso(a.disputeAt)) throw new TypeError('makeChatGrant: disputeAt must be an ISO time');
  assertKey(a.tk, 'makeChatGrant');
  signerSecret(a.me, a.participants[a.by], 'makeChatGrant');
  participantKeys(a.participants.mod, 'mod');
  const body = { v: 1 as const, chat: a.chat, by: a.by, tkh: await chatKeyHash(a.tk), wrap: await wrapChatKey(a.participants.mod.boxPublic, a.tk), disputeAt: a.disputeAt };
  return { ...body, sig: await signStatement(GRANT_DOMAIN, body, a.me, 'makeChatGrant') };
}

/** Verifies a grant's shape and the granting trader's signature (the API's check; it cannot open the wrap). */
export async function verifyChatGrant(raw: unknown, a: { chat: string; participants: Partial<Participants> }): Promise<ChatGrant> {
  const body = await verifyStatement(
    GRANT_DOMAIN, raw, CHAT_GRANT_KEYS,
    (s) => s['chat'] === a.chat && isTrader(s['by']) && typeof s['tkh'] === 'string' && TKH_HEX.test(s['tkh']) && wrapOk(s['wrap']) && isIso(s['disputeAt']),
    (s) => a.participants[s['by'] as Role],
    'grant',
  );
  return body as unknown as ChatGrant;
}

export interface DisputeNotice {
  v: 1;
  chat: string;
  disputeSeq: number;
  openedAt: string;
  openedBy: 'buyer' | 'seller' | 'system';
  sig: string;
}
export const DISPUTE_NOTICE_KEYS = ['v', 'chat', 'disputeSeq', 'openedAt', 'openedBy', 'sig'] as const;
const noticeOk = (s: Record<string, unknown>): boolean =>
  isValidSeq(s['disputeSeq']) && (s['disputeSeq'] as number) >= 1 && isIso(s['openedAt']) && (isTrader(s['openedBy']) || s['openedBy'] === 'system');

/** The moderator's dispute notice (design T2), signed with the chat's moderator identity. */
export async function makeDisputeNotice(a: { chat: string; disputeSeq: number; openedAt: string; openedBy: 'buyer' | 'seller' | 'system'; mod: Identity }): Promise<DisputeNotice> {
  await sodium.ready;
  if (!isValidTrade(a.chat)) throw new TypeError('makeDisputeNotice: invalid chat');
  const body = { v: 1 as const, chat: a.chat, disputeSeq: a.disputeSeq, openedAt: a.openedAt, openedBy: a.openedBy };
  if (!noticeOk(body)) throw new TypeError('makeDisputeNotice: invalid fields');
  return { ...body, sig: await signStatement(NOTICE_DOMAIN, body, a.mod, 'makeDisputeNotice') };
}

export async function verifyDisputeNotice(raw: unknown, a: { chat: string; participants: Partial<Participants> }): Promise<DisputeNotice> {
  const body = await verifyStatement(NOTICE_DOMAIN, raw, DISPUTE_NOTICE_KEYS, (s) => s['chat'] === a.chat && noticeOk(s), () => a.participants.mod, 'notice');
  return body as unknown as DisputeNotice;
}
