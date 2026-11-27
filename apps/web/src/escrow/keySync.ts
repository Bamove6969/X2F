/**
 * Escrow-key sync (Plan 3 Task 42, first part; API escrowSync/routes.ts, migration 860). Owner 26
 * Nov 2026: "The keys should be stored on our servers but encrypted and accessible only to the
 * person they are assigned to and the person who they are assigned to also assigns them to."
 *
 * End to end, in the browser; the API stores ciphertext only and holds no key that opens it:
 * - Reader key: each reader (the account holder, and each member the holder assigned with the
 *   "Hold trade keys" box) has an X25519 box key pair. Its secret leaves the browser only inside
 *   unlock envelopes:
 *   - `prf`: AES-256-GCM under HKDF-SHA256 of a passkey or security key's WebAuthn PRF output
 *     (a fresh 32-byte salt per envelope; the credential id is its `ref`);
 *   - `pgp`: an OpenPGP message of the secret (64 hex) to the person's own PGP public key; they
 *     decrypt it in their own tool and paste the 64 hex back (X2F never sees a private PGP key, R8).
 *   An authenticator (TOTP) code never unlocks (it logs a trader in with the login name since owner 27 Nov 2026, but it makes no key: the API and database refuse it).
 * - Trade copy: on every write of a trade's local record (store.ts), `withKeySync` encrypts
 *   `{ record, password }` (the store's own encoding) under a fresh 32-byte content key with
 *   AES-256-GCM, the trade code and version bound in as additional data, and seals the content key
 *   (`crypto_box_seal`) to each reader the API lists. Deleting the local record deletes the copy
 *   (the 30-day rule after the close, runtime.ts KEEP_AFTER_CLOSE_MS).
 * - Restore (`restoreTrades`): on a new device of the holder, after unlocking the reader key, each
 *   trade the device does not hold is fetched, opened and stored locally.
 *
 * A member the holder assigned ("Hold trade keys") restores the copies sealed to them the same
 * way, on their own device, when one of their trade boxes needs the escrow there (memberKey.ts;
 * owner Jess, 26 Nov 2026: fund, release, proof and I've paid are separate boxes).
 */
import { generateBoxKeyPair, openSealed, sealTo, type BoxKeyPair } from '@x2f/protocol';
import { decode, encode, type EscrowRecord, type EscrowStore } from './store.js';

export const SYNC_VERSION_TAG = 'x2f-escrow-sync/v1';
const CONTENT_KEY_BYTES = 32;
const IV_BYTES = 12;
const HEX64 = /^[0-9a-f]{64}$/;

export type UnlockMethod = 'prf' | 'pgp';
export interface UnlockEnvelope {
  method: UnlockMethod;
  ref: string;
  /** base64url, `prf` only. */
  salt?: string | null;
  /** base64url. */
  envelope: string;
}

export class KeySyncError extends Error {
  constructor(readonly code: 'locked' | 'bad-copy' | 'bad-unlock' | 'no-prf' | 'api') {
    super(code);
    this.name = 'KeySyncError';
  }
}

// ── bytes ────────────────────────────────────────────────────────────────────

export function toB64(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
function unhex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}
const utf8 = (s: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(s);
const subtle = (): SubtleCrypto => globalThis.crypto.subtle;
const random = (n: number): Uint8Array<ArrayBuffer> => globalThis.crypto.getRandomValues(new Uint8Array(n));

async function gcmSeal(rawKey: Uint8Array<ArrayBuffer>, plain: Uint8Array<ArrayBuffer>, aad: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const key = await subtle().importKey('raw', rawKey, 'AES-GCM', false, ['encrypt']);
  const iv = random(IV_BYTES);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, plain));
  const out = new Uint8Array(IV_BYTES + ct.length);
  out.set(iv);
  out.set(ct, IV_BYTES);
  return out;
}
async function gcmOpen(rawKey: Uint8Array<ArrayBuffer>, box: Uint8Array<ArrayBuffer>, aad: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer> {
  if (box.length < IV_BYTES + 16) throw new KeySyncError('bad-copy');
  const key = await subtle().importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
  try {
    return await subtle().decrypt({ name: 'AES-GCM', iv: box.slice(0, IV_BYTES), additionalData: aad }, key, box.slice(IV_BYTES));
  } catch {
    throw new KeySyncError('bad-copy');
  }
}

// ── reader key and its unlocks ───────────────────────────────────────────────

/** A fresh reader key (X25519). Its secret stays in memory and in unlock envelopes only. */
export const newReaderKey = (): Promise<BoxKeyPair> => generateBoxKeyPair();

const prfAad = (ref: string): Uint8Array<ArrayBuffer> => utf8(`${SYNC_VERSION_TAG}\0reader-unlock\0prf\0${ref}`);

/** The AES key an unlock's PRF output makes (HKDF-SHA256; the salt is the PRF eval input, kept beside it). */
async function prfKey(prfOutput: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  if (prfOutput.length < 32) throw new KeySyncError('no-prf');
  const ikm = await subtle().importKey('raw', prfOutput, 'HKDF', false, ['deriveBits']);
  const bits = await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: utf8(`${SYNC_VERSION_TAG}\0reader-unlock`) }, ikm, 256);
  return new Uint8Array(bits);
}

/** Wraps the reader secret under a passkey or security key's PRF output (`salt` was its PRF input). */
export async function prfEnvelope(reader: BoxKeyPair, credentialId: string, salt: Uint8Array<ArrayBuffer>, prfOutput: Uint8Array<ArrayBuffer>): Promise<UnlockEnvelope> {
  const env = await gcmSeal(await prfKey(prfOutput), new Uint8Array(reader.boxSecret), prfAad(credentialId));
  return { method: 'prf', ref: credentialId, salt: toB64(salt), envelope: toB64(env) };
}

/** Opens a `prf` envelope with the PRF output of the same credential and salt; checks it against the reader's public key. */
export async function openPrfEnvelope(u: UnlockEnvelope, boxPublic: string, prfOutput: Uint8Array<ArrayBuffer>): Promise<BoxKeyPair> {
  if (u.method !== 'prf') throw new KeySyncError('bad-unlock');
  let secret: Uint8Array;
  try {
    secret = new Uint8Array(await gcmOpen(await prfKey(prfOutput), fromB64(u.envelope), prfAad(u.ref)));
  } catch {
    throw new KeySyncError('bad-unlock');
  }
  return checkedPair(boxPublic, secret);
}

/** Wraps the reader secret to the person's own PGP public key (armored). OpenPGP loads only here. */
export async function pgpEnvelope(reader: BoxKeyPair, armoredPublicKey: string): Promise<UnlockEnvelope> {
  const openpgp = await import('openpgp');
  const key = await openpgp.readKey({ armoredKey: armoredPublicKey });
  const message = await openpgp.createMessage({ text: `${SYNC_VERSION_TAG} reader key: ${hex(reader.boxSecret)}\n` });
  const armored = (await openpgp.encrypt({ message, encryptionKeys: key, format: 'armored' })) as string;
  return { method: 'pgp', ref: key.getFingerprint().toUpperCase(), envelope: toB64(utf8(armored)) };
}

/** The armored message a `pgp` envelope holds, for the person to decrypt in their own tool. */
export function pgpEnvelopeText(u: UnlockEnvelope): string {
  if (u.method !== 'pgp') throw new KeySyncError('bad-unlock');
  return new TextDecoder().decode(fromB64(u.envelope));
}

/** The reader key from what the person pasted after decrypting the `pgp` envelope (the 64 hex in it). */
export async function openPgpPaste(pasted: string, boxPublic: string): Promise<BoxKeyPair> {
  const m = /\b([0-9a-f]{64})\b/i.exec(pasted.trim());
  if (!m) throw new KeySyncError('bad-unlock');
  return checkedPair(boxPublic, unhex(m[1]!.toLowerCase()));
}

/** The pair, only when the secret derives the public key (a sealed test box opens). */
async function checkedPair(boxPublic: string, secret: Uint8Array): Promise<BoxKeyPair> {
  if (!HEX64.test(boxPublic) || secret.length !== 32) throw new KeySyncError('bad-unlock');
  const pair = { boxPublic, boxSecret: secret };
  try {
    const probe = random(16);
    const opened = await openSealed(pair, await sealTo(boxPublic, probe));
    if (hex(opened) !== hex(probe)) throw new Error('mismatch');
  } catch {
    throw new KeySyncError('bad-unlock');
  }
  return pair;
}

/**
 * The PRF output of one of the person's passkeys or security keys (main thread only: WebAuthn).
 * `credentialId` (base64url) picks the credential; left out, the person picks one. The assertion
 * itself is never sent anywhere: only the PRF output is used, on this device.
 */
export async function webauthnPrf(salt: Uint8Array<ArrayBuffer>, credentialId?: string): Promise<{ credentialId: string; prf: Uint8Array<ArrayBuffer> }> {
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: random(32),
      userVerification: 'required',
      ...(credentialId ? { allowCredentials: [{ type: 'public-key', id: fromB64(credentialId) }] } : {}),
      extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  const first = (cred?.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } } | undefined)?.prf?.results?.first;
  if (!cred || !first) throw new KeySyncError('no-prf');
  return { credentialId: toB64(new Uint8Array(cred.rawId)), prf: new Uint8Array(first) };
}

// ── trade copies ─────────────────────────────────────────────────────────────

export interface Reader {
  id: string;
  /** 64 lower-case hex. */
  publicKey: string;
}

export interface TradeCopy {
  ciphertext: string;
  wraps: { readerId: string; wrapped: string }[];
}

interface Payload {
  v: 1;
  code: string;
  record: EscrowRecord;
  password: string | null;
}

const tradeAad = (code: string, version: number): Uint8Array<ArrayBuffer> => utf8(`${SYNC_VERSION_TAG}\0trade\0${code}\0${version}`);

/** Encrypts one trade's record and password under a fresh content key, sealed to every reader. */
export async function sealTrade(code: string, version: number, record: EscrowRecord, password: string | null, readers: readonly Reader[]): Promise<TradeCopy> {
  if (readers.length === 0) throw new KeySyncError('locked');
  const contentKey = random(CONTENT_KEY_BYTES);
  const payload: Payload = { v: 1, code, record, password };
  const ciphertext = await gcmSeal(contentKey, encode(payload), tradeAad(code, version));
  const wraps = [];
  for (const r of readers) wraps.push({ readerId: r.id, wrapped: toB64(await sealTo(r.publicKey, contentKey)) });
  contentKey.fill(0);
  return { ciphertext: toB64(ciphertext), wraps };
}

/** Opens a trade copy with the reader's own wrap; refuses one for another code or version. */
export async function openTrade(code: string, version: number, ciphertext: string, wrapped: string, reader: BoxKeyPair): Promise<{ record: EscrowRecord; password: string | null }> {
  let contentKey: Uint8Array<ArrayBuffer>;
  try {
    contentKey = new Uint8Array(await openSealed(reader, fromB64(wrapped)));
  } catch {
    throw new KeySyncError('bad-copy');
  }
  if (contentKey.length !== CONTENT_KEY_BYTES) throw new KeySyncError('bad-copy');
  const plain = await gcmOpen(contentKey, fromB64(ciphertext), tradeAad(code, version));
  let p: Payload;
  try {
    p = decode(plain) as Payload;
  } catch {
    throw new KeySyncError('bad-copy');
  }
  if (p?.v !== 1 || p.code !== code || p.record?.v !== 1 || p.record.code !== code) throw new KeySyncError('bad-copy');
  if (p.password !== null && (typeof p.password !== 'string' || !HEX64.test(p.password))) throw new KeySyncError('bad-copy');
  return { record: p.record, password: p.password };
}

// ── the API ──────────────────────────────────────────────────────────────────

export interface KeySyncApi {
  readers(): Promise<Reader[]>;
  putTrade(code: string, body: { version: number } & TradeCopy): Promise<{ ok: true } | { stale: number }>;
  deleteTrade(code: string): Promise<void>;
  listTrades(): Promise<{ code: string; version: number }[]>;
  getTrade(code: string): Promise<{ version: number; ciphertext: string; wrapped: string } | null>;
  getReader(): Promise<{ id: string; publicKey: string; unlocks: UnlockEnvelope[] } | null>;
  putReader(body: { publicKey: string; unlocks: UnlockEnvelope[] }): Promise<{ id: string }>;
}

export function httpKeySyncApi(f: typeof fetch = (u, i) => fetch(u, i)): KeySyncApi {
  const call = async (url: string, init: RequestInit = {}): Promise<Response> =>
    f(url, {
      ...init,
      credentials: 'same-origin',
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
      headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}) },
    });
  const json = async <T>(res: Response): Promise<T> => {
    if (!res.ok) throw new KeySyncError('api');
    return (await res.json()) as T;
  };
  const trade = (code: string) => `/v1/escrow-keys/trades/${encodeURIComponent(code)}`;
  return {
    async readers() {
      return (await json<{ readers: Reader[] }>(await call('/v1/escrow-keys/readers'))).readers;
    },
    async putTrade(code, body) {
      const res = await call(trade(code), { method: 'PUT', body: JSON.stringify(body) });
      if (res.status === 409) return { stale: Number(((await res.json().catch(() => ({}))) as { version?: unknown }).version) || 0 };
      await json(res);
      return { ok: true };
    },
    async deleteTrade(code) {
      const res = await call(trade(code), { method: 'DELETE' });
      if (!res.ok) throw new KeySyncError('api');
    },
    async listTrades() {
      return (await json<{ trades: { code: string; version: number }[] }>(await call('/v1/escrow-keys/trades'))).trades;
    },
    async getTrade(code) {
      const res = await call(trade(code));
      if (res.status === 404) return null;
      return json(res);
    },
    async getReader() {
      const res = await call('/v1/escrow-keys/reader');
      if (res.status === 404) return null;
      return json(res);
    },
    async putReader(body) {
      return json(await call('/v1/escrow-keys/reader', { method: 'PUT', body: JSON.stringify(body) }));
    },
  };
}

// ── sync on write, restore ───────────────────────────────────────────────────

/**
 * The escrow store, with a server copy kept in step: after each save or new password the trade is
 * sealed again to the readers the API lists, and a delete deletes the copy. Best effort and in the
 * background: the local store stays the truth; a failed upload is retried by the next write. With
 * no reader registered yet (the API lists none) nothing is uploaded.
 */
export function withKeySync(inner: EscrowStore, api: KeySyncApi, o: { now?: () => number; onError?: (e: unknown) => void } = {}): EscrowStore & { idle(): Promise<void> } {
  const now = o.now ?? (() => Date.now());
  const versions = new Map<string, number>();
  const queues = new Map<string, Promise<void>>();
  const nextVersion = (code: string): number => {
    const v = Math.max(now(), (versions.get(code) ?? 0) + 1);
    versions.set(code, v);
    return v;
  };
  const push = async (code: string): Promise<void> => {
    const record = await inner.load(code);
    if (record === null) return;
    const readers = await api.readers();
    if (readers.length === 0) return;
    const password = await inner.password(code);
    for (let attempt = 0; attempt < 2; attempt++) {
      const version = nextVersion(code);
      const res = await api.putTrade(code, { version, ...(await sealTrade(code, version, record, password, readers)) });
      if ('ok' in res) return;
      // Another device (or tab) wrote a later copy: go above it.
      versions.set(code, Math.max(versions.get(code) ?? 0, res.stale));
    }
  };
  const enqueue = (code: string, job: () => Promise<void>): void => {
    const run = (queues.get(code) ?? Promise.resolve()).then(job).catch((e: unknown) => o.onError?.(e));
    queues.set(code, run);
  };
  return {
    codes: () => inner.codes(),
    load: (code) => inner.load(code),
    password: (code) => inner.password(code),
    importPassword: (code, pw) => inner.importPassword(code, pw),
    async save(rec) {
      await inner.save(rec);
      enqueue(rec.code, () => push(rec.code));
    },
    async createPassword(code) {
      const pw = await inner.createPassword(code);
      enqueue(code, () => push(code));
      return pw;
    },
    async delete(code) {
      await inner.delete(code);
      enqueue(code, () => api.deleteTrade(code));
    },
    close: () => inner.close(),
    async idle() {
      await Promise.all([...queues.values()]);
    },
  };
}

/**
 * A new device of the holder, after the reader key is unlocked: every trade copy sealed to it that
 * this device does not hold is opened and stored. A copy that does not open is skipped (never
 * stored half). Returns the codes restored.
 */
export async function restoreTrades(store: EscrowStore, api: KeySyncApi, reader: BoxKeyPair): Promise<string[]> {
  const have = new Set(await store.codes());
  const restored: string[] = [];
  for (const t of await api.listTrades()) {
    if (have.has(t.code)) continue;
    const copy = await api.getTrade(t.code);
    if (copy === null) continue;
    let opened: { record: EscrowRecord; password: string | null };
    try {
      opened = await openTrade(t.code, copy.version, copy.ciphertext, copy.wrapped, reader);
    } catch (e) {
      if (e instanceof KeySyncError) continue;
      throw e;
    }
    if (opened.password !== null) await store.importPassword(t.code, opened.password);
    await store.save(opened.record);
    restored.push(t.code);
  }
  return restored;
}

