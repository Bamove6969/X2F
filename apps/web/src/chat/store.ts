/**
 * chatStore: the device's chat records, in IndexedDB `x2f-chat` (Task 20's device binding). One
 * record per chat: this device's chat identity (secret keys included), the verified attestation,
 * the ChatState (seq counter and ReplayGuard) and the messages it has opened, so a reload shows
 * them again without re-opening (the guard refuses a replay).
 *
 * Every record is wrapped with one non-extractable AES-256-GCM CryptoKey kept in the same database,
 * with the chat code bound in as additional data. The same scheme as the escrow store
 * (escrow/store.ts), kept apart so the escrow's records and keys never share a database with chat.
 * Only the escrow worker opens it; secrets never cross postMessage.
 */
import type { Role } from '@x2f/core';
import type { ChatState } from './chatCrypto.js';

export const CHAT_DB = 'x2f-chat';
const CHATS = 'chats';
const KEYS = 'keys';
const KEY_ID = 'wrap';

export interface StoredChatMessage {
  /** The API's envelope id. */
  id: string;
  /** The verified sender: the envelope's signature AND the server's record agree. */
  from: Role;
  seq: number;
  text: string;
  /** The server's time for the envelope, when it gave one. */
  at: string | null;
  /** This sender's seq skipped one or more messages before this one (review M5). */
  gapBefore: boolean;
}

export interface ChatRecord {
  v: 1;
  chat: string;
  role: 'buyer' | 'seller';
  identity: { signPublic: string; boxPublic: string; signSecret: string; boxSecret: string };
  registered: boolean;
  attestation: { attestation: unknown; sig: string } | null;
  state: ChatState | null;
  /** The last envelope id read past (`GET …/envelopes?after=`). */
  cursor: string;
  messages: StoredChatMessage[];
}

export interface ChatStore {
  load(chat: string): Promise<ChatRecord | null>;
  save(rec: ChatRecord): Promise<void>;
  delete(chat: string): Promise<void>;
}

export class ChatStoreError extends Error {
  constructor(readonly code: 'bad-record' | 'unavailable') {
    super(code);
    this.name = 'ChatStoreError';
  }
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new ChatStoreError('unavailable'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new ChatStoreError('unavailable'));
    tx.onabort = () => reject(tx.error ?? new ChatStoreError('unavailable'));
  });
}

function openDb(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = idb.open(CHAT_DB, 1);
    r.onupgradeneeded = () => {
      for (const name of [CHATS, KEYS]) if (!r.result.objectStoreNames.contains(name)) r.result.createObjectStore(name);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new ChatStoreError('unavailable'));
    r.onblocked = () => reject(new ChatStoreError('unavailable'));
  });
}

async function wrapKey(db: IDBDatabase, subtle: SubtleCrypto): Promise<CryptoKey> {
  const existing = await req(db.transaction(KEYS).objectStore(KEYS).get(KEY_ID));
  if (existing instanceof CryptoKey) return existing;
  const fresh = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const tx = db.transaction(KEYS, 'readwrite');
  const store = tx.objectStore(KEYS);
  let chosen: CryptoKey = fresh;
  const got = store.get(KEY_ID);
  got.onsuccess = () => {
    if (got.result instanceof CryptoKey) chosen = got.result;
    else store.put(fresh, KEY_ID);
  };
  await done(tx);
  return chosen;
}

const aad = (chat: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(`x2f-chat/v1\0${chat}`);

export async function openChatStore(o: { indexedDB?: IDBFactory; crypto?: Crypto } = {}): Promise<ChatStore> {
  const idb = o.indexedDB ?? globalThis.indexedDB;
  const cr = o.crypto ?? globalThis.crypto;
  if (!idb || !cr?.subtle) throw new ChatStoreError('unavailable');
  const db = await openDb(idb);
  const key = await wrapKey(db, cr.subtle);
  return {
    async load(chat) {
      const raw = (await req(db.transaction(CHATS).objectStore(CHATS).get(chat))) as { iv?: unknown; ct?: unknown } | undefined;
      if (raw === undefined) return null;
      if (!(raw.iv instanceof Uint8Array) || !(raw.ct instanceof ArrayBuffer)) throw new ChatStoreError('bad-record');
      let plain: ArrayBuffer;
      try {
        plain = await cr.subtle.decrypt({ name: 'AES-GCM', iv: raw.iv as Uint8Array<ArrayBuffer>, additionalData: aad(chat) }, key, raw.ct);
      } catch {
        throw new ChatStoreError('bad-record');
      }
      const rec = JSON.parse(new TextDecoder().decode(plain)) as ChatRecord;
      if (rec?.v !== 1 || rec.chat !== chat) throw new ChatStoreError('bad-record');
      return rec;
    },
    async save(rec) {
      const iv = cr.getRandomValues(new Uint8Array(12));
      const ct = await cr.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(rec.chat) }, key, new TextEncoder().encode(JSON.stringify(rec)));
      const tx = db.transaction(CHATS, 'readwrite');
      tx.objectStore(CHATS).put({ iv, ct }, rec.chat);
      await done(tx);
    },
    async delete(chat) {
      const tx = db.transaction(CHATS, 'readwrite');
      tx.objectStore(CHATS).delete(chat);
      await done(tx);
    },
  };
}

/** An in-memory store (tests). */
export function memoryChatStore(): ChatStore & { records: Map<string, string> } {
  const records = new Map<string, string>();
  return {
    records,
    async load(chat) {
      const v = records.get(chat);
      return v === undefined ? null : (JSON.parse(v) as ChatRecord);
    },
    async save(rec) {
      records.set(rec.chat, JSON.stringify(rec));
    },
    async delete(chat) {
      records.delete(chat);
    },
  };
}
