import { createHmac } from 'node:crypto';
import { anonymizeText, offsetLabel, type AnonymizeNames, type Scrubbed } from '@x2f/staff';
import type { FastifyInstance } from 'fastify';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { getMethod } from '../methods/profiles.js';
import { requireStaff } from './guard.js';

/**
 * Plan 4 Task 19, as Revision 2026-10-29b changed it (design reports the owner's answer): the
 * training library is the closed dispute records themselves, read through the anonymizer
 * (`@x2f/staff` `anonymizeText`); no separate copy is made or stored, so a case leaves the library
 * when the purge deletes its dispute (Task 23, 90 days from closing). Perm `training.read`.
 * NEEDS_P4_TASK23 (review m6): no job deletes `disputes` rows yet (trades/purge.ts only nulls payout
 * addresses), so until Task 23 lands every closed case stays in the library; the page does not
 * promise the 90 days.
 *
 * - A case is named by an opaque id (`trainingId`: HMAC-SHA-256 under the server's own
 *   `X2F_TRAINING_ID_KEY` of the trade code and the dispute's seq, review m1), never by its trade
 *   code or incident id, so a list of trade codes does not give their training ids. The list shows
 *   the closing month only (never the day), the method, the amount rounded to 2 significant figures
 *   (`roundXmrAtomic`: 1.25 XMR shows as 1.3, 0.0123 as 0.012), and the outcome, so a case is not
 *   matched to an open dispute seen earlier by its exact amount and day.
 * - A case shows the dispute's reason code, and the opener's note, every round's ruling reason and
 *   evidence lines, and the appeal's text, each scrubbed: the two traders' display and login names
 *   become "Buyer" and "Seller", every staff name "Moderator", trade codes `XXXX-XXXX-XXXX-XXXX`,
 *   and addresses, bank accounts, cards, emails, phone numbers and tx ids are masked. Times are
 *   offsets from the dispute's opening ("T+0:42"); the timeline is the log's actions with who acted
 *   by role, never an id, a name or an entry's detail.
 * - NEEDS_P4_CHAT_MEMBERSHIP: the chat is not here. This API cannot read a chat (no route relays
 *   one, docs/security/threats-staff.md); under the key-membership design the staff browser
 *   decrypts and scrubs it with the same anonymizer (design Q12). `chat` is `not-available` until then.
 * - Reading a training case is not logged: a closed case cannot be appealed, and a log entry on it
 *   would mark the reader as involved in it (R37).
 * OWNER-Q (Task 19 report): whether the owner hand-picks cases ("Mark as training case") and reviews
 * the masks first, as the plan had for stored copies; today every closed case is listed.
 */

export const TRAINING_PAGE = 50;
const TRAINING_ID = /^[0-9a-f]{32}$/;

/** The opaque id: HMAC-SHA-256 under the training id key of `x2f/training-id\0<code>\0<seq>`, first 128 bits. */
export function trainingId(key: Uint8Array, code: string, seq: number): string {
  return createHmac('sha256', key).update(`x2f/training-id\0${code}\0${seq}`, 'utf8').digest('hex').slice(0, 32);
}

/** An atomic XMR amount rounded to 2 significant figures, half up (review m1: the list never shows the exact amount). */
export function roundXmrAtomic(atomic: string): string {
  const v = BigInt(atomic);
  const digits = v.toString().length;
  if (digits <= 2) return v.toString();
  const unit = 10n ** BigInt(digits - 2);
  return (((v + unit / 2n) / unit) * unit).toString();
}

/**
 * The closed dispute an opaque id names, or null. The id is keyed, so SQL cannot compute it: every
 * closed dispute's id is computed here. TODO(review m7): fine at today's volume; a stored random id
 * column (or a cached map) once the library grows.
 */
async function findCase(db: Queryable, key: Uint8Array, id: string): Promise<{ code: string; seq: number; closed_at: Date } | null> {
  const { rows } = await db.query<{ code: string; seq: number; closed_at: Date }>(`select code, seq, closed_at from disputes where status = 'closed'`);
  return rows.find((r) => trainingId(key, r.code, r.seq) === id) ?? null;
}

const methodName = (id: string): string => getMethod(id)?.name ?? id;

interface CaseRow {
  code: string;
  seq: number;
  closed_at: Date;
  opened_at: Date;
  opened_by: string;
  reason: string;
  note: string;
  after_refund: boolean;
  overturned: boolean | null;
  method_id: string;
  amount_atomic: string;
  buyer: string | null;
  seller: string | null;
  outcome: string | null;
}

const CASE_SELECT = `select d.code, d.seq, d.closed_at, d.opened_at, d.opened_by, d.reason, d.note, d.after_refund, d.overturned,
         t.method_id, t.amount_atomic::text as amount_atomic, t.buyer_account_id::text as buyer, t.seller_account_id::text as seller,
         (select r.outcome from dispute_rulings r where r.code = d.code and r.seq = d.seq order by r.round desc limit 1) as outcome
    from disputes d join trades t on t.code = d.code
   where d.status = 'closed'`;

const listItem = (r: CaseRow, key: Uint8Array) => ({
  id: trainingId(key, r.code, r.seq),
  closedMonth: r.closed_at.toISOString().slice(0, 7),
  method: r.method_id,
  methodName: methodName(r.method_id),
  xmr: roundXmrAtomic(r.amount_atomic),
  outcome: r.outcome,
  overturned: r.overturned === true,
  afterRefund: r.after_refund,
});

/** Every name the case's texts may hold: both traders' display and login names, and every staff name. */
async function caseNames(db: Queryable, r: CaseRow, moderatorNames: readonly string[]): Promise<AnonymizeNames> {
  const { rows } = await db.query<{ id: string; display_name: string; login_name: string | null }>(
    'select id::text as id, display_name, login_name from accounts where id = any($1::uuid[])',
    [[r.buyer, r.seller].filter((x): x is string => x !== null)],
  );
  const of = (id: string | null) => rows.filter((a) => a.id === id).flatMap((a) => [a.display_name, a.login_name ?? '']).filter((n) => n !== '');
  const staff = await db.query<{ display_name: string; login_name: string | null }>(
    'select a.display_name, a.login_name from staff_members m join accounts a on a.id = m.account_id',
  );
  return {
    buyer: of(r.buyer),
    seller: of(r.seller),
    staff: [...staff.rows.flatMap((a) => [a.display_name, a.login_name ?? '']), ...moderatorNames].filter((n) => n !== ''),
  };
}

const ROLE_LABEL: Readonly<Record<string, string>> = { buyer: 'Buyer', seller: 'Seller', mod: 'Moderator', senior: 'Senior moderator', owner: 'Owner', helper: 'Helper' };

export function staffTrainingRoutes(app: FastifyInstance): void {
  const guard = requireStaff('training.read');
  const cfg = { perm: 'training.read' as const };

  app.get('/staff/v1/training', { preHandler: guard, config: cfg }, async (req) => {
    const q = (req.query ?? {}) as Record<string, unknown>;
    if (Object.keys(q).some((k) => k !== 'before')) throw new ApiError(400, 'bad-request');
    const before = q.before;
    if (before !== undefined && (typeof before !== 'string' || !TRAINING_ID.test(before))) throw new ApiError(400, 'bad-request');
    const { db, config } = req.server.deps;
    const args: unknown[] = [TRAINING_PAGE + 1];
    let after = '';
    if (typeof before === 'string') {
      const cur = await findCase(db, config.trainingIdKey, before);
      if (!cur) throw new ApiError(404, 'not-found');
      args.push(cur.closed_at, cur.code, cur.seq);
      after = ` and (d.closed_at, d.code, d.seq) < ($2, $3, $4)`;
    }
    const { rows } = await db.query<CaseRow>(`${CASE_SELECT}${after} order by d.closed_at desc, d.code desc, d.seq desc limit $1`, args);
    const page = rows.slice(0, TRAINING_PAGE).map((r) => listItem(r, config.trainingIdKey));
    return { items: page, next: rows.length > TRAINING_PAGE ? page[page.length - 1]!.id : null };
  });

  app.get('/staff/v1/training/:id', { preHandler: guard, config: cfg }, async (req) => {
    const id = (req.params as { id?: unknown }).id;
    if (typeof id !== 'string' || !TRAINING_ID.test(id)) throw new ApiError(404, 'not-found');
    const { db, config } = req.server.deps;
    const found = await findCase(db, config.trainingIdKey, id);
    if (!found) throw new ApiError(404, 'not-found');
    const { rows } = await db.query<CaseRow>(`${CASE_SELECT} and d.code = $1 and d.seq = $2`, [found.code, found.seq]);
    const r = rows[0];
    if (!r) throw new ApiError(404, 'not-found');
    const rulings = await db.query<{ round: number; outcome: string; reason: string; evidence: unknown; moderator_name: string; ruled_at: Date }>(
      'select round, outcome, reason, evidence, moderator_name, ruled_at from dispute_rulings where code = $1 and seq = $2 order by round',
      [r.code, r.seq],
    );
    const appeal = await db.query<{ by: string; why: string; at: Date }>('select a.by, a.why, a.at from dispute_appeals a where a.code = $1 and a.seq = $2', [r.code, r.seq]);
    const names = await caseNames(db, r, rulings.rows.map((x) => x.moderator_name));
    const scrub = (t: string): Scrubbed => anonymizeText(t, names, [r.code]);
    // The case's own log entries from its opening to its closing (an earlier or later dispute on the same trade is not this case).
    const log = await db.query<{ at: Date; actor_kind: string; actor_role: string | null; action: string }>(
      `select at, actor_kind, actor_role, action from activity_log where trade_code = $1 and at >= $2 and at <= $3 order by id`,
      [r.code, r.opened_at, r.closed_at],
    );
    return {
      ...listItem(r, config.trainingIdKey),
      tradeCode: 'XXXX-XXXX-XXXX-XXXX',
      openedBy: r.opened_by,
      reason: r.reason,
      note: r.note === '' ? null : scrub(r.note),
      closedAt: offsetLabel(r.closed_at, r.opened_at),
      rulings: rulings.rows.map((x) => ({
        round: x.round,
        outcome: x.outcome,
        at: offsetLabel(x.ruled_at, r.opened_at),
        reason: scrub(x.reason),
        evidence: (Array.isArray(x.evidence) ? x.evidence : []).filter((e): e is string => typeof e === 'string').map(scrub),
      })),
      appeal: appeal.rows[0] ? { by: appeal.rows[0].by, at: offsetLabel(appeal.rows[0].at, r.opened_at), why: scrub(appeal.rows[0].why) } : null,
      timeline: log.rows.map((e) => ({
        at: offsetLabel(e.at, r.opened_at),
        who: e.actor_kind === 'system' ? 'System' : (ROLE_LABEL[e.actor_role ?? ''] ?? 'Staff'),
        action: e.action,
      })),
      chat: 'not-available' as const,
    };
  });
}
