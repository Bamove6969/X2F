/**
 * End-to-end encrypted chat (Task 20), pure parts: no DB, no routes, no UI.
 *
 * Crypto is entirely @x2f/protocol's seal/open (Plan 1 Task 3, reviewed): Ed25519-signed
 * envelopes, one secretbox ciphertext under a fresh key wrapped per role with crypto_box,
 * padding to fixed buckets, all three slots always present. Nothing new is invented here. This
 * module only binds that envelope to a chat:
 *
 * - The envelope's `trade` is the chat channel, `channelFor(chat, 'chat')`; it is covered by the
 *   signature, so an envelope cannot move to another chat or to a trade's signals/escrow channel.
 * - Inside, `type` must be 'chat.msg' and the payload exactly `{ text }`, or `{ text, pay }` for
 *   the payee's packaged payment details (J-08, S-090; packages/trade payFields.ts): `text` is the
 *   plain rendering of the boxes, which any reader that knows only `text` shows as a line, and
 *   `pay` the boxes for the card. A reader checks that the text IS the rendering of the boxes, so
 *   the two can never say different things. Only a trader sends one; a mod-signed package is
 *   refused, and so is any package while the reader's trade is not secured (`payAllowed`, owner
 *   Q12), so no client can push details to the buyer early. Messages carry no names: the UI shows each role's display name (never a login name)
 *   from its own records.
 * - Every message is sealed to buyer, seller and the chat's mod identity (spec 6.6: a moderator
 *   can read the chat once a dispute opens), including the sender, so it can re-read its own.
 * - Ordering and replay: `seq` is a per-chat counter on the sending device; each reader keeps a
 *   ReplayGuard (strictly increasing seq per sender). Both live in one ChatState record per chat
 *   that the caller persists: after sealing and BEFORE posting (a seq is never reused), and after
 *   opening and BEFORE showing the message (a reload never shows a replay).
 *
 * Identities are made elsewhere and passed in: in apps/web only the escrow worker may name the
 * protocol's identity maker (separation check, lead answer 2026-10-24).
 */
import type { Role } from '@x2f/core';
import {
  ReplayGuard,
  hasExactKeys,
  isPlainObject,
  isValidSeq,
  open,
  seal,
  signProof,
  type Envelope,
  type Identity,
  type Participants,
  type ReplayGuardJSON,
} from '@x2f/protocol';
import {
  CHAT_BODY_MAX_BYTES,
  CHAT_MSG_TYPE,
  CHAT_TEXT_MAX_BYTES,
  PayDetailsError,
  channelFor,
  chatIdentityProofBytes,
  checkChatEnvelope,
  parsePayDetails,
  payTextMatches,
  renderPayDetailsText,
  type PayDetailsPayload,
} from '@x2f/trade';

export type ChatRole = 'buyer' | 'seller';
export type ChatErrorCode = 'bad-text' | 'too-large' | 'bad-state' | 'bad-message' | 'mod-not-allowed';

/** Chat-level refusals. Envelope rejections stay ProtocolError / ChatEnvelopeError. */
export class ChatError extends Error {
  readonly code: ChatErrorCode;
  constructor(code: ChatErrorCode, message: string) {
    super(message);
    this.name = 'ChatError';
    this.code = code;
  }
}

/** One record per chat on the device holding the chat identity. */
export interface ChatState {
  channel: string;
  /** The seq this device's next message uses. */
  nextSeq: number;
  /** This device's ReplayGuard over every sender in the chat, itself included. */
  guard: ReplayGuardJSON;
}

export interface ChatMessage {
  /** The verified sender role; the UI maps it to that side's display name. */
  from: Role;
  seq: number;
  /** The plain line; for a package, the rendering of its boxes (`renderPayDetailsText`). */
  text: string;
  /** The payee's packaged payment details (J-08), checked; absent on a plain line. */
  pay?: PayDetailsPayload;
}

const ALL: readonly Role[] = ['buyer', 'seller', 'mod'];
const STATE_KEYS = ['channel', 'nextSeq', 'guard'] as const;
// Hidden characters, by Unicode category rather than by a hand-picked list (review I1: a list let
// the soft hyphen U+00AD, U+2061-2064 and the tag characters through, so "12<SHY>34" pasted as
// another account number): every format character (Cf: zero-width space, word joiner, BOM, the
// soft hyphen, the bidi embeddings, overrides and isolates, the deprecated format controls, the
// interlinear annotation marks, the musical and tag format characters, ...), every control
// character (Cc: C0, DEL, C1), the whole tag block U+E0000-E007F even where unassigned, the
// combining grapheme joiner U+034F (a mark that renders as nothing) and the Hangul fillers
// U+115F, U+1160, U+3164, U+FFA0 (letters that render as blank, so not Cf).
// Always written as \u escapes: no literal invisible characters in source (review M3).
const HIDDEN = /[\p{Cf}\p{Cc}\u034f\u115f\u1160\u3164\uffa0\u{e0000}-\u{e007f}]/gu;
// Refused anywhere in a message: every hidden character except the allow-list, which the text
// needs: tab and newline; ZWNJ/ZWJ (U+200C-200D) for Persian, Indic text and emoji sequences;
// LRM/RLM/ALM (U+200E-200F, U+061C) for right-to-left writing. Nothing else is allowed.
const FORBIDDEN = /(?![\t\n\u061c\u200c-\u200f])[\p{Cf}\p{Cc}\u034f\u115f\u1160\u3164\uffa0\u{e0000}-\u{e007f}]/u;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

/** The chat's relay-style channel ID: the `trade` of every envelope in it. */
export function chatChannel(chat: string): Promise<string> {
  return channelFor(chat, 'chat');
}

export function newChatState(channel: string): ChatState {
  return { channel, nextSeq: 0, guard: new ReplayGuard(channel).toJSON() };
}

/** Validates a stored ChatState for this chat's channel. Throws ChatError('bad-state'). */
export function parseChatState(json: unknown, channel: string): ChatState {
  const fail = (): ChatError => new ChatError('bad-state', 'Invalid saved chat state');
  if (!isPlainObject(json) || !hasExactKeys(json, STATE_KEYS)) throw fail();
  const o = json;
  if (o['channel'] !== channel || !isValidSeq(o['nextSeq'])) throw fail();
  let guard: ReplayGuard;
  try {
    guard = ReplayGuard.from(o.guard);
  } catch {
    throw fail();
  }
  if (guard.trade !== channel) throw fail();
  return { channel, nextSeq: o['nextSeq'], guard: guard.toJSON() };
}

/**
 * Validates message text: a string with something besides whitespace and hidden characters, at
 * most CHAT_TEXT_MAX_BYTES of UTF-8, no format or control characters other than the allow-list
 * (tab, newline, ZWNJ, ZWJ, LRM, RLM, ALM) and no lone surrogates. Returns it unchanged. Throws
 * ChatError 'bad-text' or 'too-large'.
 *
 * No Unicode normalisation is applied: the text is kept exactly as typed, and the byte limit is
 * measured on that stored form. Sender and readers run this same check on the same bytes, and
 * the panel must never normalise on one side only (NFC on send and not on read, or the reverse,
 * would make the two sides disagree on what was said and on whether it fits).
 */
export function checkChatText(text: unknown): string {
  // A message of only whitespace and hidden characters (allowed or not) is empty.
  if (typeof text !== 'string' || text.replace(HIDDEN, '').trim() === '') throw new ChatError('bad-text', 'Message is empty');
  // not-a-refusal: an input check on a chat message the composer shows, not a rule
  if (FORBIDDEN.test(text) || LONE_SURROGATE.test(text)) throw new ChatError('bad-text', 'Message has characters that are not allowed');
  if (new TextEncoder().encode(text).length > CHAT_TEXT_MAX_BYTES) throw new ChatError('too-large', 'Message is too long');
  return text;
}

/**
 * The hex Ed25519 proof for `POST /v1/chats/:chat/identity`: the protocol's signProof over
 * chatIdentityProofBytes. No libsodium here; apps/web uses the protocol for every crypto call.
 */
export function signChatIdentity(me: Identity, chat: string, role: ChatRole): Promise<string> {
  return signProof(me, chatIdentityProofBytes(chat, role, me.signPublic, me.boxPublic));
}

export interface SealChatArgs {
  role: ChatRole;
  me: Identity;
  /** The attested participants of this chat (buyer, seller and the chat's mod identity). */
  participants: Participants;
  state: ChatState;
  text: string;
}

/**
 * Seals one message to buyer, seller and mod. Returns the envelope and the new state; persist
 * the state before posting the envelope. The input state is not changed.
 *
 * The caller must first open every pending envelope of the chat (so the guard knows this
 * identity's latest seq, even one sent from an earlier session), and send one post at a time,
 * sealing the next only after the previous post was answered.
 */
export async function sealChatMessage(a: SealChatArgs): Promise<{ envelope: Envelope; state: ChatState }> {
  if (a.role !== 'buyer' && a.role !== 'seller') throw new TypeError('sealChatMessage: role must be buyer or seller');
  return sealInner(a, { text: checkChatText(a.text) });
}

export interface SealPayArgs {
  role: ChatRole;
  me: Identity;
  participants: Participants;
  state: ChatState;
  /** The boxes as the composer packaged them; checked here again (parsePayDetails) before sealing. */
  pay: PayDetailsPayload;
}

/**
 * Seals the payee's packaged payment details (J-08): `{ text, pay }`, where `text` is the plain
 * rendering of the boxes, under the same rules as sealChatMessage (text checks, size, seq). Throws
 * PayDetailsError for a bad package (by box), ChatError 'bad-text' for hidden characters in a box
 * or 'too-large'.
 */
export async function sealPayDetails(a: SealPayArgs): Promise<{ envelope: Envelope; state: ChatState }> {
  if (a.role !== 'buyer' && a.role !== 'seller') throw new TypeError('sealPayDetails: role must be buyer or seller');
  const pay = parsePayDetails(a.pay);
  const text = checkChatText(renderPayDetailsText(pay));
  return sealInner(a, { text, pay });
}

async function sealInner(a: Omit<SealChatArgs, 'text'>, payload: { text: string; pay?: PayDetailsPayload }): Promise<{ envelope: Envelope; state: ChatState }> {
  if (a.role !== 'buyer' && a.role !== 'seller') throw new TypeError('sealChatMessage: role must be buyer or seller');
  const state = parseChatState(a.state, a.state.channel);
  // Never reuse a seq this device has already seen from itself (e.g. a counter restored from an
  // older copy): peers would drop the message as a replay.
  const seenOwn = state.guard.seen[a.role];
  const seq = seenOwn !== undefined && seenOwn >= state.nextSeq ? seenOwn + 1 : state.nextSeq;
  if (!Number.isSafeInteger(seq + 1)) throw new ChatError('bad-state', 'Sequence exhausted');
  const envelope = await seal({
    trade: state.channel,
    from: a.role,
    seq,
    type: CHAT_MSG_TYPE,
    payload,
    to: ALL,
    me: a.me,
    participants: a.participants,
  });
  // Belt and braces: CHAT_TEXT_MAX_BYTES is derived so this always holds.
  if (new TextEncoder().encode(JSON.stringify(envelope)).length > CHAT_BODY_MAX_BYTES) {
    throw new ChatError('too-large', 'Message is too long');
  }
  return { envelope, state: { ...state, nextSeq: seq + 1 } };
}

export interface OpenChatArgs {
  role: Role;
  me: Identity;
  participants: Participants;
  state: ChatState;
  /**
   * Accept messages from the chat's mod identity. Default false: traders see the moderator only
   * inside a disputed trade's room (spec 6.6), so the panel sets it only while a dispute is open.
   * When false, an authentic mod message is refused with ChatError('mod-not-allowed') and the
   * guard does not move, so the same envelope opens once a dispute is open.
   */
  modMayPost?: boolean;
  /**
   * Accept a package (`{ text, pay }`). Default false: owner Q12, the seller's payment details
   * reach the buyer only once the escrow is secured, so the engine sets it from the trade's
   * `securedAt`. When false, a package is refused with ChatError('bad-message') and the guard does
   * not move, so the same envelope opens once the trade is secured.
   */
  payAllowed?: boolean;
}

/**
 * Checks and opens one envelope from `GET …/envelopes`. Throws ChatEnvelopeError (shape, size,
 * wrong-channel), ProtocolError (signature, not-for-me, replay, …) or ChatError('bad-message',
 * or 'mod-not-allowed' for an authentic mod message without `modMayPost`).
 * On success returns the message and the new state; persist the state before showing the
 * message. The input state is not changed, so a rejected envelope leaves no trace.
 *
 * Intended consequences of "no trace": an envelope refused with 'mod-not-allowed' (or a package
 * refused only for `payAllowed`) must not advance the engine's `GET …?after=` cursor: it is
 * re-fetched and re-tried once a dispute opens (or the trade is secured). Any other 'bad-message'
 * is decided for good and the engine passes it (pay-details review M1); either way a sender whose
 * message was 'bad-message' may reuse that seq, because this reader's guard did not move for it.
 */
export async function openChatMessage(body: unknown, a: OpenChatArgs): Promise<{ message: ChatMessage; state: ChatState }> {
  const state = parseChatState(a.state, a.state.channel);
  const env = checkChatEnvelope(body, state.channel);
  const guard = ReplayGuard.from(state.guard);
  const opened = await open(env, {
    me: a.me,
    myRole: a.role,
    participants: a.participants,
    trade: state.channel,
    guard,
    allowSelf: true,
  });
  if (opened.from === 'mod' && a.modMayPost !== true) {
    throw new ChatError('mod-not-allowed', 'Moderator messages are shown only in a dispute');
  }
  const p = opened.payload;
  const notChat = (): ChatError => new ChatError('bad-message', 'Not a chat message');
  if (opened.type !== CHAT_MSG_TYPE || typeof p !== 'object' || p === null || Array.isArray(p) || !Object.prototype.hasOwnProperty.call(p, 'text')) throw notChat();
  const keys = Object.keys(p);
  const packaged = keys.length === 2 && Object.prototype.hasOwnProperty.call(p, 'pay');
  if (!packaged && keys.length !== 1) throw notChat();
  let text: string;
  try {
    text = checkChatText((p as { text: unknown }).text);
  } catch {
    throw notChat();
  }
  const message: ChatMessage = { from: opened.from, seq: env.seq, text };
  if (packaged) {
    // Only a trader has payment details to send, only once the escrow is secured (owner Q12), and
    // the text must render exactly the boxes' values (review F3: whatever labels it was sealed under).
    if (opened.from === 'mod' || a.payAllowed !== true) throw notChat();
    let pay: PayDetailsPayload;
    try {
      pay = parsePayDetails((p as { pay: unknown }).pay);
    } catch (e) {
      if (e instanceof PayDetailsError) throw notChat();
      throw e;
    }
    if (!payTextMatches(pay, text)) throw notChat();
    message.pay = pay;
  }
  return { message, state: { ...state, guard: guard.toJSON() } };
}
