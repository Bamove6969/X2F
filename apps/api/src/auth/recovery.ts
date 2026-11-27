/**
 * The recovery code and the backup login (Task 9; owner, 26 Nov 2026: no passwords and no holds).
 *
 * - ONE code (`RECOVERY_CODE_COUNT`), 64 symbols since the owner's demo notes of 12 Nov 2026 ("much
 *   longer"; it was 16, and a code of the old length still works until used or replaced). Making a
 *   new one (`POST /v1/account/recovery-codes`) cancels the old one at once.
 * - A recovery-code login is a full session, at once (owner, 26 Nov 2026: "if you use it then you
 *   can change everything and no 24 hour hold"). In the login's transaction it logs everyone else
 *   on the account out, expires every open login approval and forgets every trusted device; the
 *   code used is replaced there by a new one, sealed in `recovery_code_reveals` until a session of
 *   the account owner opened after it shows it once (`POST /v1/account/recovery-code/reveal`;
 *   `GET /v1/account` `recoveryCodeToShow` is the reminder). An authenticator code is no backup
 *   login here (403 `method-not-allowed`): since owner 27 Nov 2026 it logs in as a normal login,
 *   `POST /v1/login/totp` (totp.ts), with approve-on-device and none of the recovery code's powers.
 * - Recovery codes come only from `newRecoveryCode()` (320 bits from `getRandomValues`, bias-free)
 *   and are stored only as `recoveryCodeHash`: HMAC-SHA-256 under the current `X2F_RECOVERY_CODE_KEYS`
 *   key, bound to the account (FU-C, ASVS 2.6.2), its key id in `key_id`. Sets made before FU-C are
 *   plain SHA-256 with `key_id` null; they cannot be converted (only the hash is kept) and keep
 *   working, one use per code, until used up or regenerated.
 * - The backup login starts with the private login name (owner, 2026-10-23), never the Trade Tag.
 * - Owner S-109 (p11-34, 9 Nov 2026): a correct recovery code always gets in, even while wrong codes
 *   are being throttled (`matchRecoveryCode`); only wrong codes wait.
 * - Staff and the owner have no backup login (R2): their login names take the unknown-name path.
 */
import { createHash, createHmac } from 'node:crypto';
import { newRecoveryCode, normalizeRecoveryCode, type AccountKind } from '@x2f/accounts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { addAlert } from '../alerts.js';
import type { Config } from '../config.js';
import { ApiError } from '../errors.js';
import { onlyIfNew, passedOnWindow, recheckWindowInTx, requireConfirm } from './confirm.js';
import { ensureDeviceCookie } from './device.js';
import { allowedMethods, methodAllowed } from './methods.js';
import { loginNameLookup, loginTagMatch, retagLoginName } from '../accounts.js';
import { assertNotDisabled, openSession, requireSession } from './sessions.js';
import { throttleCheck, throttleFail, throttleKey, throttleReset } from './throttle.js';
import { lockAccount, requireLiveSessionInTx, withTx } from './liveSession.js';
import { totpBox } from './totp.js';
import type { Queryable } from '../db/pool.js';
import type { Deps } from '../app.js';

/** One code, required at sign-up, replaced after use (owner 2 Nov 2026). */
export const RECOVERY_CODE_COUNT = 1;

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
 * A new code (`RECOVERY_CODE_COUNT`, one) replacing every earlier one (used or not), in one
 * transaction, once the calling session is checked live under the account lock.
 */
async function newCodes(req: FastifyRequest) {
  const deps = req.server.deps;
  const codes = new Set<string>();
  while (codes.size < RECOVERY_CODE_COUNT) codes.add(newRecoveryCode());
  const list = [...codes];
  const now = deps.clock();
  const keyId = deps.config.recoveryCodeKeys.current;
  const hashes = list.map((c) => recoveryCodeHash(deps.config, keyId, req.auth.accountId, normalized(c)));
  await withTx(deps.db, async (client) => {
    await requireLiveSessionInTx(client, req.auth, now);
    // Re-verify R1: "none yet" again under the account lock, so a parallel twin loses.
    if (passedOnWindow(req)) await recheckWindowInTx(client, req, 'recovery-codes', 'new-recovery-codes');
    await applyRecoveryCodes(client, req.auth.accountId, keyId, hashes, now);
  });
  return { codes: list };
}

/** The write of new recovery codes. */
export async function applyRecoveryCodes(db: Queryable, accountId: string, keyId: number, hashes: Buffer[], now: Date, o: { alert: boolean } = { alert: true }): Promise<void> {
  await db.query('delete from recovery_codes where account_id = $1', [accountId]);
  await db.query('insert into recovery_codes (account_id, code_hash, key_id) select $1, unnest($2::bytea[]), $3', [accountId, hashes, keyId]);
  // A code set by the owner (not the one that replaced a used code) also ends a code still waiting to be shown.
  if (o.alert) await db.query('delete from recovery_code_reveals where account_id = $1', [accountId]);
  if (o.alert) await addAlert(db, accountId, 'login-method-added', { method: 'recovery-codes' }, now);
}

type Who = { id: string } | { nameTag: string };

/**
 * The throttled check of a typed recovery code against `accountId`'s unused code (the backup login). Always one lookup with the same hashing work; a malformed code or a
 * missing account simply matches nothing. A row matches only under its own scheme: its key's HMAC,
 * or SHA-256 if legacy.
 *
 * Owner S-109 (p11-34, 9 Nov 2026): "a correct recovery code always gets in", even when logins are
 * throttled. So the throttle's refusal is held back until the code has been looked up: a correct
 * code returns its id whatever the throttle says (a code has 320 random bits, 64 symbols of 32; one
 * of the old 16-symbol format, still accepted, has 80; so the throttle adds nothing against guessing it; it slows only the wrong ones); a wrong one gets the throttle's 429
 * while it waits, else `codeId` is null; either way the miss is counted (review L1). The caller spends the code and clears the streak (`throttleReset`) on
 * success. Returns the throttle key too.
 */
export async function matchRecoveryCode(
  deps: Deps,
  req: FastifyRequest,
  accountId: string | null,
  who: Who,
  code: string,
): Promise<{ key: string; codeId: string | null }> {
  const key = await throttleKey(deps, req, 'recovery-code', who);
  let throttled: ApiError | null = null;
  try {
    await throttleCheck(deps, key);
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 429) throw e;
    throttled = e;
  }
  // The longest input normalizeRecoveryCode reads (a 64-symbol code with generous separators).
  const normalized = normalizeRecoveryCode(code.slice(0, 200));
  const { ids, hashes } = candidates(deps.config, accountId ?? '', normalized ?? '');
  const { rows } = await deps.db.query<{ id: string }>(
    `select id from recovery_codes
      where account_id = $1 and used_at is null
        and (coalesce(key_id, 0), code_hash) in (select * from unnest($2::int[], $3::bytea[]))`,
    [accountId, ids, hashes],
  );
  const codeId = accountId !== null && normalized !== null ? (rows[0]?.id ?? null) : null;
  if (codeId !== null) return { key, codeId };
  // Review L1 (12 Nov 2026): a wrong code is counted even while the throttle refuses it (no
  // count can block the correct code any more, S-109), so the streak stays live through an attack
  // and its lock alert follows it.
  await throttleFail(deps, key, accountId);
  if (throttled !== null) throw throttled;
  return { key, codeId: null };
}

/**
 * `POST /v1/login/backup { loginName, kind: 'recovery-code', code, deviceLabel }`. `kind: 'totp'` is
 * 403 `method-not-allowed` and any other `kind` 400 `bad-request`, before any lookup. Unknown login names, accounts of other
 * kinds (R2) and accounts without recovery codes take the same path and fail the same way: 401
 * `credentials-invalid`. A disabled account is named only after a correct code, and its code stays
 * unused.
 */
async function backupLogin(req: FastifyRequest, reply: FastifyReply) {
  const deps = req.server.deps;
  ensureDeviceCookie(req, reply);
  req.server.budgets.start.take();
  const { loginName, kind, code, deviceLabel } = strings(req.body, ['loginName', 'kind', 'code', 'deviceLabel'] as const);
  if (kind !== 'totp' && kind !== 'recovery-code') throw new ApiError(400, 'bad-request');
  // An authenticator code is never a backup login (no recovery powers): it logs in as a normal
  // login at `POST /v1/login/totp` (owner, 27 Nov 2026).
  if (kind === 'totp') throw new ApiError(403, 'method-not-allowed');
  const name = loginNameLookup(deps.config, loginName);
  // Always one lookup under every key of the ring (FU-D): a malformed name's tags match no account (I-1).
  const found = (
    await deps.db.query<{ id: string; kind: AccountKind; login_tag_key_id: number }>(
      `select a.id, a.kind, a.login_tag_key_id from accounts a where ${loginTagMatch('a', 1)}`,
      [name.candidates.ids, name.candidates.tags],
    )
  ).rows[0];
  // R2: an account whose kind may not hold recovery codes (staff and the owner) takes the
  // unknown-name path.
  const accountId = found && allowedMethods(found.kind).includes('recovery-codes') ? found.id : null;
  const who: Who = accountId !== null ? { id: accountId } : { nameTag: name.tag };
  if (kind === 'recovery-code') {
    // A miss is counted (or answered with the throttle's wait) inside `matchRecoveryCode`.
    const { key, codeId } = await matchRecoveryCode(deps, req, accountId, who, code);
    if (accountId === null || codeId === null) throw new ApiError(401, 'credentials-invalid');
    await assertNotDisabled(deps.db, accountId);
    // The code is spent in the session's transaction (`backupSession`), so a failure there leaves
    // the account's one code unused.
    if (!(await backupSession(req, reply, accountId, codeId, deviceLabel))) {
      // A parallel use spent the code first: counted as a miss, as before S-109.
      await throttleFail(deps, key, accountId);
      throw new ApiError(401, 'credentials-invalid');
    }
    await throttleReset(deps, key);
    await retagLoginName(deps, found!, name.candidates.current);
    return { status: 'ok' as const };
  }
  throw new ApiError(400, 'bad-request');
}

/**
 * A recovery-code login, in one transaction with the account locked: the code is spent (false when
 * a parallel use spent it first: nothing else happens); every session of the account (the owner's
 * and the team members') is logged out (alert `sessions-ended` `{ count, reason: 'recovery-code' }`),
 * every open login approval expires and every trusted device is forgotten; a full session opens
 * (`openSession` writes alert `recovery-login`); the code used is replaced by a new one
 * (`renewRecoveryCode`). After the commit the ended sessions' streams close.
 */
async function backupSession(req: FastifyRequest, reply: FastifyReply, accountId: string, codeId: string, deviceLabel: string): Promise<boolean> {
  const deps = req.server.deps;
  const now = deps.clock();
  const opened = await withTx(deps.db, async (db) => {
    await lockAccount(db, accountId);
    // The code is spent here, under the account lock: of two parallel uses only one finds it unused.
    const used = await db.query('update recovery_codes set used_at = $2 where id = $1 and used_at is null', [codeId, now]);
    if ((used.rowCount ?? 0) === 0) return null;
    const ended = await db.query<{ id: string }>('update sessions set revoked_at = $2 where account_id = $1 and revoked_at is null returning id', [accountId, now]);
    await db.query(
      `update login_approvals set outcome = 'expired', decided_at = coalesce(decided_at, $2)
        where account_id = $1 and (outcome is null or (outcome = 'approved' and used_at is null))`,
      [accountId, now],
    );
    if (ended.rows.length > 0) await addAlert(db, accountId, 'sessions-ended', { count: ended.rows.length, reason: 'recovery-code' }, now);
    // Lead hold v3 review, Critical 1: device trust is a cookie a thief can copy, so after a
    // recovery-code login every browser needs an approval again.
    await db.query('delete from trusted_devices where account_id = $1', [accountId]);
    const s = await openSession(db, deps, req, reply, { accountId, level: 'full', deviceLabel, method: 'recovery-code', firstSession: false });
    await renewRecoveryCode(db, deps.config, accountId, now);
    return s;
  });
  if (opened === null) return false;
  opened.after();
  req.server.events.closeAccount(accountId, opened.sessionId);
  return true;
}

const revealContext = (accountId: string) => `x2f/recovery-code-reveal/${accountId}`;

/**
 * Inside the recovery-code login's transaction: the account's one code is replaced by a new one
 * (its hash under the current key), and the new code is sealed for the owner's next login to show
 * once (`recovery_code_reveals`; sealed by the TOTP key store under its own context). Alert
 * `recovery-code-renewed`.
 */
export async function renewRecoveryCode(db: Queryable, config: Config, accountId: string, now: Date): Promise<void> {
  const code = newRecoveryCode();
  const keyId = config.recoveryCodeKeys.current;
  await applyRecoveryCodes(db, accountId, keyId, [recoveryCodeHash(config, keyId, accountId, normalized(code))], now, { alert: false });
  const sealed = totpBox(config).seal(Buffer.from(code, 'utf8'), revealContext(accountId));
  await db.query(
    `insert into recovery_code_reveals (account_id, code_enc, created_at) values ($1, $2, $3)
     on conflict (account_id) do update set code_enc = excluded.code_enc, created_at = excluded.created_at`,
    [accountId, sealed, now],
  );
  await addAlert(db, accountId, 'recovery-code-renewed', {}, now);
}

/**
 * True when a replaced recovery code waits to be shown and this session may show it: the account
 * owner's session, opened with or after the code was replaced (the recovery-code login itself, or
 * any later login).
 */
export async function revealDue(db: Queryable, accountId: string, sessionId: string): Promise<boolean> {
  const { rows } = await db.query(
    `select 1 from recovery_code_reveals r join sessions s on s.account_id = r.account_id
      where r.account_id = $1 and s.id = $2 and s.member_id is null and s.revoked_at is null and s.created_at >= r.created_at`,
    [accountId, sessionId],
  );
  return rows.length > 0;
}

/**
 * `POST /v1/account/recovery-code/reveal` (a session `revealDue` allows): `{ code }`, once; the
 * sealed copy is deleted in the same transaction. 404 when there is none for this session. The
 * session must still be live under the account lock.
 */
async function revealCode(req: FastifyRequest) {
  const deps = req.server.deps;
  const now = deps.clock();
  const { accountId } = req.auth;
  const sealed = await withTx(deps.db, async (db) => {
    await requireLiveSessionInTx(db, req.auth, now);
    if (!(await revealDue(db, accountId, req.auth.sessionId))) throw new ApiError(404, 'not-found');
    const { rows } = await db.query<{ code_enc: Buffer }>('delete from recovery_code_reveals where account_id = $1 returning code_enc', [accountId]);
    return rows[0]!.code_enc;
  });
  return { code: Buffer.from(totpBox(deps.config).open(sealed, revealContext(accountId))).toString('utf8') };
}

export function recoveryRoutes(app: FastifyInstance): void {
  app.post(
    '/v1/account/recovery-codes',
    { preHandler: [requireSession(), methodAllowed('recovery-codes'), requireConfirm({ kind: 'new-recovery-codes' }, { onboarding: onlyIfNew('recovery-codes') })] },
    newCodes,
  );
  app.post('/v1/login/backup', backupLogin);
  app.post('/v1/account/recovery-code/reveal', { preHandler: requireSession() }, revealCode);
}
