import { APPEAL_GOAL_H, RULING_DEADLINE_H, RULING_GOAL_H } from './dispute.js';

/**
 * Plan 4 Task 20: the moderator performance maths (spec 6.6 "Moderator performance", owner only),
 * with Revision 2026-10-29's shares settled within the 24-hour goal and the 48-hour deadline and
 * Revision 2026-10-29c's 48-hour appeal goal. Pure; the API builds the rows from the disputes,
 * their published rulings, the appeals and the activity log (apps/api/src/staff/performance.ts).
 *
 * A row holds staff ids and times only: never a trade code, a trader or anything a trader wrote,
 * so nothing here (or in the answers built from it) identifies a trader.
 */
export interface CaseRow {
  /** 1: the dispute itself; 2: its appeal, reviewed by someone uninvolved (R37). */
  round: 1 | 2;
  /** When the round began: the dispute's opening (round 1) or the appeal's filing (round 2). */
  openedAt: Date;
  /** The round's first-reply deadline (the first-response setting from its opening). */
  replyDueAt: Date;
  firstReplyAt: Date | null;
  /** The staff member who sent the round's first reply (the activity log's `chat.message-sent`). */
  firstReplyBy: string | null;
  /** Who proposed the round's published ruling; null while none is published. */
  proposer: string | null;
  proposedAt: Date | null;
  /** When the ruling was published (a second approval can come after the proposal). */
  ruledAt: Date | null;
  /** Round 1 only: an appeal overruled it ("Decision overruled"). */
  overturned: boolean;
  assignee: string | null;
  /** Still waiting for its ruling. */
  open: boolean;
}

export interface PersonMetrics {
  /** Round-1 rulings they proposed, published in the period. */
  cases: number;
  /** Typical (median) minutes from the round's opening to their first reply. */
  firstReplyMin: number | null;
  /** Typical minutes from the dispute's opening to their proposal. */
  rulingMin: number | null;
  /** Of `cases`, how many an appeal overruled. */
  overturned: number;
  /** Of the rounds they replied to first, the share replied to by the deadline (whole %, floored). */
  withinDeadlinePct: number | null;
  /** Cases assigned to them still waiting for a ruling (now, whatever the period). */
  open: number;
  /** `cases` not overturned (a count only: pay is Task 33's ledger). */
  payableCases: number;
  /** Of `cases`, published within RULING_GOAL_H (24 h) of opening. */
  settledWithinGoalPct: number | null;
  /** Of `cases`, published within RULING_DEADLINE_H (48 h) of opening. */
  settledWithinDeadlinePct: number | null;
  /** Appeals (round 2) they decided, published in the period. */
  appeals: number;
  /** Of `appeals`, decided within APPEAL_GOAL_H (48 h) of the appeal. */
  appealsWithinGoalPct: number | null;
}

export interface WeekMetrics {
  /** The week's Monday (UTC) as the boards write it: "Aug 24". */
  weekOf: string;
  /** The Monday itself, 00:00 UTC. */
  start: Date;
  cases: number;
  /** Null for a week with no first reply: the chart's line breaks there. */
  firstReplyMin: number | null;
}

export const PERIODS = ['30d', '90d', 'all'] as const;
export type Period = (typeof PERIODS)[number];
/** The Show chart panel's weeks. */
export const CHART_WEEKS = 8;

const MIN = 60_000;
const H = 60 * MIN;
const DAY = 24 * H;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/**
 * The middle value, floored to whole minutes; for an even count the mean of the two middle values,
 * floored; null for an empty list. Does not reorder `xs`.
 */
export function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  const v = s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
  return Math.floor(v);
}

/** The period's first instant: 30 or 90 days back from `now`; null (no start) for all time. */
export function periodStart(p: Period, now: Date): Date | null {
  if (p === 'all') return null;
  return new Date(now.getTime() - (p === '30d' ? 30 : 90) * DAY);
}

/** Monday 00:00 UTC of the week holding `d`. */
export function weekStart(d: Date): Date {
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const back = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - back * DAY);
}

const weekLabel = (d: Date) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
const minutes = (from: Date, to: Date) => (to.getTime() - from.getTime()) / MIN;
const pct = (n: number, of: number) => (of === 0 ? null : Math.floor((n * 100) / of));
const inRange = (t: Date | null, from: Date | null, to: Date): t is Date =>
  t !== null && (from === null || t.getTime() >= from.getTime()) && t.getTime() <= to.getTime();

/** The rounds whose first reply `staffId` sent, at a time in the range. */
const repliesBy = (rows: readonly CaseRow[], staffId: string, from: Date | null, to: Date) =>
  rows.filter((r) => r.firstReplyBy === staffId && inRange(r.firstReplyAt, from, to));

/** The round-1 rulings `staffId` proposed, published in the range. */
const casesBy = (rows: readonly CaseRow[], staffId: string, from: Date | null, to: Date) =>
  rows.filter((r) => r.round === 1 && r.proposer === staffId && inRange(r.ruledAt, from, to));

/** One staff member's figures for the period `from` (null: all time) to `to`. */
export function personMetrics(rows: readonly CaseRow[], staffId: string, from: Date | null, to: Date): PersonMetrics {
  const replies = repliesBy(rows, staffId, from, to);
  const cases = casesBy(rows, staffId, from, to);
  const appeals = rows.filter((r) => r.round === 2 && r.proposer === staffId && inRange(r.ruledAt, from, to));
  const overturned = cases.filter((r) => r.overturned).length;
  const settledIn = (h: number) => cases.filter((r) => r.ruledAt!.getTime() - r.openedAt.getTime() <= h * H).length;
  return {
    cases: cases.length,
    firstReplyMin: median(replies.map((r) => minutes(r.openedAt, r.firstReplyAt!))),
    rulingMin: median(cases.map((r) => minutes(r.openedAt, r.proposedAt ?? r.ruledAt!))),
    overturned,
    withinDeadlinePct: pct(replies.filter((r) => r.firstReplyAt!.getTime() <= r.replyDueAt.getTime()).length, replies.length),
    open: rows.filter((r) => r.open && r.assignee === staffId).length,
    payableCases: cases.length - overturned,
    settledWithinGoalPct: pct(settledIn(RULING_GOAL_H), cases.length),
    settledWithinDeadlinePct: pct(settledIn(RULING_DEADLINE_H), cases.length),
    appeals: appeals.length,
    appealsWithinGoalPct: pct(appeals.filter((r) => r.ruledAt!.getTime() - r.openedAt.getTime() <= APPEAL_GOAL_H * H).length, appeals.length),
  };
}

/** The first instant of the chart's 8 weeks: the Monday 7 weeks before this week's. */
export function chartStart(now: Date): Date {
  return new Date(weekStart(now).getTime() - (CHART_WEEKS - 1) * 7 * DAY);
}

/**
 * The 8 most recent weeks (this week last, oldest first): each week's cases (by publication) and
 * typical first reply (by when it was sent; null for a week with none).
 */
export function weekly(rows: readonly CaseRow[], staffId: string, now: Date): WeekMetrics[] {
  const first = chartStart(now).getTime();
  const out: WeekMetrics[] = [];
  for (let i = 0; i < CHART_WEEKS; i++) {
    const start = new Date(first + i * 7 * DAY);
    // The week's last instant (inRange is inclusive at `to`).
    const end = new Date(start.getTime() + 7 * DAY - 1);
    out.push({
      weekOf: weekLabel(start),
      start,
      cases: casesBy(rows, staffId, start, end).length,
      firstReplyMin: median(repliesBy(rows, staffId, start, end).map((r) => minutes(r.openedAt, r.firstReplyAt!))),
    });
  }
  return out;
}
