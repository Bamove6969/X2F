/**
 * Notes on traders (Job 1c, J-10; owner S-094, p7-8): an account's private notes about other
 * traders, signed with who wrote them (the lead, or a member's name) and when.
 *
 * - `GET /v1/account/notes/:displayName` → the account's notes about that trader, newest first:
 *   `{ id, text, by, byLead, at }[]` (`by` is the member's name, null for the lead). The account
 *   owner, or a member with "View notes on traders" (`notes-view`).
 * - `POST /v1/account/notes { about, text }` → 201 the note. The account owner, or a member with
 *   "Add notes on traders" (`notes-add`); a member's note is in the team log (`note-added`, the
 *   note's id and the trader's name, never the text).
 * - `DELETE /v1/account/notes/:id` → 204. The account owner only: no member deletes a note (owner
 *   p7-8), whatever their boxes (403 `owner-only`).
 *
 * The trader is named by public display name (as blocks do); an unknown name, a non-trader and
 * the account itself are 404 / 400. A note's text is 1 to `NOTE_MAX` characters with no control
 * characters, and never edited (migration 361).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireLiveSessionInTx } from '../auth/hold.js';
import { requireSession } from '../auth/sessions.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { findByPublicName } from '../nudge/names.js';
import { auditMember } from './audit.js';

/** Engineering default (lead may change): a note's longest text. */
export const NOTE_MAX = 1000;
const NAME_MAX = 64;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TraderNote {
  id: string;
  text: string;
  /** The member who wrote it, or null for the lead. */
  by: string | null;
  byLead: boolean;
  at: string;
}

async function traderNamed(q: Queryable, raw: unknown, self: string): Promise<{ id: string; name: string }> {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > NAME_MAX) throw new ApiError(400, 'bad-request');
  const who = await findByPublicName(q, raw);
  if (who === null) throw new ApiError(404, 'not-found');
  const { rows } = await q.query<{ kind: string }>('select kind from accounts where id = $1', [who.id]);
  if (rows[0]?.kind !== 'trader') throw new ApiError(404, 'not-found');
  if (who.id === self) throw new ApiError(400, 'bad-request');
  return { id: who.id, name: who.name };
}

function noteText(raw: unknown): string {
  if (typeof raw !== 'string') throw new ApiError(400, 'bad-request');
  const text = raw.trim();
  if (text.length === 0 || Array.from(text).length > NOTE_MAX || /[\p{Cc}\p{Cf}]/u.test(text.replace(/\n/g, ''))) throw new ApiError(400, 'bad-request');
  return text;
}

async function inTransaction<T>(req: FastifyRequest, fn: (c: Queryable) => Promise<T>): Promise<T> {
  const client = await req.server.deps.db.connect();
  try {
    await client.query('begin');
    try {
      const out = await fn(client);
      await client.query('commit');
      return out;
    } catch (e) {
      await client.query('rollback');
      throw e;
    }
  } finally {
    client.release();
  }
}

export function noteRoutes(app: FastifyInstance): void {
  const viewNotes = requireSession({ kinds: ['trader'], member: 'notes-view' });
  const addNotes = requireSession({ kinds: ['trader'], member: 'notes-add' });
  const owner = requireSession({ kinds: ['trader'] });

  app.get('/v1/account/notes/:displayName', { preHandler: viewNotes }, async (req): Promise<TraderNote[]> => {
    const db = req.server.deps.db;
    const about = await traderNamed(db, (req.params as { displayName?: unknown }).displayName, req.auth.accountId);
    const { rows } = await db.query<{ id: string; text: string; display_name: string | null; member_id: string | null; created_at: Date }>(
      `select n.id, n.text, m.display_name, n.member_id, n.created_at from trader_notes n left join team_members m on m.id = n.member_id
        where n.account_id = $1 and n.about_account_id = $2 order by n.created_at desc, n.seq desc limit 200`,
      [req.auth.accountId, about.id],
    );
    return rows.map((r) => ({ id: r.id, text: r.text, by: r.display_name, byLead: r.member_id === null, at: r.created_at.toISOString() }));
  });

  app.post('/v1/account/notes', { preHandler: addNotes }, async (req, reply) => {
    const b = req.body;
    if (b === null || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).sort().join(',') !== 'about,text') throw new ApiError(400, 'bad-request');
    const { about: rawAbout, text: rawText } = b as { about: unknown; text: unknown };
    const text = noteText(rawText);
    const deps = req.server.deps;
    const about = await traderNamed(deps.db, rawAbout, req.auth.accountId);
    const now = deps.clock();
    const note = await inTransaction(req, async (c) => {
      await requireLiveSessionInTx(c, req.auth, now);
      const { rows } = await c.query<{ id: string }>(
        'insert into trader_notes (account_id, about_account_id, member_id, text, created_at) values ($1, $2, $3, $4, $5) returning id',
        [req.auth.accountId, about.id, req.auth.memberId, text, now],
      );
      const id = rows[0]!.id;
      // A member's note is in the lead's team log: who and when, the trader, never the text.
      await auditMember(c, req.auth, { action: 'note-added', detail: { noteId: id, about: about.name } }, now);
      return id;
    });
    const out: TraderNote = { id: note, text, by: req.auth.memberName, byLead: req.auth.memberId === null, at: now.toISOString() };
    return reply.code(201).send(out);
  });

  app.delete('/v1/account/notes/:id', { preHandler: owner }, async (req, reply) => {
    const id = (req.params as { id?: unknown }).id;
    if (typeof id !== 'string' || !UUID.test(id)) throw new ApiError(404, 'not-found');
    const r = await req.server.deps.db.query('delete from trader_notes where id = $1 and account_id = $2', [id, req.auth.accountId]);
    if ((r.rowCount ?? 0) === 0) throw new ApiError(404, 'not-found');
    return reply.code(204).send();
  });
}
