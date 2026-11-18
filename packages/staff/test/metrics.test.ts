// Plan 4 Task 20: the moderator performance maths (spec 6.6 "Moderator performance", owner only).
// Revisions 2026-10-29 and 2026-10-29c add the shares settled within 24 and 48 hours
// (RULING_GOAL_H, RULING_DEADLINE_H) and the appeals' 48-hour goal (APPEAL_GOAL_H).
import { describe, expect, it } from 'vitest';
import {
  median,
  periodStart,
  personMetrics,
  weekly,
  weekStart,
  type CaseRow,
} from '../src/index.js';

const MIN = 60_000;
const H = 60 * MIN;
const D = 24 * H;
/** A Wednesday. */
const NOW = new Date('2026-10-14T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);

/** A round-1 case `who` replied to first after `replyMin` and ruled after `rulingMin`, opened `openedAgo` before NOW. */
function ruled(who: string, o: { openedAgo: number; replyMin?: number | null; rulingMin: number; overturned?: boolean; dueMin?: number; publishLagMin?: number }): CaseRow {
  const openedAt = ago(o.openedAgo);
  const replyMin = o.replyMin === undefined ? 30 : o.replyMin;
  const proposedAt = plus(openedAt, o.rulingMin * MIN);
  return {
    round: 1,
    openedAt,
    replyDueAt: plus(openedAt, (o.dueMin ?? 240) * MIN),
    firstReplyAt: replyMin === null ? null : plus(openedAt, replyMin * MIN),
    firstReplyBy: replyMin === null ? null : who,
    proposer: who,
    proposedAt,
    ruledAt: plus(proposedAt, (o.publishLagMin ?? 0) * MIN),
    overturned: o.overturned ?? false,
    assignee: who,
    open: false,
  };
}

function openCase(who: string | null, openedAgo: number): CaseRow {
  const openedAt = ago(openedAgo);
  return {
    round: 1, openedAt, replyDueAt: plus(openedAt, 4 * H), firstReplyAt: null, firstReplyBy: null,
    proposer: null, proposedAt: null, ruledAt: null, overturned: false, assignee: who, open: true,
  };
}

describe('median', () => {
  it('is the middle value, the floored mean of the two middle values for an even count, and null for none', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2);
    expect(median([])).toBeNull();
    expect(median([7])).toBe(7);
    expect(median([10, 11])).toBe(10);
    // Whole minutes: a fractional middle value is floored too.
    expect(median([2.9])).toBe(2);
  });

  it('does not reorder the caller\'s list', () => {
    const xs = [3, 1, 2];
    median(xs);
    expect(xs).toEqual([3, 1, 2]);
  });
});

describe('personMetrics', () => {
  it('a case overturned on appeal counts in overturned and not in payableCases', () => {
    const rows = [
      ruled('dmitri', { openedAgo: 5 * D, rulingMin: 120 }),
      ruled('dmitri', { openedAgo: 4 * D, rulingMin: 200, overturned: true }),
      ruled('dmitri', { openedAgo: 3 * D, rulingMin: 300 }),
    ];
    const m = personMetrics(rows, 'dmitri', ago(30 * D), NOW);
    expect(m.cases).toBe(3);
    expect(m.overturned).toBe(1);
    expect(m.payableCases).toBe(2);
  });

  it('the typical first reply and time to ruling are medians in whole minutes, from the round\'s opening', () => {
    const rows = [
      ruled('dmitri', { openedAgo: 5 * D, replyMin: 20, rulingMin: 100 }),
      ruled('dmitri', { openedAgo: 4 * D, replyMin: 45, rulingMin: 400 }),
      ruled('dmitri', { openedAgo: 3 * D, replyMin: 90, rulingMin: 130 }),
      ruled('dmitri', { openedAgo: 2 * D, replyMin: 31, rulingMin: 125 }),
    ];
    const m = personMetrics(rows, 'dmitri', null, NOW);
    expect(m.firstReplyMin).toBe(38); // (31 + 45) / 2
    expect(m.rulingMin).toBe(127); // (125 + 130) / 2, floored
  });

  it('time to ruling is to the proposal, not to a second approval that published it later', () => {
    const m = personMetrics([ruled('sarah', { openedAgo: D, rulingMin: 60, publishLagMin: 600 })], 'sarah', null, NOW);
    expect(m.rulingMin).toBe(60);
  });

  it('replied within the deadline: the first reply at or before the round\'s reply deadline (the first-response setting)', () => {
    const rows = [
      ruled('dmitri', { openedAgo: 5 * D, replyMin: 240, dueMin: 240, rulingMin: 300 }), // exactly at: within
      ruled('dmitri', { openedAgo: 4 * D, replyMin: 241, dueMin: 240, rulingMin: 300 }), // one minute late
      ruled('dmitri', { openedAgo: 3 * D, replyMin: 100, dueMin: 120, rulingMin: 300 }),
    ];
    expect(personMetrics(rows, 'dmitri', null, NOW).withinDeadlinePct).toBe(66); // 2 of 3, floored
  });

  it('first replies count for whoever sent them, even on a case someone else ruled', () => {
    const r = { ...ruled('sarah', { openedAgo: 2 * D, rulingMin: 300 }), firstReplyBy: 'dmitri', firstReplyAt: plus(ago(2 * D), 50 * MIN) };
    const dmitri = personMetrics([r], 'dmitri', null, NOW);
    expect(dmitri.cases).toBe(0);
    expect(dmitri.firstReplyMin).toBe(50);
    expect(dmitri.withinDeadlinePct).toBe(100);
    const sarah = personMetrics([r], 'sarah', null, NOW);
    expect(sarah.cases).toBe(1);
    expect(sarah.firstReplyMin).toBeNull();
    expect(sarah.withinDeadlinePct).toBeNull();
  });

  it('the period counts rulings by when they were published, and replies by when they were sent', () => {
    const rows = [
      ruled('dmitri', { openedAgo: 40 * D, replyMin: 10, rulingMin: 60 }),
      ruled('dmitri', { openedAgo: 10 * D, replyMin: 70, rulingMin: 60 }),
    ];
    const m30 = personMetrics(rows, 'dmitri', periodStart('30d', NOW), NOW);
    expect(m30.cases).toBe(1);
    expect(m30.firstReplyMin).toBe(70);
    const all = personMetrics(rows, 'dmitri', periodStart('all', NOW), NOW);
    expect(all.cases).toBe(2);
  });

  it('open now: cases still waiting for a ruling assigned to them, whatever the period', () => {
    const rows = [openCase('dmitri', 200 * D), openCase('dmitri', H), openCase('sarah', H), openCase(null, H)];
    expect(personMetrics(rows, 'dmitri', periodStart('30d', NOW), NOW).open).toBe(2);
  });

  it('settled within the 24-hour goal and the 48-hour deadline, from opening to publication', () => {
    const rows = [
      ruled('dmitri', { openedAgo: 9 * D, rulingMin: 10 * 60 }),
      ruled('dmitri', { openedAgo: 8 * D, rulingMin: 24 * 60 }), // exactly 24 h: within the goal
      ruled('dmitri', { openedAgo: 7 * D, rulingMin: 30 * 60 }),
      ruled('dmitri', { openedAgo: 6 * D, rulingMin: 47 * 60, publishLagMin: 120 }), // published at 49 h
    ];
    const m = personMetrics(rows, 'dmitri', null, NOW);
    expect(m.settledWithinGoalPct).toBe(50);
    expect(m.settledWithinDeadlinePct).toBe(75);
  });

  it('an appeal they decided is an appeal, not a case: it is never overturned or payable, and has its own 48-hour goal', () => {
    const appealedAt = ago(5 * D);
    const appeal = (rulingH: number): CaseRow => ({
      round: 2, openedAt: appealedAt, replyDueAt: plus(appealedAt, 4 * H), firstReplyAt: plus(appealedAt, H), firstReplyBy: 'sarah',
      proposer: 'sarah', proposedAt: plus(appealedAt, rulingH * H), ruledAt: plus(appealedAt, rulingH * H), overturned: false, assignee: 'sarah', open: false,
    });
    const m = personMetrics([appeal(10), appeal(60)], 'sarah', null, NOW);
    expect(m.cases).toBe(0);
    expect(m.payableCases).toBe(0);
    expect(m.rulingMin).toBeNull();
    expect(m.appeals).toBe(2);
    expect(m.appealsWithinGoalPct).toBe(50);
    // The appeal round's own first reply is a reply like any other.
    expect(m.firstReplyMin).toBe(60);
  });

  it('empty: nobody\'s cases give zero counts and null typical times and shares (never 0 min or 0%)', () => {
    const m = personMetrics([ruled('sarah', { openedAgo: D, rulingMin: 60 })], 'dmitri', periodStart('90d', NOW), NOW);
    expect(m).toEqual({
      cases: 0,
      firstReplyMin: null,
      rulingMin: null,
      overturned: 0,
      withinDeadlinePct: null,
      open: 0,
      payableCases: 0,
      settledWithinGoalPct: null,
      settledWithinDeadlinePct: null,
      appeals: 0,
      appealsWithinGoalPct: null,
    });
    expect(personMetrics([], 'dmitri', null, NOW).cases).toBe(0);
  });
});

describe('periodStart', () => {
  it('30 and 90 days back from now; all time has no start', () => {
    expect(periodStart('30d', NOW)).toEqual(ago(30 * D));
    expect(periodStart('90d', NOW)).toEqual(ago(90 * D));
    expect(periodStart('all', NOW)).toBeNull();
  });
});

describe('weekly', () => {
  it('weeks start on Monday, UTC', () => {
    expect(weekStart(NOW).toISOString()).toBe('2026-10-12T00:00:00.000Z');
    expect(weekStart(new Date('2026-10-12T00:00:00.000Z')).toISOString()).toBe('2026-10-12T00:00:00.000Z');
    expect(weekStart(new Date('2026-10-11T23:59:59.999Z')).toISOString()).toBe('2026-10-05T00:00:00.000Z');
  });

  it('gives the 8 most recent weeks, oldest first, labelled by their Monday as "Aug 24"', () => {
    const w = weekly([], 'dmitri', NOW);
    expect(w.map((x) => x.weekOf)).toEqual(['Aug 24', 'Aug 31', 'Sep 7', 'Sep 14', 'Sep 21', 'Sep 28', 'Oct 5', 'Oct 12']);
    expect(w.every((x) => x.cases === 0 && x.firstReplyMin === null)).toBe(true);
  });

  it('counts each week\'s cases by publication and its typical first reply by when it was sent', () => {
    const mon = new Date('2026-10-05T09:00:00.000Z'); // the week of Oct 5
    const rows: CaseRow[] = [
      { ...ruled('dmitri', { openedAgo: 0, rulingMin: 60 }), openedAt: mon, firstReplyAt: plus(mon, 20 * MIN), proposedAt: plus(mon, H), ruledAt: plus(mon, H), replyDueAt: plus(mon, 4 * H) },
      { ...ruled('dmitri', { openedAgo: 0, rulingMin: 60 }), openedAt: mon, firstReplyAt: plus(mon, 40 * MIN), proposedAt: plus(mon, H), ruledAt: plus(mon, H), replyDueAt: plus(mon, 4 * H) },
      // Opened on Sunday of the week before, replied to and ruled in the week of Oct 5.
      { ...ruled('dmitri', { openedAgo: 0, rulingMin: 60 }), openedAt: plus(mon, -2 * D), firstReplyAt: plus(mon, -2 * D + 3 * D), proposedAt: plus(mon, D), ruledAt: plus(mon, D), replyDueAt: plus(mon, 0) },
    ];
    const w = weekly(rows, 'dmitri', NOW);
    const oct5 = w.find((x) => x.weekOf === 'Oct 5')!;
    expect(oct5.cases).toBe(3);
    expect(oct5.firstReplyMin).toBe(40); // 20, 40, 72 h
    expect(w.find((x) => x.weekOf === 'Sep 28')!.cases).toBe(0);
  });

  it('a week with no replies has firstReplyMin null (the line breaks there), never 0', () => {
    const r = ruled('dmitri', { openedAgo: 9 * D, replyMin: 30, rulingMin: 60 }); // replied in the week of Oct 5
    const w = weekly([r], 'dmitri', NOW);
    const withReply = w.filter((x) => x.firstReplyMin !== null);
    expect(withReply).toHaveLength(1);
    expect(withReply[0]!.firstReplyMin).toBe(30);
    expect(w.filter((x) => x.firstReplyMin === null)).toHaveLength(7);
    expect(w.some((x) => x.firstReplyMin === 0)).toBe(false);
  });

  it('leaves out anything older than the 8 weeks and other people\'s work', () => {
    const rows = [ruled('dmitri', { openedAgo: 70 * D, rulingMin: 60 }), ruled('sarah', { openedAgo: D, rulingMin: 60 })];
    expect(weekly(rows, 'dmitri', NOW).reduce((n, x) => n + x.cases, 0)).toBe(0);
  });
});
