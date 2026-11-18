import { reviewMonth } from '@x2f/reputation';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import * as openpgp from 'openpgp';
import { requireInside } from '../auth/frontDoor.js';
import type { PgpSigner } from '../auth/pgp.js';
import { requireSession } from '../auth/sessions.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { reviewHeldSql } from '../traders/finalOutcome.js';
import { traderFacts } from '../traders/summary.js';
import { setRecordPublic } from './prefs.js';
import { hasBlocked } from '../traders/blocks.js';
import { traderIdByName } from './profile.js';

/**
 * Plan 5 Task 12 (API part): the portable reputation record (P5-A18), an OpenPGP cleartext message
 * signed with X2F's official key (Plan 2 R7; X2F cannot sign with the trader's own key).
 *
 * - `GET /v1/account/record` (the account owner's trader session) → `{ text }`, at most once a minute
 *   per account (429 `slow-down` with `retryAfterSeconds`; in memory). `?pgp=1` adds the account's
 *   PGP fingerprints (P5-A35 default: only when the trader asks at export, off by default).
 * - `PUT /v1/account/record/public { on }` → `{ on }`: "Show on my profile" (private by default).
 * - `GET /v1/traders/:name/record` (behind the front door) → `{ text }` only while the record is
 *   public; an unknown name, a private record and a trader who blocked the viewer get the same 404.
 *   The public copy NEVER lists fingerprints (P5-A35).
 *
 * Contents (P5-A18, as revised 2026-10-29b: nothing links a review to who left it): the fixed first
 * line RECORD_HEADER (so a signed login challenge can never pass as a record), the display name,
 * the member-since month, the issue date, completed trades, % positive with its rated reviews, the
 * review count, then one line per review received, newest first: month, the trader's role, stars or
 * Neutral, and the phrases. Never an amount, method, counterparty, note, trade code or exact time.
 * The display name is the only trader-chosen field and cannot hold a line break (spec 6.1 charset).
 */

/** The record's fixed first line (review 2026-10-24: keeps record signatures apart from challenges). */
export const RECORD_HEADER = 'X2F portable reputation record v1';

/** At most this many review lines; older ones are summed up in one line. */
export const RECORD_MAX_LINES = 1000;

/** The private export's limit: one per account per this many milliseconds. */
export const RECORD_EVERY_MS = 60_000;

const ARMOR: openpgp.PartialConfig = { showComment: false, showVersion: false };

const thousands = (n: number) => String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** The record's unsigned text (exported for the tests). */
export async function recordText(q: Queryable, accountId: string, now: Date, opts: { fingerprints: boolean }): Promise<string> {
  const f = (await traderFacts(q, [accountId], now, accountId)).get(accountId);
  if (!f) throw new ApiError(404, 'not-found');
  const s = f.summary;
  const held = reviewHeldSql('r');
  const [{ rows: count }, { rows: reviews }, { rows: keys }] = await Promise.all([
    q.query<{ n: string }>(`select count(*) as n from reviews r where r.subject_id = $1 and not ${held}`, [accountId]),
    q.query<{ reviewer_role: 'buyer' | 'seller'; neutral: boolean; stars: number | null; phrases: string[]; created_at: Date }>(
      `select r.reviewer_role, r.neutral, r.stars, r.phrases, r.created_at from reviews r
        where r.subject_id = $1 and not ${held} order by r.created_at desc, r.id limit $2`,
      [accountId, RECORD_MAX_LINES],
    ),
    opts.fingerprints
      ? q.query<{ fingerprint: string }>('select fingerprint from pgp_keys where account_id = $1 order by fingerprint', [accountId])
      : Promise.resolve({ rows: [] as { fingerprint: string }[] }),
  ]);
  const total = Number(count[0]!.n);
  const lines = [
    RECORD_HEADER,
    '',
    `Display name: ${s.displayName}`,
    `Member since: ${reviewMonth(f.createdAt)}`,
    `Issued: ${now.toISOString().slice(0, 10)}`,
    `Completed trades: ${thousands(s.completedTrades)}`,
    s.positivePct === null ? 'Positive: no rated reviews yet' : `Positive: ${s.positivePct}% of ${thousands(f.ratedReviews)} rated reviews`,
    `Reviews: ${thousands(total)}`,
  ];
  for (const k of keys) lines.push(`PGP fingerprint: ${k.fingerprint.toUpperCase()}`);
  lines.push('', 'Reviews received, newest first (month, role, rating, phrases):');
  for (const r of reviews) {
    // The trader's own role is the other side of the reviewer's.
    const role = r.reviewer_role === 'buyer' ? 'seller' : 'buyer';
    const rating = r.neutral ? 'Neutral' : `${r.stars} ${r.stars === 1 ? 'star' : 'stars'}`;
    lines.push([reviewMonth(r.created_at), role, rating, ...(r.phrases.length > 0 ? [r.phrases.join(', ')] : [])].join(' · '));
  }
  if (total > reviews.length) lines.push(`and ${thousands(total - reviews.length)} earlier reviews`);
  return `${lines.join('\n')}\n`;
}

/** `text` as an OpenPGP cleartext message signed with X2F's official key. */
export async function signRecord(signer: PgpSigner, text: string): Promise<string> {
  const message = await openpgp.createCleartextMessage({ text });
  return openpgp.sign({ message, signingKeys: signer.key, config: ARMOR });
}

export function recordRoutes(app: FastifyInstance): void {
  const trader = requireSession({ kinds: ['trader'] });
  // The private export's limit (in memory, per API process): account id → when the next is allowed.
  const nextAt = new Map<string, number>();
  // The public copy, signed once per content: subject id → the text signed and its signature.
  const signed = new Map<string, { text: string; armored: string }>();

  app.get('/v1/account/record', { preHandler: trader }, async (req) => {
    const deps = req.server.deps;
    const now = deps.clock();
    const id = req.auth.accountId;
    const t = nextAt.get(id);
    if (t !== undefined && t > now.getTime()) throw new ApiError(429, 'slow-down', { retryAfterSeconds: Math.max(1, Math.ceil((t - now.getTime()) / 1000)) });
    if (nextAt.size > 10_000) for (const [k, v] of nextAt) if (v <= now.getTime()) nextAt.delete(k);
    nextAt.set(id, now.getTime() + RECORD_EVERY_MS);
    const pgp = (req.query as { pgp?: unknown }).pgp === '1';
    return { text: await signRecord(deps.pgpSigner, await recordText(deps.db, id, now, { fingerprints: pgp })) };
  });

  app.put('/v1/account/record/public', { preHandler: trader }, async (req) => {
    const b = req.body as { on?: unknown } | null;
    if (b === null || typeof b !== 'object' || Array.isArray(b) || typeof b.on !== 'boolean') throw new ApiError(400, 'bad-request');
    await setRecordPublic(req.server.deps.db, req.auth.accountId, b.on, req.server.deps.clock());
    return { on: b.on };
  });

  app.get('/v1/traders/:name/record', { preHandler: requireInside }, async (req: FastifyRequest) => {
    const deps = req.server.deps;
    const raw = (req.params as { name: string }).name;
    const id = raw.length > 64 ? null : await traderIdByName(deps.db, raw);
    // A trader who blocked the viewer answers as an unknown name does (traders/blocks.ts).
    if (id === null || (await hasBlocked(deps.db, id, req.auth.accountId))) throw new ApiError(404, 'not-found');
    const { rows } = await deps.db.query<{ on: boolean }>('select portable_public as on from badge_prefs where account_id = $1', [id]);
    // A private record answers exactly as an unknown name does.
    if (rows[0]?.on !== true) throw new ApiError(404, 'not-found');
    const text = await recordText(deps.db, id, deps.clock(), { fingerprints: false });
    const hit = signed.get(id);
    if (hit?.text === text) return { text: hit.armored };
    const armored = await signRecord(deps.pgpSigner, text);
    if (signed.size > 1_000) signed.clear();
    signed.set(id, { text, armored });
    return { text: armored };
  });
}
