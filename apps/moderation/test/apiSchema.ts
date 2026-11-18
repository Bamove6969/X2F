// A fresh database with the API's whole schema (its migrations, in order) and a login in the
// read-only role the moderation process uses on it (`x2f_mod_reader`, migrations 211 and 212):
// `owner` writes as the API would (or as an attacker with the database would), `reader` reads as
// the moderation process does. Not a test file.
import { randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';
import { inject } from 'vitest';

export interface ApiSchema {
  owner: pg.Pool;
  reader: pg.Pool;
  end(): Promise<void>;
}

/** The advisory lock key that serializes runs of the API's migrations on the shared test cluster. */
const SCHEMA_LOCK = 0x78326d72; // 'x2mr'

/**
 * Runs `fn` (the API's migrations on a fresh database, and the reader login) one at a time across
 * every test file on this cluster. The migrations create cluster-wide roles (x2f_purge in 104,
 * x2f_mod_reader in 208), each behind an `if not exists` check that is not atomic. gate,
 * checkpoint, checkpointBypass and internal each build such a database at the same time, so two of
 * them could both pass the check and the second `create role` fail on pg_authid's unique index. The
 * advisory lock is taken in the shared `postgres` database (advisory locks are per database); ending
 * that session releases it whatever `fn` did.
 */
export async function withApiSchemaLock<T>(fn: () => Promise<T>): Promise<T> {
  const lock = new pg.Client({ connectionString: `${inject('modPgUrl')}/postgres` });
  await lock.connect();
  try {
    await lock.query('select pg_advisory_lock($1)', [SCHEMA_LOCK]);
    return await fn();
  } finally {
    await lock.end();
  }
}

export async function apiSchemaDb(prefix: string): Promise<ApiSchema> {
  const admin = inject('modPgUrl');
  const name = `${prefix}_${randomBytes(8).toString('hex')}`;
  const c = new pg.Client({ connectionString: `${admin}/postgres` });
  await c.connect();
  try {
    await c.query(`create database ${name}`);
  } finally {
    await c.end();
  }
  const owner = new pg.Pool({ connectionString: `${admin}/${name}`, max: 1 });
  const dir = new URL('../../api/migrations/', import.meta.url);
  const login = `modr_${randomBytes(4).toString('hex')}`;
  const pass = randomBytes(12).toString('hex');
  await withApiSchemaLock(async () => {
    for (const f of (await readdir(dir)).filter((n) => /^\d{3}_[a-z0-9_]+\.sql$/.test(n)).sort()) {
      await owner.query(await readFile(new URL(f, dir), 'utf8'));
    }
    await owner.query(`create role ${login} login password '${pass}' in role x2f_mod_reader`);
  });
  const u = new URL(admin);
  const reader = new pg.Pool({ connectionString: `postgres://${login}:${pass}@${u.host}/${name}`, max: 1 });
  return {
    owner,
    reader,
    async end() {
      await reader.end();
      await owner.end();
    },
  };
}
