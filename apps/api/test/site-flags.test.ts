// Watcher revival review M1: the API starts only with exactly one site_flags row, and main.ts runs
// that check before anything reads the flags.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertOneSiteFlagsRow } from '../src/site/flags.js';
import { testDb } from './helpers/db.js';

let db: pg.Pool;

beforeAll(async () => {
  db = await testDb();
});

afterAll(async () => {
  await db.end();
});

describe('assertOneSiteFlagsRow', () => {
  it('passes on the migrated database (102_offers.sql inserts the one row)', async () => {
    await expect(assertOneSiteFlagsRow(db)).resolves.toBeUndefined();
  });

  it('refuses a missing row, naming the count (a second row is impossible: the key is `id = true`)', async () => {
    const c = await db.connect();
    try {
      await c.query('begin');
      await c.query('delete from site_flags');
      await expect(assertOneSiteFlagsRow(c)).rejects.toThrow(/exactly one row, found 0/);
    } finally {
      await c.query('rollback');
      c.release();
    }
  });

  it('main.ts checks it at startup, before the timers start', () => {
    const main = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');
    const check = main.indexOf('await assertOneSiteFlagsRow(db);');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(main.indexOf('startDisputeTimers('));
    expect(check).toBeLessThan(main.indexOf('startTimers({'));
  });
});
