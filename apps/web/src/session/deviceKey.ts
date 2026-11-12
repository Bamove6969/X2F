/**
 * S-085 device-bound sessions, web side (docs/superpowers/specs/2026-11-12-device-bound-sessions.md).
 *
 * - One ECDSA P-256 key pair per browser profile, made with WebCrypto at first use with the private
 *   key non-extractable (usage `sign`), and kept as `CryptoKey`s in its own IndexedDB database
 *   `x2f-device-key`. Only the public key is ever read out (SPKI, base64url).
 * - Every auth-client POST carries it in `X2F-Session-Key` (`sessionKeyHeader`), so the session the
 *   server opens is bound to it and gets its first `__Host-x2f_bound` cookie in the same answer.
 * - `renewProof` renews that short-lived cookie: a single-use challenge from the server, signed
 *   with the device key over `proofMessage(origin, session, challenge)` (v2, review S1;
 *   IEEE-P1363, as WebCrypto gives it). Renewals are serialised across this profile's tabs with
 *   the `x2f-proof` Web Lock (review MF1). A network error, a 5xx or a 429 is `retry-later` and
 *   never ends the session (review MF2).
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
/** The exact bytes signed (the server's `proofMessage`, v2): context, origin, session id, challenge. */
export const proofMessage = (origin: string, session: string, challenge: string): string => `x2f-session-proof-v2\n${origin}\n${session}\n${challenge}`;
const CHALLENGE = /^[A-Za-z0-9_-]{75}$/;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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
 * key (no key, a different key, a refused proof); the caller retries its request once (another tab
 * may have renewed the shared cookie) before it counts the session as gone. `retry-later`: the
 * network, a 5xx or a 429 (the budget): nothing is known about the session, try again later.
 */
export type ProofResult = 'renewed' | 'not-bound' | 'gone' | 'failed' | 'retry-later';

/** A status that says nothing about the session: try again later. */
const later = (status: number): boolean => status === 429 || status >= 500;

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

/** `fetch`, with a thrown (network) error as null. */
async function tryPost(path: string, body: unknown): Promise<Response | null> {
  try {
    return await post(path, body);
  } catch {
    return null;
  }
}

async function renewOnce(): Promise<ProofResult> {
  const c = await tryPost('/v1/account/session/proof/challenge', {});
  if (c === null || later(c.status)) return 'retry-later';
  if (c.status === 404 || c.status === 409) return 'not-bound';
  if (c.status === 401) return (await errorOf(c)) === 'not-authenticated' ? 'gone' : 'failed';
  if (!c.ok) return 'failed';
  let challenge: unknown;
  let session: unknown;
  try {
    ({ challenge, session } = (await c.json()) as { challenge?: unknown; session?: unknown });
  } catch {
    return 'retry-later';
  }
  // Only these shapes are ever signed: nothing else can ride into the message.
  if (typeof challenge !== 'string' || !CHALLENGE.test(challenge) || typeof session !== 'string' || !SESSION_ID.test(session)) return 'failed';
  const origin = (globalThis as { location?: { origin?: unknown } }).location?.origin;
  if (typeof origin !== 'string' || origin === '' || origin === 'null') return 'failed';
  const k = await deviceKey();
  if (!k) return 'failed';
  let sig: ArrayBuffer;
  try {
    sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, k.privateKey, new TextEncoder().encode(proofMessage(origin, session, challenge)));
  } catch {
    return 'failed';
  }
  const p = await tryPost('/v1/account/session/proof', { challenge, signature: b64url(sig) });
  if (p === null || later(p.status)) return 'retry-later';
  if (p.ok) return 'renewed';
  if (p.status === 404) return 'not-bound';
  if (p.status === 401 && (await errorOf(p)) === 'not-authenticated') return 'gone';
  return 'failed';
}

type ProofLock = (name: string, fn: () => Promise<ProofResult>) => Promise<ProofResult>;
let lockOverride: ProofLock | undefined;
/** Tests: the cross-tab lock to use; undefined is the browser's (navigator.locks). */
export function setProofLock(lock: ProofLock | undefined): void {
  lockOverride = lock;
}

/** Runs `fn` holding the profile-wide `x2f-proof` lock (Web Locks), or directly where there are none. */
function withProofLock(fn: () => Promise<ProofResult>): Promise<ProofResult> {
  if (lockOverride) return lockOverride('x2f-proof', fn);
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  if (!locks?.request) return fn();
  return locks.request('x2f-proof', { mode: 'exclusive' }, fn) as Promise<ProofResult>;
}

/** Renews the bound cookie; concurrent callers in this tab share one attempt, and tabs take turns. */
export function renewProof(): Promise<ProofResult> {
  if (!deviceBoundOn()) return Promise.resolve('not-bound');
  inFlight ??= withProofLock(renewOnce)
    .catch((): ProofResult => 'retry-later')
    .finally(() => {
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
