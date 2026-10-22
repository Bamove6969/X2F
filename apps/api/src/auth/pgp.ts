/**
 * PGP sign-up, login, confirm and adding a key (Task 7).
 *
 * - Every challenge is encrypted with wildcard recipients (zero key IDs) and signed with the
 *   official X2F key (R7); unknown usernames get a decoy of the same shape (P2-C3).
 * - Keys are stored only as `armored_enc` (AES-256-GCM under `subkey('pgp-key')`), with user IDs
 *   stripped where the key survives it (R16). No route returns, and no log line holds, a user ID.
 * - No endpoint generates, accepts or returns a private PGP key of a user (R8).
 * - PGP codes are not throttled per guess (60-bit, single-use); only login `start` is limited.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  PGP_PURPOSE, actionHash, challengeText, checkUsername, describeAction, encryptChallenge, inspectPublicKey,
  newLoginCode, normalizeLoginCode, type AccountKind, type ConfirmAction, type KeyInspection,
} from '@x2f/accounts';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import * as openpgp from 'openpgp';
import type { Deps } from '../app.js';
import { addAlert } from '../alerts.js';
import { assertTermsAccepted, assertUsername, createAccount } from '../accounts.js';
import { subkey, type Config } from '../config.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { parseConfirmAction } from './actionInput.js';
import { consumeChallenge, type ChallengeRow } from './challenges.js';
import { issueConfirmToken, requireConfirm } from './confirm.js';
import { deviceHash, ensureDeviceCookie, isTrusted } from './device.js';
import { completeLogin, type LoginResult } from './login.js';
import { methodAllowed } from './methods.js';
import { requestOrigin } from './origin.js';
import { requireSession, startSession } from './sessions.js';

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
/** Login `start` (P2-I3): at most 5 per account (username) and device in 5 minutes; at most 3 open per account. */
const START_WINDOW_MS = 5 * 60_000;
const STARTS_PER_WINDOW = 5;
const OPEN_LOGIN_CHALLENGES = 3;

type Purpose = 'register' | 'login' | 'confirm' | 'add-key';

export interface IssuedChallenge {
  challengeId: string;
  encryptedMessage: string;
  expiresAt: string;
}

const codeHash = (normalized: string): Buffer => createHash('sha256').update(normalized, 'utf8').digest();

/**
 * Encrypts to every key it can (R15): when `encryptChallenge` throws for the set, each key is tried
 * alone and the ones that fail are left out (never falling back to a weaker subkey). With `single`,
 * to the first key (in the given order) it can encrypt to, and only that one. No key left → 400
 * `key-expired`, the same wording as an expired key.
 */
async function encryptToUsable(
  deps: Deps,
  text: string,
  keys: StoredKey[],
  now: Date,
  single = false,
): Promise<{ message: string; fingerprints: string[] }> {
  const signer = deps.pgpSigner.key;
  if (single) {
    for (const k of keys) {
      try {
        return { message: await encryptChallenge(text, [k.armored], signer, now), fingerprints: [k.fingerprint] };
      } catch {
        // Not usable now; try the next one.
      }
    }
    throw new ApiError(400, 'key-expired');
  }
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
 * Issues a signed PGP challenge to `armoredKeys`. `siteHost` is the host of the checked Origin.
 * Stores the SHA-256 of the normalized code, the request's device hash (null when the browser sent
 * no device cookie), and `payload` plus the fingerprints the message went to. Login challenges
 * (one transaction, the account row locked): a new one marks earlier unused login challenges of the
 * same account and the same device as used; and at most 3 challenges from untrusted browsers
 * (`payload.startGroup = 'anon'`) stay open per account, the oldest marked used. A challenge from a
 * device trusted for the account is never counted or evicted by that cap, so made-up cookies cannot
 * push it out; only that device's next start replaces it (I1). The 5-per-5-minutes start limit is
 * checked by the route (`assertStartAllowed`).
 */
export async function issuePgpChallenge(
  deps: Deps,
  req: FastifyRequest,
  a: {
    accountId: string | null;
    sessionId: string | null;
    purpose: Purpose;
    purposeText: string;
    armoredKeys: string[];
    payload: object;
    /** Encrypt to one key only: the first of `armoredKeys` that can be encrypted to (a staff member's first PGP step). */
    single?: boolean;
  },
): Promise<IssuedChallenge> {
  const now = deps.clock();
  const code = newLoginCode();
  const keys = await Promise.all(
    a.armoredKeys.map(async (armored) => ({ armored, fingerprint: (await openpgp.readKey({ armoredKey: armored })).getFingerprint() })),
  );
  const { message, fingerprints } = await encryptToUsable(deps, messageText(deps, req, code, a.purposeText, now), keys, now, a.single === true);

  const row = { accountId: a.accountId, sessionId: a.sessionId, purpose: a.purpose, code, payload: { ...a.payload, fingerprints }, now };
  let id: string;
  if (a.purpose === 'login' && a.accountId !== null) {
    const client = await deps.db.connect();
    try {
      await client.query('begin');
      try {
        await client.query('select 1 from accounts where id = $1 for update', [a.accountId]);
        await client.query(
          `update challenges set used_at = $3
            where purpose = 'login' and account_id = $1 and device_hash is not distinct from $2 and used_at is null`,
          [a.accountId, deviceHash(req), now],
        );
        id = await insertChallenge(client, req, row);
        await client.query(
          `update challenges set used_at = $3 where id in (
             select id from challenges
              where purpose = 'login' and account_id = $1 and used_at is null and expires_at > $3
                and payload->>'startGroup' = 'anon'
              order by (id = $2) desc, created_at desc, id offset $4)`,
          [a.accountId, id, now, OPEN_LOGIN_CHALLENGES],
        );
        await client.query('commit');
      } catch (e) {
        await client.query('rollback');
        throw e;
      }
    } finally {
      client.release();
    }
  } else {
    id = await insertChallenge(deps.db, req, row);
  }
  return { challengeId: id, encryptedMessage: message, expiresAt: new Date(now.getTime() + PGP_CHALLENGE_TTL_MS).toISOString() };
}

let decoyPool: Promise<openpgp.PrivateKey[]> | undefined;

/**
 * The throwaway keys decoys are encrypted to (R18), generated once per process (`main.ts` warms
 * them at startup): Ed25519 v4 (×2), v6 Ed25519/X25519 (×2) and RSA-4096. Creation time is fixed
 * in the past so they are valid at any server clock. Exported for tests, which decrypt a decoy to
 * show its code never works.
 */
export function decoyPrivateKeys(): Promise<openpgp.PrivateKey[]> {
  decoyPool ??= (async () => {
    const date = new Date('2020-01-01T00:00:00Z');
    const userIDs = [{ name: 'decoy' }];
    const gen = async (o: { type: 'ecc' | 'curve25519' | 'rsa'; v6?: boolean }) =>
      (
        await openpgp.generateKey({
          ...(o.type === 'ecc' ? { type: 'ecc' as const, curve: 'ed25519Legacy' as const } : {}),
          ...(o.type === 'curve25519' ? { type: 'curve25519' as const, config: { v6Keys: true } } : {}),
          ...(o.type === 'rsa' ? { type: 'rsa' as const, rsaBits: 4096 } : {}),
          userIDs, date, format: 'object',
        })
      ).privateKey;
    return Promise.all([gen({ type: 'ecc' }), gen({ type: 'ecc' }), gen({ type: 'curve25519' }), gen({ type: 'curve25519' }), gen({ type: 'rsa' })]);
  })();
  return decoyPool;
}

/** Recipient sets a decoy may show: one or two keys of the kinds people use (indexes into the pool). */
const DECOY_PROFILES: readonly number[][] = [[0], [2], [4], [0, 1], [2, 3], [4, 0]];

/** The decoy profile of a username: fixed per name (HMAC under `subkey('decoy')`), so repeated starts look alike. */
function decoyProfile(config: Config, nameKey: string): number[] {
  const h = createHmac('sha256', subkey(config, 'decoy')).update(`pgp-decoy/${nameKey}`).digest();
  return DECOY_PROFILES[h.readUInt32BE(0) % DECOY_PROFILES.length]!;
}

/**
 * A challenge of the same shape for an unknown username (or one that cannot get a real one): a real
 * code, encrypted (wildcard, signed) and stored with `account_id = null`, so `finish` fails exactly
 * like a wrong code. The recipients are `toKey` when the request sent a `refreshedKey` (so a
 * keyserver key tells the sender nothing: they get a message to that key either way), otherwise
 * the name's fixed decoy profile (R18). `payload` joins the stored payload (start-limit tags).
 */
export async function decoyPgpChallenge(
  deps: Deps,
  req: FastifyRequest,
  a: { nameKey: string; toKey?: string; payload?: object },
): Promise<IssuedChallenge> {
  const now = deps.clock();
  const code = newLoginCode();
  const pool = await decoyPrivateKeys();
  const recipients = a.toKey !== undefined ? [a.toKey] : decoyProfile(deps.config, a.nameKey).map((i) => pool[i]!.toPublic().armor());
  let message: string;
  try {
    message = await encryptChallenge(messageText(deps, req, code, PGP_PURPOSE.login, now), recipients, deps.pgpSigner.key, now);
  } catch {
    throw new ApiError(400, 'key-expired'); // as a real refreshed key that cannot be encrypted to
  }
  const id = await insertChallenge(deps.db, req, {
    accountId: null, sessionId: null, purpose: 'login', code, payload: { ...a.payload, decoy: true }, now,
  });
  return { challengeId: id, encryptedMessage: message, expiresAt: new Date(now.getTime() + PGP_CHALLENGE_TTL_MS).toISOString() };
}

/**
 * Uses up a challenge and checks its code. Purpose, account, session and the Origin's host must
 * match the row, and
 * for `confirm` and `add-key` the row's session must still be live (else 400 `challenge-expired`);
 * unknown, used or expired → 400 `challenge-expired`; a wrong code (or any decoy) → 401
 * `code-invalid`, and the challenge stays used. Codes are compared in constant time. Not throttled.
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
  const expired = () => new ApiError(400, 'challenge-expired');
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

/** A tag for the start limit, so it applies to every username (real or not) alike. */
function startTag(config: Config, nameKey: string): string {
  return createHmac('sha256', subkey(config, 'pgp-start')).update(`pgp-login-start/${nameKey}`).digest('hex');
}

/**
 * P2-I3: more than 5 login starts for one username from one group in 5 minutes → 429 `slow-down`
 * (never `locked`). A group is one device trusted for the account, or `anon`: every browser that is
 * not trusted for it (no cookie, a new cookie, or a made-up one), as Task 4's throttle keys do (I1).
 * Counted the same for unknown names (always `anon`), so it does not tell them apart.
 */
async function assertStartAllowed(deps: Deps, tag: string, group: string, now: Date): Promise<void> {
  const since = new Date(now.getTime() - START_WINDOW_MS);
  const { rows } = await deps.db.query<{ n: number; oldest: Date | null }>(
    `select count(*)::int as n, min(created_at) as oldest from challenges
      where purpose = 'login' and payload->>'startTag' = $1 and payload->>'startGroup' = $2 and created_at > $3`,
    [tag, group, since],
  );
  const { n, oldest } = rows[0]!;
  if (n >= STARTS_PER_WINDOW && oldest) {
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
      where id = $1 and purpose = 'second-factor' and account_id = $2 and device_hash = $3 and used_at is null and expires_at > $4`,
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
 * mounts it at `/v1/login/pgp` for every kind; Plan 4 mounts it on the staff app. An account whose
 * kind is not in `kinds` is treated as an unknown username (decoy). Both finish through
 * `completeLogin`.
 */
export function pgpLoginRoutes(app: FastifyInstance, opts: PgpLoginOptions): void {
  app.post('/start', { bodyLimit: PGP_BODY_LIMIT }, async (req, reply) => {
    const deps = req.server.deps;
    // The start limit groups by the device cookie the browser *sent*; a fresh one is set after.
    try {
      req.server.budgets.start.take();
      return await loginStart(deps, req, opts);
    } finally {
      ensureDeviceCookie(req, reply);
    }
  });

  app.post('/finish', async (req, reply) => {
    const deps = req.server.deps;
    ensureDeviceCookie(req, reply);
    req.server.budgets.start.take();
    const b = body(req);
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

async function loginStart(deps: Deps, req: FastifyRequest, opts: PgpLoginOptions): Promise<IssuedChallenge> {
  const now = deps.clock();
  const b = body(req);
  const rawName = str(b, 'username');
  const refreshedRaw = optStr(b, 'refreshedKey');
  const pendingId = optStr(b, 'pendingId');
  // The pasted key is checked before any account lookup, so its refusal says nothing about the name.
  const refreshed = refreshedRaw === undefined ? null : { armored: refreshedRaw, inspection: await inspectOrRefuse(refreshedRaw, now) };

  const name = checkUsername(rawName.slice(0, 64));
  const nameKey = name.ok ? name.key : rawName.slice(0, 64).toLowerCase();
  const device = deviceHash(req); // before the route sets a cookie: null for a browser that sent none
  const found = name.ok
    ? (await deps.db.query<{ id: string; kind: AccountKind }>('select id, kind from accounts where username_key = $1', [name.key])).rows[0]
    : undefined;
  const account = found && opts.kinds.includes(found.kind) ? found : undefined;
  // I1: only a device trusted for this account gets its own group; every other browser is `anon`.
  const trusted = account !== undefined && device !== null && (await isTrusted(deps, account.id, device));
  const group = trusted ? `dev:${device!.toString('hex')}` : 'anon';
  const tag = startTag(deps.config, nameKey);
  await assertStartAllowed(deps, tag, group, now);
  const startPayload = { startTag: tag, startGroup: group };
  // I3: with a refreshedKey the decoy goes to that key, so a keyserver copy cannot test the name.
  const decoy = () =>
    decoyPgpChallenge(deps, req, { nameKey, payload: startPayload, ...(refreshed ? { toKey: refreshed.armored } : {}) });

  if (!account) return decoy();

  let excluded: string[] = [];
  if (pendingId !== undefined) {
    const pending = await pendingFirstFactor(deps, pendingId, account.id, device, now);
    if (pending === null) return decoy();
    excluded = usedFingerprints(pending);
  }

  const stored = (await storedKeys(deps, account.id)).filter((k) => !excluded.includes(k.fingerprint));
  if (stored.length === 0) return decoy();

  const payload: Record<string, unknown> = { ...startPayload };
  if (pendingId !== undefined) payload.pendingId = pendingId;
  let keys: StoredKey[];
  if (refreshed) {
    const fingerprint = refreshed.inspection.fingerprint;
    const match = stored.find((k) => k.fingerprint === fingerprint);
    if (!match) return decoy();
    // I2: merge into the stored copy (openpgp `Key.update`), never replace it, so an old public copy
    // cannot drop a revocation or a newer self-signature the server already has.
    const merged = await mergeKeys(match.armored, refreshed.armored, now);
    const check = await inspectPublicKey(merged, now);
    if (!check.ok) throw new ApiError(400, check.reason === 'key-revoked' ? 'key-revoked' : 'key-expired');
    const { storable, pending } = await pendingKey(deps.config, merged, fingerprint, now);
    payload.refreshed = pending;
    keys = [{ fingerprint, armored: storable }];
  } else {
    keys = await usableKeys(stored, now);
  }
  return issuePgpChallenge(deps, req, {
    accountId: account.id, sessionId: null, purpose: 'login', purposeText: PGP_PURPOSE.login,
    armoredKeys: keys.map((k) => k.armored), payload,
    // A staff member's first PGP step goes to one key only (the oldest usable), so that a second PGP
    // step to a different key can make a pair: a code from a challenge sent to several keys proves
    // only "one of them" and would leave no key for the second step.
    single: account.kind === 'staff' && pendingId === undefined,
  });
}

/** The stored key updated with the packets of a newer copy of the same key (same fingerprint). */
async function mergeKeys(storedArmored: string, refreshedArmored: string, now: Date): Promise<string> {
  const base = await openpgp.readKey({ armoredKey: storedArmored });
  const source = await openpgp.readKey({ armoredKey: refreshedArmored });
  const merged = await base.update(source, now);
  return merged.armor(ARMOR_CONFIG);
}

// ---------------------------------------------------------------------------------------------
// Register, confirm and add-key routes

async function registerStart(req: FastifyRequest, reply: FastifyReply) {
  const deps = req.server.deps;
  ensureDeviceCookie(req, reply);
  req.server.budgets.start.take();
  const now = deps.clock();
  const b = body(req);
  const { username, key } = assertUsername(str(b, 'username'));
  const publicKey = str(b, 'publicKey');
  const inspection = await inspectOrRefuse(publicKey, now);
  const taken = await deps.db.query('select 1 from accounts where username_key = $1', [key]);
  if (taken.rows.length > 0) throw new ApiError(409, 'username-taken');
  // Fingerprint clashes are not checked here: only `finish`, after the code proves the key, says key-in-use.
  const { storable, pending } = await pendingKey(deps.config, publicKey, inspection.fingerprint, now);
  const issued = await issuePgpChallenge(deps, req, {
    accountId: null, sessionId: null, purpose: 'register', purposeText: PGP_PURPOSE.register,
    armoredKeys: [storable], payload: { username, usernameKey: key, key: pending },
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
  const { username, usernameKey } = row.payload as { username: string; usernameKey: string };
  const pending = readPendingKey(row.payload, 'key');
  const armored = openKey(deps.config, Buffer.from(pending.keyEnc, 'base64'), pending.fingerprint);

  const now = deps.clock();
  const client = await deps.db.connect();
  let accountId: string;
  try {
    await client.query('begin');
    try {
      accountId = await createAccount(client, { username, key: usernameKey, kind: 'trader', termsVersion: terms, now });
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
  return reply.code(201).send({ username });
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
