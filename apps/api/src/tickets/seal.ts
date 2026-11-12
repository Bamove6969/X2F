/**
 * J-14 review J6, sealing half (lead 10 Nov): ticket text at rest. Every `ticket_messages` row (a
 * support ticket's thread, staff replies, the "My account has been compromised" report's comment,
 * where the sender types any credentials) is stored only in `body_sealed`: sealed by the key store
 * every sealed secret uses (auth/keystore.ts) under the current `X2F_TICKET_KEYS` key, bound to
 * the message (`x2f/ticket-message/<ticket id>/<message id>`), as main's Jabber addresses are under
 * `X2F_JABBER_KEYS` (jabber/address.ts).
 *
 * The text is opened only per request by `readThread`, and `readThread` is called only by the reads
 * that return it: the staff reads that first write the `ticket.viewed` / `compromised.viewed` audit
 * row (tickets/staffRoutes.ts) and the trader reading their own ticket (tickets/traderRoutes.ts).
 * Lists return ids and metadata only. The text is never logged and never put in an error: a blob
 * that does not open (its key left the ring, it was moved, it was tampered with) fails the read
 * closed (500 `internal`, the key store's message names a key id at most).
 *
 * Rotation: `npm run rewrap-tickets -w @x2f/api` (`rewrapTicketSecrets`). There is no plaintext
 * column to seal from (migration 450 stores `body_sealed` only; review S2 folded 451 into it).
 */
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { keyringBox, type SecretBox } from '../auth/keystore.js';
import type { Config, Keyring } from '../config.js';
import type { Queryable } from '../db/pool.js';

const boxes = new WeakMap<Keyring, SecretBox>();
function box(ring: Keyring): SecretBox {
  let b = boxes.get(ring);
  if (!b) boxes.set(ring, (b = keyringBox(ring)));
  return b;
}

/** Bound to the ticket and the message, so a blob cannot be moved to another row. */
export const messageContext = (ticketId: string, messageId: string): string => `x2f/ticket-message/${ticketId}/${messageId}`;

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function sealBody(config: Pick<Config, 'ticketKeys'>, ticketId: string, messageId: string, text: string): Buffer {
  return box(config.ticketKeys).seal(encoder.encode(text), messageContext(ticketId, messageId));
}

/** Throws (never with the text) when the blob does not open: a removed key, another row's blob, tampering. */
export function openBody(config: Pick<Config, 'ticketKeys'>, ticketId: string, messageId: string, sealed: Buffer): string {
  return decoder.decode(box(config.ticketKeys).open(sealed, messageContext(ticketId, messageId)));
}

export interface NewMessage {
  ticketId: string;
  author: 'trader' | 'staff';
  memberId?: string | null;
  staffId?: string | null;
  body: string;
  at: Date;
}

/** Writes one message, sealed; its id is made here so the seal can be bound to it. */
export async function insertMessage(q: Queryable, config: Pick<Config, 'ticketKeys'>, m: NewMessage): Promise<void> {
  const id = randomUUID();
  await q.query(
    'insert into ticket_messages (id, ticket_id, author, member_id, staff_id, body_sealed, at) values ($1, $2, $3, $4, $5, $6, $7)',
    [id, m.ticketId, m.author, m.memberId ?? null, m.staffId ?? null, sealBody(config, m.ticketId, id, m.body), m.at],
  );
}

export interface ThreadMessage {
  author: 'trader' | 'staff';
  /** The team member who wrote a trader message (null: the account owner); never set for staff. */
  memberName: string | null;
  staffId: string | null;
  body: string;
  at: string;
}

/**
 * The ticket's thread, opened. Only for the reads that return the text (the audited staff reads,
 * the owner's own read); throws, failing the read closed, if any message does not open.
 */
export async function readThread(q: Queryable, config: Pick<Config, 'ticketKeys'>, ticketId: string): Promise<ThreadMessage[]> {
  const { rows } = await q.query<{ id: string; author: 'trader' | 'staff'; member_name: string | null; staff_id: string | null; body_sealed: Buffer; at: Date }>(
    `select m.id, m.author, tm.display_name as member_name, m.staff_id, m.body_sealed, m.at
       from ticket_messages m left join team_members tm on tm.id = m.member_id
      where m.ticket_id = $1 order by m.seq`,
    [ticketId],
  );
  return rows.map((r) => ({
    author: r.author,
    memberName: r.member_name,
    staffId: r.staff_id,
    body: openBody(config, ticketId, r.id, r.body_sealed),
    at: r.at.toISOString(),
  }));
}

/**
 * Reseals every message not yet under the current `X2F_TICKET_KEYS` key: run after putting a new
 * key first, and again, before removing the old one (only once a re-run reports
 * `{"rewrapped":0,"failed":0}` is no message left under it). Each row is written only if it still
 * holds the blob that was read. A blob that does not open is left as it is and counted in
 * `failed`. Returns counts only, never text.
 */
export async function rewrapTicketSecrets(deps: { db: pg.Pool; config: Pick<Config, 'ticketKeys'> }): Promise<{ rewrapped: number; failed: number }> {
  const b = box(deps.config.ticketKeys);
  const { rows } = await deps.db.query<{ id: string; ticket_id: string; body_sealed: Buffer }>(
    'select id, ticket_id, body_sealed from ticket_messages where body_sealed is not null',
  );
  let rewrapped = 0;
  let failed = 0;
  for (const row of rows) {
    if (b.isCurrent(row.body_sealed)) continue;
    const context = messageContext(row.ticket_id, row.id);
    let sealed: Buffer;
    try {
      sealed = b.seal(b.open(row.body_sealed, context), context);
    } catch {
      failed++;
      continue;
    }
    const r = await deps.db.query('update ticket_messages set body_sealed = $3 where id = $1 and body_sealed = $2', [row.id, row.body_sealed, sealed]);
    rewrapped += r.rowCount ?? 0;
  }
  return { rewrapped, failed };
}
