/**
 * Support tickets (Plan 4 Task 30; spec 6.6, Helper): the storage shared by the trader routes
 * (traderRoutes.ts) and the staff routes (staffRoutes.ts and compromisedRoutes.ts), and the
 * retention job.
 *
 * At rest (migrations 811, 861): a message's text is only ever stored sealed, by the key store every
 * sealed secret uses (auth/keystore.ts) under the current `X2F_TICKET_KEYS` key (J-14 review J6,
 * ported: its own ring, apart from X2F_SERVER_KEY), with the ticket id, the message's place and its
 * sender as the context. Blobs sealed before migration 861 are format 0 under `subkey('ticket-body')`
 * and are opened only (not even that with `X2F_LEGACY_SECRETS=off`) until `npm run rewrap-tickets -w
 * @x2f/api` (`rewrapTicketSecrets`) has moved them. The text is opened only to answer the ticket's own
 * trader (and team members with "See support tickets") or the staff member who took it (a
 * compromised report: a senior moderator or the owner, logged first); it is never logged (the
 * activity log gets the ticket id only) and never put in an error.
 */
import { TICKET_BODY_MAX, TICKET_KEEP_DAYS, type TicketCategory, type TicketStatus } from '@x2f/core';
import type pg from 'pg';
import { keyringBox, type SecretBox } from '../auth/keystore.js';
import { subkey, type Config } from '../config.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { HIDDEN } from '../feedback/form.js';
import type { RetentionJob } from '../retention.js';

export type Sender = 'trader' | 'staff';

const DAY_MS = 86_400_000;

/** Bound to the ticket, the message's place in it and who wrote it (unchanged since migration 811). */
const context = (ticketId: string, seq: number, sender: Sender) => `x2f/ticket-message/${ticketId}/${seq}/${sender}`;

const boxes = new WeakMap<Config, { ring: Config['ticketKeys']; legacy: boolean; box: SecretBox }>();

/** The ticket key store: `X2F_TICKET_KEYS`, with `subkey('ticket-body')` only to open format-0 blobs (as `totpBox`). */
export function ticketBox(config: Config): SecretBox {
  const cached = boxes.get(config);
  if (cached && cached.ring === config.ticketKeys && cached.legacy === config.legacySecrets) return cached.box;
  const box = keyringBox(config.ticketKeys, config.legacySecrets ? subkey(config, 'ticket-body') : undefined);
  boxes.set(config, { ring: config.ticketKeys, legacy: config.legacySecrets, box });
  return box;
}

const decoder = new TextDecoder('utf-8', { fatal: true });

export function sealBody(config: Config, ticketId: string, seq: number, sender: Sender, text: string): Buffer {
  return ticketBox(config).seal(Buffer.from(text, 'utf8'), context(ticketId, seq, sender));
}

/** Throws when the blob does not open (another ticket's, another place's, tampered with, or its key left the ring). */
export function openBody(config: Config, ticketId: string, seq: number, sender: Sender, sealed: Buffer): string {
  return decoder.decode(ticketBox(config).open(sealed, context(ticketId, seq, sender)));
}

/**
 * Reseals every message not yet under the current `X2F_TICKET_KEYS` key (format 0, or an older key
 * id): run after migration 861 and after each rotation, and again before an old key leaves the ring
 * (only a re-run reporting `{"rewrapped":0,"failed":0}` leaves nothing under it). Each row is written
 * only if it still holds the blob that was read. A blob that does not open is left as it is and
 * counted in `failed`. Returns counts only, never text.
 */
export async function rewrapTicketSecrets(deps: { db: Queryable; config: Config }): Promise<{ rewrapped: number; failed: number }> {
  const box = ticketBox(deps.config);
  const { rows } = await deps.db.query<{ ticket_id: string; seq: number; sender: Sender; body_sealed: Buffer }>(
    'select ticket_id, seq, sender, body_sealed from ticket_messages',
  );
  let rewrapped = 0;
  let failed = 0;
  for (const row of rows) {
    if (box.isCurrent(row.body_sealed)) continue;
    const ctx = context(row.ticket_id, row.seq, row.sender);
    let sealed: Buffer;
    try {
      sealed = box.seal(box.open(row.body_sealed, ctx), ctx);
    } catch {
      failed++;
      continue;
    }
    const r = await deps.db.query('update ticket_messages set body_sealed = $4 where ticket_id = $1 and seq = $2 and body_sealed = $3', [
      row.ticket_id, row.seq, row.body_sealed, sealed,
    ]);
    rewrapped += r.rowCount ?? 0;
  }
  return { rewrapped, failed };
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

export type TicketKind = 'support' | 'compromised';

export interface TicketRow {
  id: string;
  /** Null only on a compromised report that matched no lockable account (migration 860). */
  account_id: string | null;
  kind: TicketKind;
  number: string;
  /** A compromised report's ticked ways to log in (kinds only); empty on a support ticket. */
  methods_left: string[];
  /** A compromised report that matched a lockable account but did not lock it, and why (migration 860). */
  lock_skipped: 'recent-unlock' | 'legacy-login-name' | 'lock-cap' | null;
  category: TicketCategory | 'compromised';
  trade_code: string | null;
  status: TicketStatus;
  taken_by: string | null;
  created_at: Date;
  updated_at: Date;
  closed_at: Date | null;
}

const COLUMNS = 'id, account_id, kind, number, methods_left, lock_skipped, category, trade_code, status, taken_by, created_at, updated_at, closed_at';

/**
 * The ticket of `kind` (a support ticket unless asked; a compromised report is never one, so no
 * support route reads or writes it), locked `for update` when `lock`; null when there is none.
 */
export async function loadTicket(q: Queryable, id: string, o: { lock?: boolean; kind?: TicketKind } = {}): Promise<TicketRow | null> {
  const { rows } = await q.query<TicketRow>(`select ${COLUMNS} from tickets where id = $1 and kind = $2${o.lock ? ' for update' : ''}`, [id, o.kind ?? 'support']);
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
  member_id: string | null;
  member_name: string | null;
  body_sealed: Buffer;
  at: Date;
}

/**
 * Every message of the ticket, oldest first, opened; `staffId` too (the staff view says which are
 * the reader's own), and for a team member's line `memberId` and the member's team name (Q69: the
 * team reads who wrote it; staff are never sent it). A removed member's line keeps neither.
 */
export async function messagesOf(
  q: Queryable,
  config: Config,
  ticketId: string,
): Promise<Array<MessageView & { staffId: string | null; memberId: string | null; memberName: string | null }>> {
  const { rows } = await q.query<MessageRow>(
    `select m.seq, m.sender, m.staff_id, m.member_id, tm.display_name as member_name, m.body_sealed, m.at
       from ticket_messages m left join team_members tm on tm.id = m.member_id
      where m.ticket_id = $1 order by m.seq`,
    [ticketId],
  );
  return rows.map((r) => ({
    from: r.sender, body: openBody(config, ticketId, r.seq, r.sender, r.body_sealed), at: r.at.toISOString(),
    staffId: r.staff_id, memberId: r.member_id, memberName: r.member_name,
  }));
}

/** Adds a message at the next place; the caller holds the ticket's lock. Returns its place. */
export async function addMessage(
  c: Queryable,
  config: Config,
  m: { ticketId: string; sender: Sender; staffId: string | null; memberId?: string | null; text: string; at: Date },
): Promise<number> {
  const { rows } = await c.query<{ seq: number }>('select coalesce(max(seq), 0)::int + 1 as seq from ticket_messages where ticket_id = $1', [m.ticketId]);
  const seq = rows[0]!.seq;
  await c.query('insert into ticket_messages (ticket_id, seq, sender, staff_id, member_id, body_sealed, at) values ($1, $2, $3, $4, $5, $6, $7)', [
    m.ticketId, seq, m.sender, m.staffId, m.memberId ?? null, sealBody(config, m.ticketId, seq, m.sender, m.text), m.at,
  ]);
  return seq;
}

/**
 * Retention (Task 30): a ticket goes, with its messages, TICKET_KEEP_DAYS after its last activity
 * (`updated_at`: the last message or the close), whatever its status, so an abandoned ticket does
 * not stay either; and a ticket that names a trade goes as soon as that trade is purged (the trade
 * retention rules, retention/tradePurge.ts), whichever comes first. Logs nothing.
 *
 * D-059 (lead default, owner question pending): a compromised report is never purged while the lock
 * it put on its account still holds (staff must see why the account is locked); and a lifted lock's
 * row goes TICKET_KEEP_DAYS after its unlock.
 */
export const purgeTickets: RetentionJob = {
  name: 'purgeTickets',
  async run(db: pg.Pool, now: Date): Promise<number> {
    const before = new Date(now.getTime() - TICKET_KEEP_DAYS * DAY_MS);
    const old = await db.query(
      `delete from tickets t where t.updated_at < $1
          and not exists (select 1 from account_locks l where l.ticket_id = t.id and l.unlocked_at is null)`,
      [before],
    );
    const gone = await db.query('delete from tickets t where t.trade_code is not null and not exists (select 1 from trades x where x.code = t.trade_code)');
    const locks = await db.query('delete from account_locks where unlocked_at < $1', [before]);
    return (old.rowCount ?? 0) + (gone.rowCount ?? 0) + (locks.rowCount ?? 0);
  },
};
