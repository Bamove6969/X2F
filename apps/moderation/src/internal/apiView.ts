import type pg from 'pg';

/** One API activity-log entry as the internal API checks it (never its detail). */
export interface LogEntryRow {
  id: string;
  at: Date;
  action: string;
  tradeCode: string | null;
  /** Who wrote it: `staff`, `trader` or `system`, and the account (null for the system). */
  actorKind: string;
  actorId: string | null;
}

/**
 * What the internal API reads from the API's database (Plan 4 Task 11), through the read-only role
 * `x2f_mod_reader` (migrations 208, 211, 212, 710 and 714: these columns of these tables, nothing
 * else, no writes; never a chat envelope: the moderator's read is a re-wrap of the chat key to a
 * staff device, design build task 9, and staff-web decrypts).
 * Reading the log entry from the database itself, rather than taking the API's word for it, is the
 * point: a moderator's message leaves a hash-chained log entry or it does not happen.
 */
export interface ApiView {
  logEntry(id: string): Promise<LogEntryRow | null>;
  /** The trade's current dispute's status (the highest seq), or null when it has none. */
  disputeStatus(code: string): Promise<string | null>;
  /** The assignee (staff account id) of the trade's current dispute, or null (none, or unassigned). The API's word. */
  disputeAssignee(code: string): Promise<string | null>;
  /** The trade's chat code, or null when it has no chat. */
  chatOf(code: string): Promise<string | null>;
  /**
   * Build task 9: the signed statement of the chat's live moderator grant by `grantBy` with this
   * signature, exactly as filed, or null. The API's word: the caller verifies it again.
   */
  modGrant(chat: string, grantBy: string, grantSig: string): Promise<unknown | null>;
}

export function pgApiView(db: Pick<pg.Pool, 'query'>): ApiView {
  return {
    async logEntry(id) {
      const { rows } = await db.query<{ id: string; at: Date; action: string; trade_code: string | null; actor_kind: string; actor_id: string | null }>(
        'select id::text as id, at, action, trade_code, actor_kind, actor_id::text as actor_id from activity_log where id = $1',
        [id],
      );
      const r = rows[0];
      return r ? { id: r.id, at: r.at, action: r.action, tradeCode: r.trade_code, actorKind: r.actor_kind, actorId: r.actor_id } : null;
    },
    async disputeStatus(code) {
      const { rows } = await db.query<{ status: string }>('select status from disputes where code = $1 order by seq desc limit 1', [code]);
      return rows[0]?.status ?? null;
    },
    async disputeAssignee(code) {
      const { rows } = await db.query<{ assignee: string | null }>('select assignee::text as assignee from disputes where code = $1 order by seq desc limit 1', [code]);
      return rows[0]?.assignee ?? null;
    },
    async chatOf(code) {
      const { rows } = await db.query<{ code: string }>('select code from chats where trade_code = $1', [code]);
      return rows[0]?.code ?? null;
    },
    async modGrant(chat, grantBy, grantSig) {
      const { rows } = await db.query<{ statement: unknown }>(
        "select statement from chat_members where chat = $1 and member_kind = 'mod' and granted_by = $2 and sig = $3 and removed_at is null",
        [chat, grantBy, grantSig],
      );
      return rows[0]?.statement ?? null;
    },
  };
}
