import type { StaffRole } from '@x2f/staff';
import type { FastifyInstance } from 'fastify';
import { withTx } from '../auth/liveSession.js';
import { ApiError } from '../errors.js';
import { appendLog } from '../log/append.js';
import { archivedOriginalHost, groupFingerprint } from '../pastrep/challenge.js';
import { MAX_VERIFIED_USD_CENTS, setVerifiedPastRepUsd, verifiedUsdCentsTextSql } from '../pastrep/store.js';
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
  /**
   * Review M2: the host of the page the archive copied, read from the link (`archivedOriginalHost`),
   * or null when the link does not name it. Shown as plain text beside the full link.
   */
  originalHost: string | null;
}

/** One page of a list: `next` is the cursor of the following page, or null after the last. */
export interface StaffPastRepPage {
  items: StaffPastRepItem[];
  next: string | null;
}

/** The longest display-name filter (spec 6.1 names are far shorter). */
const NAME_FILTER_MAX = 64;
/** A cursor's time: UTC to the microsecond, as the column holds it (re-review M1). */
const CURSOR_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const LIKE_SPECIAL = /[\\%_]/g;

/**
 * A list cursor: the last item's sort time to the microsecond and its id
 * (`2026-11-02T12:00:00.123456Z~<uuid>`), or 400. Re-review M1: the time is Postgres's own text of
 * the column (never a JS Date, which keeps only milliseconds), passed back as text, so rows that
 * differ below a millisecond are neither skipped nor repeated.
 */
function cursorOf(raw: unknown): { at: string; id: string } | null {
  if (raw === undefined) return null;
  const [at, id, ...more] = typeof raw === 'string' ? raw.split('~') : [];
  if (more.length > 0 || at === undefined || id === undefined || !CURSOR_TIME.test(at) || !UUID.test(id) || Number.isNaN(Date.parse(at))) {
    throw new ApiError(400, 'bad-request', { field: 'cursor' });
  }
  return { at, id: id.toLowerCase() };
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
 * - `GET /staff/v1/past-rep?status=signed|approved&cursor=&name=` (perm `reputation.review`; default
 *   `signed`) → `StaffPastRepPage`, at most PAST_REP_LIST_MAX a page. The queue (`signed`) is oldest
 *   first by filing; the approved claims, which only grow, newest first by approval (review M1), so
 *   the newest is always on the first page. `cursor` is the previous page's `next`; `name` keeps the
 *   traders whose display name starts with it (case-insensitive, wildcards taken literally). No key,
 *   signature, challenge text or user ID: the grouped fingerprint and the key id are all staff
 *   compare, with the full link and the archived original's host (review M2).
 * - `POST /staff/v1/past-rep/:id/approve { fingerprintSeen: true, profileSeen: true, tradesSeen }`
 *   (`reputation.review`): 400 `confirm-fingerprint` unless `fingerprintSeen` is exactly true
 *   (P5-A23), 400 `confirm-profile` unless `profileSeen` is (review M2, lead call: the archived page
 *   is the trader's profile on the claimed site); 403 `reviewer-own-key` when the claim's key is one
 *   of the reviewer's own PGP login keys (review M3, lead call); `tradesSeen` a whole
 *   number from 1 to the claimed count (lead default: a moderator never verifies more than the trader
 *   claimed; owner question). A `signed` claim becomes `approved` with `verified_trades`.
 * - `POST …/reject { reason }` (`reputation.review`): reason of PAST_REP_REASON_MIN to
 *   PAST_REP_REASON_MAX characters (trimmed); a `signed` claim becomes `rejected`. The trader reads
 *   the reason on their own list (`GET /v1/account/past-rep`).
 * - `POST …/revoke { reason }` (`reputation.revoke`: senior moderators and the owner): an `approved`
 *   claim becomes `revoked` with the reason, `revoked_by` and `revoked_at` (migration 751, review m3:
 *   `reviewer_id` and `decided_at` keep the approval). It stops counting at once (every reader reads
 *   `approved` only), and its key may claim again (owner item 74; J-21).
 *
 * Approve and reject set `reviewer_id` and `decided_at`; every decision appends one `pastrep.*` entry in the same
 * transaction (claim, trader, site; trades on approval; never the link, fingerprint or reason). The
 * state move is one conditional UPDATE, so two moderators deciding at once cannot both win: the
 * second gets 409 `wrong-state`, as does any decision on a claim in another state; 404 `not-found`
 * for an unknown claim.
 */
function staffPastRepReviewRoutes(app: FastifyInstance): void {
  const review = { config: { perm: 'reputation.review' as const }, preHandler: requireStaff('reputation.review') };
  const revoke = { config: { perm: 'reputation.revoke' as const }, preHandler: requireStaff('reputation.revoke') };

  app.get('/staff/v1/past-rep', review, async (req): Promise<StaffPastRepPage> => {
    const q = req.query as { status?: unknown; cursor?: unknown; name?: unknown };
    const status = q.status ?? 'signed';
    if (typeof status !== 'string' || !(LIST_STATUSES as readonly string[]).includes(status)) throw new ApiError(400, 'bad-request', { field: 'status' });
    const cursor = cursorOf(q.cursor);
    if (q.name !== undefined && (typeof q.name !== 'string' || q.name.length > NAME_FILTER_MAX)) throw new ApiError(400, 'bad-request', { field: 'name' });
    const name = typeof q.name === 'string' && q.name.trim() !== '' ? q.name.trim().toLowerCase().replace(LIKE_SPECIAL, (c) => `\\${c}`) : null;
    // The queue oldest first by filing; approved claims newest first by approval (review M1).
    const queue = status === 'signed';
    // An approved row always has decided_at; the coalesce only keeps a row written without one (an
    // import, a test) in the order instead of first, as a null would sort in a descending order.
    const sortAt = queue ? 'pr.created_at' : 'coalesce(pr.decided_at, pr.created_at)';
    const order = queue ? `${sortAt} asc, pr.id asc` : `${sortAt} desc, pr.id desc`;
    const after = queue ? `(${sortAt}, pr.id) > ($3::timestamptz, $4::uuid)` : `(${sortAt}, pr.id) < ($3::timestamptz, $4::uuid)`;
    const { rows } = await req.server.deps.db.query<{
      id: string; site: string; evidence_url: string; claimed_trades: number; verified_trades: number | null; cents: string | null;
      status: 'signed' | 'approved'; fingerprint: string; display_name: string; created_at: Date; sort_text: string;
    }>(
      `select pr.id, pr.site, pr.evidence_url, pr.claimed_trades, pr.verified_trades, ${verifiedUsdCentsTextSql('pr')} as cents,
              pr.status, pr.fingerprint, a.display_name, pr.created_at,
              to_char(${sortAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as sort_text
         from past_reputation pr join accounts a on a.id = pr.account_id
        where pr.status = $1 and ($3::timestamptz is null or ${after})
          and ($5::text is null or a.display_key like $5 || '%')
        order by ${order} limit $2`,
      [status, PAST_REP_LIST_MAX + 1, cursor?.at ?? null, cursor?.id ?? null, name],
    );
    const more = rows.length > PAST_REP_LIST_MAX;
    const page = rows.slice(0, PAST_REP_LIST_MAX);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => ({
        id: r.id, site: r.site, url: r.evidence_url, claimedTrades: r.claimed_trades, verifiedTrades: r.verified_trades,
        verifiedUsdCents: r.cents === null ? null : Number(r.cents), status: r.status,
        fingerprint: groupFingerprint(r.fingerprint), keyId: r.fingerprint.slice(-16).toUpperCase(), signatureValid: true as const,
        displayName: r.display_name, createdAt: r.created_at.toISOString(), originalHost: archivedOriginalHost(r.evidence_url),
      })),
      next: more && last !== undefined ? `${last.sort_text}~${last.id}` : null,
    };
  });

  /** Moves claim `id` from `from` to `to` in one UPDATE and logs it; 404 / 409 `wrong-state` otherwise. */
  async function decide(
    req: { server: FastifyInstance; staff: { accountId: string; role: StaffRole } },
    id: string, from: 'signed' | 'approved', to: 'approved' | 'rejected' | 'revoked',
    set: { verifiedTrades?: number; reason?: string },
  ): Promise<{ account_id: string; site: string }> {
    const { db, clock } = req.server.deps;
    const now = clock();
    return withTx(db, async (c) => {
      // Review M3 (lead call): never approve a claim backed by one of the reviewer's own login keys.
      if (to === 'approved') {
        const own = await c.query(
          'select 1 from past_reputation pr join pgp_keys k on k.fingerprint = pr.fingerprint where pr.id = $1 and k.account_id = $2',
          [id, req.staff.accountId],
        );
        if (own.rows.length > 0) throw new ApiError(403, 'reviewer-own-key');
      }
      // A revoke keeps the approval's reviewer and time and records its own (review m3, migration 751).
      const who = to === 'revoked' ? 'revoked_by = $4, revoked_at = $5' : 'reviewer_id = $4, decided_at = $5';
      const { rows } = await c.query<{ account_id: string; site: string }>(
        `update past_reputation set status = $3, ${who},
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
        at: now, actor: { kind: 'staff', id: req.staff.accountId, role: req.staff.role }, tradeCode: null,
        action: `pastrep.${to}`, detail: to === 'approved' ? { ...base, trades: set.verifiedTrades! } : base,
      });
      return hit;
    });
  }

  app.post('/staff/v1/past-rep/:id/approve', review, async (req) => {
    const id = claimIdOf(req.params);
    const b = bodyOf(req, ['fingerprintSeen', 'profileSeen', 'tradesSeen']);
    if (b.fingerprintSeen !== true) throw new ApiError(400, 'confirm-fingerprint');
    if (b.profileSeen !== true) throw new ApiError(400, 'confirm-profile');
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
