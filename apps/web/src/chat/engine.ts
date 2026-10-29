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
 */
import type { Role } from '@x2f/core';
import { ProtocolError, type Identity, type Participants } from '@x2f/protocol';
import { AttestationError, verifyAttestation, type Attestation } from '@x2f/trade';
import { ChatError, chatChannel, newChatState, openChatMessage, sealChatMessage, signChatIdentity, type ChatState } from './chatCrypto.js';
import type { ChatRecord, ChatStore, StoredChatMessage } from './store.js';

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
}

export type ChatSendError = 'not-ready' | 'bad-text' | 'too-large' | 'refused';

export class ChatSendFailed extends Error {
  constructor(readonly code: ChatSendError) {
    super(code);
    this.name = 'ChatSendFailed';
  }
}

export interface ChatEngine {
  sync(chat: string): Promise<ChatSnapshot>;
  send(chat: string, text: string): Promise<ChatSnapshot>;
}

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
/** Most envelope pages read in one sync. */
const MAX_PAGES = 20;

export function createChatEngine(d: ChatEngineDeps): ChatEngine {
  /** One operation at a time per chat (posts are sent one by one, chatCrypto's contract). */
  const queues = new Map<string, Promise<unknown>>();
  const serial = <T>(chat: string, fn: () => Promise<T>): Promise<T> => {
    const prev = queues.get(chat) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    queues.set(chat, next.catch(() => undefined));
    return next;
  };

  const snapshot = (rec: ChatRecord | null, view: ChatApiView, phase: ChatPhase, problem: ChatSnapshot['problem'] = null): ChatSnapshot => ({
    phase,
    problem,
    role: view.role,
    counterparty: view.counterparty,
    disputeOpen: view.disputeOpen,
    // By the server's order: a moderator line held until a dispute opened is shown where it was posted.
    lines: [...(rec?.messages ?? [])].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1)).map((m) => ({ id: m.id, from: m.from, text: m.text, at: m.at, mine: m.from === view.role, gapBefore: m.gapBefore })),
  });

  /** Makes, saves, then registers this device's chat identity; false when another device holds the role. */
  async function ensureIdentity(chat: string, view: ChatApiView): Promise<ChatRecord | null> {
    let rec = await d.store.load(chat);
    if (rec && rec.role !== view.role) return null;
    if (!rec) {
      if (view.mySignPublic !== null) return null;
      const me = await d.newIdentity();
      rec = {
        v: 1,
        chat,
        role: view.role,
        identity: { signPublic: me.signPublic, boxPublic: me.boxPublic, signSecret: hex(me.signSecret), boxSecret: hex(me.boxSecret) },
        registered: false,
        attestation: null,
        state: null,
        cursor: '0',
        messages: [],
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

  /** Reads and opens every envelope past the cursor, saving after each one it shows. */
  async function readAll(rec: ChatRecord, view: ChatApiView, parts: Participants): Promise<ChatRecord> {
    const me = toIdentity(rec.identity);
    let state: ChatState = rec.state ?? newChatState(await chatChannel(rec.chat));
    let cursor = rec.cursor;
    let held = false;
    let after = rec.cursor;
    const messages = [...rec.messages];
    const lastSeq = new Map<Role, number>();
    for (const m of messages) lastSeq.set(m.from, Math.max(lastSeq.get(m.from) ?? -1, m.seq));
    for (let page = 0; page < MAX_PAGES; page++) {
      const { envelopes, more } = await d.api.listEnvelopes(rec.chat, after);
      for (const e of envelopes) {
        after = e.id;
        let advance = true;
        try {
          if (!ROLES_SET.has(e.senderRole)) throw new ChatError('bad-message', 'unknown sender');
          const r = await openChatMessage(e.envelope, { role: rec.role, me, participants: parts, state, modMayPost: view.disputeOpen });
          // The signer and the server's record must agree (never trust one of them alone).
          if (r.message.from !== e.senderRole) throw new ProtocolError('bad-signature', 'sender mismatch');
          state = r.state;
          const prev = lastSeq.get(r.message.from);
          const m: StoredChatMessage = {
            id: e.id,
            from: r.message.from,
            seq: r.message.seq,
            text: r.message.text,
            at: typeof e.at === 'string' ? e.at : null,
            gapBefore: prev !== undefined && r.message.seq > prev + 1,
          };
          lastSeq.set(m.from, m.seq);
          messages.push(m);
        } catch (err) {
          // A moderator line outside a dispute, or a message that did not parse, is tried again on
          // a later sync: the cursor stops before it (the guard did not move for it).
          if (err instanceof ChatError && (err.code === 'mod-not-allowed' || err.code === 'bad-message')) advance = false;
          // Anything else (a replay of a line already shown, a forged or foreign envelope) is skipped.
        }
        if (!advance) held = true;
        if (!held) cursor = e.id;
        rec = { ...rec, state, cursor, messages: [...messages] };
        await d.store.save(rec);
      }
      if (!more) break;
    }
    return rec;
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
    rec = await readAll(rec, view, parts);
    return { snap: snapshot(rec, view, 'ready'), rec, parts, view };
  }

  return {
    sync: (chat) => serial(chat, async () => (await syncLocked(chat)).snap),
    send: (chat, text) =>
      serial(chat, async () => {
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
            throw new ChatSendFailed('refused');
          }
          return (await syncLocked(chat)).snap;
        }
        throw new ChatSendFailed('refused');
      }),
  };
}
