/**
 * Support tickets (Plan 4 Task 30; spec 6.6, Helper): the storage shared by the trader routes
 * (traderRoutes.ts) and the staff routes (staffRoutes.ts), and the retention job.
 *
 * At rest (migration 811): a message's text is only ever stored sealed, AES-256-GCM under the server
 * key's `subkey('ticket-body')`, with the ticket id, the message's place and its sender as the
 * associated data. The text is opened only to answer the ticket's own trader or the staff member who
 * took it; it is never logged (the activity log gets the ticket id only) and never put in an error.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { TICKET_BODY_MAX, TICKET_KEEP_DAYS, type TicketCategory, type TicketStatus } from '@x2f/core';
import type pg from 'pg';
import { subkey, type Config } from '../config.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { HIDDEN } from '../feedback/form.js';
import type { RetentionJob } from '../retention.js';

export type Sender = 'trader' | 'staff';

const NONCE = 12;
const TAG = 16;
const DAY_MS = 86_400_000;

/** Bound to the ticket, the message's place in it and who wrote it. */
const aad = (ticketId: string, seq: number, sender: Sender) => Buffer.from(`x2f/ticket-message/${ticketId}/${seq}/${sender}`, 'utf8');

export function sealBody(config: Config, ticketId: string, seq: number, sender: Sender, text: string): Buffer {
  const nonce = randomBytes(NONCE);
  const c = createCipheriv('aes-256-gcm', subkey(config, 'ticket-body'), nonce, { authTagLength: TAG });
  c.setAAD(aad(ticketId, seq, sender));
  const body = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return Buffer.concat([nonce, body, c.getAuthTag()]);
}

/** Throws when the blob does not open (another ticket's, another place's, tampered with, or the server key changed). */
export function openBody(config: Config, ticketId: string, seq: number, sender: Sender, sealed: Buffer): string {
  if (sealed.length < NONCE + TAG + 1) throw new Error('ticket message is malformed');
  const d = createDecipheriv('aes-256-gcm', subkey(config, 'ticket-body'), sealed.subarray(0, NONCE), { authTagLength: TAG });
  d.setAAD(aad(ticketId, seq, sender));
  d.setAuthTag(sealed.subarray(sealed.length - TAG));
  return Buffer.concat([d.update(sealed.subarray(NONCE, sealed.length - TAG)), d.final()]).toString('utf8');
}

/** A message as typed: line breaks made `\n`, trimmed, 1..TICKET_BODY_MAX characters, no hidden control or direction marks. 400 otherwise. */
export function cleanBody(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > TICKET_BODY_MAX * 4) throw new ApiError(400, 'bad-request');
  const clean = raw.replace(/\r\n?/g, '\n').trim();
  const length = [...clean].length;
  if (length < 1 || length > TICKET_BODY_MAX || HIDDEN.test(clean)) throw new ApiError(400, 'bad-request');
  return clean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The `:id` of a ticket route: a lower-case uuid, or 404 (an id of the wrong shape names no ticket). */
export function ticketIdOf(params: unknown): string {
  const id = (params as { id?: unknown }).id;
  if (typeof id !== 'string' || !UUID.test(id)) throw new ApiError(404, 'not-found');
  return id;
}

export interface TicketRow {
  id: string;
  account_id: string;
  category: TicketCategory;
  trade_code: string | null;
  status: TicketStatus;
  taken_by: string | null;
  created_at: Date;
  updated_at: Date;
  closed_at: Date | null;
}

const COLUMNS = 'id, account_id, category, trade_code, status, taken_by, created_at, updated_at, closed_at';

/** The ticket, locked `for update` when `lock`; null when there is none. */
export async function loadTicket(q: Queryable, id: string, o: { lock?: boolean } = {}): Promise<TicketRow | null> {
  const { rows } = await q.query<TicketRow>(`select ${COLUMNS} from tickets where id = $1${o.lock ? ' for update' : ''}`, [id]);
  return rows[0] ?? null;
}

export interface MessageView {
  from: Sender;
  body: string;
  at: string;
}

interface MessageRow {
  seq: number;
  sender: Sender;
  staff_id: string | null;
  body_sealed: Buffer;
  at: Date;
}

/** Every message of the ticket, oldest first, opened; `staffId` too (the staff view says which are the reader's own). */
export async function messagesOf(q: Queryable, config: Config, ticketId: string): Promise<Array<MessageView & { staffId: string | null }>> {
  const { rows } = await q.query<MessageRow>('select seq, sender, staff_id, body_sealed, at from ticket_messages where ticket_id = $1 order by seq', [ticketId]);
  return rows.map((r) => ({ from: r.sender, body: openBody(config, ticketId, r.seq, r.sender, r.body_sealed), at: r.at.toISOString(), staffId: r.staff_id }));
}

/** Adds a message at the next place; the caller holds the ticket's lock. Returns its place. */
export async function addMessage(
  c: Queryable,
  config: Config,
  m: { ticketId: string; sender: Sender; staffId: string | null; text: string; at: Date },
): Promise<number> {
  const { rows } = await c.query<{ seq: number }>('select coalesce(max(seq), 0)::int + 1 as seq from ticket_messages where ticket_id = $1', [m.ticketId]);
  const seq = rows[0]!.seq;
  await c.query('insert into ticket_messages (ticket_id, seq, sender, staff_id, body_sealed, at) values ($1, $2, $3, $4, $5, $6)', [
    m.ticketId, seq, m.sender, m.staffId, sealBody(config, m.ticketId, seq, m.sender, m.text), m.at,
  ]);
  return seq;
}

/**
 * Retention (Task 30): a ticket goes, with its messages, TICKET_KEEP_DAYS after its last activity
 * (`updated_at`: the last message or the close), whatever its status, so an abandoned ticket does
 * not stay either; and a ticket that names a trade goes as soon as that trade is purged (the trade
 * retention rules, retention/tradePurge.ts), whichever comes first. Logs nothing.
 */
export const purgeTickets: RetentionJob = {
  name: 'purgeTickets',
  async run(db: pg.Pool, now: Date): Promise<number> {
    const before = new Date(now.getTime() - TICKET_KEEP_DAYS * DAY_MS);
    const old = await db.query('delete from tickets where updated_at < $1', [before]);
    const gone = await db.query('delete from tickets t where t.trade_code is not null and not exists (select 1 from trades x where x.code = t.trade_code)');
    return (old.rowCount ?? 0) + (gone.rowCount ?? 0);
  },
};
