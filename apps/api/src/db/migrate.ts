import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type pg from 'pg';
import { createPool } from './pool.js';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));
const NAME = /^\d{3}_[a-z0-9_]+\.sql$/;
// Serialises concurrent migrators (two API instances starting together).
const LOCK_KEY = 0x7832_6d69; // "x2mi"

/**
 * Applies `migrations/NNN_*.sql` in name order, each in its own transaction, recorded in
 * `schema_migrations`; returns the names applied this run.
 */
export async function migrate(db: pg.Pool, dir = MIGRATIONS_DIR): Promise<string[]> {
  const files = (await readdir(dir)).filter((f) => NAME.test(f)).sort();
  const client = await db.connect();
  const applied: string[] = [];
  try {
    await client.query('select pg_advisory_lock($1)', [LOCK_KEY]);
    try {
      await client.query(
        'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())',
      );
      const done = new Set((await client.query<{ name: string }>('select name from schema_migrations')).rows.map((r) => r.name));
      for (const name of files) {
        if (done.has(name)) continue;
        const sql = await readFile(join(dir, name), 'utf8');
        await client.query('begin');
        try {
          await client.query(sql);
          await client.query('insert into schema_migrations (name, applied_at) values ($1, now())', [name]);
          await client.query('commit');
        } catch (e) {
          await client.query('rollback');
          throw e;
        }
        applied.push(name);
      }
    } finally {
      await client.query('select pg_advisory_unlock($1)', [LOCK_KEY]);
    }
  } finally {
    client.release();
  }
  return applied;
}

// `npm run migrate -w @x2f/api`: needs only DATABASE_URL, not the rest of the API's settings.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write('migrate: DATABASE_URL is missing\n');
    process.exit(1);
  }
  const pool = createPool(url, 1);
  try {
    const names = await migrate(pool);
    process.stdout.write(`${JSON.stringify({ migrated: names })}\n`);
  } finally {
    await pool.end();
  }
}
