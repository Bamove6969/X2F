/**
 * Plan 5 Task 14: proof ciphertexts (migration 580). The API is a courier: it stores what the
 * uploader's device encrypted and serves it to the trade's parties; it never parses, decrypts or
 * describes it, and logs nothing about it (no id, trade code or size).
 */
import { chatPurgeDue, type ChatRetentionFacts } from '@x2f/trade';
import type pg from 'pg';
import type { Queryable } from '../db/pool.js';
import type { RetentionJob } from '../retention.js';
import { PURGE_ROLE } from '../trades/purge.js';

/** P5-A25: proofs per side per trade, all kinds together. */
export const PROOF_MAX_PER_SIDE = 5;
/** The smallest ciphertext: a 24-byte nonce and a 16-byte tag. */
export const PROOF_MIN_CIPHERTEXT = 40;

export type StoredProofKind = 'proof' | 'evidence' | 'unblurred';

/** SQL for an id's one-time tag (proof_id_tags). */
const TAG = `sha256(convert_to('x2f/proof-id/v1|' || $1::text, 'UTF8'))`;

/**
 * Takes the id's one-time tag; false when the id was ever stored before (any trade, even purged).
 * Call inside the upload's transaction, so a refused upload does not spend the id.
 */
export async function claimProofId(q: Queryable, id: string, now: Date): Promise<boolean> {
  const r = await q.query(`insert into proof_id_tags (tag, used_at) values (${TAG}, $2) on conflict (tag) do nothing`, [id, now]);
  return (r.rowCount ?? 0) === 1;
}

export async function countProofs(q: Queryable, code: string, role: 'buyer' | 'seller'): Promise<number> {
  const { rows } = await q.query<{ n: number }>('select count(*)::int as n from trade_proofs where trade_code = $1 and uploader_role = $2', [code, role]);
  return rows[0]!.n;
}

export async function insertProof(
  q: Queryable,
  p: { id: string; code: string; role: 'buyer' | 'seller'; kind: StoredProofKind; ciphertext: Buffer; now: Date },
): Promise<void> {
  await q.query('insert into trade_proofs (id, trade_code, uploader_role, kind, ciphertext, created_at) values ($1, $2, $3, $4, $5, $6)', [
    p.id,
    p.code,
    p.role,
    p.kind,
    p.ciphertext,
    p.now,
  ]);
}

/** A proof of this trade a party may read (`proof` or `evidence`); null for `unblurred` or none. */
export async function readableProof(q: Queryable, code: string, id: string): Promise<Buffer | null> {
  const { rows } = await q.query<{ ciphertext: Buffer }>(
    `select ciphertext from trade_proofs where id = $1 and trade_code = $2 and kind in ('proof', 'evidence')`,
    [id, code],
  );
  return rows[0]?.ciphertext ?? null;
}

interface FactRow {
  code: string;
  closed_at: Date | null;
  taken_at: Date;
  state: string;
  dispute_by: string | null;
  disputes: number;
  disputes_open: number;
  dispute_closed_at: Date | null;
}

// The chat's facts for a trade (chat/retention.ts), for trades that hold proofs.
const FACTS = `select t.code, t.closed_at, t.taken_at, t.state, t.dispute_by,
                      d.total as disputes, d.still_open as disputes_open, d.last_closed as dispute_closed_at
                 from trades t
                 left join lateral (select count(*)::int as total,
                                           (count(*) filter (where x.status <> 'closed'))::int as still_open,
                                           max(x.closed_at) as last_closed
                                      from disputes x where x.code = t.code) d on true`;

const factsOf = (r: FactRow): ChatRetentionFacts => ({
  tradeLinked: true,
  tradeClosedAt: r.closed_at,
  disputeOpen: r.state === 'disputed' || r.disputes_open > 0,
  disputed: r.dispute_by !== null || r.disputes > 0,
  disputeClosedAt: r.dispute_closed_at,
  createdAt: r.taken_at,
  lastMessageAt: null,
});

/**
 * Deletes the proofs of every trade whose chat would be deleted now (`chatPurgeDue`, owner revision
 * 2026-10-29: 30 days after an undisputed trade ends, 90 days after its dispute closes, never while
 * one is open). Runs as x2f_purge; the delete re-checks the open-dispute rule itself, so a dispute
 * opened since the scan keeps them. Returns the number of proofs deleted.
 */
export async function purgeProofs(db: pg.Pool, now: Date): Promise<number> {
  const { rows } = await db.query<FactRow>(`${FACTS} where t.code in (select distinct trade_code from trade_proofs)`);
  const due = rows.filter((r) => chatPurgeDue(factsOf(r), now)).map((r) => r.code);
  if (due.length === 0) return 0;
  const client = await db.connect();
  try {
    await client.query('begin');
    try {
      await client.query(`set local role ${PURGE_ROLE}`);
      const r = await client.query(
        `delete from trade_proofs p where p.trade_code = any($1)
           and not exists (select 1 from trades t where t.code = p.trade_code and t.state = 'disputed')
           and not exists (select 1 from disputes d where d.code = p.trade_code and d.status <> 'closed')`,
        [due],
      );
      await client.query('commit');
      return r.rowCount ?? 0;
    } catch (e) {
      await client.query('rollback');
      throw e;
    }
  } finally {
    client.release();
  }
}

export const purgeProofsJob: RetentionJob = { name: 'purgeProofs', run: purgeProofs };
