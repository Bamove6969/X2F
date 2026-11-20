/**
 * The chat engine (Task 20): runs in the escrow worker next to the escrow runtime, so the chat
 * identity's secret keys never reach the page. The page sends `sync` and `send` and gets back a
 * ChatSnapshot of plain, already-verified lines.
 *
 * - Device binding: the first sync on a device makes the chat identity, saves it, then registers
 *   it. For a trade's chat that first step normally runs earlier, without any sync: `prepare`, which
 *   the escrow runtime calls when the device runs the trade (regtest gap 5, chat/prepare.ts), so the
 *   chat is attested once both devices ran the trade, whether or not anyone opened it. If the API already holds another key for this role, the chat is open on another device:
 *   the snapshot is read-only (`other-device`) and nothing is ever sealed here.
 * - Before the first open or seal, the moderation attestation is verified against the pinned
 *   moderation signing key in the chat context (`channels.chat === chatChannel(chat)`, this
 *   device's own keys in its slot, no terms). Participants come only from that attestation, never
 *   from the API.
 * - Every pending envelope is opened (and the state saved) before sealing, posts go one at a time,
 *   and the state is saved after sealing and before posting (chatCrypto's contract).
 * - Who sent a line: the envelope's verified signer AND the server's stored sender role
 *   (`senderRole`, the session's role when it was posted) must agree, or the line is dropped. A
 *   moderator line is accepted only while a dispute is open (`modMayPost`), so the moderator badge
 *   can only ever follow a message the attested mod identity signed and the server recorded as mod.
 * - A payee's packaged payment details (J-08, S-090) is a line like any other with `pay` set: the
 *   text is the plain rendering, `pay` the boxes for the card. `sendPay` seals one (chatCrypto's
 *   sealPayDetails); a bad package is 'bad-details'. Like the text, the boxes are never stored on
 *   the device: a reopen decrypts them again. Owner Q12: the details reach the buyer only once the
 *   escrow is secured, so a package is shown (`payAllowed`) only while the API's chat view says the
 *   trade was secured (`tradeSecuredAt`). One sent before that is taken into the guard (so the
 *   sender's later lines are not blocked behind it: a seq once passed can never be accepted) with
 *   a receipt marked `heldPay`, and no text; once the trade is secured the chat is read again from
 *   the start and the held package is decrypted and shown in its place. Dispute evidence
 *   (`proof.attached` kind 'evidence') is held the same way (`heldEvidence`) while the API's view
 *   has no open dispute, so evidence that races the dispute opening is not lost (proof-receive
 *   review M2); it is shown, and re-opened after a reload, while a dispute is open (M1).
 * - A fixed notice (P-020, notices.ts) is a line with `notice` set and the reader's own wording as
 *   its text. `sendNotice` seals one (chatCrypto's sealChatNotice), only once the trade is secured
 *   (a proof only exists then), like a package. The upload sends `proofCodeNotice(...)` with the
 *   proof (screens/proof/AddProof.tsx sendCodeNotice, proof stack).
 * - No message text is stored on the device (owner p11-10, design 2026-11-08 section 5): the store
 *   keeps keys, the ChatState, the cursor and a receipt per accepted line. The first sync of a chat
 *   in this worker re-reads the whole chat from the server and decrypts it again; a line the guard
 *   already took is shown only for the same signed envelope (its receipt's signature). The text is
 *   kept in this worker's memory only, for the later syncs of the same session, and only once that
 *   first read went through (review I3): a read that fails partway is done again from the start.
 * - A line the device took earlier that the re-read cannot show again (the server no longer serves
 *   it, or serves another envelope in its place) is a placeholder line from its receipt: its sender
 *   and time, `missing`, no text (review I2). A drop is shown as a gap, never hidden.
 * - Envelopes at or below the cursor were all decided before: on a re-read, one with no receipt is
 *   skipped, never opened (review M2).
 * - Only what may become valid on a later sync stops the cursor: a moderator line outside a dispute
 *   (`mod-not-allowed`) and, by the held path above, a well-formed package before the trade is
 *   secured. An envelope that can never become a line (a payload that is not a chat message, a
 *   lying, malformed or mod-signed package) is passed with a receipt marked `refused`, so the
 *   counterparty cannot make every later sync re-fetch the rest of the chat (pay-details review M1).
 * - One key per chat, envelope v2 (design-chat-membership-keys-2026-11-08, build task 5): once the
 *   attestation checks out and before any envelope is read or sealed, the engine gets the chat key.
 *   No record on the server: it makes the key and posts its signed record (`POST …/key`); the other
 *   side's record won the race (409): it reads that one. A record is accepted only when signed by
 *   the ATTESTED identity of the trader it names, for this chat, and this device's copy hashes to
 *   its tkh; otherwise the chat fails with `security` and nothing is read or sent. The key is kept
 *   in this worker's memory only, never stored: each worker start opens this device's copy again.
 *   Every envelope is sealed and opened as v2 under the key; a v1 envelope is never opened or a line
 *   here, so no sender can leave the moderator out of what the counterparty reads (R16). Decision 16
 *   (lead call 18 Nov, docs/security/chat-membership-lead-decisions-2026-11-18.md): the one v1 the API
 *   takes in a keyed chat is a moderator request's unblurred copy (`sendUnblurred`, sealed to the
 *   moderator alone); while a dispute is open a trader's validly signed v1 is kept as an `away`
 *   receipt (the sender's "Sent"), anything else refused for good. Neither is ever unwrapped.
 * - Erase on purge: when the API answers 410 `chat-purged` for a chat, its record and the lines in
 *   memory are erased; `sweep` checks every stored chat once per worker start. A 404 keeps the
 *   record (a block hides a chat with that same 404, and it may come back).
 */
import type { Role } from '@x2f/core';
import { chatKeyHash, isPlainObject, makeChatGrant, open, ProtocolError, ReplayGuard, verifyChatGrant, verifyDisputeNotice, verifyGrantAccepted, type ChatEnvelopeV2, type ChatGrant, type Envelope, type Identity, type Participants } from '@x2f/protocol';
import { AttestationError, PayDetailsError, attestationKeys, checkChatEnvelopeV2, verifyAttestation, type Attestation, type PayDetailsPayload } from '@x2f/trade';
import { ProofError, type ProofAttachedPayload, type ProofUnblurredPayload } from '@x2f/proof';
import { ChatError, chatChannel, chatKeyOf, makeChatKey, newChatState, openChatMessage, sealChatMessage, sealChatNotice, sealPayDetails, sealProofAttached, sealProofUnblurred, signChatIdentity, type ChatState } from './chatCrypto.js';
import type { ChatNoticeId } from './notices.js';
import type { ChatRecord, ChatStore, StoredChatReceipt } from './store.js';

export interface ChatApiView {
  role: 'buyer' | 'seller';
  counterparty: string | null;
  disputeOpen: boolean;
  /** When the linked trade's escrow was secured, or null (owner Q12: packages are shown only from then). */
  tradeSecuredAt: string | null;
  /** The signing key the API holds for the caller's role in this chat, or null. */
  mySignPublic: string | null;
  /** Build task 6: the trader grants of the chat key to the moderator, each with its acceptance (both unverified here). */
  grants: Array<{ grant: unknown; accepted: unknown | null }>;
  /** Build task 7 (T2): the moderator's signed dispute notice for the current dispute, or null (unverified here). */
  notice: unknown | null;
}

export interface ApiEnvelope {
  id: string;
  senderRole: string;
  envelope: unknown;
  at?: string | null;
}

export interface ChatApi {
  getChat(chat: string): Promise<ChatApiView>;
  /** 'exists' for 409 identity-exists. */
  registerIdentity(chat: string, body: { signPublic: string; boxPublic: string; proof: string }): Promise<'ok' | 'exists'>;
  /** null while pending; throws `{ code: 'attestation-refused' }` when refused for good. */
  getAttestation(chat: string): Promise<{ attestation: unknown; sig: unknown } | null>;
  listEnvelopes(chat: string, after: string): Promise<{ envelopes: ApiEnvelope[]; more: boolean }>;
  /** Throws `{ status, code }` on a refusal. */
  postEnvelope(chat: string, envelope: unknown): Promise<string>;
  /** Build task 5: the chat's signed key record (`GET …/key`), or null when it has none (404 no-key). */
  getKey(chat: string): Promise<unknown | null>;
  /** Posts this device's signed key record; 'exists' for 409 key-exists (the other side's came first). */
  postKey(chat: string, record: unknown): Promise<'ok' | 'exists'>;
  /** Build task 6: the counterparty's fallback grant (`POST …/grant`); 'not-needed' for 409 grant-not-needed. */
  postGrant(chat: string, grant: unknown): Promise<'ok' | 'not-needed'>;
}

export type ChatPhase = 'waiting' | 'ready' | 'other-device' | 'failed';

export interface ChatLine {
  id: string;
  from: Role;
  text: string;
  at: string | null;
  mine: boolean;
  gapBefore: boolean;
  /**
   * A line this device took earlier that the server no longer serves as it was (review I2): `text`
   * is empty and the panel says the message is no longer on the server.
   */
  missing?: true;
  /** The payee's packaged payment details (J-08): the panel shows a card; `text` is its plain rendering. */
  pay?: PayDetailsPayload;
  /**
   * NEEDS_PROOF_RECEIVE: a payment proof or dispute evidence (`proof.attached`): `text` is empty and
   * the panel shows the picture (ChatProof). Carries the proof's key: it stays in the page's memory.
   */
  proof?: ProofAttachedPayload;
  /** A fixed notice (P-020): the panel shows its own wording as a system line; `text` is that wording. */
  notice?: ChatNoticeId;
}

export interface ChatSnapshot {
  phase: ChatPhase;
  /** For `failed`: the attestation did not check out (`security`) or moderation refused it. */
  problem: 'security' | 'refused' | null;
  role: 'buyer' | 'seller';
  counterparty: string | null;
  disputeOpen: boolean;
  /**
   * Build task 7 (T2): the dispute was opened by the system, and both checks hold: the moderator's
   * notice verifies against the attested moderator identity AND the API's own `disputeOpen` is true.
   * The panel then shows "A moderator has been called by the system", so the trader sees why their
   * app handed the chat key to the moderator.
   */
  systemCalled?: boolean;
  /** The trade's escrow is secured (owner Q12): the payee may send a package, and packages are shown. */
  paySecured: boolean;
  lines: ChatLine[];
  /**
   * Review I2 (wip/lead-proof-upload): the server's times of this side's own moderator-only envelopes
   * (its `away` receipts, the unblurred copy's key), oldest first. SendUnblurred shows "Sent" only
   * with one of these at or after the request, never from the dispute view's `sentAt` alone.
   */
  modOnlySentAt?: string[];
  /**
   * The sync stopped at its page cap with envelopes still unread (review M8): the next sync goes on
   * from the saved cursor, and the panel says "Loading more messages…".
   */
  more: boolean;
}

/**
 * `uncertain` (proof review M2, a proof only): the post got no answer from the API (the connection
 * dropped, or a 5xx), so the envelope may be stored and with the other side already.
 */
export type ChatSendError = 'not-ready' | 'bad-text' | 'bad-details' | 'bad-proof' | 'too-large' | 'slow-down' | 'refused' | 'uncertain';

export class ChatSendFailed extends Error {
  /** `cause`: the API's refusal behind a 'refused' (a 410 there erases the chat). */
  constructor(readonly code: ChatSendError, cause?: unknown) {
    super(code, cause === undefined ? undefined : { cause });
    this.name = 'ChatSendFailed';
  }
}

export interface ChatEngine {
  sync(chat: string): Promise<ChatSnapshot>;
  send(chat: string, text: string): Promise<ChatSnapshot>;
  /** Seals and posts the payee's packaged payment details (J-08); 'bad-details' for a bad package, 'not-ready' while the trade is not secured (owner Q12). */
  sendPay(chat: string, pay: PayDetailsPayload): Promise<ChatSnapshot>;
  /** Seals and posts a fixed notice (P-020); 'not-ready' while the trade is not secured. */
  sendNotice(chat: string, notice: ChatNoticeId): Promise<ChatSnapshot>;
  /**
   * Build task 6 (design section 3, T1): this trader's signed grant of the chat key to the chat's
   * attested moderator identity, for the dispute request (`disputeAt`: this device's time, ISO).
   * 'not-ready' when the chat is not ready (no key yet: then the API needs no grant). The grant holds
   * only a wrap the moderator's key opens; no key or text crosses to the page.
   */
  grant(chat: string, disputeAt: string): Promise<ChatGrant>;
  /**
   * Plan 5 Task 15: seals and posts a `proof.attached` (the proof's key, to buyer, seller and mod);
   * 'bad-proof' for a malformed payload or a payment proof from the seller; 'not-ready' while the
   * trade is not secured, for evidence too (proof review M4, as sendPay); 'uncertain' when the post
   * got no answer and may be stored (review M2). Once the API answered the post, it resolves even if
   * the read after it fails. The image itself went up as ciphertext before this (proof/upload.ts).
   * Syncs open `proof.attached` as proof lines (the receive half, ChatPanel's ChatProof), the
   * sender's own included.
   */
  sendProof(chat: string, proof: ProofAttachedPayload): Promise<ChatSnapshot>;
  /**
   * Plan 5 Task 15 (SendUnblurred): seals and posts a `proof.unblurred` (the unblurred copy's key) to
   * the moderator only; 'not-ready' unless the trade was secured and a dispute is open (the API's own
   * rule for the copy is the moderator's request); 'bad-proof' for a malformed payload; 'uncertain' as
   * sendProof. No trader's device can open it, this one included: syncs keep it as an `away` receipt
   * (no line, no gap of its own; review I1: a gap before it shows on the sender's next line). The image went up as ciphertext before this (proof/upload.ts sendUnblurred).
   */
  sendUnblurred(chat: string, proof: ProofUnblurredPayload): Promise<ChatSnapshot>;
  /**
   * Regtest e2e gap 5 (Plan 5 Tasks 15 and 20): the identity step of a sync alone. Makes, saves and
   * registers this device's chat identity for the chat (as the first sync does), and reads nothing
   * else: no attestation, no key, no envelope. The escrow runtime calls it (chat/prepare.ts) when the
   * device runs the trade, because moderation attests a chat only once both traders registered one:
   * without it, neither side could send before the other had opened the chat. 'other-device' when
   * another device of the account holds the role (nothing made). A 410 erases the chat, as everywhere.
   */
  prepare(chat: string): Promise<'registered' | 'other-device'>;
  /**
   * Asks the API about every chat stored on this device and erases each one it answers 410
   * `chat-purged` for; resolves with those. Any other answer (or none) keeps the record. Rejects on
   * a 401 (no live session: nothing can be told apart), so the caller tries again later.
   */
  sweep(): Promise<string[]>;
}

/**
 * Build task 6: how long a counterparty waits for the moderator to accept the disputer's grant
 * before granting too (T1 by proxy). Engineering call, for the reviewer.
 */
export const GRANT_FALLBACK_MS = 2 * 60_000;

/** The API purged the chat (410 `chat-purged`): the device's copy must go. */
export const isPurged = (e: unknown): boolean => (e as { status?: unknown } | null)?.status === 410;

export interface ChatEngineDeps {
  api: ChatApi;
  store: ChatStore;
  newIdentity: () => Promise<Identity>;
  modSigningPublic: string;
  /** The device clock (ms); default Date.now(). */
  now?: () => number;
}

const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
function unhex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}
const toIdentity = (r: ChatRecord['identity']): Identity => ({
  signPublic: r.signPublic,
  boxPublic: r.boxPublic,
  signSecret: unhex(r.signSecret),
  boxSecret: unhex(r.boxSecret),
});
const ROLES_SET = new Set(['buyer', 'seller', 'mod']);
/** Most envelope pages past the cursor read in one sync. */
const MAX_PAGES = 20;
/** Most envelope pages read in one sync in all (the re-read of the lines already taken included). */
const MAX_TOTAL_PAGES = 1_000;
const sigOf = (envelope: unknown): string | null => (isPlainObject(envelope) && typeof envelope.sig === 'string' ? envelope.sig : null);
/** The sender and seq an envelope's header claims (its shape checked, nothing verified), or null when it is not even an envelope. */
/** Build task 5: a v1 envelope (`v: 1`) is never a line in a v2 chat; it is refused for good. */
const isV1 = (envelope: unknown): boolean => isPlainObject(envelope) && envelope.v === 1;
/** A v1 envelope's claimed sender and seq, for its refused receipt (nothing verified). */
function headerV1(envelope: unknown, channel: string): { from: Role; seq: number } | null {
  if (!isPlainObject(envelope) || envelope.trade !== channel || typeof envelope.from !== 'string' || !ROLES_SET.has(envelope.from) || typeof envelope.seq !== 'number' || !Number.isSafeInteger(envelope.seq) || envelope.seq < 0) return null;
  return { from: envelope.from as Role, seq: envelope.seq };
}
function headerOf(envelope: unknown, channel: string): { from: Role; seq: number } | null {
  try {
    const env = checkChatEnvelopeV2(envelope, channel);
    return { from: env.from, seq: env.seq };
  } catch {
    return null;
  }
}

/** Decision 16: thrown inside the read loop for any v1 envelope, so it is decided without being opened. */
class V1InKeyedChat extends Error {}

/**
 * Decision 16: whether a v1 envelope is signed by `from`'s attested identity, WITHOUT unwrapping it.
 * Plan 1's `open` checks the shape and the signature first and, for an envelope from the reader's own
 * role without `allowSelf`, then stops with 'not-for-me' before touching any slot. So it is called as
 * `from` itself: 'not-for-me' means the signature checked out, and nothing was decrypted.
 */
async function v1SignedBy(envelope: unknown, channel: string, parts: Participants, from: 'buyer' | 'seller', me: Identity): Promise<boolean> {
  try {
    await open(envelope, { me, myRole: from, participants: parts, trade: channel, guard: new ReplayGuard(channel) });
    return false;
  } catch (e) {
    return e instanceof ProtocolError && e.code === 'not-for-me';
  }
}

export function createChatEngine(d: ChatEngineDeps): ChatEngine {
  /** One operation at a time per chat (posts are sent one by one, chatCrypto's contract). */
  const queues = new Map<string, Promise<unknown>>();
  const serial = <T>(chat: string, fn: () => Promise<T>): Promise<T> => {
    const prev = queues.get(chat) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    queues.set(chat, next.catch(() => undefined));
    return next;
  };

  /**
   * Per chat, once its first read in this worker went through: the text of each line opened, by
   * envelope id, and how far the reads reached (`all` once a read reached the end). Memory only.
   */
  const sessions = new Map<string, { texts: Map<string, Shown>; reached: bigint | 'all' }>();
  /** Build task 5: each chat's key, in this worker's memory only (never stored on the device). */
  const keys = new Map<string, Uint8Array>();
  /** Review F6: when this worker first saw each counterparty grant (by its signature), its own clock. */
  const grantSeen = new Map<string, number>();
  /** Review F7: the key's bytes are wiped before it is dropped (libsodium's memzero is a fill in JS). */
  const forgetKey = (chat: string): void => {
    keys.get(chat)?.fill(0);
    keys.delete(chat);
  };
  const erase = async (chat: string): Promise<void> => {
    sessions.delete(chat);
    forgetKey(chat);
    await d.store.delete(chat);
  };

  const snapshot = (rec: ChatRecord | null, view: ChatApiView, phase: ChatPhase, problem: ChatSnapshot['problem'] = null, more = false): ChatSnapshot => {
    const session = rec ? sessions.get(rec.chat) : undefined;
    /** A receipt the reads went past without showing it again: a placeholder (review I2). */
    const judged = (id: string): boolean => session !== undefined && (session.reached === 'all' || BigInt(id) <= session.reached);
    /**
     * A package held until the escrow is secured (owner Q12) is not a line yet, not even a
     * placeholder; an envelope refused for good (pay-details review M1) never is.
     */
    const withheld = (m: StoredChatReceipt): boolean => m.refused === true || m.away === true || ((m.heldPay === true || m.heldEvidence === true) && session?.texts.has(m.id) !== true);
    const sorted = [...(rec?.receipts ?? [])].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
    /**
     * Each shown line's gap marker. Review I1 (wip/lead-proof-upload): an `away` receipt is never
     * shown, so a gap before it (lines the relay dropped) goes onto that sender's next shown line.
     */
    const gaps = new Map<string, boolean>();
    const carried = new Set<Role>();
    for (const m of sorted) {
      if (m.refused === true) continue;
      if (m.away === true) {
        if (m.gapBefore) carried.add(m.from);
        continue;
      }
      if (withheld(m) || !(session?.texts.has(m.id) === true || judged(m.id))) continue;
      gaps.set(m.id, m.gapBefore || carried.has(m.from));
      carried.delete(m.from);
    }
    return {
      phase,
      more,
      problem,
      role: view.role,
      counterparty: view.counterparty,
      disputeOpen: view.disputeOpen,
      systemCalled: false,
      paySecured: view.tradeSecuredAt !== null,
      modOnlySentAt: sorted.filter((m) => m.away === true && m.from === view.role && m.at !== null).map((m) => m.at as string),
      // By the server's order: a moderator line held until a dispute opened is shown where it was posted.
      lines: sorted
        .filter((m) => gaps.has(m.id))
        .map((m): ChatLine => {
          const line = { id: m.id, from: m.from, at: m.at, mine: m.from === view.role, gapBefore: gaps.get(m.id) === true };
          const shown = session?.texts.get(m.id);
          if (shown === undefined) return { ...line, text: '', missing: true };
          if (shown.proof !== undefined) return { ...line, text: shown.text, proof: shown.proof };
          if (shown.notice !== undefined) return { ...line, text: shown.text, notice: shown.notice };
          return shown.pay === undefined ? { ...line, text: shown.text } : { ...line, text: shown.text, pay: shown.pay };
        }),
    };
  };

  /** Makes, saves, then registers this device's chat identity; false when another device holds the role. */
  async function ensureIdentity(chat: string, view: ChatApiView): Promise<ChatRecord | null> {
    let rec = await d.store.load(chat);
    if (rec && rec.role !== view.role) return null;
    if (!rec) {
      if (view.mySignPublic !== null) return null;
      const me = await d.newIdentity();
      rec = {
        v: 2,
        chat,
        role: view.role,
        identity: { signPublic: me.signPublic, boxPublic: me.boxPublic, signSecret: hex(me.signSecret), boxSecret: hex(me.boxSecret) },
        identityCreatedAt: (d.now ?? Date.now)(),
        registered: false,
        attestation: null,
        state: null,
        cursor: '0',
        receipts: [],
      };
      await d.store.save(rec);
    }
    if (!rec.registered) {
      if (view.mySignPublic !== null && view.mySignPublic !== rec.identity.signPublic) return null;
      if (view.mySignPublic === null) {
        const proof = await signChatIdentity(toIdentity(rec.identity), chat, rec.role);
        const r = await d.api.registerIdentity(chat, { signPublic: rec.identity.signPublic, boxPublic: rec.identity.boxPublic, proof });
        // 'exists' with no key known before: another device won the race. Re-read who holds it.
        if (r === 'exists') {
          const again = await d.api.getChat(chat);
          if (again.mySignPublic !== rec.identity.signPublic) return null;
        }
      }
      rec = { ...rec, registered: true };
      await d.store.save(rec);
    } else if (view.mySignPublic !== null && view.mySignPublic !== rec.identity.signPublic) {
      return null;
    }
    return rec;
  }

  async function participantsOf(rec: ChatRecord): Promise<Participants> {
    const a = rec.attestation!;
    await verifyAttestation(a.attestation as Attestation, a.sig, attestationKeys(d.modSigningPublic), {
      trade: rec.chat,
      role: rec.role,
      signPublic: rec.identity.signPublic,
      boxPublic: rec.identity.boxPublic,
      context: 'chat',
      now: (d.now ?? Date.now)(),
      // Review M1: not older than the identity this device made for the chat (none in old records).
      identityCreatedAt: rec.identityCreatedAt ?? null,
    });
    return (a.attestation as Attestation).participants;
  }

  /**
   * Build task 5: the chat key. The stored record if there is one, else one made here and posted
   * (a 409 means the other side's came first: that one is read). A record that does not check out
   * against the attested participants and this device's copy throws ProtocolError.
   */
  /**
   * The chat key (build task 5), pinned by its fingerprint (review F3): the tkh of the first record
   * this device accepted or posted is saved in its ChatRecord before anything is sealed under it.
   * After that, a record of another tkh, or none at all (404), is a security failure and the device
   * never makes a second key: the API alone cannot change the chat's key mid-chat.
   */
  async function chatKey(rec: ChatRecord, parts: Participants): Promise<{ tk: Uint8Array; rec: ChatRecord }> {
    const have = keys.get(rec.chat);
    if (have) return { tk: have, rec };
    const a = { channel: await chatChannel(rec.chat), role: rec.role, me: toIdentity(rec.identity), participants: parts };
    const pin = async (tk: Uint8Array, tkh: string): Promise<{ tk: Uint8Array; rec: ChatRecord }> => {
      if (rec.tkh !== undefined && rec.tkh !== tkh) {
        tk.fill(0);
        throw new ProtocolError('bad-signature', 'the chat key is not the one this device pinned');
      }
      const pinned = rec.tkh === tkh ? rec : { ...rec, tkh };
      if (pinned !== rec) await d.store.save(pinned);
      keys.set(rec.chat, tk);
      return { tk, rec: pinned };
    };
    let raw = await d.api.getKey(rec.chat);
    if (raw === null) {
      if (rec.tkh !== undefined) throw new ProtocolError('bad-signature', 'the pinned chat key record is gone');
      const made = await makeChatKey(a);
      if ((await d.api.postKey(rec.chat, made.record)) === 'ok') return pin(made.tk, made.record.tkh);
      made.tk.fill(0);
      raw = await d.api.getKey(rec.chat);
      if (raw === null) throw new ProtocolError('bad-signature', 'key record missing after key-exists');
    }
    const tk = await chatKeyOf(raw, a);
    return pin(tk, await chatKeyHash(tk));
  }

  /**
   * Re-opens a line the guard already took (its receipt), for a re-read: with a fresh guard, and
   * only for the same envelope (its signature) from the same sender and seq. Null when it is not.
   */
  async function reopen(rec: ChatRecord, me: Identity, parts: Participants, e: ApiEnvelope, r: StoredChatReceipt, channel: string, secured: boolean, disputeOpen: boolean, tk: Uint8Array): Promise<Shown | null> {
    try {
      if (e.senderRole !== r.from || (r.sig !== null && sigOf(e.envelope) !== r.sig)) return null;
      const fresh = { channel, nextSeq: 0, guard: new ReplayGuard(channel).toJSON() };
      // A moderator line it showed once (during a dispute) is shown again: the guard took it then. A
      // package only once the trade is secured (owner Q12): before that the only package receipts are held ones.
      // Evidence only while a dispute is open (P5-A30), so a reload during the dispute shows it again (review M1).
      const o = await openChatMessage(e.envelope, { role: rec.role, me, participants: parts, state: fresh, modMayPost: true, payAllowed: secured, evidenceAllowed: disputeOpen, tk });
      return o.message.from === r.from && o.message.seq === r.seq ? shownOf(o.message) : null;
    } catch {
      return null;
    }
  }

  /**
   * Reads and opens the envelopes: from the start of the chat on its first sync in this worker (the
   * device keeps no text), else past the cursor. A line with a receipt is re-opened (`reopen`); one
   * at or below the cursor with none is skipped (review M2); any other goes through the saved guard,
   * and the record is saved after each one it takes. At most MAX_PAGES pages past the cursor; `more`
   * when it stopped there with envelopes still unread. The session (the texts) is kept only once the
   * read went through (review I3): a read that throws leaves a first read to be done again.
   */
  async function readAll(rec: ChatRecord, view: ChatApiView, parts: Participants, tk: Uint8Array): Promise<{ rec: ChatRecord; more: boolean }> {
    const me = toIdentity(rec.identity);
    const channel = await chatChannel(rec.chat);
    let state: ChatState = rec.state ?? newChatState(channel);
    const session = sessions.get(rec.chat);
    const shown = session?.texts ?? new Map<string, Shown>();
    const secured = view.tradeSecuredAt !== null;
    // Read from the start on the first sync in this worker, and again once the trade is secured
    // while a held package (owner Q12) is still to be shown: its envelope is below the cursor.
    const cold =
      session === undefined ||
      (secured && rec.receipts.some((r) => r.heldPay === true && !shown.has(r.id))) ||
      (view.disputeOpen && rec.receipts.some((r) => r.heldEvidence === true && !shown.has(r.id)));
    const start = BigInt(rec.cursor);
    let cursor = rec.cursor;
    let held = false;
    let after = cold ? '0' : rec.cursor;
    const receipts = [...rec.receipts];
    const known = new Map(receipts.map((r) => [r.id, r]));
    let unread = false;
    const lastSeq = new Map<Role, number>();
    // A refused envelope's seq was never taken (the sender may reuse it), so it does not count.
    for (const m of receipts) if (m.refused !== true) lastSeq.set(m.from, Math.max(lastSeq.get(m.from) ?? -1, m.seq));
    for (let page = 0, total = 0; page < MAX_PAGES && total < MAX_TOTAL_PAGES; total++) {
      const { envelopes, more } = await d.api.listEnvelopes(rec.chat, after);
      if (envelopes.some((e) => BigInt(e.id) > start)) page++;
      for (const e of envelopes) {
        after = e.id;
        const past = BigInt(e.id) > start;
        const receipt = known.get(e.id);
        if (receipt) {
          if (receipt.refused !== true && receipt.away !== true && !shown.has(e.id)) {
            const again = await reopen(rec, me, parts, e, receipt, channel, secured, view.disputeOpen, tk);
            if (again !== null) shown.set(e.id, again);
          }
          if (past && !held && cursor !== e.id) {
            cursor = e.id;
            rec = { ...rec, cursor };
            await d.store.save(rec);
          }
          continue;
        }
        // Decided before (taken, or skipped as a replay or forgery): a new line given an old id is never read.
        if (!past) continue;
        let advance = true;
        try {
          if (!ROLES_SET.has(e.senderRole)) throw new ChatError('bad-message', 'unknown sender');
          // Decision 16: a v1 envelope is never opened in this (keyed) chat; it is decided in the catch below.
          if (isV1(e.envelope)) throw new V1InKeyedChat();
          const args = { role: rec.role, me, participants: parts, state, modMayPost: view.disputeOpen, evidenceAllowed: view.disputeOpen, tk };
          let r: Awaited<ReturnType<typeof openChatMessage>>;
          let withhold: 'pay' | 'evidence' | null = null;
          try {
            r = await openChatMessage(e.envelope, { ...args, payAllowed: secured });
          } catch (err) {
            // Not a message yet: a well-formed package while the trade is not secured (owner Q12), or
            // evidence while no dispute is open (review M2). Take it into the guard but hold it, so
            // the sender's later lines are not stuck behind it; anything else stays refused.
            if ((secured && view.disputeOpen) || !(err instanceof ChatError && err.code === 'bad-message')) throw err;
            r = await openChatMessage(e.envelope, { ...args, payAllowed: true, evidenceAllowed: true });
            if (!secured && r.message.pay !== undefined) withhold = 'pay';
            else if (!view.disputeOpen && r.message.proof?.kind === 'evidence') withhold = 'evidence';
            else throw err;
          }
          // The signer and the server's record must agree (never trust one of them alone).
          if (r.message.from !== e.senderRole) throw new ProtocolError('bad-signature', 'sender mismatch');
          state = r.state;
          const prev = lastSeq.get(r.message.from);
          const m: StoredChatReceipt = {
            id: e.id,
            from: r.message.from,
            seq: r.message.seq,
            sig: sigOf(e.envelope),
            at: typeof e.at === 'string' ? e.at : null,
            // Senders start at seq 0, so a first line above 0 also follows missing ones (review M1).
            gapBefore: r.message.seq > (prev ?? -1) + 1,
            ...(withhold === 'pay' ? { heldPay: true as const } : withhold === 'evidence' ? { heldEvidence: true as const } : {}),
          };
          lastSeq.set(m.from, m.seq);
          receipts.push(m);
          known.set(m.id, m);
          if (withhold === null) shown.set(m.id, shownOf(r.message));
        } catch (err) {
          // A moderator line outside a dispute is tried again on a later sync: the cursor stops
          // before it (the guard did not move for it). A package before the trade is secured was
          // held above. Nothing else can become valid later.
          if (err instanceof ChatError && err.code === 'mod-not-allowed') advance = false;
          else if (err instanceof V1InKeyedChat) {
            // Decision 16 (lead call 18 Nov, option i). R16: no v1 envelope is ever opened here, so no
            // sender can leave the moderator out of what this trader reads. While a dispute is open, a
            // trader's v1 envelope whose signature checks out (v1SignedBy: verified, never unwrapped)
            // is the unblurred copy for the moderator (the API takes one per moderator request): an
            // `away` receipt, its seq taken (no gap before the sender's next line, but a gap before it
            // moves onto that line: review I1), never a line, never opened again. Anything else (no
            // dispute, a forged signature, a header that disagrees with the server) is refused for
            // good, as before: the guard did not move, so the sender's next line shows a gap.
            const h = headerV1(e.envelope, channel);
            const away = h !== null && view.disputeOpen && h.from === e.senderRole && (h.from === 'buyer' || h.from === 'seller') && (await v1SignedBy(e.envelope, channel, parts, h.from, me));
            if (h !== null && away) {
              const prev = lastSeq.get(h.from);
              const m: StoredChatReceipt = { id: e.id, from: h.from, seq: h.seq, sig: sigOf(e.envelope), at: typeof e.at === 'string' ? e.at : null, gapBefore: h.seq > (prev ?? -1) + 1, away: true };
              lastSeq.set(m.from, Math.max(prev ?? -1, m.seq));
              receipts.push(m);
              known.set(m.id, m);
            } else if (h !== null) {
              const m: StoredChatReceipt = { id: e.id, from: h.from, seq: h.seq, sig: sigOf(e.envelope), at: typeof e.at === 'string' ? e.at : null, gapBefore: false, refused: true };
              receipts.push(m);
              known.set(m.id, m);
            }
          } else if (err instanceof ChatError && err.code === 'bad-message') {
            // Decided for good (pay-details review M1): a receipt marks it refused so a re-read never
            // opens it again, and the cursor passes it. The guard did not move: the sender may reuse the seq.
            const h = headerOf(e.envelope, channel) ?? headerV1(e.envelope, channel);
            if (h !== null) {
              const m: StoredChatReceipt = { id: e.id, from: h.from, seq: h.seq, sig: sigOf(e.envelope), at: typeof e.at === 'string' ? e.at : null, gapBefore: false, refused: true };
              receipts.push(m);
              known.set(m.id, m);
            }
          }
          // Anything else (a replay of a line already shown, a forged or foreign envelope) is skipped.
        }
        if (!advance) held = true;
        if (!held) cursor = e.id;
        rec = { ...rec, state, cursor, receipts: [...receipts] };
        await d.store.save(rec);
      }
      unread = more;
      if (!more) break;
    }
    let reached: bigint | 'all' = unread ? BigInt(after) : 'all';
    if (session !== undefined && (session.reached === 'all' || (reached !== 'all' && session.reached > reached))) reached = session.reached;
    sessions.set(rec.chat, { texts: shown, reached });
    return { rec, more: unread };
  }

  async function syncLocked(chat: string): Promise<{ snap: ChatSnapshot; rec: ChatRecord | null; parts: Participants | null; view: ChatApiView; tk?: Uint8Array }> {
    const view = await d.api.getChat(chat);
    const rec0 = await ensureIdentity(chat, view);
    if (!rec0) return { snap: snapshot(null, view, 'other-device'), rec: null, parts: null, view };
    let rec = rec0;
    if (!rec.attestation) {
      let got: { attestation: unknown; sig: unknown } | null;
      try {
        got = await d.api.getAttestation(chat);
      } catch (e) {
        if ((e as { code?: unknown }).code === 'attestation-refused') return { snap: snapshot(rec, view, 'failed', 'refused'), rec, parts: null, view };
        throw e;
      }
      if (!got) return { snap: snapshot(rec, view, 'waiting'), rec, parts: null, view };
      if (typeof got.sig !== 'string') return { snap: snapshot(rec, view, 'failed', 'security'), rec, parts: null, view };
      rec = { ...rec, attestation: { attestation: got.attestation, sig: got.sig } };
    }
    let parts: Participants;
    try {
      parts = await participantsOf(rec);
    } catch (e) {
      if (e instanceof AttestationError) return { snap: snapshot(rec0, view, 'failed', 'security'), rec: null, parts: null, view };
      throw e;
    }
    await d.store.save(rec);
    let tk: Uint8Array;
    try {
      ({ tk, rec } = await chatKey(rec, parts));
    } catch (e) {
      // Design section 9: a key record that does not check out, or a copy that does not match its tkh.
      if (e instanceof ProtocolError || e instanceof TypeError) return { snap: snapshot(rec, view, 'failed', 'security'), rec: null, parts: null, view };
      throw e;
    }
    const read = await readAll(rec, view, parts, tk);
    rec = read.rec;
    const called = view.disputeOpen ? await fallbackGrant(rec, view, parts, tk) : { systemCalled: false };
    return { snap: { ...snapshot(rec, view, 'ready', null, read.more), ...called }, rec, parts, view, tk };
  }

  /**
   * Build task 6, T1 by proxy: while the trade is disputed, when the other side's grant (signed by its
   * ATTESTED identity, for this chat) has no acceptance signed by the attested moderator identity
   * after GRANT_FALLBACK_MS, and this side has granted nothing, this device grants too. It acts only
   * on a grant the disputer's own key signed, which the API cannot forge.
   * Build task 7, T2: with no accepted grant and nothing granted by this side, a dispute notice signed
   * by the ATTESTED moderator identity for this chat makes this device grant at once (the caller runs
   * this only while the API's own `disputeOpen` is true: both checks of design section 3). A system
   * notice also sets `systemCalled` for the panel's banner. Best effort: a refusal is left for the
   * next sync, a purge erases the chat as everywhere.
   */
  async function fallbackGrant(rec: ChatRecord, view: ChatApiView, parts: Participants, tk: Uint8Array): Promise<{ systemCalled: boolean }> {
    const channel = await chatChannel(rec.chat);
    const now = (d.now ?? Date.now)();
    // Review F4: an acceptance counts only for a grant of THIS chat's key, and only when the
    // acceptance names that same key; a grant or acceptance of any other key is unaccepted.
    const ours = await chatKeyHash(tk);
    let theirs: ChatGrant | null = null;
    let accepted = false;
    let mineFiled = false;
    for (const g of view.grants) {
      let v: ChatGrant;
      try {
        v = await verifyChatGrant(g.grant, { chat: channel, participants: parts });
      } catch {
        continue;
      }
      if (v.by === rec.role) mineFiled = true;
      else theirs = v;
      try {
        const a = await verifyGrantAccepted(g.accepted, { chat: channel, participants: parts });
        if (a.grantSig === v.sig && a.grantBy === v.by && v.tkh === ours && a.tkh === ours) accepted = true;
      } catch {
        // No acceptance, or one that does not verify: not accepted.
      }
    }
    // Build task 7 (T2): a notice counts only when it verifies against the attested moderator identity
    // for this chat, and only because the API's own disputeOpen is true too (the caller's check).
    let notice: { openedBy: string } | null = null;
    if (view.notice !== null) {
      try {
        notice = await verifyDisputeNotice(view.notice, { chat: channel, participants: parts });
      } catch {
        notice = null;
      }
    }
    const systemCalled = notice !== null && notice.openedBy === 'system';
    if (mineFiled || accepted) return { systemCalled };
    // Review F6: the wait runs from the earlier of the grant's signed disputeAt and when this worker
    // first saw it, so a disputer who dates its grant ahead cannot stretch it.
    let byProxy = false;
    if (theirs !== null) {
      const seen = grantSeen.get(theirs.sig) ?? now;
      grantSeen.set(theirs.sig, seen);
      byProxy = now - Math.min(Date.parse(theirs.disputeAt), seen) >= GRANT_FALLBACK_MS;
    }
    if (!byProxy && notice === null) return { systemCalled };
    const mine = await makeChatGrant({ chat: channel, by: rec.role, tk, disputeAt: new Date(now).toISOString(), me: toIdentity(rec.identity), participants: parts });
    try {
      await d.api.postGrant(rec.chat, mine);
    } catch (e) {
      if (isPurged(e)) throw e;
    }
    return { systemCalled };
  }

  /** Runs `fn`; a 410 `chat-purged` from the API on the way erases the chat here before it is rethrown. */
  const purging = async <T>(chat: string, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      if (isPurged(e) || isPurged((e as { cause?: unknown } | null)?.cause)) await erase(chat);
      throw e;
    }
  };

  /**
   * Seals with `make` and posts, the same way for a line and a package. A package (`secured`) is
   * refused with 'not-ready' while the API's view says the trade is not secured (owner Q12): the
   * page's closed button is not the only gate (pay-details review M2), and no seq is spent. A proof
   * (`proof`) tells an unanswered post ('uncertain') from a refusal, and counts a post the API
   * answered as sent even when the read after it fails (proof review M2).
   */
  function post(
    chat: string,
    make: (a: Omit<Parameters<typeof sealChatMessage>[0], 'text'>) => Promise<{ envelope: Envelope | ChatEnvelopeV2; state: ChatState }>,
    { secured = false, proof = false, dispute = false }: { secured?: boolean; proof?: boolean; dispute?: boolean } = {},
  ): Promise<ChatSnapshot> {
    return serial(chat, () => purging(chat, async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const s = await syncLocked(chat);
        if (s.snap.phase !== 'ready' || !s.rec || !s.parts || !s.tk) throw new ChatSendFailed('not-ready');
        if (secured && s.view.tradeSecuredAt === null) throw new ChatSendFailed('not-ready');
        if (dispute && !s.view.disputeOpen) throw new ChatSendFailed('not-ready');
        let sealed;
        try {
          sealed = await make({ role: s.rec.role, me: toIdentity(s.rec.identity), participants: s.parts, state: s.rec.state ?? newChatState(await chatChannel(chat)), tk: s.tk });
        } catch (e) {
          if (e instanceof ChatError && (e.code === 'bad-text' || e.code === 'too-large')) throw new ChatSendFailed(e.code);
          if (e instanceof PayDetailsError) throw new ChatSendFailed('bad-details', e);
          throw e;
        }
        // Saved before posting: a seq is never used twice.
        await d.store.save({ ...s.rec, state: sealed.state });
        try {
          await d.api.postEnvelope(chat, sealed.envelope);
        } catch (e) {
          const code = (e as { code?: unknown }).code;
          if (code === 'stale-seq' && attempt === 0) continue;
          if (code === 'too-large' || (e as { status?: unknown }).status === 413) throw new ChatSendFailed('too-large');
          // The per-account envelope budget (review M7). The seq stays used: the next line follows a gap.
          if ((e as { status?: unknown }).status === 429) throw new ChatSendFailed('slow-down');
          // No answer, or a 5xx (a proxy's 502/504 among them): the API may have stored it.
          const status = (e as { status?: unknown }).status;
          if (proof && !(typeof status === 'number' && status >= 400 && status < 500)) throw new ChatSendFailed('uncertain', e);
          throw new ChatSendFailed('refused', e);
        }
        if (!proof) return (await syncLocked(chat)).snap;
        try {
          return (await syncLocked(chat)).snap;
        } catch (e) {
          // Stored: the proof is sent. The snapshot from before it is what the page gets.
          if (isPurged(e)) throw e;
          return s.snap;
        }
      }
      throw new ChatSendFailed('refused');
    }));
  }

  return {
    sync: (chat) => serial(chat, () => purging(chat, async () => (await syncLocked(chat)).snap)),
    // Gap 5: the first step of syncLocked alone, in the same per-chat queue (so a prepare and a sync
    // at once never make two identities).
    prepare: (chat) => serial(chat, () => purging(chat, async () => ((await ensureIdentity(chat, await d.api.getChat(chat))) ? 'registered' : 'other-device'))),
    sweep: async () => {
      const gone: string[] = [];
      for (const chat of await d.store.list()) {
        try {
          await serial(chat, () => purging(chat, () => d.api.getChat(chat)));
        } catch (e) {
          if (isPurged(e)) gone.push(chat);
          // No live session: every other chat would answer the same. Stop; the caller tries later.
          else if ((e as { status?: unknown } | null)?.status === 401) throw e;
        }
      }
      return gone;
    },
    send: (chat, text) => post(chat, (a) => sealChatMessage({ ...a, text })),
    grant: (chat, disputeAt) => serial(chat, () => purging(chat, async () => {
      const s = await syncLocked(chat);
      if (s.snap.phase !== 'ready' || !s.rec || !s.parts || !s.tk) throw new ChatSendFailed('not-ready');
      return makeChatGrant({ chat: await chatChannel(chat), by: s.rec.role, tk: s.tk, disputeAt, me: toIdentity(s.rec.identity), participants: s.parts });
    })),
    sendPay: (chat, pay) => post(chat, (a) => sealPayDetails({ ...a, pay }), { secured: true }),
    // Decision 16 item 1: proof.attached is a v2 envelope under the chat key (`a.tk`), read by both
    // traders and the moderator as any line; every @x2f/proof payload check still runs.
    sendProof: (chat, proof) =>
      post(chat, async (a) => {
        try {
          return await sealProofAttached({ ...a, proof });
        } catch (e) {
          // A malformed payload, or a payment proof from the seller: nothing sealed, no seq spent.
          if (e instanceof ProofError || e instanceof TypeError) throw new ChatSendFailed('bad-proof', e);
          throw e;
        }
      }, { secured: true, proof: true }),
    // Decision 16: the one v1 envelope a keyed chat takes, sealed to the moderator alone through
    // @x2f/proof's sealProofEnvelope (PROOF_RECIPIENTS); never under the chat key, which every member holds.
    sendUnblurred: (chat, proof) =>
      post(chat, async ({ role, me, participants, state }) => {
        try {
          return await sealProofUnblurred({ role, me, participants, state, proof });
        } catch (e) {
          if (e instanceof ProofError || e instanceof TypeError) throw new ChatSendFailed('bad-proof', e);
          throw e;
        }
      }, { secured: true, proof: true, dispute: true }),
    sendNotice: (chat, notice) => post(chat, (a) => sealChatNotice({ ...a, notice }), { secured: true }),
  };
}

/** What a sync keeps in memory for a line it opened: the text, and the boxes of a package. */
interface Shown {
  text: string;
  pay?: PayDetailsPayload;
  /** A `proof.attached`'s key and facts: kept in memory only, never in the store (like the text). */
  proof?: ProofAttachedPayload;
  notice?: ChatNoticeId;
}
const shownOf = (m: { text: string; pay?: PayDetailsPayload; proof?: ProofAttachedPayload; notice?: ChatNoticeId }): Shown =>
  m.proof !== undefined
    ? { text: m.text, proof: m.proof }
    : m.notice !== undefined
      ? { text: m.text, notice: m.notice }
      : m.pay === undefined
        ? { text: m.text }
        : { text: m.text, pay: m.pay };
