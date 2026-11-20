import type { Queryable } from '../db/pool.js';

/**
 * Starter limits (spec 2.3, owner 2026-10-24; plan Revision 2026-10-24). An account's stage comes
 * from its completed trades and its age; the stage caps the largest single trade it can be part of
 * (USD equivalent at the locked rate) and, on Starter, how many trades it can have open.
 */
export type Stage = 'starter' | 'building' | 'graduated';

export interface StarterSettings {
  starterCapUsd: number;
  buildingCapUsd: number;
  buildingMinTrades: number;
  buildingMinDays: number;
  graduatedMinTrades: number;
  graduatedMinDays: number;
  starterMaxOpenTrades: number;
}

export const STARTER_DEFAULTS: Readonly<StarterSettings> = Object.freeze({
  starterCapUsd: 200,
  buildingCapUsd: 1000,
  buildingMinTrades: 5,
  buildingMinDays: 7,
  graduatedMinTrades: 20,
  graduatedMinDays: 30,
  starterMaxOpenTrades: 3,
});

/** The `owner_settings` key of each setting (whole numbers; the owner changes them in Settings, Plan 4). */
export const STARTER_SETTING_KEYS: Readonly<Record<keyof StarterSettings, string>> = Object.freeze({
  starterCapUsd: 'starter_cap_usd',
  buildingCapUsd: 'building_cap_usd',
  buildingMinTrades: 'building_min_trades',
  buildingMinDays: 'building_min_days',
  graduatedMinTrades: 'graduated_min_trades',
  graduatedMinDays: 'graduated_min_days',
  starterMaxOpenTrades: 'starter_max_open_trades',
});

// A row outside these bounds is ignored (the default applies).
const BOUNDS: Record<keyof StarterSettings, { min: number; max: number }> = {
  starterCapUsd: { min: 1, max: 1_000_000_000 },
  buildingCapUsd: { min: 1, max: 1_000_000_000 },
  buildingMinTrades: { min: 0, max: 100_000 },
  buildingMinDays: { min: 0, max: 3650 },
  graduatedMinTrades: { min: 0, max: 100_000 },
  graduatedMinDays: { min: 0, max: 3650 },
  starterMaxOpenTrades: { min: 1, max: 1000 },
};

/** The owner's starter-limit settings; each missing or out-of-range row falls back to its default. */
export async function loadStarterSettings(db: Queryable): Promise<StarterSettings> {
  const keys = Object.values(STARTER_SETTING_KEYS);
  const { rows } = await db.query<{ key: string; value: string }>('select key, value from owner_settings where key = any($1)', [keys]);
  const out = { ...STARTER_DEFAULTS };
  for (const name of Object.keys(STARTER_SETTING_KEYS) as (keyof StarterSettings)[]) {
    const raw = rows.find((r) => r.key === STARTER_SETTING_KEYS[name])?.value;
    const n = raw === undefined ? NaN : Number(raw);
    const b = BOUNDS[name];
    if (Number.isInteger(n) && n >= b.min && n <= b.max) out[name] = n;
  }
  return out;
}

const DAY_MS = 86_400_000;

/** The stage for `completedTrades` and an account created at `createdAt`. */
export function stageFor(s: StarterSettings, completedTrades: number, createdAt: Date, now: Date): Stage {
  const days = (now.getTime() - createdAt.getTime()) / DAY_MS;
  if (completedTrades >= s.graduatedMinTrades && days >= s.graduatedMinDays) return 'graduated';
  if (completedTrades >= s.buildingMinTrades && days >= s.buildingMinDays) return 'building';
  return 'starter';
}

/** The largest single trade a stage allows, in US cents; null for no platform cap. */
export function capUsdCents(s: StarterSettings, stage: Stage): bigint | null {
  if (stage === 'starter') return BigInt(s.starterCapUsd) * 100n;
  if (stage === 'building') return BigInt(s.buildingCapUsd) * 100n;
  return null;
}

/**
 * The lowest stage whose cap allows a trade of `usdCents`, when `stage`'s cap does not: what an
 * offer list shows as "Opens at Building" (Revision 2026-10-24). Undefined when `stage` already
 * allows it.
 */
export function opensAt(s: StarterSettings, stage: Stage, usdCents: bigint): 'building' | 'graduated' | undefined {
  const cap = capUsdCents(s, stage);
  if (cap === null || usdCents <= cap) return undefined;
  const building = capUsdCents(s, 'building')!;
  return stage === 'starter' && usdCents <= building ? 'building' : 'graduated';
}

export interface TradeCap {
  /**
   * The stage the account's own limits follow: its earned stage, or lower when an approved account
   * limit holds it to a stage (Plan 4 Task 26). What others see of it (the New badge, summary.ts)
   * stays the earned stage, so a limit is never shown to anyone but the account itself (lead
   * default, owner question).
   */
  stage: Stage;
  /** The largest single trade, US cents: the lower of the stage's cap and an account limit's; null for none. */
  capUsdCents: bigint | null;
  /** How many trades may be open at once; null when the stage has no such limit. */
  maxOpen: number | null;
  /** Task 26: `capUsdCents` is an account limit's cap, below what the stage alone allows. */
  byLimit: boolean;
}

const STAGE_ORDER: readonly Stage[] = ['starter', 'building', 'graduated'];
const lowerStage = (a: Stage, b: Stage): Stage => (STAGE_ORDER.indexOf(a) <= STAGE_ORDER.indexOf(b) ? a : b);

/**
 * SQL: an account's completed trades, either side: released trades, plus refunded trades whose
 * dispute settled. Owner rule R38 (2026-10-29): a settled dispute counts as completed whoever won,
 * and a lost dispute drops no stage. A moderator's refund to the seller settles as `mutual-cancel`
 * (no seller-side kind yet), so such a trade ends `refunded` with `dispute_by` set; a released
 * trade whose late deposit was escalated and refunded ends the same way and still counts.
 */
export const COMPLETED_TRADES_SQL = `(${completedTradesLiveSql()} + ${purgedSql('purged_completed')})`;

/**
 * COMPLETED_TRADES_SQL's live part alone (no purged total), with `extra` added to its WHERE (the
 * trade alias is `t`): the whole-trade purge reads one trade's own share with `and t.code = $n`.
 */
export function completedTradesLiveSql(extra = ''): string {
  return `(select count(*) from trades t
   where (t.state = 'released' or (t.state = 'refunded' and t.dispute_by is not null))
     and (t.buyer_account_id = a.id or t.seller_account_id = a.id) ${extra})`;
}

/**
 * SQL (bigint): what Plan 7's whole-trade purge moved out of the live trades into account `a.id`'s
 * running total `column` (701, retention/tradePurge.ts), 0 for an account with none. Every count
 * read from the live trades adds its own column back, so a profile and a stage are the same before
 * and after a trade is deleted. `column` is a constant name, never input.
 */
export function purgedSql(column: 'purged_completed' | 'purged_sales' | 'purged_won' | 'purged_lost'): string {
  return `coalesce((select pt.${column} from account_traded_totals pt where pt.account_id = a.id), 0)`;
}

/**
 * The plan's shared helper `tradeCap(deps, accountId, now)` (Revision 2026-10-24), for Task 5's
 * take and anything else that checks a trade against the caps. Plan 4 Task 26: an approved account
 * limit lowers it (the lower of the stage's cap and the limit's; a stage limit holds the account to
 * that stage). A lost dispute alone never does (R38). Throws for an unknown account.
 */
export async function tradeCap(db: Queryable, accountId: string, now: Date, settings?: StarterSettings): Promise<TradeCap> {
  const s = settings ?? (await loadStarterSettings(db));
  // Task 26: the account's approved limits that still apply (no end, or an end after now).
  const { rows } = await db.query<{ created_at: Date; completed: string; limit_cap: number | null; limit_stage: Stage | null }>(
    `select a.created_at, ${COMPLETED_TRADES_SQL} as completed,
            (select min(l.cap_usd) from account_limits l where l.account_id = a.id and (l.until is null or l.until > $2)) as limit_cap,
            (select l.stage from account_limits l
              where l.account_id = a.id and l.stage is not null and (l.until is null or l.until > $2)
              order by case l.stage when 'starter' then 0 else 1 end limit 1) as limit_stage
       from accounts a where a.id = $1`,
    [accountId, now],
  );
  const r = rows[0];
  if (!r) throw new Error('account missing');
  const earned = stageFor(s, Number(r.completed), r.created_at, now);
  const stage = r.limit_stage === null ? earned : lowerStage(earned, r.limit_stage);
  const stageCap = capUsdCents(s, stage);
  const limitCap = r.limit_cap === null ? null : BigInt(r.limit_cap) * 100n;
  const byLimit = limitCap !== null && (stageCap === null || limitCap < stageCap);
  return { stage, capUsdCents: byLimit ? limitCap : stageCap, maxOpen: stage === 'starter' ? s.starterMaxOpenTrades : null, byLimit };
}

/**
 * `fiatMinor` of a currency in US cents, at a market quote's two prices for the same XMR
 * (`centsPerXmr` local, `usdCentsPerXmr`), rounded up so a cap is never under-counted.
 */
export function usdCentsOf(fiatMinor: bigint, q: { centsPerXmr: bigint; usdCentsPerXmr: bigint }): bigint {
  if (q.centsPerXmr <= 0n) throw new RangeError('price must be positive');
  return (fiatMinor * q.usdCentsPerXmr + q.centsPerXmr - 1n) / q.centsPerXmr;
}
