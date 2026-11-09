// Migrations that rewrite existing offers: 315 (owner 8 Nov: "Minimum completed trades" is no
// minimum, 5, 10, 25 or 50; any other value goes down to the next lower allowed one).
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, migrate } from '../src/db/migrate.js';
import { emptyDb } from './helpers/db.js';

/** A database migrated up to (not including) `before`; `run` gets it, then the rest is applied by the test. */
async function migratedBefore(before: string, run: (db: pg.Pool) => Promise<void>): Promise<void> {
  const db = await emptyDb();
  const dir = await mkdtemp(join(tmpdir(), 'x2f-mig-'));
  try {
    for (const f of (await readdir(MIGRATIONS_DIR)).filter((f) => f < before)) await copyFile(join(MIGRATIONS_DIR, f), join(dir, f));
    await migrate(db, dir);
    await run(db);
  } finally {
    await db.end();
    await rm(dir, { recursive: true, force: true });
  }
}

async function account(db: pg.Pool): Promise<string> {
  const name = `mig${randomBytes(4).toString('hex')}`;
  const { rows } = await db.query<{ id: string }>(
    `insert into accounts (display_name, display_key, kind, webauthn_user_id, created_at) values ($1, $1, 'trader', $2, now()) returning id`,
    [name, randomBytes(32)],
  );
  return rows[0]!.id;
}

async function offer(db: pg.Pool, accountId: string, minTrades: number): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into offers (account_id, side, method_id, currency, price_mode, margin_bps, min_fiat_cents, max_fiat_cents,
                         min_trades, terms, status, created_at, updated_at)
     values ($1, 'sell', 'ZELLE', 'USD', 'market', 50, 5000, 200000, $2, '', 'live', now(), now()) returning id`,
    [accountId, minTrades],
  );
  return rows[0]!.id;
}

describe('migration 315: minimum completed trades is no minimum, 5, 10, 25 or 50', () => {
  it('0 becomes no minimum (null); every other value goes down to the next lower allowed one; then only the choices are stored', async () => {
    await migratedBefore('315', async (db) => {
      const a = await account(db);
      // The old check allowed 0, 5, 10 and 50; lift it so the rule for any other value is tested too.
      await db.query('alter table offers drop constraint offers_min_trades_check');
      const cases: [number, number | null][] = [
        [0, null], [3, null], [4, null], [5, 5], [9, 5], [10, 10], [24, 10], [25, 25], [49, 25], [50, 50], [51, 50], [1000, 50],
      ];
      const ids = new Map<string, number | null>();
      for (const [before, after] of cases) ids.set(await offer(db, a, before), after);
      await db.query(`alter table offers add constraint offers_min_trades_check check (min_trades >= 0)`);
      await migrate(db);
      const { rows } = await db.query<{ id: string; min_trades: number | null }>('select id, min_trades from offers');
      expect(rows).toHaveLength(cases.length);
      for (const r of rows) expect(r.min_trades, r.id).toBe(ids.get(r.id));
      // Afterwards only null, 5, 10, 25 and 50 are stored.
      for (const ok of [5, 10, 25, 50]) await offer(db, a, ok);
      await db.query(
        `insert into offers (account_id, side, method_id, currency, price_mode, margin_bps, min_fiat_cents, max_fiat_cents,
                             min_trades, terms, status, created_at, updated_at)
         values ($1, 'sell', 'ZELLE', 'USD', 'market', 50, 5000, 200000, null, '', 'live', now(), now())`,
        [a],
      );
      for (const bad of [0, 7, 100]) await expect(offer(db, a, bad), String(bad)).rejects.toThrow(/offers_min_trades_check/);
    });
  });
});

describe('migration 345: no new fixed-price offer (owner Q1, 6 Nov: market ± % only)', () => {
  it('keeps an offer stored as fixed exactly as it was, and refuses any new or changed row that is not market-priced', async () => {
    await migratedBefore('345', async (db) => {
      const a = await account(db);
      const { rows } = await db.query<{ id: string }>(
        `insert into offers (account_id, side, method_id, currency, price_mode, fixed_cents_per_xmr, min_fiat_cents, max_fiat_cents,
                             min_trades, terms, status, created_at, updated_at)
         values ($1, 'sell', 'ZELLE', 'USD', 'fixed', 34000, 5000, 200000, null, '', 'live', now(), now()) returning id`,
        [a],
      );
      const legacy = rows[0]!.id;
      await migrate(db);
      const kept = await db.query(`select price_mode, fixed_cents_per_xmr::text, margin_bps, status from offers where id = $1`, [legacy]);
      expect(kept.rows).toEqual([{ price_mode: 'fixed', fixed_cents_per_xmr: '34000', margin_bps: null, status: 'live' }]);
      await offer(db, a, 5);
      await expect(
        db.query(
          `insert into offers (account_id, side, method_id, currency, price_mode, fixed_cents_per_xmr, min_fiat_cents, max_fiat_cents,
                               min_trades, terms, status, created_at, updated_at)
           values ($1, 'sell', 'ZELLE', 'USD', 'fixed', 34000, 5000, 200000, null, '', 'live', now(), now())`,
          [a],
        ),
      ).rejects.toThrow(/offers_market_only/);
      const m = await offer(db, a, 5);
      await expect(db.query(`update offers set price_mode = 'fixed', margin_bps = null, fixed_cents_per_xmr = 1 where id = $1`, [m])).rejects.toThrow(
        /offers_market_only/,
      );
    });
  });
});
