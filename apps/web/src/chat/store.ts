/**
 * chatStore: the device's chat records, in IndexedDB `x2f-chat` (Task 20's device binding). One
 * record per chat: this device's chat identity (secret keys included), the verified attestation,
 * the ChatState (seq counter and ReplayGuard), the read cursor and a receipt per line it accepted:
 * the envelope id, sender, seq, signature and gap mark, NEVER the text (owner p11-10, "all data is
 * being fed live from our servers"). Each open re-reads the envelopes from the server and decrypts
 * them again in the worker; the receipts let a re-read show a line the guard already took, and
 * only that same signed envelope (design 2026-11-08 section 5).
 *
 * A record is erased when the API answers 410 `chat-purged` for its chat (the engine), and the
 * whole store is swept for purged chats once per worker start (`ChatEngine.sweep`).
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
/** J-23: the one account record (the device key and the account chat key), under the same wrap. */
const ACCOUNT = 'account';
const ACCOUNT_ID = 'account';
/** Version 2 added the `account` store (J-23); the chat records are untouched by the upgrade. */
const DB_VERSION = 2;

/**
 * One line this device accepted (its guard moved for it), or one envelope it refused for good
 * (`refused`). No text: that is read again from the server.
 */
export interface StoredChatReceipt {
  /** The API's envelope id. */
  id: string;
  /**
   * The verified sender: the envelope's signature AND the server's record agree. For a `refused`
   * receipt, the sender and seq the envelope's header claims (as served, not verified).
   */
  from: Role;
  seq: number;
  /**
   * The envelope's signature (hex): a re-read shows the line only for this same envelope, so a
   * server cannot swap in another one the sender signed with the same seq. Null for a line kept by
   * a v1 record (before receipts); then the sender and seq must match.
   */
  sig: string | null;
  /** The server's time for the envelope, when it gave one. */
  at: string | null;
  /** This sender's seq skipped one or more messages before this one (review M5). */
  gapBefore: boolean;
  /**
   * A payee's package (J-08) taken before the trade's escrow was secured (owner Q12): the guard
   * moved for it, so the sender's later lines flow, but it is not shown until the trade is secured,
   * when it is decrypted again and shown in its place. Never set on a plain line.
   */
  heldPay?: true;
  /**
   * Plan 5 Task 15: an authentic envelope from a trader that is sealed past this reader (signature
   * checked, then 'not-for-me' at the unwrap): only the unblurred copy for the moderator is ever sent
   * so. Its seq is taken, so the sender's next line shows no gap, but it is never a line, not even
   * a placeholder, and it is never opened again.
   */
  away?: true;
  /**
   * Dispute evidence taken while the API's view had no open dispute (proof-receive review M2): held
   * like `heldPay`, shown (decrypted again) once a dispute is open. Never set on another line.
   */
  heldEvidence?: true;
  /**
   * An envelope that can never become a line (pay-details review M1): a payload that is not a chat
   * message, a package whose text is not the rendering of its boxes, a malformed or mod-signed
   * package. The cursor passed it and a re-read never opens it again; the guard did not move for it
   * (the sender may reuse the seq). Never a line, not even a placeholder. Never set with `heldPay`.
   */
  refused?: true;
}

export interface ChatRecord {
  v: 2;
  chat: string;
  role: 'buyer' | 'seller';
  identity: { signPublic: string; boxPublic: string; signSecret: string; boxSecret: string };
  /**
   * Device clock (ms) when this device made `identity`, saved with it before it is registered
   * (review lead-escrow-harden M1): the chat attestation naming it may not be older. Absent in
   * records written before the field (no lower bound, accepted only with today's unbounded key).
   */
  identityCreatedAt?: number;
  registered: boolean;
  attestation: { attestation: unknown; sig: string } | null;
  state: ChatState | null;
  /** The last envelope id read past (`GET …/envelopes?after=`). */
  cursor: string;
  receipts: StoredChatReceipt[];
  /**
   * Review F3 (tasks 3-6): the fingerprint (tkh, public) of the chat key this device first accepted
   * or posted. Once set, a key record of any other tkh, or none, is the `security` failure.
   */
  tkh?: string;
}

/**
 * A record as read: v2 as it is, a v1 record (which kept every line's text) as v2 with its lines'
 * receipts and no text. Null for anything else.
 */
export function upgradeChatRecord(raw: unknown, chat: string): ChatRecord | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.chat !== chat) return null;
  if (r.v === 2 && Array.isArray(r.receipts)) return r as unknown as ChatRecord;
  if (r.v !== 1 || !Array.isArray(r.messages)) return null;
  const { messages, ...rest } = r as Record<string, unknown> & { messages: Array<{ id: string; from: Role; seq: number; at: string | null; gapBefore: boolean }> };
  return { ...rest, v: 2, receipts: messages.map((m) => ({ id: m.id, from: m.from, seq: m.seq, sig: null, at: m.at, gapBefore: m.gapBefore })) } as unknown as ChatRecord;
}

/**
 * J-23 (S-075; docs/security/multi-device-2026-11-09.md section 4.2): this device's part of the
 * account chat key (ACK) handover, one record per device, under the same non-extractable wrap as
 * the chat records. `deviceKey` is the X25519 pair other devices seal the ACK to (`sealTo`); `ack`
 * is the key this device holds, with its epoch, or null until one is handed over or made here.
 * Secrets are hex strings as the chat identity's are; they never leave the worker (chat/ack.ts).
 */
export interface ChatAccountRecord {
  v: 1;
  deviceKey: { boxPublic: string; boxSecret: string };
  ack: { key: string; epoch: number } | null;
}

/** A stored account record as read, or null for anything else. */
export function checkAccountRecord(raw: unknown): ChatAccountRecord | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1 || typeof r.deviceKey !== 'object' || r.deviceKey === null) return null;
  const k = r.deviceKey as Record<string, unknown>;
  if (typeof k.boxPublic !== 'string' || typeof k.boxSecret !== 'string') return null;
  if (r.ack !== null) {
    if (typeof r.ack !== 'object' || r.ack === null) return null;
    const a = r.ack as Record<string, unknown>;
    if (typeof a.key !== 'string' || typeof a.epoch !== 'number' || !Number.isInteger(a.epoch) || a.epoch < 0) return null;
  }
  return r as unknown as ChatAccountRecord;
}

export interface ChatStore {
  /** The chat's record; a v1 record is upgraded (its text dropped) and saved back before it is returned. */
  load(chat: string): Promise<ChatRecord | null>;
  save(rec: ChatRecord): Promise<void>;
  /**
   * Review m1: saves `rec` only when the chat has no record yet, checked and written in one IndexedDB
   * transaction; true when it was saved. Two tabs (two workers over one database) can each make a
   * chat identity, and this keeps the second from replacing the first's.
   */
  create(rec: ChatRecord): Promise<boolean>;
  delete(chat: string): Promise<void>;
  /** Every chat code with a record on this device. */
  list(): Promise<string[]>;
  /** J-23: this device's account record (device key and account chat key), or null before one is made. */
  loadAccount(): Promise<ChatAccountRecord | null>;
  saveAccount(rec: ChatAccountRecord): Promise<void>;
  deleteAccount(): Promise<void>;
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

/**
 * Opens the database. Every connection closes itself when another tab asks for a version change (a
 * newer build's upgrade, or a delete), so this tab never stalls it (lead 10 Nov, J-23); the store
 * opens a new connection on its next use (`openChatStore`).
 */
function openDb(idb: IDBFactory, version: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = idb.open(CHAT_DB, version);
    r.onupgradeneeded = () => {
      for (const name of [CHATS, KEYS, ACCOUNT]) if (!r.result.objectStoreNames.contains(name)) r.result.createObjectStore(name);
    };
    r.onsuccess = () => {
      const db = r.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
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
/** The account record's additional data: its own label, so a chat record can never be read back as it. */
const ACCOUNT_AAD: Uint8Array<ArrayBuffer> = new TextEncoder().encode('x2f-chat/account/v1');

/**
 * `version` is for tests only (an older build's connection); the app always opens `DB_VERSION`.
 * The connection and its wrap key are opened on first use and again after a version change closed
 * them; an open that fails (a newer database than this build knows) is `unavailable`, never a hang.
 */
export async function openChatStore(o: { indexedDB?: IDBFactory; crypto?: Crypto; version?: number } = {}): Promise<ChatStore> {
  const idb = o.indexedDB ?? globalThis.indexedDB;
  const cr = o.crypto ?? globalThis.crypto;
  if (!idb || !cr?.subtle) throw new ChatStoreError('unavailable');
  const version = o.version ?? DB_VERSION;
  type Conn = { db: IDBDatabase; key: CryptoKey; closed: boolean };
  let current: Promise<Conn> | null = null;
  const connect = async (): Promise<Conn> => {
    let db: IDBDatabase;
    try {
      db = await openDb(idb, version);
    } catch (e) {
      throw e instanceof ChatStoreError ? e : new ChatStoreError('unavailable');
    }
    const conn: Conn = { db, key: await wrapKey(db, cr.subtle), closed: false };
    const close = db.onversionchange;
    db.onversionchange = (ev) => {
      conn.closed = true;
      if (typeof close === 'function') close.call(db, ev);
    };
    return conn;
  };
  /** The live connection, reopened after a version change closed the last one. */
  const conn = async (): Promise<Conn> => {
    if (current !== null) {
      const c = await current.catch(() => null);
      if (c !== null && !c.closed) return c;
    }
    current = connect();
    current.catch(() => (current = null));
    return current;
  };
  await conn();
  const save = async (rec: ChatRecord): Promise<void> => {
    const { db, key } = await conn();
    const iv = cr.getRandomValues(new Uint8Array(12));
    const ct = await cr.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(rec.chat) }, key, new TextEncoder().encode(JSON.stringify(rec)));
    const tx = db.transaction(CHATS, 'readwrite');
    tx.objectStore(CHATS).put({ iv, ct }, rec.chat);
    await done(tx);
  };
  const create = async (rec: ChatRecord): Promise<boolean> => {
    const { db, key } = await conn();
    // Encrypted first: nothing may await inside the transaction, or it would end before the write.
    const iv = cr.getRandomValues(new Uint8Array(12));
    const ct = await cr.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(rec.chat) }, key, new TextEncoder().encode(JSON.stringify(rec)));
    const tx = db.transaction(CHATS, 'readwrite');
    const os = tx.objectStore(CHATS);
    let created = false;
    const count = os.count(rec.chat);
    count.onsuccess = () => {
      if (count.result !== 0) return;
      os.add({ iv, ct }, rec.chat);
      created = true;
    };
    await done(tx);
    return created;
  };
  return {
    create,
    async load(chat) {
      const { db, key } = await conn();
      const raw = (await req(db.transaction(CHATS).objectStore(CHATS).get(chat))) as { iv?: unknown; ct?: unknown } | undefined;
      if (raw === undefined) return null;
      if (!(raw.iv instanceof Uint8Array) || !(raw.ct instanceof ArrayBuffer)) throw new ChatStoreError('bad-record');
      let plain: ArrayBuffer;
      try {
        plain = await cr.subtle.decrypt({ name: 'AES-GCM', iv: raw.iv as Uint8Array<ArrayBuffer>, additionalData: aad(chat) }, key, raw.ct);
      } catch {
        throw new ChatStoreError('bad-record');
      }
      const json = JSON.parse(new TextDecoder().decode(plain)) as { v?: unknown } | null;
      const rec = upgradeChatRecord(json, chat);
      if (rec === null) throw new ChatStoreError('bad-record');
      if (json?.v !== 2) await save(rec);
      return rec;
    },
    async list() {
      const { db } = await conn();
      const keys = await req(db.transaction(CHATS).objectStore(CHATS).getAllKeys());
      return keys.filter((k): k is string => typeof k === 'string');
    },
    save,
    async delete(chat) {
      const { db } = await conn();
      const tx = db.transaction(CHATS, 'readwrite');
      tx.objectStore(CHATS).delete(chat);
      await done(tx);
    },
    async loadAccount() {
      const { db, key } = await conn();
      const raw = (await req(db.transaction(ACCOUNT).objectStore(ACCOUNT).get(ACCOUNT_ID))) as { iv?: unknown; ct?: unknown } | undefined;
      if (raw === undefined) return null;
      if (!(raw.iv instanceof Uint8Array) || !(raw.ct instanceof ArrayBuffer)) throw new ChatStoreError('bad-record');
      let plain: ArrayBuffer;
      try {
        plain = await cr.subtle.decrypt({ name: 'AES-GCM', iv: raw.iv as Uint8Array<ArrayBuffer>, additionalData: ACCOUNT_AAD }, key, raw.ct);
      } catch {
        throw new ChatStoreError('bad-record');
      }
      const rec = checkAccountRecord(JSON.parse(new TextDecoder().decode(plain)));
      if (rec === null) throw new ChatStoreError('bad-record');
      return rec;
    },
    async saveAccount(rec) {
      const { db, key } = await conn();
      const iv = cr.getRandomValues(new Uint8Array(12));
      const ct = await cr.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: ACCOUNT_AAD }, key, new TextEncoder().encode(JSON.stringify(rec)));
      const tx = db.transaction(ACCOUNT, 'readwrite');
      tx.objectStore(ACCOUNT).put({ iv, ct }, ACCOUNT_ID);
      await done(tx);
    },
    async deleteAccount() {
      const { db } = await conn();
      const tx = db.transaction(ACCOUNT, 'readwrite');
      tx.objectStore(ACCOUNT).delete(ACCOUNT_ID);
      await done(tx);
    },
  };
}

/** An in-memory store (tests). `account` is the stored account record's JSON, as `records` are the chats'. */
export function memoryChatStore(): ChatStore & { records: Map<string, string>; account: string | null } {
  const records = new Map<string, string>();
  const store = {
    records,
    account: null as string | null,
    async loadAccount() {
      if (store.account === null) return null;
      const rec = checkAccountRecord(JSON.parse(store.account));
      if (rec === null) throw new ChatStoreError('bad-record');
      return rec;
    },
    async saveAccount(rec: ChatAccountRecord) {
      store.account = JSON.stringify(rec);
    },
    async deleteAccount() {
      store.account = null;
    },
    async save(rec: ChatRecord) {
      records.set(rec.chat, JSON.stringify(rec));
    },
    async create(rec: ChatRecord) {
      if (records.has(rec.chat)) return false;
      records.set(rec.chat, JSON.stringify(rec));
      return true;
    },
    async delete(chat: string) {
      records.delete(chat);
    },
    async load(chat: string) {
      const v = records.get(chat);
      if (v === undefined) return null;
      const raw = JSON.parse(v) as { v?: unknown };
      const rec = upgradeChatRecord(raw, chat);
      if (rec === null) throw new ChatStoreError('bad-record');
      if (raw.v !== 2) records.set(chat, JSON.stringify(rec));
      return rec;
    },
    async list() {
      return [...records.keys()];
    },
  };
  return store;
}
