import { createHash, randomBytes } from 'node:crypto';
import { usablePgpIds } from './methods.js';
import { actionHash, passwordAlone, type ConfirmAction } from '@x2f/accounts';
import type { FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { Deps } from '../app.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { personAccountId } from './sessions.js';

/** A confirm token lives 5 minutes; at exactly 5:00 it is refused. */
export const CONFIRM_TTL_MS = 5 * 60_000;
/** 32 random bytes, base64url without padding. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * R17: the action `requireConfirm` resolved for this request, set once it has been redeemed with
     * a token or exempted (onboarding); null otherwise (and on a recovery session let through by
     * `recovery: true`). A handler acts on exactly this action rather than re-deriving it.
     */
    confirmedAction: ConfirmAction | null;
  }
}

const tokenHash = (token: string): Buffer => createHash('sha256').update(token).digest();

/**
 * How the person proved it was them, recorded on the token by the confirm route that checked the
 * proof (owner, 2026-10-23): `pgp` (a fresh PGP code), `passkey` or `security-key` (the kind of the
 * stored credential whose assertion verified), `password` (with its TOTP code when enrolled).
 * Never taken from the request body.
 */
export type ConfirmMethod = 'pgp' | 'passkey' | 'security-key' | 'password';

/** The methods strong enough that a new payout wallet confirmed with them is usable at once. */
export const STRONG_CONFIRM_METHODS: readonly ConfirmMethod[] = ['pgp', 'passkey', 'security-key'];

/**
 * Issues a single-use token bound to this session and this exact action, recording `method`.
 * Called only by the confirm `finish` routes (Tasks 6-8), after the person has proved it's them.
 */
export async function issueConfirmToken(
  deps: Pick<Deps, 'db' | 'clock'>,
  a: { sessionId: string; accountId: string; action: ConfirmAction; method: ConfirmMethod },
): Promise<string> {
  const now = deps.clock();
  const token = randomBytes(32).toString('base64url');
  await deps.db.query(
    `insert into confirm_tokens (session_id, account_id, token_hash, action_hash, method, created_at, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [a.sessionId, a.accountId, tokenHash(token), await actionHash(a.action), a.method, now, new Date(now.getTime() + CONFIRM_TTL_MS)],
  );
  return token;
}

/**
 * Uses up a confirm token for `action` on the request's session (behind `requireSession`). No
 * token → 403 `confirm-required` `{ action: kind }`; a token that is malformed, unknown, used,
 * expired, from another session or for another action → 403 `confirm-invalid`. A mismatch does not
 * use the token up; the single `update ... returning` makes parallel redemptions succeed once.
 * `deps.db` may be a transaction's client (Task 10's removal redeems inside its transaction).
 * Returns the method the token was earned with.
 */
export async function redeemConfirm(
  deps: { db: Queryable; clock: () => Date },
  req: FastifyRequest,
  action: ConfirmAction,
  token: string | undefined,
): Promise<ConfirmMethod> {
  if (token === undefined) throw new ApiError(403, 'confirm-required', { action: action.kind });
  if (!TOKEN.test(token)) throw new ApiError(403, 'confirm-invalid');
  const { rows } = await deps.db.query(
    `update confirm_tokens set used_at = $5
      where token_hash = $1 and session_id = $2 and account_id = $3 and action_hash = $4
        and used_at is null and expires_at > $5
      returning method`,
    [tokenHash(token), req.auth.sessionId, req.auth.accountId, await actionHash(action), deps.clock()],
  );
  const row = rows[0] as { method: ConfirmMethod } | undefined;
  if (!row) throw new ApiError(403, 'confirm-invalid');
  return row.method;
}

/**
 * The confirm actions a team member may prove with their own login methods (owner, Q73, 6 Nov 2026:
 * "Stay logged in?"). Every other confirm stays the account owner's (Task 18: `owner-only`).
 */
export const MEMBER_CONFIRM_ACTIONS: ReadonlySet<ConfirmAction['kind']> = new Set<ConfirmAction['kind']>(['extend-session']);

/**
 * Whose login methods a confirm route checks: the account's, or for a team member's session (only
 * for MEMBER_CONFIRM_ACTIONS, else 403 `owner-only`) the member's own login account, never the
 * account owner's. The token is still issued to the session and the team account it belongs to.
 */
export async function confirmerOf(
  db: Queryable,
  auth: { accountId: string; memberId: string | null; kind: string },
  action: ConfirmAction,
): Promise<{ accountId: string; kind: 'member' | null }> {
  if (auth.memberId === null) return { accountId: auth.accountId, kind: null };
  if (!MEMBER_CONFIRM_ACTIONS.has(action.kind)) throw new ApiError(403, 'owner-only');
  return { accountId: await personAccountId(db, auth), kind: 'member' };
}

/**
 * Review M5: "Stay logged in?" must work for a session on old Terms (the extend route sets
 * `allowStaleTerms`, as `me` and the session length do), so the confirm routes set it too and this
 * preHandler, placed after `requireSession({ allowStaleTerms: true })` on the routes whose body names
 * the action (password, PGP and WebAuthn start), keeps R10 for every other action: a trader on a
 * stale Terms version gets 403 `terms-required` `{ version }` unless the action is `extend-session`.
 * The finish routes need no check: they redeem a challenge one of these starts issued, and every
 * route that spends a token checks the Terms itself.
 */
export const staleTermsOnlyToExtend: preHandlerAsyncHookHandler = async function (req) {
  const body = req.body;
  const action = body !== null && typeof body === 'object' ? (body as { action?: unknown }).action : undefined;
  if (action !== null && typeof action === 'object' && (action as { kind?: unknown }).kind === 'extend-session') return;
  if (req.auth.kind !== 'trader') return;
  const deps = req.server.deps;
  const { rows } = await deps.db.query<{ terms_version: string | null }>('select terms_version from accounts where id = $1', [req.auth.accountId]);
  if (rows[0]?.terms_version !== deps.config.termsVersion) throw new ApiError(403, 'terms-required', { version: deps.config.termsVersion });
};

/**
 * Security review of sign-up v2, M1(b) (12 Nov 2026): inside the creating session's sign-up window
 * a method may be ADDED without a confirm token, never REPLACED. Each kind the window covers, and
 * how to tell the account already holds one.
 */
const HOLDS = {
  password: 'select 1 from passwords where account_id = $1',
  totp: 'select 1 from totp where account_id = $1',
  'recovery-codes': 'select 1 from recovery_codes where account_id = $1 limit 1',
  pgp: 'select 1 from pgp_keys where account_id = $1 limit 1',
  passkey: "select 1 from webauthn_credentials where account_id = $1 and kind = 'passkey' limit 1",
  'security-key': "select 1 from webauthn_credentials where account_id = $1 and kind = 'security-key' limit 1",
} as const;
export type NewMethodKind = keyof typeof HOLDS;

/**
 * The `onboarding` predicate for `requireConfirm`: true only while the account holds no `kind`
 * yet (a function reads the kind from the request, as the WebAuthn add does).
 */
export function onlyIfNew(kind: NewMethodKind | ((req: FastifyRequest) => NewMethodKind)): (req: FastifyRequest) => Promise<boolean> {
  return async (req) => {
    const k = typeof kind === 'function' ? kind(req) : kind;
    const { rows } = await req.server.deps.db.query(HOLDS[k], [req.auth.accountId]);
    return rows.length === 0;
  };
}

/** Requests that `requireConfirm` let through on the sign-up window alone (no token, not a recovery session). */
const byWindow = new WeakSet<FastifyRequest>();

/** True when this request's change was let through on the sign-up window, with no confirm token. */
export const passedOnWindow = (req: FastifyRequest): boolean => byWindow.has(req);

/**
 * Re-verify R1 (12 Nov 2026): a change let through on the window (at a ceremony's start, or by a
 * one-request route) is checked again where it writes, inside the transaction and after the
 * account row is locked: the window must still be open and the account must still hold no `kind`.
 * Otherwise 403 `confirm-required` `{ action }`, so a second ceremony opened in the window, or one
 * that outlived `onboarding/end`, can neither replace nor double a method; a parallel twin loses.
 */
export async function recheckWindowInTx(db: Queryable, req: FastifyRequest, kind: NewMethodKind, action: ConfirmAction['kind']): Promise<void> {
  const now = req.server.deps.clock();
  const { rows } = await db.query<{ onboarding_until: Date | null }>('select onboarding_until from sessions where id = $1', [req.auth.sessionId]);
  const until = rows[0]?.onboarding_until ?? null;
  const open = until !== null && until.getTime() > now.getTime();
  const held = open ? (await db.query(HOLDS[kind], [req.auth.accountId])).rows.length > 0 : true;
  if (!open || held) throw new ApiError(403, 'confirm-required', { action });
}

/**
 * The kinds of login method the account holds (the keys of HOLDS it has one of). A PGP key counts
 * only when it is usable now (review L4, as methods.ts's password-alone check: an expired or
 * revoked key logs no one in).
 */
async function methodKindsOf(deps: Pick<Deps, 'db' | 'config'>, accountId: string, now: Date): Promise<NewMethodKind[]> {
  const out: NewMethodKind[] = [];
  for (const k of Object.keys(HOLDS) as NewMethodKind[]) {
    if (k === 'pgp') {
      if ((await usablePgpIds(deps.db, deps.config, accountId, now)).size > 0) out.push(k);
    } else if ((await deps.db.query(HOLDS[k], [accountId])).rows.length > 0) out.push(k);
  }
  return out;
}

/**
 * Review M1(a): `POST /v1/account/onboarding/end` closes the caller's own sign-up window (the
 * web app sends it on reaching Welcome). Idempotent; any full session may call it for itself.
 * Re-verify R1: it also uses up this session's open add ceremonies that were started on the
 * window (`payload.window`), so none of them can finish after the window is closed. 409
 * `password-alone` for an account whose only login is a password without TOTP (owner, 16 Nov 2026).
 */
export async function endOnboarding(req: FastifyRequest): Promise<{ ok: true }> {
  const deps = req.server.deps;
  // Owner, 16 Nov 2026: a password does not stand alone, so sign-up does not finish with only a
  // password (409 `password-alone`, the window stays open for the authenticator app or another way
  // to log in).
  if (passwordAlone(await methodKindsOf(deps, req.auth.accountId, deps.clock()))) throw new ApiError(409, 'password-alone');
  await deps.db.query('update sessions set onboarding_until = null where id = $1 and onboarding_until is not null', [req.auth.sessionId]);
  await deps.db.query(
    `update challenges set used_at = $2
      where session_id = $1 and purpose in ('add-totp', 'add-key') and used_at is null and (payload->>'window')::boolean is true`,
    [req.auth.sessionId, deps.clock()],
  );
  return { ok: true };
}

type ActionOf = ConfirmAction | ((req: FastifyRequest) => ConfirmAction | Promise<ConfirmAction>);

/**
 * preHandler, placed after `requireSession`: the route's change needs a confirm token for exactly
 * this action, read from the JSON body's `confirmToken`. There is no "fresh login" exemption.
 * - `onboarding: true` lets the token be omitted while the session's `onboarding_until > now`
 *   (only the creating session has one, for 30 minutes); a function adds the route's own
 *   predicate on top (Task 12: first wallet only).
 * - `recovery: true` lets a recovery session through without a token (add-method routes only;
 *   a held TOTP backup session never gets here: `requireSession` enforces the hold and fails
 *   closed). Otherwise a recovery session gets 403 `recovery-session`: recovery sessions cannot
 *   confirm.
 */
export function requireConfirm(
  action: ActionOf,
  opts: { onboarding?: boolean | ((req: FastifyRequest) => Promise<boolean>); recovery?: boolean } = {},
): preHandlerAsyncHookHandler {
  return async function (req: FastifyRequest) {
    const deps = req.server.deps;
    if (!req.auth) throw new ApiError(401, 'not-authenticated');
    if (req.auth.level === 'recovery') {
      if (opts.recovery) return;
      throw new ApiError(403, 'recovery-session');
    }
    const resolved = typeof action === 'function' ? await action(req) : action;
    const body = req.body;
    const raw = body !== null && typeof body === 'object' ? (body as Record<string, unknown>).confirmToken : undefined;
    if (raw === undefined && opts.onboarding) {
      const until = req.auth.onboardingUntil;
      const inWindow = until !== null && until.getTime() > deps.clock().getTime();
      if (inWindow && (opts.onboarding === true || (await opts.onboarding(req)))) {
        req.confirmedAction = resolved;
        byWindow.add(req);
        return;
      }
    }
    // A present but non-string token (number, null, object) is invalid, never "missing".
    await redeemConfirm(deps, req, resolved, raw === undefined ? undefined : typeof raw === 'string' ? raw : '');
    req.confirmedAction = resolved;
  };
}
