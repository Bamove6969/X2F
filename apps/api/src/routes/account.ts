import type { AccountKind, MethodType } from '@x2f/accounts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Deps } from '../app.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { endSession, requireSession, type SessionLevel } from '../auth/sessions.js';

export type Suggestion = 'add-authenticator' | 'add-backup';

export interface AccountOverview {
  username: string;
  kind: AccountKind;
  /** The calling session's level. */
  level: SessionLevel;
  /** The calling recovery session's hold while it is still ahead (Task 9), else null. */
  holdUntil: string | null;
  methods: MethodType[];
  hasBackup: boolean;
  suggestions: Suggestion[];
  payoutWait: { enabled: boolean; offAt: string | null };
  termsCurrent: boolean;
}

/** How many of each login method an account holds (read straight from the method tables). */
export interface MethodCounts {
  pgp: number;
  passkey: number;
  securityKey: number;
  password: boolean;
  totp: boolean;
  /** Recovery codes not yet used. */
  recoveryCodes: number;
}

/**
 * The account's method counts. Kept to one query here rather than built on Task 10's `listMethods`,
 * so `hasBackup` counts every credential (two passkeys are two) and spent recovery codes are none.
 */
export async function methodCounts(db: Queryable, accountId: string): Promise<MethodCounts> {
  const { rows } = await db.query<{ pgp: number; passkey: number; security_key: number; password: boolean; totp: boolean; recovery: number }>(
    `select (select count(*)::int from pgp_keys where account_id = $1) as pgp,
            (select count(*)::int from webauthn_credentials where account_id = $1 and kind = 'passkey') as passkey,
            (select count(*)::int from webauthn_credentials where account_id = $1 and kind = 'security-key') as security_key,
            exists (select 1 from passwords where account_id = $1) as password,
            exists (select 1 from totp where account_id = $1) as totp,
            (select count(*)::int from recovery_codes where account_id = $1 and used_at is null) as recovery`,
    [accountId],
  );
  const r = rows[0]!;
  return { pgp: r.pgp, passkey: r.passkey, securityKey: r.security_key, password: r.password, totp: r.totp, recoveryCodes: r.recovery };
}

/** The method types present, in `MethodType` order; spent recovery codes are not a method. */
export function methodTypes(c: MethodCounts): MethodType[] {
  const out: MethodType[] = [];
  if (c.pgp > 0) out.push('pgp');
  if (c.passkey > 0) out.push('passkey');
  if (c.securityKey > 0) out.push('security-key');
  if (c.password) out.push('password');
  if (c.totp) out.push('totp');
  if (c.recoveryCodes > 0) out.push('recovery-codes');
  return out;
}

/**
 * R11 (owner, 2026-10-17): a backup is TOTP, unused recovery codes, a second PGP key, or a security
 * key or passkey that is not the account's only primary credential (each PGP key, security key and
 * passkey counts once, a password once). A password is a primary method only and never the backup
 * itself: password + PGP has no backup, password + passkey does (the passkey is the backup).
 */
export function hasBackup(c: MethodCounts): boolean {
  if (c.totp || c.recoveryCodes > 0 || c.pgp >= 2) return true;
  const webauthn = c.passkey + c.securityKey;
  const primaries = c.pgp + webauthn + (c.password ? 1 : 0);
  return webauthn >= 1 && primaries >= 2;
}

export function suggestionsFor(c: MethodCounts): Suggestion[] {
  const out: Suggestion[] = [];
  if (c.password && !c.totp) out.push('add-authenticator');
  if (!hasBackup(c)) out.push('add-backup');
  return out;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A route `:id` that is not a UUID can name no row: 404 like any other id the caller does not own. */
function idParam(req: FastifyRequest): string {
  const id = (req.params as { id?: unknown }).id;
  if (typeof id !== 'string' || !UUID.test(id)) throw new ApiError(404, 'not-found');
  return id;
}

async function overview(deps: Deps, req: FastifyRequest): Promise<AccountOverview> {
  const { accountId, sessionId } = req.auth;
  const { rows } = await deps.db.query<{
    username: string;
    kind: AccountKind;
    payout_wait: boolean;
    payout_wait_off_at: Date | null;
    terms_version: string | null;
    level: SessionLevel;
    hold_until: Date | null;
  }>(
    `select a.username, a.kind, a.payout_wait, a.payout_wait_off_at, a.terms_version, s.level, s.hold_until
       from accounts a join sessions s on s.account_id = a.id
      where a.id = $1 and s.id = $2`,
    [accountId, sessionId],
  );
  const row = rows[0];
  if (!row) throw new ApiError(401, 'not-authenticated');
  const counts = await methodCounts(deps.db, accountId);
  const now = deps.clock();
  const held = row.level === 'recovery' && row.hold_until !== null && now.getTime() < row.hold_until.getTime();
  return {
    username: row.username,
    kind: row.kind,
    level: row.level,
    holdUntil: held ? row.hold_until!.toISOString() : null,
    methods: methodTypes(counts),
    hasBackup: hasBackup(counts),
    suggestions: suggestionsFor(counts),
    payoutWait: { enabled: row.payout_wait, offAt: row.payout_wait_off_at?.toISOString() ?? null },
    // Staff and owner accounts carry no Terms version (R10).
    termsCurrent: row.kind !== 'trader' || row.terms_version === deps.config.termsVersion,
  };
}

/**
 * Task 11: account overview, sessions (devices), alerts and the Terms of Service. Nothing here
 * reads or returns an IP address or user agent; device labels were cleaned by `startSession`.
 *
 * Read routes and marking an alert seen take `allowRecovery` and `allowHeld`, so a held recovery
 * session can see its hold and its alerts (it signs out with `POST /v1/logout`). Ending a session
 * needs a full session: a recovery session must not sign the real owner out during the hold.
 * Accepting the Terms is a change, so it is held like the other changes.
 */
export function accountRoutes(app: FastifyInstance): void {
  const deps = (): Deps => app.deps;
  const readAny = { allowRecovery: true, allowHeld: true } as const;

  app.get('/v1/terms', async () => ({ version: deps().config.termsVersion }));

  app.post(
    '/v1/account/terms',
    { preHandler: requireSession({ allowRecovery: true, allowStaleTerms: true }) },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const d = deps();
      const version = d.config.termsVersion;
      const body = req.body as { version?: unknown } | null | undefined;
      const given = body !== null && typeof body === 'object' ? body.version : undefined;
      if (given !== version) throw new ApiError(400, 'terms-not-accepted', { version });
      await d.db.query('update accounts set terms_version = $2, terms_accepted_at = $3 where id = $1 and kind = $4', [
        req.auth.accountId, version, d.clock(), 'trader',
      ]);
      return reply.code(204).send();
    },
  );

  app.get('/v1/account/me', { preHandler: requireSession({ ...readAny, allowStaleTerms: true }) }, async (req) =>
    overview(deps(), req),
  );

  app.get('/v1/account/sessions', { preHandler: requireSession({ ...readAny, allowStaleTerms: true }) }, async (req) => {
    const d = deps();
    const { rows } = await d.db.query<{ id: string; device_label: string; level: SessionLevel; created_at: Date; last_seen_at: Date }>(
      `select id, device_label, level, created_at, last_seen_at from sessions
        where account_id = $1 and revoked_at is null and expires_at > $2
        order by last_seen_at desc, created_at desc, id`,
      [req.auth.accountId, d.clock()],
    );
    return rows.map((s) => ({
      id: s.id,
      deviceLabel: s.device_label,
      level: s.level,
      createdAt: s.created_at.toISOString(),
      lastSeenAt: s.last_seen_at.toISOString(),
      current: s.id === req.auth.sessionId,
    }));
  });

  app.delete(
    '/v1/account/sessions/:id',
    { preHandler: requireSession({ allowStaleTerms: true }) },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const d = deps();
      const id = idParam(req);
      const { rows } = await d.db.query('select 1 from sessions where id = $1 and account_id = $2', [id, req.auth.accountId]);
      if (rows.length === 0) throw new ApiError(404, 'not-found');
      await endSession(d, id);
      return reply.code(204).send();
    },
  );

  app.get('/v1/account/alerts', { preHandler: requireSession(readAny) }, async (req) => {
    const { rows } = await deps().db.query<{ id: string; kind: string; detail: unknown; created_at: Date; seen_at: Date | null }>(
      `select id, kind, detail, created_at, seen_at from alerts
        where account_id = $1 order by created_at desc, id desc limit 50`,
      [req.auth.accountId],
    );
    return rows.map((a) => ({
      id: a.id,
      kind: a.kind,
      detail: a.detail,
      createdAt: a.created_at.toISOString(),
      seenAt: a.seen_at?.toISOString() ?? null,
    }));
  });

  app.post(
    '/v1/account/alerts/:id/seen',
    { preHandler: requireSession(readAny) },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const d = deps();
      const id = idParam(req);
      const r = await d.db.query('update alerts set seen_at = coalesce(seen_at, $3) where id = $1 and account_id = $2', [
        id, req.auth.accountId, d.clock(),
      ]);
      if ((r.rowCount ?? 0) === 0) throw new ApiError(404, 'not-found');
      return reply.code(204).send();
    },
  );
}
