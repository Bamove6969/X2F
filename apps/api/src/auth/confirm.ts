import { createHash, randomBytes } from 'node:crypto';
import { actionHash, type ConfirmAction } from '@x2f/accounts';
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
        return;
      }
    }
    // A present but non-string token (number, null, object) is invalid, never "missing".
    await redeemConfirm(deps, req, resolved, raw === undefined ? undefined : typeof raw === 'string' ? raw : '');
    req.confirmedAction = resolved;
  };
}
