import { normalizeTradeCode, type Role } from '@x2f/core';
import { identityProofValid } from '@x2f/trade';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireSession } from '../auth/sessions.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { ownerDeviceOnly, TRADE_READ } from '../team/perms.js';

/** Reading the attestation: the account owner, or a team member with Trades (Plan 2 Task 18). */
const requireTradesRead = requireSession({ kinds: ['trader'], member: TRADE_READ });
/**
 * Registering a trade identity puts that trade's signing key on the device (R44, spec 3.1): no team
 * member may, until a per-member key scheme exists (Plan 3 Task 42). A Trades member gets 403
 * `member-cannot-sign` (other members `forbidden`), the account owner passes.
 */
const requireSigner = [requireSession({ kinds: ['trader'], member: ['trades-take', 'trades-accept'] }), ownerDeviceOnly];

/** Only buyer and seller register a trade identity; the mod identity is the moderation service's. */
export type TraderRole = Extract<Role, 'buyer' | 'seller'>;

const HEX_KEY = /^[0-9a-f]{64}$/;
const IDENTITY_KEYS = ['signPublic', 'boxPublic', 'proof'] as const;

/** The exact request body for registering an identity: nothing more (so a stray `signSecret` is a 400). */
function identityBody(req: FastifyRequest): { signPublic: string; boxPublic: string; proof: string } {
  const body = req.body;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'bad-request');
  const keys = Object.keys(body as Record<string, unknown>);
  if (keys.length !== IDENTITY_KEYS.length || !IDENTITY_KEYS.every((k) => keys.includes(k))) {
    throw new ApiError(400, 'bad-request');
  }
  const { signPublic, boxPublic, proof } = body as Record<string, unknown>;
  if (typeof signPublic !== 'string' || !HEX_KEY.test(signPublic)) throw new ApiError(400, 'bad-request');
  if (typeof boxPublic !== 'string' || !HEX_KEY.test(boxPublic)) throw new ApiError(400, 'bad-request');
  if (typeof proof !== 'string' || !/^[0-9a-f]{128}$/.test(proof)) throw new ApiError(400, 'bad-request');
  return { signPublic, boxPublic, proof };
}

/**
 * The caller's role in the trade, from the session alone: the account is either the trade's buyer
 * or its seller, never both, and never chooses. A trade that does not exist or does not include
 * the caller is 404 `not-found` (a trader cannot probe other people's trades, and a buyer can
 * never register the seller slot). Also normalizes and returns the stored trade code.
 */
async function roleInTrade(db: Queryable, rawCode: string, accountId: string): Promise<{ code: string; role: TraderRole }> {
  const code = normalizeTradeCode(rawCode);
  if (code === null) throw new ApiError(404, 'not-found');
  const { rows } = await db.query<{ buyer_account_id: string; seller_account_id: string }>(
    'select buyer_account_id, seller_account_id from trades where code = $1',
    [code],
  );
  const trade = rows[0];
  if (!trade) throw new ApiError(404, 'not-found');
  if (trade.buyer_account_id === accountId) return { code, role: 'buyer' };
  if (trade.seller_account_id === accountId) return { code, role: 'seller' };
  throw new ApiError(404, 'not-found');
}

export function tradeIdentityRoutes(app: FastifyInstance): void {
  app.post('/v1/trades/:code/identity', { preHandler: requireSigner }, async (req, reply) => {
    const deps = req.server.deps;
    const { code } = req.params as { code: string };
    const { code: normalized, role } = await roleInTrade(deps.db, code, req.auth.accountId);
    const { signPublic, boxPublic, proof } = identityBody(req);

    // The proof is over THIS trade and THIS (session-derived) role, and boxPublic must be the X25519
    // conversion of signPublic; any failure is `bad-proof` (never says which).
    if (!(await identityProofValid(normalized, role, { signPublic, boxPublic, proof }))) throw new ApiError(400, 'bad-proof');

    // Locked on the trade row, so the two slots are checked and written one at a time: a key the
    // other slot already holds is 409 `identity-conflict`. The moderation service refuses such a
    // trade for good, and refusing it here keeps a same-key trade from ever becoming work.
    const client = await deps.db.connect();
    try {
      await client.query('begin');
      try {
        await client.query('select 1 from trades where code = $1 for update', [normalized]);
        const other = await client.query(
          `select 1 from trade_identities
            where code = $1 and role <> $2 and (sign_public = $3 or box_public = $4)`,
          [normalized, role, signPublic, boxPublic],
        );
        if (other.rows.length > 0) throw new ApiError(409, 'identity-conflict');
        const { rowCount } = await client.query(
          `insert into trade_identities (code, role, sign_public, box_public, proof, created_at)
           values ($1, $2, $3, $4, $5, $6) on conflict (code, role) do nothing`,
          [normalized, role, signPublic, boxPublic, proof, deps.clock()],
        );
        if (rowCount === 0) throw new ApiError(409, 'identity-exists');
        await client.query('commit');
      } catch (e) {
        await client.query('rollback');
        throw e;
      }
    } finally {
      client.release();
    }
    return reply.code(201).send({ ok: true, role });
  });

  app.get('/v1/trades/:code/attestation', { preHandler: requireTradesRead }, async (req, reply) => {
    const deps = req.server.deps;
    const { code } = req.params as { code: string };
    const { code: normalized } = await roleInTrade(deps.db, code, req.auth.accountId);
    const { rows } = await deps.db.query<{ attestation: unknown; sig: string }>(
      'select attestation, sig from trade_attestations where code = $1',
      [normalized],
    );
    const row = rows[0];
    if (!row) {
      // The moderation service refused this trade for good (no reason given): stop waiting.
      const refused = await deps.db.query('select 1 from trade_refusals where code = $1', [normalized]);
      if (refused.rows.length > 0) throw new ApiError(409, 'attestation-refused');
      // The trade closed (e.g. setupBy cancelled it) before any attestation: none will ever come,
      // so the devices stop waiting (review M2).
      const closed = await deps.db.query('select 1 from trades where code = $1 and closed_at is not null', [normalized]);
      if (closed.rows.length > 0) throw new ApiError(409, 'trade-closed');
      // Ready only once the moderation service has posted it, which needs both traders registered.
      return reply.code(202).send({ status: 'pending' });
    }
    return reply.send({ attestation: row.attestation, sig: row.sig });
  });
}
