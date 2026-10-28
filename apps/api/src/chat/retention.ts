import { chatPurgeDue, type ChatRetentionFacts } from '@x2f/trade';
import type pg from 'pg';
import type { RetentionJob } from '../retention.js';
import { PURGE_ROLE } from '../trades/purge.js';

/**
 * Decides from a chat's facts whether it is due for deletion now. The default is @x2f/trade's
 * `chatPurgeDue` (90 days after the linked trade closes, never while disputed; 7 idle days before a
 * trade). Plan 7's self-delete plugs its per-side times in here without a schema change
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
}

/**
 * Deletes every chat the rule says is due (its identities, attestation and envelopes go with it,
 * by cascade). Runs as `x2f_purge`. Returns the number of chats deleted.
 */
export async function purgeChats(db: pg.Pool, now: Date, due: ChatPurgeRule = chatPurgeDue): Promise<number> {
  let removed = 0;
  let after = '';
  for (;;) {
    const { rows } = await db.query<FactRow>(
      `select c.code, c.trade_code, c.created_at, c.last_message_at, t.closed_at, t.state
         from chats c left join trades t on t.code = c.trade_code
        where c.code > $1 order by c.code limit $2`,
      [after, BATCH],
    );
    if (rows.length === 0) return removed;
    after = rows[rows.length - 1]!.code;
    const doomed = rows
      .filter((r) =>
        due(
          {
            tradeLinked: r.trade_code !== null,
            tradeClosedAt: r.closed_at,
            disputeOpen: r.state === 'disputed',
            createdAt: r.created_at,
            lastMessageAt: r.last_message_at,
          },
          now,
        ),
      )
      .map((r) => r.code);
    if (doomed.length > 0) removed += await deleteChats(db, doomed);
    if (rows.length < BATCH) return removed;
  }
}

async function deleteChats(db: pg.Pool, codes: string[]): Promise<number> {
  const client = await db.connect();
  try {
    await client.query('begin');
    try {
      await client.query(`set local role ${PURGE_ROLE}`);
      // Checked again under the purge role: a chat whose trade went into dispute since it was read stays.
      const { rowCount } = await client.query(
        `delete from chats c where c.code = any($1)
           and not exists (select 1 from trades t where t.code = c.trade_code and t.state = 'disputed')`,
        [codes],
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
