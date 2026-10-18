import type { AccountKind, MethodType } from '@x2f/accounts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Deps } from '../app.js';
import { ApiError } from '../errors.js';
import { assertNotDisabled, startSession } from './sessions.js';

/** The credential a PGP or WebAuthn login finish just proved (Task 7 interface; Task 10 pairs them). */
export type LoginFactor =
  | { method: 'pgp'; fingerprint: string }
  | { method: 'passkey' | 'security-key'; credentialId: string; attested: boolean };

export type LoginResult = { status: 'ok' } | { status: 'second-factor'; pendingId: string; needs: MethodType[] };

/**
 * The one way every PGP and WebAuthn login finish ends: `afterAuthenticate` (a mount's own check,
 * Plan 4), then `assertNotDisabled`, then for a trader a full session. Staff and the owner always
 * need two factors (R1); until Task 10 replaces this branch with the second-factor flow they get
 * 403 `method-not-allowed` and no session.
 */
export async function completeLogin(
  deps: Deps,
  req: FastifyRequest,
  reply: FastifyReply,
  a: {
    account: { id: string; kind: AccountKind };
    factor: LoginFactor;
    pendingId?: string;
    deviceLabel: string;
    afterAuthenticate?: (accountId: string) => Promise<void>;
  },
): Promise<LoginResult> {
  if (a.afterAuthenticate) await a.afterAuthenticate(a.account.id);
  await assertNotDisabled(deps.db, a.account.id);
  if (a.account.kind !== 'trader') {
    // TODO(Task 10): two-factor branch (pairAllowed, needsAfter, pending `second-factor` row).
    throw new ApiError(403, 'method-not-allowed');
  }
  await startSession(deps, req, reply, {
    accountId: a.account.id, level: 'full', deviceLabel: a.deviceLabel, method: a.factor.method, firstSession: false,
  });
  return { status: 'ok' };
}
