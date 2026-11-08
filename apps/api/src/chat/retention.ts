import { chatPurgeDue, type ChatRetentionFacts } from '@x2f/trade';
import type pg from 'pg';
import type { RetentionJob } from '../retention.js';
import { PURGE_ROLE } from '../trades/purge.js';

/**
 * Decides from a chat's facts whether it is due for deletion now. The default is @x2f/trade's
 * `chatPurgeDue` (30 days after an undisputed trade closes, 90 after a dispute closes, never while
 * one is open; 7 idle days before a trade). Plan 7's self-delete plugs its per-side times in here without a schema change
 * (Revision 2026-10-28).
 */
export type ChatPurgeRule = (facts: ChatRetentionFacts, now: Date) => boolean;

const BATCH = 500;

interface FactRow {
  code: string;
  trade_code: string | null;
  created_at: Date;
  last_message_at: Date | null;
  closed_at: Date | null;
  state: string | null;
  dispute_by: string | null;
  disputes: number;
  disputes_open: number;
  dispute_closed_at: Date | null;
}

const factsOf = (r: FactRow): ChatRetentionFacts => ({
  tradeLinked: r.trade_code !== null,
  tradeClosedAt: r.closed_at,
  disputeOpen: r.state === 'disputed' || r.disputes_open > 0,
  disputed: r.dispute_by !== null || r.disputes > 0,
  disputeClosedAt: r.dispute_closed_at,
  createdAt: r.created_at,
  lastMessageAt: r.last_message_at,
});

// `closed` is the machine's last status and the only one with a closed_at; every other status
// counts as open, including `published` (the appeal window, on a trade that has already closed).
const FACTS = `select c.code, c.trade_code, c.created_at, c.last_message_at, t.closed_at, t.state, t.dispute_by,
                      d.total as disputes, d.still_open as disputes_open, d.last_closed as dispute_closed_at
                 from chats c
                 left join trades t on t.code = c.trade_code
                 left join lateral (select count(*)::int as total,
                                           (count(*) filter (where x.status <> 'closed'))::int as still_open,
                                           max(x.closed_at) as last_closed
                                      from disputes x where x.code = t.code) d on true`;

/**
 * Deletes every chat the rule says is due (its identities, attestation and envelopes go with it,
 * by cascade). The delete runs as `x2f_purge`. Returns the number of chats deleted.
 */
export async function purgeChats(db: pg.Pool, now: Date, due: ChatPurgeRule = chatPurgeDue): Promise<number> {
  let removed = 0;
  let after = '';
  for (;;) {
    const { rows } = await db.query<FactRow>(
      `${FACTS} where c.code > $1 order by c.code limit $2`,
      [after, BATCH],
    );
    if (rows.length === 0) return removed;
    after = rows[rows.length - 1]!.code;
    const doomed = rows.filter((r) => due(factsOf(r), now)).map((r) => r.code);
    if (doomed.length > 0) removed += await deleteChats(db, doomed, now, due);
    if (rows.length < BATCH) return removed;
  }
}

/**
 * Deletes the chats judged due by the scan, after judging them again under a row lock (round-2
 * review m1): a chat linked by a take (take.ts → linkChatToTrade) or written to (a post holds the
 * same row lock, then sets last_message_at) between the scan and here keeps its history. The lock
 * is taken before the switch to the purge role (x2f_purge may delete chats but not update them,
 * and FOR UPDATE needs update rights); the facts are read again after it, in a new statement, so
 * they include whatever the lock waited for.
 */
async function deleteChats(db: pg.Pool, codes: string[], now: Date, due: ChatPurgeRule): Promise<number> {
  const client = await db.connect();
  try {
    await client.query('begin');
    try {
      await client.query('select 1 from chats where code = any($1) order by code for update', [codes]);
      const fresh = await client.query<FactRow>(`${FACTS} where c.code = any($1)`, [codes]);
      const still = fresh.rows.filter((r) => due(factsOf(r), now)).map((r) => r.code);
      if (still.length === 0) {
        await client.query('commit');
        return 0;
      }
      await client.query(`set local role ${PURGE_ROLE}`);
      // Checked again under the purge role: a chat whose trade went into dispute since it was read stays,
      // and so does one with any dispute not yet closed (120 grants the role just these two columns).
      const { rowCount } = await client.query(
        `delete from chats c where c.code = any($1)
           and not exists (select 1 from trades t where t.code = c.trade_code and t.state = 'disputed')
           and not exists (select 1 from disputes d where d.code = c.trade_code and d.status <> 'closed')`,
        [still],
      );
      await client.query('commit');
      return rowCount ?? 0;
    } catch (e) {
      await client.query('rollback');
      throw e;
    }
  } finally {
    client.release();
  }
}

export const purgeChatsJob: RetentionJob = { name: 'purgeChats', run: (db, now) => purgeChats(db, now) };
