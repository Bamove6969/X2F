import { createHmac } from 'node:crypto';
import { MANUAL_MASK, anonymizeText, applyManualMasks, offsetLabel, type AnonymizeNames, type Scrubbed } from '@x2f/staff';
import type { FastifyInstance } from 'fastify';
import { withTx } from '../auth/hold.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { appendLog } from '../log/append.js';
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
 * - Lead call 18 Nov 2026 (re-review), review-first: a closed case is listed only once a curator
 *   (`training.curate`, the owner) has reviewed it pre-masked (`/staff/v1/training/review/:id`),
 *   added manual masks (ranges of a field's pre-masked text, or whole fields) and marked it
 *   ("Mark as training case", PUT). Only the curation record is stored (`training_cases`: the
 *   dispute's key, the stored training id, the manual masks, who and when), never a scrubbed copy;
 *   each read masks the dispute's own texts again, automatic masks then manual ones. A manual
 *   range is kept with an HMAC tag of the text it covered, never the text, and every reviewed field
 *   with a tag of its whole pre-masked text (re-review 3 B1): when anything the curator saw changes
 *   (an anonymizer change, an edited text, a field added or gone), a tag no longer matches and the
 *   case is hidden until it is curated again (fail closed). A save echoes the `reviewTag` the
 *   curator's GET gave; a case that changed in between is refused (409 `case-changed`, m1). Marking and unmarking are logged
 *   (`staff.training-marked`, `staff.training-unmarked`: owner-only kinds, no trade code).
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

/** The tag kept with a manual range: HMAC of the field and the pre-masked text it covers (never the text itself). */
function maskTag(key: Uint8Array, field: string, text: string): string {
  return createHmac('sha256', key).update(`x2f/training-mask\0${field}\0${text}`, 'utf8').digest('hex').slice(0, 32);
}

/**
 * Re-review 3 B1: one tag per reviewed field over its whole pre-masked text, so any change the
 * curator did not see (outside a range, in a field without a manual mask, a field added or gone)
 * hides the case.
 */
function fieldTags(key: Uint8Array, auto: ReadonlyMap<string, Scrubbed>): Record<string, string> {
  // Its own label (re-review 4 minor 3), never a field-name convention.
  const tag = (field: string, text: string) => createHmac('sha256', key).update(`x2f/training-field\0${field}\0${text}`, 'utf8').digest('hex').slice(0, 32);
  return Object.fromEntries([...auto].map(([field, s]) => [field, tag(field, s.text)]));
}

/**
 * Re-review 3 m1: the tag of everything a curator reviews (every field's pre-masked text), echoed by
 * the save; bound to the case by its training id (re-review 4 minor 2), so one case's tag never
 * passes on another with the same texts.
 */
function reviewTag(key: Uint8Array, id: string, auto: ReadonlyMap<string, Scrubbed>): string {
  const all = JSON.stringify([...auto].map(([field, s]) => [field, s.text]).sort((a, b) => (a[0]! < b[0]! ? -1 : 1)));
  return createHmac('sha256', key).update(`x2f/training-review\0${id}\0${all}`, 'utf8').digest('hex');
}
const REVIEW_TAG = /^[0-9a-f]{64}$/;

/** A stored manual mask: a whole field, or a range of the field's pre-masked text with its tag. */
type StoredMask = { field: string; whole: true } | { field: string; start: number; end: number; tag: string };

/** The most manual masks one case may hold. */
const MAX_MASKS = 200;

/**
 * A closed dispute a curator names by its opaque id: from its curation row, else from every closed
 * dispute. TODO(re-review m3): the scan is for curators only (the owner, by role); readers always
 * go through the stored id. A stored id column on `disputes` would end it.
 */
async function findForCurator(db: Queryable, key: Uint8Array, id: string): Promise<{ code: string; seq: number } | null> {
  const marked = await db.query<{ code: string; seq: number }>('select code, seq from training_cases where training_id = $1', [id]);
  if (marked.rows[0]) return marked.rows[0];
  const { rows } = await db.query<{ code: string; seq: number }>(`select code, seq from disputes where status = 'closed'`);
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
  /** From the curation row, when the case is marked. */
  training_id: string | null;
  manual_masks: StoredMask[] | null;
  field_tags: Record<string, string> | null;
}

const CASE_COLUMNS = `d.code, d.seq, d.closed_at, d.opened_at, d.opened_by, d.reason, d.note, d.after_refund, d.overturned,
         t.method_id, t.amount_atomic::text as amount_atomic, t.buyer_account_id::text as buyer, t.seller_account_id::text as seller,
         (select r.outcome from dispute_rulings r where r.code = d.code and r.seq = d.seq order by r.round desc limit 1) as outcome,
         tc.training_id, tc.manual_masks, tc.field_tags`;
/** The marked cases only (readers). */
const MARKED_SELECT = `select ${CASE_COLUMNS}
    from training_cases tc join disputes d on d.code = tc.code and d.seq = tc.seq join trades t on t.code = d.code
   where d.status = 'closed'`;
/** Every closed case, marked or not (curators). */
const CLOSED_SELECT = `select ${CASE_COLUMNS}
    from disputes d join trades t on t.code = d.code left join training_cases tc on tc.code = d.code and tc.seq = d.seq
   where d.status = 'closed'`;

const listItem = (r: CaseRow, key: Uint8Array) => ({
  id: r.training_id ?? trainingId(key, r.code, r.seq),
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

interface CaseTexts {
  rulings: Array<{ round: number; outcome: string; reason: string; evidence: unknown; moderator_name: string; ruled_at: Date }>;
  appeal: { by: string; why: string; at: Date } | null;
  log: Array<{ at: Date; actor_kind: string; actor_role: string | null; action: string }>;
  /** Each field's pre-masked text (automatic masks only), by field key, in reading order. */
  auto: Map<string, Scrubbed>;
}

/** Reads a case's texts and pre-masks every field: `note`, `ruling.<round>.reason`, `ruling.<round>.evidence.<i>`, `appeal`. */
async function caseTexts(db: Queryable, r: CaseRow): Promise<CaseTexts> {
  const rulings = await db.query<CaseTexts['rulings'][number]>(
    'select round, outcome, reason, evidence, moderator_name, ruled_at from dispute_rulings where code = $1 and seq = $2 order by round',
    [r.code, r.seq],
  );
  const appeal = await db.query<{ by: string; why: string; at: Date }>('select a.by, a.why, a.at from dispute_appeals a where a.code = $1 and a.seq = $2', [r.code, r.seq]);
  const names = await caseNames(db, r, rulings.rows.map((x) => x.moderator_name));
  const scrub = (t: string): Scrubbed => anonymizeText(t, names, [r.code]);
  // The case's own log entries from its opening to its closing (an earlier or later dispute on the same trade is not this case).
  const log = await db.query<CaseTexts['log'][number]>(
    `select at, actor_kind, actor_role, action from activity_log where trade_code = $1 and at >= $2 and at <= $3 order by id`,
    [r.code, r.opened_at, r.closed_at],
  );
  const auto = new Map<string, Scrubbed>();
  if (r.note !== '') auto.set('note', scrub(r.note));
  for (const x of rulings.rows) {
    auto.set(`ruling.${x.round}.reason`, scrub(x.reason));
    evidenceOf(x.evidence).forEach((e, i) => auto.set(`ruling.${x.round}.evidence.${i}`, scrub(e)));
  }
  if (appeal.rows[0]) auto.set('appeal', scrub(appeal.rows[0].why));
  return { rulings: rulings.rows, appeal: appeal.rows[0] ?? null, log: log.rows, auto };
}

const evidenceOf = (v: unknown): string[] => (Array.isArray(v) ? v : []).filter((e): e is string => typeof e === 'string');

/**
 * Every field with the manual masks over the automatic ones, or null when a stored mask no longer
 * fits (its field is gone, its range is out of the text, or its tag does not match): fail closed.
 */
function curated(key: Uint8Array, auto: ReadonlyMap<string, Scrubbed>, stored: readonly StoredMask[], tags: Readonly<Record<string, string>> | null): Map<string, Scrubbed> | null {
  // Re-review 3 B1: exactly the fields reviewed, each with the pre-masked text the curator saw.
  if (tags === null) return null;
  const now = fieldTags(key, auto);
  const keys = Object.keys(tags);
  if (keys.length !== auto.size || keys.some((f) => now[f] !== tags[f])) return null;
  const out = new Map(auto);
  for (const [field, s] of auto) {
    const mine = stored.filter((m) => m.field === field);
    if (mine.some((m) => 'whole' in m)) {
      out.set(field, { text: MANUAL_MASK, masks: [{ start: 0, end: MANUAL_MASK.length, kind: 'manual' }] });
      continue;
    }
    const ranges = mine as Array<Extract<StoredMask, { tag: string }>>;
    if (ranges.length === 0) continue;
    for (const m of ranges) {
      if (!(Number.isInteger(m.start) && Number.isInteger(m.end) && m.start >= 0 && m.end <= s.text.length && m.start < m.end)) return null;
      if (maskTag(key, field, s.text.slice(m.start, m.end)) !== m.tag) return null;
    }
    try {
      out.set(field, applyManualMasks(s, ranges));
    } catch {
      return null;
    }
  }
  if (stored.some((m) => !auto.has(m.field))) return null;
  return out;
}

/** A curation request's masks, checked against the case's pre-masked fields (400 when they do not fit). */
function parseMasks(key: Uint8Array, body: unknown, auto: ReadonlyMap<string, Scrubbed>): StoredMask[] {
  const bad = () => new ApiError(400, 'bad-request');
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw bad();
  const b = body as Record<string, unknown>;
  if (Object.keys(b).some((k) => k !== 'masks' && k !== 'reviewTag') || !Array.isArray(b.masks) || b.masks.length > MAX_MASKS) throw bad();
  if (typeof b.reviewTag !== 'string' || !REVIEW_TAG.test(b.reviewTag)) throw bad();
  const out: StoredMask[] = [];
  const ranges = new Map<string, Array<{ start: number; end: number }>>();
  for (const raw of b.masks as unknown[]) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw bad();
    const m = raw as Record<string, unknown>;
    const keys = Object.keys(m).sort().join(',');
    if (typeof m.field !== 'string' || !Object.hasOwn(Object.fromEntries(auto), m.field)) throw bad();
    if (keys === 'field,whole') {
      if (m.whole !== true) throw bad();
      out.push({ field: m.field, whole: true });
    } else if (keys === 'end,field,start') {
      if (!Number.isInteger(m.start) || !Number.isInteger(m.end)) throw bad();
      const list = ranges.get(m.field) ?? [];
      list.push({ start: m.start as number, end: m.end as number });
      ranges.set(m.field, list);
    } else throw bad();
  }
  for (const [field, list] of ranges) {
    const s = auto.get(field)!;
    try {
      applyManualMasks(s, list);
    } catch {
      throw bad();
    }
    for (const r of list) out.push({ field, start: r.start, end: r.end, tag: maskTag(key, field, s.text.slice(r.start, r.end)) });
  }
  return out;
}

/** The case as a reader sees it: every text from `fields` (already masked), times as offsets. */
function caseView(r: CaseRow, key: Uint8Array, t: CaseTexts, fields: ReadonlyMap<string, Scrubbed>) {
  return {
    ...listItem(r, key),
    tradeCode: 'XXXX-XXXX-XXXX-XXXX',
    openedBy: r.opened_by,
    reason: r.reason,
    note: fields.get('note') ?? null,
    closedAt: offsetLabel(r.closed_at, r.opened_at),
    rulings: t.rulings.map((x) => ({
      round: x.round,
      outcome: x.outcome,
      at: offsetLabel(x.ruled_at, r.opened_at),
      reason: fields.get(`ruling.${x.round}.reason`)!,
      evidence: evidenceOf(x.evidence).map((_, i) => fields.get(`ruling.${x.round}.evidence.${i}`)!),
    })),
    appeal: t.appeal ? { by: t.appeal.by, at: offsetLabel(t.appeal.at, r.opened_at), why: fields.get('appeal')! } : null,
    timeline: t.log.map((e) => ({
      at: offsetLabel(e.at, r.opened_at),
      who: e.actor_kind === 'system' ? 'System' : (ROLE_LABEL[e.actor_role ?? ''] ?? 'Staff'),
      action: e.action,
    })),
    chat: 'not-available' as const,
  };
}

/** A marked case as readers see it, or null when its curation no longer fits (hidden until curated again). */
async function readable(db: Queryable, key: Uint8Array, r: CaseRow): Promise<ReturnType<typeof caseView> | null> {
  const t = await caseTexts(db, r);
  const fields = curated(key, t.auto, r.manual_masks ?? [], r.field_tags);
  return fields === null ? null : caseView(r, key, t, fields);
}

/** The most closed cases the curator's list shows. TODO(re-review m3): page it. */
const REVIEW_LIST_MAX = 200;

export function staffTrainingRoutes(app: FastifyInstance): void {
  const guard = requireStaff('training.read');
  const cfg = { perm: 'training.read' as const };
  const curate = requireStaff('training.curate');
  const curateCfg = { perm: 'training.curate' as const };

  app.get('/staff/v1/training', { preHandler: guard, config: cfg }, async (req) => {
    const q = (req.query ?? {}) as Record<string, unknown>;
    if (Object.keys(q).some((k) => k !== 'before')) throw new ApiError(400, 'bad-request');
    const before = q.before;
    if (before !== undefined && (typeof before !== 'string' || !TRAINING_ID.test(before))) throw new ApiError(400, 'bad-request');
    const { db, config } = req.server.deps;
    const args: unknown[] = [TRAINING_PAGE + 1];
    let after = '';
    if (typeof before === 'string') {
      const cur = await db.query<{ closed_at: Date; code: string; seq: number }>(
        `select d.closed_at, d.code, d.seq from training_cases tc join disputes d on d.code = tc.code and d.seq = tc.seq where tc.training_id = $1`,
        [before],
      );
      if (!cur.rows[0]) throw new ApiError(404, 'not-found');
      args.push(cur.rows[0].closed_at, cur.rows[0].code, cur.rows[0].seq);
      after = ` and (d.closed_at, d.code, d.seq) < ($2, $3, $4)`;
    }
    const { rows } = await db.query<CaseRow>(`${MARKED_SELECT}${after} order by d.closed_at desc, d.code desc, d.seq desc limit $1`, args);
    const page = rows.slice(0, TRAINING_PAGE);
    // A case whose curation no longer fits is left out until it is curated again.
    const items: Array<ReturnType<typeof listItem>> = [];
    for (const r of page) if ((await readable(db, config.trainingIdKey, r)) !== null) items.push(listItem(r, config.trainingIdKey));
    return { items, next: rows.length > TRAINING_PAGE ? listItem(page[page.length - 1]!, config.trainingIdKey).id : null };
  });

  app.get('/staff/v1/training/review', { preHandler: curate, config: curateCfg }, async (req) => {
    if (Object.keys((req.query ?? {}) as object).length > 0) throw new ApiError(400, 'bad-request');
    const { db, config } = req.server.deps;
    const { rows } = await db.query<CaseRow>(`${CLOSED_SELECT} order by d.closed_at desc, d.code desc, d.seq desc limit $1`, [REVIEW_LIST_MAX]);
    const items = [];
    for (const r of rows) {
      const status = r.training_id === null ? 'unmarked' : (await readable(db, config.trainingIdKey, r)) === null ? 'stale' : 'marked';
      items.push({ ...listItem(r, config.trainingIdKey), status });
    }
    return { items };
  });

  const curatorCase = async (req: { params: unknown; server: FastifyInstance }) => {
    const id = (req.params as { id?: unknown }).id;
    if (typeof id !== 'string' || !TRAINING_ID.test(id)) throw new ApiError(404, 'not-found');
    const { db, config } = req.server.deps;
    const found = await findForCurator(db, config.trainingIdKey, id);
    if (!found) throw new ApiError(404, 'not-found');
    const { rows } = await db.query<CaseRow>(`${CLOSED_SELECT} and d.code = $1 and d.seq = $2`, [found.code, found.seq]);
    if (!rows[0]) throw new ApiError(404, 'not-found');
    return { r: rows[0], id, db, key: config.trainingIdKey };
  };

  app.get('/staff/v1/training/review/:id', { preHandler: curate, config: curateCfg }, async (req) => {
    const { r, id, db, key } = await curatorCase(req);
    const t = await caseTexts(db, r);
    const stored = r.manual_masks ?? [];
    const status = r.training_id === null ? 'unmarked' : curated(key, t.auto, stored, r.field_tags) === null ? 'stale' : 'marked';
    return {
      ...caseView(r, key, t, t.auto),
      status,
      // Re-review 3 m1: the save sends this back; a case that changed since is refused (409).
      reviewTag: reviewTag(key, id, t.auto),
      // Every field pre-masked (automatic masks only), for the curator to add manual masks over.
      fields: Object.fromEntries(t.auto),
      // The stored manual masks, without their tags.
      manual: stored.map((m) => ('whole' in m ? { field: m.field, whole: true as const } : { field: m.field, start: m.start, end: m.end })),
    };
  });

  app.put('/staff/v1/training/review/:id', { preHandler: curate, config: curateCfg }, async (req) => {
    const { r, id, db, key } = await curatorCase(req);
    const t = await caseTexts(db, r);
    const masks = parseMasks(key, req.body, t.auto);
    // Re-review 3 m1: the masks apply to the texts the curator reviewed, or not at all.
    if ((req.body as { reviewTag: string }).reviewTag !== reviewTag(key, id, t.auto)) throw new ApiError(409, 'case-changed');
    const now = req.server.deps.clock();
    await withTx(req.server.deps.db, async (c) => {
      await c.query(
        `insert into training_cases (code, seq, training_id, manual_masks, field_tags, marked_by, marked_at) values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (code, seq) do update set manual_masks = excluded.manual_masks, field_tags = excluded.field_tags, marked_by = excluded.marked_by, marked_at = excluded.marked_at`,
        [r.code, r.seq, id, JSON.stringify(masks), JSON.stringify(fieldTags(key, t.auto)), req.staff.accountId, now],
      );
      // No trade code: the curator is not involved in the case (R37), and the entry is owner-only.
      await appendLog(c, { at: now, actor: { kind: 'staff', id: req.staff.accountId, role: req.staff.role }, tradeCode: null, action: 'staff.training-marked', detail: { trainingId: id, masks: masks.length } });
    });
    return { id, status: 'marked' as const };
  });

  app.delete('/staff/v1/training/review/:id', { preHandler: curate, config: curateCfg }, async (req) => {
    const id = (req.params as { id?: unknown }).id;
    if (typeof id !== 'string' || !TRAINING_ID.test(id)) throw new ApiError(404, 'not-found');
    const now = req.server.deps.clock();
    await withTx(req.server.deps.db, async (c) => {
      const { rowCount } = await c.query('delete from training_cases where training_id = $1', [id]);
      if (rowCount === 0) throw new ApiError(404, 'not-found');
      await appendLog(c, { at: now, actor: { kind: 'staff', id: req.staff.accountId, role: req.staff.role }, tradeCode: null, action: 'staff.training-unmarked', detail: { trainingId: id } });
    });
    return { id, status: 'unmarked' as const };
  });

  app.get('/staff/v1/training/:id', { preHandler: guard, config: cfg }, async (req) => {
    const id = (req.params as { id?: unknown }).id;
    if (typeof id !== 'string' || !TRAINING_ID.test(id)) throw new ApiError(404, 'not-found');
    const { db, config } = req.server.deps;
    // The stored id (re-review m3): one indexed lookup, never every closed dispute.
    const { rows } = await db.query<CaseRow>(`${MARKED_SELECT} and tc.training_id = $1`, [id]);
    const r = rows[0];
    if (!r) throw new ApiError(404, 'not-found');
    const view = await readable(db, config.trainingIdKey, r);
    if (view === null) throw new ApiError(404, 'not-found');
    return view;
  });
}
