import { displayKeyOf } from '@x2f/accounts';
import { normalizeTradeCode } from '@x2f/core';
import type { FastifyInstance } from 'fastify';
import { withTx } from '../auth/liveSession.js';
import { activeBans } from '../banState.js';
import type { Queryable } from '../db/pool.js';
import { hasActiveLien } from '../disputes/lien.js';
import { ApiError } from '../errors.js';
import { appendLog } from '../log/append.js';
import { traderSummaries } from '../traders/summary.js';
import { requireStaff } from './guard.js';

/**
 * The staff Accounts page's lookup (spec 6.6 "Account actions", Plan 4 Task 27: a senior moderator
 * or the owner acts on an account outside a case). Read-only.
 *
 * `GET /staff/v1/accounts/lookup?q=<Trade Tag or trade code>` (perm `accounts.ban`: senior
 * moderators and the owner, the roles that may act on what it finds; `accounts.freeze` has the same
 * roles) → `{ accounts }`:
 * - `q` that reads as a trade code (`normalizeTradeCode`: dashes, spaces and look-alikes allowed)
 *   finds that trade's buyer and seller (`matchedBy: 'code'`, `side`); `q` also finds the trader
 *   whose public Trade Tag it is (`matchedBy: 'name'`, the stored key's full fold, so case and
 *   compatibility forms do not matter). Exact matches only: no prefix or partial search, so the
 *   route cannot list accounts. Only trader accounts: never staff or the owner.
 * - Each account: its id (the account action routes take it), the PUBLIC Trade Tag and the
 *   reputation a case's trader card already shows (completed trades, positive %, disputes won and
 *   lost, stage), and its status: the bans in force (kind, general reason, end), a running account
 *   hold (end and reason), whether a dispute freeze stands, and whether a lien binds it. Never the
 *   login name, keys, wallets, addresses, sessions, staff notes or the trades themselves.
 *
 * Rate limit: per staff member, `ACCOUNT_LOOKUP_BUCKET` (in limits.ts), every try counted (a bad
 * query and a miss too), 429 `slow-down`. Each lookup is written to the activity log in the same
 * transaction as its reads: `account.looked-up` `{ by, accountId }` per account found, or
 * `{ by, found: 0 }` when nothing matched. No trade code goes on the entry (column or detail), so a
 * lookup never makes the reader "involved" in that trade's case (R37's `involvedIn` reads entries
 * by trade code), and the code itself is not stored.
 */
export const LOOKUP_QUERY_MAX = 64;

type Side = 'buyer' | 'seller';

export interface LookedUpAccount {
  accountId: string;
  tradeTag: string;
  matchedBy: 'name' | 'code';
  /** The side in the trade `q` named; null for a name match. */
  side: Side | null;
  completedTrades: number;
  positivePct: number | null;
  disputes: { won: number; lost: number };
  stage: string;
  status: {
    bans: Array<{ id: string; kind: 'trade' | 'site'; reasonCode: string; until: string | null; permanent: boolean }>;
    frozen: boolean;
    lien: boolean;
  };
}

async function statusOf(q: Queryable, accountId: string, now: Date): Promise<LookedUpAccount['status']> {
  const bans = await activeBans(q, accountId, now);
  const frozen = await q.query('select 1 from trading_holds where account_id = $1 and lifted_at is null limit 1', [accountId]);
  return {
    bans: bans.map((b) => ({ id: b.id, kind: b.kind, reasonCode: b.reasonCode, until: b.until?.toISOString() ?? null, permanent: b.until === null })),
    frozen: frozen.rows.length > 0,
    lien: await hasActiveLien(q, accountId),
  };
}

export function staffAccountLookupRoutes(app: FastifyInstance): void {
  const perm = 'accounts.ban' as const;
  app.get('/staff/v1/accounts/lookup', { config: { perm }, preHandler: requireStaff(perm) }, async (req) => {
    // Every try counts, before anything is read.
    req.server.budgets.accountLookup.take(req.staff.accountId);
    const query = (req.query ?? {}) as Record<string, unknown>;
    if (Object.keys(query).some((k) => k !== 'q') || typeof query.q !== 'string') throw new ApiError(400, 'bad-request');
    const raw = query.q.trim();
    if (raw === '' || raw.length > LOOKUP_QUERY_MAX) throw new ApiError(400, 'bad-request');
    const code = normalizeTradeCode(raw);
    const { db, clock } = req.server.deps;
    const now = clock();
    const actor = { kind: 'staff' as const, id: req.staff.accountId, role: req.staff.role };

    return withTx(db, async (c) => {
      const found: Array<{ id: string; matchedBy: 'name' | 'code'; side: Side | null }> = [];
      if (code !== null) {
        const t = await c.query<{ buyer: string; seller: string }>(
          `select t.buyer_account_id::text as buyer, t.seller_account_id::text as seller
             from trades t where t.code = $1`,
          [code],
        );
        const row = t.rows[0];
        if (row) {
          const kinds = await c.query<{ id: string }>("select id::text as id from accounts where id = any($1::uuid[]) and kind = 'trader'", [[row.buyer, row.seller]]);
          const traders = new Set(kinds.rows.map((r) => r.id));
          if (traders.has(row.buyer)) found.push({ id: row.buyer, matchedBy: 'code', side: 'buyer' });
          if (traders.has(row.seller)) found.push({ id: row.seller, matchedBy: 'code', side: 'seller' });
        }
      }
      const byName = await c.query<{ id: string }>("select id::text as id from accounts where display_key = $1 and kind = 'trader'", [displayKeyOf(raw)]);
      for (const r of byName.rows) if (!found.some((f) => f.id === r.id)) found.push({ id: r.id, matchedBy: 'name', side: null });

      const summaries = await traderSummaries(c, found.map((f) => f.id), now, null);
      const accounts: LookedUpAccount[] = [];
      for (const f of found) {
        const s = summaries.get(f.id);
        if (!s) continue;
        accounts.push({
          accountId: f.id,
          tradeTag: s.tradeTag,
          matchedBy: f.matchedBy,
          side: f.side,
          completedTrades: s.completedTrades,
          positivePct: s.positivePct,
          disputes: s.disputes,
          stage: s.stage,
          status: await statusOf(c, f.id, now),
        });
      }
      const by = code !== null ? 'code' : 'name';
      if (accounts.length === 0) {
        await appendLog(c, { at: now, actor, tradeCode: null, action: 'account.looked-up', detail: { by, found: 0 } });
      }
      for (const a of accounts) {
        await appendLog(c, { at: now, actor, tradeCode: null, action: 'account.looked-up', detail: { by: a.matchedBy, accountId: a.accountId } });
      }
      return { accounts };
    });
  });
}
