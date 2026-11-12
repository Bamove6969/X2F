import { createHash } from 'node:crypto';

/**
 * The activity log's hash chain (Plan 4 Task 3), shared by the API, which appends and verifies it,
 * and the moderation process, which checkpoints and verifies it through its read-only role (Plan 4
 * Task 14). Node only (node:crypto); no database driver: callers hand in a `ChainReader`, or a
 * query function for `pgChainReader`.
 */

/** The stored columns of an entry, as hashed. */
export interface LogRowFields {
  id: string;
  at: Date;
  actorKind: 'staff' | 'trader' | 'system';
  actorId: string | null;
  actorRole: string | null;
  tradeCode: string | null;
  action: string;
  detail: string;
}

/**
 * hash = SHA-256(prev_hash ‖ utf8(id | at | actor_kind | actor_id | actor_role | trade_code |
 * action | detail)), `at` as ISO with milliseconds and Z, nulls as empty strings. The migration's
 * chain trigger (201) computes the same.
 */
export function chainHash(prev: Uint8Array | null, r: LogRowFields): Buffer {
  const line = [r.id, r.at.toISOString(), r.actorKind, r.actorId ?? '', r.actorRole ?? '', r.tradeCode ?? '', r.action, r.detail].join('|');
  return createHash('sha256')
    .update(prev ?? Buffer.alloc(0))
    .update(line, 'utf8')
    .digest();
}

/** An entry as read back: its fields and its stored links. */
export interface ChainRow extends LogRowFields {
  prevHash: Buffer | null;
  hash: Buffer;
}

export interface ChainReader {
  /** The entry with this id, or null. */
  row(id: string): Promise<ChainRow | null>;
  /** Up to `limit` entries after `id` (exclusive), in id order. */
  after(id: string, limit: number): Promise<ChainRow[]>;
}

export type VerifyResult = { ok: true; head: { id: string; hash: string } | null } | { ok: false; brokenAt: string };

const same = (a: Buffer | null, b: Buffer | null) => (a === null || b === null ? a === b : a.equals(b));

/**
 * Re-computes the chain. Without `from` it starts at the first row (whose prev_hash must be null);
 * with a checkpoint `from` it first checks that row still has the checkpoint's hash, then verifies
 * every later row. Each row must link to the row before it (a removed row breaks the next one) and
 * its stored hash must match its contents. `brokenAt` is the first row that fails.
 */
export async function verifyChain(read: ChainReader, from?: { id: string; hash: string }, batch = 1000): Promise<VerifyResult> {
  let prev: Buffer | null = null;
  let after = '0';
  let head: { id: string; hash: string } | null = null;
  if (from) {
    const r = await read.row(from.id);
    if (!r) return { ok: false, brokenAt: from.id };
    const own = chainHash(r.prevHash, r);
    if (!own.equals(r.hash) || r.hash.toString('hex') !== from.hash.toLowerCase()) return { ok: false, brokenAt: from.id };
    prev = r.hash;
    after = r.id;
    head = { id: r.id, hash: r.hash.toString('hex') };
  }
  for (;;) {
    const rows = await read.after(after, batch);
    for (const r of rows) {
      if (!same(r.prevHash, prev)) return { ok: false, brokenAt: r.id };
      if (!chainHash(prev, r).equals(r.hash)) return { ok: false, brokenAt: r.id };
      prev = r.hash;
      after = r.id;
      head = { id: r.id, hash: r.hash.toString('hex') };
    }
    if (rows.length < batch) return { ok: true, head };
  }
}

interface PgRow {
  id: string;
  at: Date;
  actor_kind: LogRowFields['actorKind'];
  actor_id: string | null;
  actor_role: string | null;
  trade_code: string | null;
  action: string;
  detail: string;
  prev_hash: Buffer | null;
  hash: Buffer;
}

/** Anything with pg's `query` (a pool, a client, the API's or the moderation reader's). */
export interface Querier {
  query(sql: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

// Qualified: an unqualified `order by id` would sort by the text alias.
const COLS = 'l.id::text as id, l.at, l.actor_kind, l.actor_id::text as actor_id, l.actor_role, l.trade_code, l.action, l.detail, l.prev_hash, l.hash';

const rowOf = (r: PgRow): ChainRow => ({
  id: r.id,
  at: r.at,
  actorKind: r.actor_kind,
  actorId: r.actor_id,
  actorRole: r.actor_role,
  tradeCode: r.trade_code,
  action: r.action,
  detail: r.detail,
  prevHash: r.prev_hash,
  hash: r.hash,
});

/** The chain as `activity_log` stores it (migration 201). */
export function pgChainReader(db: Querier): ChainReader {
  return {
    async row(id) {
      const rows = (await db.query(`select ${COLS} from activity_log l where l.id = $1`, [id])).rows as PgRow[];
      return rows[0] ? rowOf(rows[0]) : null;
    },
    async after(id, limit) {
      const rows = (await db.query(`select ${COLS} from activity_log l where l.id > $1 order by l.id limit ${Math.max(1, Math.floor(limit))}`, [id])).rows as PgRow[];
      return rows.map(rowOf);
    },
  };
}

/** The newest entry's id and hash (hex), or null for an empty log. */
export async function logHead(db: Querier): Promise<{ id: string; hash: string } | null> {
  const rows = (await db.query('select l.id::text as id, l.hash from activity_log l order by l.id desc limit 1')).rows as Array<{ id: string; hash: Buffer }>;
  return rows[0] ? { id: rows[0].id, hash: rows[0].hash.toString('hex') } : null;
}
