/**
 * Login-method policy, listing and removal; staff and owner primitives (Task 10).
 *
 * - Which methods an account kind may hold (`allowedMethods`): traders all six; staff PGP, security
 *   keys and passkeys; the owner PGP and security keys. Staff and the owner never get a password,
 *   TOTP or recovery codes (R2), so they have no reset and no backup login.
 * - Staff and the owner always log in with two factors (R1): `pairAllowed` says which two make a
 *   login, `needsAfter` what a first factor still needs; `completeLogin` (login.ts) applies both.
 * - Removing a method never leaves an account unable to log in: at least one primary method, and
 *   for the owner two attested security keys and a PGP key, for staff a valid pair (`removeMethod`);
 *   for staff and the owner only PGP keys usable now count (a revoked or expired key logs in no one).
 */
import { inspectPublicKey, type AccountKind, type MethodType } from '@x2f/accounts';
import type { FastifyInstance, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { Deps } from '../app.js';
import { addAlert } from '../alerts.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import type { Config } from '../config.js';
import { redeemConfirm } from './confirm.js';
import type { LoginFactor } from './login.js';
import { openKey } from './pgp.js';
import { requireSession } from './sessions.js';
import { gateChange, heldReply, pushHoldStarted, requireNotHeld } from './hold.js';

/** Methods that log in on their own (TOTP and recovery codes never do). */
export const PRIMARY: MethodType[] = ['pgp', 'passkey', 'security-key', 'password'];

const ALL: readonly MethodType[] = ['pgp', 'passkey', 'security-key', 'password', 'totp', 'recovery-codes'];

/** The methods an account kind may hold, in display order. */
export function allowedMethods(kind: AccountKind): MethodType[] {
  if (kind === 'trader') return [...ALL];
  // A team member logs in by the staff rule (Plan 2 Task 18, lead default): always two factors.
  if (kind === 'staff' || kind === 'member') return ['pgp', 'security-key', 'passkey'];
  return ['pgp', 'security-key'];
}

export function passwordAllowed(kind: AccountKind): boolean {
  return allowedMethods(kind).includes('password');
}

/** 403 `method-not-allowed` when the account kind may not hold `method`. */
export function assertMethodAllowed(kind: AccountKind, method: MethodType): void {
  if (!allowedMethods(kind).includes(method)) throw new ApiError(403, 'method-not-allowed');
}

/**
 * preHandler (after `requireSession`): `assertMethodAllowed` for the session's account. Placed
 * before `requireConfirm`, so a refusal never uses up a confirm token.
 */
export function methodAllowed(method: MethodType): preHandlerAsyncHookHandler {
  return async function (req: FastifyRequest) {
    assertMethodAllowed(req.auth.kind, method);
  };
}

// ---------------------------------------------------------------------------------------------
// Two factors (R1)

/**
 * The keys a PGP factor proved one of: its `fingerprints` plus `fingerprint`. Empty means it proves
 * nothing (never a real login: every challenge goes to at least one key).
 */
function pgpSet(f: LoginFactor): Set<string> {
  if (f.method !== 'pgp') return new Set();
  const out = new Set<string>();
  for (const x of Array.isArray(f.fingerprints) ? f.fingerprints : []) if (typeof x === 'string' && x !== '') out.add(x);
  if (typeof f.fingerprint === 'string' && f.fingerprint !== '') out.add(f.fingerprint);
  return out;
}

const isPgp = (f: LoginFactor): boolean => f.method === 'pgp' && pgpSet(f).size > 0;
const isAttestedKey = (f: LoginFactor): boolean => f.method === 'security-key' && f.attested === true;
const isPasskey = (f: LoginFactor): boolean => f.method === 'passkey';

/**
 * Whether two factors make a staff or owner login (order does not matter). Owner: PGP and an
 * attested security key. Staff: PGP and an attested security key, PGP and a passkey, or two PGP
 * factors whose key sets have nothing in common (a PGP code proves only "one of the keys it was
 * encrypted to", so the sets must be disjoint). A passkey with a security key, two WebAuthn factors
 * and any trader pair are never a pair.
 */
export function pairAllowed(kind: AccountKind, a: LoginFactor, b: LoginFactor): boolean {
  const pgpWith = (other: (f: LoginFactor) => boolean) => (isPgp(a) && other(b)) || (other(a) && isPgp(b));
  if (kind === 'owner') return pgpWith(isAttestedKey);
  if (kind === 'staff' || kind === 'member') {
    if (pgpWith(isAttestedKey) || pgpWith(isPasskey)) return true;
    if (!isPgp(a) || !isPgp(b)) return false;
    const first = pgpSet(a);
    for (const fp of pgpSet(b)) if (first.has(fp)) return false;
    return true;
  }
  return false;
}

/** What a staff or owner login still needs after `first`; empty when `first` can be in no pair. */
export function needsAfter(kind: AccountKind, first: LoginFactor): MethodType[] {
  if (kind === 'owner') {
    if (isPgp(first)) return ['security-key'];
    if (isAttestedKey(first)) return ['pgp'];
    return [];
  }
  if (kind === 'staff' || kind === 'member') {
    if (isPgp(first)) return ['pgp', 'security-key', 'passkey'];
    if (isAttestedKey(first) || isPasskey(first)) return ['pgp'];
    return [];
  }
  return [];
}

/**
 * Reads a first factor stored in a pending login's payload; null when it does not have the shape
 * of one (then it pairs with nothing).
 */
export function parseFactor(raw: unknown): LoginFactor | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.method === 'pgp') {
    if (typeof r.fingerprint !== 'string' || !Array.isArray(r.fingerprints)) return null;
    if (!r.fingerprints.every((f): f is string => typeof f === 'string')) return null;
    return { method: 'pgp', fingerprint: r.fingerprint, fingerprints: r.fingerprints };
  }
  if (r.method === 'passkey' || r.method === 'security-key') {
    if (typeof r.credentialId !== 'string' || typeof r.attested !== 'boolean') return null;
    return { method: r.method, credentialId: r.credentialId, attested: r.attested };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Usable PGP keys

/**
 * Ids of the account's PGP keys that `inspectPublicKey` accepts at `now` (not revoked, not expired,
 * still strong): the only ones a login challenge goes to. A stored key that cannot be opened counts
 * as unusable.
 */
async function usablePgpIds(db: Queryable, config: Config, accountId: string, now: Date): Promise<Set<string>> {
  const { rows } = await db.query<{ id: string; fingerprint: string; armored_enc: Buffer }>(
    'select id, fingerprint, armored_enc from pgp_keys where account_id = $1',
    [accountId],
  );
  const ok = await Promise.all(
    rows.map(async (r) => {
      try {
        return (await inspectPublicKey(openKey(config, r.armored_enc, r.fingerprint), now)).ok;
      } catch {
        return false;
      }
    }),
  );
  return new Set(rows.filter((_, i) => ok[i]).map((r) => r.id));
}

// ---------------------------------------------------------------------------------------------
// Owner readiness

/**
 * True when the owner has at least 2 attested security keys and at least 1 PGP key usable now
 * (`inspectPublicKey` accepts it; a revoked or expired key cannot log in) (R1). Plan 4 calls it.
 */
export async function ownerReady(deps: Pick<Deps, 'db' | 'config' | 'clock'>, ownerId: string): Promise<boolean> {
  const { rows } = await deps.db.query<{ keys: number }>(
    `select count(*)::int as keys from webauthn_credentials where account_id = $1 and kind = 'security-key' and attested`,
    [ownerId],
  );
  const r = rows[0];
  if (r === undefined || r.keys < 2) return false;
  return (await usablePgpIds(deps.db, deps.config, ownerId, deps.clock())).size >= 1;
}

// ---------------------------------------------------------------------------------------------
// Listing

export interface MethodEntry {
  type: MethodType;
  id: string;
  label: string;
  /**
   * When it was added (a password: when it was last set). Null only for recovery codes: their table
   * keeps no creation time (Task 9's schema) and Task 10 adds no migration.
   */
  createdAt: string | null;
  lastUsedAt: string | null;
}

const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());
const PASSWORD_LABEL = 'Password';
const TOTP_LABEL = 'Authenticator app';
const RECOVERY_LABEL = 'Recovery codes';
/** A PGP key is shown by the last 16 hex characters of its fingerprint (never a user ID). */
const pgpLabel = (fingerprint: string): string => fingerprint.slice(-16);

/**
 * Every login method of the account, in the order of `allowedMethods('trader')`, oldest first
 * within a type. Recovery codes are one entry, `'<n> left'`, last used when the newest was used.
 * Nothing secret: no hashes, no keys, no credential IDs.
 */
export async function listMethods(db: Queryable, accountId: string): Promise<MethodEntry[]> {
  const pgp = await db.query<{ id: string; fingerprint: string; created_at: Date; last_used_at: Date | null }>(
    'select id, fingerprint, created_at, last_used_at from pgp_keys where account_id = $1 order by created_at, id',
    [accountId],
  );
  const creds = await db.query<{ id: string; kind: 'passkey' | 'security-key'; label: string; created_at: Date; last_used_at: Date | null }>(
    'select id, kind, label, created_at, last_used_at from webauthn_credentials where account_id = $1 order by created_at, id',
    [accountId],
  );
  const pw = await db.query<{ updated_at: Date }>('select updated_at from passwords where account_id = $1', [accountId]);
  const totp = await db.query<{ created_at: Date }>('select created_at from totp where account_id = $1', [accountId]);
  const rc = await db.query<{ total: number; unused: number; last_used: Date | null }>(
    `select count(*)::int as total, (count(*) filter (where used_at is null))::int as unused, max(used_at) as last_used
       from recovery_codes where account_id = $1`,
    [accountId],
  );

  const out: MethodEntry[] = [];
  for (const r of pgp.rows) {
    out.push({ type: 'pgp', id: r.id, label: pgpLabel(r.fingerprint), createdAt: iso(r.created_at), lastUsedAt: iso(r.last_used_at) });
  }
  for (const kind of ['passkey', 'security-key'] as const) {
    for (const r of creds.rows.filter((c) => c.kind === kind)) {
      out.push({ type: kind, id: r.id, label: r.label, createdAt: iso(r.created_at), lastUsedAt: iso(r.last_used_at) });
    }
  }
  if (pw.rows[0]) {
    out.push({ type: 'password', id: 'password', label: PASSWORD_LABEL, createdAt: iso(pw.rows[0].updated_at), lastUsedAt: null });
  }
  if (totp.rows[0]) {
    out.push({ type: 'totp', id: 'totp', label: TOTP_LABEL, createdAt: iso(totp.rows[0].created_at), lastUsedAt: null });
  }
  const codes = rc.rows[0];
  if (codes && codes.total > 0) {
    out.push({ type: 'recovery-codes', id: 'recovery-codes', label: `${codes.unused} left`, createdAt: null, lastUsedAt: iso(codes.last_used) });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Removal

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Methods an account holds at most one of: their id is the type's own name. */
const SINGLE: readonly MethodType[] = ['password', 'totp', 'recovery-codes'];
const EXISTS = {
  password: 'select 1 from passwords where account_id = $1',
  totp: 'select 1 from totp where account_id = $1',
  'recovery-codes': 'select 1 from recovery_codes where account_id = $1 limit 1',
} as const;

interface Counts {
  pgp: number;
  /** PGP keys usable now (`usablePgpIds`); the staff and owner minimums count only these. */
  usablePgp: number;
  attestedKeys: number;
  keys: number;
  passkeys: number;
  password: number;
}

async function countsOf(db: Queryable, accountId: string): Promise<Omit<Counts, 'usablePgp'>> {
  const { rows } = await db.query<Omit<Counts, 'usablePgp'>>(
    `select (select count(*)::int from pgp_keys where account_id = $1) as pgp,
            (select count(*)::int from webauthn_credentials where account_id = $1 and kind = 'security-key' and attested) as "attestedKeys",
            (select count(*)::int from webauthn_credentials where account_id = $1 and kind = 'security-key') as keys,
            (select count(*)::int from webauthn_credentials where account_id = $1 and kind = 'passkey') as passkeys,
            (select count(*)::int from passwords where account_id = $1) as password`,
    [accountId],
  );
  return rows[0]!;
}

/** Whether what is left still logs in: a primary method, plus the owner's and staff minimums (R1). */
function leavesLogin(kind: AccountKind, c: Counts): boolean {
  const primary = c.pgp + c.keys + c.passkeys + (passwordAllowed(kind) ? c.password : 0);
  if (primary === 0) return false;
  if (kind === 'owner') return c.attestedKeys >= 2 && c.usablePgp >= 1;
  if (kind === 'staff' || kind === 'member') return c.usablePgp >= 1 && (c.usablePgp >= 2 || c.attestedKeys >= 1 || c.passkeys >= 1);
  return true;
}

/**
 * The method `type`/`id` of the account, its label and what removing it changes, or null when the
 * account has no such method (unknown type, malformed id, another account's, or none).
 */
async function findMethod(
  db: Queryable,
  accountId: string,
  type: string,
  id: string,
): Promise<{ type: MethodType; label: string; less: Partial<Counts> } | null> {
  if (!(ALL as readonly string[]).includes(type)) return null;
  const t = type as MethodType;
  if (SINGLE.includes(t)) {
    if (id !== t) return null;
    const { rows } = await db.query(EXISTS[t as 'password' | 'totp' | 'recovery-codes'], [accountId]);
    if (rows.length === 0) return null;
    const label = t === 'password' ? PASSWORD_LABEL : t === 'totp' ? TOTP_LABEL : RECOVERY_LABEL;
    return { type: t, label, less: t === 'password' ? { password: 1 } : {} };
  }
  if (!UUID.test(id)) return null;
  if (t === 'pgp') {
    const { rows } = await db.query<{ fingerprint: string }>('select fingerprint from pgp_keys where id = $1 and account_id = $2', [id, accountId]);
    return rows[0] ? { type: t, label: pgpLabel(rows[0].fingerprint), less: { pgp: 1 } } : null;
  }
  const { rows } = await db.query<{ label: string; attested: boolean }>(
    'select label, attested from webauthn_credentials where id = $1 and account_id = $2 and kind = $3',
    [id, accountId, t],
  );
  const row = rows[0];
  if (!row) return null;
  const less: Partial<Counts> = t === 'passkey' ? { passkeys: 1 } : { keys: 1, attestedKeys: row.attested ? 1 : 0 };
  return { type: t, label: row.label, less };
}

async function deleteMethod(db: Queryable, accountId: string, type: MethodType, id: string): Promise<void> {
  if (type === 'pgp') await db.query('delete from pgp_keys where id = $1 and account_id = $2', [id, accountId]);
  else if (type === 'passkey' || type === 'security-key') {
    await db.query('delete from webauthn_credentials where id = $1 and account_id = $2 and kind = $3', [id, accountId, type]);
  } else if (type === 'password') await db.query('delete from passwords where account_id = $1', [accountId]);
  else if (type === 'totp') await db.query('delete from totp where account_id = $1', [accountId]);
  else await db.query('delete from recovery_codes where account_id = $1', [accountId]);
}

/**
 * Removes one login method of the request's account (behind `requireSession()`, full sessions
 * only), in one transaction with the account row locked, so two parallel removals cannot both pass
 * the minimum. In order: 404 `not-found` (unknown type or id, another account's method); 409
 * `last-login-method` when what is left would not log in (`leavesLogin`); then the body's
 * `confirmToken` is redeemed for exactly `{ kind: 'remove-method', method: type, id }` (403
 * `confirm-required` / `confirm-invalid`). A refusal before that point leaves the token unused.
 * Then the method is deleted, alert `login-method-removed` `{ method, label }`, every other session
 * of the account ends, and alert `sessions-ended` `{ count, reason }` when any did.
 */
export async function removeMethod(
  deps: Pick<Deps, 'db' | 'config' | 'clock'>,
  req: FastifyRequest,
  type: string,
  id: string,
): Promise<{ status: 'held'; holdUntil: string } | null> {
  const accountId = req.auth.accountId;
  const body = req.body;
  const raw = body !== null && typeof body === 'object' ? (body as Record<string, unknown>).confirmToken : undefined;
  const token = raw === undefined ? undefined : typeof raw === 'string' ? raw : '';
  const client = await deps.db.connect();
  let held: { holdUntil: Date } | null = null;
  let ended = 0;
  try {
    await client.query('begin');
    try {
      const found = await removable(client, deps.config, accountId, type, id, deps.clock());
      await redeemConfirm({ db: client, clock: deps.clock }, req, { kind: 'remove-method', method: found.type, id }, token);
      // Task 17: a waiting login's removal starts the hold and waits in it; the method stays
      // until the hold ends by time (a pre-hold method is never removed early).
      held = await gateChange(client, req, { kind: 'remove-method', type: found.type, id });
      if (held === null) ended = await applyRemoval(client, deps.config, accountId, found.type, id, req.auth.sessionId, deps.clock());
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    }
  } finally {
    client.release();
  }
  if (held !== null) {
    pushHoldStarted(req, accountId);
    return heldReply(held);
  }
  // The other sessions are revoked: end their live streams now, not at the stream lifetime.
  if (ended > 0) req.server.events.closeAccount(accountId, req.auth.sessionId);
  return null;
}

/**
 * With the account row locked: the method, or 404 `not-found` (unknown type or id, another
 * account's method); 409 `last-login-method` when what is left would not log in (`leavesLogin`).
 */
async function removable(db: Queryable, config: Config, accountId: string, type: string, id: string, now: Date) {
  const acct = await db.query<{ kind: AccountKind }>('select kind from accounts where id = $1 for update', [accountId]);
  const kind = acct.rows[0]?.kind;
  if (kind === undefined) throw new ApiError(401, 'not-authenticated');
  const found = await findMethod(db, accountId, type, id);
  if (found === null) throw new ApiError(404, 'not-found');
  // Staff and the owner have no reset (R2): only keys a login challenge can go to count.
  const usable = kind === 'trader' ? null : await usablePgpIds(db, config, accountId, now);
  const counts = await countsOf(db, accountId);
  const after: Counts = { ...counts, usablePgp: usable?.size ?? counts.pgp };
  for (const [k, n] of Object.entries(found.less) as Array<[keyof Counts, number]>) after[k] -= n;
  if (found.type === 'pgp' && (usable === null || usable.has(id))) after.usablePgp -= 1;
  if (!leavesLogin(kind, after)) throw new ApiError(409, 'last-login-method');
  return found;
}

/**
 * The write of a removal (the route's, or a pending one when the hold ends by time; the checks of
 * `removable` run again): the method deleted, alert `login-method-removed` `{ method, label }`,
 * every session but `keepSessionId` ended and alert `sessions-ended` `{ count, reason }` when any
 * did. Returns how many sessions it ended.
 */
export async function applyRemoval(
  db: Queryable,
  config: Config,
  accountId: string,
  type: string,
  id: string,
  keepSessionId: string | null,
  now: Date,
): Promise<number> {
  const found = await removable(db, config, accountId, type, id, now);
  await deleteMethod(db, accountId, found.type, id);
  await addAlert(db, accountId, 'login-method-removed', { method: found.type, label: found.label }, now);
  const ended = await db.query(
    'update sessions set revoked_at = $3 where account_id = $1 and id is distinct from $2 and revoked_at is null',
    [accountId, keepSessionId, now],
  );
  const count = ended.rowCount ?? 0;
  if (count > 0) await addAlert(db, accountId, 'sessions-ended', { count, reason: 'login-method-removed' }, now);
  return count;
}

// ---------------------------------------------------------------------------------------------
// Routes

/**
 * `GET /v1/account/methods` (any session of the account, a held recovery session and a stale Terms
 * version included: it changes nothing) and `DELETE /v1/account/methods/:type/:id { confirmToken }`
 * (full sessions only). `PUT /v1/account/password` lives with the other password routes
 * (password.ts).
 */
export function methodRoutes(app: FastifyInstance): void {
  app.get(
    '/v1/account/methods',
    { preHandler: requireSession({ allowRecovery: true, allowHeld: true, allowStaleTerms: true }) },
    async (req) => listMethods(req.server.deps.db, req.auth.accountId),
  );
  app.delete('/v1/account/methods/:type/:id', { preHandler: [requireSession(), requireNotHeld] }, async (req, reply) => {
    const { type, id } = req.params as { type: string; id: string };
    const held = await removeMethod(req.server.deps, req, type, id);
    if (held !== null) return reply.code(202).send(held);
    return { ok: true };
  });
}
