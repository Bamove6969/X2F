import { normalizeTradeCode } from '@x2f/core';
import { BLUR_CHECK_EVERY_NTH_DEFAULT, BLUR_CHECK_EVERY_NTH_MAX, BLUR_KINDS, BlurCheckError, blurCheckDue, isProofId, parseBlurCheckAnswer, ymdEnd, type BlurKind, type BlurCheckSchedule } from '@x2f/proof';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { requireSession } from '../auth/sessions.js';
import { TRADE_READ } from '../team/perms.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { getMethod } from '../methods/profiles.js';
import type { RetentionJob } from '../retention.js';

/**
 * P-012 (owner Q47, 6 Nov 2026) and P-013 (owner p9-8, 8 Nov): "Was this proof blurred correctly?"
 * asked of BOTH parties, every proof for the first weeks, then every Nth proof on the site; a No
 * asks for a comment that goes to the feedback readers (staff perm `feedback.read`,
 * staff/feedback.ts). Migration 367.
 *
 * Proofs are sealed end to end (the API never sees an image), so the uploader's app tells the API a
 * proof was posted, with only its proof id and how it was blurred (`BlurKind`):
 * - `POST /v1/trades/:code/proofs/:proofId/blur-check { blur }` (participant: the uploader) →
 *   `{ ask }`. The first time for a proof id it takes the site's next proof number and decides
 *   (`blurCheckDue` on the owner settings); when due, both parties get an ask. Again for the same
 *   proof id it answers the same and changes nothing. At most BLUR_CHECK_MAX_PROOFS per trade
 *   (409 `too-many-proofs`), so a party cannot inflate the count or the asks.
 * - `GET /v1/trades/:code/blur-checks` (participant) → `{ checks: { proofId, role }[] }`, the
 *   caller's unanswered asks, role `uploader` or `receiver`.
 * - `POST /v1/trades/:code/blur-checks/:proofId { correct, comment? }` (participant) → 204; 404
 *   when the caller has no such ask (never asked, or already answered); 400 with the
 *   @x2f/proof `BlurCheckError` code.
 *
 * What is kept (the owner's minimum): an ask names the trade, the proof id and the side, and goes
 * with its trade (on delete cascade). An answer keeps only the day, the role, Yes/No, the No's
 * comment, the payment method and the blur kind: no trade code, no proof id, no account, no time,
 * never the image. Answers are deleted after BLUR_CHECK_RETENTION_DAYS (90; lead call, the owner may extend it).
 *
 * Settings (owner_settings, whole numbers; a missing or bad row means the default):
 * `blur_check_all_until` YYYYMMDD, every proof through that UTC day (none: every proof, so it fails
 * toward asking); `blur_check_every_nth` 1..1000 (default 10, owner "every tenth or twentieth").
 */

export const BLUR_CHECK_MAX_PROOFS = 20;
export const BLUR_CHECK_RETENTION_DAYS = 90;
export const BLUR_CHECK_SETTING_KEYS = { allUntil: 'blur_check_all_until', everyNth: 'blur_check_every_nth' } as const;
const DAY_MS = 86_400_000;

export async function loadBlurCheckSchedule(db: Queryable): Promise<BlurCheckSchedule> {
  const { rows } = await db.query<{ key: string; value: string }>('select key, value from owner_settings where key = any($1)', [
    Object.values(BLUR_CHECK_SETTING_KEYS),
  ]);
  const num = (k: string) => {
    const v = rows.find((r) => r.key === k)?.value;
    return v === undefined ? NaN : Number(v);
  };
  const until = num(BLUR_CHECK_SETTING_KEYS.allUntil);
  const nth = num(BLUR_CHECK_SETTING_KEYS.everyNth);
  return {
    allUntil: Number.isSafeInteger(until) ? ymdEnd(until) : null,
    everyNth: Number.isSafeInteger(nth) && nth >= 1 && nth <= BLUR_CHECK_EVERY_NTH_MAX ? nth : BLUR_CHECK_EVERY_NTH_DEFAULT,
  };
}

// Security review PC1: a team member works the account's trades, so the routes take the member
// boxes the other trade routes use: listing and answering the asks read the trade (TRADE_READ, as
// the trade room); announcing a proof posts to the trade's chat (`chat-reply`). Without the box a
// member gets 403 `forbidden`; the account owner is unaffected.
const readTrade = requireSession({ kinds: ['trader'], member: TRADE_READ });
const postChat = requireSession({ kinds: ['trader'], member: 'chat-reply' });

function paramsOf(req: FastifyRequest): { code: string; proofId: string | null } {
  const p = req.params as { code?: unknown; proofId?: unknown };
  const code = typeof p.code === 'string' ? normalizeTradeCode(p.code) : null;
  if (code === null) throw new ApiError(404, 'not-found');
  if (p.proofId === undefined) return { code, proofId: null };
  if (!isProofId(p.proofId)) throw new ApiError(400, 'bad-request');
  return { code, proofId: p.proofId };
}

/** The caller's side on the trade (locked when `lock`), or 404 for a stranger or an unknown trade. */
async function sideOf(q: Queryable, code: string, accountId: string, lock = false): Promise<{ side: 'buyer' | 'seller'; methodId: string }> {
  const { rows } = await q.query<{ buyer_account_id: string; seller_account_id: string; method_id: string }>(
    `select buyer_account_id, seller_account_id, method_id from trades where code = $1${lock ? ' for update' : ''}`,
    [code],
  );
  const t = rows[0];
  if (t?.buyer_account_id === accountId) return { side: 'buyer', methodId: t.method_id };
  if (t?.seller_account_id === accountId) return { side: 'seller', methodId: t.method_id };
  throw new ApiError(404, 'not-found');
}

async function inTx<T>(db: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await db.connect();
  try {
    await c.query('begin');
    try {
      const out = await fn(c);
      await c.query('commit');
      return out;
    } catch (e) {
      await c.query('rollback');
      throw e;
    }
  } finally {
    c.release();
  }
}

export function blurCheckRoutes(app: FastifyInstance): void {
  app.post('/v1/trades/:code/proofs/:proofId/blur-check', { preHandler: postChat }, async (req) => {
    const { code, proofId } = paramsOf(req);
    const b = req.body as { blur?: unknown } | null;
    if (b === null || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).some((k) => k !== 'blur')) throw new ApiError(400, 'bad-request');
    if (!(BLUR_KINDS as readonly unknown[]).includes(b.blur)) throw new ApiError(400, 'bad-request');
    const blur = b.blur as BlurKind;
    const deps = req.server.deps;
    return inTx(deps.db, async (c) => {
      // The trade row lock serialises a trade's announcements (the cap and the idempotent repeat).
      const { side } = await sideOf(c, code, req.auth.accountId, true);
      const known = await c.query<{ ask: boolean }>('select ask from blur_check_proofs where trade_code = $1 and proof_id = $2', [code, proofId]);
      if (known.rows[0]) return { ask: known.rows[0].ask };
      const n = await c.query<{ n: string }>('select count(*) as n from blur_check_proofs where trade_code = $1', [code]);
      if (Number(n.rows[0]!.n) >= BLUR_CHECK_MAX_PROOFS) throw new ApiError(409, 'too-many-proofs');
      const counter = await c.query<{ proofs: string }>('update blur_check_counter set proofs = proofs + 1 where id = 1 returning proofs');
      const ask = blurCheckDue(await loadBlurCheckSchedule(c), deps.clock(), Number(counter.rows[0]!.proofs));
      await c.query('insert into blur_check_proofs (trade_code, proof_id, ask) values ($1, $2, $3)', [code, proofId, ask]);
      if (ask) {
        const other = side === 'buyer' ? 'seller' : 'buyer';
        await c.query(
          `insert into blur_check_asks (trade_code, proof_id, side, role, blur) values ($1, $2, $3, 'uploader', $5), ($1, $2, $4, 'receiver', $5)`,
          [code, proofId, side, other, blur],
        );
      }
      return { ask };
    });
  });

  app.get('/v1/trades/:code/blur-checks', { preHandler: readTrade }, async (req) => {
    const { code } = paramsOf(req);
    const db = req.server.deps.db;
    const { side } = await sideOf(db, code, req.auth.accountId);
    const { rows } = await db.query<{ proof_id: string; role: string }>(
      'select proof_id, role from blur_check_asks where trade_code = $1 and side = $2 order by proof_id',
      [code, side],
    );
    return { checks: rows.map((r) => ({ proofId: r.proof_id, role: r.role })) };
  });

  app.post('/v1/trades/:code/blur-checks/:proofId', { preHandler: readTrade }, async (req, reply) => {
    const { code, proofId } = paramsOf(req);
    let answer: { correct: boolean; comment: string | null };
    try {
      answer = parseBlurCheckAnswer(req.body);
    } catch (e) {
      if (e instanceof BlurCheckError) throw new ApiError(400, e.code);
      throw e;
    }
    const deps = req.server.deps;
    await inTx(deps.db, async (c) => {
      const { side, methodId } = await sideOf(c, code, req.auth.accountId);
      const asked = await c.query<{ role: string; blur: string }>(
        'delete from blur_check_asks where trade_code = $1 and proof_id = $2 and side = $3 returning role, blur',
        [code, proofId, side],
      );
      const a = asked.rows[0];
      if (!a) throw new ApiError(404, 'not-found');
      await c.query(
        'insert into blur_check_answers (answered_on, role, correct, comment, method_id, blur) values ($1::date, $2, $3, $4, $5, $6)',
        [deps.clock().toISOString().slice(0, 10), a.role, answer.correct, answer.comment, methodId, a.blur],
      );
    });
    return reply.code(204).send();
  });
}

export interface BlurCheckItem {
  id: string;
  correct: boolean;
  comment: string | null;
  role: 'uploader' | 'receiver';
  /** The payment method's name. */
  method: string;
  blur: BlurKind;
  createdOn: string;
}

/** The staff list (perm feedback.read): newest day first, then by id, 50 a page (keyset, as the feedback form). */
export async function listBlurChecks(db: Queryable, o: { before?: { createdOn: string; id: string } } = {}): Promise<BlurCheckItem[]> {
  const { rows } = await db.query<{ id: string; correct: boolean; comment: string | null; role: 'uploader' | 'receiver'; method_id: string; blur: BlurKind; answered_on: string }>(
    `select id, correct, comment, role, method_id, blur, to_char(answered_on, 'YYYY-MM-DD') as answered_on from blur_check_answers
      where ($1::date is null or (answered_on, id) < ($1::date, $2::uuid))
      order by answered_on desc, id desc limit 50`,
    [o.before?.createdOn ?? null, o.before?.id ?? null],
  );
  return rows.map((r) => ({
    id: r.id, correct: r.correct, comment: r.comment, role: r.role, method: getMethod(r.method_id)?.name ?? r.method_id, blur: r.blur, createdOn: r.answered_on,
  }));
}

/** Yes and No counts over the last 30 days. */
export async function blurCheckCounts(db: Queryable, now: Date): Promise<{ yes: number; no: number }> {
  const since = new Date(now.getTime() - 30 * DAY_MS).toISOString().slice(0, 10);
  const { rows } = await db.query<{ yes: string; no: string }>(
    `select count(*) filter (where correct) as yes, count(*) filter (where not correct) as no from blur_check_answers where answered_on >= $1::date`,
    [since],
  );
  return { yes: Number(rows[0]!.yes), no: Number(rows[0]!.no) };
}

export const purgeBlurChecks: RetentionJob = {
  name: 'purgeBlurChecks',
  async run(db: pg.Pool, now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - BLUR_CHECK_RETENTION_DAYS * DAY_MS).toISOString().slice(0, 10);
    const { rowCount } = await db.query('delete from blur_check_answers where answered_on < $1::date', [cutoff]);
    return rowCount ?? 0;
  },
};
