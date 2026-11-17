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
  for (const f of (await readdir(dir)).filter((n) => /^\d{3}_[a-z0-9_]+\.sql$/.test(n)).sort()) {
    await owner.query(await readFile(new URL(f, dir), 'utf8'));
  }
  const login = `modr_${randomBytes(4).toString('hex')}`;
  const pass = randomBytes(12).toString('hex');
  await owner.query(`create role ${login} login password '${pass}' in role x2f_mod_reader`);
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
