// J-23 (S-075) phase 1 groundwork: the chat store's account record (the device key and the account
// chat key) in IndexedDB, under the same non-extractable wrap as the chat records, and the upgrade
// of a version-1 database that holds chat records only.
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { CHAT_DB, checkAccountRecord, openChatStore, type ChatAccountRecord, type ChatRecord } from '../src/chat/store.js';

const CODE = 'AAAA-BBBB-CCCC-DDDD';
const SECRET = 'f0'.repeat(32);
const ACK = '9c'.repeat(32);

const account: ChatAccountRecord = { v: 1, deviceKey: { boxPublic: 'ab'.repeat(32), boxSecret: SECRET }, ack: { key: ACK, epoch: 3 } };

function chatRecord(): ChatRecord {
  return {
    v: 2, chat: CODE, role: 'buyer', identity: { signPublic: '11'.repeat(32), boxPublic: '22'.repeat(32), signSecret: '33'.repeat(64), boxSecret: '44'.repeat(32) },
    registered: true, attestation: null, state: null, cursor: '0', receipts: [],
  };
}

/** Every raw value in one object store, as the bytes really stored. */
async function raw(idb: IDBFactory, store: string): Promise<unknown[]> {
  const db = await new Promise<IDBDatabase>((res, rej) => {
    const r = idb.open(CHAT_DB);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const values = await new Promise<unknown[]>((res) => {
    const r = db.transaction(store).objectStore(store).getAll();
    r.onsuccess = () => res(r.result as unknown[]);
  });
  db.close();
  return values;
}
const bytesOf = (v: unknown): string => {
  const w = v as { iv: Uint8Array; ct: ArrayBuffer };
  return Buffer.from(w.ct).toString('hex') + Buffer.from(w.iv).toString('hex');
};

describe('the account record', () => {
  it('round-trips, is null before it is saved and after it is deleted, and leaves the chat records alone', async () => {
    const idb = new IDBFactory();
    const store = await openChatStore({ indexedDB: idb });
    expect(await store.loadAccount()).toBeNull();
    await store.save(chatRecord());
    await store.saveAccount(account);
    expect(await store.loadAccount()).toEqual(account);
    expect(await store.load(CODE)).toEqual(chatRecord());
    expect(await store.list()).toEqual([CODE]);
    await store.saveAccount({ ...account, ack: null });
    expect(await store.loadAccount()).toEqual({ ...account, ack: null });
    await store.deleteAccount();
    expect(await store.loadAccount()).toBeNull();
    expect(await store.load(CODE)).toEqual(chatRecord());
  });

  it('is wrapped: the bytes on disk hold neither the device secret nor the chat key, and another opener of the same database reads it', async () => {
    const idb = new IDBFactory();
    const store = await openChatStore({ indexedDB: idb });
    await store.saveAccount(account);
    const [stored] = await raw(idb, 'account');
    const bytes = bytesOf(stored);
    expect(bytes).not.toContain(SECRET);
    expect(bytes).not.toContain(ACK);
    expect(bytes).not.toContain(Buffer.from(SECRET, 'hex').toString('hex'));
    expect(Buffer.from((stored as { ct: ArrayBuffer }).ct).toString('latin1')).not.toContain('deviceKey');
    const again = await openChatStore({ indexedDB: idb });
    expect(await again.loadAccount()).toEqual(account);
  });

  it('a record that does not decrypt, or is not an account record, is bad-record', async () => {
    const idb = new IDBFactory();
    const store = await openChatStore({ indexedDB: idb });
    await store.saveAccount(account);
    // A chat record's ciphertext moved into the account slot: the additional data differs, so it does not open.
    await store.save(chatRecord());
    const [chatBytes] = await raw(idb, 'chats');
    const db = await new Promise<IDBDatabase>((res) => {
      const r = idb.open(CHAT_DB);
      r.onsuccess = () => res(r.result);
    });
    await new Promise<void>((res) => {
      const tx = db.transaction('account', 'readwrite');
      tx.objectStore('account').put(chatBytes, 'account');
      tx.oncomplete = () => res();
    });
    db.close();
    await expect(store.loadAccount()).rejects.toMatchObject({ code: 'bad-record' });
  });

  it('checkAccountRecord accepts the shape and nothing else', () => {
    expect(checkAccountRecord(account)).toEqual(account);
    expect(checkAccountRecord({ ...account, ack: null })).toEqual({ ...account, ack: null });
    for (const bad of [
      null, 'x', {}, { ...account, v: 2 }, { ...account, deviceKey: null }, { ...account, deviceKey: { boxPublic: 'a' } },
      { ...account, ack: { key: 'a' } }, { ...account, ack: { key: 'a', epoch: -1 } }, { ...account, ack: { key: 'a', epoch: 1.5 } }, { ...account, ack: 'k' },
    ]) {
      expect(checkAccountRecord(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('the database upgrade', () => {
  it('a version-1 database (chats and keys only) gains the account store; its chat records still open under the same wrap', async () => {
    const idb = new IDBFactory();
    // Version 1 as Task 20 made it.
    const v1 = await new Promise<IDBDatabase>((res, rej) => {
      const r = idb.open(CHAT_DB, 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('chats');
        r.result.createObjectStore('keys');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    expect([...v1.objectStoreNames]).toEqual(['chats', 'keys']);
    v1.close();
    // The current code opens the version-1 database (the upgrade runs here), saves a chat, and a second opener reads it.
    const first = await openChatStore({ indexedDB: idb });
    await first.save(chatRecord());
    const second = await openChatStore({ indexedDB: idb });
    expect(await second.load(CODE)).toEqual(chatRecord());
    expect(await second.loadAccount()).toBeNull();
    await second.saveAccount(account);
    expect(await second.loadAccount()).toEqual(account);
    const db = await new Promise<IDBDatabase>((res) => {
      const r = idb.open(CHAT_DB);
      r.onsuccess = () => res(r.result);
    });
    expect(db.version).toBe(2);
    expect([...db.objectStoreNames].sort()).toEqual(['account', 'chats', 'keys']);
    db.close();
  });
});

// Lead 10 Nov (J-23 point 5): a tab never stalls another tab's upgrade of the chat database. Every
// connection the store opens closes itself on `versionchange`, and the store reopens on next use.
describe('version changes from another tab', () => {
  /** Opens `x2f-chat` at `version` and resolves 'opened', or 'blocked' when an open connection holds it back. */
  const openRaw = (idb: IDBFactory, version: number) =>
    new Promise<{ outcome: 'opened' | 'blocked'; db: IDBDatabase | null }>((res, rej) => {
      const r = idb.open(CHAT_DB, version);
      r.onblocked = () => res({ outcome: 'blocked', db: null });
      r.onsuccess = () => res({ outcome: 'opened', db: r.result });
      r.onerror = () => rej(r.error);
    });

  it('an open version-1 connection closes when version 2 opens: the upgrade is not blocked, and the old store fails cleanly', async () => {
    const idb = new IDBFactory();
    const old = await openChatStore({ indexedDB: idb, version: 1 });
    await old.save(chatRecord());
    // The current code opens version 2 while the version-1 store is still open.
    const current = await openChatStore({ indexedDB: idb });
    expect(await current.load(CODE)).toEqual(chatRecord());
    const db = (await openRaw(idb, 2)).db!;
    expect(db.version).toBe(2);
    db.close();
    // The version-1 store cannot reopen a newer database: an error, never a hang.
    await expect(old.list()).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('a later version opened elsewhere is not blocked by the current store', async () => {
    const idb = new IDBFactory();
    const store = await openChatStore({ indexedDB: idb });
    await store.save(chatRecord());
    const next = await openRaw(idb, 3);
    expect(next.outcome).toBe('opened');
    next.db!.close();
  });

  it('after a versionchange (the database deleted elsewhere) the store reopens on next use and its writes are readable by a fresh opener', async () => {
    const idb = new IDBFactory();
    const store = await openChatStore({ indexedDB: idb });
    await store.save(chatRecord());
    await store.saveAccount(account);
    const deleted = await new Promise<'deleted' | 'blocked'>((res, rej) => {
      const r = idb.deleteDatabase(CHAT_DB);
      r.onblocked = () => res('blocked');
      r.onsuccess = () => res('deleted');
      r.onerror = () => rej(r.error);
    });
    expect(deleted).toBe('deleted');
    // Reopened: a new, empty database, with a new wrap key kept in it.
    expect(await store.list()).toEqual([]);
    expect(await store.loadAccount()).toBeNull();
    await store.save(chatRecord());
    await store.saveAccount(account);
    const fresh = await openChatStore({ indexedDB: idb });
    expect(await fresh.load(CODE)).toEqual(chatRecord());
    expect(await fresh.loadAccount()).toEqual(account);
  });
});
