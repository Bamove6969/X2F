import type { Queryable } from '../db/pool.js';
import { FX_DEFAULTS, type FxSettings } from './fx.js';

/** The `owner_settings` rows for exchange rates (migration 109; the owner changes them in Settings). */
export const FX_SETTING_KEYS = Object.freeze({ staleAfter: 'fx_stale_after_min', sanity: 'fx_sanity_pct' });

// A row outside these bounds is ignored (the default applies): 5 min to 1 day; 1% to 100%.
const STALE_MIN = { min: 5, max: 1440 };
const SANITY_PCT = { min: 1, max: 100 };

function within(v: unknown, b: { min: number; max: number }): number | null {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isInteger(n) && n >= b.min && n <= b.max ? n : null;
}

/** The owner's exchange-rate settings; each missing or out-of-range row falls back to its default. Throws if the database does. */
export async function loadFxSettings(db: Queryable): Promise<FxSettings> {
  const { rows } = await db.query<{ key: string; value: string }>('select key, value from owner_settings where key = any($1)', [
    [FX_SETTING_KEYS.staleAfter, FX_SETTING_KEYS.sanity],
  ]);
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  const staleMin = within(get(FX_SETTING_KEYS.staleAfter), STALE_MIN);
  const pct = within(get(FX_SETTING_KEYS.sanity), SANITY_PCT);
  return {
    staleAfterMs: staleMin === null ? FX_DEFAULTS.staleAfterMs : staleMin * 60_000,
    sanityBps: pct === null ? FX_DEFAULTS.sanityBps : pct * 100,
  };
}
