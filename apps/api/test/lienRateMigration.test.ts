// Migration 890 (owner 26 Nov 2026: "100% of their earnings are pulled until they pay back in full"):
// a lien's recovery rate defaults to and is capped at 10000 bps. Existing liens that still bind move
// from the old 5000 default to 10000 only when no senior chose their rate (no approved request) and
// the moderation service never pinned them (no lien statement); every other rate stays as stored.
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { LIEN_DEFAULT_RATE_BPS, LIEN_RECOVERY_MAX_BPS } from '@x2f/trade';
import { MIGRATIONS_DIR, migrate } from '../src/db/migrate.js';
import { emptyDb } from './helpers/db.js';

const MIGRATION = '890_lien_rate_full.sql';

/** A database migrated up to (not including) `before`; `run` gets it, then applies the rest itself. */
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

async function lien(db: pg.Pool, rate: number | null, status: 'active' | 'suspended' | 'void' = 'active'): Promise<string> {
  const [debtor, creditor] = [await account(db), await account(db)];
  const over = status === 'void';
  const { rows } = await db.query<{ id: string }>(
    `insert into liens (debtor_account_id, creditor_account_id, amount_atomic, fee_atomic, from_code, dispute_seq, round, cause, created_at, changed_at, status, lifted_at, recovery_rate_bps)
     values ($1, $2, 1000000000000, 0, gen_random_uuid()::text, 1, 1, 'restitution', now(), now(), $3, case when $4::boolean then now() end, coalesce($5::int, 5000)) returning id::text`,
    [debtor, creditor, status, over, rate],
  );
  return rows[0]!.id;
}

const rateOf = async (db: pg.Pool, id: string): Promise<number> => (await db.query<{ r: number }>('select recovery_rate_bps as r from liens where id = $1', [id])).rows[0]!.r;

describe(`migration ${MIGRATION}`, () => {
  it('moves only the untouched old default of a binding lien to 100%; a senior-chosen, moderation-pinned, other or ended rate stays', async () => {
    await migratedBefore(MIGRATION, async (db) => {
      const plain = await lien(db, 5000);
      const suspended = await lien(db, 5000, 'suspended');
      const approved = await lien(db, 5000);
      const [mod, senior] = [await account(db), await account(db)];
      await db.query(
        `insert into lien_rate_requests (lien_id, proposed_bps, reason, proposed_by, proposed_at, status, decided_by, decided_at)
         values ($1, 5000, 'Back to half', $2, now(), 'approved', $3, now())`,
        [approved, mod, senior],
      );
      const rejectedOnly = await lien(db, 5000);
      await db.query(
        `insert into lien_rate_requests (lien_id, proposed_bps, reason, proposed_by, proposed_at, status, decided_by, decided_at)
         values ($1, 2500, 'Hardship', $2, now(), 'rejected', $3, now())`,
        [rejectedOnly, mod, senior],
      );
      const pinned = await lien(db, 5000);
      await db.query(`insert into lien_statements (lien_id, statement, sig, updated_at) values ($1, '{}'::jsonb, repeat('a', 128), now())`, [pinned]);
      const lowered = await lien(db, 7000);
      const ended = await lien(db, 5000, 'void');

      await migrate(db);

      expect(await rateOf(db, plain)).toBe(10_000);
      expect(await rateOf(db, suspended)).toBe(10_000);
      expect(await rateOf(db, rejectedOnly)).toBe(10_000);
      expect(await rateOf(db, approved)).toBe(5000);
      expect(await rateOf(db, pinned)).toBe(5000);
      expect(await rateOf(db, lowered)).toBe(7000);
      expect(await rateOf(db, ended)).toBe(5000);
    });
  });

  it('a new lien defaults to LIEN_DEFAULT_RATE_BPS; every rate check allows 1..LIEN_RECOVERY_MAX_BPS and nothing above', async () => {
    await migratedBefore('999', async (db) => {
      const [debtor, creditor] = [await account(db), await account(db)];
      const { rows } = await db.query<{ r: number; id: string }>(
        `insert into liens (debtor_account_id, creditor_account_id, amount_atomic, fee_atomic, from_code, dispute_seq, round, cause, created_at, changed_at)
         values ($1, $2, 1000000000000, 0, gen_random_uuid()::text, 1, 1, 'restitution', now(), now()) returning recovery_rate_bps as r, id::text`,
        [debtor, creditor],
      );
      expect(rows[0]!.r).toBe(LIEN_DEFAULT_RATE_BPS);
      const id = rows[0]!.id;
      await expect(db.query('update liens set recovery_rate_bps = $2 where id = $1', [id, LIEN_RECOVERY_MAX_BPS + 1])).rejects.toThrow(/check/);
      await expect(db.query('update liens set recovery_rate_bps = 0 where id = $1', [id])).rejects.toThrow(/check/);
      const [mod] = [await account(db)];
      const req = `insert into lien_rate_requests (lien_id, proposed_bps, reason, proposed_by, proposed_at) values ($1, $2, 'x', $3, now())`;
      await expect(db.query(req, [id, LIEN_RECOVERY_MAX_BPS + 1, mod])).rejects.toThrow(/check/);
      await db.query(req, [id, LIEN_RECOVERY_MAX_BPS, mod]);
      const hold = `insert into lien_recovery_holds (lien_id, trade_code, amount_atomic, rate_bps, address, created_at) values ($1, $2, 1000, $3, 'creditor-address', now())`;
      await expect(db.query(hold, [id, 'AAAA-BBBB-CCCC-DDDD', LIEN_RECOVERY_MAX_BPS + 1])).rejects.toThrow(/check/);
      await db.query(hold, [id, 'AAAA-BBBB-CCCC-DDDD', LIEN_RECOVERY_MAX_BPS]);
    });
  });
});
