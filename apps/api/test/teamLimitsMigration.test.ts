// Migration 380 (J-20), review-j20-fixes N1 (12 Nov 2026): the first_login_at backfill must not be
// told as an account change. 331's row trigger on team_members (`jabber_note_change('account_id')`,
// no ignored columns) queues a Jabber "account change" for every row the backfill updates, unless
// 380 re-creates it with first_login_at as bookkeeping BEFORE the backfill runs. Real Postgres: the
// database is migrated up to 380, a team with Jabber on and a joined member is seeded, then 380 runs.
import { copyFile, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, migrate } from '../src/db/migrate.js';
import { emptyDb } from './helpers/db.js';

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

async function account(db: pg.Pool, kind: 'trader' | 'member'): Promise<string> {
  const name = `mig${randomBytes(4).toString('hex')}`;
  const { rows } = await db.query<{ id: string }>(
    `insert into accounts (display_name, display_key, kind, webauthn_user_id, created_at) values ($1, $1, $2, $3, now()) returning id`,
    [name, kind, randomBytes(32)],
  );
  return rows[0]!.id;
}

describe('migration 380: the first-login backfill is not an account change (review N1)', () => {
  it('a team with Jabber on and a joined member gets no account-change notice from the migration', async () => {
    const db = await emptyDb();
    try {
      await migrateUpTo(db, '380');
      const team = await account(db, 'trader');
      const login = await account(db, 'member');
      await db.query(
        `insert into team_members (account_id, display_name, display_key, abilities, invite_expires_at, member_account_id, joined_at, created_at)
         values ($1, 'Mate', 'mate', '{offers-see}', now(), $2, now(), now())`,
        [team, login],
      );
      await db.query(`insert into jabber_contacts (account_id, jid_sealed, verified_at, enabled) values ($1, '\\x01', now(), true)`, [team]);
      await db.query('delete from jabber_outbox');
      await migrateUpTo(db, '381');
      // The backfill marked the joined member...
      const { rows: m } = await db.query<{ first_login_at: Date | null }>('select first_login_at from team_members where account_id = $1', [team]);
      expect(m[0]!.first_login_at).not.toBeNull();
      // ...and queued nothing for it.
      const { rows } = await db.query<{ kind: string }>('select kind from jabber_outbox where account_id = $1', [team]);
      expect(rows).toEqual([]);
      // A real team change after the migration still notifies (the trigger is in place).
      await db.query(`update team_members set abilities = '{offers-see,notes-view}' where account_id = $1`, [team]);
      expect((await db.query('select 1 from jabber_outbox where account_id = $1', [team])).rowCount).toBe(1);
    } finally {
      await db.end();
    }
  });

  it("a member's first login is queued through jabber_queue (so the Jabber settings' mute rules apply), never straight into the outbox", async () => {
    const src = await readFile(new URL('../src/auth/sessions.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/jabber_queue\([^)]*'team-member-first-login'\)/);
    expect(src).not.toMatch(/insert\s+into\s+jabber_outbox/i);
  });
});
