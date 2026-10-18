import pg from 'pg';

/**
 * The API's connection pool. An idle client's error (e.g. Postgres restarting) would crash the
 * process without a listener; it is reported as a fixed line with no connection details.
 */
export function createPool(databaseUrl: string, max = 10): pg.Pool {
  const pool = new pg.Pool({ connectionString: databaseUrl, max });
  pool.on('error', () => {
    process.stderr.write('{"level":50,"msg":"database idle client error"}\n');
  });
  return pool;
}

/** Anything that runs a parameterised query: the pool or one checked-out client (inside a transaction). */
export interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>>;
}
