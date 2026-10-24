/**
 * escrowStore: the device's escrow records for its open trades, in IndexedDB `x2f-escrow`.
 *
 * - `trades`: one record per trade code: the trade identity (secret keys included), the party's
 *   saved state, the signals replay guard and seq, and what the runtime needs to resume.
 * - `x2f-escrow-secrets`: the escrow wallet password per trade, 32 bytes from
 *   crypto.getRandomValues, never a user password, kept apart from the party state (R27).
 * - `keys`: one non-extractable AES-256-GCM CryptoKey that wraps every value above. Each value is
 *   stored as { iv, ct } only, with the store name and trade code bound in as additional data,
 *   so a record moved to another trade or store does not open.
 *
 * Only the worker opens this store; unwrapped secrets never leave it (Task 12).
 */
import type { PartyState } from '@x2f/escrow';
import type { ReplayGuardJSON } from '@x2f/protocol';

export const DB_NAME = 'x2f-escrow';
export const TRADES = 'trades';
export const SECRETS = 'x2f-escrow-secrets';
export const KEYS = 'keys';
const KEY_ID = 'wrap';
const DB_VERSION = 1;
const PASSWORD_BYTES = 32;

export interface StoredIdentity {
  signPublic: string;
  boxPublic: string;
  signSecret: Uint8Array;
  boxSecret: Uint8Array;
}

export interface StoredPayout {
  address: string;
  amountAtomic: bigint;
}

/** What this side asked to settle, kept so a reload settles the same outcome again (Review Focus 1). */
export interface StoredIntent {
  kind: 'release' | 'mutual-cancel' | 'buyer-cancel' | 'auto-refund' | 'lapse-refund';
  /** The outcome last passed to settle(), if any. */
  outcome: { to: StoredPayout[]; builder: 'buyer' | 'seller' | 'mod'; cosigner: 'buyer' | 'seller' | 'mod' } | null;
  /** The tx hash once settle() resolved. */
  done: boolean;
}

export interface EscrowRecord {
  v: 1;
  /** Normalized trade code. */
  code: string;
  role: 'buyer' | 'seller';
  identity: StoredIdentity;
  /** The identity was accepted by the API (or it already held it: 409 identity-exists). */
  registered: boolean;
  /** The attestation and its signature as last verified; re-verified on every resume. */
  attestation: { attestation: unknown; sig: string } | null;
  partyState: PartyState | null;
  signalGuard: ReplayGuardJSON | null;
  signalSeq: number;
  /** This side's own address (buyer payout / seller refund), as it signed it in trade.terms. */
  ownAddress: string | null;
  /** The counterparty's signed trade.terms address, first one wins. */
  theirAddress: string | null;
  /** The moderator acknowledged our trade.terms. */
  termsAcked: boolean;
  intent: StoredIntent | null;
}

export interface EscrowStore {
  codes(): Promise<string[]>;
  load(code: string): Promise<EscrowRecord | null>;
  save(rec: EscrowRecord): Promise<void>;
  /** The trade's wallet password, or null if none was made yet. */
  password(code: string): Promise<string | null>;
  /** Make (once) and store the trade's wallet password; a second call returns the first one. */
  createPassword(code: string): Promise<string>;
  /** Deletes the trade's record and its wallet password together. */
  delete(code: string): Promise<void>;
  close(): void;
}

export class EscrowStoreError extends Error {
  constructor(readonly code: 'bad-record' | 'unavailable') {
    super(code);
    this.name = 'EscrowStoreError';
  }
}

interface Wrapped {
  iv: Uint8Array;
  ct: ArrayBuffer;
}

// ── encoding: JSON with tagged bigint and bytes ──────────────────────────────

const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
function unhex(s: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})*$/.test(s)) throw new EscrowStoreError('bad-record');
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function encode(v: unknown): Uint8Array {
  const json = JSON.stringify(v, function (this: Record<string, unknown>, k: string, val: unknown) {
    const raw = this[k];
    if (typeof raw === 'bigint') return { $b: raw.toString() };
    if (raw instanceof Uint8Array) return { $u: hex(raw) };
    return val;
  });
  return new TextEncoder().encode(json);
}

function decode(bytes: ArrayBuffer): unknown {
  return JSON.parse(new TextDecoder().decode(bytes), (_k, val: unknown) => {
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      const keys = Object.keys(val);
      const o = val as Record<string, unknown>;
      if (keys.length === 1 && typeof o.$b === 'string' && /^-?\d+$/.test(o.$b)) return BigInt(o.$b);
      if (keys.length === 1 && typeof o.$u === 'string') return unhex(o.$u);
    }
    return val;
  });
}

// ── IndexedDB plumbing ───────────────────────────────────────────────────────

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new EscrowStoreError('unavailable'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new EscrowStoreError('unavailable'));
    tx.onabort = () => reject(tx.error ?? new EscrowStoreError('unavailable'));
  });
}

function openDb(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = idb.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const name of [TRADES, SECRETS, KEYS]) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new EscrowStoreError('unavailable'));
    r.onblocked = () => reject(new EscrowStoreError('unavailable'));
  });
}

/** The wrapping key: made once, non-extractable, kept as a CryptoKey object in IndexedDB. */
async function wrapKey(db: IDBDatabase, subtle: SubtleCrypto): Promise<CryptoKey> {
  const existing = await req(db.transaction(KEYS).objectStore(KEYS).get(KEY_ID));
  if (existing instanceof CryptoKey) return existing;
  const fresh = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  // get-then-put in one transaction: two tabs opening at once end up with the same key.
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

const aad = (store: string, code: string): Uint8Array => new TextEncoder().encode(`x2f-escrow/v1\0${store}\0${code}`);

export async function openEscrowStore(o: { indexedDB?: IDBFactory; crypto?: Crypto } = {}): Promise<EscrowStore> {
  const idb = o.indexedDB ?? globalThis.indexedDB;
  const cr = o.crypto ?? globalThis.crypto;
  if (!idb || !cr?.subtle) throw new EscrowStoreError('unavailable');
  const db = await openDb(idb);
  const key = await wrapKey(db, cr.subtle);

  const wrap = async (store: string, code: string, value: unknown): Promise<Wrapped> => {
    const iv = cr.getRandomValues(new Uint8Array(12));
    const ct = await cr.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(store, code) }, key, encode(value));
    return { iv, ct };
  };
  const unwrap = async (store: string, code: string, w: unknown): Promise<unknown> => {
    const x = w as Partial<Wrapped> | null;
    if (!x || !(x.iv instanceof Uint8Array) || !(x.ct instanceof ArrayBuffer)) throw new EscrowStoreError('bad-record');
    let plain: ArrayBuffer;
    try {
      plain = await cr.subtle.decrypt({ name: 'AES-GCM', iv: x.iv, additionalData: aad(store, code) }, key, x.ct);
    } catch {
      throw new EscrowStoreError('bad-record');
    }
    return decode(plain);
  };
  const get = async (store: string, code: string): Promise<unknown> => {
    const raw = await req(db.transaction(store).objectStore(store).get(code));
    return raw === undefined ? null : unwrap(store, code, raw);
  };

  return {
    async codes() {
      const keys = await req(db.transaction(TRADES).objectStore(TRADES).getAllKeys());
      return keys.filter((k): k is string => typeof k === 'string');
    },
    async load(code) {
      const rec = (await get(TRADES, code)) as EscrowRecord | null;
      if (rec !== null && (rec.v !== 1 || rec.code !== code)) throw new EscrowStoreError('bad-record');
      return rec;
    },
    async save(rec) {
      const w = await wrap(TRADES, rec.code, rec);
      const tx = db.transaction(TRADES, 'readwrite');
      tx.objectStore(TRADES).put(w, rec.code);
      await done(tx);
    },
    async password(code) {
      const v = (await get(SECRETS, code)) as { password?: unknown } | null;
      if (v === null) return null;
      if (typeof v.password !== 'string' || !/^[0-9a-f]{64}$/.test(v.password)) throw new EscrowStoreError('bad-record');
      return v.password;
    },
    async createPassword(code) {
      const have = await this.password(code);
      if (have !== null) return have;
      const fresh = hex(cr.getRandomValues(new Uint8Array(PASSWORD_BYTES)));
      const w = await wrap(SECRETS, code, { password: fresh });
      // add() refuses an existing key, so a racing second call cannot replace the first password.
      const tx = db.transaction(SECRETS, 'readwrite');
      const added = tx.objectStore(SECRETS).add(w, code);
      added.onerror = (e) => {
        e.preventDefault();
      };
      await done(tx).catch(() => undefined);
      const stored = await this.password(code);
      if (stored === null) throw new EscrowStoreError('unavailable');
      return stored;
    },
    async delete(code) {
      const tx = db.transaction([TRADES, SECRETS], 'readwrite');
      tx.objectStore(TRADES).delete(code);
      tx.objectStore(SECRETS).delete(code);
      await done(tx);
    },
    close() {
      db.close();
    },
  };
}
