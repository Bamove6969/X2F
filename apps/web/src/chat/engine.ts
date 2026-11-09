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
 * - No message text is stored on the device (owner p11-10, design 2026-11-08 section 5): the store
 *   keeps keys, the ChatState, the cursor and a receipt per accepted line. The first sync of a chat
 *   in this worker re-reads the whole chat from the server and decrypts it again; a line the guard
 *   already took is shown only for the same signed envelope (its receipt's signature). The text is
 *   kept in this worker's memory only, for the later syncs of the same session.
 * - Erase on purge: when the API answers 410 `chat-purged` for a chat, its record and the lines in
 *   memory are erased; `sweep` checks every stored chat once per worker start. A 404 keeps the
 *   record (a block hides a chat with that same 404, and it may come back).
 */
import type { Role } from '@x2f/core';
import { isPlainObject, ProtocolError, ReplayGuard, type Identity, type Participants } from '@x2f/protocol';
import { AttestationError, verifyAttestation, type Attestation } from '@x2f/trade';
import { ChatError, chatChannel, newChatState, openChatMessage, sealChatMessage, signChatIdentity, type ChatState } from './chatCrypto.js';
import type { ChatRecord, ChatStore, StoredChatReceipt } from './store.js';

export interface ChatApiView {
  role: 'buyer' | 'seller';
  counterparty: string | null;
  disputeOpen: boolean;
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
}

export interface ChatSnapshot {
  phase: ChatPhase;
  /** For `failed`: the attestation did not check out (`security`) or moderation refused it. */
  problem: 'security' | 'refused' | null;
  role: 'buyer' | 'seller';
  counterparty: string | null;
  disputeOpen: boolean;
  lines: ChatLine[];
  /**
   * The sync stopped at its page cap with envelopes still unread (review M8): the next sync goes on
   * from the saved cursor, and the panel says "Loading more messages…".
   */
  more: boolean;
}

export type ChatSendError = 'not-ready' | 'bad-text' | 'too-large' | 'slow-down' | 'refused';

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
  /**
   * Asks the API about every chat stored on this device and erases each one it answers 410
   * `chat-purged` for; resolves with those. Any other answer (or none) keeps the record.
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

export function createChatEngine(d: ChatEngineDeps): ChatEngine {
  /** One operation at a time per chat (posts are sent one by one, chatCrypto's contract). */
  const queues = new Map<string, Promise<unknown>>();
  const serial = <T>(chat: string, fn: () => Promise<T>): Promise<T> => {
    const prev = queues.get(chat) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    queues.set(chat, next.catch(() => undefined));
    return next;
  };

  /** The text of each line this worker has opened, by chat and envelope id: memory only, never stored. */
  const texts = new Map<string, Map<string, string>>();
  const erase = async (chat: string): Promise<void> => {
    texts.delete(chat);
    await d.store.delete(chat);
  };

  const snapshot = (rec: ChatRecord | null, view: ChatApiView, phase: ChatPhase, problem: ChatSnapshot['problem'] = null, more = false): ChatSnapshot => {
    const shown = rec ? texts.get(rec.chat) : undefined;
    return {
      phase,
      more,
      problem,
      role: view.role,
      counterparty: view.counterparty,
      disputeOpen: view.disputeOpen,
      // By the server's order: a moderator line held until a dispute opened is shown where it was posted.
      lines: [...(rec?.receipts ?? [])]
        .filter((m) => shown?.has(m.id) === true)
        .sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))
        .map((m) => ({ id: m.id, from: m.from, text: shown!.get(m.id)!, at: m.at, mine: m.from === view.role, gapBefore: m.gapBefore })),
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
  async function reopen(rec: ChatRecord, me: Identity, parts: Participants, e: ApiEnvelope, r: StoredChatReceipt, channel: string): Promise<string | null> {
    try {
      if (e.senderRole !== r.from || (r.sig !== null && sigOf(e.envelope) !== r.sig)) return null;
      const fresh = { channel, nextSeq: 0, guard: new ReplayGuard(channel).toJSON() };
      // A moderator line it showed once (during a dispute) is shown again: the guard took it then.
      const o = await openChatMessage(e.envelope, { role: rec.role, me, participants: parts, state: fresh, modMayPost: true });
      return o.message.from === r.from && o.message.seq === r.seq ? o.message.text : null;
    } catch {
      return null;
    }
  }

  /**
   * Reads and opens the envelopes: from the start of the chat on its first sync in this worker (the
   * device keeps no text), else past the cursor. A line with a receipt is re-opened (`reopen`); any
   * other goes through the saved guard, and the record is saved after each one it takes. At most
   * MAX_PAGES pages past the cursor; `more` when it stopped there with envelopes still unread.
   */
  async function readAll(rec: ChatRecord, view: ChatApiView, parts: Participants): Promise<{ rec: ChatRecord; more: boolean }> {
    const me = toIdentity(rec.identity);
    const channel = await chatChannel(rec.chat);
    let state: ChatState = rec.state ?? newChatState(channel);
    const shown = texts.get(rec.chat) ?? new Map<string, string>();
    const cold = !texts.has(rec.chat);
    texts.set(rec.chat, shown);
    const start = BigInt(rec.cursor);
    let cursor = rec.cursor;
    let held = false;
    let after = cold ? '0' : rec.cursor;
    const receipts = [...rec.receipts];
    const known = new Map(receipts.map((r) => [r.id, r]));
    let unread = false;
    const lastSeq = new Map<Role, number>();
    for (const m of receipts) lastSeq.set(m.from, Math.max(lastSeq.get(m.from) ?? -1, m.seq));
    for (let page = 0, total = 0; page < MAX_PAGES && total < MAX_TOTAL_PAGES; total++) {
      const { envelopes, more } = await d.api.listEnvelopes(rec.chat, after);
      if (envelopes.some((e) => BigInt(e.id) > start)) page++;
      for (const e of envelopes) {
        after = e.id;
        const past = BigInt(e.id) > start;
        const receipt = known.get(e.id);
        if (receipt) {
          if (!shown.has(e.id)) {
            const text = await reopen(rec, me, parts, e, receipt, channel);
            if (text !== null) shown.set(e.id, text);
          }
          if (past && !held && cursor !== e.id) {
            cursor = e.id;
            rec = { ...rec, cursor };
            await d.store.save(rec);
          }
          continue;
        }
        let advance = true;
        try {
          if (!ROLES_SET.has(e.senderRole)) throw new ChatError('bad-message', 'unknown sender');
          const r = await openChatMessage(e.envelope, { role: rec.role, me, participants: parts, state, modMayPost: view.disputeOpen });
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
          };
          lastSeq.set(m.from, m.seq);
          receipts.push(m);
          known.set(m.id, m);
          shown.set(m.id, r.message.text);
        } catch (err) {
          // A moderator line outside a dispute, or a message that did not parse, is tried again on
          // a later sync: the cursor stops before it (the guard did not move for it).
          if (err instanceof ChatError && (err.code === 'mod-not-allowed' || err.code === 'bad-message')) advance = false;
          // Anything else (a replay of a line already shown, a forged or foreign envelope) is skipped.
        }
        if (!past) continue;
        if (!advance) held = true;
        if (!held) cursor = e.id;
        rec = { ...rec, state, cursor, receipts: [...receipts] };
        await d.store.save(rec);
      }
      unread = more;
      if (!more) break;
    }
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

  return {
    sync: (chat) => serial(chat, () => purging(chat, async () => (await syncLocked(chat)).snap)),
    sweep: async () => {
      const gone: string[] = [];
      for (const chat of await d.store.list()) {
        try {
          await serial(chat, () => purging(chat, () => d.api.getChat(chat)));
        } catch (e) {
          if (isPurged(e)) gone.push(chat);
        }
      }
      return gone;
    },
    send: (chat, text) =>
      serial(chat, () => purging(chat, async () => {
        for (let attempt = 0; attempt < 2; attempt++) {
          const s = await syncLocked(chat);
          if (s.snap.phase !== 'ready' || !s.rec || !s.parts) throw new ChatSendFailed('not-ready');
          let sealed;
          try {
            sealed = await sealChatMessage({ role: s.rec.role, me: toIdentity(s.rec.identity), participants: s.parts, state: s.rec.state ?? newChatState(await chatChannel(chat)), text });
          } catch (e) {
            if (e instanceof ChatError && (e.code === 'bad-text' || e.code === 'too-large')) throw new ChatSendFailed(e.code);
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
      })),
  };
}
