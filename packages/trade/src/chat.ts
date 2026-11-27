/**
 * Pure chat rules shared by the API and the browser (Task 20). No keys and no decryption here:
 * the browser's chatCrypto seals and opens; the API stores ciphertext only and checks the shape.
 */
import { normalizeTradeCode, ROLES, type Role } from '@x2f/core';
import { CHAT_ENVELOPE_V2_KEYS, CHAT_ENVELOPE_V3_KEYS, ENVELOPE_KEYS, hasExactKeys, isPlainObject, isValidSeq } from '@x2f/protocol';
import sodium from 'libsodium-wrappers';

/** The `type` inside every chat envelope's ciphertext. */
export const CHAT_MSG_TYPE = 'chat.msg';
/** `POST /v1/chats/:chat/envelopes` takes at most 16 KiB (413 above). */
export const CHAT_BODY_MAX_BYTES = 16 * 1024;
/**
 * The largest message text in UTF-8 bytes. Derived, not chosen: a 16 KiB envelope only fits a
 * plaintext in the 4096-byte padding bucket (the next bucket's ciphertext alone is ~21.9 KiB of
 * base64). JSON escaping at most doubles the allowed characters, so 2000 bytes always fits.
 */
export const CHAT_TEXT_MAX_BYTES = 2000;
/** Pre-trade chats are deleted after this many days without a message. */
export const CHAT_PRETRADE_IDLE_DAYS = 7;
/** A trade's chat is deleted this many days after a trade that was never disputed closes (owner, 8 Nov). */
export const CHAT_AFTER_CLOSE_DAYS = 30;
/** A disputed trade's chat is deleted this many days after the dispute closes, never while one is open (owner, 8 Nov). */
export const CHAT_AFTER_DISPUTE_DAYS = 90;

const DAY_MS = 86_400_000;
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
const HEX = /^[0-9a-f]+$/;
const KEY_HEX = /^[0-9a-f]{64}$/;

export type ChatEnvelopeErrorCode = 'bad-envelope' | 'wrong-channel' | 'wrong-sender' | 'wrong-lane' | 'too-large';

/** Messages name the problem, never a field's value. */
export class ChatEnvelopeError extends Error {
  readonly code: ChatEnvelopeErrorCode;
  constructor(code: ChatEnvelopeErrorCode, message: string) {
    super(message);
    this.name = 'ChatEnvelopeError';
    this.code = code;
  }
}

/** The envelope's fields as the API stores them (the same shape as @x2f/protocol's Envelope). */
export interface ChatEnvelope {
  v: 1;
  trade: string;
  from: Role;
  seq: number;
  slots: Record<Role, string>;
  nonce: string;
  kh: string;
  ct: string;
  ctNonce: string;
  sig: string;
}

const bad = (what: string): ChatEnvelopeError => new ChatEnvelopeError('bad-envelope', `Invalid ${what}`);

function b64(v: unknown, max: number, what: string): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > max || v.length % 4 !== 0 || !B64.test(v)) throw bad(what);
  return v;
}

function hex(v: unknown, len: number, what: string): string {
  if (typeof v !== 'string' || v.length !== len || !HEX.test(v)) throw bad(what);
  return v;
}

/**
 * The API's check of a posted chat envelope, before storing it: exact key set (the protocol's
 * ENVELOPE_KEYS, with its isPlainObject/hasExactKeys/isValidSeq) and field types,
 * at most CHAT_BODY_MAX_BYTES as JSON, `trade` equal to the chat's channel
 * (`channelFor(chat, 'chat')`), and `from` equal to the session's role when one is given. It
 * cannot check the signature or the contents; every reader's open() does.
 */
export function checkChatEnvelope(body: unknown, channel: string, sessionRole?: Role): ChatEnvelope {
  if (!isPlainObject(body) || !hasExactKeys(body, ENVELOPE_KEYS)) throw bad('envelope shape');
  let json: string;
  try {
    json = JSON.stringify(body);
  } catch {
    throw bad('envelope');
  }
  if (new TextEncoder().encode(json).length > CHAT_BODY_MAX_BYTES) throw new ChatEnvelopeError('too-large', 'Envelope too large');
  const { v, trade, from, seq, slots, nonce, kh, ct, ctNonce, sig } = body;
  if (v !== 1) throw bad('v');
  if (typeof trade !== 'string') throw bad('trade');
  if (typeof from !== 'string' || !(ROLES as readonly string[]).includes(from)) throw bad('from');
  if (!isValidSeq(seq)) throw bad('seq');
  if (!isPlainObject(slots) || !hasExactKeys(slots, ROLES)) throw bad('slots');
  const s = {} as Record<Role, string>;
  for (const r of ROLES) s[r] = b64(slots[r], 64, `slots.${r}`);
  const out: ChatEnvelope = {
    v: 1,
    trade,
    from: from as Role,
    seq,
    slots: s,
    nonce: b64(nonce, 32, 'nonce'),
    kh: hex(kh, 64, 'kh'),
    ct: b64(ct, CHAT_BODY_MAX_BYTES, 'ct'),
    ctNonce: b64(ctNonce, 32, 'ctNonce'),
    sig: hex(sig, 128, 'sig'),
  };
  if (trade !== channel) throw new ChatEnvelopeError('wrong-channel', 'Envelope is for another channel');
  if (sessionRole !== undefined && from !== sessionRole) throw new ChatEnvelopeError('wrong-sender', 'Envelope sender is not the session role');
  return out;
}

/** A v2 chat envelope as the API stores it (@x2f/protocol's ChatEnvelopeV2; design build task 4). */
export interface ChatEnvelopeV2Shape {
  v: 2;
  trade: string;
  from: Role;
  seq: number;
  nonce: string;
  ct: string;
  sig: string;
}

/**
 * The API's check of a posted v2 chat envelope (design-chat-membership-keys-2026-11-08 section 2.3):
 * the exact v2 key set, field types, at most CHAT_BODY_MAX_BYTES as JSON, `trade` the chat's channel
 * and `from` the session's role. Like v1, it cannot check the signature or open anything.
 */
export function checkChatEnvelopeV2(body: unknown, channel: string, sessionRole?: Role): ChatEnvelopeV2Shape {
  if (!isPlainObject(body) || !hasExactKeys(body, CHAT_ENVELOPE_V2_KEYS)) throw bad('envelope shape');
  let json: string;
  try {
    json = JSON.stringify(body);
  } catch {
    throw bad('envelope');
  }
  if (new TextEncoder().encode(json).length > CHAT_BODY_MAX_BYTES) throw new ChatEnvelopeError('too-large', 'Envelope too large');
  const { v, trade, from, seq, nonce, ct, sig } = body;
  if (v !== 2) throw bad('v');
  if (typeof trade !== 'string') throw bad('trade');
  if (typeof from !== 'string' || !(ROLES as readonly string[]).includes(from)) throw bad('from');
  if (!isValidSeq(seq)) throw bad('seq');
  const out: ChatEnvelopeV2Shape = { v: 2, trade, from: from as Role, seq, nonce: b64(nonce, 32, 'nonce'), ct: b64(ct, CHAT_BODY_MAX_BYTES, 'ct'), sig: hex(sig, 128, 'sig') };
  if (trade !== channel) throw new ChatEnvelopeError('wrong-channel', 'Envelope is for another channel');
  if (sessionRole !== undefined && from !== sessionRole) throw new ChatEnvelopeError('wrong-sender', 'Envelope sender is not the session role');
  return out;
}

/** A v3 private lane envelope as the API stores it (@x2f/protocol's ChatEnvelopeV3; private-mod-chat-2026-11-27). */
export interface ChatEnvelopeV3Shape {
  v: 3;
  trade: string;
  from: Role;
  to: 'buyer' | 'seller';
  seq: number;
  nonce: string;
  ct: string;
  sig: string;
}

/**
 * The API's check of a posted v3 (private lane) envelope: the exact v3 key set, field types, at most
 * CHAT_BODY_MAX_BYTES as JSON, `trade` the chat's channel, `from` the session's role, and `to` a lane
 * (`buyer` or `seller`) whose sender is the moderator or that lane's own trader (`wrong-lane`
 * otherwise: a trader writes only in its own lane). Like v1 and v2, it cannot check the signature or
 * open anything.
 */
export function checkChatEnvelopeV3(body: unknown, channel: string, sessionRole?: Role): ChatEnvelopeV3Shape {
  if (!isPlainObject(body) || !hasExactKeys(body, CHAT_ENVELOPE_V3_KEYS)) throw bad('envelope shape');
  let json: string;
  try {
    json = JSON.stringify(body);
  } catch {
    throw bad('envelope');
  }
  if (new TextEncoder().encode(json).length > CHAT_BODY_MAX_BYTES) throw new ChatEnvelopeError('too-large', 'Envelope too large');
  const { v, trade, from, to, seq, nonce, ct, sig } = body;
  if (v !== 3) throw bad('v');
  if (typeof trade !== 'string') throw bad('trade');
  if (typeof from !== 'string' || !(ROLES as readonly string[]).includes(from)) throw bad('from');
  if (to !== 'buyer' && to !== 'seller') throw bad('to');
  if (!isValidSeq(seq)) throw bad('seq');
  const out: ChatEnvelopeV3Shape = { v: 3, trade, from: from as Role, to, seq, nonce: b64(nonce, 32, 'nonce'), ct: b64(ct, CHAT_BODY_MAX_BYTES, 'ct'), sig: hex(sig, 128, 'sig') };
  if (trade !== channel) throw new ChatEnvelopeError('wrong-channel', 'Envelope is for another channel');
  if (sessionRole !== undefined && from !== sessionRole) throw new ChatEnvelopeError('wrong-sender', 'Envelope sender is not the session role');
  if (from !== 'mod' && from !== to) throw new ChatEnvelopeError('wrong-lane', 'Envelope is for another lane');
  return out;
}

/**
 * The bytes a chat identity's proof signs: "x2f/chat-identity/v1\0" + normalized chat code +
 * "\0" + role + "\0" + signPublic + boxPublic (each exactly 64 lower-case hex characters). The same rule as Task 8's trade identity proof,
 * under its own domain so a trade identity proof can never be replayed as a chat one.
 */
export function chatIdentityProofBytes(chat: string, role: 'buyer' | 'seller', signPublic: string, boxPublic: string): Uint8Array {
  const code = normalizeTradeCode(chat);
  if (code === null) throw new TypeError('chatIdentityProofBytes: invalid chat code');
  if (role !== 'buyer' && role !== 'seller') throw new TypeError('chatIdentityProofBytes: role must be buyer or seller');
  // The keys are joined with no separator, so each must have its fixed length.
  if (!KEY_HEX.test(signPublic) || !KEY_HEX.test(boxPublic)) throw new TypeError('chatIdentityProofBytes: keys must be 32 bytes lower-case hex');
  return new TextEncoder().encode(`x2f/chat-identity/v1\0${code}\0${role}\0${signPublic}${boxPublic}`);
}

/**
 * True when `proof` (hex Ed25519) verifies under `signPublic` over chatIdentityProofBytes for this
 * chat and role, and `boxPublic` is the X25519 conversion of `signPublic`. The API checks it on
 * `POST /v1/chats/:chat/identity` and the moderation service again before attesting. Never throws.
 */
export async function chatIdentityProofValid(
  chat: string,
  role: 'buyer' | 'seller',
  keys: { signPublic: string; boxPublic: string; proof: string },
): Promise<boolean> {
  await sodium.ready;
  try {
    if (typeof keys?.proof !== 'string' || !/^[0-9a-f]{128}$/.test(keys.proof)) return false;
    const msg = chatIdentityProofBytes(chat, role, keys.signPublic, keys.boxPublic);
    const pk = sodium.from_hex(keys.signPublic);
    if (sodium.to_hex(sodium.crypto_sign_ed25519_pk_to_curve25519(pk)) !== keys.boxPublic) return false;
    return sodium.crypto_sign_verify_detached(sodium.from_hex(keys.proof), msg, pk);
  } catch {
    return false;
  }
}

export interface ChatRetentionFacts {
  /** The chat belongs to a trade (a take reuses the chat). */
  tradeLinked: boolean;
  /** When that trade closed, or null while it is open (or there is none). */
  tradeClosedAt: Date | null;
  /** A dispute is open on the trade: the trade is `disputed`, or any dispute is not yet `closed`. */
  disputeOpen: boolean;
  /** The trade has ever had a dispute. */
  disputed: boolean;
  /** When the latest of its disputes closed (`disputes.closed_at`), or null if none has. */
  disputeClosedAt: Date | null;
  createdAt: Date;
  lastMessageAt: Date | null;
  /**
   * Owner 26 Nov 2026 (as the trade row, retention.ts `lienOpen`): a lien from this trade's
   * disputes is unpaid (`liens.status` active or suspended). Its chat and payment proofs are then
   * kept, however old, until the lien ends.
   */
  lienOpen?: boolean;
  /** When the last lien from this trade ended (`liens.lifted_at`), or null; kept CHAT_AFTER_DISPUTE_DAYS after it. */
  lienEndedAt?: Date | null;
}

const valid = (d: Date | null): d is Date => d instanceof Date && Number.isFinite(d.getTime());

/**
 * purgeChats' rule (owner, 8 Nov: "erased for good 30 days after the trade ends, or 90 days after a
 * dispute closes"):
 * - never while a dispute is open;
 * - a trade that was never disputed: CHAT_AFTER_CLOSE_DAYS (30) days after it closes;
 * - a trade that had a dispute: CHAT_AFTER_DISPUTE_DAYS (90) days after the dispute closes, so one
 *   opened inside the 30 days stops the 30-day erasure;
 * - a pre-trade chat: CHAT_PRETRADE_IDLE_DAYS (7) days after its last message (or its creation);
 * - never while a lien from the trade is unpaid (owner 26 Nov 2026, as `tradeDeleteAt`); once it
 *   has ended, no sooner than CHAT_AFTER_DISPUTE_DAYS (90) days after it ended.
 *
 * "A dispute closes" is the machine's `closed` status, the only one with a `disputes.closed_at`. It
 * comes after the appeal: `published` is the 48-hour appeal window (the coins have moved and the
 * trade has closed, so the trade's own state cannot tell), `appealed` is round 2, and `final` and
 * `complying` still wait for a payout or a payment. With several disputes on a trade (a later
 * system escalation) the latest close counts, and all must be closed.
 *
 * The 90 days count from the later of the dispute's close and the trade's, so a chat can never be
 * due the moment its trade closes. Any invalid date, in either branch and whether or not that
 * branch reads it, keeps the chat, and so does a disputed trade with no close time: a corrupt row
 * is never a reason to delete.
 */
export function chatPurgeDue(c: ChatRetentionFacts, now: Date): boolean {
  const nullable = (d: Date | null): boolean => d === null || valid(d);
  const lienEndedAt = c.lienEndedAt ?? null;
  if (
    c.disputeOpen ||
    c.lienOpen === true ||
    !nullable(lienEndedAt) ||
    !valid(now) ||
    !valid(c.createdAt) ||
    !nullable(c.lastMessageAt) ||
    !nullable(c.tradeClosedAt) ||
    !nullable(c.disputeClosedAt)
  ) {
    return false;
  }
  if (c.tradeLinked) {
    if (!valid(c.tradeClosedAt)) return false;
    let at: number;
    if (!c.disputed) {
      at = c.tradeClosedAt.getTime() + CHAT_AFTER_CLOSE_DAYS * DAY_MS;
    } else {
      if (!valid(c.disputeClosedAt)) return false;
      at = Math.max(c.disputeClosedAt.getTime(), c.tradeClosedAt.getTime()) + CHAT_AFTER_DISPUTE_DAYS * DAY_MS;
    }
    // Owner 26 Nov 2026: a lien that ended keeps the chat CHAT_AFTER_DISPUTE_DAYS after it ended.
    if (lienEndedAt !== null) at = Math.max(at, lienEndedAt.getTime() + CHAT_AFTER_DISPUTE_DAYS * DAY_MS);
    return now.getTime() > at;
  }
  const last = c.lastMessageAt ?? c.createdAt;
  if (!valid(last)) return false;
  return now.getTime() > last.getTime() + CHAT_PRETRADE_IDLE_DAYS * DAY_MS;
}
