// Migrations that rewrite existing offers: 315 (owner 8 Nov: "Minimum completed trades" is no
// minimum, 5, 10, 25 or 50; any other value goes down to the next lower allowed one), 345 (J-02: no
// new fixed-price offer) and 490 (J-16: flexible offers move each offer's currency, range, margin,
// rule and method into their own tables). The 315 and 345 tests stop before 490, which drops the
// columns they read; 490's own test checks what becomes of them.
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, migrate } from '../src/db/migrate.js';
import { emptyDb } from './helpers/db.js';
import { insertOffer } from './helpers/offers.js';

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

/** Applies the migrations not yet applied up to (not including) `before`. */
async function migrateUpTo(db: pg.Pool, before: string): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'x2f-mig-'));
  try {
    for (const f of (await readdir(MIGRATIONS_DIR)).filter((f) => f < before)) await copyFile(join(MIGRATIONS_DIR, f), join(dir, f));
    await migrate(db, dir);
  } finally {
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
      await migrateUpTo(db, '490');
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
      await migrateUpTo(db, '490');
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

describe('migration 490: flexible offers (J-16)', () => {
  it('every offer becomes one currency, one band in its own unit, one method with no instructions; the moved columns are gone', async () => {
    await migratedBefore('490', async (db) => {
      const a = await account(db);
      const ins = async (cols: string, vals: string): Promise<string> =>
        (await db.query<{ id: string }>(`insert into offers (account_id, side, ${cols}, terms, status, created_at, updated_at) values ($1, 'sell', ${vals}, '', 'live', now(), now()) returning id`, [a])).rows[0]!.id;
      const fiat = await ins('method_id, currency, price_mode, margin_bps, min_fiat_cents, max_fiat_cents, min_trades', `'ZELLE', 'EUR', 'market', 150, 5050, 200000, 10`);
      const xmr = await ins(
        'method_id, currency, price_mode, margin_bps, amount_unit, min_atomic, max_atomic, min_trades',
        `'REVOLUT', 'USD', 'market', -20, 'xmr', 500000000000, 3000000000000, null`,
      );
      // A fixed row from before 345: lift its check for this one insert.
      await db.query('alter table offers drop constraint offers_market_only');
      const fixed = await ins('method_id, currency, price_mode, fixed_cents_per_xmr, min_fiat_cents, max_fiat_cents, min_trades', `'ZELLE', 'USD', 'fixed', 34000, 1000, 9000, null`);
      await migrate(db);
      const tiers = await db.query(
        `select offer_id, currency, position, min_amount::text, max_amount::text, margin_bps, min_trades, method_ids from offer_tiers t order by t.min_amount`,
      );
      expect(tiers.rows).toEqual([
        { offer_id: fixed, currency: 'USD', position: 0, min_amount: '1000', max_amount: '9000', margin_bps: 0, min_trades: null, method_ids: null },
        { offer_id: fiat, currency: 'EUR', position: 0, min_amount: '5050', max_amount: '200000', margin_bps: 150, min_trades: 10, method_ids: null },
        { offer_id: xmr, currency: 'USD', position: 0, min_amount: '500000000000', max_amount: '3000000000000', margin_bps: -20, min_trades: null, method_ids: null },
      ]);
      const methods = await db.query(
        `select m.offer_id, m.method_id, m.instructions, m.adjust_bps, p.currency, p.instructions as pair
           from offer_methods m join offer_method_currencies p using (offer_id, method_id) order by m.method_id, p.currency`,
      );
      expect(methods.rows).toHaveLength(3);
      for (const r of methods.rows) expect(r).toMatchObject({ instructions: '', adjust_bps: 0, pair: null });
      // The old fixed row stays fixed (J-02's open question), and the moved columns are gone.
      const kept = await db.query(`select price_mode, fixed_cents_per_xmr::text, amount_unit from offers where id = $1`, [fixed]);
      expect(kept.rows).toEqual([{ price_mode: 'fixed', fixed_cents_per_xmr: '34000', amount_unit: 'fiat' }]);
      const cols = await db.query<{ column_name: string }>(`select column_name from information_schema.columns where table_name = 'offers'`);
      for (const gone of ['method_id', 'currency', 'margin_bps', 'min_fiat_cents', 'max_fiat_cents', 'min_atomic', 'max_atomic', 'min_trades']) {
        expect(cols.rows.map((c) => c.column_name)).not.toContain(gone);
      }
      // Still no new fixed-price offer.
      await expect(
        db.query(`insert into offers (account_id, side, price_mode, fixed_cents_per_xmr, terms, status, created_at, updated_at) values ($1, 'sell', 'fixed', 1, '', 'live', now(), now())`, [a]),
      ).rejects.toThrow(/offers_market_only/);
      // Trades gained the locked instructions, empty for the trades from before.
      const tcols = await db.query<{ column_default: string }>(`select column_default from information_schema.columns where table_name = 'trades' and column_name = 'method_instructions'`);
      expect(tcols.rows[0]?.column_default).toBe("''::text");
    });
  });
});

describe('migration 770: owner 12 Nov: Russian anything is banned (RUB, SBP, MIR, YOOMONEY)', () => {
  it('removes every offer in RUB or with a Russian method and blanks its payment details; every other offer is untouched', async () => {
    await migratedBefore('770', async (db) => {
      const a = await account(db);
      const at = new Date('2026-11-01T00:00:00Z');
      const base = { accountId: a, side: 'sell' as const, min: 5000, max: 200000, instructions: 'pay me here', at };
      const rub = await insertOffer(db, { ...base, methodId: 'ZELLE', currency: 'RUB' });
      const sbp = await insertOffer(db, { ...base, methodId: 'SBP', currency: 'USD', status: 'paused' });
      const mir = await insertOffer(db, { ...base, methodId: 'MIR', currency: 'USD' });
      const yoo = await insertOffer(db, { ...base, methodId: 'YOOMONEY', currency: 'EUR' });
      // A two-method offer with one Russian method goes too: an offer's methods are written once (J-16).
      const mixed = await insertOffer(db, { ...base, methodId: 'REVOLUT', currency: 'EUR' });
      await db.query(`insert into offer_methods (offer_id, position, method_id, instructions, adjust_bps) values ($1, 1, 'MIR', 'card 2200', 0)`, [mixed]);
      await db.query(`insert into offer_method_currencies (offer_id, method_id, currency, instructions) values ($1, 'MIR', 'EUR', 'eur card')`, [mixed]);
      const keep = await insertOffer(db, { ...base, methodId: 'ZELLE', currency: 'USD' });
      // Pair instructions are written at posting only: lift the written-once trigger for this one row.
      await db.query('alter table offer_method_currencies disable trigger offer_method_currencies_written_once');
      await db.query(`update offer_method_currencies set instructions = 'usd only' where offer_id = $1`, [keep]);
      await db.query('alter table offer_method_currencies enable trigger offer_method_currencies_written_once');
      const gone = [rub, sbp, mir, yoo, mixed];

      await migrate(db);

      const offers = await db.query<{ id: string; status: string; updated_at: Date }>('select id, status, updated_at from offers');
      for (const o of offers.rows) {
        if (gone.includes(o.id)) {
          expect(o.status, o.id).toBe('removed');
          expect(o.updated_at.getTime(), o.id).toBeGreaterThan(at.getTime());
        } else {
          expect(o).toEqual({ id: keep, status: 'live', updated_at: at });
        }
      }
      const methods = await db.query<{ offer_id: string; instructions: string }>('select offer_id, instructions from offer_methods');
      for (const m of methods.rows) expect(m.instructions, m.offer_id).toBe(gone.includes(m.offer_id) ? '' : 'pay me here');
      const pairs = await db.query<{ offer_id: string; instructions: string | null }>('select offer_id, instructions from offer_method_currencies');
      for (const r of pairs.rows) expect(r.instructions, r.offer_id).toBe(r.offer_id === keep ? 'usd only' : null);
    });
  });
});
