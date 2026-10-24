/**
 * PGP sign-up, login, confirm and adding a key (Task 7).
 *
 * - Every challenge is encrypted with wildcard recipients (zero key IDs) and signed with the
 *   official X2F key (R7); unknown keys get a decoy of the same shape (P2-C3).
 * - Login needs no name (owner, 2026-10-23): `start` takes the person's whole public key and the
 *   challenge goes to that one key; an unknown key's decoy goes to it too.
 * - Keys are stored only as `armored_enc` (AES-256-GCM under `subkey('pgp-key')`), with user IDs
 *   stripped where the key survives it (R16). No route returns, and no log line holds, a user ID.
 * - No endpoint generates, accepts or returns a private PGP key of a user (R8).
 * - PGP codes are not throttled per guess (60-bit, single-use); only login `start` is limited.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  PGP_PURPOSE, actionHash, challengeText, describeAction, encryptChallenge, inspectPublicKey,
  newLoginCode, normalizeLoginCode, pastedRecipientStillValid, type AccountKind, type ConfirmAction, type KeyInspection,
} from '@x2f/accounts';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import * as openpgp from 'openpgp';
import type { Deps } from '../app.js';
import { addAlert } from '../alerts.js';
import { assertDisplayNameFree, assertNewNames, assertTermsAccepted, createAccount, type NewNames } from '../accounts.js';
import { subkey, type Config } from '../config.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { parseConfirmAction } from './actionInput.js';
import { consumeChallenge, takeStartBudgetUnlessOpen, type ChallengeRow } from './challenges.js';
import { issueConfirmToken, requireConfirm } from './confirm.js';
import { deviceHash, ensureDeviceCookie } from './device.js';
import { completeLogin, type LoginResult } from './login.js';
import { methodAllowed } from './methods.js';
import { requestOrigin } from './origin.js';
import { requireSession, startSession } from './sessions.js';
import { NIL_UUID } from './throttle.js';

// ---------------------------------------------------------------------------------------------
// The official X2F signing key (R7)

/** The official X2F PGP key every challenge is signed with; its fingerprint is published on the site. */
export interface PgpSigner {
  key: openpgp.PrivateKey;
  fingerprint: string;
  publicArmored: string;
}

/** Checks an armored private key and builds the signer; errors name the variable, never the key. */
export async function pgpSignerFromArmored(armored: string, expectedFingerprint: string): Promise<PgpSigner> {
  let key: openpgp.PrivateKey;
  try {
    key = await openpgp.readPrivateKey({ armoredKey: armored });
  } catch {
    throw new Error('config: X2F_PGP_SIGNING_KEY_PATH must hold an unencrypted armored private key');
  }
  if (!key.isDecrypted()) {
    throw new Error('config: X2F_PGP_SIGNING_KEY_PATH holds a passphrase-protected key; X2F needs it unencrypted');
  }
  const fingerprint = key.getFingerprint();
  if (fingerprint !== expectedFingerprint) {
    throw new Error('config: X2F_PGP_SIGNING_FINGERPRINT does not match the key in X2F_PGP_SIGNING_KEY_PATH');
  }
  try {
    await key.getSigningKey();
  } catch {
    throw new Error('config: X2F_PGP_SIGNING_KEY_PATH holds a key that cannot sign (expired, revoked or no signing key)');
  }
  return { key, fingerprint, publicArmored: key.toPublic().armor() };
}

/**
 * Reads the official signing key (R7). Refuses a public-only or passphrase-protected key, and a
 * key whose fingerprint differs from `X2F_PGP_SIGNING_FINGERPRINT`. `main.ts` calls it before
 * listening (after `assertSigningKeyFile`) and exits on error.
 */
export async function loadPgpSigner(path: string, expectedFingerprint: string): Promise<PgpSigner> {
  let armored: string;
  try {
    armored = await readFile(path, 'utf8');
  } catch {
    throw new Error('config: X2F_PGP_SIGNING_KEY_PATH is not a readable file');
  }
  return pgpSignerFromArmored(armored, expectedFingerprint);
}

// ---------------------------------------------------------------------------------------------
// Stored keys (R16)

const ARMOR_CONFIG: openpgp.Config = { ...openpgp.config, showComment: false, showVersion: false };

/**
 * What X2F keeps of a public key. User ID packets (names, emails) and their certifications are
 * removed when the key stays usable without them (v6 keys, whose direct-key signature carries the
 * key's settings): the stripped key must pass `inspectPublicKey` at `now` with the same
 * fingerprint and expiry. Otherwise (v4) the key is kept whole. Either way it is re-armored with
 * no Comment or Version header and then stored only encrypted.
 */
export async function storableKey(armored: string, now: Date): Promise<string> {
  const key = await openpgp.readKey({ armoredKey: armored });
  const whole = key.armor(ARMOR_CONFIG);
  if (key.keyPacket.version !== 6 || key.users.length === 0) return whole;
  const stripped = await openpgp.readKey({ armoredKey: whole });
  stripped.users = [];
  const candidate = stripped.armor(ARMOR_CONFIG);
  const [before, after] = await Promise.all([inspectPublicKey(whole, now), inspectPublicKey(candidate, now)]);
  const same =
    before.ok && after.ok && before.fingerprint === after.fingerprint &&
    (before.expiresAt?.getTime() ?? null) === (after.expiresAt?.getTime() ?? null);
  return same ? candidate : whole;
}

const aad = (fingerprint: string) => Buffer.from(`x2f/pgp-key/${fingerprint}`, 'utf8');

/** AES-256-GCM under `subkey('pgp-key')`, bound to the fingerprint: nonce (12) ‖ ciphertext ‖ tag (16). */
export function sealKey(config: Config, armored: string, fingerprint: string): Buffer {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', subkey(config, 'pgp-key'), nonce, { authTagLength: 16 });
  cipher.setAAD(aad(fingerprint));
  const body = Buffer.concat([cipher.update(armored, 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, body, cipher.getAuthTag()]);
}

/** Decrypts a stored key in memory (only to encrypt a challenge to it). */
export function openKey(config: Config, sealed: Buffer, fingerprint: string): string {
  if (sealed.length < 12 + 16) throw new Error('stored PGP key is malformed');
  const decipher = createDecipheriv('aes-256-gcm', subkey(config, 'pgp-key'), sealed.subarray(0, 12), { authTagLength: 16 });
  decipher.setAAD(aad(fingerprint));
  decipher.setAuthTag(sealed.subarray(sealed.length - 16));
  return Buffer.concat([decipher.update(sealed.subarray(12, sealed.length - 16)), decipher.final()]).toString('utf8');
}

/**
 * Stores a public key for an account (inside the caller's transaction when given a client):
 * reduced by `storableKey`, sealed, and inserted. A fingerprint already on any account → 409
 * `key-in-use`.
 */
export async function insertPgpKey(
  db: Queryable,
  config: Config,
  a: { accountId: string; fingerprint: string; armored: string; now: Date },
): Promise<void> {
  const sealed = sealKey(config, await storableKey(a.armored, a.now), a.fingerprint);
  try {
    await db.query('insert into pgp_keys (account_id, fingerprint, armored_enc, created_at) values ($1, $2, $3, $4)', [
      a.accountId, a.fingerprint, sealed, a.now,
    ]);
  } catch (e) {
    const err = e as { code?: string; constraint?: string };
    if (err.code === '23505' && err.constraint === 'pgp_keys_fingerprint_key') throw new ApiError(409, 'key-in-use');
    throw e;
  }
}

/** A key kept in a challenge's payload until `finish`: its fingerprint and the sealed storable armor. */
interface PendingKey {
  fingerprint: string;
  keyEnc: string;
}

async function pendingKey(config: Config, armored: string, fingerprint: string, now: Date): Promise<{ storable: string; pending: PendingKey }> {
  const storable = await storableKey(armored, now);
  return { storable, pending: { fingerprint, keyEnc: sealKey(config, storable, fingerprint).toString('base64') } };
}

function readPendingKey(payload: Record<string, unknown>, field: string): PendingKey {
  const v = payload[field] as Partial<PendingKey> | undefined;
  if (!v || typeof v.fingerprint !== 'string' || typeof v.keyEnc !== 'string') throw new Error('challenge payload is malformed');
  return { fingerprint: v.fingerprint, keyEnc: v.keyEnc };
}

interface StoredKey {
  fingerprint: string;
  armored: string;
}

async function storedKeys(deps: Deps, accountId: string): Promise<StoredKey[]> {
  const { rows } = await deps.db.query<{ fingerprint: string; armored_enc: Buffer }>(
    'select fingerprint, armored_enc from pgp_keys where account_id = $1 order by created_at, id',
    [accountId],
  );
  return rows.map((r) => ({ fingerprint: r.fingerprint, armored: openKey(deps.config, r.armored_enc, r.fingerprint) }));
}

/**
 * The stored keys `inspectPublicKey` accepts now. None usable → 400 `key-revoked` when every key
 * is revoked, else 400 `key-expired`; never a date, fingerprint or `detail` (P2-C3).
 */
async function usableKeys(keys: StoredKey[], now: Date): Promise<StoredKey[]> {
  const checked = await Promise.all(keys.map(async (k) => ({ k, r: await inspectPublicKey(k.armored, now) })));
  const usable = checked.filter((c) => c.r.ok).map((c) => c.k);
  if (usable.length > 0) return usable;
  const allRevoked = checked.length > 0 && checked.every((c) => !c.r.ok && c.r.reason === 'key-revoked');
  throw new ApiError(400, allRevoked ? 'key-revoked' : 'key-expired');
}

// ---------------------------------------------------------------------------------------------
// Challenges

/** A login code lives 5 minutes; at exactly 5:00 it is refused. */
export const PGP_CHALLENGE_TTL_MS = 5 * 60_000;
/** Routes that carry a public key take bodies up to 64 KiB, so a 32 KiB+ key reaches `key-too-large`. */
export const PGP_BODY_LIMIT = 64 * 1024;
/** Login `start` (P2-I3, per device since the FU-A re-review): at most 5 per key and device in 5 minutes. */
const START_WINDOW_MS = 5 * 60_000;
const STARTS_PER_DEVICE = 5;

type Purpose = 'register' | 'login' | 'confirm' | 'add-key';

export interface IssuedChallenge {
  challengeId: string;
  encryptedMessage: string;
  expiresAt: string;
}

const codeHash = (normalized: string): Buffer => createHash('sha256').update(normalized, 'utf8').digest();

/**
 * Encrypts to every key it can (R15): when `encryptChallenge` throws for the set, each key is tried
 * alone and the ones that fail are left out (never falling back to a weaker subkey). No key left →
 * 400 `key-expired`, the same wording as an expired key.
 */
async function encryptToUsable(
  deps: Deps,
  text: string,
  keys: StoredKey[],
  now: Date,
): Promise<{ message: string; fingerprints: string[] }> {
  const signer = deps.pgpSigner.key;
  try {
    return { message: await encryptChallenge(text, keys.map((k) => k.armored), signer, now), fingerprints: keys.map((k) => k.fingerprint) };
  } catch {
    const ok: StoredKey[] = [];
    for (const k of keys) {
      try {
        await encryptChallenge(text, [k.armored], signer, now);
        ok.push(k);
      } catch {
        // Not usable now (e.g. its only strong encryption subkey has expired).
      }
    }
    if (ok.length === 0) throw new ApiError(400, 'key-expired');
    return { message: await encryptChallenge(text, ok.map((k) => k.armored), signer, now), fingerprints: ok.map((k) => k.fingerprint) };
  }
}

/** Stores a challenge; its payload also records the checked Origin's host, which `finish` must match (M1). */
async function insertChallenge(
  db: Queryable,
  req: FastifyRequest,
  a: { accountId: string | null; sessionId: string | null; purpose: Purpose; code: string; payload: object; now: Date },
): Promise<string> {
  const expiresAt = new Date(a.now.getTime() + PGP_CHALLENGE_TTL_MS);
  const payload = { ...a.payload, originHost: requestOrigin(req).host };
  const { rows } = await db.query<{ id: string }>(
    `insert into challenges (account_id, session_id, device_hash, purpose, method, secret_hash, payload, created_at, expires_at)
     values ($1, $2, $3, $4, 'pgp', $5, $6, $7, $8) returning id`,
    [a.accountId, a.sessionId, deviceHash(req), a.purpose, codeHash(normalizeLoginCode(a.code)!), JSON.stringify(payload), a.now, expiresAt],
  );
  return rows[0]!.id;
}

function messageText(deps: Deps, req: FastifyRequest, code: string, purpose: string, now: Date): string {
  return challengeText({
    code,
    siteName: deps.config.siteName,
    siteHost: requestOrigin(req).host,
    issuedAt: now,
    expiresAt: new Date(now.getTime() + PGP_CHALLENGE_TTL_MS),
    purpose,
  });
}

/**
 * Stores a login challenge, real or decoy, by exactly the same rules, so that what happens to an
 * earlier challenge never tells a known key from an unknown one (security review of FU-A). In one
 * transaction, serialised per key by an advisory lock on `payload.startTag` (the key's start tag),
 * the start limit is checked (`assertStartAllowed`; inside the lock, so a parallel burst from one
 * device gets exactly 5), then a new start marks the same key's earlier unused login challenges
 * from the same device as used. That is the open-challenge cap, per (start tag, device hash): one
 * open challenge per key and device, so another browser (made-up cookies included) can never push
 * out this device's challenge.
 */
async function storeLoginChallenge(
  deps: Deps,
  req: FastifyRequest,
  row: { accountId: string | null; sessionId: string | null; purpose: Purpose; code: string; payload: Record<string, unknown>; now: Date },
): Promise<string> {
  const tag = row.payload.startTag;
  if (typeof tag !== 'string') throw new Error('login challenge without a start tag');
  const client = await deps.db.connect();
  try {
    await client.query('begin');
    try {
      await client.query("select pg_advisory_xact_lock(hashtextextended('x2f-pgp-login/' || $1, 0))", [tag]);
      await assertStartAllowed(client, tag, deviceHash(req)!, row.now);
      await client.query(
        `update challenges set used_at = $3
          where purpose = 'login' and payload->>'startTag' = $1 and device_hash is not distinct from $2 and used_at is null`,
        [tag, deviceHash(req), row.now],
      );
      const id = await insertChallenge(client, req, row);
      await client.query('commit');
      return id;
    } catch (e) {
      await client.query('rollback');
      throw e;
    }
  } finally {
    client.release();
  }
}

/**
 * Issues a signed PGP challenge to `armoredKeys` (register, confirm, add-key; login uses
 * `issueLoginChallenge`). `siteHost` is the host of the checked Origin. Stores the SHA-256 of the
 * normalized code, the request's device hash (null when the browser sent no device cookie), and
 * `payload` plus the fingerprints the message went to.
 */
export async function issuePgpChallenge(
  deps: Deps,
  req: FastifyRequest,
  a: {
    accountId: string | null;
    sessionId: string | null;
    purpose: Exclude<Purpose, 'login'>;
    purposeText: string;
    armoredKeys: string[];
    payload: object;
  },
): Promise<IssuedChallenge> {
  const now = deps.clock();
  const code = newLoginCode();
  const keys = await Promise.all(
    a.armoredKeys.map(async (armored) => ({ armored, fingerprint: (await openpgp.readKey({ armoredKey: armored })).getFingerprint() })),
  );
  const { message, fingerprints } = await encryptToUsable(deps, messageText(deps, req, code, a.purposeText, now), keys, now);

  const row = { accountId: a.accountId, sessionId: a.sessionId, purpose: a.purpose, code, payload: { ...a.payload, fingerprints }, now };
  const id = await insertChallenge(deps.db, req, row);
  return { challengeId: id, encryptedMessage: message, expiresAt: new Date(now.getTime() + PGP_CHALLENGE_TTL_MS).toISOString() };
}

/**
 * A login challenge, real or decoy, made by one code path (M-1, M-2): a real code, encrypted
 * (wildcard, signed) to the very key the person pasted, so the message depends on that key alone
 * and even someone holding a keyserver copy learns nothing about whether it is registered. A decoy
 * is stored with `account_id = null` and `payload.decoy`, so `finish` fails exactly like a wrong
 * code. A pasted key that cannot be encrypted to → 400 `key-expired`, on both paths alike.
 */
async function issueLoginChallenge(
  deps: Deps,
  req: FastifyRequest,
  a: { accountId: string | null; toKey: string; payload: Record<string, unknown> },
): Promise<IssuedChallenge> {
  const now = deps.clock();
  const code = newLoginCode();
  let message: string;
  try {
    message = await encryptChallenge(messageText(deps, req, code, PGP_PURPOSE.login, now), [a.toKey], deps.pgpSigner.key, now);
  } catch {
    throw new ApiError(400, 'key-expired');
  }
  const id = await storeLoginChallenge(deps, req, { accountId: a.accountId, sessionId: null, purpose: 'login', code, payload: a.payload, now });
  return { challengeId: id, encryptedMessage: message, expiresAt: new Date(now.getTime() + PGP_CHALLENGE_TTL_MS).toISOString() };
}

/** A decoy login challenge (an unknown key, or one that cannot get a real challenge) to `toKey`. */
export function decoyPgpChallenge(
  deps: Deps,
  req: FastifyRequest,
  a: { toKey: string; payload: { startTag: string } },
): Promise<IssuedChallenge> {
  return issueLoginChallenge(deps, req, { accountId: null, toKey: a.toKey, payload: { ...a.payload, decoy: true } });
}

/**
 * Uses up a challenge and checks its code. Purpose, account, session and the Origin's host must
 * match the row, and
 * for `confirm` and `add-key` the row's session must still be live (else 400 `challenge-expired`);
 * unknown, used or expired → 400 `challenge-expired`; a wrong code (or any decoy) → 401
 * `code-invalid`, and the challenge stays used. Codes are compared in constant time. Not throttled.
 *
 * Login (I-2a of the FU-A re-review): every refusal is 401 `code-invalid`, the wrong-code answer,
 * so a used, superseded or evicted challenge looks exactly like a wrong code; only a challenge that
 * ran out of time unused says `challenge-expired` (its expiry is a fixed 5 minutes, which tells
 * nobody anything). Telling the two apart costs a used or superseded finish one extra query
 * (`expiredUnused`). That is no oracle today, because only the same device can supersede its own
 * challenge; revisit it if cross-device eviction ever returns.
 */
export async function checkPgpCode(
  deps: Deps,
  req: FastifyRequest,
  challengeId: string,
  code: string,
  expected: { purpose: Purpose; accountId?: string; sessionId?: string },
): Promise<ChallengeRow> {
  const now = deps.clock();
  const row = await consumeChallenge(deps.db, challengeId, now);
  const login = expected.purpose === 'login';
  const timedOut = login && !row ? await expiredUnused(deps.db, challengeId, now) : false;
  const expired = () => (login && !timedOut ? new ApiError(401, 'code-invalid') : new ApiError(400, 'challenge-expired'));
  if (!row || row.method !== 'pgp' || row.purpose !== expected.purpose) throw expired();
  if (row.payload.originHost !== requestOrigin(req).host) throw expired();
  if (expected.accountId !== undefined && row.account_id !== expected.accountId) throw expired();
  if (expected.sessionId !== undefined && row.session_id !== expected.sessionId) throw expired();
  if (expected.purpose === 'confirm' || expected.purpose === 'add-key') {
    const live = await deps.db.query('select 1 from sessions where id = $1 and revoked_at is null and expires_at > $2', [row.session_id, now]);
    if (live.rows.length === 0) throw expired();
  }
  const normalized = normalizeLoginCode(code);
  const given = codeHash(normalized ?? '');
  const matches = row.secret_hash !== null && row.secret_hash.length === given.length && timingSafeEqual(given, row.secret_hash);
  if (normalized === null || !matches || row.payload.decoy === true) throw new ApiError(401, 'code-invalid');
  return row;
}

/** True for a login challenge that ran out of time without being used (or superseded, or evicted). */
async function expiredUnused(db: Queryable, challengeId: string, now: Date): Promise<boolean> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(challengeId)) return false;
  const { rows } = await db.query(
    `select 1 from challenges where id = $1 and purpose = 'login' and method = 'pgp' and used_at is null and expires_at <= $2`,
    [challengeId, now],
  );
  return rows.length > 0;
}

// ---------------------------------------------------------------------------------------------
// Request helpers

function body(req: FastifyRequest): Record<string, unknown> {
  const b = req.body;
  if (b === null || typeof b !== 'object' || Array.isArray(b)) throw new ApiError(400, 'bad-request');
  return b as Record<string, unknown>;
}

function str(b: Record<string, unknown>, key: string): string {
  const v = b[key];
  if (typeof v !== 'string') throw new ApiError(400, 'bad-request');
  return v;
}

function optStr(b: Record<string, unknown>, key: string): string | undefined {
  const v = b[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'string') throw new ApiError(400, 'bad-request');
  return v;
}

/** 400 with the refusal and its plain-sentence `detail` (only ever about the key the person pasted). */
async function inspectOrRefuse(armored: string, now: Date): Promise<Extract<KeyInspection, { ok: true }>> {
  const r = await inspectPublicKey(armored, now);
  if (!r.ok) throw new ApiError(400, r.reason, { detail: r.detail });
  return r;
}

const fingerprintsOf = (row: ChallengeRow): string[] => {
  const f = row.payload.fingerprints;
  return Array.isArray(f) && f.every((x) => typeof x === 'string') ? (f as string[]) : [];
};

// ---------------------------------------------------------------------------------------------
// Login (`pgpLoginRoutes`)

/** A tag for the start limit, so it applies to every key fingerprint (known or not) alike. */
function startTag(config: Config, fingerprint: string): string {
  return createHmac('sha256', subkey(config, 'pgp-start')).update(`pgp-login-key/${fingerprint}`).digest('hex');
}

/**
 * P2-I3 (per key and device since the FU-A re-review, I-2b). Public keys are often public (on
 * keyservers, personal sites and elsewhere), so assume a stranger has the key and can start logins
 * with it. More than 5 starts per key and device (`device`, the hash of the device cookie the
 * challenge is bound to) in 5 minutes → 429 `slow-down` (never `locked`), so a stranger filling
 * their own bucket changes nothing for anyone else's browser, and the Retry-After only ever speaks
 * of this device's own starts. There is no per-key limit across devices: any such count would tell
 * a stranger that someone else is logging in with the key (and when), and a cookie-dropping script
 * could use it to lock out Tor and private-window users. Real and decoy challenges count alike, so
 * the limit does not tell a known key from an unknown one. Residual: a cookie-dropping script can
 * make unlimited starts per key, bounded only by the global start budget (per-source limits are
 * Plan 6). Runs inside `storeLoginChallenge`'s per-key lock.
 */
async function assertStartAllowed(db: Queryable, tag: string, device: Buffer, now: Date): Promise<void> {
  const since = new Date(now.getTime() - START_WINDOW_MS);
  const { rows } = await db.query<{ n: number; oldest: Date | null }>(
    `select count(*)::int as n, min(created_at) as oldest from challenges
      where purpose = 'login' and method = 'pgp' and payload->>'startTag' = $1 and device_hash = $2 and created_at > $3`,
    [tag, device, since],
  );
  const { n, oldest } = rows[0]!;
  if (n >= STARTS_PER_DEVICE && oldest) {
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest.getTime() + START_WINDOW_MS - now.getTime()) / 1000));
    throw new ApiError(429, 'slow-down', { retryAfterSeconds });
  }
}

/**
 * The open `second-factor` challenge a staff or owner login's second step names (`completeLogin`
 * creates them): same account, same device, unused, unexpired. Read, not consumed;
 * `completeLogin` consumes it at `finish`. Null for anything else.
 */
async function pendingFirstFactor(deps: Deps, pendingId: string, accountId: string, device: Buffer | null, now: Date) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pendingId) || device === null) return null;
  const { rows } = await deps.db.query<{ payload: Record<string, unknown> }>(
    `select payload from challenges
      where id = $1 and purpose = 'second-factor' and method = 'pair' and account_id = $2 and device_hash = $3 and used_at is null and expires_at > $4`,
    [pendingId, accountId, device, now],
  );
  return rows[0]?.payload ?? null;
}

/** Fingerprints a pending first factor used (left out of the second challenge). */
function usedFingerprints(payload: Record<string, unknown>): string[] {
  const first = payload.first as { method?: unknown; fingerprint?: unknown; fingerprints?: unknown } | undefined;
  if (!first || first.method !== 'pgp') return [];
  const list = Array.isArray(first.fingerprints) ? first.fingerprints.filter((f): f is string => typeof f === 'string') : [];
  if (typeof first.fingerprint === 'string') list.push(first.fingerprint);
  return list;
}

export interface PgpLoginOptions {
  kinds: AccountKind[];
  afterAuthenticate?: (accountId: string) => Promise<void>;
}

/**
 * Registers `POST start` and `POST finish` for PGP login under the plugin's prefix. `buildApi`
 * mounts it at `/v1/login/pgp` for every kind; Plan 4 mounts it on the staff app. `start` takes
 * `{ key, pendingId? }`: `key` is the person's whole armored public key (`loginStart`). A key whose
 * account's kind is not in `kinds` is treated as an unknown key (decoy). Both finish through
 * `completeLogin`.
 */
export function pgpLoginRoutes(app: FastifyInstance, opts: PgpLoginOptions): void {
  app.post('/start', { bodyLimit: PGP_BODY_LIMIT }, async (req, reply) => {
    const deps = req.server.deps;
    // Every answer, refusals included, gives the browser a device cookie (`loginStart` sets it before
    // binding the challenge).
    try {
      req.server.budgets.start.take();
      return await loginStart(deps, req, reply, opts);
    } finally {
      ensureDeviceCookie(req, reply);
    }
  });

  app.post('/finish', async (req, reply) => {
    const deps = req.server.deps;
    ensureDeviceCookie(req, reply);
    const b = body(req);
    // F1: a login that has started can always finish, whatever the start budget says.
    await takeStartBudgetUnlessOpen(req, b.challengeId, { purpose: 'login', methods: ['pgp'] });
    const challengeId = str(b, 'challengeId');
    const code = str(b, 'code');
    const deviceLabel = str(b, 'deviceLabel');
    const pendingId = optStr(b, 'pendingId');
    const row = await checkPgpCode(deps, req, challengeId, code, { purpose: 'login' });
    // M6: the second step of a staff or owner login is bound to the pendingId it was started with.
    const boundPending = typeof row.payload.pendingId === 'string' ? row.payload.pendingId : undefined;
    if (pendingId !== undefined && pendingId !== boundPending) throw new ApiError(400, 'challenge-expired');
    const { rows } = await deps.db.query<{ id: string; kind: AccountKind }>('select id, kind from accounts where id = $1', [row.account_id]);
    const account = rows[0];
    // A challenge from a mount for other kinds proves nothing here.
    if (!account || !opts.kinds.includes(account.kind)) throw new ApiError(401, 'code-invalid');
    const fingerprints = fingerprintsOf(row);
    // M4: the code proved the key, so the refreshed (merged) armor and last use are stored before
    // the session starts; a session never exists without them.
    const now = deps.clock();
    if (row.payload.refreshed !== undefined) {
      const refreshed = readPendingKey(row.payload, 'refreshed');
      await deps.db.query('update pgp_keys set armored_enc = $3 where account_id = $1 and fingerprint = $2', [
        account.id, refreshed.fingerprint, Buffer.from(refreshed.keyEnc, 'base64'),
      ]);
    }
    if (fingerprints.length === 1) {
      await deps.db.query('update pgp_keys set last_used_at = $3 where account_id = $1 and fingerprint = $2', [account.id, fingerprints[0], now]);
    }
    const result: LoginResult = await completeLogin(deps, req, reply, {
      account,
      factor: { method: 'pgp', fingerprint: fingerprints[0] ?? '', fingerprints },
      deviceLabel,
      ...(boundPending !== undefined ? { pendingId: boundPending } : {}),
      ...(opts.afterAuthenticate ? { afterAuthenticate: opts.afterAuthenticate } : {}),
    });
    return result;
  });
}

/**
 * PGP login (owner, 2026-10-23; security review of FU-A and its re-review): `start { key, pendingId? }`
 * takes the person's whole armored public key, never a fingerprint or a name. The pasted key is
 * checked by `inspectPublicKey` before any account lookup, so its refusals (unreadable, private,
 * weak, expired, revoked...) depend only on the key itself and say nothing about accounts. From then
 * on a known key and an unknown key take the same steps, with the same queries (I-1) and the same
 * PGP work (M-1): sealing and opening a copy, merging
 * the pasted key into the stored copy (an unknown key merges into itself), inspecting and sealing
 * the result, checking the recipient subkey, and one challenge encrypted to the pasted key alone
 * (M-2). A known key that cannot get a real challenge (the stored copy is revoked or no longer
 * usable, the pasted key's recipient subkey is not valid in the stored copy, the account's kind is
 * not served here, or a pending second step does not match) gets a decoy, exactly as an unknown key.
 */
async function loginStart(deps: Deps, req: FastifyRequest, reply: FastifyReply, opts: PgpLoginOptions): Promise<IssuedChallenge> {
  const now = deps.clock();
  const b = body(req);
  const pasted = str(b, 'key');
  const pendingId = optStr(b, 'pendingId');
  if (!pasted.includes('-----BEGIN PGP')) {
    throw new ApiError(400, 'key-unreadable', { detail: 'Paste your whole public key, from -----BEGIN PGP PUBLIC KEY BLOCK----- to the end.' });
  }
  const { fingerprint } = await inspectOrRefuse(pasted, now);

  const device = deviceHash(req); // the cookie this browser *sent*: null when it sent none
  // From here on the browser has a device cookie, so the challenge is bound to the device that will
  // finish it, and the per-device start limit counts that device.
  ensureDeviceCookie(req, reply);
  const { rows } = await deps.db.query<{ id: string; kind: AccountKind; armored_enc: Buffer }>(
    'select a.id, a.kind, k.armored_enc from pgp_keys k join accounts a on a.id = k.account_id where k.fingerprint = $1',
    [fingerprint],
  );
  const found = rows[0];
  const account = found && opts.kinds.includes(found.kind) ? found : undefined;
  // The start limit is per key and device (I-2b), so no trusted-device lookup is needed here (I1).
  const startPayload = { startTag: startTag(deps.config, fingerprint) };

  // M-1: the same work for a known and an unknown key. Seal the pasted key and open a sealed copy
  // (the stored one for a known key, the one just sealed for an unknown key), merge the pasted key
  // into it, inspect the result, check the recipient subkey, and seal the result for `finish`.
  const sealedPasted = sealKey(deps.config, pasted, fingerprint);
  const stored = openKey(deps.config, account ? account.armored_enc : sealedPasted, fingerprint);
  // I2: merge into the stored copy (openpgp `Key.update`), never replace it, so an old public copy
  // cannot drop a revocation or a newer self-signature the server already has.
  const merged = await mergeKeys(stored, pasted, now);
  const mergedOk = (await inspectPublicKey(merged.armored, now)).ok;
  // M-2: the challenge goes to the subkey the *pasted* key picks; it must still be valid in the
  // merged copy, else the decoy (also to the pasted key, so the message looks the same).
  const recipientOk = await pastedRecipientStillValid(merged.pasted, merged.key, now);
  const { pending } = await pendingKey(deps.config, merged.armored, fingerprint, now);
  // The pending-step lookup runs whenever a pendingId is given, known key or not.
  const pendingRow = pendingId !== undefined ? await pendingFirstFactor(deps, pendingId, account?.id ?? NIL_UUID, device, now) : undefined;
  // The second step of a staff or owner login: this key's account's own pending login, from this
  // device, with a key other than the first step's.
  const pendingOk = pendingRow === undefined || (pendingRow !== null && !usedFingerprints(pendingRow).includes(fingerprint));

  if (!account || !mergedOk || !recipientOk || !pendingOk) return decoyPgpChallenge(deps, req, { toKey: pasted, payload: startPayload });
  const payload: Record<string, unknown> = { ...startPayload, refreshed: pending, fingerprints: [fingerprint] };
  if (pendingId !== undefined) payload.pendingId = pendingId;
  // Always to exactly the one key the person pasted, so a code proves that key (staff pairs compare
  // key sets, and the second step's key must differ from the first's).
  return issueLoginChallenge(deps, req, { accountId: account.id, toKey: pasted, payload });
}

/** The stored key updated with the packets of a newer copy of the same key (same fingerprint). */
async function mergeKeys(storedArmored: string, refreshedArmored: string, now: Date): Promise<{ armored: string; key: openpgp.Key; pasted: openpgp.Key }> {
  const base = await openpgp.readKey({ armoredKey: storedArmored });
  const source = await openpgp.readKey({ armoredKey: refreshedArmored });
  const merged = await base.update(source, now);
  return { armored: merged.armor(ARMOR_CONFIG), key: merged, pasted: source };
}

// ---------------------------------------------------------------------------------------------
// Register, confirm and add-key routes

async function registerStart(req: FastifyRequest, reply: FastifyReply) {
  const deps = req.server.deps;
  ensureDeviceCookie(req, reply);
  req.server.budgets.start.take();
  const now = deps.clock();
  const b = body(req);
  const names = await assertNewNames(deps.db, b.displayName, b.loginName);
  const publicKey = str(b, 'publicKey');
  const inspection = await inspectOrRefuse(publicKey, now);
  await assertDisplayNameFree(deps.db, names);
  // Fingerprint clashes are not checked here: only `finish`, after the code proves the key, says key-in-use.
  const { storable, pending } = await pendingKey(deps.config, publicKey, inspection.fingerprint, now);
  const issued = await issuePgpChallenge(deps, req, {
    accountId: null, sessionId: null, purpose: 'register', purposeText: PGP_PURPOSE.register,
    armoredKeys: [storable], payload: { names, key: pending },
  });
  return { ...issued, fingerprint: inspection.fingerprint };
}

async function registerFinish(req: FastifyRequest, reply: FastifyReply) {
  const deps = req.server.deps;
  ensureDeviceCookie(req, reply);
  req.server.budgets.register.take();
  const b = body(req);
  const terms = assertTermsAccepted(deps, b.acceptedTerms);
  const challengeId = str(b, 'challengeId');
  const code = str(b, 'code');
  const deviceLabel = str(b, 'deviceLabel');
  const row = await checkPgpCode(deps, req, challengeId, code, { purpose: 'register' });
  const { names } = row.payload as { names: NewNames };
  const pending = readPendingKey(row.payload, 'key');
  const armored = openKey(deps.config, Buffer.from(pending.keyEnc, 'base64'), pending.fingerprint);

  const now = deps.clock();
  const client = await deps.db.connect();
  let accountId: string;
  try {
    await client.query('begin');
    try {
      accountId = await createAccount(client, { ...names, kind: 'trader', termsVersion: terms, now });
      await insertPgpKey(client, deps.config, { accountId, fingerprint: pending.fingerprint, armored, now });
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    }
  } finally {
    client.release();
  }
  await startSession(deps, req, reply, { accountId, level: 'full', deviceLabel, method: 'pgp', firstSession: true });
  return reply.code(201).send({ displayName: names.displayName });
}

async function confirmStart(req: FastifyRequest) {
  const deps = req.server.deps;
  const action: ConfirmAction = parseConfirmAction(body(req).action);
  const stored = await storedKeys(deps, req.auth.accountId);
  if (stored.length === 0) throw new ApiError(403, 'method-not-allowed');
  const keys = await usableKeys(stored, deps.clock());
  return issuePgpChallenge(deps, req, {
    accountId: req.auth.accountId, sessionId: req.auth.sessionId, purpose: 'confirm', purposeText: describeAction(action),
    armoredKeys: keys.map((k) => k.armored), payload: { actionHash: await actionHash(action), action },
  });
}

async function confirmFinish(req: FastifyRequest) {
  const deps = req.server.deps;
  const b = body(req);
  const row = await checkPgpCode(deps, req, str(b, 'challengeId'), str(b, 'code'), {
    purpose: 'confirm', accountId: req.auth.accountId, sessionId: req.auth.sessionId,
  });
  const action = parseConfirmAction(row.payload.action);
  if ((await actionHash(action)) !== row.payload.actionHash) throw new ApiError(400, 'challenge-expired');
  const confirmToken = await issueConfirmToken(deps, { sessionId: req.auth.sessionId, accountId: req.auth.accountId, action });
  return { confirmToken };
}

const inspected = new WeakMap<FastifyRequest, { armored: string; fingerprint: string }>();

/**
 * Checks the pasted key before `requireConfirm`, so a refused key never uses up a confirm token
 * (as R17 asks of the wallet route).
 */
const inspectNewKey: preHandlerAsyncHookHandler = async function (req) {
  const armored = str(body(req), 'publicKey');
  const r = await inspectOrRefuse(armored, req.server.deps.clock());
  inspected.set(req, { armored, fingerprint: r.fingerprint });
};

async function addKeyStart(req: FastifyRequest) {
  const deps = req.server.deps;
  const key = inspected.get(req);
  if (!key) throw new ApiError(400, 'bad-request');
  const { storable, pending } = await pendingKey(deps.config, key.armored, key.fingerprint, deps.clock());
  return issuePgpChallenge(deps, req, {
    accountId: req.auth.accountId, sessionId: req.auth.sessionId, purpose: 'add-key', purposeText: PGP_PURPOSE['add-key'],
    armoredKeys: [storable], payload: { key: pending },
  });
}

async function addKeyFinish(req: FastifyRequest) {
  const deps = req.server.deps;
  const b = body(req);
  const row = await checkPgpCode(deps, req, str(b, 'challengeId'), str(b, 'code'), {
    purpose: 'add-key', accountId: req.auth.accountId, sessionId: req.auth.sessionId,
  });
  const pending = readPendingKey(row.payload, 'key');
  const armored = openKey(deps.config, Buffer.from(pending.keyEnc, 'base64'), pending.fingerprint);
  const now = deps.clock();
  const client = await deps.db.connect();
  try {
    await client.query('begin');
    try {
      await insertPgpKey(client, deps.config, { accountId: req.auth.accountId, fingerprint: pending.fingerprint, armored, now });
      await addAlert(client, req.auth.accountId, 'login-method-added', { method: 'pgp', fingerprint: pending.fingerprint }, now);
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    }
  } finally {
    client.release();
  }
  return { fingerprint: pending.fingerprint };
}

/**
 * Every PGP route: `GET /v1/pgp/signing-key`, register, login (mounted at `/v1/login/pgp` for all
 * kinds), confirm, and adding a key to the account.
 */
export async function pgpRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/pgp/signing-key', async (req) => ({
    fingerprint: req.server.deps.pgpSigner.fingerprint,
    publicKey: req.server.deps.pgpSigner.publicArmored,
  }));

  app.post('/v1/register/pgp/start', { bodyLimit: PGP_BODY_LIMIT }, registerStart);
  app.post('/v1/register/pgp/finish', registerFinish);

  await app.register(async (sub) => pgpLoginRoutes(sub, { kinds: ['trader', 'staff', 'owner'] }), { prefix: '/v1/login/pgp' });

  app.post('/v1/confirm/pgp/start', { preHandler: requireSession() }, confirmStart);
  app.post('/v1/confirm/pgp/finish', { preHandler: requireSession() }, confirmFinish);

  app.post(
    '/v1/account/pgp/start',
    {
      bodyLimit: PGP_BODY_LIMIT,
      preHandler: [
        requireSession({ allowRecovery: true }),
        methodAllowed('pgp'),
        inspectNewKey,
        requireConfirm({ kind: 'add-method', method: 'pgp' }, { onboarding: true, recovery: true }),
      ],
    },
    addKeyStart,
  );
  app.post('/v1/account/pgp/finish', { preHandler: [requireSession({ allowRecovery: true }), methodAllowed('pgp')] }, addKeyFinish);
}
