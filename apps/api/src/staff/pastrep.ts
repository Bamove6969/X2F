import type { FastifyInstance } from 'fastify';
import { withTx } from '../auth/hold.js';
import { ApiError } from '../errors.js';
import { appendLog } from '../log/append.js';
import { groupFingerprint } from '../pastrep/challenge.js';
import { MAX_VERIFIED_USD_CENTS, setVerifiedPastRepUsd } from '../pastrep/store.js';
import { requireStaff } from './guard.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `PUT /staff/v1/past-rep/:id/verified-usd { usdCents }` (perm `reputation.verify`: senior moderators
 * and the owner, owner 2026-11-02) sets a live past-reputation claim's verified dollar figure in whole
 * US cents, at most $100,000 (owner Q58); `usdCents: null` clears it. Only through
 * `setVerifiedPastRepUsd`, with the signed-in staff member's role from the database. The activity log
 * gets the claim id and whether it was cleared, never the figure, in the same transaction.
 * Answers: 200 `{ ok: true }`; 400 `bad-request` (a bad body or amount); 404 `not-found`; 409
 * `not-live` (revoked, removed or rejected).
 */
export function staffPastRepRoutes(app: FastifyInstance): void {
  staffPastRepReviewRoutes(app);
  const perm = 'reputation.verify' as const;
  app.put('/staff/v1/past-rep/:id/verified-usd', { config: { perm }, preHandler: requireStaff(perm) }, async (req) => {
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) throw new ApiError(404, 'not-found');
    const body = req.body;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'bad-request');
    const { usdCents, ...rest } = body as Record<string, unknown>;
    if (Object.keys(rest).length > 0) throw new ApiError(400, 'bad-request');
    if (usdCents !== null && !(typeof usdCents === 'number' && Number.isSafeInteger(usdCents) && usdCents > 0 && usdCents <= MAX_VERIFIED_USD_CENTS)) {
      throw new ApiError(400, 'bad-request', { field: 'usdCents' });
    }
    const { db, clock } = req.server.deps;
    const now = clock();
    return withTx(db, async (c) => {
      const r = await setVerifiedPastRepUsd(c, id.toLowerCase(), usdCents, { accountId: req.staff.accountId, role: req.staff.role }, now);
      if (!r.ok) {
        if (r.reason === 'not-found') throw new ApiError(404, 'not-found');
        if (r.reason === 'not-live') throw new ApiError(409, 'not-live');
        if (r.reason === 'bad-amount') throw new ApiError(400, 'bad-request', { field: 'usdCents' });
        throw new ApiError(403, 'forbidden');
      }
      await appendLog(c, {
        at: now, actor: { kind: 'staff', id: req.staff.accountId, role: req.staff.role }, tradeCode: null,
        action: 'pastrep.verified-usd-set', detail: { claimId: id.toLowerCase(), cleared: usdCents === null },
      });
      return { ok: true };
    });
  });
}

/** A reject or revoke reason (trimmed): at least this long (plan), at most PAST_REP_REASON_MAX. */
export const PAST_REP_REASON_MIN = 10;
/** Lead default (owner question): the longest reason a moderator may give. */
export const PAST_REP_REASON_MAX = 500;
/** The most claims one list answer holds, oldest first. */
export const PAST_REP_LIST_MAX = 100;

/** The claims a list may ask for: the queue (`signed`) and the approved ones a senior may revoke. */
const LIST_STATUSES = ['signed', 'approved'] as const;

/** One claim as a moderator sees it: what they need to compare with the archive, nothing more. */
export interface StaffPastRepItem {
  id: string;
  site: string;
  url: string;
  claimedTrades: number;
  verifiedTrades: number | null;
  /** The moderator-verified dollar figure in US cents (migration 310), or null. */
  verifiedUsdCents: number | null;
  status: 'signed' | 'approved';
  /** Upper case in groups of 4: the one thing staff compare with the archived page. */
  fingerprint: string;
  /** The last 16 hex characters, upper case (what older PGP tools show as the key id). */
  keyId: string;
  /** Always true: a claim exists only once its signature verified (Task 10's finish). */
  signatureValid: true;
  /** The trader's public display name (never the login name or account id). */
  displayName: string;
  createdAt: string;
}

/** The activity log's form of a site: an `id` value, so a space becomes '-' ("Hodl Hodl" → "Hodl-Hodl"). */
const logSite = (site: string): string => site.replace(/[^A-Za-z0-9_.:-]/g, '-').slice(0, 64);

function bodyOf(req: { body: unknown }, keys: readonly string[]): Record<string, unknown> {
  const b = req.body;
  if (b === null || typeof b !== 'object' || Array.isArray(b)) throw new ApiError(400, 'bad-request');
  const rec = b as Record<string, unknown>;
  if (Object.keys(rec).some((k) => !keys.includes(k))) throw new ApiError(400, 'bad-request');
  return rec;
}

function reasonOf(raw: unknown): string {
  const reason = typeof raw === 'string' ? raw.trim() : '';
  if (reason.length < PAST_REP_REASON_MIN || reason.length > PAST_REP_REASON_MAX) throw new ApiError(400, 'bad-request', { field: 'reason' });
  return reason;
}

function claimIdOf(params: unknown): string {
  const id = (params as { id?: unknown }).id;
  if (typeof id !== 'string' || !UUID.test(id)) throw new ApiError(404, 'not-found');
  return id.toLowerCase();
}

/**
 * Plan 5 Task 11: moderators review past-reputation claims (spec 5.5; P5-A23). The evidence link is
 * never fetched or resolved here (tools/semgrep/pastrep-no-fetch.yml covers this file): the
 * moderator opens it in their own browser.
 *
 * - `GET /staff/v1/past-rep?status=signed|approved` (perm `reputation.review`; default `signed`) →
 *   `StaffPastRepItem[]`, oldest first, at most PAST_REP_LIST_MAX. No key, signature, challenge text
 *   or user ID: the grouped fingerprint and the key id are all staff compare.
 * - `POST /staff/v1/past-rep/:id/approve { fingerprintSeen: true, tradesSeen }` (`reputation.review`):
 *   400 `confirm-fingerprint` unless `fingerprintSeen` is exactly true (P5-A23); `tradesSeen` a whole
 *   number from 1 to the claimed count (lead default: a moderator never verifies more than the trader
 *   claimed; owner question). A `signed` claim becomes `approved` with `verified_trades`.
 * - `POST …/reject { reason }` (`reputation.review`): reason of PAST_REP_REASON_MIN to
 *   PAST_REP_REASON_MAX characters (trimmed); a `signed` claim becomes `rejected`. The trader reads
 *   the reason on their own list (`GET /v1/account/past-rep`).
 * - `POST …/revoke { reason }` (`reputation.revoke`: senior moderators and the owner): an `approved`
 *   claim becomes `revoked` with the reason. It stops counting at once (every reader reads `approved`
 *   only), and its key may claim again (owner item 74; J-21).
 *
 * Each decision sets `reviewer_id` and `decided_at` and appends one `pastrep.*` entry in the same
 * transaction (claim, trader, site; trades on approval; never the link, fingerprint or reason). The
 * state move is one conditional UPDATE, so two moderators deciding at once cannot both win: the
 * second gets 409 `wrong-state`, as does any decision on a claim in another state; 404 `not-found`
 * for an unknown claim.
 */
function staffPastRepReviewRoutes(app: FastifyInstance): void {
  const review = { config: { perm: 'reputation.review' as const }, preHandler: requireStaff('reputation.review') };
  const revoke = { config: { perm: 'reputation.revoke' as const }, preHandler: requireStaff('reputation.revoke') };

  app.get('/staff/v1/past-rep', review, async (req): Promise<StaffPastRepItem[]> => {
    const raw = (req.query as { status?: unknown }).status ?? 'signed';
    if (typeof raw !== 'string' || !(LIST_STATUSES as readonly string[]).includes(raw)) throw new ApiError(400, 'bad-request', { field: 'status' });
    const { rows } = await req.server.deps.db.query<{
      id: string; site: string; evidence_url: string; claimed_trades: number; verified_trades: number | null; cents: string | null;
      status: 'signed' | 'approved'; fingerprint: string; display_name: string; created_at: Date;
    }>(
      `select pr.id, pr.site, pr.evidence_url, pr.claimed_trades, pr.verified_trades, pr.verified_usd_cents::text as cents,
              pr.status, pr.fingerprint, a.display_name, pr.created_at
         from past_reputation pr join accounts a on a.id = pr.account_id
        where pr.status = $1 order by pr.created_at, pr.id limit $2`,
      [raw, PAST_REP_LIST_MAX],
    );
    return rows.map((r) => ({
      id: r.id, site: r.site, url: r.evidence_url, claimedTrades: r.claimed_trades, verifiedTrades: r.verified_trades,
      verifiedUsdCents: r.cents === null ? null : Number(r.cents), status: r.status,
      fingerprint: groupFingerprint(r.fingerprint), keyId: r.fingerprint.slice(-16).toUpperCase(), signatureValid: true as const,
      displayName: r.display_name, createdAt: r.created_at.toISOString(),
    }));
  });

  /** Moves claim `id` from `from` to `to` in one UPDATE and logs it; 404 / 409 `wrong-state` otherwise. */
  async function decide(
    req: { server: FastifyInstance; staff: { accountId: string; role: string } },
    id: string, from: 'signed' | 'approved', to: 'approved' | 'rejected' | 'revoked',
    set: { verifiedTrades?: number; reason?: string },
  ): Promise<{ account_id: string; site: string }> {
    const { db, clock } = req.server.deps;
    const now = clock();
    return withTx(db, async (c) => {
      const { rows } = await c.query<{ account_id: string; site: string }>(
        `update past_reputation set status = $3, reviewer_id = $4, decided_at = $5,
                verified_trades = coalesce($6, verified_trades), reason = $7
          where id = $1 and status = $2 and ($6::int is null or $6::int <= claimed_trades)
          returning account_id, site`,
        [id, from, to, req.staff.accountId, now, set.verifiedTrades ?? null, set.reason ?? null],
      );
      const hit = rows[0];
      if (hit === undefined) {
        const { rows: found } = await c.query<{ status: string; claimed_trades: number }>('select status, claimed_trades from past_reputation where id = $1', [id]);
        const f = found[0];
        if (f === undefined) throw new ApiError(404, 'not-found');
        if (f.status === from && set.verifiedTrades !== undefined && set.verifiedTrades > f.claimed_trades) throw new ApiError(400, 'bad-request', { field: 'tradesSeen' });
        throw new ApiError(409, 'wrong-state');
      }
      const base = { claimId: id, accountId: hit.account_id, site: logSite(hit.site) };
      await appendLog(c, {
        at: now, actor: { kind: 'staff', id: req.staff.accountId, role: req.staff.role as never }, tradeCode: null,
        action: `pastrep.${to}`, detail: to === 'approved' ? { ...base, trades: set.verifiedTrades! } : base,
      });
      return hit;
    });
  }

  app.post('/staff/v1/past-rep/:id/approve', review, async (req) => {
    const id = claimIdOf(req.params);
    const b = bodyOf(req, ['fingerprintSeen', 'tradesSeen']);
    if (b.fingerprintSeen !== true) throw new ApiError(400, 'confirm-fingerprint');
    const trades = b.tradesSeen;
    if (!(typeof trades === 'number' && Number.isSafeInteger(trades) && trades >= 1 && trades <= 2_147_483_647)) {
      throw new ApiError(400, 'bad-request', { field: 'tradesSeen' });
    }
    await decide(req, id, 'signed', 'approved', { verifiedTrades: trades });
    return { id, status: 'approved' as const, verifiedTrades: trades };
  });

  app.post('/staff/v1/past-rep/:id/reject', review, async (req) => {
    const id = claimIdOf(req.params);
    const reason = reasonOf(bodyOf(req, ['reason']).reason);
    await decide(req, id, 'signed', 'rejected', { reason });
    return { id, status: 'rejected' as const };
  });

  app.post('/staff/v1/past-rep/:id/revoke', revoke, async (req) => {
    const id = claimIdOf(req.params);
    const reason = reasonOf(bodyOf(req, ['reason']).reason);
    await decide(req, id, 'approved', 'revoked', { reason });
    return { id, status: 'revoked' as const };
  });
}
