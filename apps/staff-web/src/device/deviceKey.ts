import { generateIdentity, type Identity } from '@x2f/protocol';
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
 */

export interface StaffDeviceKey {
  signPublic: string;
  boxPublic: string;
  deviceKeyId: string;
  identity(): Promise<Identity>;
}

/** What is stored: the public halves in the clear, the secrets sealed (`iv`, `ct`). */
export interface StoredDeviceKey {
  v: 1;
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

const AAD: Uint8Array<ArrayBuffer> = new TextEncoder().encode('x2f-staff-device/v1');
const HEX64 = /^[0-9a-f]{64}$/;
const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const fromHex = (h: string): Uint8Array => new Uint8Array(h.match(/../g)!.map((x) => Number.parseInt(x, 16)));

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
    const secrets = new TextEncoder().encode(JSON.stringify({ signSecret: toHex(id.signSecret), boxSecret: toHex(id.boxSecret) }));
    const iv = cr.getRandomValues(new Uint8Array(12));
    try {
      const ct = await cr.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, wrap, secrets);
      rec = { v: 1, signPublic: id.signPublic, boxPublic: id.boxPublic, iv, ct };
    } finally {
      secrets.fill(0);
      wipeIdentity(id);
    }
    await backend.save(wrap, rec);
  }
  if (rec.v !== 1 || !HEX64.test(rec.signPublic) || !HEX64.test(rec.boxPublic)) throw new DeviceKeyError('bad-record');
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
        const s = JSON.parse(new TextDecoder().decode(plain)) as { signSecret?: unknown; boxSecret?: unknown };
        if (typeof s.signSecret !== 'string' || typeof s.boxSecret !== 'string') throw new DeviceKeyError('bad-record');
        const signSecret = fromHex(s.signSecret);
        // The stored secrets must be the stored public key's (the last 32 bytes of an Ed25519 secret key).
        if (signSecret.length !== 64 || toHex(signSecret.subarray(32)) !== stored.signPublic) throw new DeviceKeyError('bad-record');
        return { signPublic: stored.signPublic, boxPublic: stored.boxPublic, signSecret, boxSecret: fromHex(s.boxSecret) };
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
