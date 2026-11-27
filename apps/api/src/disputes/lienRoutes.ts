import { canDecideRateRequest, rateRequestRefusal } from '@x2f/staff';
import { LIEN_RECOVERY_MAX_BPS, isRecoveryAddressStatement, recoveryAddressValid } from '@x2f/trade';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import sodium from 'libsodium-wrappers';
import { requireLiveSessionInTx, withTx } from '../auth/liveSession.js';
import { requireSession } from '../auth/sessions.js';
import { ApiError } from '../errors.js';
import { appendLog } from '../log/append.js';
import { consumeKeyTap } from '../staff/keyTap.js';
import { requireStaff } from '../staff/guard.js';
import { LIEN_FIGURES_SQL, lienFigures, pickRecovery, pickSellerRecovery, type LienFiguresRow } from './recovery.js';
import { applyLienUncollectible } from './lien.js';
import { ownerDeviceOnly } from '../team/perms.js';
import { actorOf, body as bodyOf } from './staffRoutes.js';

/**
 * Lien recovery routes (owner rules 16 Nov 2026; docs/lien-recovery.md).
 *
 * Staff:
 * - `GET /staff/v1/liens/:id` (`disputes.handle`): the lien's figures, its recoveries and rate requests.
 * - `POST /staff/v1/liens/:id/rate { rateBps, reason }` (`disputes.handle`): a moderator proposes a
 *   new rate; a reason is always required (owner: "if they change it at all"). Pending until decided;
 *   the current rate (default 100%, owner 26 Nov 2026) applies meanwhile. One pending request per lien (409 `request-pending`).
 * - `POST /staff/v1/liens/:id/rate/:req/approve { tapId }` (`rulings.approve`): a senior moderator or
 *   the owner, never the proposer (403 `forbidden`), with a `lien-rate` key tap bound to the request
 *   and rate; sets the lien's rate.
 * - `POST /staff/v1/liens/:id/rate/:req/reject {}` (`rulings.approve`): never the proposer.
 * Each is logged (`lien.rate-*`); the reason stays in `lien_rate_requests`, never in the log.
 * NEEDS_STAFF_WEB_LIEN_RATE: the staff site's screen (and its KeyTapDialog caller) is not built.
 *
 * Trader: `accountLienRoutes` below.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function param(req: FastifyRequest, key: string): string {
  const v = (req.params as Record<string, unknown>)[key];
  if (typeof v !== 'string' || !UUID.test(v.toLowerCase())) throw new ApiError(404, 'not-found');
  return v.toLowerCase();
}

interface RequestRow {
  id: string;
  proposed_bps: number;
  reason: string;
  proposed_by: string;
  proposed_at: Date;
  status: 'pending' | 'approved' | 'rejected';
  decided_by: string | null;
  decided_at: Date | null;
}

export function lienRoutes(app: FastifyInstance): void {
  const handle = { preHandler: requireStaff('disputes.handle'), config: { perm: 'disputes.handle' as const } };
  const approver = { preHandler: requireStaff('rulings.approve'), config: { perm: 'rulings.approve' as const } };

  app.get('/staff/v1/liens/:id', handle, async (req) => {
    const db = req.server.deps.db;
    const id = param(req, 'id');
    const row = (await db.query<LienFiguresRow>(`${LIEN_FIGURES_SQL} where l.id = $1`, [id])).rows[0];
    if (!row) throw new ApiError(404, 'not-found');
    const recoveries = await db.query<{ trade_code: string; amount_atomic: string; at: Date }>(
      'select trade_code, amount_atomic::text, at from lien_recoveries where lien_id = $1 order by at, id',
      [id],
    );
    const requests = await db.query<RequestRow>(
      `select id::text, proposed_bps, reason, proposed_by::text, proposed_at, status, decided_by::text, decided_at
         from lien_rate_requests where lien_id = $1 order by proposed_at, id`,
      [id],
    );
    return {
      lien: lienFigures(row),
      recoveries: recoveries.rows.map((r) => ({ tradeCode: r.trade_code, amountAtomic: r.amount_atomic, at: r.at.toISOString() })),
      rateRequests: requests.rows.map((r) => ({
        id: r.id, rateBps: r.proposed_bps, reason: r.reason, proposedBy: r.proposed_by, proposedAt: r.proposed_at.toISOString(),
        status: r.status, decidedBy: r.decided_by, decidedAt: r.decided_at?.toISOString() ?? null,
      })),
    };
  });

  // Owner 26 Nov 2026: the owner writes a lien off as uncollectible, with a tap bound to the lien.
  const owner = { preHandler: requireStaff('settings.write'), config: { perm: 'settings.write' as const } };
  app.post('/staff/v1/liens/:id/uncollectible', owner, async (req) => {
    const id = param(req, 'id');
    const b = bodyOf(req, ['tapId']);
    if (typeof b.tapId !== 'string') throw new ApiError(400, 'bad-request', { field: 'tapId' });
    const me = actorOf(req);
    const { db, clock } = req.server.deps;
    return withTx(db, async (c) => {
      const now = clock();
      const lien = (await c.query<{ status: string }>('select status from liens where id = $1 for update', [id])).rows[0];
      if (!lien) throw new ApiError(404, 'not-found');
      if (lien.status !== 'active' && lien.status !== 'suspended') throw new ApiError(409, 'wrong-state');
      const tap = await consumeKeyTap(c, b.tapId as string, req.staff.accountId, { kind: 'lien-uncollectible', lienId: id }, now, { sessionId: req.auth.sessionId });
      const code = await applyLienUncollectible(c, id, req.staff.accountId, tap.id, now);
      await appendLog(c, { at: now, actor: me, tradeCode: code, action: 'lien.uncollectible', detail: { lienId: id } });
      return { status: 'uncollectible' };
    });
  });

  app.post('/staff/v1/liens/:id/rate', handle, async (req, reply) => {
    const b = bodyOf(req, ['rateBps', 'reason']);
    const refusal = rateRequestRefusal({ rateBps: b.rateBps, reason: b.reason }, LIEN_RECOVERY_MAX_BPS);
    if (refusal !== null) throw new ApiError(400, 'bad-request', { field: refusal === 'bad-rate' ? 'rateBps' : 'reason' });
    const id = param(req, 'id');
    const me = actorOf(req);
    const { db, clock } = req.server.deps;
    const requestId = await withTx(db, async (c) => {
      const now = clock();
      const lien = (await c.query<{ status: string }>('select status from liens where id = $1 for update', [id])).rows[0];
      if (!lien) throw new ApiError(404, 'not-found');
      if (lien.status !== 'active' && lien.status !== 'suspended') throw new ApiError(409, 'wrong-state');
      const pending = await c.query(`select 1 from lien_rate_requests where lien_id = $1 and status = 'pending'`, [id]);
      if ((pending.rowCount ?? 0) > 0) throw new ApiError(409, 'request-pending');
      const r = await c.query<{ id: string }>(
        `insert into lien_rate_requests (lien_id, proposed_bps, reason, proposed_by, proposed_at) values ($1, $2, $3, $4, $5) returning id::text`,
        [id, b.rateBps, b.reason, me.id, now],
      );
      const requestId = r.rows[0]!.id;
      await appendLog(c, { at: now, actor: me, tradeCode: null, action: 'lien.rate-proposed', detail: { lienId: id, requestId, rateBps: b.rateBps as number } });
      return requestId;
    });
    return reply.code(201).send({ id: requestId, status: 'pending' });
  });

  /** The pending request `:req` of lien `:id`, locked, with the lien locked first; refuses its proposer. */
  async function pendingFor(c: import('pg').PoolClient, req: FastifyRequest): Promise<{ lienId: string; r: RequestRow }> {
    const lienId = param(req, 'id');
    const requestId = param(req, 'req');
    const lien = (await c.query<{ status: string }>('select status from liens where id = $1 for update', [lienId])).rows[0];
    if (!lien) throw new ApiError(404, 'not-found');
    const r = (
      await c.query<RequestRow>(
        `select id::text, proposed_bps, reason, proposed_by::text, proposed_at, status, decided_by::text, decided_at
           from lien_rate_requests where id = $1 and lien_id = $2 for update`,
        [requestId, lienId],
      )
    ).rows[0];
    if (!r) throw new ApiError(404, 'not-found');
    if (r.status !== 'pending') throw new ApiError(409, 'wrong-state');
    if (!canDecideRateRequest({ role: req.staff.role, id: req.staff.accountId }, r.proposed_by)) throw new ApiError(403, 'forbidden');
    return { lienId, r };
  }

  app.post('/staff/v1/liens/:id/rate/:req/approve', approver, async (req) => {
    const b = bodyOf(req, ['tapId']);
    if (typeof b.tapId !== 'string') throw new ApiError(400, 'bad-request');
    const tapId = b.tapId;
    const me = actorOf(req);
    const { db, clock } = req.server.deps;
    return withTx(db, async (c) => {
      const now = clock();
      const { lienId, r } = await pendingFor(c, req);
      const lien = (await c.query<{ status: string }>('select status from liens where id = $1', [lienId])).rows[0]!;
      if (lien.status !== 'active' && lien.status !== 'suspended') throw new ApiError(409, 'wrong-state');
      await consumeKeyTap(c, tapId, me.id, { kind: 'lien-rate', lienId, requestId: r.id, rateBps: r.proposed_bps }, now, { sessionId: req.auth.sessionId });
      await c.query(`update lien_rate_requests set status = 'approved', decided_by = $2, decided_at = $3 where id = $1`, [r.id, me.id, now]);
      await c.query('update liens set recovery_rate_bps = $2 where id = $1', [lienId, r.proposed_bps]);
      await appendLog(c, { at: now, actor: me, tradeCode: null, action: 'lien.rate-approved', detail: { lienId, requestId: r.id, rateBps: r.proposed_bps } });
      return { id: r.id, status: 'approved', rateBps: r.proposed_bps };
    });
  });

  app.post('/staff/v1/liens/:id/rate/:req/reject', approver, async (req) => {
    bodyOf(req, []);
    const me = actorOf(req);
    const { db, clock } = req.server.deps;
    return withTx(db, async (c) => {
      const now = clock();
      const { lienId, r } = await pendingFor(c, req);
      await c.query(`update lien_rate_requests set status = 'rejected', decided_by = $2, decided_at = $3 where id = $1`, [r.id, me.id, now]);
      await appendLog(c, { at: now, actor: me, tradeCode: null, action: 'lien.rate-rejected', detail: { lienId, requestId: r.id } });
      return { id: r.id, status: 'rejected' };
    });
  });
}

/** How long ahead of the API's clock a creditor device's signed `issuedAt` may be (its clock may run fast). */
const ADDRESS_CLOCK_SKEW_MS = 5 * 60_000;

/**
 * The trader's own liens:
 * - `GET /v1/account/liens`: as debtor, each active or suspended lien's owed, recovered, left and
 *   rate; as creditor (review M4, provisional owner answer Q4: totals only), each lien's owed,
 *   recovered and left, its source trade (the creditor's own, to sign the address with) and whether
 *   a recovery address is set; never the debtor's purchases (no per-trade rows, no times, no rate),
 *   no account ids, no addresses.
 * - `GET /v1/account/liens/preview?offerId&amountAtomic&walletId` (review B1): the recovery taking
 *   that offer for that amount to that wallet would reserve now (`pickRecovery`), for the buyer's
 *   quote to show and the buyer to accept; the take refuses any other figure. Owner 27 Nov 2026: a
 *   taker who SELLS into a buy ad gets `sellerLienRecoveryAtomic` instead, the extra they would fund
 *   for their own lien (`pickSellerRecovery`), for the seller's quote to show and the seller to
 *   accept; the take refuses any other figure (409 `lien-recovery-changed`). A buyer is never told
 *   of the seller's lien (the buyer's figure only leaves out an address the seller's recovery uses).
 * - `POST /v1/account/liens/:id/recovery-address { statement, sig }` (Q2): the creditor's device's
 *   signed "pay my recoveries to X" (@x2f/trade RecoveryAddressStatement), signed with its trade
 *   identity from the disputed trade; checked here against that identity, refused for an address
 *   another account holds as a wallet or X2F's fee wallet (review B2), and checked again by the
 *   moderation service against its own record of that identity before any recovery is signed. The
 *   owner's device only, a live session (checked in the transaction), never during a hold.
 */
export function accountLienRoutes(app: FastifyInstance): void {
  app.get('/v1/account/liens', { preHandler: requireSession({ kinds: ['trader'] }) }, async (req) => {
    const db = req.server.deps.db;
    const me = req.auth.accountId;
    const rows = (
      await db.query<LienFiguresRow & { address_set: boolean }>(
        `${LIEN_FIGURES_SQL.replace('from liens l', ', l.creditor_address is not null as address_set from liens l')}
          where (l.debtor_account_id = $1 or l.creditor_account_id = $1) and l.status in ('active', 'suspended', 'repaid')
          order by l.created_at, l.id`,
        [me],
      )
    ).rows;
    const owes = rows
      .filter((x) => x.debtor === me && x.status !== 'repaid')
      .map((r) => {
        const f = lienFigures(r);
        return { id: f.id, status: f.status, amountAtomic: f.amountAtomic, recoveredAtomic: f.recoveredAtomic, remainingAtomic: f.remainingAtomic, rateBps: f.rateBps, defaultRateBps: f.defaultRateBps, fromCode: f.fromCode };
      });
    const owedTo = rows
      .filter((x) => x.creditor === me)
      .map((r) => {
        const f = lienFigures(r);
        return { id: f.id, status: f.status, amountAtomic: f.amountAtomic, recoveredAtomic: f.recoveredAtomic, remainingAtomic: f.remainingAtomic, fromCode: f.fromCode, recoveryAddressSet: r.address_set };
      });
    return { owes, owedTo };
  });

  app.get('/v1/account/liens/preview', { preHandler: requireSession({ kinds: ['trader'] }) }, async (req) => {
    const { db, clock } = req.server.deps;
    const me = req.auth.accountId;
    const q = (req.query ?? {}) as Record<string, unknown>;
    const offerId = typeof q.offerId === 'string' ? q.offerId.toLowerCase() : '';
    const amount = typeof q.amountAtomic === 'string' && /^[1-9]\d{0,30}$/.test(q.amountAtomic) ? BigInt(q.amountAtomic) : null;
    const walletId = typeof q.walletId === 'string' ? q.walletId.toLowerCase() : '';
    if (!UUID.test(offerId) || amount === null || !UUID.test(walletId)) throw new ApiError(400, 'bad-request');
    const offer = (await db.query<{ account_id: string; side: string }>('select account_id::text, side from offers where id = $1', [offerId])).rows[0];
    if (offer === undefined || (offer.side !== 'sell' && offer.side !== 'buy') || offer.account_id === me) return { lienRecoveryAtomic: '0' };
    const w = (await db.query<{ address: string | null }>('select address from wallets where id = $1 and account_id = $2 and removed_at is null', [walletId, me])).rows[0];
    const wallets = { feeWallet: req.server.deps.config.feeWallet ?? null, payrollWallet: req.server.deps.config.payrollWallet ?? null };
    const now = clock();
    if (offer.side === 'buy') {
      // A taker who sells: the extra for their own lien, as the take works it out (before the buyer's).
      const s = await pickSellerRecovery(db, { buyerId: offer.account_id, sellerId: me, takeAmountAtomic: amount, ownAddresses: [w?.address ?? null], ...wallets, now }, false);
      return { lienRecoveryAtomic: '0', sellerLienRecoveryAtomic: (s?.amountAtomic ?? 0n).toString() };
    }
    // A taker who buys from a seller's ad: their proceeds' recovery. The take picks the seller's first
    // and never pays both to one address, so its address is left out here too (nothing else of it).
    const s = await pickSellerRecovery(db, { buyerId: me, sellerId: offer.account_id, takeAmountAtomic: amount, ownAddresses: [w?.address ?? null], ...wallets, now }, false);
    const r = await pickRecovery(db, { buyerId: me, sellerId: offer.account_id, proceedsAtomic: amount, ownAddresses: [w?.address ?? null, s?.address ?? null], ...wallets, now }, false);
    return { lienRecoveryAtomic: (r?.amountAtomic ?? 0n).toString() };
  });

  app.post('/v1/account/liens/:id/recovery-address', { preHandler: [requireSession({ kinds: ['trader'] }), ownerDeviceOnly] }, async (req, reply) => {
    const b = bodyOf(req, ['statement', 'sig']);
    const id = param(req, 'id');
    const me = req.auth.accountId;
    const { db, clock } = req.server.deps;
    await withTx(db, async (c) => {
      const now = clock();
      // Where the creditor's money goes: the session must still be live, under the account lock (LIVE_SESSION_ROUTES).
      await requireLiveSessionInTx(c, req.auth, now);
      const lien = (
        await c.query<{ creditor: string; status: string; from_code: string; statement: { issuedAt?: string } | null }>(
          `select creditor_account_id::text as creditor, status, from_code, creditor_address_statement as statement from liens where id = $1 for update`,
          [id],
        )
      ).rows[0];
      if (lien === undefined || lien.creditor !== me) throw new ApiError(404, 'not-found');
      if (lien.status !== 'active' && lien.status !== 'suspended') throw new ApiError(409, 'wrong-state');
      const s = b.statement;
      if (!isRecoveryAddressStatement(s) || s.fromCode !== lien.from_code) throw new ApiError(400, 'bad-request');
      const ident = (
        await c.query<{ sign_public: string; side: 'buyer' | 'seller' }>(
          `select i.sign_public, i.role as side from trades t join trade_identities i on i.code = t.code
            where t.code = $1 and i.role = case when t.buyer_account_id = $2 then 'buyer' when t.seller_account_id = $2 then 'seller' end`,
          [lien.from_code, me],
        )
      ).rows[0];
      // The disputed trade's record (its identities) is gone after the 90-day purge: nothing to check against.
      if (ident === undefined) throw new ApiError(409, 'wrong-state');
      await sodium.ready;
      if (s.creditorSide !== ident.side || !recoveryAddressValid(s, b.sig, ident.sign_public)) throw new ApiError(400, 'bad-request');
      const issued = Date.parse(s.issuedAt);
      if (issued > now.getTime() + ADDRESS_CLOCK_SKEW_MS) throw new ApiError(400, 'bad-request');
      if (lien.statement?.issuedAt !== undefined && !(issued > Date.parse(lien.statement.issuedAt))) throw new ApiError(409, 'wrong-state');
      // Review B2 with Q2: never an address another account holds as a wallet (the debtor's payout, say).
      // Nor X2F's fee wallet (B2: the completed trade's payout could not be built).
      const taken = await c.query('select 1 from wallets where address = $1 and account_id <> $2 limit 1', [s.address, me]);
      if ((taken.rowCount ?? 0) > 0 || s.address === req.server.deps.config.feeWallet || s.address === req.server.deps.config.payrollWallet) throw new ApiError(409, 'recovery-address-refused');
      await c.query('update liens set creditor_address = $2, creditor_address_statement = $3, creditor_address_sig = $4 where id = $1', [id, s.address, s, b.sig]);
      await appendLog(c, { at: now, actor: { kind: 'trader', side: ident.side }, tradeCode: lien.from_code, action: 'lien.recovery-address-set', detail: { lienId: id } });
    });
    return reply.code(204).send();
  });
}
