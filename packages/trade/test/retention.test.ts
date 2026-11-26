// Plan 7 Task 1: the one retention rule (owner 2026-10-29, R36; the 90 days from the dispute
// closing, owner p11-11, 9 Nov 2026). A trade with no dispute self-destructs 30 days after it
// closes; one that had a dispute, 90 days after its last dispute closes; never while a dispute or
// appeal is open, never while the trade is open, and never while the moderation watch still runs.
import { describe, expect, it } from 'vitest';
import {
  CHAT_AFTER_CLOSE_DAYS,
  CHAT_AFTER_DISPUTE_DAYS,
  DISPUTE_KEEP_DAYS,
  TIMERS,
  TRADE_KEEP_DAYS,
  chatPurgeDue,
  refundDisputeWindowEndsAt,
  tradeDeleteAt,
  tradeDeleteDue,
  type RetentionFacts,
} from '../src/index.js';

const DAY = 86_400_000;
const T0 = new Date('2026-11-01T12:00:00.000Z');
const at = (days: number, ms = 0): Date => new Date(T0.getTime() + days * DAY + ms);

const released = (over: Partial<RetentionFacts> = {}): RetentionFacts => ({
  closedAt: T0,
  disputed: false,
  disputeOpen: false,
  disputeClosedAt: null,
  refundDisputeWindowEndsAt: null,
  awaitingAction: false,
  watchEndsAt: null,
  ...over,
});

describe('the keep times', () => {
  it('are 30 and 90 days, the same numbers the chat purge uses', () => {
    expect(TRADE_KEEP_DAYS).toBe(30);
    expect(DISPUTE_KEEP_DAYS).toBe(90);
    expect(TRADE_KEEP_DAYS).toBe(CHAT_AFTER_CLOSE_DAYS);
    expect(DISPUTE_KEEP_DAYS).toBe(CHAT_AFTER_DISPUTE_DAYS);
  });
});

describe('tradeDeleteAt', () => {
  it('an open trade has no date', () => {
    expect(tradeDeleteAt(released({ closedAt: null }))).toBeNull();
  });

  it('owner 26 Nov 2026: an unpaid lien leaves no date; an ended one keeps it 90 days after it ended', () => {
    expect(tradeDeleteAt(released({ lienOpen: true }))).toBeNull();
    expect(tradeDeleteAt(released({ lienOpen: false, lienEndedAt: at(200) }))).toEqual(at(200 + DISPUTE_KEEP_DAYS));
    expect(tradeDeleteAt(released({ lienOpen: false, lienEndedAt: at(-200) }))).toEqual(at(TRADE_KEEP_DAYS));
    expect(tradeDeleteAt(released({ lienEndedAt: new Date(Number.NaN) }))).toBeNull();
  });

  it('a trade with no dispute: 30 days after it closed', () => {
    expect(tradeDeleteAt(released())).toEqual(at(30));
  });

  it('a dispute opened inside the 30 days moves it to 90 days after the dispute closes', () => {
    // Closed at T0, disputed after the refund on day 1, the dispute closed on day 29.
    const f = released({ disputed: true, disputeClosedAt: at(29) });
    expect(tradeDeleteAt(f)).toEqual(at(29 + 90));
  });

  it('the 90 days count from the later of the dispute close and the trade close', () => {
    // A dispute that closed before the trade did (a ruling's payout landing later).
    expect(tradeDeleteAt(released({ closedAt: at(5), disputed: true, disputeClosedAt: at(2) }))).toEqual(at(95));
  });

  it('no date while a dispute or its appeal is still open', () => {
    expect(tradeDeleteAt(released({ disputed: true, disputeOpen: true, disputeClosedAt: null }))).toBeNull();
    // An earlier dispute closed, a later one (a system escalation) still open.
    expect(tradeDeleteAt(released({ disputed: true, disputeOpen: true, disputeClosedAt: at(3) }))).toBeNull();
  });

  it('a disputed trade with no dispute close time is kept with no date (a corrupt row is never a reason to delete)', () => {
    expect(tradeDeleteAt(released({ disputed: true, disputeClosedAt: null }))).toBeNull();
  });

  it('a buyer cancel still waiting for the seller to confirm has no date', () => {
    expect(tradeDeleteAt(released({ awaitingAction: true }))).toBeNull();
  });

  it('never before the window to dispute after a refund has closed', () => {
    expect(tradeDeleteAt(released({ refundDisputeWindowEndsAt: at(40) }))).toEqual(at(40));
    expect(tradeDeleteAt(released({ refundDisputeWindowEndsAt: at(2) }))).toEqual(at(30));
  });

  it('any invalid date keeps the trade with no date', () => {
    const bad = new Date(Number.NaN);
    expect(tradeDeleteAt(released({ closedAt: bad }))).toBeNull();
    expect(tradeDeleteAt(released({ disputed: true, disputeClosedAt: bad }))).toBeNull();
    expect(tradeDeleteAt(released({ refundDisputeWindowEndsAt: bad }))).toBeNull();
    expect(tradeDeleteAt(released({ watchEndsAt: bad }))).toBeNull();
  });
});

describe('tradeDeleteDue', () => {
  it('a released trade is due after close + 30 days, not 1 ms before or at the instant', () => {
    expect(tradeDeleteDue(released(), at(30, -1))).toBe(false);
    expect(tradeDeleteDue(released(), at(30))).toBe(false);
    expect(tradeDeleteDue(released(), at(30, 1))).toBe(true);
  });

  it('a disputed trade is due 90 days after the dispute closed, not at day 89', () => {
    const f = released({ disputed: true, disputeClosedAt: at(10) });
    expect(tradeDeleteDue(f, at(10 + 89))).toBe(false);
    expect(tradeDeleteDue(f, at(10 + 90, 1))).toBe(true);
  });

  it('a trade whose dispute is still open is never due, however old', () => {
    expect(tradeDeleteDue(released({ disputed: true, disputeOpen: true }), at(4000))).toBe(false);
  });

  it('an open trade is never due', () => {
    expect(tradeDeleteDue(released({ closedAt: null }), at(4000))).toBe(false);
  });

  it('not while the moderation watch still runs, even past the date', () => {
    const f = released({ watchEndsAt: at(31) });
    expect(tradeDeleteAt(f)).toEqual(at(30));
    expect(tradeDeleteDue(f, at(30, 1))).toBe(false);
    expect(tradeDeleteDue(f, at(31))).toBe(false);
    expect(tradeDeleteDue(f, at(31, 1))).toBe(true);
  });

  it('an invalid clock is never due', () => {
    expect(tradeDeleteDue(released(), new Date(Number.NaN))).toBe(false);
  });
});

describe('refundDisputeWindowEndsAt', () => {
  it('a refunded trade: the after-refund dispute window from its close; any other state: none', () => {
    expect(refundDisputeWindowEndsAt('refunded', T0)).toEqual(new Date(T0.getTime() + TIMERS.disputeAfterRefundHours * 3_600_000));
    expect(refundDisputeWindowEndsAt('released', T0)).toBeNull();
    expect(refundDisputeWindowEndsAt('refunded', null)).toBeNull();
  });
});

describe('the chat of a trade always goes no later than the trade', () => {
  // purgeChats deletes a trade's chat first; the trade purge must never find a chat it may not delete.
  const cases: RetentionFacts[] = [
    released(),
    released({ disputed: true, disputeClosedAt: at(3) }),
    released({ closedAt: at(5), disputed: true, disputeClosedAt: at(2) }),
    released({ refundDisputeWindowEndsAt: at(2) }),
    released({ watchEndsAt: at(31) }),
  ];
  it.each(cases.map((c, i) => [i, c] as const))('case %i', (_i, f) => {
    for (const d of [29, 30, 31, 32, 60, 92, 93, 95, 96, 200]) {
      const now = at(d, 1);
      if (!tradeDeleteDue(f, now)) continue;
      const chatDue = chatPurgeDue(
        {
          tradeLinked: true,
          tradeClosedAt: f.closedAt,
          disputeOpen: f.disputeOpen,
          disputed: f.disputed,
          disputeClosedAt: f.disputeClosedAt,
          createdAt: at(-1),
          lastMessageAt: null,
        },
        now,
      );
      expect(chatDue, `day ${d}`).toBe(true);
    }
  });
});
