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
import type { Deal } from './policy.js';

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
  /** Owner 16 Nov: this output pays its share of the network fee (the engine builds and checks by it). */
  bearsNetworkFee?: boolean;
}

/** What this side asked to settle, kept so a reload settles the same outcome again (Review Focus 1). */
export interface StoredIntent {
  /**
   * `ruling` (Plan 4): the moderator-built ruling set this side co-signs as the winner, chosen by
   * the runtime (always `auto`) only once the moderation service's signed ruling statement verified.
   */
  kind: 'release' | 'mutual-cancel' | 'buyer-cancel' | 'auto-refund' | 'lapse-refund' | 'ruling';
  /** The outcome last passed to settle(), if any. */
  outcome: { to: StoredPayout[]; builder: 'buyer' | 'seller' | 'mod'; cosigner: 'buyer' | 'seller' | 'mod' } | null;
  /** settle() resolved for this outcome. */
  done: boolean;
  /** Chosen by the runtime (standing release co-sign, lapse refund), not by a tap. */
  auto: boolean;
  /**
   * `ruling` only (security review 22 Nov, M2): the intent the ruling replaced, restored when the
   * party turns out committed to it (another builder's outcome it can no longer switch from), and
   * asked for at the close (`landed`). Absent or null: there was none.
   */
  prior?: Omit<StoredIntent, 'prior'> | null;
}

export interface EscrowRecord {
  v: 1;
  /** Normalized trade code. */
  code: string;
  role: 'buyer' | 'seller';
  identity: StoredIdentity;
  /**
   * Device clock (ms) when this device made `identity`, kept with it before the API ever sees it
   * (review lead-escrow-harden M1): the attestation naming that identity may not be older, which a
   * holder of a rotated-out attestation key cannot get around by backdating `issuedAt`. Absent in
   * records written before the field: verified without a lower bound, which only today's
   * unbounded key accepts (packages/trade attestation.ts).
   */
  identityCreatedAt?: number;
  /** The identity was accepted by the API (or it already held it: 409 identity-exists). */
  registered: boolean;
  /**
   * Regtest e2e gap 5: this device registered its identity for the trade's chat (or found nothing
   * left to do), so a resume does not ask again (runtime `prepareChat`). Absent: not yet.
   */
  chatPrepared?: boolean;
  /** The attestation and its signature as last verified; re-verified on every resume. */
  attestation: { attestation: unknown; sig: string } | null;
  partyState: PartyState | null;
  signalGuard: ReplayGuardJSON | null;
  signalSeq: number;
  /** This side's own address (buyer payout / seller refund), as it signed it in trade.terms. */
  ownAddress: string | null;
  /** The counterparty's signed trade.terms address, first one wins. */
  theirAddress: string | null;
  /** The deal this device stored at setup and signed in its trade.terms. */
  deal: Deal;
  /** The counterparty's signed deal; it must equal `deal` before anything is settled. */
  theirDeal: Deal | null;
  /** The trade's size as this device works it out (deviceAmount), frozen once paid is known. */
  sizeAtomic: bigint;
  /** This device knows of "I've paid" (sent it, or got the buyer's trade.paid): no more growth. */
  paidSeen: boolean;
  /** The moderator acknowledged our trade.terms. */
  termsAcked: boolean;
  intent: StoredIntent | null;
  /**
   * Security review 22 Nov, M1: this device verified the moderation service's signed ruling statement
   * for this trade and its own escrow address naming the OTHER side the winner. Only then does it
   * count a ruling close (released or refunded with no settlement kind) as settled without it.
   * Absent: never verified (fail closed).
   */
  rulingLost?: boolean;
  /**
   * Owner 26 Nov: the winner named by the signed ruling statement this device verified (for this
   * trade and its own escrow address). Either side's app co-signs that winner's exact set, and a
   * ruling close in that winner's direction counts as settled without this device. Absent: never
   * verified (fail closed).
   */
  rulingWinner?: 'buyer' | 'seller';
  /**
   * Review p4t22 residual (a): the highest round of the moderation service's after-refund statement
   * this device verified for the trade. A statement for a lower round never shows the pay form
   * afterwards (a round 2 that overruled round 1 stays in force, whatever the API serves later).
   * Absent: none verified yet.
   */
  afterRefundRound?: 1 | 2;
  /**
   * The trade amount this device fixed (security fix, 2026-10-24): the buyer at its own "I've
   * paid" tap (with the fiat total it confirmed); the seller from the buyer's signed trade.paid
   * amount, if it fits. Never from the API, never before paid. From then on only this amount is
   * accepted for a release (refunds pay the whole balance and do not depend on it).
   */
  acceptedAtomic?: bigint | null;
  /** Lien recovery the buyer confirmed (ConfirmedTrade.lienRecoveryAtomic); absent = none. */
  lienRecoveryAtomic?: bigint;
  /** Device clock (ms) when this device first saw the trade closed; the 30-day keep counts from here. */
  closedSeenAt?: number | null;
  /** Device clock (ms) when this device saw its OWN settle done and the escrow empty with nothing in the pool. */
  settleSeenAt?: number | null;
  /**
   * This device has seen coins in the escrow (a balance or any incoming tx). New records start
   * false; a record without the field (written before it existed) counts as UNKNOWN, never as
   * never-funded.
   */
  fundedSeen?: boolean;
  /**
   * This device has seen the escrow secured (a view with `securedAt`, or in secured, paid or
   * settling; re-verify R1). From then on every view must carry the payment instructions, whatever a
   * later view says about the state. Absent: not seen yet.
   */
  securedSeen?: boolean;
  /**
   * The trade amount of the FIRST release this device handed to its party (saved before the
   * hand-over) and never cleared, whatever the intents do afterwards. From then on a release for
   * any other amount, and an "I've paid" tap for another amount, is refused. Refunds ignore it.
   */
  releaseBoundAtomic?: bigint | null;
  /**
   * Gap 2 (docs/security/growth-before-paid-2026-11-20.md): the buyer moved releaseBoundAtomic UP
   * to a grown amount before paid (I1's only exception), at least once. Never cleared: from then on
   * the "I've paid" tap also asks the party that it is committed to nothing. Absent: never.
   */
  releaseRebound?: boolean;
  /**
   * The bound and the release outcome handed to the party just before the latest rebind, saved in
   * the same write as the new bound. Kept while the party has not taken the rebound outcome
   * (review M1: the status sum and the tap stay at `boundAtomic` until then), and after a refusal
   * (review M2: `outcome` is the release the party is committed to, handed back on every run so it
   * can complete). Cleared once the party took the rebound outcome (review m3). Absent: none.
   */
  releasePrior?: { boundAtomic: bigint; outcome: NonNullable<StoredIntent['outcome']> } | null;
  /**
   * The party refused a rebound release because it is committed to an earlier one: from then on
   * this device shows no sum, takes no "I've paid" tap and builds no other release; it only hands
   * `releasePrior.outcome` back to the party. Absent: no.
   */
  releaseRebindRefused?: boolean;
  /**
   * The seller's copy of the buyer's first valid signed trade.paid, kept until this device's own
   * size reaches it (then it becomes acceptedAtomic). Its wallet may see the extra coins later.
   */
  paidPending?: { amountAtomic: bigint; fiatCents: bigint } | null;
  /**
   * The buyer's time to pay in minutes, the first one this device saw in the trade view and
   * verified against the attestation (launch-rules review F2); a later view showing another is
   * refused (`deal-mismatch`). Absent until then, and in records written before the field.
   */
  payWindowMin?: number | null;
  /**
   * The seller refused the buyer's signed trade.paid for good: a total that does not fit the
   * amount, an amount below the take amount, or a second, different trade.paid.
   */
  paidRefused?: boolean;
  /**
   * The escrow was emptied by the other two parties in a way that needs nothing from this device
   * (the seller in a buyer cancel; a buyer that never tapped "I've paid" in an auto or lapse
   * refund). Not a failure; the store follows the 30-day rule.
   */
  settledWithoutDevice?: boolean;
  /**
   * An integrity failure that stops this trade on this device for good; kept so a reload stops it
   * again: participants mismatch, or the party's own (a confirmed settled-elsewhere, equivocation,
   * address mismatch). Transient failures are never stored. 'deal-mismatch' was kept by records
   * written before 2026-10-26 and is dropped on load (a deal mismatch is checked again on every start).
   */
  failed?: 'participants-mismatch' | 'deal-mismatch' | 'escrow-failed' | null;
}

export interface EscrowStore {
  codes(): Promise<string[]>;
  load(code: string): Promise<EscrowRecord | null>;
  save(rec: EscrowRecord): Promise<void>;
  /** The trade's wallet password, or null if none was made yet. */
  password(code: string): Promise<string | null>;
  /** Make (once) and store the trade's wallet password; a second call returns the first one. */
  createPassword(code: string): Promise<string>;
  /**
   * Escrow-key sync (keySync.ts): stores a restored wallet password for a trade that has none on
   * this device yet (a new device after unlock). Never replaces one: a second call keeps the first.
   */
  importPassword(code: string, password: string): Promise<void>;
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
  iv: Uint8Array<ArrayBuffer>;
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

/** The store's encoding (tagged bigint and bytes); escrow-key sync (keySync.ts) encrypts the same bytes. */
export function encode(v: unknown): Uint8Array<ArrayBuffer> {
  const json = JSON.stringify(v, function (this: Record<string, unknown>, k: string, val: unknown) {
    const raw = this[k];
    if (typeof raw === 'bigint') return { $b: raw.toString() };
    if (raw instanceof Uint8Array) return { $u: hex(raw) };
    return val;
  });
  return new TextEncoder().encode(json);
}

export function decode(bytes: ArrayBuffer): unknown {
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

/**
 * Opens the database. Every connection closes itself when another tab asks for a version change (a
 * newer build's upgrade, or a delete), so this tab never stalls it (lead 10 Nov). `create` is true
 * only for the store's first open: a reopen never creates or upgrades anything, because this
 * database holds escrow keys and an empty one in its place would lose them (the upgrade is aborted,
 * which also removes a database the abort would otherwise have created).
 */
function openDb(idb: IDBFactory, create: boolean): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let r: IDBOpenDBRequest;
    try {
      r = idb.open(DB_NAME, DB_VERSION);
    } catch {
      reject(new EscrowStoreError('unavailable'));
      return;
    }
    r.onupgradeneeded = () => {
      if (!create) {
        r.transaction?.abort();
        return;
      }
      const db = r.result;
      for (const name of [TRADES, SECRETS, KEYS]) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
    };
    r.onsuccess = () => {
      const db = r.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    // Also a newer database than this build knows (VersionError): unavailable, never a hang.
    r.onerror = (e) => {
      e.preventDefault();
      reject(new EscrowStoreError('unavailable'));
    };
    r.onblocked = () => reject(new EscrowStoreError('unavailable'));
  });
}

/**
 * The wrapping key: made once, non-extractable, kept as a CryptoKey object in IndexedDB. With
 * `make` false (a reopen) a missing key is `unavailable`: a fresh key is never put in place of one.
 */
async function wrapKey(db: IDBDatabase, subtle: SubtleCrypto, make = true): Promise<CryptoKey> {
  const existing = await req(db.transaction(KEYS).objectStore(KEYS).get(KEY_ID));
  if (existing instanceof CryptoKey) return existing;
  if (!make) throw new EscrowStoreError('unavailable');
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

const aad = (store: string, code: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(`x2f-escrow/v1\0${store}\0${code}`);

export async function openEscrowStore(o: { indexedDB?: IDBFactory; crypto?: Crypto } = {}): Promise<EscrowStore> {
  const idb = o.indexedDB ?? globalThis.indexedDB;
  const cr = o.crypto ?? globalThis.crypto;
  if (!idb || !cr?.subtle) throw new EscrowStoreError('unavailable');

  // The live connection and its wrap key. A version change from another tab closes it; the next use
  // reopens onto the existing database and key only (never creating either); close() is final.
  type Conn = { db: IDBDatabase; key: CryptoKey; closed: boolean };
  let latest: Conn | null = null;
  const attach = (db: IDBDatabase, key: CryptoKey): Conn => {
    const conn: Conn = { db, key, closed: false };
    latest = conn;
    db.onversionchange = () => {
      conn.closed = true;
      db.close();
    };
    return conn;
  };
  const first = await openDb(idb, true);
  let current: Promise<Conn> = Promise.resolve(attach(first, await wrapKey(first, cr.subtle)));
  let ended = false;
  const reopen = async (): Promise<Conn> => {
    const db = await openDb(idb, false);
    try {
      for (const name of [TRADES, SECRETS, KEYS]) if (!db.objectStoreNames.contains(name)) throw new EscrowStoreError('unavailable');
      return attach(db, await wrapKey(db, cr.subtle, false));
    } catch (e) {
      db.close();
      throw e instanceof EscrowStoreError ? e : new EscrowStoreError('unavailable');
    }
  };
  const conn = async (): Promise<Conn> => {
    if (ended) throw new EscrowStoreError('unavailable');
    const c = await current.catch(() => null);
    if (c !== null && !c.closed) return c;
    current = reopen();
    return current;
  };

  const wrap = async (store: string, code: string, value: unknown): Promise<Wrapped> => {
    const { key } = await conn();
    const iv = cr.getRandomValues(new Uint8Array(12));
    const ct = await cr.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(store, code) }, key, encode(value));
    return { iv, ct };
  };
  const unwrap = async (store: string, code: string, w: unknown): Promise<unknown> => {
    const x = w as Partial<Wrapped> | null;
    if (!x || !(x.iv instanceof Uint8Array) || !(x.ct instanceof ArrayBuffer)) throw new EscrowStoreError('bad-record');
    const { key } = await conn();
    let plain: ArrayBuffer;
    try {
      plain = await cr.subtle.decrypt({ name: 'AES-GCM', iv: x.iv, additionalData: aad(store, code) }, key, x.ct);
    } catch {
      throw new EscrowStoreError('bad-record');
    }
    return decode(plain);
  };
  const get = async (store: string, code: string): Promise<unknown> => {
    const { db } = await conn();
    const raw = await req(db.transaction(store).objectStore(store).get(code));
    return raw === undefined ? null : unwrap(store, code, raw);
  };

  const store: EscrowStore = {
    async codes() {
      const { db } = await conn();
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
      const { db } = await conn();
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
      const have = await store.password(code);
      if (have !== null) return have;
      const fresh = hex(cr.getRandomValues(new Uint8Array(PASSWORD_BYTES)));
      const w = await wrap(SECRETS, code, { password: fresh });
      // add() refuses an existing key, so a racing second call cannot replace the first password.
      const { db } = await conn();
      const tx = db.transaction(SECRETS, 'readwrite');
      const added = tx.objectStore(SECRETS).add(w, code);
      added.onerror = (e) => {
        e.preventDefault();
      };
      await done(tx).catch(() => undefined);
      const stored = await store.password(code);
      if (stored === null) throw new EscrowStoreError('unavailable');
      return stored;
    },
    async importPassword(code, password) {
      if (!/^[0-9a-f]{64}$/.test(password)) throw new EscrowStoreError('bad-record');
      const w = await wrap(SECRETS, code, { password });
      const { db } = await conn();
      const tx = db.transaction(SECRETS, 'readwrite');
      const added = tx.objectStore(SECRETS).add(w, code);
      added.onerror = (e) => {
        e.preventDefault();
      };
      await done(tx).catch(() => undefined);
    },
    async delete(code) {
      const { db } = await conn();
      const tx = db.transaction([TRADES, SECRETS], 'readwrite');
      tx.objectStore(TRADES).delete(code);
      tx.objectStore(SECRETS).delete(code);
      await done(tx);
    },
    close() {
      ended = true;
      latest?.db.close();
    },
  };
  return store;
}
