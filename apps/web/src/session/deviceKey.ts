/**
 * S-085 device-bound sessions, web side (docs/superpowers/specs/2026-11-12-device-bound-sessions.md).
 *
 * - One ECDSA P-256 key pair per browser profile, made with WebCrypto at first use with the private
 *   key non-extractable (usage `sign`), and kept as `CryptoKey`s in its own IndexedDB database
 *   `x2f-device-key`. Only the public key is ever read out (SPKI, base64url).
 * - Every auth-client POST carries it in `X2F-Session-Key` (`sessionKeyHeader`), so the session the
 *   server opens is bound to it and gets its first `__Host-x2f_bound` cookie in the same answer.
 * - `renewProof` renews that short-lived cookie: a single-use challenge from the server, signed
 *   with the device key over `x2f-session-proof-v1:` + challenge (IEEE-P1363, as WebCrypto gives it).
 * - `startProofRefresh` renews at a third of the cookie's 10 minutes while a session is signed in.
 *   It stops for good when the session turns out not to be bound (409 `not-bound`), the server's
 *   flag is off (404) or the session is gone.
 *
 * Behind `VITE_X2F_DEVICE_BOUND=1` at build time. Without it no key is made, no header is sent and
 * nothing is renewed. Without WebCrypto or IndexedDB, or when key generation is refused, no header is
 * sent and the session is unbound, exactly as before (spec section 6).
 */
export const DEVICE_KEY_DB = 'x2f-device-key';
const STORE = 'keys';
const KEY_ID = 'session';
export const SESSION_KEY_HEADER = 'X2F-Session-Key';
/** The bound cookie's life on the server (`BOUND_TTL_MS`); renewed at a third of it. */
export const BOUND_TTL_MS = 10 * 60_000;
export const REFRESH_EVERY_MS = Math.floor(BOUND_TTL_MS / 3);
export const proofMessage = (challenge: string): string => `x2f-session-proof-v1:${challenge}`;

export function deviceBoundOn(): boolean {
  return (import.meta.env.VITE_X2F_DEVICE_BOUND as string | undefined) === '1';
}

let factory: IDBFactory | null | undefined;
/** Tests: the IndexedDB to use (fake-indexeddb), or null for none; undefined is the browser's. */
export function setDeviceKeyFactory(idb: IDBFactory | null | undefined): void {
  factory = idb;
  pair = undefined;
}

let pair: Promise<CryptoKeyPair | null> | undefined;

function idb(): IDBFactory | null {
  if (factory !== undefined) return factory;
  return typeof indexedDB === 'undefined' ? null : indexedDB;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error ?? new Error('idb'));
  });
}

async function loadOrMake(): Promise<CryptoKeyPair | null> {
  const f = idb();
  const subtle = globalThis.crypto?.subtle;
  if (!f || !subtle) return null;
  const open = f.open(DEVICE_KEY_DB, 1);
  open.onupgradeneeded = () => {
    if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE);
  };
  const db = await req(open);
  try {
    const found = (await req(db.transaction(STORE).objectStore(STORE).get(KEY_ID))) as CryptoKeyPair | undefined;
    if (found?.privateKey && found.publicKey) return found;
    const made = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
    const tx = db.transaction(STORE, 'readwrite');
    // `add`, not `put`: when two tabs race at first use, the first stored key wins and both use it.
    tx.objectStore(STORE).add(made, KEY_ID);
    try {
      await new Promise<void>((res, rej) => {
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error ?? new Error('idb'));
        tx.onabort = () => rej(tx.error ?? new Error('idb'));
      });
      return made;
    } catch {
      const other = (await req(db.transaction(STORE).objectStore(STORE).get(KEY_ID))) as CryptoKeyPair | undefined;
      return other?.privateKey && other.publicKey ? other : null;
    }
  } finally {
    db.close();
  }
}

/** This profile's key pair, made at first use; null when the browser cannot make or keep one. */
export function deviceKey(): Promise<CryptoKeyPair | null> {
  pair ??= loadOrMake().catch(() => null);
  return pair;
}

function b64url(bytes: ArrayBuffer): string {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The `X2F-Session-Key` value (base64url SPKI), or null: flag off, or no key on this browser. */
export async function sessionKeyHeader(): Promise<string | null> {
  if (!deviceBoundOn()) return null;
  const k = await deviceKey();
  if (!k) return null;
  try {
    return b64url(await crypto.subtle.exportKey('spki', k.publicKey));
  } catch {
    return null;
  }
}

/**
 * `renewed`: a new bound cookie is set. `not-bound`: this session has no key (or the server's flag
 * is off), nothing to renew. `gone`: the session ended. `failed`: this browser could not prove the
 * key (no key, a different key, or the network); the session ends once its bound cookie expires.
 */
export type ProofResult = 'renewed' | 'not-bound' | 'gone' | 'failed';

async function errorOf(res: Response): Promise<string> {
  try {
    const b = (await res.json()) as { error?: unknown };
    return typeof b?.error === 'string' ? b.error : '';
  } catch {
    return '';
  }
}

const post = (path: string, body: unknown): Promise<Response> =>
  globalThis.fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

let inFlight: Promise<ProofResult> | undefined;

async function renewOnce(): Promise<ProofResult> {
  try {
    const c = await post('/v1/account/session/proof/challenge', {});
    if (c.status === 404 || c.status === 409) return 'not-bound';
    if (c.status === 401) return (await errorOf(c)) === 'not-authenticated' ? 'gone' : 'failed';
    if (!c.ok) return 'failed';
    const { challenge } = (await c.json()) as { challenge?: unknown };
    if (typeof challenge !== 'string') return 'failed';
    const k = await deviceKey();
    if (!k) return 'failed';
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, k.privateKey, new TextEncoder().encode(proofMessage(challenge)));
    const p = await post('/v1/account/session/proof', { challenge, signature: b64url(sig) });
    if (p.ok) return 'renewed';
    if (p.status === 404) return 'not-bound';
    if (p.status === 401 && (await errorOf(p)) === 'not-authenticated') return 'gone';
    return 'failed';
  } catch {
    return 'failed';
  }
}

/** Renews the bound cookie; concurrent callers share one attempt. */
export function renewProof(): Promise<ProofResult> {
  if (!deviceBoundOn()) return Promise.resolve('not-bound');
  inFlight ??= renewOnce().finally(() => {
    inFlight = undefined;
  });
  return inFlight;
}

let timer: ReturnType<typeof setInterval> | undefined;

/** Renews every `REFRESH_EVERY_MS` while a session is signed in; idempotent. */
export function startProofRefresh(): void {
  if (!deviceBoundOn() || timer !== undefined) return;
  timer = setInterval(() => {
    void renewProof().then((r) => {
      if (r === 'not-bound' || r === 'gone') stopProofRefresh();
    });
  }, REFRESH_EVERY_MS);
}

export function stopProofRefresh(): void {
  if (timer !== undefined) clearInterval(timer);
  timer = undefined;
}

/** True when a response is the server's 401 `session-proof-required` (reads a clone). */
export async function needsProof(res: Response): Promise<boolean> {
  if (res.status !== 401) return false;
  return (await errorOf(res.clone())) === 'session-proof-required';
}
