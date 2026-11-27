import {
  chatKeyHash,
  encryptChat,
  encryptPrivate,
  makeModCountersign,
  makeModPrivateCountersign,
  openChat,
  openPrivate,
  privateKeyHash,
  ReplayGuard,
  unwrapChatKey,
  unwrapPrivateKey,
  verifyChatKeyRecord,
  type Participants,
} from '@x2f/protocol';
import { CHAT_MSG_TYPE, channelFor, verifyAttestationSignature, type Attestation, type AttestationKey } from '@x2f/trade';
import { CASE_CHAT_READ_MAX, modTextOk, type CaseChatAnswer, type CaseChatLine, type Lane, type SealedModMessage } from '../chat/types.js';
import type { StaffDeviceKey } from './deviceKey.js';

export { CASE_CHAT_READ_MAX, modTextOk, type CaseChatAnswer, type CaseChatLine };

/**
 * Design build task 9 (design section 2.4 M4): the moderator's read of a disputed chat, in the staff
 * browser. The API answers ciphertext only (`POST /staff/v1/disputes/:code/chat`); here:
 * - the chat's attestation must be signed by a pinned moderation key (`attestationKeys()` of
 *   VITE_MOD_SIGNING_PUBLIC, review N11 b: a key inside its window, as the trader app) and name this
 *   chat and its channel, so the API cannot swap in participants of its own;
 * - the key record must be signed by the attested trader it names, for this channel, and its tkh be
 *   the one the moderation process re-wrapped, so a key the API made up is refused;
 * - the wrap is opened with this device's own box key to a key of that tkh, and every envelope is
 *   verified (signed by an attested participant) and decrypted under it; one that does not open is
 *   left out and counted (`unreadable`);
 * - review N2: each sender's seq runs 0, 1, 2, …, so where the API dropped or withheld envelopes the
 *   next line of that sender carries how many are missing before it (`missingBefore`), and a
 *   sender's first line above seq 0 follows missing ones. Only envelopes that verified count (a seq
 *   the API wrote on one that did not is its word). The API can still cut the end of the chat.
 * Private lanes (owner 27 Nov, docs/security/private-mod-chat-2026-11-27.md): each lane key PK the
 * answer names is opened with the same device key and must hash to its `pkh` (else the security
 * failure, as for TK); a v3 envelope is opened under its lane's PK with that lane's own replay
 * guard, and its gaps are counted per lane and sender as the shared chat's are. A lane envelope
 * with no PK here (or not opening) is unreadable, never shown.
 * The chat key and lane keys are held in memory only (`OpenedChat.tk`, `.lanes`); `forget` wipes
 * them. Nothing is stored.
 * Design build task 10: this module runs only inside the chat key worker (keys/chatWorker.ts,
 * through keys/keeper.ts); the page never imports it (test/workerBoundary.test.ts).
 */

export interface OpenedChat {
  chat: string;
  channel: string;
  participants: Participants;
  tk: Uint8Array;
  /** The chat key's fingerprint (review N11 c: checked again before every seal). */
  tkh: string;
  nextSeq: number;
  /** Each private lane's key PK, its pinned pkh (checked again before every seal) and the moderator's next seq there. */
  lanes: Partial<Record<Lane, { pk: Uint8Array; pkh: string; nextSeq: number }>>;
  lines: CaseChatLine[];
  /** Envelopes that did not verify or open (shown as a count, never as text). */
  unreadable: number;
  /** Review N2: messages missing in all (the sum of the lines' `missingBefore`, and any after the last line). */
  missing: number;
  /**
   * Review N11 (f): older messages are not shown (the read is cut at CASE_CHAT_READ_MAX). Believed
   * only with exactly that many envelopes; then a sender's first line here follows no gap.
   */
  olderNotShown: boolean;
}

export class CaseChatError extends Error {
  constructor(readonly code: 'security' | 'unreadable') {
    super(code);
    this.name = 'CaseChatError';
  }
}

const security = (): CaseChatError => new CaseChatError('security');

export async function openCaseChat(a: CaseChatAnswer, device: StaffDeviceKey, modKeys: string | readonly AttestationKey[]): Promise<OpenedChat> {
  const channel = await channelFor(a.chat, 'chat');
  if (a.channel !== channel || a.attestation === null) throw security();
  const att = a.attestation.attestation as Attestation;
  try {
    await verifyAttestationSignature(att, a.attestation.sig, modKeys);
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
  let tk: Uint8Array;
  try {
    // Opened by the device's non-extractable X25519 key (review B1: deriveBits, then crypto_box_seal_open's steps).
    tk = await unwrapChatKey(device.opener, a.wrap, a.tkh);
  } catch {
    throw security();
  }
  const lanes: OpenedChat['lanes'] = {};
  const refuse = (): CaseChatError => {
    tk.fill(0);
    for (const l of Object.values(lanes)) l?.pk.fill(0);
    return security();
  };
  const rawLanes: unknown = a.lanes ?? [];
  if (!Array.isArray(rawLanes)) throw refuse();
  for (const l of rawLanes as Array<{ to?: unknown; pkh?: unknown; wrap?: unknown; nextSeq?: unknown } | null>) {
    const to = l?.to;
    if (l === null || !isLane(to) || lanes[to] !== undefined || typeof l.pkh !== 'string' || !Number.isSafeInteger(l.nextSeq) || (l.nextSeq as number) < 0) throw refuse();
    try {
      // Pinned: the key opened (by the device's non-extractable X25519 key, as TK) must hash to the
      // pkh named, so a key the API made up, or a wrap of another lane's, is refused.
      lanes[to] = { pk: await unwrapPrivateKey(device.opener, l.wrap, l.pkh), pkh: l.pkh, nextSeq: l.nextSeq as number };
    } catch {
      throw refuse();
    }
  }
  // One replay guard per lane: seq runs per (from, lane).
  const guards = { shared: new ReplayGuard(channel), buyer: new ReplayGuard(channel), seller: new ReplayGuard(channel) };
  const lines: CaseChatLine[] = [];
  let unreadable = 0;
  let missing = 0;
  // Review N2: the last verified seq per lane and sender; a gap found on an envelope that is not a
  // line is carried to the next line shown.
  const last = new Map<string, number>();
  let carried = 0;
  const olderNotShown = a.olderNotShown === true && a.envelopes.length === CASE_CHAT_READ_MAX;
  for (const e of a.envelopes) {
    // The API's word on the lane; the envelope's own signed `to` must agree (openPrivate), and a v3
    // envelope filed as shared never opens under TK.
    const lane = isLane(e.to) ? e.to : null;
    let o: { from: string; type: string; payload: unknown };
    try {
      if (lane === null) o = await openChat(e.envelope, { tk, trade: channel, participants, guard: guards.shared });
      else {
        const pk = lanes[lane]?.pk;
        if (pk === undefined) throw security();
        o = await openPrivate(e.envelope, { pk, trade: channel, to: lane, participants, guard: guards[lane] });
      }
    } catch {
      unreadable += 1;
      continue;
    }
    // Verified: signed by the attested `from` at this seq (the replay guard took it as newer).
    const seq = (e.envelope as { seq: number }).seq;
    const key = `${lane ?? ''}:${o.from}`;
    // A sender's first line in a cut read follows their older lines, not a gap.
    const prev = last.get(key);
    const gap = prev === undefined && olderNotShown ? 0 : seq - ((prev ?? -1) + 1);
    last.set(key, seq);
    missing += gap;
    carried += gap;
    const p = o.payload as { text?: unknown } | null;
    if (o.type !== CHAT_MSG_TYPE || typeof p?.text !== 'string' || o.from !== e.senderRole) {
      unreadable += 1;
      continue;
    }
    lines.push({ id: e.id, from: o.from as CaseChatLine['from'], text: p.text, at: e.at, missingBefore: carried, ...(lane !== null ? { to: lane } : {}) });
    carried = 0;
  }
  return { chat: a.chat, channel, participants, tk, tkh: a.tkh, nextSeq: a.nextSeq, lanes, lines, unreadable, missing, olderNotShown };
}

const isLane = (v: unknown): v is Lane => v === 'buyer' || v === 'seller';

/** The moderator's next seq in each lane the opened chat has. */
export function nextSeqByLane(c: OpenedChat): { buyer?: number; seller?: number } {
  const out: { buyer?: number; seller?: number } = {};
  for (const l of ['buyer', 'seller'] as const) {
    const x = c.lanes[l];
    if (x !== undefined) out[l] = x.nextSeq;
  }
  return out;
}

/** Wipes the chat key held for an opened chat. */
export function forget(c: OpenedChat): void {
  c.tk.fill(0);
  for (const l of Object.values(c.lanes)) l?.pk.fill(0);
}

/**
 * What `POST …/messages` takes: the message sealed under the chat key as `mod` at `seq`,
 * countersigned by this device. With `to`: a private message, sealed as v3 under that lane's key
 * and countersigned with the lane countersign (it names the lane, so the API cannot move it).
 */
export async function sealModMessage(c: OpenedChat, text: string, device: StaffDeviceKey, now: Date, seq = c.nextSeq, to?: Lane): Promise<SealedModMessage> {
  if (!modTextOk(text)) throw new CaseChatError('unreadable');
  const rid = new Uint8Array(16);
  globalThis.crypto.getRandomValues(rid);
  const requestId = Array.from(rid, (x) => x.toString(16).padStart(2, '0')).join('');
  if (to !== undefined) {
    if (!isLane(to)) throw new CaseChatError('unreadable');
    const lane = c.lanes[to];
    // The lane must exist here and its key still be the one pinned (never sealed under a wiped key).
    if (lane === undefined || lane.pk.every((x) => x === 0)) throw security();
    if ((await privateKeyHash(lane.pk)) !== lane.pkh) throw security();
    const body = await encryptPrivate({ trade: c.channel, from: 'mod', to, seq, type: CHAT_MSG_TYPE, payload: { text }, pk: lane.pk });
    const cs = await makeModPrivateCountersign({ body, requestId, issuedAt: now.toISOString(), me: device.signer });
    return { deviceKeyId: device.deviceKeyId, seq, nonce: body.nonce, ct: body.ct, ctSha256: cs.ctSha256, requestId: cs.requestId, issuedAt: cs.issuedAt, sig: cs.sig, to };
  }
  // The key must still be the chat's (never sealed under a wiped key).
  if (c.tk.every((x) => x === 0)) throw security();
  if ((await chatKeyHash(c.tk)) !== c.tkh) throw security();
  const body = await encryptChat({ trade: c.channel, from: 'mod', seq, type: CHAT_MSG_TYPE, payload: { text }, tk: c.tk });
  // Signed by the device's non-extractable Ed25519 key (review B1: subtle.sign).
  const cs = await makeModCountersign({ body, requestId, issuedAt: now.toISOString(), me: device.signer });
  return { deviceKeyId: device.deviceKeyId, seq, nonce: body.nonce, ct: body.ct, ctSha256: cs.ctSha256, requestId: cs.requestId, issuedAt: cs.issuedAt, sig: cs.sig };
}
