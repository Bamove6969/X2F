/**
 * Past reputation claims (Plan 5 Task 10; spec 5.5, P5-A20 to P5-A24).
 *
 * - `POST /v1/account/past-rep/start { site, url, claimedTrades, publicKey }` → `{ challengeId,
 *   text, expiresAt }` (60 min). 400 `bad-site`, `bad-url`, the KeyRefusal codes of
 *   `inspectPublicKey(key, now, PAST_REP_INSPECT)`; 409 `site-claimed`. Never says whether another
 *   account claims the key: that is checked only at finish.
 * - `POST /v1/account/past-rep/finish { challengeId, signed }` → 201 `{ id, status: 'signed' }`.
 *   400 `bad-signature`, `wrong-text`, `wrong-key`, `challenge-expired` (also for an unknown id or
 *   another account's challenge); 409 `challenge-used`, `fingerprint-claimed`, `site-claimed`.
 *   The only route that creates a claim, and only after the signature verifies.
 * - `GET /v1/account/past-rep` → the caller's own claims; `DELETE /v1/account/past-rep/:id` → removed.
 *
 * The key is stored only through `storableKey` + `sealKey` under its own AAD (R16); no response or
 * log carries key material or a user ID. The evidence link is never fetched or resolved
 * (tools/semgrep/pastrep-no-fetch.yml). Team members get 403 `owner-only` (the `requireSession`
 * default, Plan 2 Task 18: owner-only until decided). Start and finish are refused during the
 * 24-hour hold (`HOLD_BLOCKED_ROUTES`, owner 1 Nov); start is throttled per account
 * (`PAST_REP_STARTS_PER_HOUR`, 429 `slow-down`). Past reputation never feeds X2F's own counts.
 */
import { PAST_REP_MIN_RSA_BITS, inspectPublicKey, type InspectOptions } from '@x2f/accounts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireNotHeld, withTx } from '../auth/hold.js';
import { requestOrigin } from '../auth/origin.js';
import { PGP_BODY_LIMIT, openKey, sealKey, storableKey } from '../auth/pgp.js';
import { requireSession } from '../auth/sessions.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { PAST_REP_CHALLENGE_MINUTES, checkEvidenceUrl, checkSite, pastRepChallenge, pastRepNonce } from './challenge.js';
import { verifyPastRepSignature } from './verify.js';

/** P5-A22: a past-reputation key only needs to sign, and may be RSA 2048. */
export const PAST_REP_INSPECT: InspectOptions = Object.freeze({ minRsaBits: PAST_REP_MIN_RSA_BITS, requireEncryption: false });

/** The AAD label past-reputation keys are sealed under (`x2f/pastrep-key/<fingerprint>`). */
export const PAST_REP_KEY_AAD = 'x2f/pastrep-key/';

/** Largest `int` the table holds. */
const INT_MAX = 2_147_483_647;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIVE = ['signed', 'approved'];

type ClaimStatus = 'signed' | 'approved' | 'rejected' | 'removed' | 'revoked';

interface ChallengePayload {
  site: string;
  url: string;
  claimedTrades: number;
  fingerprint: string;
  text: string;
  keyEnc: string;
}

function body(req: FastifyRequest): Record<string, unknown> {
  const b = req.body;
  if (b === null || typeof b !== 'object' || Array.isArray(b)) throw new ApiError(400, 'bad-request');
  return b as Record<string, unknown>;
}

function readPayload(p: Record<string, unknown>): ChallengePayload {
  const { site, url, claimedTrades, fingerprint, text, keyEnc } = p;
  if (
    typeof site !== 'string' || typeof url !== 'string' || typeof claimedTrades !== 'number' ||
    typeof fingerprint !== 'string' || typeof text !== 'string' || typeof keyEnc !== 'string'
  ) {
    throw new Error('past-rep challenge payload is malformed');
  }
  return { site, url, claimedTrades, fingerprint, text, keyEnc };
}

const siteClaimed = async (db: Queryable, accountId: string, site: string): Promise<boolean> =>
  (await db.query('select 1 from past_reputation where account_id = $1 and site = $2 and status = any($3::text[])', [accountId, site, LIVE])).rows.length > 0;

export function pastRepRoutes(app: FastifyInstance): void {
  // Owner-only for team members (no `member` option); full trader sessions only (no backup login).
  const requireTrader = requireSession({ kinds: ['trader'] });

  app.post('/v1/account/past-rep/start', { bodyLimit: PGP_BODY_LIMIT, preHandler: [requireTrader, requireNotHeld] }, async (req) => {
    const deps = req.server.deps;
    const now = deps.clock();
    const b = body(req);
    const site = checkSite(b.site);
    const url = checkEvidenceUrl(b.url);
    const claimedTrades = b.claimedTrades;
    if (typeof claimedTrades !== 'number' || !Number.isInteger(claimedTrades) || claimedTrades < 1 || claimedTrades > INT_MAX) {
      throw new ApiError(400, 'bad-request');
    }
    if (typeof b.publicKey !== 'string') throw new ApiError(400, 'bad-request');
    // PAST_REP_STARTS_PER_HOUR per account: taken before the key inspection, after the cheap checks.
    req.server.budgets.pastRepStart.take(req.auth.accountId);
    const inspection = await inspectPublicKey(b.publicKey, now, PAST_REP_INSPECT);
    if (!inspection.ok) throw new ApiError(400, inspection.reason, { detail: inspection.detail });
    const accountId = req.auth.accountId;
    if (await siteClaimed(deps.db, accountId, site)) throw new ApiError(409, 'site-claimed');

    const { rows } = await deps.db.query<{ display_name: string }>('select display_name from accounts where id = $1', [accountId]);
    const displayName = rows[0]?.display_name;
    if (displayName === undefined) throw new ApiError(401, 'not-authenticated');
    const fingerprint = inspection.fingerprint;
    const text = pastRepChallenge({
      origin: requestOrigin(req).origin, displayName, site, url, fingerprint, nonce: pastRepNonce(), issuedAt: now,
    });
    const keyEnc = sealKey(deps.config, await storableKey(b.publicKey, now, PAST_REP_INSPECT), fingerprint, PAST_REP_KEY_AAD).toString('base64');
    const expiresAt = new Date(now.getTime() + PAST_REP_CHALLENGE_MINUTES * 60_000);
    const payload: ChallengePayload = { site, url, claimedTrades, fingerprint, text, keyEnc };
    const inserted = await deps.db.query<{ id: string }>(
      `insert into challenges (account_id, session_id, purpose, method, payload, created_at, expires_at)
       values ($1, $2, 'past-rep', 'pgp', $3, $4, $5) returning id`,
      [accountId, req.auth.sessionId, JSON.stringify(payload), now, expiresAt],
    );
    return { challengeId: inserted.rows[0]!.id, text, expiresAt: expiresAt.toISOString() };
  });

  app.post('/v1/account/past-rep/finish', { bodyLimit: PGP_BODY_LIMIT, preHandler: [requireTrader, requireNotHeld] }, async (req, reply) => {
    const deps = req.server.deps;
    const now = deps.clock();
    const b = body(req);
    const { challengeId, signed } = b;
    if (typeof signed !== 'string') throw new ApiError(400, 'bad-request');
    if (typeof challengeId !== 'string' || !UUID.test(challengeId)) throw new ApiError(400, 'challenge-expired');
    const accountId = req.auth.accountId;

    const { rows } = await deps.db.query<{ account_id: string | null; payload: Record<string, unknown>; expires_at: Date; used_at: Date | null }>(
      `select account_id, payload, expires_at, used_at from challenges where id = $1 and purpose = 'past-rep'`,
      [challengeId],
    );
    const row = rows[0];
    // Another account's challenge answers exactly like an unknown one.
    if (!row || row.account_id !== accountId) throw new ApiError(400, 'challenge-expired');
    if (row.used_at !== null) throw new ApiError(409, 'challenge-used');
    if (row.expires_at.getTime() <= now.getTime()) throw new ApiError(400, 'challenge-expired');
    const c = readPayload(row.payload);
    const sealed = Buffer.from(c.keyEnc, 'base64');
    const armored = openKey(deps.config, sealed, c.fingerprint, PAST_REP_KEY_AAD);

    const verdict = await verifyPastRepSignature(signed, c.text, armored, now);
    if (!verdict.ok) throw new ApiError(400, verdict.reason);
    const signature = signed.replace(/\r\n?/g, '\n').trim();

    const id = await withTx(deps.db, async (db) => {
      const locked = await db.query<{ used_at: Date | null }>('select used_at from challenges where id = $1 for update', [challengeId]);
      if (locked.rows.length === 0) throw new ApiError(400, 'challenge-expired');
      if (locked.rows[0]!.used_at !== null) throw new ApiError(409, 'challenge-used');
      const clash = await db.query('select 1 from past_reputation where fingerprint = $1 and status = any($2::text[])', [c.fingerprint, LIVE]);
      if (clash.rows.length > 0) throw new ApiError(409, 'fingerprint-claimed');
      if (await siteClaimed(db, accountId, c.site)) throw new ApiError(409, 'site-claimed');
      let inserted: string;
      try {
        const r = await db.query<{ id: string }>(
          `insert into past_reputation
             (account_id, site, evidence_url, claimed_trades, fingerprint, key_enc, challenge_text, signature, status, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, 'signed', $9) returning id`,
          [accountId, c.site, c.url, c.claimedTrades, c.fingerprint, sealed, c.text, signature, now],
        );
        inserted = r.rows[0]!.id;
      } catch (e) {
        const err = e as { code?: string; constraint?: string };
        if (err.code === '23505' && err.constraint === 'past_reputation_fingerprint_live') throw new ApiError(409, 'fingerprint-claimed');
        if (err.code === '23505' && err.constraint === 'past_reputation_site_live') throw new ApiError(409, 'site-claimed');
        throw e;
      }
      await db.query('update challenges set used_at = $2 where id = $1', [challengeId, now]);
      return inserted;
    });
    return reply.code(201).send({ id, status: 'signed' as const });
  });

  app.get('/v1/account/past-rep', { preHandler: requireTrader }, async (req) => {
    const { rows } = await req.server.deps.db.query<{
      id: string; site: string; evidence_url: string; claimed_trades: number; verified_trades: number | null; status: ClaimStatus; reason: string | null;
    }>(
      `select id, site, evidence_url, claimed_trades, verified_trades, status, reason
         from past_reputation where account_id = $1 order by created_at desc, id`,
      [req.auth.accountId],
    );
    return rows.map((r) => ({
      id: r.id, site: r.site, url: r.evidence_url, claimedTrades: r.claimed_trades, verifiedTrades: r.verified_trades, status: r.status, reason: r.reason,
    }));
  });

  app.delete<{ Params: { id: string } }>('/v1/account/past-rep/:id', { preHandler: requireTrader }, async (req) => {
    const id = req.params.id;
    if (!UUID.test(id)) throw new ApiError(404, 'not-found');
    const { rows } = await req.server.deps.db.query<{ status: ClaimStatus }>(
      'select status from past_reputation where id = $1 and account_id = $2',
      [id, req.auth.accountId],
    );
    const status = rows[0]?.status;
    if (status === undefined) throw new ApiError(404, 'not-found');
    if (status === 'rejected' || status === 'revoked') throw new ApiError(409, 'wrong-state');
    if (status !== 'removed') {
      await req.server.deps.db.query(
        `update past_reputation set status = 'removed' where id = $1 and account_id = $2 and status = any($3::text[])`,
        [id, req.auth.accountId, LIVE],
      );
    }
    return { id, status: 'removed' as const };
  });
}
