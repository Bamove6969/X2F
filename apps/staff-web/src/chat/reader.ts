import {
  chatKeyHash,
  encryptChat,
  makeModCountersign,
  openChat,
  ReplayGuard,
  unwrapChatKey,
  verifyChatKeyRecord,
  type Participants,
} from '@x2f/protocol';
import { CHAT_MSG_TYPE, CHAT_TEXT_MAX_BYTES, channelFor, verifyAttestationSignature, type Attestation } from '@x2f/trade';
import { wipeIdentity, type StaffDeviceKey } from '../device/deviceKey.js';

/**
 * Design build task 9 (design section 2.4 M4): the moderator's read of a disputed chat, in the staff
 * browser. The API answers ciphertext only (`POST /staff/v1/disputes/:code/chat`); here:
 * - the chat's attestation must be signed by the pinned moderation key (VITE_MOD_SIGNING_PUBLIC)
 *   and name this chat and its channel, so the API cannot swap in participants of its own;
 * - the key record must be signed by the attested trader it names, for this channel, and its tkh be
 *   the one the moderation process re-wrapped, so a key the API made up is refused;
 * - the wrap is opened with this device's own box key to a key of that tkh, and every envelope is
 *   verified (signed by an attested participant) and decrypted under it; one that does not open is
 *   left out and counted (`unreadable`);
 * - review N2: each sender's seq runs 0, 1, 2, …, so where the API dropped or withheld envelopes the
 *   next line of that sender carries how many are missing before it (`missingBefore`), and a
 *   sender's first line above seq 0 follows missing ones. Only envelopes that verified count (a seq
 *   the API wrote on one that did not is its word). The API can still cut the end of the chat.
 * The chat key is held in memory only (`OpenedChat.tk`); `forget` wipes it. Nothing is stored.
 * NEEDS_DESIGN_TASK_10: the design wants the decryption in a worker (design task 10, the staff-web
 * reader); here it runs in the page.
 */

export interface CaseChatAnswer {
  chat: string;
  channel: string;
  wrap: string;
  tkh: string;
  nextSeq: number;
  attestation: { attestation: unknown; sig: string } | null;
  record: unknown;
  envelopes: Array<{ id: string; senderRole: string; envelope: unknown; at: string }>;
}

export interface CaseChatLine {
  id: string;
  from: 'buyer' | 'seller' | 'mod';
  text: string;
  at: string;
  /** Review N2: how many of this sender's messages are missing just before this line (0: none). */
  missingBefore: number;
}

export interface OpenedChat {
  chat: string;
  channel: string;
  participants: Participants;
  tk: Uint8Array;
  nextSeq: number;
  lines: CaseChatLine[];
  /** Envelopes that did not verify or open (shown as a count, never as text). */
  unreadable: number;
  /** Review N2: messages missing in all (the sum of the lines' `missingBefore`, and any after the last line). */
  missing: number;
}

export class CaseChatError extends Error {
  constructor(readonly code: 'security' | 'unreadable') {
    super(code);
    this.name = 'CaseChatError';
  }
}

const security = (): CaseChatError => new CaseChatError('security');

export async function openCaseChat(a: CaseChatAnswer, device: StaffDeviceKey, modSigningPublic: string): Promise<OpenedChat> {
  const channel = await channelFor(a.chat, 'chat');
  if (a.channel !== channel || a.attestation === null) throw security();
  const att = a.attestation.attestation as Attestation;
  try {
    await verifyAttestationSignature(att, a.attestation.sig, modSigningPublic);
  } catch {
    throw security();
  }
  if (att.trade !== a.chat || att.channels?.chat !== channel || 'terms' in att) throw security();
  const participants = att.participants as Participants;
  try {
    const rec = await verifyChatKeyRecord(a.record, { chat: channel, participants });
    if (rec.tkh !== a.tkh) throw security();
  } catch {
    throw security();
  }
  const me = await device.identity();
  let tk: Uint8Array;
  try {
    tk = await unwrapChatKey({ boxPublic: me.boxPublic, boxSecret: me.boxSecret }, a.wrap, a.tkh);
  } catch {
    throw security();
  } finally {
    wipeIdentity(me);
  }
  const guard = new ReplayGuard(channel);
  const lines: CaseChatLine[] = [];
  let unreadable = 0;
  let missing = 0;
  // Review N2: the last verified seq per sender; a gap found on an envelope that is not a line is
  // carried to the next line shown.
  const last = new Map<string, number>();
  let carried = 0;
  for (const e of a.envelopes) {
    let o;
    try {
      o = await openChat(e.envelope, { tk, trade: channel, participants, guard });
    } catch {
      unreadable += 1;
      continue;
    }
    // Verified: signed by the attested `from` at this seq (the replay guard took it as newer).
    const seq = (e.envelope as { seq: number }).seq;
    const gap = seq - ((last.get(o.from) ?? -1) + 1);
    last.set(o.from, seq);
    missing += gap;
    carried += gap;
    const p = o.payload as { text?: unknown } | null;
    if (o.type !== CHAT_MSG_TYPE || typeof p?.text !== 'string' || o.from !== e.senderRole) {
      unreadable += 1;
      continue;
    }
    lines.push({ id: e.id, from: o.from as CaseChatLine['from'], text: p.text, at: e.at, missingBefore: carried });
    carried = 0;
  }
  return { chat: a.chat, channel, participants, tk, nextSeq: a.nextSeq, lines, unreadable, missing };
}

/** Wipes the chat key held for an opened chat. */
export function forget(c: OpenedChat): void {
  c.tk.fill(0);
}

// Control characters other than tab and line feed (as the trader app and the old moderator route refused).
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;

/** A moderator message's text: not blank, no control characters, at most CHAT_TEXT_MAX_BYTES of UTF-8. */
export function modTextOk(text: string): boolean {
  return text.trim() !== '' && !CONTROL.test(text) && new TextEncoder().encode(text).length <= CHAT_TEXT_MAX_BYTES;
}

/** What `POST …/messages` takes: the message sealed under the chat key as `mod` at `seq`, countersigned by this device. */
export async function sealModMessage(c: OpenedChat, text: string, device: StaffDeviceKey, now: Date, seq = c.nextSeq) {
  if (!modTextOk(text)) throw new CaseChatError('unreadable');
  // The key must still be the chat's (never sealed under a wiped key).
  if (c.tk.every((x) => x === 0)) throw security();
  await chatKeyHash(c.tk);
  const body = await encryptChat({ trade: c.channel, from: 'mod', seq, type: CHAT_MSG_TYPE, payload: { text }, tk: c.tk });
  const rid = new Uint8Array(16);
  globalThis.crypto.getRandomValues(rid);
  const me = await device.identity();
  try {
    const cs = await makeModCountersign({ body, requestId: Array.from(rid, (x) => x.toString(16).padStart(2, '0')).join(''), issuedAt: now.toISOString(), me });
    return { deviceKeyId: device.deviceKeyId, seq, nonce: body.nonce, ct: body.ct, ctSha256: cs.ctSha256, requestId: cs.requestId, issuedAt: cs.issuedAt, sig: cs.sig };
  } finally {
    wipeIdentity(me);
  }
}
