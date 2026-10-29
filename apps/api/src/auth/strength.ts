/**
 * Login strength and the 24-hour cooling-off (Plan 2 Task 17; owner, 2026-10-29).
 *
 * - **Strength.** Two different factors, or one PGP key, passkey or security key: `strong`, no wait.
 *   One weak way (a password alone, an authenticator code alone, a recovery code alone): `weak`.
 *   Each session records the strength of the login behind it (`sessions.strength`).
 * - **What starts a cooling-off** (`startCooling`, 24 hours on the account):
 *   1. a weak session that changes the password or the login methods (`SECURITY_CHANGE_ROUTES`,
 *      checked once the change has succeeded);
 *   2. a weak login on a new device when nothing is logged in to approve it (`traderLogin`);
 *   3. a backup login with one weak way (recovery.ts): it never waits for approval, so nobody
 *      logged in has said yes (lead default).
 * - **During it** (`requireNotCooling`, 403 `cooling-off` `{ coolingUntil }`): no new trades or
 *   offers, no payout-wallet changes, no approving new logins on other devices
 *   (`COOLING_BLOCKED_ROUTES`). Trades already open can still be finished.
 * - **Ending it early:** a strong login with a method the account already held before the cooling
 *   started (`endCoolingIfOwner`). A method added during the cooling never ends it, or a thief with
 *   the password could add a passkey and use it to end the wait.
 */
import type { FastifyInstance, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { addAlert } from '../alerts.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';

/** The owner's rule of 2026-10-29: a recovery code alone is one weak way and waits. */
export const RECOVERY_CODE_ALONE_WAITS = true;

export const COOLING_OFF_MS = 24 * 3_600_000;

export type LoginFactorKind = 'pgp' | 'passkey' | 'security-key' | 'password' | 'totp' | 'recovery-code';
export type LoginStrength = 'two-factor' | 'strong-single' | 'weak-single';
export type SessionStrength = 'strong' | 'weak';

export function loginStrength(factors: readonly LoginFactorKind[]): LoginStrength {
  const kinds = new Set(factors);
  if (kinds.size >= 2) return 'two-factor';
  const only = factors[0];
  if (only === 'pgp' || only === 'passkey' || only === 'security-key') return 'strong-single';
  if (only === 'recovery-code' && !RECOVERY_CODE_ALONE_WAITS) return 'strong-single';
  return 'weak-single';
}

export const sessionStrength = (s: LoginStrength): SessionStrength => (s === 'weak-single' ? 'weak' : 'strong');

export type CoolingReason = 'weak-login-changed-security' | 'weak-login-new-device' | 'weak-backup-login';

/**
 * Starts (or extends to now + 24 h) the account's cooling-off and records alert
 * `cooling-off-started { until, reason }`. An earlier start (`cooling_from`) is kept while one is
 * running, so a method added during it still cannot end it.
 */
export async function startCooling(db: Queryable, accountId: string, now: Date, reason: CoolingReason): Promise<Date> {
  const until = new Date(now.getTime() + COOLING_OFF_MS);
  const { rows } = await db.query<{ cooling_until: Date }>(
    `update accounts
        set cooling_from = case when cooling_until > $2 then cooling_from else $2 end,
            cooling_until = greatest(case when cooling_until > $2 then cooling_until end, $3)
      where id = $1 returning cooling_until`,
    [accountId, now, until],
  );
  const end = rows[0]?.cooling_until ?? until;
  await addAlert(db, accountId, 'cooling-off-started', { until: end.toISOString(), reason }, now);
  return end;
}

/** The running cooling-off of the account, or null. */
export async function coolingOf(db: Queryable, accountId: string, now: Date): Promise<{ from: Date; until: Date } | null> {
  const { rows } = await db.query<{ cooling_from: Date | null; cooling_until: Date | null }>(
    'select cooling_from, cooling_until from accounts where id = $1',
    [accountId],
  );
  const r = rows[0];
  if (!r || r.cooling_until === null || r.cooling_from === null || r.cooling_until.getTime() <= now.getTime()) return null;
  return { from: r.cooling_from, until: r.cooling_until };
}

/** preHandler after `requireSession`: 403 `cooling-off` `{ coolingUntil }` while the account cools off. */
export const requireNotCooling: preHandlerAsyncHookHandler = async function (req) {
  const deps = req.server.deps;
  const c = await coolingOf(deps.db, req.auth.accountId, deps.clock());
  if (c !== null) throw new ApiError(403, 'cooling-off', { coolingUntil: c.until.toISOString() });
};

/** What a strong login proved, to tell whether that method predates the cooling-off. */
export type ProvenMethod =
  | { kind: 'pgp'; fingerprints: string[] }
  | { kind: 'webauthn'; credentialId: string }
  | { kind: 'password-totp' };

/**
 * After a strong login: ends a running cooling-off when every credential the login used was held
 * before it started (alert `cooling-off-ended`). Returns true when it ended one.
 */
export async function endCoolingIfOwner(db: Queryable, accountId: string, proven: ProvenMethod, now: Date): Promise<boolean> {
  if (!(await provenBeforeCooling(db, accountId, proven, now))) return false;
  await db.query('update accounts set cooling_from = null, cooling_until = null where id = $1', [accountId]);
  await addAlert(db, accountId, 'cooling-off-ended', { reason: 'strong-login' }, now);
  return true;
}

/**
 * True while the account cools off and every credential a strong login used was held before the
 * cooling started: the real owner. Such a login needs no approval (the approving devices may be the
 * thief's, and they cannot approve during the cooling anyway) and ends the cooling.
 */
export async function provenBeforeCooling(db: Queryable, accountId: string, proven: ProvenMethod, now: Date): Promise<boolean> {
  const c = await coolingOf(db, accountId, now);
  if (c === null) return false;
  let before = false;
  if (proven.kind === 'pgp') {
    const { rows } = await db.query<{ n: number; old: number }>(
      `select count(*)::int as n, count(*) filter (where created_at < $3)::int as old
         from pgp_keys where account_id = $1 and fingerprint = any($2::text[])`,
      [accountId, proven.fingerprints, c.from],
    );
    before = rows[0]!.n > 0 && rows[0]!.n === rows[0]!.old;
  } else if (proven.kind === 'webauthn') {
    const { rows } = await db.query(
      'select 1 from webauthn_credentials where account_id = $1 and credential_id = $2 and created_at < $3',
      [accountId, Buffer.from(proven.credentialId, 'base64url'), c.from],
    );
    before = rows.length > 0;
  } else {
    const { rows } = await db.query(
      `select 1 from passwords p join totp t on t.account_id = p.account_id
        where p.account_id = $1 and p.updated_at < $2 and t.created_at < $2`,
      [accountId, c.from],
    );
    before = rows.length > 0;
  }
  return before;
}

/**
 * Routes that change the password or the login methods. When one succeeds on a weak session
 * (a password-alone login, or a backup login with one weak way), the account cools off.
 */
export const SECURITY_CHANGE_ROUTES: readonly string[] = [
  'PUT /v1/account/password',
  'POST /v1/account/pgp/finish',
  'POST /v1/account/webauthn/finish',
  'POST /v1/account/totp/finish',
  'POST /v1/account/recovery-codes',
  'DELETE /v1/account/methods/:type/:id',
  'POST /v1/account/login-name',
  'PUT /v1/account/security/one-device',
];

/** Routes refused while the account cools off (each carries `requireNotCooling`; the approval decision checks it itself for `choice`). */
export const COOLING_BLOCKED_ROUTES: readonly string[] = [
  'POST /v1/offers',
  'PATCH /v1/offers/:id',
  'POST /v1/offers/:id/take',
  'POST /v1/wallets',
  'DELETE /v1/wallets/:id',
  'POST /v1/account/approvals/:id',
];

/** Registers the hook that starts the cooling-off after a weak session's security change. */
export function securityChangeHook(app: FastifyInstance): void {
  const routes = new Set(SECURITY_CHANGE_ROUTES);
  // Callback style, answering at once for every other route: an async hook on every reply would
  // change how fastify handles a handler that replies twice.
  app.addHook('onSend', (req: FastifyRequest, reply, payload, done) => {
    if (reply.statusCode >= 300 || !req.auth || !routes.has(`${req.method} ${req.routeOptions.url ?? ''}`)) {
      done(null, payload);
      return;
    }
    coolIfWeak(req).then(
      () => done(null, payload),
      (e: unknown) => done(e as Error),
    );
  });
}

async function coolIfWeak(req: FastifyRequest): Promise<void> {
  const deps = req.server.deps;
  const now = deps.clock();
  const { rows } = await deps.db.query<{ strength: SessionStrength | null; kind: string; onboarding_until: Date | null }>(
    'select s.strength, s.onboarding_until, a.kind from sessions s join accounts a on a.id = s.account_id where s.id = $1',
    [req.auth.sessionId],
  );
  const row = rows[0];
  // The sign-up session's first 30 minutes set the new account up: nothing there to protect yet.
  const onboarding = row?.onboarding_until != null && row.onboarding_until.getTime() > now.getTime();
  if (row && row.kind === 'trader' && row.strength !== 'strong' && !onboarding) {
    await startCooling(deps.db, req.auth.accountId, now, 'weak-login-changed-security');
  }
}
