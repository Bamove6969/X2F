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
 *   An id ever stored before is 409 proof-exists (one-time ids, kept after a purge). Over the cap
 *   is 409 too-many-proofs: PROOF_MAX_PER_SIDE payment proofs and, apart, EVIDENCE_MAX_PER_SIDE
 *   pieces of evidence per side; an unblurred copy never counts (one per request already; lead
 *   2026-11-12, review M4). The trade row is locked for the whole check, so parallel uploads
 *   cannot pass the cap, and only for a party (review M2: the party test is in the locking query,
 *   so an outsider never takes or waits on another trade's lock). The session is checked in an
 *   onRequest hook before any of the body is read (review M1), and again before the handler; a
 *   per-account budget (PROOF_PUT_BUCKET, 429 slow-down) is taken there too. 204, no body.
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
import type { FastifyInstance, onRequestAsyncHookHandler } from 'fastify';
import { requireSession } from '../auth/sessions.js';
import { ApiError } from '../errors.js';
import { EVIDENCE_MAX_PER_SIDE, PROOF_MAX_PER_SIDE, PROOF_MIN_CIPHERTEXT, type StoredProofKind, claimProofId, countProofs, insertProof, readableProof } from './store.js';

const KINDS: readonly StoredProofKind[] = ['proof', 'evidence', 'unblurred'];
/** Where the buyer's payment proof belongs: from the escrow arriving to a dispute. */
const PROOF_STATES = new Set(['secured', 'paid', 'refund_requested', 'disputed']);

const requireTrader = requireSession({ kinds: ['trader'] });
/**
 * Review M1: the session is checked in an onRequest hook too, so a PUT with no live session is 401
 * before any of its body is read. The preHandler (the route lists' guard) checks it again after the
 * upload and records the activity; this early check does not touch the session.
 */
const requireTraderFirst = requireSession({ kinds: ['trader'], touch: false }) as unknown as onRequestAsyncHookHandler;
/** Per account, after the early session check and before the body is read: 429 slow-down (PROOF_PUT_BUCKET). */
const proofBudget: onRequestAsyncHookHandler = async (req) => req.server.budgets.proofPut.take(req.auth.accountId);
/** The cap per side for each kind; an unblurred copy has none (one per moderator request). */
const CAP: Readonly<Record<StoredProofKind, number | null>> = { proof: PROOF_MAX_PER_SIDE, evidence: EVIDENCE_MAX_PER_SIDE, unblurred: null };
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

    scope.put('/v1/trades/:code/proofs/:id', { onRequest: [requireTraderFirst, proofBudget], preHandler: requireTrader, bodyLimit: PROOF_MAX_CIPHERTEXT }, async (req, reply) => {
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
          // Only a party's row is locked: an outsider (or an unknown code) matches nothing and is 404.
          const { rows } = await client.query<{ buyer_account_id: string; seller_account_id: string; state: string }>(
            'select buyer_account_id, seller_account_id, state from trades where code = $1 and $2 in (buyer_account_id, seller_account_id) for update',
            [code, me],
          );
          const t = rows[0];
          if (!t) throw notFound();
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
          const cap = CAP[kind as StoredProofKind];
          if (cap !== null && (await countProofs(client, code, role, kind as StoredProofKind)) >= cap) throw new ApiError(409, 'too-many-proofs');
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
