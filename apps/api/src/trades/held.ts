/**
 * The trades of an account in a recovery-code hold (hold model v3, owner 1-2 Nov 2026; hold.ts).
 *
 * - At the recovery-code login, in its transaction (`holdTrades`): every open trade of the account
 *   gets a `held_trades` row: `cancel` when its escrow is not funded and cannot be (still in `setup`
 *   or `funding`, nothing received, the seller has not tapped "Fund escrow"), else `pause`.
 * - Right after the commit, and every minute (`syncHeldTrades`): each `pause` row's trade gets the
 *   trade machine's own system `pause` event (its deadlines freeze; `resume` moves them by the
 *   pause's length), through the trade store like any event (trade row lock, event log, publish).
 * - While a row is open: the held account's own sessions may not post the trade's events (403
 *   `recovery-hold`), and the partner may post only the ways out (`PARTNER_EXITS`; else 409
 *   `counterparty-unavailable`). The partner's view carries `counterpartyProblem: true` and nothing
 *   else: the partner is told "<name>'s account has a temporary problem", never hold, security or
 *   vendor. Chat and opening a dispute stay open (the moderator decides a paused trade).
 * - When the hold ends (by time, the owner's pre-existing method or a moderator) the rows are
 *   released in that transaction (`releaseHeldTrades`); the sync then deletes them, and when a
 *   trade's last row goes it resumes the trade if it is paused (only holds and maintenance pause a
 *   trade). During maintenance a released row waits; it is decided once maintenance is over.
 *
 * - A `cancel` row's trade gets the machine's system `system-cancel` (the same sync, after the
 *   commit): the trade closes as cancelled. Should the machine refuse it (coins seen or "Fund
 *   escrow" tapped since the login), the trade is paused instead, as a `pause` row's.
 *
 * SEAM (not done here): the trade timer loop (timerLoop.ts) is not running in the API yet; when it
 * lands, its "maintenance off: resume every paused trade" must skip trades with an open
 * `held_trades` row.
 */
import { TradeRuleError } from '@x2f/trade';
import type pg from 'pg';
import type { Deps } from '../app.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import type { RetentionJob } from '../retention.js';
import { applyEvent, noPublish, type TradePublisher } from './store.js';

/** The partner's events allowed on a held trade: only leaving it (the machine decides whether it may). */
export const PARTNER_EXITS: readonly string[] = ['buyer-cancel', 'walk-away'];

/** Inside the recovery-code login's transaction (account locked): one row per open trade of the account. */
export async function holdTrades(db: Queryable, accountId: string, now: Date): Promise<void> {
  await db.query(
    `insert into held_trades (code, account_id, action, held_at)
     select code, $1,
            case when state in ('setup', 'funding') and received_atomic = 0 and fund_started_at is null then 'cancel' else 'pause' end,
            $2
       from trades
      where (seller_account_id = $1 or buyer_account_id = $1) and closed_at is null
     on conflict (code, account_id) do update set released_at = null`,
    [accountId, now],
  );
}

/** Inside the transaction that ends the account's hold: its trades are released (the sync resumes them after the commit). */
export async function releaseHeldTrades(db: Queryable, accountId: string, now: Date): Promise<void> {
  await db.query('update held_trades set released_at = $2 where account_id = $1 and released_at is null', [accountId, now]);
}

/**
 * Applies what the rows say (of one account, or all): `system-cancel` to each `cancel` row's trade
 * (`pause` when the machine refuses it), `pause` to each `pause` row's trade not yet paused by its
 * hold, `resume` to each released trade its hold paused (not during maintenance), then deletes the
 * released rows. Each trade in its own transaction (trade row lock first, as every trade event); a
 * trade the machine refuses (closed meanwhile, already paused by maintenance) is skipped. Returns
 * the events applied.
 */
export async function syncHeldTrades(deps: Pick<Deps, 'db' | 'clock'> & { publish?: TradePublisher }, accountId?: string): Promise<number> {
  const store = { db: deps.db, clock: deps.clock, publish: deps.publish ?? noPublish };
  const { rows } = await deps.db.query<{ code: string; account_id: string; action: string; paused: string; released: boolean }>(
    `select code, account_id, action, paused, released_at is not null as released from held_trades
      where ($1::uuid is null or account_id = $1) and ((paused = 'todo' and released_at is null) or released_at is not null)`,
    [accountId ?? null],
  );
  const maintenance = (await deps.db.query<{ on: boolean }>('select maintenance_since is not null as on from site_flags')).rows[0]?.on ?? false;
  let n = 0;
  for (const r of rows) {
    if (!r.released) {
      const mark = async (c: pg.PoolClient, state: 'paused' | 'cancelled') =>
        c.query("update held_trades set paused = $3 where code = $1 and account_id = $2 and paused = 'todo'", [r.code, r.account_id, state]);
      if (r.action === 'cancel') {
        try {
          await applyEvent(store, r.code, { type: 'system-cancel' }, 'system', async (c) => {
            await mark(c, 'cancelled');
          });
          n++;
          continue;
        } catch (e) {
          if (!(e instanceof ApiError) && !(e instanceof TradeRuleError)) throw e;
          // Funded or being funded since the login: paused instead, below.
        }
      }
      try {
        await applyEvent(store, r.code, { type: 'pause' }, 'system', async (c) => {
          await mark(c, 'paused');
        });
        n++;
      } catch (e) {
        if (!(e instanceof ApiError) && !(e instanceof TradeRuleError)) throw e;
        await deps.db.query("update held_trades set paused = 'skipped' where code = $1 and account_id = $2 and paused = 'todo'", [r.code, r.account_id]);
      }
      continue;
    }
    // Released (lead hold v3 review item 4: no trade may stay paused for good). Only holds and
    // maintenance pause a trade, so the resume is decided per trade when its last open row goes:
    // while another account's hold still holds it this row just goes; during maintenance the row
    // stays and is decided once maintenance is over; else a paused open trade is resumed, whichever
    // hold paused it (both parties held, or a pause the machine refused because the trade already was).
    const other = await deps.db.query('select 1 from held_trades where code = $1 and account_id <> $2 and released_at is null', [r.code, r.account_id]);
    if (other.rows.length === 0) {
      if (maintenance) continue;
      const t = await deps.db.query('select 1 from trades where code = $1 and paused_at is not null and closed_at is null', [r.code]);
      if (t.rows.length > 0) {
        try {
          await applyEvent(store, r.code, { type: 'resume' }, 'system');
          n++;
        } catch (e) {
          if (!(e instanceof ApiError) && !(e instanceof TradeRuleError)) throw e;
        }
      }
    }
    await deps.db.query('delete from held_trades where code = $1 and account_id = $2 and released_at is not null', [r.code, r.account_id]);
  }
  return n;
}

/** Every minute (main.ts): `syncHeldTrades` for every account, so a pause or resume missed after a commit still happens. */
export function syncHeldTradesJob(publish: TradePublisher): RetentionJob {
  return { name: 'syncHeldTrades', run: (db, now) => syncHeldTrades({ db, clock: () => now, publish }) };
}

/**
 * Inside a trade event's transaction, after the trade row lock (`applyEvent`'s `before`): 403
 * `recovery-hold` for the held account's own sessions, 409 `counterparty-unavailable` for the
 * partner's events other than the ways out, while the trade has an open row.
 */
export async function refuseHeldTradeEvent(db: Queryable, code: string, accountId: string, eventType: string): Promise<void> {
  const { rows } = await db.query<{ account_id: string }>('select account_id from held_trades where code = $1 and released_at is null', [code]);
  if (rows.length === 0) return;
  if (rows.some((r) => r.account_id === accountId)) {
    const until = await db.query<{ hold_until: Date }>('select hold_until from account_holds where account_id = $1', [accountId]);
    throw new ApiError(403, 'recovery-hold', until.rows[0] ? { holdUntil: until.rows[0].hold_until.toISOString() } : undefined);
  }
  if (!PARTNER_EXITS.includes(eventType)) throw new ApiError(409, 'counterparty-unavailable');
}

/** True when the trade's other party (`otherId`) has it held: the partner's view flag. */
export async function counterpartyProblem(db: Queryable, code: string, otherId: string): Promise<boolean> {
  const { rows } = await db.query('select 1 from held_trades where code = $1 and account_id = $2 and released_at is null', [code, otherId]);
  return rows.length > 0;
}
