/**
 * Plan 5 Task 14: the proof routes. PRIVACY: the body is ciphertext the API cannot open; it is
 * stored as is, never parsed, and nothing about it is logged (no id, trade code or size; the app's
 * logger keeps only the method and route pattern and redacts bodies, app.ts R5).
 *
 * - `PUT /v1/trades/:code/proofs/:id?kind=proof|evidence|unblurred`, `application/octet-stream`
 *   only (415 otherwise), 40 bytes to PROOF_MAX_CIPHERTEXT (400 / 413). A party to the trade:
 *   - `proof`: the buyer only (403 wrong-party), in secured | paid | refund_requested | disputed
 *     (409 wrong-state). Not while securing (lead 2026-11-12): no proof before the escrow is
 *     secured, as the web's chat engine refuses its `proof.attached` (`not-ready`);
 *   - `evidence`: either side while a dispute is open (409 wrong-state; P5-A30);
 *   - `unblurred`: only the side the open dispute's moderator asked (Plan 4's `proof_request_*` on
 *     `disputes`), one per request (409 not-requested).
 *   An id ever stored before is 409 proof-exists (one-time ids, kept after a purge); over
 *   PROOF_MAX_PER_SIDE is 409 too-many-proofs. The trade row is locked for the whole check, so
 *   parallel uploads cannot pass the cap. 204, no body.
 * - `GET /v1/trades/:code/proofs/:id`: a party reads a `proof` or `evidence` ciphertext; an
 *   `unblurred` one is 404 to every trader (it is for the moderator only).
 *   NEEDS_P4_CHAT_MEMBERSHIP: no moderator read here (lead 2026-11-08: the moderator's copy follows
 *   the key-membership design, never plaintext through the API).
 *
 * Someone outside the trade gets 404, as for an unknown trade. Owner-only, like the chat: a team
 * member gets 403 owner-only (proof-upload and proof-see-partner are waits-member-chat-key: members
 * hold no chat key that could open a proof).
 */
import { normalizeTradeCode } from '@x2f/core';
import { PROOF_MAX_CIPHERTEXT, isProofId } from '@x2f/proof';
import type { FastifyInstance } from 'fastify';
import { requireSession } from '../auth/sessions.js';
import { ApiError } from '../errors.js';
import { PROOF_MAX_PER_SIDE, PROOF_MIN_CIPHERTEXT, type StoredProofKind, claimProofId, countProofs, insertProof, readableProof } from './store.js';

const KINDS: readonly StoredProofKind[] = ['proof', 'evidence', 'unblurred'];
/** Where the buyer's payment proof belongs: from the escrow arriving to a dispute. */
const PROOF_STATES = new Set(['secured', 'paid', 'refund_requested', 'disputed']);

const requireTrader = requireSession({ kinds: ['trader'] });
const notFound = () => new ApiError(404, 'not-found');
const bad = () => new ApiError(400, 'bad-request');

function target(req: { params: unknown }): { code: string; id: string } {
  const p = req.params as { code: string; id: string };
  const code = normalizeTradeCode(p.code);
  if (code === null) throw notFound();
  if (!isProofId(p.id)) throw bad();
  return { code, id: p.id };
}

export function proofRoutes(app: FastifyInstance): void {
  void app.register(async (scope) => {
    // This scope reads raw octets only: JSON, forms and text are 415 here (and only here).
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: PROOF_MAX_CIPHERTEXT }, (_req, b, done) => done(null, b));

    scope.put('/v1/trades/:code/proofs/:id', { preHandler: requireTrader, bodyLimit: PROOF_MAX_CIPHERTEXT }, async (req, reply) => {
      const { code, id } = target(req);
      const q = req.query as Record<string, unknown>;
      const kind = q.kind;
      if (Object.keys(q).length !== 1 || typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind)) throw bad();
      const ciphertext = req.body;
      if (!Buffer.isBuffer(ciphertext) || ciphertext.length < PROOF_MIN_CIPHERTEXT || ciphertext.length > PROOF_MAX_CIPHERTEXT) throw bad();
      const deps = req.server.deps;
      const me = req.auth.accountId;
      const now = deps.clock();
      const client = await deps.db.connect();
      try {
        await client.query('begin');
        try {
          const { rows } = await client.query<{ buyer_account_id: string; seller_account_id: string; state: string }>(
            'select buyer_account_id, seller_account_id, state from trades where code = $1 for update',
            [code],
          );
          const t = rows[0];
          if (!t || (t.buyer_account_id !== me && t.seller_account_id !== me)) throw notFound();
          const role = t.buyer_account_id === me ? 'buyer' : 'seller';
          if (kind === 'proof') {
            if (role !== 'buyer') throw new ApiError(403, 'wrong-party');
            if (!PROOF_STATES.has(t.state)) throw new ApiError(409, 'wrong-state');
          } else if (kind === 'evidence') {
            const open = await client.query("select 1 from disputes where code = $1 and status <> 'closed' limit 1", [code]);
            if (t.state !== 'disputed' && open.rows.length === 0) throw new ApiError(409, 'wrong-state');
          } else {
            // The open dispute's request names this side, and no unblurred copy from it answers that request yet.
            const r = await client.query(
              `select 1 from disputes d
                where d.code = $1 and d.status <> 'closed' and d.proof_request_side = $2
                  and not exists (select 1 from trade_proofs p where p.trade_code = d.code and p.uploader_role = $2
                                     and p.kind = 'unblurred' and p.created_at >= d.proof_requested_at)
                order by d.seq desc limit 1`,
              [code, role],
            );
            if (r.rows.length === 0) throw new ApiError(409, 'not-requested');
          }
          if ((await countProofs(client, code, role)) >= PROOF_MAX_PER_SIDE) throw new ApiError(409, 'too-many-proofs');
          if (!(await claimProofId(client, id, now))) throw new ApiError(409, 'proof-exists');
          await insertProof(client, { id, code, role, kind: kind as StoredProofKind, ciphertext, now });
          await client.query('commit');
        } catch (e) {
          await client.query('rollback');
          throw e;
        }
      } finally {
        client.release();
      }
      return reply.code(204).send();
    });
  });

  app.get('/v1/trades/:code/proofs/:id', { preHandler: requireTrader }, async (req, reply) => {
    const { code, id } = target(req);
    const deps = req.server.deps;
    const me = req.auth.accountId;
    const { rows } = await deps.db.query<{ party: boolean }>(
      'select (buyer_account_id = $2 or seller_account_id = $2) as party from trades where code = $1',
      [code, me],
    );
    if (!rows[0]?.party) throw notFound();
    const ciphertext = await readableProof(deps.db, code, id);
    if (ciphertext === null) throw notFound();
    return reply
      .header('content-type', 'application/octet-stream')
      .header('cache-control', 'no-store')
      .header('x-content-type-options', 'nosniff')
      .send(ciphertext);
  });
}
