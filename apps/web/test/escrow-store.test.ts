import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { DB_NAME, KEYS, SECRETS, TRADES, openEscrowStore, type EscrowRecord } from '../src/escrow/store.js';

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
    termsAcked: false,
    intent: { kind: 'release', outcome: { to: [{ address: '4Buyer', amountAtomic: 1_250_000_000_000n }], builder: 'seller', cosigner: 'buyer' }, done: false },
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
