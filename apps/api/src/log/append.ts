import { createHash } from 'node:crypto';
import { normalizeTradeCode } from '@x2f/core';
import { canonicalJson, type Actor } from '@x2f/staff';
import type { By, TradeEvent } from '@x2f/trade';
import type pg from 'pg';
import { LOG_ACTIONS, assertDetail, type LogAction } from './actions.js';

/** The advisory lock key every append, and the migration's chain trigger, takes. */
export const LOG_LOCK_KEY = 7240001;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The stored columns of an entry, as hashed. */
export interface LogRowFields {
  id: string;
  at: Date;
  actorKind: Actor['kind'];
  actorId: string | null;
  actorRole: string | null;
  tradeCode: string | null;
  action: string;
  detail: string;
}

/**
 * hash = SHA-256(prev_hash ‖ utf8(id | at | actor_kind | actor_id | actor_role | trade_code |
 * action | detail)), `at` as ISO with milliseconds and Z, nulls as empty strings. The migration's
 * chain trigger computes the same.
 */
export function chainHash(prev: Buffer | null, r: LogRowFields): Buffer {
  const line = [
    r.id,
    r.at.toISOString(),
    r.actorKind,
    r.actorId ?? '',
    r.actorRole ?? '',
    r.tradeCode ?? '',
    r.action,
    r.detail,
  ].join('|');
  return createHash('sha256')
    .update(prev ?? Buffer.alloc(0))
    .update(line, 'utf8')
    .digest();
}

function actorColumns(a: Actor): { kind: Actor['kind']; id: string | null; role: string | null } {
  switch (a.kind) {
    case 'staff': {
      const id = a.id.toLowerCase();
      if (!UUID.test(id)) throw new TypeError('appendLog: staff id is not a uuid');
      return { kind: 'staff', id, role: a.role };
    }
    case 'trader':
      // The side, never an account id or name: the log needs who acted in the trade, not who they are.
      return { kind: 'trader', id: null, role: a.side };
    case 'system':
      return { kind: 'system', id: null, role: null };
  }
}

/**
 * Appends one entry inside the caller's transaction (`client` must be in one: the advisory lock is
 * held until it ends, so appends are serialised and the chain never forks). Throws LogDetailError
 * for a detail its action does not allow, and TypeError for an invalid trade code or staff id.
 */
export async function appendLog(
  client: pg.PoolClient,
  e: { at: Date; actor: Actor; tradeCode: string | null; action: LogAction; detail: object },
): Promise<{ id: string; hash: string }> {
  assertDetail(e.action, e.detail);
  if (!Number.isFinite(e.at.getTime())) throw new TypeError('appendLog: invalid time');
  let tradeCode: string | null = null;
  if (e.tradeCode !== null) {
    tradeCode = normalizeTradeCode(e.tradeCode);
    if (tradeCode === null) throw new TypeError('appendLog: invalid trade code');
  }
  const actor = actorColumns(e.actor);
  const detail = canonicalJson(e.detail);

  await client.query('select pg_advisory_xact_lock($1)', [LOG_LOCK_KEY]);
  const head = await client.query<{ hash: Buffer }>('select hash from activity_log order by id desc limit 1');
  const prev = head.rows[0]?.hash ?? null;
  const { rows } = await client.query<{ id: string }>(
    "select nextval(pg_get_serial_sequence('activity_log', 'id'))::text as id",
  );
  const fields: LogRowFields = {
    id: rows[0]!.id,
    at: new Date(e.at.getTime()),
    actorKind: actor.kind,
    actorId: actor.id,
    actorRole: actor.role,
    tradeCode,
    action: e.action,
    detail,
  };
  const hash = chainHash(prev, fields);
  await client.query(
    `insert into activity_log (id, at, actor_kind, actor_id, actor_role, trade_code, action, detail, prev_hash, hash)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [fields.id, fields.at, fields.actorKind, fields.actorId, fields.actorRole, tradeCode, e.action, detail, prev, hash],
  );
  return { id: fields.id, hash: hash.toString('hex') };
}

/** Who sent a trade event, as a log actor. */
export function actorOfBy(by: By): Actor {
  return by === 'system' ? { kind: 'system' } : { kind: 'trader', side: by };
}

/**
 * The log detail of a trade event: the stored event record's fields that the action's schema
 * lists (so never an address or its end). A field whose value does not fit is left out rather
 * than failing the trade event.
 */
export function tradeLogDetail(record: Record<string, unknown>, action: `trade.${TradeEvent['type']}`): object {
  const schema: Readonly<Record<string, string>> = LOG_ACTIONS[action];
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(schema)) {
    if (!Object.hasOwn(record, k)) continue;
    try {
      assertDetail(action, { [k]: record[k] });
      out[k] = record[k];
    } catch {
      // Left out: the log keeps ids and amounts only.
    }
  }
  return out;
}
