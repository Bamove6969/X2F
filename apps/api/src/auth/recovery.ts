/**
 * Recovery codes, the backup login and its 24-hour hold (Task 9, P2-I1).
 *
 * - Recovery codes come only from `newRecoveryCode()` (80 bits from `getRandomValues`, bias-free)
 *   and are stored only as `recoveryCodeHash`: HMAC-SHA-256 under the current `X2F_RECOVERY_CODE_KEYS`
 *   key, bound to the account (FU-C, ASVS 2.6.2), its key id in `key_id`. Sets made before FU-C are
 *   plain SHA-256 with `key_id` null; they cannot be converted (only the hash is kept) and keep
 *   working, one use per code, until used up or regenerated.
 * - A backup login opens a `recovery` session, never a full one, held for 24 hours (a TOTP code or
 *   a recovery code alone is one weak way; owner 2026-10-29): `requireSession` refuses it with 403
 *   `recovery-hold` on every route that does not set `allowHeld`, so it cannot add a primary method
 *   early. The account's hold (Task 17, hold.ts) starts in the same transaction. Any full session
 *   of the account can end a recovery session; a strong one ends the hold it started too.
 * - The backup login starts with the private login name (owner, 2026-10-23), never the display name.
 * - Staff and the owner have no backup login (R2): their login names take the unknown-name path.
 */
import { createHash, createHmac } from 'node:crypto';
import { newRecoveryCode, normalizeRecoveryCode, type AccountKind } from '@x2f/accounts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { addAlert } from '../alerts.js';
import type { Config } from '../config.js';
import { ApiError } from '../errors.js';
import { requireConfirm } from './confirm.js';
import { ensureDeviceCookie } from './device.js';
import { allowedMethods, methodAllowed } from './methods.js';
import { loginNameLookup, loginTagMatch, retagLoginName } from '../accounts.js';
import { assertNotDisabled, openSession, requireSession } from './sessions.js';
import { NIL_UUID, dailyCap, throttleCheck, throttleFail, throttleKey, throttleReset } from './throttle.js';
import { endHoldOfSession, gateChange, heldReply, holdInTx, lockAccount, pushHoldStarted, requireNotHeld, startHold, withTx } from './hold.js';
import { loginStrength, waits, type LoginStrength } from './strength.js';
import type { Queryable } from '../db/pool.js';
import { verifyTotp } from './totp.js';

export const RECOVERY_HOLD_MS = 24 * 3_600_000;
/** Backup TOTP attempts per account (or unknown name) per UTC day, right or wrong. */
export const TOTP_BACKUP_DAILY = 5;
export const RECOVERY_CODE_COUNT = 10;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A pre-FU-C code's stored form (`key_id` null): plain SHA-256 of the normalized code. */
const legacyCodeHash = (normalized: string): Buffer => createHash('sha256').update(normalized, 'utf8').digest();

/** HMAC-SHA-256(key `keyId`, `x2f/recovery-code` NUL account ID NUL normalized code). Throws for a key the ring lacks. */
export function recoveryCodeHash(config: Config, keyId: number, accountId: string, normalized: string): Buffer {
  const key = config.recoveryCodeKeys.keys.get(keyId);
  if (key === undefined) throw new Error(`recovery-code key ${keyId} is not configured`);
  return createHmac('sha256', key).update(`x2f/recovery-code\0${accountId}\0${normalized}`, 'utf8').digest();
}

/**
 * Every (key id, hash) a typed code could be stored as: one per key in the ring, plus (0, SHA-256)
 * for a legacy row (its null `key_id` is compared as 0) unless `X2F_LEGACY_SECRETS=off`.
 */
function candidates(config: Config, accountId: string, normalized: string): { ids: number[]; hashes: Buffer[] } {
  // With X2F_LEGACY_SECRETS=off a legacy row can never match (its SHA-256 is not even computed).
  const ids = [...(config.legacySecrets ? [0] : []), ...config.recoveryCodeKeys.keys.keys()];
  return { ids, hashes: ids.map((id) => (id === 0 ? legacyCodeHash(normalized) : recoveryCodeHash(config, id, accountId, normalized))) };
}

/** The form login compares; generation hashes the same form, so the two can never drift apart. */
function normalized(code: string): string {
  const n = normalizeRecoveryCode(code);
  if (n === null) throw new Error('newRecoveryCode produced a code that does not normalize');
  return n;
}

function strings<K extends string>(body: unknown, keys: readonly K[]): Record<K, string> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'bad-request');
  const rec = body as Record<string, unknown>;
  const out = {} as Record<K, string>;
  for (const k of keys) {
    const v = rec[k];
    if (typeof v !== 'string') throw new ApiError(400, 'bad-request');
    out[k] = v;
  }
  return out;
}

/**
 * 10 new codes replacing every earlier one (used or not), in one transaction. A waiting login's new
 * codes start the hold (Task 17): they are shown now and work once the hold ends by time; until
 * then the earlier codes stay.
 */
async function newCodes(req: FastifyRequest, reply: FastifyReply) {
  const deps = req.server.deps;
  const codes = new Set<string>();
  while (codes.size < RECOVERY_CODE_COUNT) codes.add(newRecoveryCode());
  const list = [...codes];
  const now = deps.clock();
  const keyId = deps.config.recoveryCodeKeys.current;
  const hashes = list.map((c) => recoveryCodeHash(deps.config, keyId, req.auth.accountId, normalized(c)));
  const client = await deps.db.connect();
  let held: { holdUntil: Date } | null = null;
  try {
    await client.query('begin');
    try {
      held = await gateChange(client, req, { kind: 'recovery-codes', keyId, hashes: hashes.map((h) => h.toString('base64')) });
      if (held === null) await applyRecoveryCodes(client, req.auth.accountId, keyId, hashes, now);
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    }
  } finally {
    client.release();
  }
  if (held !== null) {
    pushHoldStarted(req, req.auth.accountId);
    return reply.code(202).send({ ...heldReply(held), codes: list });
  }
  return { codes: list };
}

/** The write of new recovery codes (the route's, or a pending one when the hold ends by time). */
export async function applyRecoveryCodes(db: Queryable, accountId: string, keyId: number, hashes: Buffer[], now: Date): Promise<void> {
  await db.query('delete from recovery_codes where account_id = $1', [accountId]);
  await db.query('insert into recovery_codes (account_id, code_hash, key_id) select $1, unnest($2::bytea[]), $3', [accountId, hashes, keyId]);
  await addAlert(db, accountId, 'login-method-added', { method: 'recovery-codes' }, now);
}

type Who = { id: string } | { nameTag: string };

/**
 * `POST /v1/login/backup { loginName, kind, code, deviceLabel }`. Unknown login names, accounts of
 * other kinds (R2) and accounts without the method take the same path and fail the same way: 401
 * `credentials-invalid`. A disabled account is named only after a correct code, and its code stays
 * unused.
 */
async function backupLogin(req: FastifyRequest, reply: FastifyReply) {
  const deps = req.server.deps;
  ensureDeviceCookie(req, reply);
  req.server.budgets.start.take();
  const { loginName, kind, code, deviceLabel } = strings(req.body, ['loginName', 'kind', 'code', 'deviceLabel'] as const);
  if (kind !== 'totp' && kind !== 'recovery-code') throw new ApiError(400, 'bad-request');
  const name = loginNameLookup(deps.config, loginName);
  // Always one lookup under every key of the ring (FU-D): a malformed name's tags match no account (I-1).
  const found = (
    await deps.db.query<{ id: string; kind: AccountKind; login_tag_key_id: number }>(
      `select a.id, a.kind, a.login_tag_key_id from accounts a where ${loginTagMatch('a', 1)}`,
      [name.candidates.ids, name.candidates.tags],
    )
  ).rows[0];
  // R2: an account whose kind may not hold this method (staff and the owner hold neither) takes the
  // unknown-name path.
  const accountId = found && allowedMethods(found.kind).includes(kind === 'totp' ? 'totp' : 'recovery-codes') ? found.id : null;
  const who: Who = accountId !== null ? { id: accountId } : { nameTag: name.tag };
  const refuse = async (key: string): Promise<never> => {
    await throttleFail(deps, key, accountId);
    throw new ApiError(401, 'credentials-invalid');
  };

  if (kind === 'recovery-code') {
    const key = await throttleKey(deps, req, 'recovery-code', who);
    await throttleCheck(deps, key);
    const normalized = normalizeRecoveryCode(code.slice(0, 64));
    // Always one lookup with the same hashing work; a malformed code or a missing account simply
    // matches nothing. A row matches only under its own scheme: its key's HMAC, or SHA-256 if legacy.
    const { ids, hashes } = candidates(deps.config, accountId ?? '', normalized ?? '');
    const { rows } = await deps.db.query<{ id: string }>(
      `select id from recovery_codes
        where account_id = $1 and used_at is null
          and (coalesce(key_id, 0), code_hash) in (select * from unnest($2::int[], $3::bytea[]))`,
      [accountId, ids, hashes],
    );
    const codeId = rows[0]?.id;
    if (accountId === null || normalized === null || codeId === undefined) return refuse(key);
    await assertNotDisabled(deps.db, accountId);
    const used = await deps.db.query('update recovery_codes set used_at = $2 where id = $1 and used_at is null', [codeId, deps.clock()]);
    if ((used.rowCount ?? 0) === 0) return refuse(key);
    await throttleReset(deps, key);
    await retagLoginName(deps, found!, name.candidates.current);
    // Task 17 (owner, 2026-10-29): a recovery code alone is one weak way: held like a TOTP backup
    // login, and the account's hold starts with the session.
    const holdUntil = new Date(deps.clock().getTime() + RECOVERY_HOLD_MS);
    await backupSession(req, reply, accountId, 'recovery-code', deviceLabel, holdUntil);
    return { status: 'ok' as const, level: 'recovery' as const, holdUntil: holdUntil.toISOString() };
  }

  // TOTP: at most 5 tries a day per account, right or wrong, before the per-guess throttle.
  await dailyCap(deps, `backup-totp:${accountId ?? `name:${name.tag}`}`, TOTP_BACKUP_DAILY);
  const key = await throttleKey(deps, req, 'totp', who);
  await throttleCheck(deps, key);
  // The same lookup for no account: NIL_UUID has no TOTP row, so it runs the dummy check (I-1).
  const ok = await verifyTotp(deps, accountId ?? NIL_UUID, code);
  if (!ok || accountId === null) return refuse(key);
  await throttleReset(deps, key);
  await assertNotDisabled(deps.db, accountId);
  await retagLoginName(deps, found!, name.candidates.current);
  const holdUntil = new Date(deps.clock().getTime() + RECOVERY_HOLD_MS);
  await backupSession(req, reply, accountId, 'totp', deviceLabel, holdUntil);
  return { status: 'ok' as const, level: 'recovery' as const, holdUntil: holdUntil.toISOString() };
}

/**
 * A backup login's held recovery session and the account's hold (Task 17, reason
 * `weak-backup-login`), in one transaction: neither exists without the other. `openSession`
 * writes the `recovery-login` alert { method, holdUntil }.
 */
async function backupSession(
  req: FastifyRequest,
  reply: FastifyReply,
  accountId: string,
  method: 'totp' | 'recovery-code',
  deviceLabel: string,
  holdUntil: Date,
): Promise<void> {
  const deps = req.server.deps;
  const now = deps.clock();
  const opened = await withTx(deps.db, async (db) => {
    await lockAccount(db, accountId);
    // A hold whose time is up settles first (its pending change may end sessions); then the
    // session opens and this hold starts, or a running one extends.
    await holdInTx(db, { config: deps.config, events: req.server.events }, accountId, now);
    const s = await openSession(db, deps, req, reply, {
      accountId, level: 'recovery', deviceLabel, method, firstSession: false, holdUntil, strength: loginStrength([method]),
    });
    await startHold(db, accountId, now, { reason: 'weak-backup-login', startedBy: s.sessionId });
    return s;
  });
  opened.after();
}

/**
 * `DELETE /v1/account/recovery-sessions/:id` (any full session of the account): ends that recovery
 * session. When the caller's own login was strong and that backup session started the account's
 * hold, the hold ends too (review M1; alert `hold-ended`), in the same transaction.
 */
async function cancelRecovery(req: FastifyRequest) {
  const deps = req.server.deps;
  const id = (req.params as { id?: unknown }).id;
  if (typeof id !== 'string' || !UUID.test(id)) throw new ApiError(404, 'not-found');
  const now = deps.clock();
  const { accountId, sessionId } = req.auth;
  await withTx(deps.db, async (db) => {
    await lockAccount(db, accountId);
    const r = await db.query(
      `update sessions set revoked_at = $3
        where id = $1 and account_id = $2 and level = 'recovery' and revoked_at is null`,
      [id, accountId, now],
    );
    if ((r.rowCount ?? 0) === 0) throw new ApiError(404, 'not-found');
    await addAlert(db, accountId, 'recovery-hold-cancelled', { sessionId: id }, now);
    const own = await db.query<{ strength: LoginStrength | null }>('select strength from sessions where id = $1', [sessionId]);
    if (!waits(own.rows[0]?.strength)) await endHoldOfSession(db, { config: deps.config, events: req.server.events }, accountId, id, now);
  });
  req.server.events.closeSession(accountId, id);
  return { ok: true };
}

export function recoveryRoutes(app: FastifyInstance): void {
  app.post(
    '/v1/account/recovery-codes',
    { preHandler: [requireSession(), methodAllowed('recovery-codes'), requireNotHeld, requireConfirm({ kind: 'new-recovery-codes' }, { onboarding: true })] },
    newCodes,
  );
  app.post('/v1/login/backup', backupLogin);
  app.delete('/v1/account/recovery-sessions/:id', { preHandler: requireSession() }, cancelRecovery);
}
