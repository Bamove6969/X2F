import type { Queryable } from '../db/pool.js';
import { chainHash, type LogRowFields } from './append.js';

interface Row {
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

// Qualified: an unqualified `order by id` would sort by the text alias.
const COLS = 'l.id::text as id, at, actor_kind, actor_id::text as actor_id, actor_role, trade_code, action, detail, prev_hash, hash';
const BATCH = 1000;

const fieldsOf = (r: Row): LogRowFields => ({
  id: r.id,
  at: r.at,
  actorKind: r.actor_kind,
  actorId: r.actor_id,
  actorRole: r.actor_role,
  tradeCode: r.trade_code,
  action: r.action,
  detail: r.detail,
});

const same = (a: Buffer | null, b: Buffer | null) => (a === null || b === null ? a === b : a.equals(b));

export type VerifyResult = { ok: true; head: { id: string; hash: string } | null } | { ok: false; brokenAt: string };

/**
 * Re-computes the chain. Without `from` it starts at the first row (whose prev_hash must be null);
 * with a checkpoint `from` it first checks that row still has the checkpoint's hash, then verifies
 * every later row. Each row must link to the row before it (a removed row breaks the next one) and
 * its stored hash must match its contents. `brokenAt` is the first row that fails.
 */
export async function verifyLogChain(db: Queryable, from?: { id: string; hash: string }): Promise<VerifyResult> {
  let prev: Buffer | null = null;
  let after = '0';
  let head: { id: string; hash: string } | null = null;
  if (from) {
    const { rows } = await db.query<Row>(`select ${COLS} from activity_log l where l.id = $1`, [from.id]);
    const r = rows[0];
    if (!r) return { ok: false, brokenAt: from.id };
    const own = chainHash(r.prev_hash, fieldsOf(r));
    if (!own.equals(r.hash) || r.hash.toString('hex') !== from.hash.toLowerCase()) return { ok: false, brokenAt: from.id };
    prev = r.hash;
    after = r.id;
    head = { id: r.id, hash: r.hash.toString('hex') };
  }
  for (;;) {
    const { rows } = await db.query<Row>(
      `select ${COLS} from activity_log l where l.id > $1 order by l.id limit ${BATCH}`,
      [after],
    );
    for (const r of rows) {
      if (!same(r.prev_hash, prev)) return { ok: false, brokenAt: r.id };
      if (!chainHash(prev, fieldsOf(r)).equals(r.hash)) return { ok: false, brokenAt: r.id };
      prev = r.hash;
      after = r.id;
      head = { id: r.id, hash: r.hash.toString('hex') };
    }
    if (rows.length < BATCH) return { ok: true, head };
  }
}
