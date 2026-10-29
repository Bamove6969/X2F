import type pg from 'pg';

/** SQL text, whitespace normalised (a query config object counts by its `text`). */
const norm = (q: unknown): string =>
  String(q !== null && typeof q === 'object' && 'text' in q ? (q as { text: unknown }).text : q).replace(/\s+/g, ' ').trim();

/**
 * Records every statement the app runs on `pool`, in order: `pool.query` AND `query` on each
 * client checked out with `pool.connect()` (transactions such as storeLoginChallenge), so a
 * query-parity test covers the full SQL sequence, not just the pool's share of it.
 *
 * A `pool.query` is recorded once, when called (pg-pool runs it on a client of its own, which is
 * not recorded again). A checked-out client's `query` is restored when the client is released.
 */
export function spySql(pool: pg.Pool): { sql(): string[]; clear(): void; restore(): void } {
  const log: string[] = [];
  const target = pool as unknown as Record<'query' | 'connect', unknown>;
  const ownQuery = Object.prototype.hasOwnProperty.call(pool, 'query');
  const ownConnect = Object.prototype.hasOwnProperty.call(pool, 'connect');
  const origQuery = pool.query as (...a: unknown[]) => unknown;
  const origConnect = pool.connect as (...a: unknown[]) => unknown;
  let inPoolQuery = false;

  const wrap = (client: pg.PoolClient) => {
    const query = client.query as (...a: unknown[]) => unknown;
    const release = client.release;
    (client as unknown as { query: unknown }).query = function (this: unknown, ...a: unknown[]) {
      log.push(norm(a[0]));
      return query.apply(this, a);
    };
    client.release = (...a: Parameters<pg.PoolClient['release']>) => {
      (client as unknown as { query: unknown }).query = query;
      client.release = release;
      return release.apply(client, a);
    };
  };

  target.query = function (this: unknown, ...a: unknown[]) {
    log.push(norm(a[0]));
    inPoolQuery = true;
    try {
      return origQuery.apply(this, a);
    } finally {
      inPoolQuery = false;
    }
  };
  target.connect = function (this: unknown, ...a: unknown[]) {
    // pg-pool's own query() checks out a client synchronously: already recorded above.
    if (inPoolQuery) return origConnect.apply(this, a);
    const cb = a[0];
    if (typeof cb === 'function') {
      return origConnect.call(this, (err: unknown, client: pg.PoolClient | undefined, done: unknown) => {
        if (!err && client) wrap(client);
        (cb as (...x: unknown[]) => unknown)(err, client, done);
      });
    }
    return (origConnect.call(this) as Promise<pg.PoolClient>).then((client) => {
      wrap(client);
      return client;
    });
  };

  return {
    sql: () => [...log],
    clear: () => {
      log.length = 0;
    },
    restore: () => {
      if (ownQuery) target.query = origQuery;
      else delete target.query;
      if (ownConnect) target.connect = origConnect;
      else delete target.connect;
    },
  };
}
