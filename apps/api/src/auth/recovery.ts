/**
 * The recovery code, the backup login and its 24-hour hold (Task 9, P2-I1; hold model v3, owner
 * 1-2 Nov 2026, see hold.ts).
 *
 * - Hold model v3: ONE 16-character code (`RECOVERY_CODE_COUNT`). A recovery-code login logs
 *   everyone on the account out, holds the account 24 h (reason `recovery-code`), holds its open
 *   trades (trades/held.ts) and keeps the waiting changes (owner G32: they still wait their 24 h and
 *   the recovery session may cancel them), all in the login's transaction; the code
 *   used is replaced there by a new one, sealed in `recovery_code_reveals` until a full session of
 *   the account owner opened after it shows it once (`POST /v1/account/recovery-code/reveal`;
 *   `GET /v1/account` `recoveryCodeToShow` is the reminder). An authenticator code alone is no
 *   backup login any more (owner: TOTP-only login is not allowed): 403 `method-not-allowed`.
 *
 * - Recovery codes come only from `newRecoveryCode()` (80 bits from `getRandomValues`, bias-free)
 *   and are stored only as `recoveryCodeHash`: HMAC-SHA-256 under the current `X2F_RECOVERY_CODE_KEYS`
 *   key, bound to the account (FU-C, ASVS 2.6.2), its key id in `key_id`. Sets made before FU-C are
 *   plain SHA-256 with `key_id` null; they cannot be converted (only the hash is kept) and keep
 *   working, one use per code, until used up or regenerated.
 * - The backup login is a recovery code only (design build gaps Job 1, board Login-Backup: "Your
 *   recovery code is your only backup"; owner G32: the recovery code is the emergency way in). An
 *   authenticator (TOTP) code is no longer a backup way in: `kind: 'totp'` is 403
 *   `method-not-allowed` before any lookup (hold model v3). TOTP stays a normal login step (password + authenticator code, login.ts).
 * - A backup login opens a `recovery` session, never a full one, held for 24 hours (a recovery
 *   code alone is one weak way; owner 2026-10-29): `requireSession` refuses it with 403
 *   `recovery-hold` on every route that does not set `allowHeld`, so it cannot add a primary method
 *   early. The account's hold (Task 17, hold.ts) starts in the same transaction. Any full session
 *   of the account can end a recovery session; a strong one ends the hold it started too.
 * - The backup login starts with the private login name (owner, 2026-10-23), never the display name.
 * - Owner S-109 (p11-34, 9 Nov 2026): a correct recovery code always gets in, even while wrong codes
 *   are being throttled (`matchRecoveryCode`); only wrong codes wait.
 * - Owner S-110 (p11-35): a password change that also gives the recovery code applies at once
 *   (password.ts); the code is spent and replaced as after a recovery-code login.
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
import { throttleCheck, throttleFail, throttleKey, throttleReset } from './throttle.js';
import {
  endHoldOfSession, gateChange, stagedReply, holdInTx, lockAccount, requireLiveSessionInTx, requireNotHeld, settleOf, startHold, weakOf, weakRefusal, withTx,
} from './hold.js';
import { totpBox } from './totp.js';
import { holdTrades, syncHeldTrades } from '../trades/held.js';
import { loginStrength, waits } from './strength.js';
import type { Queryable } from '../db/pool.js';
import type { Deps } from '../app.js';

export const RECOVERY_HOLD_MS = 24 * 3_600_000;
/** Hold model v3 (owner 2 Nov 2026): one code, required at sign-up, replaced after use. */
export const RECOVERY_CODE_COUNT = 1;

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
 * A new code (`RECOVERY_CODE_COUNT`, one) replacing every earlier one (used or not), in one
 * transaction. A waiting login's new code is staged (hold model v3): it is shown now and works 24 h
 * after it is submitted; until then the earlier code stays.
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
  let held: { changeId: string } | null = null;
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
    return reply.code(202).send({ ...stagedReply(held), codes: list });
  }
  return { codes: list };
}

/** The write of new recovery codes (the route's, or a pending one when the hold ends by time). */
export async function applyRecoveryCodes(db: Queryable, accountId: string, keyId: number, hashes: Buffer[], now: Date, o: { alert: boolean } = { alert: true }): Promise<void> {
  await db.query('delete from recovery_codes where account_id = $1', [accountId]);
  await db.query('insert into recovery_codes (account_id, code_hash, key_id) select $1, unnest($2::bytea[]), $3', [accountId, hashes, keyId]);
  // A code set by the owner (not the one that replaced a used code) also ends a code still waiting to be shown.
  if (o.alert) await db.query('delete from recovery_code_reveals where account_id = $1', [accountId]);
  if (o.alert) await addAlert(db, accountId, 'login-method-added', { method: 'recovery-codes' }, now);
}

type Who = { id: string } | { nameTag: string };

/**
 * The throttled check of a typed recovery code against `accountId`'s unused code (the backup login
 * and S-110's password change). Always one lookup with the same hashing work; a malformed code or a
 * missing account simply matches nothing. A row matches only under its own scheme: its key's HMAC,
 * or SHA-256 if legacy.
 *
 * Owner S-109 (p11-34, 9 Nov 2026): "a correct recovery code always gets in", even when logins are
 * throttled. So the throttle's refusal is held back until the code has been looked up: a correct
 * code returns its id whatever the throttle says (the code has 80 random bits, so the throttle adds
 * nothing against guessing it; it slows only the wrong ones); a wrong one gets the throttle's 429
 * while it waits (and, as before, no failure is counted for a refused try), else a failure is counted
 * and `codeId` is null. The caller spends the code and clears the streak (`throttleReset`) on
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
  const normalized = normalizeRecoveryCode(code.slice(0, 64));
  const { ids, hashes } = candidates(deps.config, accountId ?? '', normalized ?? '');
  const { rows } = await deps.db.query<{ id: string }>(
    `select id from recovery_codes
      where account_id = $1 and used_at is null
        and (coalesce(key_id, 0), code_hash) in (select * from unnest($2::int[], $3::bytea[]))`,
    [accountId, ids, hashes],
  );
  const codeId = accountId !== null && normalized !== null ? (rows[0]?.id ?? null) : null;
  if (codeId !== null) return { key, codeId };
  if (throttled !== null) throw throttled;
  await throttleFail(deps, key, accountId);
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
  // Hold model v3 (owner, 2 Nov 2026): an authenticator code alone never logs in.
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
    // Hold model v3: the account's 24-hour hold starts with the session (`backupSession`). The code
    // is spent in that same transaction, so a failure there leaves the account's one code unused.
    const holdUntil = new Date(deps.clock().getTime() + RECOVERY_HOLD_MS);
    if (!(await backupSession(req, reply, accountId, codeId, deviceLabel, holdUntil))) {
      // A parallel use spent the code first: counted as a miss, as before S-109.
      await throttleFail(deps, key, accountId);
      throw new ApiError(401, 'credentials-invalid');
    }
    await throttleReset(deps, key);
    await retagLoginName(deps, found!, name.candidates.current);
    return { status: 'ok' as const, level: 'recovery' as const, holdUntil: holdUntil.toISOString() };
  }
  throw new ApiError(400, 'bad-request');
}

/**
 * A recovery-code login (hold model v3), in one transaction with the account locked: the code is
 * spent (false when a parallel use spent it first: nothing else happens); a hold whose time is up
 * settles first; every session of the account (the owner's and the team members') is
 * logged out (alert `sessions-ended` `{ count, reason: 'recovery-code' }`) and every open login
 * approval expires; the drafts die with their sessions, the waiting (submitted) changes keep their
 * date (owner G32, 7 Nov: a recovery code is only a way in; it overrides neither the password nor
 * the 24-hour wait of password-only changes; the recovery session may cancel them); the held recovery
 * session opens (`openSession` writes alert `recovery-login`); the account's hold starts (reason
 * `recovery-code`) or a running one extends; its open trades are held; the code used is replaced by
 * a new one (`renewRecoveryCode`). After the commit the ended sessions' streams close and the held
 * trades are paused (`syncHeldTrades`).
 */
async function backupSession(req: FastifyRequest, reply: FastifyReply, accountId: string, codeId: string, deviceLabel: string, holdUntil: Date): Promise<boolean> {
  const deps = req.server.deps;
  const now = deps.clock();
  const opened = await withTx(deps.db, async (db) => {
    await lockAccount(db, accountId);
    // The code is spent here, under the account lock: of two parallel uses only one finds it unused.
    const used = await db.query('update recovery_codes set used_at = $2 where id = $1 and used_at is null', [codeId, now]);
    if ((used.rowCount ?? 0) === 0) return null;
    await holdInTx(db, settleOf(req), accountId, now);
    const ended = await db.query<{ id: string }>('update sessions set revoked_at = $2 where account_id = $1 and revoked_at is null returning id', [accountId, now]);
    await db.query(
      `update login_approvals set outcome = 'expired', decided_at = coalesce(decided_at, $2)
        where account_id = $1 and (outcome is null or (outcome = 'approved' and used_at is null))`,
      [accountId, now],
    );
    if (ended.rows.length > 0) await addAlert(db, accountId, 'sessions-ended', { count: ended.rows.length, reason: 'recovery-code' }, now);
    // Lead hold v3 review, Critical 1: device trust is a cookie a thief can copy (as at the
    // owner's proof, hold.ts): after a recovery-code login every browser needs an approval again.
    await db.query('delete from trusted_devices where account_id = $1', [accountId]);
    const s = await openSession(db, deps, req, reply, {
      accountId, level: 'recovery', deviceLabel, method: 'recovery-code', firstSession: false, holdUntil, strength: loginStrength(['recovery-code']),
    });
    await startHold(db, accountId, now, { reason: 'recovery-code', startedBy: s.sessionId });
    await holdTrades(db, accountId, now);
    await renewRecoveryCode(db, deps.config, accountId, now);
    return s;
  });
  if (opened === null) return false;
  opened.after();
  req.server.events.closeAccount(accountId, opened.sessionId);
  await syncHeldTrades({ db: deps.db, clock: deps.clock, publish: req.server.tradePublish }, accountId);
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
 * True when a replaced recovery code waits to be shown and this session may show it (lead hold v3
 * review, Critical 1): the account owner's session, opened with or after the code was replaced,
 * and either a strong full login or the recovery session itself once its 24 hours are over. A
 * username-and-password session never may: a password thief on a once-trusted device must not
 * read the new code.
 */
export async function revealDue(db: Queryable, accountId: string, sessionId: string, now: Date): Promise<boolean> {
  const { rows } = await db.query(
    `select 1 from recovery_code_reveals r join sessions s on s.account_id = r.account_id
      where r.account_id = $1 and s.id = $2 and s.member_id is null and s.revoked_at is null and s.created_at >= r.created_at
        and ((s.level = 'full' and s.strength = 'strong') or (s.level = 'recovery' and s.hold_until is not null and s.hold_until <= $3))`,
    [accountId, sessionId, now],
  );
  return rows.length > 0;
}

/**
 * `POST /v1/account/recovery-code/reveal` (a session `revealDue` allows: a strong full login or the
 * waited recovery session, opened with or after the code
 * was replaced): `{ code }`, once; the sealed copy is deleted in the same transaction. 404 when
 * there is none for this session. The session must still be live under the account lock.
 */
async function revealCode(req: FastifyRequest) {
  const deps = req.server.deps;
  const now = deps.clock();
  const { accountId } = req.auth;
  const sealed = await withTx(deps.db, async (db) => {
    await requireLiveSessionInTx(db, req.auth, now);
    if (!(await revealDue(db, accountId, req.auth.sessionId, now))) throw new ApiError(404, 'not-found');
    const { rows } = await db.query<{ code_enc: Buffer }>('delete from recovery_code_reveals where account_id = $1 returning code_enc', [accountId]);
    return rows[0]!.code_enc;
  });
  return { code: Buffer.from(totpBox(deps.config).open(sealed, revealContext(accountId))).toString('utf8') };
}

/**
 * `DELETE /v1/account/recovery-sessions/:id` (a full session of the account): ends that recovery
 * session. A session whose login waits may do so only when it is older than that backup session
 * (review round 4 R4-M1, lead decision 2026-10-30: the owner's weak session predating a thief's
 * backup login can still kill it; a weak session opened after the owner's backup login cannot),
 * else 403 `weak-session`. When the caller's own login was strong and that backup session started
 * the account's hold, the hold ends too (review M1; alert `hold-ended`), in the same transaction;
 * a weak caller's cancel leaves the hold running (fail closed). The caller must still be live under
 * the account lock (review round 4, `requireLiveSessionInTx`).
 */
async function cancelRecovery(req: FastifyRequest) {
  const deps = req.server.deps;
  const id = (req.params as { id?: unknown }).id;
  if (typeof id !== 'string' || !UUID.test(id)) throw new ApiError(404, 'not-found');
  const now = deps.clock();
  const { accountId, sessionId } = req.auth;
  await withTx(deps.db, async (db) => {
    const caller = await requireLiveSessionInTx(db, { accountId, sessionId }, now);
    const target = await db.query<{ created_at: Date }>(
      `select created_at from sessions where id = $1 and account_id = $2 and level = 'recovery' and revoked_at is null`,
      [id, accountId],
    );
    const rec = target.rows[0];
    if (!rec) throw new ApiError(404, 'not-found');
    // Review round 3 R3-M2, round 4 R4-M1 (lead decision 2026-10-30): a weak session cancels only a
    // backup session younger than itself.
    if (weakOf(caller, now) && caller.created_at.getTime() >= rec.created_at.getTime()) throw weakRefusal();
    await db.query('update sessions set revoked_at = $2 where id = $1', [id, now]);
    await addAlert(db, accountId, 'recovery-hold-cancelled', { sessionId: id }, now);
    if (!waits(caller.strength)) await endHoldOfSession(db, { config: deps.config, events: req.server.events }, accountId, id, now);
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
  // A recovery session may reveal once its hold is over (a held one is 403 recovery-hold).
  app.post('/v1/account/recovery-code/reveal', { preHandler: requireSession({ allowRecovery: true }) }, revealCode);
  app.delete('/v1/account/recovery-sessions/:id', { preHandler: requireSession() }, cancelRecovery);
}
