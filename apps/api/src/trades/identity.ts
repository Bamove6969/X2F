import { normalizeTradeCode, type Role } from '@x2f/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import sodium from 'libsodium-wrappers';
import { requireSession } from '../auth/sessions.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';

/** Trader sessions only (Plan 2 `requireSession({ kinds: ['trader'] })`; 403 `wrong-account-kind`). */
const requireTrader = requireSession({ kinds: ['trader'] });

/** Only buyer and seller register a trade identity; the mod identity is the moderation service's. */
export type TraderRole = Extract<Role, 'buyer' | 'seller'>;

const HEX_KEY = /^[0-9a-f]{64}$/;
const IDENTITY_DOMAIN = 'x2f/trade-identity/v1\0';
const IDENTITY_KEYS = ['signPublic', 'boxPublic', 'proof'] as const;

/**
 * The bytes a trader signs with its trade identity to prove it holds the secret key for the public
 * keys it registers. The role and the trade code bind the proof to one slot of one trade, so a
 * proof for another trade or role cannot be replayed.
 */
function identityProofBytes(code: string, role: TraderRole, signPublic: string, boxPublic: string): Uint8Array {
  return new TextEncoder().encode(`${IDENTITY_DOMAIN}${code}\0${role}\0${signPublic}${boxPublic}`);
}

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
  const { rows } = await db.query<{ buyer_account: string; seller_account: string }>(
    'select buyer_account, seller_account from trades where code = $1',
    [code],
  );
  const trade = rows[0];
  if (!trade) throw new ApiError(404, 'not-found');
  if (trade.buyer_account === accountId) return { code, role: 'buyer' };
  if (trade.seller_account === accountId) return { code, role: 'seller' };
  throw new ApiError(404, 'not-found');
}

export function tradeRoutes(app: FastifyInstance): void {
  app.post('/v1/trades/:code/identity', { preHandler: requireTrader }, async (req, reply) => {
    await sodium.ready;
    const deps = req.server.deps;
    const { code } = req.params as { code: string };
    const { code: normalized, role } = await roleInTrade(deps.db, code, req.auth.accountId);
    const { signPublic, boxPublic, proof } = identityBody(req);

    // boxPublic must be the X25519 conversion of signPublic, and the proof must verify under
    // signPublic; either failing is `bad-proof` (never says which, so it leaks nothing).
    let good = false;
    try {
      const derived = sodium.crypto_sign_ed25519_pk_to_curve25519(sodium.from_hex(signPublic));
      good =
        sodium.to_hex(derived) === boxPublic &&
        sodium.crypto_sign_verify_detached(
          sodium.from_hex(proof),
          identityProofBytes(normalized, role, signPublic, boxPublic),
          sodium.from_hex(signPublic),
        );
    } catch {
      good = false;
    }
    if (!good) throw new ApiError(400, 'bad-proof');

    const { rowCount } = await deps.db.query(
      `insert into trade_identities (code, role, sign_public, box_public, proof, created_at)
       values ($1, $2, $3, $4, $5, $6) on conflict (code, role) do nothing`,
      [normalized, role, signPublic, boxPublic, proof, deps.clock()],
    );
    if (rowCount === 0) throw new ApiError(409, 'identity-exists');
    return reply.code(201).send({ ok: true, role });
  });

  app.get('/v1/trades/:code/attestation', { preHandler: requireTrader }, async (req, reply) => {
    const deps = req.server.deps;
    const { code } = req.params as { code: string };
    const { code: normalized } = await roleInTrade(deps.db, code, req.auth.accountId);
    const { rows } = await deps.db.query<{ attestation: unknown; sig: string }>(
      'select attestation, sig from trade_attestations where code = $1',
      [normalized],
    );
    const row = rows[0];
    // Ready only once the moderation service has posted it, which needs both traders registered.
    if (!row) return reply.code(202).send({ status: 'pending' });
    return reply.send({ attestation: row.attestation, sig: row.sig });
  });
}
