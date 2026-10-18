import type { AccountKind, MethodType } from '@x2f/accounts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Deps } from '../app.js';
import { ApiError } from '../errors.js';
import { assertNotDisabled, startSession } from './sessions.js';

/**
 * One proven login factor.
 *
 * A PGP code proves only that the person holds *one of* the keys the challenge was encrypted to:
 * `fingerprints` lists them all (one entry unless the account has several keys and the challenge
 * went to each). `fingerprint` is `fingerprints[0]`, exact only when there is a single entry.
 * Task 10's pairing rule for two PGP factors must therefore compare the two `fingerprints` sets
 * (disjoint), never just `fingerprint`; the second step's challenge leaves out every key in the
 * first factor's set.
 */
export type LoginFactor =
  | { method: 'pgp'; fingerprint: string; fingerprints: string[] }
  | { method: 'passkey' | 'security-key'; credentialId: string; attested: boolean };

export type LoginResult = { status: 'ok' } | { status: 'second-factor'; pendingId: string; needs: MethodType[] };

/**
 * The one way every PGP and WebAuthn login finish ends: runs `afterAuthenticate` (it may throw an
 * `ApiError` before anything is created), refuses a disabled account, then starts a full session
 * for a trader. Staff and the owner always need two factors (R1); until Task 10 adds that flow
 * (`pairAllowed`, the `second-factor` step) they get 403 `method-not-allowed` and no session.
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
    // TODO(Task 10): the staff and owner two-factor branch (pending `second-factor` challenge, `pairAllowed`).
    throw new ApiError(403, 'method-not-allowed');
  }
  await startSession(deps, req, reply, {
    accountId: a.account.id, level: 'full', deviceLabel: a.deviceLabel, method: a.factor.method, firstSession: false,
  });
  return { status: 'ok' };
}
