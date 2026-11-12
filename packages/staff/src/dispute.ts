import {
  AFTER_REFUND_OUTCOMES,
  BAN_REASON_CODES,
  ESCROW_OUTCOMES,
  type AccountAction,
  type RulingOutcome,
} from './intent.js';
import { can, type StaffRole } from './roles.js';

/**
 * Disputes are settled within 48 hours (the hard deadline traders see as "ruling due by …"),
 * with a goal of 24 (Revision 2026-10-29, owner; replaces A2's 24 h). Appeals aim for 48 hours
 * like disputes. The first-reply time stays a setting (default 4 h).
 */
export const RULING_DEADLINE_H = 48;
export const RULING_GOAL_H = 24;
export const APPEAL_GOAL_H = 48;
/** A6: a seller ordered `seller-sends-xmr` has this long to send it and submit a tx proof. */
export const COMPLY_H = 24;

/**
 * Who sends an event. A staff actor's `role` must be the one the API loaded from `staff_members`
 * for THIS request (Task 4 `requireStaff`), never a copy cached in a session, cookie or token
 * (round-2 N2): the machine keeps no role in the dispute and checks `by.role` on every event, so a
 * demotion takes effect on the next request only if the caller loads it fresh.
 */
export type Actor =
  | { kind: 'staff'; id: string; role: StaffRole }
  | { kind: 'trader'; side: 'buyer' | 'seller' }
  | { kind: 'system' };

/**
 * - `open`: round 1, waiting for a ruling.
 * - `awaiting-approval`: a proposal needs a second person (either round).
 * - `published`: round 1 is ruled and acts at once (A1 dropped, 2026-10-29: the escrow ruling is
 *   executed now, a restitution lien is placed now); the 48-hour appeal window is open.
 * - `appealed`: round 2, waiting for an uninvolved reviewer's ruling.
 * - `final`: no appeal is possible any more, but round 1's payout has not been seen yet.
 * - `complying`: final, and the seller still owes the XMR of `seller-sends-xmr`.
 * - `closed`.
 */
export type DisputeStatus = 'open' | 'awaiting-approval' | 'published' | 'appealed' | 'final' | 'complying' | 'closed';

/** The dispute status as traders see it (Plan 3 Task 27's five; migration 108's original set). */
export type TraderDisputeStatus = 'open' | 'ruled' | 'appealed' | 'final' | 'closed';

/**
 * The one mapping from the machine's statuses to the traders' (lead decision 2026-10-30): a
 * proposal awaiting a second approval is not a ruling yet, and `complying` is final (no appeal is
 * possible; the seller still owes the XMR of `seller-sends-xmr`).
 */
export function traderStatus(s: DisputeStatus): TraderDisputeStatus {
  switch (s) {
    case 'awaiting-approval':
      return 'open';
    case 'published':
      return 'ruled';
    case 'complying':
      return 'final';
    default:
      return s;
  }
}

export interface RulingDraft {
  id: string;
  outcome: RulingOutcome;
  accountAction: AccountAction;
  proposer: string;
  approver: string | null;
  needsSecond: boolean;
}

/**
 * Round 1 as it stood when it was appealed. The whole ruling is kept: round 1 still executes after
 * an appeal (A1 dropped), so the executor and its verification (Tasks 13 and 14) read `round1`,
 * never `ruling`, once `round === 2`. `involved` is R37's list, frozen at the appeal.
 */
export interface Round1 extends RulingDraft {
  firstReplyAt: Date | null;
  involved: string[];
}

export interface Dispute {
  code: string;
  /** Migration 108 keys disputes on (code, seq): a re-escalation of the same trade is a new seq. */
  seq: number;
  /** `system`: opened by an escalation (110's reason `escalated`). */
  openedBy: 'buyer' | 'seller' | 'system';
  afterRefund: boolean;
  openedAt: Date;
  replyDueAt: Date;
  /** Round 1: opened + RULING_DEADLINE_H. Round 2: appealed + APPEAL_GOAL_H. */
  rulingDueAt: Date;
  assignee: string | null;
  firstReplyAt: Date | null;
  status: DisputeStatus;
  round: 1 | 2;
  /** USD value at the rate locked at escrow setup, and the large-trade limit snapshot at opening. */
  usdCents: bigint;
  limitUsdCents: bigint;
  /** The current round's ruling (null while none is proposed). */
  ruling: RulingDraft | null;
  round1: Round1 | null;
  /** When round 1 was published: the anchor of `appealEndsAt` (Task 24). */
  publishedAt: Date | null;
  appealEndsAt: Date | null;
  appealBy: 'buyer' | 'seller' | null;
  appealedAt: Date | null;
  complyBy: Date | null;
  /** When round 1's payout was seen (escrow disputes only). */
  executedAt: Date | null;
  /** When the seller's payment proof for `seller-sends-xmr` was accepted. */
  compliedAt: Date | null;
  /** Set when round 2 becomes final: true when it differs from round 1 ("Decision overruled"). */
  overturned: boolean | null;
  /** Staff ids with any log entry on the case (R37's "involved"). */
  seen: string[];
}

export type DisputeEvent =
  /**
   * `role` is the assignee's role, always required: the API loads it from the database, never
   * from the request. A self-assignment's role must equal the actor's.
   */
  | { type: 'assign'; staffId: string; role: StaffRole }
  | { type: 'reply' }
  | { type: 'propose'; ruling: Omit<RulingDraft, 'approver' | 'needsSecond'> }
  | { type: 'approve' }
  | { type: 'send-back' }
  /**
   * `involved`: the staff ids with an activity-log entry on the trade before this appeal's own
   * `appeal.opened` entry (`involvedIn(log, code, { beforeId })`, I3). They are added to `seen`
   * to make `round1.involved`, so a missed `markSeen` can only widen R37's list.
   */
  | { type: 'appeal'; involved: readonly string[] }
  | { type: 'window-closed' }
  | { type: 'executed' }
  | { type: 'complied' }
  | { type: 'close' };

export type DisputeRuleCode = 'wrong-state' | 'wrong-party' | 'too-late' | 'same-person' | 'not-eligible' | 'invalid-action';

/** The settings the machine reads (Task 8). */
export interface DisputeSettings {
  appealWindowH: number;
  firstResponseH: number;
}

export class DisputeRuleError extends Error {
  constructor(readonly code: DisputeRuleCode) {
    super(code);
    this.name = 'DisputeRuleError';
  }
}

const H = 3_600_000;
const addH = (d: Date, h: number) => new Date(d.getTime() + h * H);
const fail = (code: DisputeRuleCode): never => {
  throw new DisputeRuleError(code);
};

/** Task 8's bounds for the settings the machine reads. */
function checkHours(name: string, v: number, min: number, max: number): void {
  if (!Number.isFinite(v) || v < min || v > max) throw new RangeError(`${name} out of range`);
}

export function newDispute(a: {
  code: string;
  /** Defaults to 1. */
  seq?: number;
  openedBy: 'buyer' | 'seller' | 'system';
  afterRefund: boolean;
  usdCents: bigint;
  limitUsdCents: bigint;
  firstResponseH: number;
  now: Date;
}): Dispute {
  checkHours('firstResponseH', a.firstResponseH, 1, 72);
  if (!Number.isFinite(a.now.getTime())) throw new RangeError('invalid clock');
  const seq = a.seq ?? 1;
  if (!Number.isSafeInteger(seq) || seq < 1) throw new RangeError('seq out of range');
  return {
    code: a.code,
    seq,
    openedBy: a.openedBy,
    afterRefund: a.afterRefund,
    openedAt: new Date(a.now.getTime()),
    replyDueAt: addH(a.now, a.firstResponseH),
    rulingDueAt: addH(a.now, RULING_DEADLINE_H),
    assignee: null,
    firstReplyAt: null,
    status: 'open',
    round: 1,
    usdCents: a.usdCents,
    limitUsdCents: a.limitUsdCents,
    ruling: null,
    round1: null,
    publishedAt: null,
    appealEndsAt: null,
    appealBy: null,
    appealedAt: null,
    complyBy: null,
    executedAt: null,
    compliedAt: null,
    overturned: null,
    seen: [],
  };
}

/** Two-person rule: at or above the large-trade limit, or any ban. */
export function needsSecond(d: Dispute, _outcome: RulingOutcome, action: AccountAction): boolean {
  return d.usdCents >= d.limitUsdCents || action.kind !== 'none';
}

/** Adds a staff id to `seen` (the API calls this for every log entry on the case). */
export function markSeen(d: Dispute, staffId: string): Dispute {
  return d.seen.includes(staffId) ? d : { ...d, seen: [...d.seen, staffId] };
}

/**
 * A7: maintenance moves every deadline still running when it began (`since`: reply, ruling, appeal
 * window, comply-by) by the time spent in maintenance. A deadline at or before `since` had already
 * passed and stays where it was (its tick may simply not have run yet).
 */
export function shiftDeadlines(d: Dispute, since: Date, ms: number): Dispute {
  if (!Number.isFinite(ms) || ms < 0) throw new RangeError('shift out of range');
  const from = since.getTime();
  if (!Number.isFinite(from)) throw new RangeError('invalid clock');
  const sh = (x: Date) => (x.getTime() > from ? new Date(x.getTime() + ms) : x);
  return {
    ...d,
    replyDueAt: sh(d.replyDueAt),
    rulingDueAt: sh(d.rulingDueAt),
    appealEndsAt: d.appealEndsAt && sh(d.appealEndsAt),
    complyBy: d.complyBy && sh(d.complyBy),
  };
}

const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * M7: an account action as the machine accepts it. `none` carries nothing else (D-015: a freeze is
 * never a ruling's action, so `freeze` is refused here); a trade or site ban carries `until`
 * (null = permanent, else an exact ISO instant after `now`) and one of
 * `BAN_REASON_CODES`. Any other shape or key is refused.
 */
function validAction(a: unknown, now: Date): a is AccountAction {
  if (a === null || typeof a !== 'object' || Array.isArray(a)) return false;
  const o = a as Record<string, unknown>;
  const keys = Object.keys(o).sort().join(',');
  if (o.kind === 'none') return keys === 'kind';
  if (o.kind !== 'trade-ban' && o.kind !== 'site-ban') return false;
  if (keys !== 'kind,reasonCode,until') return false;
  if (!(BAN_REASON_CODES as readonly unknown[]).includes(o.reasonCode)) return false;
  if (o.until === null) return true;
  if (typeof o.until !== 'string' || !ISO_MS.test(o.until)) return false;
  const t = Date.parse(o.until);
  return Number.isFinite(t) && new Date(t).toISOString() === o.until && t > now.getTime();
}

/** The perm an approver needs for the action on top of `rulings.approve` (M7: tied to `can()`). */
const actionPerm = (a: AccountAction) => (a.kind === 'none' ? null : 'accounts.ban');

const SYSTEM_EVENTS: readonly DisputeEvent['type'][] = ['window-closed', 'executed', 'complied', 'close'];

const outcomeFits = (d: Dispute, o: RulingOutcome) =>
  (d.afterRefund ? (AFTER_REFUND_OUTCOMES as readonly string[]) : (ESCROW_OUTCOMES as readonly string[])).includes(o);

const isSeniorOrOwner = (role: StaffRole) => role === 'senior' || role === 'owner';
/** A second approver: a senior or the owner holding `rulings.approve` and the action's own perm. */
const canApprove = (role: StaffRole, a: AccountAction) => {
  const perm = actionPerm(a);
  return isSeniorOrOwner(role) && can(role, 'rulings.approve') && (perm === null || can(role, perm));
};

/** Round 2 (R37): only a senior moderator or the owner with no log entry on round 1. */
function eligibleForAppeal(d: Dispute, id: string, role: StaffRole): boolean {
  return isSeniorOrOwner(role) && !(d.round1?.involved.includes(id) ?? false);
}

/** The outcome currently in force (round 1's while an appeal is pending). */
function outcomeInForce(d: Dispute): RulingOutcome | null {
  if (d.status === 'published' || d.status === 'complying' || d.status === 'final' || d.status === 'closed') {
    return d.ruling?.outcome ?? null;
  }
  return d.round1?.outcome ?? null;
}

/**
 * Owner g63 (7 Nov): who pays X2F's 1% after a moderator's ruling.
 * - `poster-pays`: the trade completes: a ruling that moves it forward (`release-to-buyer`), an
 *   appeal that upholds completion, or a lien (`seller-sends-xmr`, or an appeal that overturns a
 *   ruling whose coins already moved, since the coins move at the ruling: owner Q37).
 * - `none`: a full reversal, all funds back to the original parties (`refund-to-seller`,
 *   `seller-returns-fiat`, `no-action` after a refund). The site pays the moderator itself.
 * - `waits`: an appeal is pending; the fee follows its outcome.
 * - null: no ruling has been published yet.
 * `seller-returns-fiat` also puts a lien on the seller, but everything goes back where it came from:
 * read as a reversal here (no fee); the owner is asked to confirm.
 * Round 1's coins move with its own set (@x2f/trade `payoutsFor`: `dispute-buyer` pays the fee,
 * `dispute-seller` none); a fee this rule charges that no escrow output carried is owed by the
 * poster: in their lien when they are its debtor (D-063), else as an owed fee (D-062), both from
 * `lienSteps` (lien.ts) once the ruling is final.
 */
export type RulingFee = 'poster-pays' | 'none' | 'waits';

const OUTCOME_FEE: Record<RulingOutcome, Exclude<RulingFee, 'waits'>> = {
  'release-to-buyer': 'poster-pays',
  'refund-to-seller': 'none',
  'seller-sends-xmr': 'poster-pays',
  'seller-returns-fiat': 'none',
  'no-action': 'none',
};

export function rulingFee(d: Pick<Dispute, 'status' | 'round' | 'ruling' | 'round1'>): RulingFee | null {
  if (d.round === 2) {
    if (d.status === 'appealed' || d.status === 'awaiting-approval') return 'waits';
    const first = d.round1?.outcome;
    const final = d.ruling?.outcome;
    if (first === undefined || final === undefined) return null;
    // Escrow coins moved under round 1 and the appeal changed where they belong: a lien.
    const moved = (ESCROW_OUTCOMES as readonly string[]).includes(first);
    if (moved && final !== first) return 'poster-pays';
    return OUTCOME_FEE[final];
  }
  if (d.status === 'open' || d.status === 'awaiting-approval' || d.ruling === null) return null;
  return OUTCOME_FEE[d.ruling.outcome];
}

/** Round 1 published: it acts now; the appeal window runs from now. */
function publishRound1(d: Dispute, now: Date, s: DisputeSettings): Dispute {
  return {
    ...d,
    status: 'published',
    publishedAt: new Date(now.getTime()),
    appealEndsAt: addH(now, s.appealWindowH),
    complyBy: d.ruling?.outcome === 'seller-sends-xmr' ? addH(now, COMPLY_H) : null,
  };
}

/** No appeal is possible any more: decide what is still owed before the case closes. */
function resolveFinal(d: Dispute, now: Date): Dispute {
  const outcome = d.ruling?.outcome;
  let next: Dispute = { ...d, status: 'final' };
  if (d.round === 2) {
    next.overturned = outcome !== d.round1?.outcome;
    // Round 2 sets a fresh comply time only when it orders the payment (Decision stands or not).
    next.complyBy = outcome === 'seller-sends-xmr' ? addH(now, COMPLY_H) : null;
  }
  if (!d.afterRefund) {
    // The coins move under round 1 at once and never move again (A1 dropped); wait to see it.
    if (next.executedAt !== null) next = { ...next, status: 'closed' };
  } else if (outcome === 'seller-sends-xmr') {
    next = { ...next, status: next.compliedAt !== null ? 'closed' : 'complying' };
  } else {
    next = { ...next, status: 'closed', complyBy: null };
  }
  return next;
}

/**
 * Applies one event. Pure: it returns a new Dispute or throws DisputeRuleError, and never changes
 * its input. Traders may send only `appeal`; the system only `window-closed`, `executed`,
 * `complied` and `close`; staff the rest, each needing `disputes.handle`. Every accepted staff
 * event adds the actor (and an assignee) to `seen`.
 */
export function applyDispute(
  d: Dispute,
  e: DisputeEvent,
  by: Actor,
  now: Date,
  s: DisputeSettings,
): Dispute {
  if (!Number.isFinite(now.getTime())) throw new RangeError('invalid clock');
  checkHours('appealWindowH', s.appealWindowH, 12, 168);
  checkHours('firstResponseH', s.firstResponseH, 1, 72);

  if (by.kind === 'trader') {
    if (e.type !== 'appeal') return fail('wrong-party');
    if (d.status !== 'published' || d.round !== 1 || d.ruling === null || d.appealEndsAt === null) {
      return fail('wrong-state');
    }
    if (now.getTime() >= d.appealEndsAt.getTime()) return fail('too-late');
    if (!Array.isArray(e.involved) || !e.involved.every((x) => typeof x === 'string')) {
      throw new TypeError('appeal: involved must be a list of staff ids');
    }
    const seen = e.involved.reduce(markSeen, d).seen;
    return {
      ...d,
      status: 'appealed',
      round: 2,
      seen,
      round1: {
        ...d.ruling,
        accountAction: structuredClone(d.ruling.accountAction),
        firstReplyAt: d.firstReplyAt,
        involved: [...seen],
      },
      ruling: null,
      assignee: null,
      appealBy: by.side,
      appealedAt: new Date(now.getTime()),
      // Round 2 has its own first-reply and ruling deadlines (M4).
      firstReplyAt: null,
      replyDueAt: addH(now, s.firstResponseH),
      rulingDueAt: addH(now, APPEAL_GOAL_H),
    };
  }

  if (by.kind === 'system') {
    if (!SYSTEM_EVENTS.includes(e.type)) return fail('wrong-party');
    switch (e.type) {
      case 'window-closed':
        if (d.status !== 'published' || d.appealEndsAt === null) return fail('wrong-state');
        if (now.getTime() < d.appealEndsAt.getTime()) return fail('wrong-state');
        return resolveFinal(d, now);
      case 'executed': {
        if (d.afterRefund || d.publishedAt === null || d.executedAt !== null || d.status === 'closed') {
          return fail('wrong-state');
        }
        const next = { ...d, executedAt: new Date(now.getTime()) };
        return d.status === 'final' ? { ...next, status: 'closed' } : next;
      }
      case 'complied': {
        if (!d.afterRefund || d.compliedAt !== null || outcomeInForce(d) !== 'seller-sends-xmr') return fail('wrong-state');
        if (d.status === 'open' || d.status === 'closed' || d.status === 'final') return fail('wrong-state');
        const next = { ...d, compliedAt: new Date(now.getTime()) };
        return d.status === 'complying' ? { ...next, status: 'closed' } : next;
      }
      default:
        // `close`: a final case whose payout or payment is settled otherwise (e.g. Plan 3's
        // `settled`, or a senior's suspension of a seller who will not comply).
        if (d.status !== 'final' && d.status !== 'complying') return fail('wrong-state');
        return { ...d, status: 'closed' };
    }
  }

  // Staff.
  if (SYSTEM_EVENTS.includes(e.type) || e.type === 'appeal') return fail('wrong-party');
  if (!can(by.role, 'disputes.handle')) return fail('wrong-party');
  // I2 (R37): nobody involved in round 1 takes any part in the appeal: not a reply, not an
  // assignment of someone else, not a send-back. Task 11's chat and message routes apply the same.
  if (d.round === 2 && d.round1 !== null && d.round1.involved.includes(by.id)) return fail('not-eligible');
  const seenBy = (x: Dispute, ...ids: string[]) => ids.reduce(markSeen, x);

  switch (e.type) {
    case 'assign': {
      if (d.status !== 'open' && d.status !== 'appealed') return fail('wrong-state');
      const self = e.staffId === by.id;
      const role = e.role;
      if (self && role !== by.role) return fail('wrong-party');
      if (!self && !isSeniorOrOwner(by.role)) return fail('wrong-party');
      if (!can(role, 'disputes.handle')) return fail('wrong-party');
      if (d.assignee !== null && !isSeniorOrOwner(by.role)) return fail('wrong-state');
      if (d.round === 2 && !eligibleForAppeal(d, e.staffId, role)) return fail('not-eligible');
      return seenBy({ ...d, assignee: e.staffId }, by.id, e.staffId);
    }
    case 'reply': {
      if (d.status === 'closed') return fail('wrong-state');
      if (d.assignee !== by.id && !isSeniorOrOwner(by.role)) return fail('wrong-party');
      return seenBy({ ...d, firstReplyAt: d.firstReplyAt ?? new Date(now.getTime()) }, by.id);
    }
    case 'propose': {
      const expected = d.round === 1 ? 'open' : 'appealed';
      if (d.status !== expected) return fail('wrong-state');
      if (d.assignee !== by.id || e.ruling.proposer !== by.id) return fail('wrong-party');
      if (!outcomeFits(d, e.ruling.outcome)) return fail('wrong-state');
      if (!validAction(e.ruling.accountAction, now)) return fail('invalid-action');
      if (d.round === 2 && !eligibleForAppeal(d, by.id, by.role)) return fail('not-eligible');
      const second = needsSecond(d, e.ruling.outcome, e.ruling.accountAction);
      const ruling: RulingDraft = {
        id: e.ruling.id,
        outcome: e.ruling.outcome,
        accountAction: structuredClone(e.ruling.accountAction),
        proposer: by.id,
        approver: null,
        needsSecond: second,
      };
      const next = seenBy({ ...d, ruling }, by.id);
      if (second) return { ...next, status: 'awaiting-approval' };
      return d.round === 1 ? publishRound1(next, now, s) : resolveFinal(next, now);
    }
    case 'approve':
    case 'send-back': {
      if (d.status !== 'awaiting-approval' || d.ruling === null) return fail('wrong-state');
      // L1 (freeze review 12 Nov): the stored draft's action is checked again, so a draft stored
      // before a rule changed (D-015: no freeze) or a ban whose end has passed is never approved.
      // Sending it back stays possible.
      if (e.type === 'approve' && !validAction(d.ruling.accountAction, now)) return fail('invalid-action');
      if (!canApprove(by.role, d.ruling.accountAction)) return fail('wrong-party');
      if (d.ruling.proposer === by.id) return fail('same-person');
      if (d.round === 2 && !eligibleForAppeal(d, by.id, by.role)) return fail('not-eligible');
      if (e.type === 'send-back') {
        return seenBy({ ...d, ruling: null, status: d.round === 1 ? 'open' : 'appealed' }, by.id);
      }
      const next = seenBy({ ...d, ruling: { ...d.ruling, approver: by.id } }, by.id);
      return d.round === 1 ? publishRound1(next, now, s) : resolveFinal(next, now);
    }
  }
  return fail('wrong-party');
}
