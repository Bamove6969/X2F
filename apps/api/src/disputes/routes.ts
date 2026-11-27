import { addressEnd } from '@x2f/accounts';
import { hasAbility } from '../team/abilities.js';
import { DisputeRuleError, RULING_DEADLINE_H, RULING_GOAL_H, applyDispute, involvedIn, rulingFee, traderStatus, type InvolvementEntry, type RulingFee, type TraderDisputeStatus } from '@x2f/staff';
import { TradeRuleError, type Party, type Trade } from '@x2f/trade';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireSession } from '../auth/sessions.js';
import { FINISH_OPEN_TRADES } from '../trades/routes.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { auditMember } from '../team/audit.js';
import { assertMemberMay, tradePartAbility } from '../team/perms.js';
import { applyEvent, noPublish, rowToTrade, type TradePublisher, type TradeRow } from '../trades/store.js';
import { tradeFor } from '../trades/routes.js';
import { roleOf } from '../trades/view.js';
import { appendLog } from '../log/append.js';
import { PUBLIC_NAME_COLUMN } from '../events/publicName.js';
import { pushOwnerAlert } from '../push/ownerAlert.js';
import { appealWaiting, syncNoReviewerAlert } from './appeals.js';
import { disputeSettings } from './settings.js';
import { loadDisputeRecord, startDispute, withDispute } from './store.js';
import { disputeGrant } from '../chat/grants.js';

/**
 * Trader-side disputes (Plan 3 Task 27; spec 2.3, 6.6), on Plan 4's dispute machine (Task 10):
 * opening a dispute starts the machine (`newDispute`, with the settings snapshot), the appeal is the
 * machine's `appeal`, and the view shows its deadlines. Plan 4's staff routes write rulings and the
 * moderator's join, which this file only reads. Participants only (anyone else gets the same 404 as
 * an unknown code), trader sessions only. Owner 2026-11-02: a dispute never blocks trading by itself.
 */

/** Reason codes a trader may give, relative to whoever opens the dispute (108_disputes.sql). */
export const DISPUTE_REASONS = ['paid', 'silent', 'terms', 'other'] as const;
/** A stored reason: a trader's, or 'escalated' for a dispute the system opened (110). */
export type DisputeReason = (typeof DISPUTE_REASONS)[number] | 'escalated';
export const NOTE_MAX = 1000;
export const APPEAL_MIN = 10;
export const APPEAL_MAX = 1000;

export type RulingOutcome = 'release-to-buyer' | 'refund-to-seller' | 'seller-sends-xmr' | 'seller-returns-fiat' | 'no-action';

/** What `GET /v1/trades/:code/dispute` returns. Names are public Trade Tags; no address is ever whole. */
export interface DisputeView {
  /** G37 (owner 7 Nov): the dispute's incident ID, shown to both traders at the top of the trade and to the moderator. */
  incidentId: string;
  /** 'system' when the timer loop escalated the trade (late funds, a lapse nobody refunded). */
  openedBy: Party | 'system';
  reason: DisputeReason;
  openedAt: string;
  afterRefund: boolean;
  /** The current round's ruling deadline ("ruling due by …"; the plan's `rulingDueAt`). */
  dueAt: string | null;
  /**
   * The target time: round 1 aims to be resolved within 24 hours (RULING_GOAL_H; owner 2026-11-03,
   * "every dispute within 24 hours or less"), before the 48-hour hard deadline `dueAt`; the appeal
   * round aims at its own 48 hours (APPEAL_GOAL_H), so its goal is its deadline. Derived from
   * `dueAt`, so a maintenance shift moves it too.
   */
  goalAt: string;
  /** The current round's first-reply deadline (the owner's first-response setting). */
  replyDueAt: string;
  firstReplyAt: string | null;
  /** While nobody has taken the case: 1 + the unassigned open disputes due for a reply earlier. */
  queuePosition: number | null;
  /** 1, or 2 once appealed (the appeal round's ruling is final and binding). */
  round: 1 | 2;
  /** `traderStatus()` of the machine's status. */
  status: TraderDisputeStatus;
  /** A `seller-sends-xmr` ruling: when the seller's payment is due. */
  complyBy: string | null;
  /** From server records only (Plan 4 writes it when a moderator first opens the chat). */
  moderator: { name: string; joinedAt: string } | null;
  /** The latest ruling (the appeal round over the first). */
  ruling: {
    round: 1 | 2;
    outcome: RulingOutcome;
    reason: string;
    evidence: string[];
    moderatorName: string;
    ruledAt: string;
    /** Null for a final (appeal-round) ruling. */
    appealUntil: string | null;
    /** Where the XMR goes, only for the side the ruling pays: its wallet app and address ending. */
    destination: { walletApp: string | null; addressEnd: string } | null;
    /** When the escrow payout of the ruling ran (the watcher's settled report), or null: the XMR has not moved yet. */
    executedAt: string | null;
  } | null;
  appeal: { by: Party; at: string } | null;
  /**
   * D-011 (Plan 4 Task 24, lead default): the appeal waits for an independent reviewer: nobody has
   * taken it and every senior moderator and the owner was involved in round 1 (or none is switched
   * on). Both traders are told; the owner was alerted when it was filed. False otherwise.
   */
  appealWaiting: boolean;
  /**
   * Plan 4 Task 11: the moderator's latest request for this trader's unblurred proof (only the side
   * it names sees it), from server records only.
   */
  /** `sentAt`: when this side's unblurred copy answering the request was stored (Plan 5 Task 15), or null. */
  proofRequest: { username: string; at: string; sentAt: string | null } | null;
  /** The appeal window's length in hours, from the owner's settings. */
  appealWindowH: number;
  /**
   * Owner g63 (7 Nov): the 1% fee after the ruling, `rulingFee` of @x2f/staff: `poster-pays` (the
   * trade completes: a ruling that moves it forward, an appeal upholding completion, a lien),
   * `none` (a full reversal), `waits` (an appeal is pending), null before a ruling. Only in the
   * poster's view: the taker never sees a fee (Global Constraints). The words are design's (TODO).
   */
  fee?: RulingFee | null;
  serverNow: string;
}

interface RulingRow {
  round: 1 | 2;
  outcome: RulingOutcome;
  reason: string;
  evidence: unknown;
  moderator_name: string;
  ruled_at: Date;
  appeal_until: Date | null;
}

function bodyOf(req: FastifyRequest, keys: readonly string[]): Record<string, unknown> {
  const body = req.body;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'bad-request');
  const b = body as Record<string, unknown>;
  // Exactly these keys: a `by`, `type` or anything else is refused, never ignored.
  if (Object.keys(b).some((k) => !keys.includes(k))) throw new ApiError(400, 'bad-request');
  return b;
}

/**
 * Free text a trader writes: a string of at most `max` characters with no control character
 * except a line break or a tab (Postgres refuses U+0000 in text; the others are never typed).
 */
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;
const isText = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max && !CONTROL.test(v);

const isReason = (v: unknown): v is (typeof DISPUTE_REASONS)[number] => typeof v === 'string' && (DISPUTE_REASONS as readonly string[]).includes(v);

/** The trade and the caller's side, or 404 for anyone who is not a participant. */
async function participant(req: FastifyRequest): Promise<{ row: TradeRow; t: Trade; side: Party }> {
  const row = await tradeFor(req);
  const t = rowToTrade(row);
  const side = roleOf(t, req.auth.accountId);
  if (side === null) throw new ApiError(404, 'not-found');
  return { row, t, side };
}

/** The wallet app of the account's wallet with this address (a removed one counts), or null. */
async function walletAppFor(q: Queryable, accountId: string, address: string): Promise<string | null> {
  const { rows } = await q.query<{ app: string }>(
    'select app from wallets where account_id = $1 and address = $2 order by created_at desc limit 1',
    [accountId, address],
  );
  return rows[0]?.app ?? null;
}

/** Which side an outcome pays XMR to (the after-refund outcomes pay nobody from an escrow). */
function paidSide(outcome: RulingOutcome): Party | null {
  if (outcome === 'release-to-buyer') return 'buyer';
  if (outcome === 'refund-to-seller') return 'seller';
  return null;
}

async function loadView(q: Queryable, row: TradeRow, side: Party, accountId: string, now: Date): Promise<DisputeView | null> {
  // The current dispute is the trade's latest (highest seq); earlier ones are kept but not shown.
  const rec = await loadDisputeRecord(q, row.code);
  if (rec === null) return null;
  const d = rec.dispute;
  const extra = (await q.query<{ incident_id: string; proof_request_side: Party | null; proof_requested_at: Date | null; proof_requested_by: string | null; proof_request_sent_at: Date | null }>(
    'select incident_id, proof_request_side, proof_requested_at, proof_requested_by, proof_request_sent_at from disputes where code = $1 and seq = $2',
    [row.code, d.seq],
  )).rows[0]!;
  const r = (await q.query<RulingRow>('select * from dispute_rulings where code = $1 and seq = $2 order by round desc limit 1', [row.code, d.seq])).rows[0];
  let queuePosition: number | null = null;
  if (d.status === 'open' && d.assignee === null) {
    const ahead = await q.query<{ n: number }>(
      `select count(*)::int as n from disputes where status = 'open' and assignee is null and reply_due_at < $1`,
      [d.replyDueAt],
    );
    queuePosition = 1 + (ahead.rows[0]?.n ?? 0);
  }

  let ruling: DisputeView['ruling'] = null;
  if (r) {
    let destination: NonNullable<DisputeView['ruling']>['destination'] = null;
    if (paidSide(r.outcome) === side) {
      const address = side === 'buyer' ? row.buyer_payout : row.seller_refund;
      if (address !== null) {
        const walletApp = side === 'seller' ? row.seller_wallet_app : await walletAppFor(q, accountId, address);
        destination = { walletApp, addressEnd: addressEnd(address) };
      }
    }
    ruling = {
      round: r.round,
      outcome: r.outcome,
      reason: r.reason,
      evidence: Array.isArray(r.evidence) ? r.evidence.filter((x): x is string => typeof x === 'string') : [],
      moderatorName: r.moderator_name,
      ruledAt: r.ruled_at.toISOString(),
      appealUntil: r.appeal_until?.toISOString() ?? null,
      destination,
      executedAt: d.executedAt?.toISOString() ?? null,
    };
  }
  return {
    incidentId: extra.incident_id,
    openedBy: d.openedBy,
    reason: rec.reason,
    openedAt: d.openedAt.toISOString(),
    afterRefund: d.afterRefund,
    dueAt: d.rulingDueAt.toISOString(),
    goalAt: new Date(d.rulingDueAt.getTime() - (d.round === 1 ? (RULING_DEADLINE_H - RULING_GOAL_H) * 3_600_000 : 0)).toISOString(),
    replyDueAt: d.replyDueAt.toISOString(),
    firstReplyAt: d.firstReplyAt?.toISOString() ?? null,
    queuePosition,
    round: d.round,
    status: traderStatus(d.status),
    complyBy: d.complyBy?.toISOString() ?? null,
    moderator:
      rec.moderatorName !== null && rec.moderatorJoinedAt !== null ? { name: rec.moderatorName, joinedAt: rec.moderatorJoinedAt.toISOString() } : null,
    ruling,
    appeal: d.appealBy !== null && d.appealedAt !== null ? { by: d.appealBy, at: d.appealedAt.toISOString() } : null,
    appealWaiting: await appealWaiting(q, d),
    proofRequest:
      extra.proof_request_side === side && extra.proof_requested_at !== null && extra.proof_requested_by !== null
        ? { username: extra.proof_requested_by, at: extra.proof_requested_at.toISOString(), sentAt: extra.proof_request_sent_at?.toISOString() ?? null }
        : null,
    // Lead review 7 Nov: the appeal window's length as the owner set it (settings), for the ruling page.
    appealWindowH: (await disputeSettings(q)).appealWindowH,
    ...(side === row.poster ? { fee: rulingFee(d) } : {}),
    serverNow: now.toISOString(),
  };
}

/** What `GET /v1/account/freeze` returns (D-016): the account's active freezes, oldest first. */
export interface FreezeView {
  freezes: Array<{
    since: string;
    /** Null once the trade's record is gone (R36). `side` is this account's side of that trade. */
    dispute: { code: string; incidentId: string | null; side: Party; amountAtomic: string; counterparty: string } | null;
  }>;
}

export interface DisputeRouteOptions {
  /** Task 19's event bus (the same hook the trade events route uses); a no-op until then. */
  publish?: TradePublisher;
}

export function disputeRoutes(app: FastifyInstance, opts: DisputeRouteOptions = {}): void {
  // Plan 2 Task 17: a dispute on an open trade can be opened (and followed) during the hold, from a backup session too.
  // Job 1c (owner D-066, p7-7): only trade parties open disputes, so opening one is the account
  // owner's alone (a member gets 403 `owner-only`); a member with the disputes box (Answer the
  // moderator) sees the dispute, one with File an appeal appeals a ruling.
  const owner = requireSession({ ...FINISH_OPEN_TRADES });
  const answer = requireSession({ ...FINISH_OPEN_TRADES, member: 'disputes-answer' });
  const appeal = requireSession({ ...FINISH_OPEN_TRADES, member: 'disputes-appeal' });
  const hook = opts.publish ?? noPublish;
  const publish: TradePublisher = async (t, e, by) => {
    try {
      await hook(t, e, by);
    } catch (err) {
      app.log.error({ err }, 'trade publish failed');
    }
  };

  // D-013..D-016 (owner 2026-11-02, Q39): the account's active trading freezes, for the
  // AccountFrozen notice. A moderator placed each on this account as the party who ignored a
  // dispute or a ruling (staffRoutes.ts); it has no end time and only a moderator lifts it. Each
  // names when it began and the dispute it came from: the code, the dispute's incident ID (G37), the
  // account's side, the amount and the partner's public Trade Tag. A freeze outlives its trade
  // (R36 whole-record delete, migration 208): then `dispute` is null. The account owner's sessions
  // only, a backup or held one too (FINISH_OPEN_TRADES), so the notice shows whatever else holds the
  // account. Oldest first. Never the reason, who placed it, or anything about the partner beyond
  // the name both traders already see.
  app.get('/v1/account/freeze', { preHandler: owner }, async (req): Promise<FreezeView> => {
    const { rows } = await req.server.deps.db.query<{
      since: Date; code: string | null; incident_id: string | null; side: Party | null; amount_atomic: string | null; counterparty: string | null;
    }>(
      `select h.created_at as since, t.code, d.incident_id,
              case when t.code is null then null when t.seller_account_id = h.account_id then 'seller' else 'buyer' end as side,
              t.amount_atomic::text as amount_atomic, p.${PUBLIC_NAME_COLUMN} as counterparty
         from trading_holds h
         left join trades t on t.code = h.dispute_code and (t.seller_account_id = h.account_id or t.buyer_account_id = h.account_id)
         left join disputes d on d.code = t.code and d.seq = h.dispute_seq
         left join accounts p on p.id = case when t.seller_account_id = h.account_id then t.buyer_account_id else t.seller_account_id end
        where h.account_id = $1 and h.lifted_at is null and h.kind = 'freeze'
        order by h.created_at, h.id`,
      [req.auth.accountId],
    );
    return {
      freezes: rows.map((r) => ({
        since: r.since.toISOString(),
        dispute: r.code === null || r.side === null || r.amount_atomic === null || r.counterparty === null
          ? null
          : { code: r.code, incidentId: r.incident_id, side: r.side, amountAtomic: r.amount_atomic, counterparty: r.counterparty },
      })),
    };
  });

  app.get('/v1/trades/:code/dispute', { preHandler: answer }, async (req) => {
    const { row, side } = await participant(req);
    // Review trades-list I1: besides the disputes box, the part's (open: See active trades; decided and closed: See trade history).
    assertMemberMay(req.auth, tradePartAbility(row.closed_at));
    const view = await loadView(req.server.deps.db, row, side, req.auth.accountId, req.server.deps.clock());
    if (view === null) throw new ApiError(404, 'not-found');
    return view;
  });

  // Opens the dispute: the trade's `open-dispute` (the state machine decides when it is allowed:
  // the buyer only after the seller's confirm window (the seller's own rule differs: see the
  // machine), a refunded trade only by the buyer within 48 hours, TIMERS.disputeAfterRefundHours) and the dispute row, in one transaction. A trade opens at most one dispute: once its
  // `dispute` is set (by a trader or the system) a new one is refused, whatever rows exist, so a
  // purge of old dispute rows can never re-open a decided case.
  app.post('/v1/trades/:code/dispute', { preHandler: owner }, async (req) => {
    // Design build task 6: `grant`, the disputer's signed grant of the chat key to the moderator
    // (chat/grants.ts), required once the trade's chat has a key record.
    const b = bodyOf(req, ['reason', 'note', 'grant']);
    if (!isReason(b.reason)) throw new ApiError(400, 'bad-request');
    if (!isText(b.note, NOTE_MAX)) throw new ApiError(400, 'bad-request');
    const reason = b.reason;
    const note = b.note;
    const { row, side } = await participant(req);
    const deps = req.server.deps;
    const keepGrant = await disputeGrant(deps.db, row.code, side, b.grant, deps.clock());
    try {
      await applyEvent(
        { db: deps.db, clock: deps.clock, publish },
        row.code,
        { type: 'open-dispute' },
        side,
        async (client, prev, _next, now) => {
          if (prev.dispute !== null) throw new ApiError(409, 'dispute-exists');
          if (keepGrant !== null) await keepGrant(client);
          else {
            // Review F5: a key record posted after the check above (the key route holds the chat row's
            // lock while it inserts) still needs the disputer's grant.
            await client.query('select 1 from chats where trade_code = $1 for share', [row.code]);
            const keyed = await client.query('select 1 from chat_keys k join chats c on c.code = k.chat where c.trade_code = $1', [row.code]);
            if (keyed.rows.length > 0) throw new ApiError(400, 'grant-required');
          }
          // Plan 4 Task 10: the machine starts here, with the owner's settings as they are now (the
          // large-trade limit is a snapshot) and the trade's USD value; `dispute.opened` is logged.
          await startDispute(client, prev, { openedBy: side, reason, note, afterRefund: prev.state === 'refunded', now, prices: deps.prices });
          // Task 18: only the account owner gets here (D-066); kept so a member route would log (the reason, never the note).
          await auditMember(client, req.auth, { action: 'dispute-opened', tradeCode: row.code, detail: { reason } }, now);
        },
      );
    } catch (err) {
      if (err instanceof TradeRuleError) {
        // A trade already in dispute (or that had one) refuses open-dispute as wrong-state; say why.
        const had = (await deps.db.query<{ dispute_by: string | null }>('select dispute_by from trades where code = $1', [row.code])).rows[0];
        throw new ApiError(409, had?.dispute_by != null ? 'dispute-exists' : err.code);
      }
      throw err;
    }
    const view = await loadView(deps.db, row, side, req.auth.accountId, deps.clock());
    return view;
  });

  // The appeal (spec 2.3; owner 2026-11-02): ONE appeal per dispute, by either side, only against
  // a published first-round ruling and strictly before its window ends (publish + appeal_window_h,
  // 48 h). The appeal round's ruling is completely binding (round 2 has no appeal).
  app.post('/v1/trades/:code/appeal', { preHandler: appeal }, async (req, reply) => {
    const b = bodyOf(req, ['why']);
    if (!isText(b.why, APPEAL_MAX) || b.why.trim().length < APPEAL_MIN) throw new ApiError(400, 'bad-request');
    const why = b.why;
    const { row, side } = await participant(req);
    // Re-verify trades-list m3: besides the appeal box, the box for the trade's part.
    assertMemberMay(req.auth, tradePartAbility(row.closed_at));
    const deps = req.server.deps;
    let noReviewer = false;
    try {
      await withDispute({ db: deps.db, clock: deps.clock, events: req.server.events }, { code: row.code }, async (d, client, now) => {
        // D-059, review of feat/lockout item 5 (lead default, owner question pending): an appeal on a
        // trade a compromised-account lock holds goes through as on any paused dispute, so the other
        // trader never learns of the lock (the locked party is logged out and cannot appeal).
        const s = await disputeSettings(client);
        const by = { kind: 'trader' as const, side };
        // Refused here, before anything is written, when the machine would refuse it: only a
        // published first-round ruling, strictly before `appealEndsAt` (one appeal only, owner).
        applyDispute(d, { type: 'appeal', involved: [] }, by, now, s);
        const { rowCount } = await client.query(
          'insert into dispute_appeals (code, seq, by, why, at) values ($1, $2, $3, $4, $5) on conflict (code, seq) do nothing',
          [d.code, d.seq, side, why, now],
        );
        if (rowCount !== 1) throw new DisputeRuleError('wrong-state');
        await auditMember(client, req.auth, { action: 'appeal-filed', tradeCode: row.code }, now);
        // R37 (Task 24): `appeal.opened` FIRST, then, holding the log lock on this client, everyone
        // with an earlier log entry on the trade is involved in round 1 and can take no part in the appeal.
        const entry = await appendLog(client, { at: now, actor: by, tradeCode: d.code, action: 'appeal.opened', detail: { side } });
        const log = await client.query<{ id: string; trade_code: string | null; actor_kind: InvolvementEntry['actorKind']; actor_id: string | null; action: string }>(
          `select id::text as id, trade_code, actor_kind, actor_id::text as actor_id, action from activity_log
           where trade_code = $1 and actor_kind = 'staff' and id < $2`,
          [d.code, entry.id],
        );
        const involved = involvedIn(
          log.rows.map((r) => ({ id: r.id, tradeCode: r.trade_code, actorKind: r.actor_kind, actorId: r.actor_id, action: r.action })),
          d.code,
          { beforeId: entry.id },
        );
        // Task 25 (J-06): the appellant's own round-1 lien is suspended by withDispute's lien rules
        // (disputes/lien.ts) in this same transaction, once this change is accepted.
        const next = applyDispute(d, { type: 'appeal', involved: [...involved] }, by, now, s);
        // D-011 (lead default): nobody may review it. It waits in the queue (no involved person is
        // let in instead, R37) and the owner is alerted in this transaction, marked so the dispute
        // timer does not alert again (it alerts on a later loss of the last reviewer); the phone
        // push follows the commit. The traders see `appealWaiting`.
        noReviewer = await syncNoReviewerAlert(client, next, now);
        return next;
      });
    } catch (err) {
      if (err instanceof DisputeRuleError) throw new ApiError(409, err.code === 'too-late' ? 'too-late' : 'wrong-state');
      throw err;
    }
    if (noReviewer) await pushOwnerAlert({ db: deps.db, push: req.server.push }, 'appeal-no-reviewer').catch(() => undefined);
    // Review S1 (lead call 12 Nov): a member who may appeal but not read the dispute (no Answer the
    // moderator box) gets no dispute view back: 204, nothing more than GET would give them.
    if (req.auth.memberId !== null && !hasAbility(req.auth.memberAbilities, 'disputes-answer')) return reply.code(204).send();
    return loadView(deps.db, row, side, req.auth.accountId, deps.clock());
  });
}
