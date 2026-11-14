import { normalizeTradeCode } from '@x2f/core';
import { APPEAL_GOAL_H, DisputeRuleError, RULING_DEADLINE_H, appealReviewers, applyDispute, markSeen, normalizeIncidentId, type Actor, type Dispute } from '@x2f/staff';
import { CHAT_TEXT_MAX_BYTES, ChatEnvelopeError, channelFor, checkChatEnvelope } from '@x2f/trade';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { Queryable } from '../db/pool.js';
import { ApiError, type ApiErrorCode } from '../errors.js';
import type { EventBus, LiveEvent, PublishOptions } from '../events/bus.js';
import { PUBLIC_NAME_COLUMN } from '../events/publicName.js';
import { appendLog } from '../log/append.js';
import { requireStaff } from '../staff/guard.js';
import { traderSummaries } from '../traders/summary.js';
import { cancelFigures } from '../traders/tradedTotal.js';
import { ModerationError, type ModerationClient } from './moderationClient.js';
import { appealWaiting, eligibleReviewers, reviewerCandidates } from './appeals.js';
import { disputeSettings } from './settings.js';
import { loadDisputeRecord, withDispute, type DisputeRecord } from './store.js';

/**
 * Plan 4 Task 11: the moderator's queue and case view, messages to both traders, the
 * unblurred-proof request, and the freeze. Every route needs `disputes.handle`.
 *
 * - NEEDS_P4_CHAT_MEMBERSHIP: the unblurred proof is not read through this API either (review
 *   8 Nov I-1): no `POST /staff/v1/disputes/:code/proof`. The design re-wraps the proof key to the
 *   staff device key (2.4 step 5), and staff-web decrypts.
 * - NEEDS_P4_MOD_COUNTERSIGN: `…/messages` works only against a dev moderation process
 *   (X2F_DEV_MOD_CHAT=1); a production one does not register `/internal/chat/send` (review 8 Nov
 *   I-2, a compromised API could otherwise seal text as the moderator), and the route answers 502.
 *
 * - NEEDS_P4_CHAT_MEMBERSHIP: the moderator's chat READ is not built and its route is not
 *   registered. The plan's `POST /staff/v1/disputes/:code/chat` had the moderation process open the
 *   chat and hand plaintext to this API, so a compromised API could read every disputed chat. Build
 *   task 9 of design-chat-membership-keys-2026-11-08 (a grant to certified staff device keys,
 *   staff-web decrypts) replaces it; nothing here returns chat text.
 * - Nothing the moderator sends leaves the moderation process unless the API has first COMMITTED
 *   an activity-log entry for it (`chat.message-requested`) and named it in the call; the
 *   moderation process checks that entry in the database itself. A log that cannot be written means
 *   no message. `chat.message-sent {envelopeId}` is written in the transaction that stores the
 *   envelope (review 8 Nov M-2), so the log never claims a message nobody stored.
 * - Messages, the proof and the freeze are the assignee's, or a senior moderator's or the
 *   owner's (else 403 `forbidden-case`). In an appealed case nobody involved in round 1 takes any
 *   part (R37), a senior included.
 * - Every moderator action on a case is logged (owner G35) and adds the person to `seen` (R37).
 *   Taking a case logs who and when at once (G37), and so does the first opening of the case.
 * - Owner 2026-11-02: a dispute alone never blocks trading. The freeze (no end time) is a separate,
 *   later act, only on a party who ignored the dispute for FREEZE_NO_REPLY_H or ignored a ruling,
 *   and only a moderator lifts it. A frozen account cannot post or take, but its open trades still
 *   finish and its trade chats stay open (G7, G33).
 */

/** Owner 2026-11-02: "about 48 hours" with no word from the party before a moderator may freeze them. */
export const FREEZE_NO_REPLY_H = 48;
/** A moderator's message (plan: ≤ 2000); the chat's own byte cap applies too. */
export const MOD_MESSAGE_MAX = 2000;
/** Rows the queue returns at most (open cases, closest deadline first). */
export const QUEUE_MAX = 500;

const H = 3_600_000;
const FILTERS = ['all', 'mine', 'free', 'approval'] as const;
type Filter = (typeof FILTERS)[number];
/** The statuses a moderator still has to act on: the queue's. */
const QUEUE_STATUSES = ['open', 'awaiting-approval', 'appealed'];
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;

export interface StaffDisputeDeps {
  moderation: ModerationClient;
  /** The trader API's live events (moderator-joined, proof-requested, chat, trade); omitted: none sent. */
  traderEvents?: Pick<EventBus, 'publish'>;
  /** The activity log's writer (tests inject one that fails). */
  appendLog?: typeof appendLog;
}

type Side = 'buyer' | 'seller';

interface CaseTrade {
  code: string;
  seller: string;
  buyer: string;
  state: string;
  method_id: string;
  amount_atomic: string;
  locked_currency: string;
  locked_cents_per_xmr: string;
  fiat_cents: string;
  confirmations: number;
  taken_at: Date;
  /** Review trades-list I1: which part of the traders' trades it is, for members' streams. */
  closed: boolean;
}

function body(req: FastifyRequest, keys: readonly string[], required: readonly string[] = keys): Record<string, unknown> {
  const b = req.body;
  if (b === null || typeof b !== 'object' || Array.isArray(b)) throw new ApiError(400, 'bad-request');
  const o = b as Record<string, unknown>;
  if (Object.keys(o).some((k) => !keys.includes(k)) || required.some((k) => !Object.hasOwn(o, k))) throw new ApiError(400, 'bad-request');
  return o;
}

const isSide = (v: unknown): v is Side => v === 'buyer' || v === 'seller';
const isSeniorOrOwner = (role: string) => role === 'senior' || role === 'owner';

/** The trade code a `:code` names: a trade code, or a dispute's incident ID (G37, as a trader quotes it). */
async function codeOf(q: Queryable, req: FastifyRequest): Promise<string> {
  const raw = (req.params as { code?: unknown }).code;
  if (typeof raw !== 'string') throw new ApiError(404, 'not-found');
  const code = normalizeTradeCode(raw);
  if (code !== null) return code;
  const incident = normalizeIncidentId(raw);
  if (incident === null) throw new ApiError(404, 'not-found');
  const { rows } = await q.query<{ code: string }>('select code from disputes where incident_id = $1', [incident]);
  if (!rows[0]) throw new ApiError(404, 'not-found');
  return rows[0].code;
}

async function caseTrade(q: Queryable, code: string): Promise<CaseTrade> {
  const { rows } = await q.query<CaseTrade>(
    `select code, seller_account_id::text as seller, buyer_account_id::text as buyer, state, method_id, amount_atomic::text as amount_atomic,
            locked_currency, locked_cents_per_xmr::text as locked_cents_per_xmr, fiat_cents::text as fiat_cents, confirmations, taken_at,
            closed_at is not null as closed
       from trades where code = $1`,
    [code],
  );
  if (!rows[0]) throw new ApiError(404, 'not-found');
  return rows[0];
}

const actorOf = (req: FastifyRequest): Extract<Actor, { kind: 'staff' }> => ({ kind: 'staff', id: req.staff.accountId, role: req.staff.role });

/** Whether this person may work the case's chat, messages, proof and freeze. */
function mayWork(d: Dispute, req: FastifyRequest): boolean {
  const id = req.staff.accountId;
  if (d.round === 2 && d.round1 !== null && d.round1.involved.includes(id)) return false;
  return d.assignee === id || isSeniorOrOwner(req.staff.role);
}

/** "412.50": whole cents as dollars. */
function usd(cents: bigint): string {
  const neg = cents < 0n;
  const a = neg ? -cents : cents;
  return `${neg ? '-' : ''}${a / 100n}.${(a % 100n).toString().padStart(2, '0')}`;
}

function ruleError(err: unknown): never {
  if (err instanceof DisputeRuleError) {
    if (err.code === 'not-eligible' || err.code === 'wrong-party') throw new ApiError(403, 'forbidden-case');
    throw new ApiError(409, 'wrong-state');
  }
  throw err;
}

const MOD_CODES = new Set<ApiErrorCode>(['no-chat', 'moderation-unavailable']);

/** A moderation refusal as the staff app sees it. A refused log entry is the API's own fault: 502. */
function moderationError(err: unknown): never {
  if (err instanceof ModerationError) {
    const code = err.code as ApiErrorCode;
    if (MOD_CODES.has(code)) throw new ApiError(code === 'moderation-unavailable' ? 503 : 404, code);
    throw new ApiError(502, 'moderation-unavailable');
  }
  throw err;
}

export function staffDisputeRoutes(app: FastifyInstance, o: StaffDisputeDeps): void {
  const guard = requireStaff('disputes.handle');
  const log = o.appendLog ?? appendLog;
  const cfg = { perm: 'disputes.handle' as const };

  const publish = (accountIds: readonly string[], ev: LiveEvent, part: PublishOptions = {}) => {
    if (!o.traderEvents) return;
    for (const id of accountIds) {
      try {
        o.traderEvents.publish(id, ev, part);
      } catch {
        // Best effort: the change is committed and the apps re-read.
      }
    }
  };
  const disputeDeps = (req: FastifyRequest) => ({
    db: req.server.deps.db,
    clock: req.server.deps.clock,
    ...(o.traderEvents ? { events: o.traderEvents } : {}),
  });

  /**
   * Commits one logged action on the case (its own transaction, the dispute row locked): `check`
   * refuses before anything is written; the entry is appended and the person added to `seen`.
   * Returns the entry's id, for the moderation process to check.
   */
  async function logged(
    req: FastifyRequest,
    code: string,
    action: 'chat.message-requested' | 'proof.unblurred-requested',
    detail: object,
    check: (d: Dispute) => void,
  ): Promise<string> {
    let id = '';
    try {
      await withDispute(disputeDeps(req), { code }, async (d, client, now) => {
        check(d);
        id = (await log(client, { at: now, actor: actorOf(req), tradeCode: code, action, detail })).id;
        return markSeen(d, req.staff.accountId);
      });
    } catch (err) {
      ruleError(err);
    }
    return id;
  }

  /** The case for messages and proof: it exists, is not closed, and this person may work it. */
  const workable = (req: FastifyRequest) => (d: Dispute) => {
    if (!mayWork(d, req)) throw new ApiError(403, 'forbidden-case');
    if (d.status === 'closed') throw new ApiError(409, 'wrong-state');
  };

  /** Takes the case for the caller (the machine's `assign`), logging who and when at once (G37). */
  async function take(req: FastifyRequest, code: string): Promise<Dispute> {
    const me = actorOf(req);
    try {
      return await withDispute(disputeDeps(req), { code }, async (d, client, now) => {
        const s = await disputeSettings(client);
        const next = applyDispute(d, { type: 'assign', staffId: me.id, role: me.role }, me, now, s);
        // G37: who (the actor), when (the entry's time), and when the trade was opened.
        const t = await client.query<{ taken_at: Date }>('select taken_at from trades where code = $1', [code]);
        await log(client, {
          at: now, actor: me, tradeCode: code, action: 'dispute.assigned',
          detail: { staffId: me.id, ...(t.rows[0] ? { tradeOpenedAt: t.rows[0].taken_at.toISOString() } : {}) },
        });
        return next;
      });
    } catch (err) {
      return ruleError(err);
    }
  }

  // The queue: the cases a moderator still has to act on, closest deadline first (the first reply's
  // until someone replied, then the ruling's), with the counts over all of them.
  app.get('/staff/v1/disputes', { preHandler: guard, config: cfg }, async (req) => {
    const raw = (req.query as Record<string, unknown> | null)?.filter ?? 'all';
    if (typeof raw !== 'string' || !(FILTERS as readonly string[]).includes(raw)) throw new ApiError(400, 'bad-request');
    const filter = raw as Filter;
    const deps = req.server.deps;
    const now = deps.clock();
    const me = req.staff.accountId;
    const where = {
      all: 'true',
      mine: 'd.assignee = $3::uuid',
      free: 'd.assignee is null',
      approval: "d.status = 'awaiting-approval'",
    }[filter];
    const current = `d.seq = (select max(x.seq) from disputes x where x.code = d.code) and d.status = any($1::text[])`;
    const { rows } = await deps.db.query<{
      code: string; incident_id: string; status: string; round: number; amount_atomic: string; usd_cents: string; limit_usd_cents: string;
      method_id: string; opened_by: string; opened_at: Date; appealed_at: Date | null; reply_due_at: Date; ruling_due_at: Date;
      first_reply_at: Date | null; assignee: string | null; assignee_name: string | null; ruling: { proposer?: string } | null; proposer_name: string | null; mine: boolean;
      involved: string[] | null;
    }>(
      `select d.code, d.incident_id, d.status, d.round, t.amount_atomic::text as amount_atomic, d.usd_cents::text as usd_cents,
              d.limit_usd_cents::text as limit_usd_cents, t.method_id, d.opened_by, d.opened_at, ap.at as appealed_at,
              d.reply_due_at, d.ruling_due_at, d.first_reply_at, d.assignee::text as assignee, a.${PUBLIC_NAME_COLUMN} as assignee_name,
              d.ruling, p.${PUBLIC_NAME_COLUMN} as proposer_name, coalesce(d.assignee = $3::uuid, false) as mine,
              case when d.round1 is null then null else array(select jsonb_array_elements_text(d.round1->'involved')) end as involved
         from disputes d
         join trades t on t.code = d.code
         left join dispute_appeals ap on ap.code = d.code and ap.seq = d.seq
         left join accounts a on a.id = d.assignee
         left join accounts p on d.ruling ? 'proposer' and p.id::text = d.ruling->>'proposer'
        where ${current} and ${where}
        order by case when d.first_reply_at is null then d.reply_due_at else d.ruling_due_at end, d.opened_at, d.code
        limit $2`,
      [QUEUE_STATUSES, QUEUE_MAX, me],
    );
    const counts = await deps.db.query<{ open: number; overdue: number; unassigned: number; need_approval: number }>(
      `select count(*)::int as open,
              count(*) filter (where d.first_reply_at is null and d.reply_due_at < $2)::int as overdue,
              count(*) filter (where d.assignee is null)::int as unassigned,
              count(*) filter (where d.status = 'awaiting-approval')::int as need_approval
         from disputes d where ${current}`,
      [QUEUE_STATUSES, now],
    );
    const c = counts.rows[0]!;
    // D-011: an untaken appeal nobody may review is marked, so the owner sees which case waits.
    const candidates = rows.some((r) => r.status === 'appealed') ? await reviewerCandidates(deps.db) : [];
    return {
      rows: rows.map((r) => {
        const usdCents = BigInt(r.usd_cents);
        const approval = r.status === 'awaiting-approval'
          // Waiting for a second person's approval of this proposal (Task 12 writes proposals).
          ? { waitingFor: 'second-approval', proposedBy: r.proposer_name }
          : usdCents >= BigInt(r.limit_usd_cents) ? 'needs-second' : 'not-needed';
        const since = r.round === 2 && r.appealed_at !== null ? r.appealed_at : r.opened_at;
        return {
          code: r.code,
          incidentId: r.incident_id,
          status: r.status,
          round: r.round,
          xmr: r.amount_atomic,
          usd: usd(usdCents),
          method: r.method_id,
          openedBy: r.opened_by,
          waitingMs: Math.max(0, now.getTime() - since.getTime()),
          replyDueAt: r.reply_due_at.toISOString(),
          rulingDueAt: r.ruling_due_at.toISOString(),
          deadlineTone: r.first_reply_at !== null ? 'replied' : r.reply_due_at.getTime() < now.getTime() ? 'overdue' : 'due',
          approval,
          assignee: r.assignee_name,
          mine: r.mine,
          noReviewer: r.status === 'appealed' && appealReviewers(candidates, r.involved ?? []).length === 0,
        };
      }),
      counts: { open: c.open, overdue: c.overdue, unassigned: c.unassigned, needApproval: c.need_approval },
    };
  });

  // The next case: the unassigned one due first that this person may take (a moderator never gets
  // an appeal; a senior never one they were involved in).
  app.post('/staff/v1/disputes/next', { preHandler: guard, config: cfg }, async (req) => {
    body(req, []);
    const db = req.server.deps.db;
    const { rows } = await db.query<{ code: string }>(
      `select d.code from disputes d
        where d.seq = (select max(x.seq) from disputes x where x.code = d.code)
          and d.status in ('open', 'appealed') and d.assignee is null
          and (d.status = 'open' or $1::boolean)
        order by d.reply_due_at, d.opened_at, d.code limit 50`,
      [isSeniorOrOwner(req.staff.role)],
    );
    for (const r of rows) {
      try {
        const d = await take(req, r.code);
        return { code: d.code };
      } catch (err) {
        // Taken meanwhile, or not this person's to take: try the next one.
        if (err instanceof ApiError && (err.code === 'wrong-state' || err.code === 'forbidden-case')) continue;
        throw err;
      }
    }
    return { code: null };
  });

  app.post('/staff/v1/disputes/:code/take', { preHandler: guard, config: cfg }, async (req) => {
    body(req, []);
    const code = await codeOf(req.server.deps.db, req);
    if ((await loadDisputeRecord(req.server.deps.db, code)) === null) throw new ApiError(404, 'not-found');
    const d = await take(req, code);
    return { code: d.code };
  });

  // The case: header, both traders (and each one's cancel figure, J-21), the escrow, the ruling
  // state and the freezes. Never the chat.
  // The first opening per person is logged (G37: when the moderator opened the trade) and adds them to `seen`.
  app.get('/staff/v1/disputes/:code', { preHandler: guard, config: cfg }, async (req) => {
    const deps = req.server.deps;
    const code = await codeOf(deps.db, req);
    if ((await loadDisputeRecord(deps.db, code)) === null) throw new ApiError(404, 'not-found');
    const me = actorOf(req);
    let rec: DisputeRecord | null = null;
    try {
      await withDispute(disputeDeps(req), { code }, async (d, client, now, r) => {
        rec = r;
        const before = await client.query(
          `select 1 from activity_log where trade_code = $1 and action = 'case.opened' and actor_id = $2 limit 1`,
          [code, me.id],
        );
        if (before.rows.length > 0) return d;
        await log(client, { at: now, actor: me, tradeCode: code, action: 'case.opened', detail: {} });
        return markSeen(d, me.id);
      });
    } catch (err) {
      ruleError(err);
    }
    const r = (await loadDisputeRecord(deps.db, code)) ?? rec!;
    const d = r.dispute;
    const t = await caseTrade(deps.db, code);
    const now = deps.clock();
    const summaries = await traderSummaries(deps.db, [t.buyer, t.seller], now, null);
    // J-21 (owner T-017): each trader's ONE cancel figure, every kind together: moderators only,
    // so never inside the public summaries.
    const cancels = await cancelFigures(deps.db, [t.buyer, t.seller]);
    const extra = await deps.db.query<{ incident_id: string; note: string; assignee_name: string | null }>(
      `select d.incident_id, d.note, a.${PUBLIC_NAME_COLUMN} as assignee_name
         from disputes d left join accounts a on a.id = d.assignee where d.code = $1 and d.seq = $2`,
      [code, d.seq],
    );
    const x = extra.rows[0]!;
    // G37: who took the case and when, and when they first opened it (from the log, never a copy).
    const taken = await deps.db.query<{ at: Date; name: string | null; opened_at: Date | null }>(
      `select l.at, a.${PUBLIC_NAME_COLUMN} as name,
              (select min(o.at) from activity_log o where o.trade_code = l.trade_code and o.action = 'case.opened' and o.actor_id = l.actor_id and o.at >= $2) as opened_at
         from activity_log l left join accounts a on a.id = l.actor_id
        where l.trade_code = $1 and l.action = 'dispute.assigned' and l.at >= $2
        order by l.id desc limit 1`,
      [code, d.round === 2 && d.appealedAt !== null ? d.appealedAt : d.openedAt],
    );
    const tk = taken.rows[0];
    return {
      code,
      incidentId: x.incident_id,
      seq: d.seq,
      status: d.status,
      round: d.round,
      openedBy: d.openedBy,
      reason: r.reason,
      note: x.note,
      afterRefund: d.afterRefund,
      openedAt: d.openedAt.toISOString(),
      replyDueAt: d.replyDueAt.toISOString(),
      rulingDueAt: d.rulingDueAt.toISOString(),
      firstReplyAt: d.firstReplyAt?.toISOString() ?? null,
      usd: usd(d.usdCents),
      overLimit: d.usdCents >= d.limitUsdCents,
      assignee: x.assignee_name,
      assignedToYou: d.assignee === me.id,
      taken: tk ? { by: tk.name, at: tk.at.toISOString(), openedAt: tk.opened_at?.toISOString() ?? null } : null,
      mayWork: mayWork(d, req),
      moderator: r.moderatorName !== null && r.moderatorJoinedAt !== null ? { name: r.moderatorName, joinedAt: r.moderatorJoinedAt.toISOString() } : null,
      traders: { buyer: summaries.get(t.buyer) ?? null, seller: summaries.get(t.seller) ?? null },
      cancels: { buyer: cancels.get(t.buyer) ?? 0, seller: cancels.get(t.seller) ?? 0 },
      escrow: {
        state: t.state,
        amountAtomic: t.amount_atomic,
        methodId: t.method_id,
        currency: t.locked_currency,
        centsPerXmr: t.locked_cents_per_xmr,
        fiatCents: t.fiat_cents,
        confirmations: t.confirmations,
        takenAt: t.taken_at.toISOString(),
      },
      ruling: {
        draft: d.ruling,
        round1: d.round1,
        publishedAt: d.publishedAt?.toISOString() ?? null,
        appealEndsAt: d.appealEndsAt?.toISOString() ?? null,
        appeal: d.appealBy !== null && d.appealedAt !== null ? { by: d.appealBy, at: d.appealedAt.toISOString() } : null,
        complyBy: d.complyBy?.toISOString() ?? null,
      },
      freezes: await freezesOf(deps.db, t, code),
    };
  });

  // Plan 4 Task 24 (D-011): who may review this case's appeal (senior moderators and the owner
  // with no log entry on round 1, R37), by display name, and whether the appeal waits for one.
  // Review M1 (lead call 12 Nov): the owner's alone (`staff.manage`; the owner acts on D-011 by
  // adding or switching on a reviewer), and refused (403 `forbidden-case`) to a caller involved in
  // the case, so nobody involved learns who will review their ruling even if the perm widens later.
  // Never logged and nobody is added to `seen`: under R37 any log entry on the trade is involvement,
  // so a logged read would shrink the reviewer pool (lead correction 12 Nov).
  const ownerGuard = requireStaff('staff.manage');
  app.get('/staff/v1/disputes/:code/appeal-reviewers', { preHandler: ownerGuard, config: { perm: 'staff.manage' } }, async (req) => {
    const db = req.server.deps.db;
    const code = await codeOf(db, req);
    const rec = await loadDisputeRecord(db, code);
    if (rec === null) throw new ApiError(404, 'not-found');
    const d = rec.dispute;
    const me = req.staff.accountId;
    const involvedNow = await db.query('select 1 from activity_log where trade_code = $1 and actor_kind = $2 and actor_id = $3 limit 1', [code, 'staff', me]);
    if ((d.round1?.involved.includes(me) ?? false) || d.seen.includes(me) || involvedNow.rows.length > 0) throw new ApiError(403, 'forbidden-case');
    // Before an appeal, round 1's involvement is not frozen yet: no list.
    const reviewers = d.round === 2 ? await eligibleReviewers(db, d) : [];
    return { reviewers: reviewers.map((s) => ({ name: s.name })), waiting: await appealWaiting(db, d) };
  });

  // NEEDS_P4_CHAT_MEMBERSHIP: no `POST /staff/v1/disputes/:code/chat` here on purpose (see the top
  // of this file; design-chat-membership-keys-2026-11-08, build task 9).

  /**
   * The first time each moderator writes to the traders, both are told who joined (a system card
   * from server records only, and the live event); later messages tell nobody. Until the chat read
   * is built (build task 9) writing is the moderator's first visible act on the chat.
   */
  async function announce(req: FastifyRequest, code: string, t: CaseTrade): Promise<void> {
    const deps = req.server.deps;
    const name = req.staff.displayName;
    const { rowCount } = await deps.db.query(
      `update disputes set moderator_name = $2, moderator_joined_at = $3
        where code = $1 and seq = (select max(seq) from disputes where code = $1) and moderator_name is distinct from $2`,
      [code, name, deps.clock()],
    );
    if (rowCount === 1) {
      publish([t.buyer, t.seller], { type: 'moderator-joined', code, username: name }, { closed: t.closed });
      publish([t.buyer, t.seller], { type: 'trade', code, state: t.state }, { closed: t.closed });
    }
  }

  // A message to both traders: logged, sealed by the moderation process, stored as the chat's mod
  // envelope, and the dispute's reply (the first one stops the first-reply clock).
  app.post('/staff/v1/disputes/:code/messages', { preHandler: guard, config: cfg }, async (req, reply: FastifyReply) => {
    const b = body(req, ['text']);
    const text = b.text;
    if (typeof text !== 'string' || text.trim() === '' || text.length > MOD_MESSAGE_MAX || CONTROL.test(text)
      || new TextEncoder().encode(text).length > CHAT_TEXT_MAX_BYTES) {
      throw new ApiError(400, 'bad-request');
    }
    const deps = req.server.deps;
    const code = await codeOf(deps.db, req);
    const t = await caseTrade(deps.db, code);
    const chat = (await deps.db.query<{ code: string }>('select code from chats where trade_code = $1', [code])).rows[0]?.code;
    if (chat === undefined) throw new ApiError(404, 'no-chat');
    const logEntryId = await logged(req, code, 'chat.message-requested', {}, workable(req));
    let envelope: unknown;
    try {
      ({ envelope } = await o.moderation.chatSend({ code, logEntryId, text }));
    } catch (err) {
      moderationError(err);
    }
    let env;
    try {
      env = checkChatEnvelope(envelope, await channelFor(chat, 'chat'), 'mod');
    } catch (err) {
      if (err instanceof ChatEnvelopeError) throw new ApiError(502, 'moderation-unavailable');
      throw err;
    }
    const me = actorOf(req);
    let id = '';
    try {
      await withDispute(disputeDeps(req), { code }, async (d, client, now) => {
        workable(req)(d);
        id = await storeModEnvelope(client, chat, env, now);
        await log(client, { at: now, actor: me, tradeCode: code, action: 'chat.message-sent', detail: { envelopeId: id } });
        return applyDispute(d, { type: 'reply' }, me, now, await disputeSettings(client));
      });
    } catch (err) {
      ruleError(err);
    }
    await announce(req, code, t);
    publish([t.buyer, t.seller], { type: 'chat', chat }, { closed: t.closed });
    return reply.code(201).send({ id });
  });

  // Asks the trader named for the unblurred proof (logged; the request goes to that trader only).
  // NEEDS_P5_PROOF_ENVELOPE: once the proof package lands, ask the trader who uploaded the proof.
  app.post('/staff/v1/disputes/:code/proof-request', { preHandler: guard, config: cfg }, async (req, reply: FastifyReply) => {
    const b = body(req, ['side']);
    if (!isSide(b.side)) throw new ApiError(400, 'bad-request');
    const side = b.side;
    const deps = req.server.deps;
    const code = await codeOf(deps.db, req);
    const t = await caseTrade(deps.db, code);
    await logged(req, code, 'proof.unblurred-requested', { side }, workable(req));
    // The trader named sees the request in the dispute view too (the live event is only a hint).
    await deps.db.query(
      `update disputes set proof_request_side = $2, proof_requested_at = $3, proof_requested_by = $4
        where code = $1 and seq = (select max(seq) from disputes where code = $1)`,
      [code, side, deps.clock(), req.staff.displayName],
    );
    publish([side === 'buyer' ? t.buyer : t.seller], { type: 'proof-requested', code, username: req.staff.displayName }, { closed: t.closed });
    return reply.code(204).send();
  });

  // NEEDS_P4_CHAT_MEMBERSHIP: no `POST /staff/v1/disputes/:code/proof` here on purpose (review 8 Nov
  // I-1: it relayed the unblurred image through this API; the design re-wraps the proof key to the
  // staff device key instead).

  // The freeze (owner 2026-11-02). `on: true` with a `reason`: `no-reply`, the party said nothing
  // for FREEZE_NO_REPLY_H since the dispute (or its appeal) opened or their last chat message;
  // `ignored-ruling`, the seller ordered to send XMR let the comply time pass. No end time.
  // `on: false` lifts it, whatever became of the dispute.
  app.post('/staff/v1/disputes/:code/freeze', { preHandler: guard, config: cfg }, async (req) => {
    const raw = body(req, ['side', 'on', 'reason'], ['side', 'on']);
    if (!isSide(raw.side) || typeof raw.on !== 'boolean') throw new ApiError(400, 'bad-request');
    if (raw.on ? raw.reason !== 'no-reply' && raw.reason !== 'ignored-ruling' : Object.hasOwn(raw, 'reason')) throw new ApiError(400, 'bad-request');
    const side = raw.side;
    const on = raw.on;
    const reason = raw.reason as 'no-reply' | 'ignored-ruling' | undefined;
    const deps = req.server.deps;
    const code = await codeOf(deps.db, req);
    const t = await caseTrade(deps.db, code);
    const accountId = side === 'buyer' ? t.buyer : t.seller;
    const me = actorOf(req);
    try {
      await withDispute(disputeDeps(req), { code }, async (d, client, now, rec) => {
        if (!mayWork(d, req)) throw new ApiError(403, 'forbidden-case');
        const active = await client.query<{ id: string }>(
          'select id from trading_holds where account_id = $1 and dispute_code = $2 and lifted_at is null for update',
          [accountId, code],
        );
        if (on) {
          if (d.status === 'closed') throw new ApiError(409, 'wrong-state');
          if (active.rows.length > 0) throw new ApiError(409, 'wrong-state');
          // g62: no freeze while maintenance holds the dispute's timers.
          if (rec.pausedSince !== null || !(await freezeAllowed(client, d, side, reason!, now))) throw new ApiError(409, 'freeze-not-allowed');
          await client.query(
            `insert into trading_holds (account_id, created_at, kind, dispute_code, dispute_seq, side, reason, placed_by)
             values ($1, $2, 'freeze', $3, $4, $5, $6, $7)`,
            [accountId, now, code, d.seq, side, reason, me.id],
          );
          await log(client, { at: now, actor: me, tradeCode: code, action: 'account.frozen', detail: { accountId, side, reason } });
        } else {
          if (active.rows.length === 0) throw new ApiError(409, 'wrong-state');
          await client.query('update trading_holds set lifted_at = $2, lifted_by = $3 where id = any($1::uuid[])', [active.rows.map((r) => r.id), now, me.id]);
          await log(client, { at: now, actor: me, tradeCode: code, action: 'account.freeze-lifted', detail: { accountId, side } });
        }
        return markSeen(d, me.id);
      });
    } catch (err) {
      ruleError(err);
    }
    return { freezes: await freezesOf(deps.db, t, code) };
  });

  staffFreezeLiftRoute(app, o);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * F1 (freeze review 12 Nov; D-014 "mods lift it"): `POST /staff/v1/freezes/:id/lift` lifts one
 * freeze by its id, so a freeze that outlived its trade (R36 whole-record delete) still has a
 * lift. The case route's own rules: `disputes.handle`; while the case exists, `mayWork` on it (the
 * assignee, a senior or the owner; R37 on an appeal), the log entry on the case and the person
 * added to `seen`; once the case is gone there is no assignee, so only a senior or the owner, and
 * the log entry carries no trade. Like the case route's lift, no maintenance gate (lifting only
 * gives trading back). 204; 404 `not-found` for an unknown id; 409 `wrong-state` once lifted.
 * Nothing new is shown to traders.
 */
function staffFreezeLiftRoute(app: FastifyInstance, o: StaffDisputeDeps): void {
  const guard = requireStaff('disputes.handle');
  const cfg = { perm: 'disputes.handle' as const };
  const log = o.appendLog ?? appendLog;
  app.post('/staff/v1/freezes/:id/lift', { preHandler: guard, config: cfg }, async (req, reply: FastifyReply) => {
    const id = (req.params as { id?: unknown }).id;
    if (typeof id !== 'string' || !UUID.test(id)) throw new ApiError(404, 'not-found');
    const deps = req.server.deps;
    const { rows } = await deps.db.query<{ account_id: string; dispute_code: string | null; side: Side | null; has_case: boolean }>(
      `select h.account_id::text as account_id, h.dispute_code, h.side,
              exists (select 1 from disputes d where d.code = h.dispute_code) as has_case
         from trading_holds h where h.id = $1 and h.kind = 'freeze'`,
      [id.toLowerCase()],
    );
    const f = rows[0];
    if (!f || f.dispute_code === null || f.side === null) throw new ApiError(404, 'not-found');
    const me = actorOf(req);
    const liftIn = async (client: pg.PoolClient, now: Date, tradeCode: string | null) => {
      const active = await client.query('select 1 from trading_holds where id = $1 and lifted_at is null for update', [id]);
      if ((active.rowCount ?? 0) === 0) throw new ApiError(409, 'wrong-state');
      await client.query('update trading_holds set lifted_at = $2, lifted_by = $3 where id = $1', [id, now, me.id]);
      await log(client, { at: now, actor: me, tradeCode, action: 'account.freeze-lifted', detail: { accountId: f.account_id, side: f.side } });
    };
    if (f.has_case) {
      const code = f.dispute_code;
      try {
        await withDispute({ db: deps.db, clock: deps.clock, ...(o.traderEvents ? { events: o.traderEvents } : {}) }, { code }, async (d, client, now) => {
          if (!mayWork(d, req)) throw new ApiError(403, 'forbidden-case');
          await liftIn(client, now, code);
          return markSeen(d, me.id);
        });
      } catch (err) {
        ruleError(err);
      }
    } else {
      if (!isSeniorOrOwner(req.staff.role)) throw new ApiError(403, 'forbidden-case');
      const client = await deps.db.connect();
      try {
        await client.query('begin');
        await liftIn(client, deps.clock(), null);
        await client.query('commit');
      } catch (err) {
        await client.query('rollback');
        throw err;
      } finally {
        client.release();
      }
    }
    return reply.code(204).send();
  });
}

/** Whether a moderator may freeze `side` now (owner 2026-11-02). */
async function freezeAllowed(q: Queryable, d: Dispute, side: Side, reason: 'no-reply' | 'ignored-ruling', now: Date): Promise<boolean> {
  if (reason === 'ignored-ruling') {
    // Only a payment the ruling ordered and the seller let lapse (`seller-sends-xmr`, COMPLY_H).
    return side === 'seller' && d.status === 'complying' && d.complyBy !== null && d.compliedAt === null && now.getTime() >= d.complyBy.getTime();
  }
  const { rows } = await q.query<{ last: Date | null }>(
    `select max(e.created_at) as last from chat_envelopes e join chats c on c.code = e.chat
      where c.trade_code = $1 and e.sender_role = $2`,
    [d.code, side],
  );
  const since = d.round === 2 && d.appealedAt !== null ? d.appealedAt : d.openedAt;
  const last = rows[0]?.last && rows[0].last.getTime() > since.getTime() ? rows[0].last : since;
  // g62 (owner): maintenance freezes the dispute's timers, so time in maintenance does not count
  // as ignoring the dispute. The ruling deadline was shifted by every maintenance since the round
  // began (A7, `shiftDeadlines`); that shift is added in full (never fewer than 48 hours of silence).
  const deadlineH = d.round === 2 ? APPEAL_GOAL_H : RULING_DEADLINE_H;
  const pausedMs = Math.max(0, d.rulingDueAt.getTime() - since.getTime() - deadlineH * H);
  return now.getTime() - last.getTime() >= FREEZE_NO_REPLY_H * H + pausedMs;
}

async function freezesOf(q: Queryable, t: Pick<CaseTrade, 'buyer' | 'seller'>, code: string): Promise<Record<Side, boolean>> {
  const { rows } = await q.query<{ account_id: string }>(
    'select account_id::text as account_id from trading_holds where dispute_code = $1 and lifted_at is null',
    [code],
  );
  const held = new Set(rows.map((r) => r.account_id));
  return { buyer: held.has(t.buyer), seller: held.has(t.seller) };
}

/**
 * Stores the moderator's envelope in the trade chat (sender `mod`), under the chat row's lock, as
 * the trader route stores theirs: a seq at or below the last stored one is refused.
 */
async function storeModEnvelope(client: pg.PoolClient, chat: string, env: { seq: number }, now: Date): Promise<string> {
  await client.query('select 1 from chats where code = $1 for update', [chat]);
  const last = await client.query<{ seq: string | null }>("select max(seq)::text as seq from chat_envelopes where chat = $1 and sender_role = 'mod'", [chat]);
  const top = last.rows[0]?.seq;
  if (top !== null && top !== undefined && BigInt(env.seq) <= BigInt(top)) throw new ApiError(502, 'moderation-unavailable');
  const ins = await client.query<{ id: string }>(
    `insert into chat_envelopes (chat, sender_role, seq, envelope, created_at) values ($1, 'mod', $2, $3, $4) returning id::text as id`,
    [chat, env.seq, env, now],
  );
  await client.query('update chats set last_message_at = $2 where code = $1', [chat, now]);
  return ins.rows[0]!.id;
}
