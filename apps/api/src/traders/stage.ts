import type { Queryable } from '../db/pool.js';

/**
 * Starter limits (spec 2.3, owner 2026-10-24; plan Revision 2026-10-24). An account's stage comes
 * from its completed trades and its age; the stage caps the largest single trade it can be part of
 * (USD equivalent at the locked rate) and, on Starter, how many trades it can have open.
 *
 * Not yet counted: "a lost dispute drops the account back one stage" and "only completed trades
 * with no dispute lost count" need the disputes table (Plan 3 Task 27, migration 108), which is
 * not on the main line. `completedTrades` below is every released trade; Task 27 must subtract
 * the lost ones and drop a stage per lost dispute here, in this one place.
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
  stage: Stage;
  /** The largest single trade, US cents; null on Graduated. */
  capUsdCents: bigint | null;
  /** How many trades may be open at once; null when the stage has no such limit. */
  maxOpen: number | null;
}

/** SQL: an account's completed trades (released, either side). One place, so Task 27 changes it once. */
export const COMPLETED_TRADES_SQL = `(select count(*) from trades t
   where t.state = 'released' and (t.buyer_account_id = a.id or t.seller_account_id = a.id))`;

/**
 * The plan's shared helper `tradeCap(deps, accountId, now)` (Revision 2026-10-24), for Task 5's
 * take and anything else that checks a trade against the caps. Throws for an unknown account.
 */
export async function tradeCap(db: Queryable, accountId: string, now: Date, settings?: StarterSettings): Promise<TradeCap> {
  const s = settings ?? (await loadStarterSettings(db));
  const { rows } = await db.query<{ created_at: Date; completed: string }>(
    `select a.created_at, ${COMPLETED_TRADES_SQL} as completed from accounts a where a.id = $1`,
    [accountId],
  );
  const r = rows[0];
  if (!r) throw new Error('account missing');
  const stage = stageFor(s, Number(r.completed), r.created_at, now);
  return { stage, capUsdCents: capUsdCents(s, stage), maxOpen: stage === 'starter' ? s.starterMaxOpenTrades : null };
}

/**
 * `fiatMinor` of a currency in US cents, at a market quote's two prices for the same XMR
 * (`centsPerXmr` local, `usdCentsPerXmr`), rounded up so a cap is never under-counted.
 */
export function usdCentsOf(fiatMinor: bigint, q: { centsPerXmr: bigint; usdCentsPerXmr: bigint }): bigint {
  if (q.centsPerXmr <= 0n) throw new RangeError('price must be positive');
  return (fiatMinor * q.usdCentsPerXmr + q.centsPerXmr - 1n) / q.centsPerXmr;
}
