/**
 * Plan 5 Task 14: proof ciphertexts (migration 580). The API is a courier: it stores what the
 * uploader's device encrypted and serves it to the trade's parties; it never parses, decrypts or
 * describes it, and logs nothing about it (no id, trade code or size).
 */
import { chatPurgeDue, type ChatRetentionFacts } from '@x2f/trade';
import type pg from 'pg';
import type { Queryable } from '../db/pool.js';
import type { RetentionJob } from '../retention.js';
import { LIEN_FACTS_SQL } from '../chat/retention.js';
import { PURGE_ROLE } from '../trades/purge.js';

/** P5-A25: payment proofs per side per trade. */
export const PROOF_MAX_PER_SIDE = 5;
/** Dispute evidence per side per trade, its own allowance (lead 2026-11-12, review M4). Unblurred copies never count. */
export const EVIDENCE_MAX_PER_SIDE = 5;
/** The smallest ciphertext: a 24-byte nonce and a 16-byte tag. */
export const PROOF_MIN_CIPHERTEXT = 40;

export type StoredProofKind = 'proof' | 'evidence' | 'unblurred';

/** SQL for an id's one-time tag (proof_id_tags). */
const TAG = `sha256(convert_to('x2f/proof-id/v1|' || $1::text, 'UTF8'))`;

/**
 * Takes the id's one-time tag; false when the id was ever stored before (any trade, even purged).
 * Call inside the upload's transaction, so a refused upload does not spend the id. Only the UTC day
 * is kept (review M3): the exact time would match the proof's own and outlive it.
 */
export async function claimProofId(q: Queryable, id: string, now: Date): Promise<boolean> {
  const r = await q.query(
    `insert into proof_id_tags (tag, used_on) values (${TAG}, ($2::timestamptz at time zone 'UTC')::date) on conflict (tag) do nothing`,
    [id, now],
  );
  return (r.rowCount ?? 0) === 1;
}

export async function countProofs(q: Queryable, code: string, role: 'buyer' | 'seller', kind: StoredProofKind): Promise<number> {
  const { rows } = await q.query<{ n: number }>(
    'select count(*)::int as n from trade_proofs where trade_code = $1 and uploader_role = $2 and kind = $3',
    [code, role, kind],
  );
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

/**
 * Whether this side stored this proof (a payment proof or evidence, never an unblurred copy) for this
 * trade. Existence only: never the ciphertext. For the blur check's announce (proof stack), the one
 * user outside proofs/ (staff.test.ts names it).
 */
export async function isStoredProof(q: Queryable, code: string, id: string, side: 'buyer' | 'seller'): Promise<boolean> {
  const { rows } = await q.query(
    `select 1 from trade_proofs where id = $1 and trade_code = $2 and uploader_role = $3 and kind in ('proof', 'evidence')`,
    [id, code, side],
  );
  return rows.length > 0;
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
  lien_open: boolean;
  lien_ended: Date | null;
}

// The chat's facts for a trade (chat/retention.ts), for trades that hold proofs, the lien's included.
const FACTS = `select t.code, t.closed_at, t.taken_at, t.state, t.dispute_by,
                      d.total as disputes, d.still_open as disputes_open, d.last_closed as dispute_closed_at,
                      ${LIEN_FACTS_SQL('t.code')}
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
  // Owner 26 Nov 2026: an unpaid lien from the trade keeps its proofs; an ended one, 90 days more.
  lienOpen: r.lien_open,
  lienEndedAt: r.lien_ended,
});

/**
 * Deletes the proofs of every trade whose chat would be deleted now (`chatPurgeDue`, owner revision
 * 2026-10-29: 30 days after an undisputed trade ends, 90 days after its dispute closes, never while
 * one is open; owner 26 Nov 2026: never while a lien from the trade is unpaid, then 90 days after
 * it ends). Runs as x2f_purge; the delete re-checks the open-dispute rule itself, so a dispute
 * opened since the scan keeps them. The trades are locked `for share` first, in code order, as
 * purgeChats does (review M2): opening a dispute holds the trade's row lock, so a dispute not yet
 * committed makes the delete wait for it and then see it. The lock comes before the switch to the
 * purge role. `due` is the rule (a test passes its own to reach the delete's checks). Returns the
 * number of proofs deleted.
 */
export async function purgeProofs(
  db: pg.Pool,
  now: Date,
  due: (facts: ChatRetentionFacts, now: Date, code: string) => boolean = (f, n) => chatPurgeDue(f, n),
): Promise<number> {
  const { rows } = await db.query<FactRow>(`${FACTS} where t.code in (select distinct trade_code from trade_proofs)`);
  const doomed = rows.filter((r) => due(factsOf(r), now, r.code)).map((r) => r.code);
  if (doomed.length === 0) return 0;
  const client = await db.connect();
  try {
    await client.query('begin');
    try {
      await client.query('select 1 from trades where code = any($1) order by code for share', [doomed]);
      // Owner 26 Nov 2026: a trade with an unpaid lien keeps its proofs. Checked again under the
      // trade's lock and before the role switch (x2f_purge may not read liens): a lien only comes
      // from a dispute, which the delete itself re-checks, so this is the belt to that check.
      const { rows: free } = await client.query<{ code: string }>(
        `select c.code from unnest($1::text[]) c (code)
          where not exists (select 1 from liens l where l.from_code = c.code and l.status in ('active', 'suspended'))`,
        [doomed],
      );
      if (free.length === 0) {
        await client.query('commit');
        return 0;
      }
      await client.query(`set local role ${PURGE_ROLE}`);
      const r = await client.query(
        `delete from trade_proofs p where p.trade_code = any($1)
           and not exists (select 1 from trades t where t.code = p.trade_code and t.state = 'disputed')
           and not exists (select 1 from disputes d where d.code = p.trade_code and d.status <> 'closed')`,
        [free.map((f) => f.code)],
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

export const purgeProofsJob: RetentionJob = { name: 'purgeProofs', run: (db, now) => purgeProofs(db, now) };
