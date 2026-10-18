import { createHash, randomBytes } from 'node:crypto';
import { actionHash, type ConfirmAction } from '@x2f/accounts';
import type { FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { Deps } from '../app.js';
import { ApiError } from '../errors.js';

/** A confirm token lives 5 minutes; at exactly 5:00 it is refused. */
export const CONFIRM_TTL_MS = 5 * 60_000;
/** 32 random bytes, base64url without padding. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

const tokenHash = (token: string): Buffer => createHash('sha256').update(token).digest();

/**
 * Issues a single-use token bound to this session and this exact action. Called only by the
 * confirm `finish` routes (Tasks 6-8), after the person has proved it's them.
 */
export async function issueConfirmToken(
  deps: Pick<Deps, 'db' | 'clock'>,
  a: { sessionId: string; accountId: string; action: ConfirmAction },
): Promise<string> {
  const now = deps.clock();
  const token = randomBytes(32).toString('base64url');
  await deps.db.query(
    `insert into confirm_tokens (session_id, account_id, token_hash, action_hash, created_at, expires_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [a.sessionId, a.accountId, tokenHash(token), await actionHash(a.action), now, new Date(now.getTime() + CONFIRM_TTL_MS)],
  );
  return token;
}

/**
 * Uses up a confirm token for `action` on the request's session (behind `requireSession`). No
 * token → 403 `confirm-required` `{ action: kind }`; a token that is malformed, unknown, used,
 * expired, from another session or for another action → 403 `confirm-invalid`. A mismatch does not
 * use the token up; the single `update ... returning` makes parallel redemptions succeed once.
 */
export async function redeemConfirm(
  deps: Pick<Deps, 'db' | 'clock'>,
  req: FastifyRequest,
  action: ConfirmAction,
  token: string | undefined,
): Promise<void> {
  if (token === undefined) throw new ApiError(403, 'confirm-required', { action: action.kind });
  if (!TOKEN.test(token)) throw new ApiError(403, 'confirm-invalid');
  const { rows } = await deps.db.query(
    `update confirm_tokens set used_at = $5
      where token_hash = $1 and session_id = $2 and account_id = $3 and action_hash = $4
        and used_at is null and expires_at > $5
      returning id`,
    [tokenHash(token), req.auth.sessionId, req.auth.accountId, await actionHash(action), deps.clock()],
  );
  if (rows.length === 0) throw new ApiError(403, 'confirm-invalid');
}

type ActionOf = ConfirmAction | ((req: FastifyRequest) => ConfirmAction | Promise<ConfirmAction>);

/**
 * preHandler, placed after `requireSession`: the route's change needs a confirm token for exactly
 * this action, read from the JSON body's `confirmToken`. There is no "fresh login" exemption.
 * - `onboarding: true` lets the token be omitted while the session's `onboarding_until > now`
 *   (only the creating session has one, for 30 minutes); a function adds the route's own
 *   predicate on top (Task 12: first wallet only).
 * - `recovery: true` lets a recovery session through without a token (add-method routes only;
 *   Task 9 adds the hold check there). Otherwise a recovery session gets 403 `recovery-session`:
 *   recovery sessions cannot confirm.
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
      if (inWindow && (opts.onboarding === true || (await opts.onboarding(req)))) return;
    }
    // A present but non-string token (number, null, object) is invalid, never "missing".
    await redeemConfirm(deps, req, resolved, raw === undefined ? undefined : typeof raw === 'string' ? raw : '');
  };
}
