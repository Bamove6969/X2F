/**
 * Settings → Security, "Trade key backup": the steps behind the section (TradeKeys.tsx), kept apart
 * so they can be tested without a page. The crypto is escrow/keySync.ts; this file only decides
 * which key wraps the reader secret and what is sent to `PUT /v1/escrow-keys/reader`.
 *
 * - The keys offered: the person's own passkeys and security keys (PRF) and PGP keys, from
 *   `GET /v1/escrow-keys/unlock-methods`. Never the authenticator app: it makes no key (the API
 *   and database refuse any method but `prf` and `pgp`).
 * - Adding a way to unlock needs the reader secret, so the person first unlocks with a key the
 *   backup already has; removing one sends the other envelopes back unchanged (no unlock needed),
 *   and the last one is never removed.
 * - Whether a passkey or security key supports PRF is not stored anywhere: it is found out when the
 *   key is asked (`KeySyncError('no-prf')`).
 */
import type { BoxKeyPair } from '@x2f/protocol';
import {
  KeySyncError,
  fromB64,
  httpKeySyncApi,
  newReaderKey,
  openPgpPaste,
  openPrfEnvelope,
  pgpEnvelope,
  prfEnvelope,
  webauthnPrf,
  type KeySyncApi,
  type UnlockEnvelope,
} from '../../escrow/keySync.js';
import { TRADE_KEYS_COPY as K } from './tradeKeysCopy.js';

/** The box that assigns a member as a reader of the trade keys ("Hold trade keys", API team/abilities.ts row 67). */
export const ESCROW_KEYS_ABILITY = 'trades-escrow-keys';

export interface UnlockOptions {
  keys: { kind: 'passkey' | 'security-key'; label: string; credentialId: string }[];
  pgp: { fingerprint: string; label: string; publicKey: string }[];
}

/** A key the person may wrap the reader secret with. */
export type KeyChoice =
  | { method: 'prf'; ref: string; kind: 'passkey' | 'security-key'; label: string }
  | { method: 'pgp'; ref: string; publicKey: string; label: string };

/** The reader as `GET /v1/escrow-keys/reader` answers it (each unlock also carries its row id). */
export interface StoredReader {
  id: string;
  publicKey: string;
  unlocks: (UnlockEnvelope & { id?: string })[];
}

export interface TradeKeysDeps {
  api: Pick<KeySyncApi, 'putReader'>;
  unlockMethods(): Promise<UnlockOptions>;
  prf: typeof webauthnPrf;
  newReader: () => Promise<BoxKeyPair>;
  random(n: number): Uint8Array<ArrayBuffer>;
}

const isStr = (v: unknown): v is string => typeof v === 'string';

/** Parses `GET /v1/escrow-keys/unlock-methods` strictly. */
export function parseUnlockOptions(raw: unknown): UnlockOptions {
  const r = raw as { keys?: unknown; pgp?: unknown } | null;
  if (r === null || typeof r !== 'object' || !Array.isArray(r.keys) || !Array.isArray(r.pgp)) throw new KeySyncError('api');
  return {
    keys: r.keys.map((k: { kind?: unknown; label?: unknown; credentialId?: unknown }) => {
      if ((k?.kind !== 'passkey' && k?.kind !== 'security-key') || !isStr(k.label) || !isStr(k.credentialId)) throw new KeySyncError('api');
      return { kind: k.kind, label: k.label, credentialId: k.credentialId };
    }),
    pgp: r.pgp.map((k: { fingerprint?: unknown; label?: unknown; publicKey?: unknown }) => {
      if (!isStr(k?.fingerprint) || !isStr(k.label) || !isStr(k.publicKey)) throw new KeySyncError('api');
      return { fingerprint: k.fingerprint, label: k.label, publicKey: k.publicKey };
    }),
  };
}

export function httpUnlockMethods(f: typeof fetch = (u, i) => fetch(u, i)): () => Promise<UnlockOptions> {
  return async () => {
    const res = await f('/v1/escrow-keys/unlock-methods', { credentials: 'same-origin', redirect: 'error', headers: { accept: 'application/json' } });
    if (!res.ok) throw new KeySyncError('api');
    return parseUnlockOptions(await res.json());
  };
}

/** Every key that may wrap the reader secret: passkeys and security keys first, then PGP keys. No authenticator app. */
export function keyChoices(o: UnlockOptions): KeyChoice[] {
  return [
    ...o.keys.map((k): KeyChoice => ({ method: 'prf', ref: k.credentialId, kind: k.kind, label: k.label })),
    ...o.pgp.map((k): KeyChoice => ({ method: 'pgp', ref: k.fingerprint, publicKey: k.publicKey, label: k.label })),
  ];
}

export const choiceLabel = (c: KeyChoice): string =>
  c.method === 'pgp' ? K.pgpLabel(c.label) : c.kind === 'passkey' ? K.passkeyLabel(c.label) : K.securityKeyLabel(c.label);

/** The words for one stored unlock: the key it belongs to, by its ref. */
export function unlockLabel(u: Pick<UnlockEnvelope, 'method' | 'ref'>, o: UnlockOptions | null): string {
  const c = o === null ? undefined : keyChoices(o).find((x) => x.method === u.method && sameRef(x.ref, u.ref, u.method));
  return c === undefined ? K.unknownKey : choiceLabel(c);
}

const sameRef = (a: string, b: string, method: 'prf' | 'pgp'): boolean => (method === 'pgp' ? a.toUpperCase() === b.toUpperCase() : a === b);

/** Keys not already wrapping the reader secret. */
export function newChoices(o: UnlockOptions, have: readonly Pick<UnlockEnvelope, 'method' | 'ref'>[]): KeyChoice[] {
  return keyChoices(o).filter((c) => !have.some((u) => u.method === c.method && sameRef(c.ref, u.ref, c.method)));
}

/** The reader secret wrapped under one key: a fresh 32-byte PRF salt per envelope, or a PGP message. */
export async function wrapWith(reader: BoxKeyPair, c: KeyChoice, d: Pick<TradeKeysDeps, 'prf' | 'random'>): Promise<UnlockEnvelope> {
  if (c.method === 'pgp') return pgpEnvelope(reader, c.publicKey);
  const salt = d.random(32);
  const { credentialId, prf } = await d.prf(salt, c.ref);
  return prfEnvelope(reader, credentialId, salt, prf);
}

/** What `PUT /v1/escrow-keys/reader` takes for one unlock (no row id; `salt` only for `prf`). */
export function putShape(u: UnlockEnvelope): UnlockEnvelope {
  return u.method === 'prf' ? { method: 'prf', ref: u.ref, salt: u.salt ?? null, envelope: u.envelope } : { method: 'pgp', ref: u.ref, envelope: u.envelope };
}

/** A new reader key, wrapped under the chosen key, registered. */
export async function setUpReader(c: KeyChoice, d: TradeKeysDeps): Promise<void> {
  const reader = await d.newReader();
  const env = await wrapWith(reader, c, d);
  await d.api.putReader({ publicKey: reader.boxPublic, unlocks: [env] });
}

/** Opens the reader secret with a passkey or security key the backup has. */
export async function unlockWithPrf(r: StoredReader, u: UnlockEnvelope, d: Pick<TradeKeysDeps, 'prf'>): Promise<BoxKeyPair> {
  if (u.method !== 'prf' || !u.salt) throw new KeySyncError('bad-unlock');
  const { prf } = await d.prf(fromB64(u.salt), u.ref);
  return openPrfEnvelope(u, r.publicKey, prf);
}

/** Opens the reader secret from the text the person decrypted with their PGP key. */
export const unlockWithPgp = (r: StoredReader, pasted: string): Promise<BoxKeyPair> => openPgpPaste(pasted, r.publicKey);

/** Adds one more way to unlock (the reader already unlocked); the others stay as they are. */
export async function addUnlock(r: StoredReader, reader: BoxKeyPair, c: KeyChoice, d: TradeKeysDeps): Promise<void> {
  if (reader.boxPublic !== r.publicKey) throw new KeySyncError('bad-unlock');
  const env = await wrapWith(reader, c, d);
  await d.api.putReader({ publicKey: r.publicKey, unlocks: [...r.unlocks.map(putShape), env] });
}

/** Removes one way to unlock; never the last. Returns false when it was the last one. */
export async function removeUnlock(r: StoredReader, u: Pick<UnlockEnvelope, 'method' | 'ref'>, d: Pick<TradeKeysDeps, 'api'>): Promise<boolean> {
  const left = r.unlocks.filter((x) => !(x.method === u.method && x.ref === u.ref));
  if (left.length === 0 || left.length === r.unlocks.length) return false;
  await d.api.putReader({ publicKey: r.publicKey, unlocks: left.map(putShape) });
  return true;
}

/** The words for a failed step. */
export function keyErrorWords(e: unknown, fallback: string): string {
  if (e instanceof KeySyncError && e.code === 'no-prf') return K.noPrf;
  if (e instanceof KeySyncError && e.code === 'bad-unlock') return K.badUnlock;
  return fallback;
}

/**
 * `GET /v1/escrow-keys/reader`: the reader, `'none'` before one is set up, or `'hidden'` for a
 * member without "Hold trade keys" (the section is then not shown).
 */
export function httpReaderState(f: typeof fetch = (u, i) => fetch(u, i)): () => Promise<StoredReader | 'none' | 'hidden'> {
  return async () => {
    const res = await f('/v1/escrow-keys/reader', { credentials: 'same-origin', redirect: 'error', headers: { accept: 'application/json' } });
    if (res.status === 404) return 'none';
    if (res.status === 403) return 'hidden';
    if (!res.ok) throw new KeySyncError('api');
    const r = (await res.json()) as StoredReader;
    if (!isStr(r?.id) || !isStr(r.publicKey) || !Array.isArray(r.unlocks)) throw new KeySyncError('api');
    return r;
  };
}

export function defaultTradeKeysDeps(): TradeKeysDeps & { readerState: () => Promise<StoredReader | 'none' | 'hidden'> } {
  return {
    api: httpKeySyncApi(),
    readerState: httpReaderState(),
    unlockMethods: httpUnlockMethods(),
    prf: webauthnPrf,
    newReader: newReaderKey,
    random: (n) => globalThis.crypto.getRandomValues(new Uint8Array(n)),
  };
}
