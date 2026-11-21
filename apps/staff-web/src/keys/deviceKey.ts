import type { BoxOpener, Signer } from '@x2f/protocol';
import { deviceKeysMatch } from '@x2f/protocol';
import { staffDeviceKeyId } from '@x2f/staff';

/**
 * Chat membership design tasks 8 and 10 (design sections 2.1 and 4): this staff browser's device key.
 * An Ed25519 signing key and an X25519 box key, made in the chat key worker as NON-EXTRACTABLE
 * WebCrypto keys (`generateKey(..., false, ...)`) and stored as those CryptoKey objects in IndexedDB
 * (structured clone keeps them non-extractable). Review lead-mod-chat B1: no secret byte exists
 * anywhere this origin's script could read. IndexedDB is shared by the page and the worker, so
 * page script can still USE the keys while it runs (sign, derive), but it can never export them,
 * decrypt them out of a record, or carry them away.
 * - The countersign is `subtle.sign('Ed25519')` (`signer`).
 * - A re-wrapped chat key is opened from `subtle.deriveBits('X25519')` (`opener`), then the rest of
 *   crypto_box_seal_open in libsodium (protocol `openSealedWith`).
 * The public halves and the id (`staffDeviceKeyId(signPublic)`) are what the person certifies.
 *
 * A browser whose WebCrypto lacks Ed25519 or X25519 gets `crypto-unavailable`: never a fallback to
 * raw keys. A record of an older version (v1, v2: their secrets were bytes sealed under an AES key
 * beside them) is deleted and a new key made, which the person must certify again (nothing had
 * landed). A v3 record that does not check out is `bad-record`, never silently another key.
 */

export interface StaffDeviceKey {
  signPublic: string;
  boxPublic: string;
  deviceKeyId: string;
  signer: Signer;
  opener: BoxOpener;
}

/** What is stored: the public halves, and the two non-extractable private CryptoKeys. */
export interface StoredDeviceKey {
  v: 3;
  signPublic: string;
  boxPublic: string;
  sign: CryptoKey;
  box: CryptoKey;
}

/** Where the record lives (IndexedDB in the browser; memory in tests). `load` gives whatever is stored. */
export interface DeviceKeyBackend {
  load(): Promise<unknown>;
  save(rec: StoredDeviceKey): Promise<void>;
}

export class DeviceKeyError extends Error {
  constructor(readonly code: 'unavailable' | 'bad-record' | 'crypto-unavailable') {
    super(code);
    this.name = 'DeviceKeyError';
  }
}

const HEX64 = /^[0-9a-f]{64}$/;
const toHex = (b: ArrayBuffer): string => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');

const privateKey = (k: unknown, name: string, usage: KeyUsage): boolean =>
  typeof CryptoKey !== 'undefined' && k instanceof CryptoKey && k.algorithm.name === name && k.type === 'private' && k.extractable === false && k.usages.includes(usage);

/** A v3 record of the right shape, its keys non-extractable private keys of the right algorithms. */
function isV3(r: unknown): r is StoredDeviceKey {
  const o = r as Partial<StoredDeviceKey> | null;
  return typeof o === 'object' && o !== null && o.v === 3 && typeof o.signPublic === 'string' && HEX64.test(o.signPublic)
    && typeof o.boxPublic === 'string' && HEX64.test(o.boxPublic) && privateKey(o.sign, 'Ed25519', 'sign') && privateKey(o.box, 'X25519', 'deriveBits');
}

const notSupported = (e: unknown): boolean => (e as { name?: unknown } | null)?.name === 'NotSupportedError';

async function makeKey(cr: Crypto): Promise<StoredDeviceKey> {
  let sign: CryptoKeyPair;
  let box: CryptoKeyPair;
  try {
    sign = (await cr.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])) as CryptoKeyPair;
    box = (await cr.subtle.generateKey({ name: 'X25519' }, false, ['deriveBits'])) as CryptoKeyPair;
  } catch {
    // No Ed25519 or X25519 in this browser's WebCrypto: never a raw-key fallback.
    throw new DeviceKeyError('crypto-unavailable');
  }
  if (sign.privateKey.extractable || box.privateKey.extractable) throw new DeviceKeyError('crypto-unavailable');
  return {
    v: 3,
    signPublic: toHex(await cr.subtle.exportKey('raw', sign.publicKey)),
    boxPublic: toHex(await cr.subtle.exportKey('raw', box.publicKey)),
    sign: sign.privateKey,
    box: box.privateKey,
  };
}

function keyOf(rec: StoredDeviceKey, cr: Crypto): StaffDeviceKey {
  const signer: Signer = {
    signPublic: rec.signPublic,
    sign: async (bytes) => new Uint8Array(await cr.subtle.sign({ name: 'Ed25519' }, rec.sign, bytes as Uint8Array<ArrayBuffer>)),
  };
  const opener: BoxOpener = {
    boxPublic: rec.boxPublic,
    async sharedWith(epk) {
      const pub = await cr.subtle.importKey('raw', epk as Uint8Array<ArrayBuffer>, { name: 'X25519' }, false, []);
      return new Uint8Array(await cr.subtle.deriveBits({ name: 'X25519', public: pub }, rec.box, 256));
    },
  };
  return { signPublic: rec.signPublic, boxPublic: rec.boxPublic, deviceKeyId: staffDeviceKeyId(rec.signPublic), signer, opener };
}

/** This browser's device key: the stored one, or a new one made and stored now. */
export async function staffDeviceKey(backend: DeviceKeyBackend, cr: Crypto = globalThis.crypto): Promise<StaffDeviceKey> {
  if (!cr?.subtle) throw new DeviceKeyError('unavailable');
  let rec = await backend.load();
  const older = typeof rec === 'object' && rec !== null && ((rec as { v?: unknown }).v === 1 || (rec as { v?: unknown }).v === 2);
  if (rec === null || rec === undefined || older) {
    rec = await makeKey(cr);
    await backend.save(rec as StoredDeviceKey);
  }
  if (!isV3(rec)) throw new DeviceKeyError('bad-record');
  const k = keyOf(rec, cr);
  // The stored keys must be the stored public keys' (review N11 d, now by use: a signature and an X25519).
  let ok: boolean;
  try {
    ok = await deviceKeysMatch(k.signer, k.opener);
  } catch (e) {
    throw new DeviceKeyError(notSupported(e) ? 'crypto-unavailable' : 'bad-record');
  }
  if (!ok) throw new DeviceKeyError('bad-record');
  return k;
}

const DB = 'x2f-staff-device';
const STORE = 'device';

/** The browser's backend: one IndexedDB database holding the record under `key` (an older record's `wrap` is deleted on save). */
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
        return (await req(db.transaction(STORE).objectStore(STORE).get('key'))) ?? null;
      } finally {
        db.close();
      }
    },
    async save(rec) {
      const db = await open();
      try {
        const tx = db.transaction(STORE, 'readwrite');
        const s = tx.objectStore(STORE);
        s.put(rec, 'key');
        // An older record's AES wrap key (v1, v2) goes with it.
        s.delete('wrap');
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
