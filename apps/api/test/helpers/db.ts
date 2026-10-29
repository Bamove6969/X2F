import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { inject } from 'vitest';

const TEMPLATE_DB = 'x2f_template';

async function createDatabase(template: string | null, max = 4): Promise<pg.Pool> {
  const url = inject('pgUrl');
  const name = `x2f_t_${randomBytes(8).toString('hex')}`;
  const admin = new pg.Client({ connectionString: `${url}/postgres` });
  await admin.connect();
  try {
    // Names are generated here from hex only, never from input.
    await admin.query(template ? `create database ${name} template ${template}` : `create database ${name}`);
  } finally {
    await admin.end();
  }
  return new pg.Pool({ connectionString: `${url}/${name}`, max });
}

/**
 * A fresh database copied from the migrated template; one per test file. The caller ends the pool.
 * `max` is the pool size (4 by default); a race test that holds N transactions open at once needs
 * more than N.
 */
export function testDb(opts: { max?: number } = {}): Promise<pg.Pool> {
  return createDatabase(TEMPLATE_DB, opts.max);
}

/** A fresh database with no migrations applied. */
export function emptyDb(): Promise<pg.Pool> {
  return createDatabase(null);
}
