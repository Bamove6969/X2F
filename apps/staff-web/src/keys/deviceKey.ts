import { generateIdentity, identityKeysMatch, type Identity } from '@x2f/protocol';
import { staffDeviceKeyId } from '@x2f/staff';

/**
 * Chat membership design task 8 (design sections 2.1 and 4): this staff browser's device key.
 * Staff-web makes it (an Ed25519 signing key and its X25519 box key, as a chat identity is made) and
 * keeps it: the secrets are stored only sealed with AES-256-GCM under a NON-EXTRACTABLE WebCrypto key
 * that lives in the same IndexedDB database, so script on this origin can use the key but nobody
 * can copy it out of the browser in the clear. The public halves and the id
 * (`staffDeviceKeyId(signPublic)`) are what the person certifies with a security-key tap; the
 * moderation gate then re-wraps a disputed chat's key to `boxPublic` (design task 9).
 * `identity()` opens the secrets for one use; the caller wipes them afterwards (`wipeIdentity`).
 *
 * Design build task 10 (review N10): this module runs only inside the chat key worker
 * (keys/chatWorker.ts); the page never imports it, so the secrets are never decrypted in the page.
 * They are stored and opened as raw bytes (record v2: the 64-byte Ed25519 secret key, then the
 * 32-byte X25519 secret, sealed), never as text, so every copy can be zeroed. A record of another
 * version (v1 kept them as hex in JSON, before this was landed) is `bad-record`.
 */

export interface StaffDeviceKey {
  signPublic: string;
  boxPublic: string;
  deviceKeyId: string;
  identity(): Promise<Identity>;
}

/** What is stored: the public halves in the clear, the secrets sealed (`iv`, `ct`: signSecret || boxSecret). */
export interface StoredDeviceKey {
  v: 2;
  signPublic: string;
  boxPublic: string;
  iv: Uint8Array;
  ct: ArrayBuffer;
}

/** Where the wrap key and the sealed record live (IndexedDB in the browser; memory in tests). */
export interface DeviceKeyBackend {
  load(): Promise<{ wrap: CryptoKey | null; rec: StoredDeviceKey | null }>;
  save(wrap: CryptoKey, rec: StoredDeviceKey): Promise<void>;
}

export class DeviceKeyError extends Error {
  constructor(readonly code: 'unavailable' | 'bad-record') {
    super(code);
    this.name = 'DeviceKeyError';
  }
}

const AAD: Uint8Array<ArrayBuffer> = new TextEncoder().encode('x2f-staff-device/v2');
const SIGN_SECRET_LEN = 64;
const BOX_SECRET_LEN = 32;
const HEX64 = /^[0-9a-f]{64}$/;

/** Wipes an opened identity's secrets. */
export function wipeIdentity(i: Identity): void {
  i.signSecret.fill(0);
  i.boxSecret.fill(0);
}

/** This browser's device key: the stored one, or a new one made and stored now. */
export async function staffDeviceKey(backend: DeviceKeyBackend, cr: Crypto = globalThis.crypto): Promise<StaffDeviceKey> {
  if (!cr?.subtle) throw new DeviceKeyError('unavailable');
  let { wrap, rec } = await backend.load();
  if (wrap === null || rec === null) {
    wrap = await cr.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const id = await generateIdentity();
    const secrets = new Uint8Array(SIGN_SECRET_LEN + BOX_SECRET_LEN);
    secrets.set(id.signSecret, 0);
    secrets.set(id.boxSecret, SIGN_SECRET_LEN);
    const iv = cr.getRandomValues(new Uint8Array(12));
    try {
      const ct = await cr.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, wrap, secrets);
      rec = { v: 2, signPublic: id.signPublic, boxPublic: id.boxPublic, iv, ct };
    } finally {
      secrets.fill(0);
      wipeIdentity(id);
    }
    await backend.save(wrap, rec);
  }
  if (rec.v !== 2 || !HEX64.test(rec.signPublic) || !HEX64.test(rec.boxPublic)) throw new DeviceKeyError('bad-record');
  const key = wrap;
  const stored = rec;
  return {
    signPublic: stored.signPublic,
    boxPublic: stored.boxPublic,
    deviceKeyId: staffDeviceKeyId(stored.signPublic),
    async identity() {
      let plain: Uint8Array;
      try {
        plain = new Uint8Array(await cr.subtle.decrypt({ name: 'AES-GCM', iv: stored.iv as Uint8Array<ArrayBuffer>, additionalData: AAD }, key, stored.ct));
      } catch {
        throw new DeviceKeyError('bad-record');
      }
      try {
        if (plain.length !== SIGN_SECRET_LEN + BOX_SECRET_LEN) throw new DeviceKeyError('bad-record');
        // Copies the caller wipes; `plain` is zeroed below.
        const id = { signPublic: stored.signPublic, boxPublic: stored.boxPublic, signSecret: plain.slice(0, SIGN_SECRET_LEN), boxSecret: plain.slice(SIGN_SECRET_LEN) };
        // The stored secrets must be the stored public keys' (review N11 d: the box secret's too).
        if (!(await identityKeysMatch(id))) {
          wipeIdentity(id);
          throw new DeviceKeyError('bad-record');
        }
        return id;
      } finally {
        plain.fill(0);
      }
    },
  };
}

const DB = 'x2f-staff-device';
const STORE = 'device';

/** The browser's backend: one IndexedDB database, the wrap key and the sealed record side by side. */
export function indexedDbDeviceBackend(idb: IDBFactory = globalThis.indexedDB): DeviceKeyBackend {
  const open = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      if (!idb) {
        reject(new DeviceKeyError('unavailable'));
        return;
      }
      const r = idb.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(new DeviceKeyError('unavailable'));
    });
  const req = <T>(r: IDBRequest<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(new DeviceKeyError('unavailable'));
    });
  return {
    async load() {
      const db = await open();
      try {
        const s = db.transaction(STORE).objectStore(STORE);
        const [wrap, rec] = await Promise.all([req(s.get('wrap')), req(s.get('key'))]);
        return { wrap: wrap instanceof CryptoKey ? wrap : null, rec: (rec as StoredDeviceKey | undefined) ?? null };
      } finally {
        db.close();
      }
    },
    async save(wrap, rec) {
      const db = await open();
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(wrap, 'wrap');
        tx.objectStore(STORE).put(rec, 'key');
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(new DeviceKeyError('unavailable'));
        });
      } finally {
        db.close();
      }
    },
  };
}
