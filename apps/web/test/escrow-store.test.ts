import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { DB_NAME, KEYS, SECRETS, TRADES, openEscrowStore, type EscrowRecord } from '../src/escrow/store.js';
import { readOpenEscrowCodes } from '../src/screens/Wallets.js';

const CODE_A = 'AAAA-BBBB-CCCC-DDDD';
const CODE_B = 'EEEE-FFFF-GGGG-HHHH';
const MARK = 'party-state-marker-6d3f';

function record(code: string, secret: number): EscrowRecord {
  return {
    v: 1,
    code,
    role: 'seller',
    identity: { signPublic: 'ab'.repeat(32), boxPublic: 'cd'.repeat(32), signSecret: new Uint8Array(64).fill(secret), boxSecret: new Uint8Array(32).fill(secret + 1) },
    registered: true,
    attestation: null,
    partyState: { v: 1, session: { v: 1, keys: MARK, cache: 'c' }, guard: { trade: 'x', seen: {} }, seq: 3, step: 'msig.prepare:0', address: null, sent: {}, received: {}, release: null },
    signalGuard: { trade: 'y', seen: { mod: 2 } },
    signalSeq: 4,
    ownAddress: '4SellerRefund',
    theirAddress: null,
    deal: { poster: 'seller', takeAmountAtomic: 1_250_000_000_000n, currency: 'USD', centsPerXmr: 33_000n, maxFiatCents: 50_000n },
    theirDeal: null,
    sizeAtomic: 1_250_000_000_000n,
    paidSeen: false,
    termsAcked: false,
    intent: { kind: 'release', outcome: { to: [{ address: '4Buyer', amountAtomic: 1_250_000_000_000n }], builder: 'seller', cosigner: 'buyer' }, done: false, auto: false },
  };
}

/** Every raw value in one object store, as the bytes that are really on disk. */
async function raw(idb: IDBFactory, store: string): Promise<{ key: IDBValidKey; value: unknown }[]> {
  const db = await new Promise<IDBDatabase>((res, rej) => {
    const r = idb.open(DB_NAME);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const os = db.transaction(store).objectStore(store);
  const [keys, values] = await Promise.all(
    [os.getAllKeys(), os.getAll()].map((r) => new Promise<unknown[]>((res) => (r.onsuccess = () => res(r.result as unknown[])))),
  );
  db.close();
  return keys!.map((key, i) => ({ key: key as IDBValidKey, value: values![i] }));
}

function bytesOf(v: unknown): string {
  const w = v as { iv: Uint8Array; ct: ArrayBuffer };
  return Buffer.from(w.ct).toString('latin1') + Buffer.from(w.iv).toString('latin1');
}

describe('escrowStore', () => {
  it('round-trips a record, bigints and secret bytes included', async () => {
    const store = await openEscrowStore({ indexedDB: new IDBFactory() });
    const rec = record(CODE_A, 7);
    await store.save(rec);
    expect(await store.load(CODE_A)).toEqual(rec);
    expect(await store.codes()).toEqual([CODE_A]);
    expect(await store.load(CODE_B)).toBeNull();
  });

  it('no stored value contains the plaintext secret, password or party state', async () => {
    const idb = new IDBFactory();
    const store = await openEscrowStore({ indexedDB: idb });
    await store.save(record(CODE_A, 0x41));
    const password = await store.createPassword(CODE_A);
    store.close();
    for (const name of [TRADES, SECRETS]) {
      for (const { value } of await raw(idb, name)) {
        expect(Object.keys(value as object).sort()).toEqual(['ct', 'iv']);
        const bytes = bytesOf(value);
        expect(bytes).not.toContain('A'.repeat(16)); // the 0x41-filled signSecret, raw
        expect(bytes).not.toContain('41'.repeat(16)); // ... and hex-encoded
        expect(bytes).not.toContain(password);
        expect(bytes).not.toContain(MARK);
        expect(bytes).not.toContain('4SellerRefund');
      }
    }
    const [k] = await raw(idb, KEYS);
    expect(k!.value).toBeInstanceOf(CryptoKey);
    expect((k!.value as CryptoKey).extractable).toBe(false);
    expect((k!.value as CryptoKey).algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
  });

  it('R27: the wallet password is 32 random bytes, apart from the party state, different per trade, made once', async () => {
    const idb = new IDBFactory();
    const store = await openEscrowStore({ indexedDB: idb });
    await store.save(record(CODE_A, 1));
    await store.save(record(CODE_B, 1));
    const a = await store.createPassword(CODE_A);
    const b = await store.createPassword(CODE_B);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
    expect(await store.createPassword(CODE_A)).toBe(a);
    expect(await store.password(CODE_A)).toBe(a);
    expect(JSON.stringify(await store.load(CODE_A), (_k, v: unknown) => (typeof v === 'bigint' ? String(v) : v))).not.toContain(a);
    // Two racing creates keep one password.
    const [x, y] = await Promise.all([store.createPassword('RACE-RACE-RACE-RACE'), store.createPassword('RACE-RACE-RACE-RACE')]);
    expect(x).toBe(y);
  });

  it('the wrapping key survives reopening; a reopened store reads the records', async () => {
    const idb = new IDBFactory();
    const first = await openEscrowStore({ indexedDB: idb });
    await first.save(record(CODE_A, 3));
    const pw = await first.createPassword(CODE_A);
    first.close();
    const again = await openEscrowStore({ indexedDB: idb });
    expect((await again.load(CODE_A))?.signalSeq).toBe(4);
    expect(await again.password(CODE_A)).toBe(pw);
  });

  it('a record moved to another trade or into the secrets store does not open', async () => {
    const idb = new IDBFactory();
    const store = await openEscrowStore({ indexedDB: idb });
    await store.save(record(CODE_A, 3));
    await store.createPassword(CODE_B);
    store.close();
    const [a] = await raw(idb, TRADES);
    const db = await new Promise<IDBDatabase>((res) => {
      const r = idb.open(DB_NAME);
      r.onsuccess = () => res(r.result);
    });
    const tx = db.transaction([TRADES, SECRETS], 'readwrite');
    tx.objectStore(TRADES).put(a!.value, CODE_B);
    tx.objectStore(SECRETS).put(a!.value, CODE_A);
    await new Promise((res) => (tx.oncomplete = res));
    db.close();
    const again = await openEscrowStore({ indexedDB: idb });
    await expect(again.load(CODE_B)).rejects.toMatchObject({ code: 'bad-record' });
    await expect(again.password(CODE_A)).rejects.toMatchObject({ code: 'bad-record' });
  });

  it('AAD binding: trade A’s wallet password and record written into trade B’s slots do not open as B’s', async () => {
    const idb = new IDBFactory();
    const store = await openEscrowStore({ indexedDB: idb });
    await store.save(record(CODE_A, 3));
    await store.save(record(CODE_B, 5));
    const pwA = await store.createPassword(CODE_A);
    const pwB = await store.createPassword(CODE_B);
    expect(pwA).not.toBe(pwB);
    store.close();
    const secretA = (await raw(idb, SECRETS)).find((x) => x.key === CODE_A)!.value;
    const recordA = (await raw(idb, TRADES)).find((x) => x.key === CODE_A)!.value;
    const db = await new Promise<IDBDatabase>((res) => {
      const r = idb.open(DB_NAME);
      r.onsuccess = () => res(r.result);
    });
    const tx = db.transaction([TRADES, SECRETS], 'readwrite');
    tx.objectStore(SECRETS).put(secretA, CODE_B);
    tx.objectStore(TRADES).put(recordA, CODE_B);
    await new Promise((res) => (tx.oncomplete = res));
    db.close();
    const again = await openEscrowStore({ indexedDB: idb });
    await expect(again.password(CODE_B)).rejects.toMatchObject({ code: 'bad-record' });
    await expect(again.createPassword(CODE_B)).rejects.toMatchObject({ code: 'bad-record' }); // never a fresh one over it either
    await expect(again.load(CODE_B)).rejects.toMatchObject({ code: 'bad-record' });
    // A's own slots still open as A's.
    expect(await again.password(CODE_A)).toBe(pwA);
    expect((await again.load(CODE_A))?.code).toBe(CODE_A);
  });

  it('delete removes the record and the wallet password together', async () => {
    const store = await openEscrowStore({ indexedDB: new IDBFactory() });
    await store.save(record(CODE_A, 1));
    await store.createPassword(CODE_A);
    await store.delete(CODE_A);
    expect(await store.load(CODE_A)).toBeNull();
    expect(await store.password(CODE_A)).toBeNull();
    expect(await store.codes()).toEqual([]);
  });
});

// Lead 10 Nov (J-23 follow-up): an open tab never stalls another tab's upgrade or delete of the
// escrow database. Every connection closes itself on `versionchange`; the store reopens on next use
// only onto the existing database with its existing wrap key: it never creates an empty database
// or a fresh key in place of the one that held the escrow keys, and it deletes nothing.
describe('version changes from another tab', () => {
  /** Opens `x2f-escrow` at `version`: 'opened' (the connection), or 'blocked' when an open connection holds it back. */
  const openRaw = (idb: IDBFactory, version?: number) =>
    new Promise<{ outcome: 'opened' | 'blocked'; db: IDBDatabase | null; created: boolean }>((res, rej) => {
      const r = version === undefined ? idb.open(DB_NAME) : idb.open(DB_NAME, version);
      let created = false;
      r.onupgradeneeded = (e) => {
        created = e.oldVersion === 0;
      };
      r.onblocked = () => res({ outcome: 'blocked', db: null, created });
      r.onsuccess = () => res({ outcome: 'opened', db: r.result, created });
      r.onerror = () => rej(r.error);
    });
  const deleteRaw = (idb: IDBFactory) =>
    new Promise<'deleted' | 'blocked'>((res, rej) => {
      const r = idb.deleteDatabase(DB_NAME);
      r.onblocked = () => res('blocked');
      r.onsuccess = () => res('deleted');
      r.onerror = () => rej(r.error);
    });
  const exists = async (idb: IDBFactory) => (await idb.databases()).some((d) => d.name === DB_NAME);

  it("a newer build's upgrade is not blocked; the records are all still there; this store then fails unavailable, never a hang", async () => {
    const idb = new IDBFactory();
    const store = await openEscrowStore({ indexedDB: idb });
    await store.save(record(CODE_A, 3));
    const pw = await store.createPassword(CODE_A);
    const next = await openRaw(idb, 2);
    expect(next.outcome).toBe('opened');
    next.db!.close();
    expect((await raw(idb, TRADES)).map((x) => x.key)).toEqual([CODE_A]);
    expect((await raw(idb, SECRETS)).map((x) => x.key)).toEqual([CODE_A]);
    expect(await raw(idb, KEYS)).toHaveLength(1);
    await expect(store.load(CODE_A)).rejects.toMatchObject({ code: 'unavailable' });
    await expect(store.save(record(CODE_B, 1))).rejects.toMatchObject({ code: 'unavailable' });
    // A store of the newer build would read them; this build's fresh open is refused cleanly too.
    await expect(openEscrowStore({ indexedDB: idb })).rejects.toMatchObject({ code: 'unavailable' });
    expect(pw).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a delete elsewhere is not blocked; the store never recreates the database or a key on its next use', async () => {
    const idb = new IDBFactory();
    const store = await openEscrowStore({ indexedDB: idb });
    await store.save(record(CODE_A, 3));
    expect(await deleteRaw(idb)).toBe('deleted');
    await expect(store.codes()).rejects.toMatchObject({ code: 'unavailable' });
    await expect(store.save(record(CODE_A, 3))).rejects.toMatchObject({ code: 'unavailable' });
    await expect(store.createPassword(CODE_A)).rejects.toMatchObject({ code: 'unavailable' });
    expect(await exists(idb)).toBe(false);
  });

  it('a database without its wrap key is never given a fresh one by a reopen', async () => {
    const idb = new IDBFactory();
    const store = await openEscrowStore({ indexedDB: idb });
    await store.save(record(CODE_A, 3));
    expect(await deleteRaw(idb)).toBe('deleted');
    // Something else makes the database again with the stores but no key in it.
    const bare = await new Promise<IDBDatabase>((res, rej) => {
      const r = idb.open(DB_NAME, 1);
      r.onupgradeneeded = () => {
        for (const n of [TRADES, SECRETS, KEYS]) r.result.createObjectStore(n);
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    bare.close();
    await expect(store.codes()).rejects.toMatchObject({ code: 'unavailable' });
    expect(await raw(idb, KEYS)).toEqual([]);
  });

  it('reopens on next use onto the database as it now is, with the wrap key stored in it', async () => {
    const idb = new IDBFactory();
    const old = await openEscrowStore({ indexedDB: idb });
    await old.save(record(CODE_A, 3));
    expect(await deleteRaw(idb)).toBe('deleted');
    // Another tab of this build makes the database again and keeps a trade in it.
    const other = await openEscrowStore({ indexedDB: idb });
    await other.save(record(CODE_B, 5));
    const pw = await other.createPassword(CODE_B);
    // The old store reopens (no upgrade, no new key) and reads and writes under the stored key.
    expect(await old.codes()).toEqual([CODE_B]);
    expect(await old.password(CODE_B)).toBe(pw);
    await old.save(record(CODE_A, 3));
    expect(await raw(idb, KEYS)).toHaveLength(1);
    other.close();
    const fresh = await openEscrowStore({ indexedDB: idb });
    expect((await fresh.load(CODE_A))?.code).toBe(CODE_A);
    expect((await fresh.load(CODE_B))?.code).toBe(CODE_B);
  });

  it('close() is final: the store does not reopen after it', async () => {
    const idb = new IDBFactory();
    const store = await openEscrowStore({ indexedDB: idb });
    await store.save(record(CODE_A, 3));
    store.close();
    await expect(store.load(CODE_A)).rejects.toMatchObject({ code: 'unavailable' });
  });

  it("the wallets screen's read of the trade codes does not block an upgrade either", async () => {
    const idb = new IDBFactory();
    const store = await openEscrowStore({ indexedDB: idb });
    await store.save(record(CODE_A, 3));
    store.close();
    const reading = readOpenEscrowCodes(idb);
    const next = await openRaw(idb, 2);
    expect(next.outcome).toBe('opened');
    next.db!.close();
    expect(Array.isArray(await reading)).toBe(true);
    // It reads the trade codes from the trades store (not the wrap key's id from `keys`).
    expect(await readOpenEscrowCodes(idb)).toEqual([CODE_A]);
    // And it never creates the database where there is none.
    const empty = new IDBFactory();
    expect(await readOpenEscrowCodes(empty)).toEqual([]);
    expect(await exists(empty)).toBe(false);
  });
});
