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
 *
 * - A case is named by an opaque id (`trainingId`, a hash of the dispute's own identity), never by
 *   its trade code or incident id; the list shows the closing day, method, amount and outcome.
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
/** The opaque id: SHA-256 of a fixed label, the trade code and the dispute's seq, first 128 bits. */
const ID_SQL = `substr(encode(sha256(convert_to('x2f-training-v1|' || d.code || '|' || d.seq::text, 'UTF8')), 'hex'), 1, 32)`;

const methodName = (id: string): string => getMethod(id)?.name ?? id;

interface CaseRow {
  id: string;
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

const CASE_SELECT = `select ${ID_SQL} as id, d.code, d.seq, d.closed_at, d.opened_at, d.opened_by, d.reason, d.note, d.after_refund, d.overturned,
         t.method_id, t.amount_atomic::text as amount_atomic, t.buyer_account_id::text as buyer, t.seller_account_id::text as seller,
         (select r.outcome from dispute_rulings r where r.code = d.code and r.seq = d.seq order by r.round desc limit 1) as outcome
    from disputes d join trades t on t.code = d.code
   where d.status = 'closed'`;

const listItem = (r: CaseRow) => ({
  id: r.id,
  closedOn: r.closed_at.toISOString().slice(0, 10),
  method: r.method_id,
  methodName: methodName(r.method_id),
  xmr: r.amount_atomic,
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
    const db = req.server.deps.db;
    const args: unknown[] = [TRAINING_PAGE + 1];
    let after = '';
    if (typeof before === 'string') {
      const cur = await db.query<{ closed_at: Date }>(`select d.closed_at from disputes d where d.status = 'closed' and ${ID_SQL} = $1`, [before]);
      if (!cur.rows[0]) throw new ApiError(404, 'not-found');
      args.push(cur.rows[0].closed_at, before);
      after = ` and (d.closed_at, ${ID_SQL}) < ($2, $3)`;
    }
    const { rows } = await db.query<CaseRow>(`${CASE_SELECT}${after} order by d.closed_at desc, ${ID_SQL} desc limit $1`, args);
    const page = rows.slice(0, TRAINING_PAGE);
    return { items: page.map(listItem), next: rows.length > TRAINING_PAGE ? page[page.length - 1]!.id : null };
  });

  app.get('/staff/v1/training/:id', { preHandler: guard, config: cfg }, async (req) => {
    const id = (req.params as { id?: unknown }).id;
    if (typeof id !== 'string' || !TRAINING_ID.test(id)) throw new ApiError(404, 'not-found');
    const db = req.server.deps.db;
    const { rows } = await db.query<CaseRow>(`${CASE_SELECT} and ${ID_SQL} = $1`, [id]);
    const r = rows[0];
    if (!r) throw new ApiError(404, 'not-found');
    const rulings = await db.query<{ round: number; outcome: string; reason: string; evidence: unknown; moderator_name: string; ruled_at: Date }>(
      'select round, outcome, reason, evidence, moderator_name, ruled_at from dispute_rulings where code = $1 and seq = $2 order by round',
      [r.code, r.seq],
    );
    const appeal = await db.query<{ by: string; why: string; at: Date }>('select by, why, at from dispute_appeals where code = $1 and seq = $2', [r.code, r.seq]);
    const names = await caseNames(db, r, rulings.rows.map((x) => x.moderator_name));
    const scrub = (t: string): Scrubbed => anonymizeText(t, names, [r.code]);
    // The case's own log entries from its opening to its closing (an earlier or later dispute on the same trade is not this case).
    const log = await db.query<{ at: Date; actor_kind: string; actor_role: string | null; action: string }>(
      `select at, actor_kind, actor_role, action from activity_log where trade_code = $1 and at >= $2 and at <= $3 order by id`,
      [r.code, r.opened_at, r.closed_at],
    );
    return {
      ...listItem(r),
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
