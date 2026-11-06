import type pg from 'pg';

/** One API activity-log entry as the internal API checks it (never its detail). */
export interface LogEntryRow {
  id: string;
  at: Date;
  action: string;
  tradeCode: string | null;
}

/** One stored chat envelope (ciphertext only). */
export interface EnvelopeRow {
  id: string;
  senderRole: string;
  envelope: unknown;
  at: Date;
}

/**
 * What the internal API reads from the API's database (Plan 4 Task 11), through the read-only role
 * `x2f_mod_reader` (migration 208: these columns of these four tables, nothing else, no writes).
 * Reading the log entry from the database itself, rather than taking the API's word for it, is the
 * point: a chat read leaves a hash-chained log entry or it does not happen.
 */
export interface ApiView {
  logEntry(id: string): Promise<LogEntryRow | null>;
  /** The trade's current dispute's status (the highest seq), or null when it has none. */
  disputeStatus(code: string): Promise<string | null>;
  /** The trade's chat code, or null when it has no chat. */
  chatOf(code: string): Promise<string | null>;
  /** The chat's envelopes, oldest first. */
  envelopes(chat: string): Promise<EnvelopeRow[]>;
}

/** Envelopes read per chat at most (a dispute's chat is far smaller; the read stays bounded). */
export const MAX_ENVELOPES = 5_000;

export function pgApiView(db: Pick<pg.Pool, 'query'>): ApiView {
  return {
    async logEntry(id) {
      const { rows } = await db.query<{ id: string; at: Date; action: string; trade_code: string | null }>(
        'select id::text as id, at, action, trade_code from activity_log where id = $1',
        [id],
      );
      const r = rows[0];
      return r ? { id: r.id, at: r.at, action: r.action, tradeCode: r.trade_code } : null;
    },
    async disputeStatus(code) {
      const { rows } = await db.query<{ status: string }>('select status from disputes where code = $1 order by seq desc limit 1', [code]);
      return rows[0]?.status ?? null;
    },
    async chatOf(code) {
      const { rows } = await db.query<{ code: string }>('select code from chats where trade_code = $1', [code]);
      return rows[0]?.code ?? null;
    },
    async envelopes(chat) {
      const { rows } = await db.query<{ id: string; sender_role: string; envelope: unknown; created_at: Date }>(
        'select id::text as id, sender_role, envelope, created_at from chat_envelopes where chat = $1 order by id limit $2',
        [chat, MAX_ENVELOPES],
      );
      return rows.map((r) => ({ id: r.id, senderRole: r.sender_role, envelope: r.envelope, at: r.created_at }));
    },
  };
}
