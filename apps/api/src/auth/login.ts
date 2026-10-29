import type { AccountKind, MethodType } from '@x2f/accounts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Deps } from '../app.js';
import { ApiError } from '../errors.js';
import { deviceHash } from './device.js';
import { needsAfter, pairAllowed, parseFactor } from './methods.js';
import { traderLogin, type ApprovalWait } from './approval.js';
import { assertNotDisabled, startSession } from './sessions.js';
import { SECOND_FACTOR_TTL_MS } from './totp.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One proven login factor.
 *
 * A PGP code proves only that the person holds *one of* the keys the challenge was encrypted to:
 * `fingerprints` lists them all (one entry unless the account has several keys and the challenge
 * went to each). `fingerprint` is `fingerprints[0]`, exact only when there is a single entry.
 * The pairing rule for two PGP factors (`pairAllowed`) therefore compares the two `fingerprints`
 * sets (disjoint), never just `fingerprint`; the second step's challenge leaves out every key in
 * the first factor's set, and a staff member's first PGP step goes to one key only.
 */
export type LoginFactor =
  | { method: 'pgp'; fingerprint: string; fingerprints: string[] }
  | { method: 'passkey' | 'security-key'; credentialId: string; attested: boolean };

/**
 * `approve-on-device` (Task 16): a trader's login from a new browser while the account is logged in
 * elsewhere waits for a logged-in device to approve it (`POST /v1/login/approval/:id/poll`).
 */
export type LoginResult = { status: 'ok' } | { status: 'second-factor'; pendingId: string; needs: MethodType[] } | ApprovalWait;

/** A staff or owner login waiting for its second factor lives 5 minutes, as Task 9's password second factor. */
export const PAIR_TTL_MS = SECOND_FACTOR_TTL_MS;

/**
 * The one way every PGP and WebAuthn login finish ends: runs `afterAuthenticate` (it may throw an
 * `ApiError` before anything is created), refuses a disabled account, then:
 * - a trader: a full session (a `pendingId` → 400 `challenge-expired`: traders have no pending login);
 * - staff and the owner always need two factors (R1). Without `pendingId`: a `challenges` row
 *   (purpose `second-factor`, method `pair`, the account, this device, `payload.first` = the
 *   factor, 5 minutes) and `{ status: 'second-factor', pendingId, needs }`, no session (a first
 *   factor that can be in no pair → 403 `method-not-allowed`). With `pendingId`: that row is used up
 *   only when it is this account's open pending login from this device (else 400
 *   `challenge-expired`, and a mismatched request leaves it in place); then `pairAllowed` (else 403
 *   `method-not-allowed`, and the pending login stays used) and only then the session, with the
 *   second factor as its method.
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
  const now = deps.clock();
  const device = deviceHash(req);
  if (a.account.kind === 'trader') {
    if (a.pendingId !== undefined) throw new ApiError(400, 'challenge-expired');
    // Task 16: a session now, or an approval from a logged-in device first.
    return traderLogin(deps, req, reply, { accountId: a.account.id, method: a.factor.method, deviceLabel: a.deviceLabel });
  } else if (a.pendingId === undefined) {
    const needs = needsAfter(a.account.kind, a.factor);
    if (needs.length === 0) throw new ApiError(403, 'method-not-allowed');
    if (device === null) throw new ApiError(400, 'challenge-expired'); // never: every login route sets the device cookie
    const { rows } = await deps.db.query<{ id: string }>(
      `insert into challenges (account_id, device_hash, purpose, method, payload, created_at, expires_at)
       values ($1, $2, 'second-factor', 'pair', $3, $4, $5) returning id`,
      [a.account.id, device, JSON.stringify({ first: a.factor }), now, new Date(now.getTime() + PAIR_TTL_MS)],
    );
    return { status: 'second-factor', pendingId: rows[0]!.id, needs };
  } else {
    if (!UUID.test(a.pendingId) || device === null) throw new ApiError(400, 'challenge-expired');
    const { rows } = await deps.db.query<{ payload: Record<string, unknown> }>(
      `update challenges set used_at = $4
        where id = $1 and account_id = $2 and device_hash = $3 and purpose = 'second-factor' and method = 'pair'
          and used_at is null and expires_at > $4
        returning payload`,
      [a.pendingId, a.account.id, device, now],
    );
    const pending = rows[0];
    if (!pending) throw new ApiError(400, 'challenge-expired');
    const first = parseFactor(pending.payload.first);
    if (first === null || !pairAllowed(a.account.kind, first, a.factor)) throw new ApiError(403, 'method-not-allowed');
  }
  await startSession(deps, req, reply, {
    accountId: a.account.id, level: 'full', deviceLabel: a.deviceLabel, method: a.factor.method, firstSession: false,
  });
  return { status: 'ok' };
}
