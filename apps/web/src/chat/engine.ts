/**
 * The chat engine (Task 20): runs in the escrow worker next to the escrow runtime, so the chat
 * identity's secret keys never reach the page. The page sends `sync` and `send` and gets back a
 * ChatSnapshot of plain, already-verified lines.
 *
 * - Device binding: the first sync on a device makes the chat identity, saves it, then registers
 *   it. If the API already holds another key for this role, the chat is open on another device:
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
 * - Erase on purge: when the API answers 410 `chat-purged` for a chat, its record and the lines in
 *   memory are erased; `sweep` checks every stored chat once per worker start. A 404 keeps the
 *   record (a block hides a chat with that same 404, and it may come back).
 */
import type { Role } from '@x2f/core';
import type { ProofAttachedPayload } from '@x2f/proof';
import { isPlainObject, ProtocolError, ReplayGuard, type Envelope, type Identity, type Participants } from '@x2f/protocol';
import { AttestationError, PayDetailsError, checkChatEnvelope, verifyAttestation, type Attestation, type PayDetailsPayload } from '@x2f/trade';
import { ChatError, chatChannel, newChatState, openChatMessage, sealChatMessage, sealPayDetails, signChatIdentity, type ChatState } from './chatCrypto.js';
import type { ChatRecord, ChatStore, StoredChatReceipt } from './store.js';

export interface ChatApiView {
  role: 'buyer' | 'seller';
  counterparty: string | null;
  disputeOpen: boolean;
  /** When the linked trade's escrow was secured, or null (owner Q12: packages are shown only from then). */
  tradeSecuredAt: string | null;
  /** The signing key the API holds for the caller's role in this chat, or null. */
  mySignPublic: string | null;
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
}

export interface ChatSnapshot {
  phase: ChatPhase;
  /** For `failed`: the attestation did not check out (`security`) or moderation refused it. */
  problem: 'security' | 'refused' | null;
  role: 'buyer' | 'seller';
  counterparty: string | null;
  disputeOpen: boolean;
  /** The trade's escrow is secured (owner Q12): the payee may send a package, and packages are shown. */
  paySecured: boolean;
  lines: ChatLine[];
  /**
   * The sync stopped at its page cap with envelopes still unread (review M8): the next sync goes on
   * from the saved cursor, and the panel says "Loading more messages…".
   */
  more: boolean;
}

export type ChatSendError = 'not-ready' | 'bad-text' | 'bad-details' | 'too-large' | 'slow-down' | 'refused';

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
  /**
   * Asks the API about every chat stored on this device and erases each one it answers 410
   * `chat-purged` for; resolves with those. Any other answer (or none) keeps the record. Rejects on
   * a 401 (no live session: nothing can be told apart), so the caller tries again later.
   */
  sweep(): Promise<string[]>;
}

/** The API purged the chat (410 `chat-purged`): the device's copy must go. */
export const isPurged = (e: unknown): boolean => (e as { status?: unknown } | null)?.status === 410;

export interface ChatEngineDeps {
  api: ChatApi;
  store: ChatStore;
  newIdentity: () => Promise<Identity>;
  modSigningPublic: string;
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
function headerOf(envelope: unknown, channel: string): { from: Role; seq: number } | null {
  try {
    const env = checkChatEnvelope(envelope, channel);
    return { from: env.from, seq: env.seq };
  } catch {
    return null;
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
  const erase = async (chat: string): Promise<void> => {
    sessions.delete(chat);
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
    const withheld = (m: StoredChatReceipt): boolean => m.refused === true || ((m.heldPay === true || m.heldEvidence === true) && session?.texts.has(m.id) !== true);
    return {
      phase,
      more,
      problem,
      role: view.role,
      counterparty: view.counterparty,
      disputeOpen: view.disputeOpen,
      paySecured: view.tradeSecuredAt !== null,
      // By the server's order: a moderator line held until a dispute opened is shown where it was posted.
      lines: [...(rec?.receipts ?? [])]
        .filter((m) => !withheld(m) && (session?.texts.has(m.id) === true || judged(m.id)))
        .sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))
        .map((m): ChatLine => {
          const line = { id: m.id, from: m.from, at: m.at, mine: m.from === view.role, gapBefore: m.gapBefore };
          const shown = session?.texts.get(m.id);
          if (shown === undefined) return { ...line, text: '', missing: true };
          if (shown.proof !== undefined) return { ...line, text: shown.text, proof: shown.proof };
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
    await verifyAttestation(a.attestation as Attestation, a.sig, d.modSigningPublic, {
      trade: rec.chat,
      role: rec.role,
      signPublic: rec.identity.signPublic,
      boxPublic: rec.identity.boxPublic,
      context: 'chat',
    });
    return (a.attestation as Attestation).participants;
  }

  /**
   * Re-opens a line the guard already took (its receipt), for a re-read: with a fresh guard, and
   * only for the same envelope (its signature) from the same sender and seq. Null when it is not.
   */
  async function reopen(rec: ChatRecord, me: Identity, parts: Participants, e: ApiEnvelope, r: StoredChatReceipt, channel: string, secured: boolean, disputeOpen: boolean): Promise<Shown | null> {
    try {
      if (e.senderRole !== r.from || (r.sig !== null && sigOf(e.envelope) !== r.sig)) return null;
      const fresh = { channel, nextSeq: 0, guard: new ReplayGuard(channel).toJSON() };
      // A moderator line it showed once (during a dispute) is shown again: the guard took it then. A
      // package only once the trade is secured (owner Q12): before that the only package receipts are held ones.
      // Evidence only while a dispute is open (P5-A30), so a reload during the dispute shows it again (review M1).
      const o = await openChatMessage(e.envelope, { role: rec.role, me, participants: parts, state: fresh, modMayPost: true, payAllowed: secured, evidenceAllowed: disputeOpen });
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
  async function readAll(rec: ChatRecord, view: ChatApiView, parts: Participants): Promise<{ rec: ChatRecord; more: boolean }> {
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
          if (receipt.refused !== true && !shown.has(e.id)) {
            const again = await reopen(rec, me, parts, e, receipt, channel, secured, view.disputeOpen);
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
          const args = { role: rec.role, me, participants: parts, state, modMayPost: view.disputeOpen, evidenceAllowed: view.disputeOpen };
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
          else if (err instanceof ChatError && err.code === 'bad-message') {
            // Decided for good (pay-details review M1): a receipt marks it refused so a re-read never
            // opens it again, and the cursor passes it. The guard did not move: the sender may reuse the seq.
            const h = headerOf(e.envelope, channel);
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

  async function syncLocked(chat: string): Promise<{ snap: ChatSnapshot; rec: ChatRecord | null; parts: Participants | null; view: ChatApiView }> {
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
    const read = await readAll(rec, view, parts);
    rec = read.rec;
    return { snap: snapshot(rec, view, 'ready', null, read.more), rec, parts, view };
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
   * page's closed button is not the only gate (pay-details review M2), and no seq is spent.
   */
  function post(chat: string, make: (a: Omit<Parameters<typeof sealChatMessage>[0], 'text'>) => Promise<{ envelope: Envelope; state: ChatState }>, secured = false): Promise<ChatSnapshot> {
    return serial(chat, () => purging(chat, async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const s = await syncLocked(chat);
        if (s.snap.phase !== 'ready' || !s.rec || !s.parts) throw new ChatSendFailed('not-ready');
        if (secured && s.view.tradeSecuredAt === null) throw new ChatSendFailed('not-ready');
        let sealed;
        try {
          sealed = await make({ role: s.rec.role, me: toIdentity(s.rec.identity), participants: s.parts, state: s.rec.state ?? newChatState(await chatChannel(chat)) });
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
          throw new ChatSendFailed('refused', e);
        }
        return (await syncLocked(chat)).snap;
      }
      throw new ChatSendFailed('refused');
    }));
  }

  return {
    sync: (chat) => serial(chat, () => purging(chat, async () => (await syncLocked(chat)).snap)),
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
    sendPay: (chat, pay) => post(chat, (a) => sealPayDetails({ ...a, pay }), true),
  };
}

/** What a sync keeps in memory for a line it opened: the text, and the boxes of a package. */
interface Shown {
  text: string;
  pay?: PayDetailsPayload;
  /** A `proof.attached`'s key and facts: kept in memory only, never in the store (like the text). */
  proof?: ProofAttachedPayload;
}
const shownOf = (m: { text: string; pay?: PayDetailsPayload; proof?: ProofAttachedPayload }): Shown =>
  m.proof !== undefined ? { text: m.text, proof: m.proof } : m.pay === undefined ? { text: m.text } : { text: m.text, pay: m.pay };
