import { describe, expect, it } from 'vitest';
import {
  CHAT_AFTER_CLOSE_DAYS,
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
const t0 = new Date('2026-10-01T00:00:00Z');
const at = (days: number, ms = 0): Date => new Date(t0.getTime() + days * DAY + ms);
const released: RetentionFacts = { closedAt: t0, disputeOpenedAt: null, disputeClosed: true, refundDisputeWindowEndsAt: null, awaitingAction: false };

describe('the one retention rule (Plan 7 Task 1, R36)', () => {
  it('uses the owner numbers', () => {
    expect(TRADE_KEEP_DAYS).toBe(30);
    expect(DISPUTE_KEEP_DAYS).toBe(90);
  });

  it('a released trade is due at close + 30 days and not 1 ms before', () => {
    expect(tradeDeleteAt(released)).toEqual(at(30));
    expect(tradeDeleteDue(released, at(30, -1))).toBe(false);
    expect(tradeDeleteDue(released, at(30))).toBe(true);
    expect(tradeDeleteDue(released, at(400))).toBe(true);
  });

  it('an open trade is never due, however old', () => {
    const open = { ...released, closedAt: null };
    expect(tradeDeleteAt(open)).toBeNull();
    expect(tradeDeleteDue(open, at(10_000))).toBe(false);
  });

  it('a dispute opened at day 29 moves it to the button + 90 days', () => {
    const d = { ...released, closedAt: at(31), disputeOpenedAt: at(29), disputeClosed: true };
    expect(tradeDeleteAt(d)).toEqual(at(29 + 90));
    expect(tradeDeleteDue(d, at(30))).toBe(false);
    expect(tradeDeleteDue(d, at(118, DAY - 1))).toBe(false);
    expect(tradeDeleteDue(d, at(119))).toBe(true);
  });

  it('a dispute still open at day 90 is not due; once it closes it is', () => {
    const open = { ...released, closedAt: null, disputeOpenedAt: t0, disputeClosed: false };
    expect(tradeDeleteDue(open, at(91))).toBe(false);
    expect(tradeDeleteDue(open, at(5_000))).toBe(false);
    // Ruled and closed at day 95 (the machine sets closedAt then): due at once, 90 days from the button.
    const ruled = { ...released, closedAt: at(95), disputeOpenedAt: t0, disputeClosed: false };
    expect(tradeDeleteDue(ruled, at(96))).toBe(false); // an appeal still pending or possible
    expect(tradeDeleteDue({ ...ruled, disputeClosed: true }, at(95))).toBe(true);
  });

  it('a refunded trade is kept through the buyer\'s dispute-after-refund window (inclusive), never less than 30 days', () => {
    const w = refundDisputeWindowEndsAt('refunded', t0, false);
    expect(w).toEqual(new Date(t0.getTime() + TIMERS.disputeAfterRefundHours * 3_600_000));
    const f = { ...released, refundDisputeWindowEndsAt: w };
    const deleteAt = tradeDeleteAt(f)!;
    expect(deleteAt.getTime()).toBe(Math.max(at(30).getTime(), w!.getTime() + 1));
    expect(tradeDeleteDue(f, w!)).toBe(false);
    expect(tradeDeleteDue(f, at(30, -1))).toBe(false);
    // A short window (Task 38: 48 hours) never shortens the 30 days.
    const short = { ...released, refundDisputeWindowEndsAt: at(2) };
    expect(tradeDeleteAt(short)).toEqual(at(30));
  });

  it('only an undisputed refunded trade has a refund window', () => {
    expect(refundDisputeWindowEndsAt('released', t0, false)).toBeNull();
    expect(refundDisputeWindowEndsAt('cancelled', t0, false)).toBeNull();
    expect(refundDisputeWindowEndsAt('refunded', t0, true)).toBeNull();
    expect(refundDisputeWindowEndsAt('refunded', null, false)).toBeNull();
    expect(TIMERS.disputeAfterRefundHours).toBe(48);
  });

  it('a closed trade still waiting for a party is never due', () => {
    expect(tradeDeleteDue({ ...released, awaitingAction: true }, at(10_000))).toBe(false);
  });

  it('fails closed on any invalid date or a bad clock', () => {
    const bad = new Date('x');
    expect(tradeDeleteDue({ ...released, closedAt: bad }, at(400))).toBe(false);
    expect(tradeDeleteDue({ ...released, disputeOpenedAt: bad }, at(400))).toBe(false);
    expect(tradeDeleteDue({ ...released, refundDisputeWindowEndsAt: bad }, at(400))).toBe(false);
    expect(tradeDeleteDue(released, bad)).toBe(false);
  });

  it('chatPurgeDue\'s trade backstop never fires before the trade\'s own date', () => {
    expect(CHAT_AFTER_CLOSE_DAYS).toBe(DISPUTE_KEEP_DAYS);
    // Disputed at day 0, ruled (closed) at day 2: the chat backstop is closedAt + 90 >= button + 90.
    const facts = { ...released, closedAt: at(2), disputeOpenedAt: t0 };
    const chat = { tradeLinked: true, tradeClosedAt: at(2), disputeOpen: false, createdAt: t0, lastMessageAt: null };
    for (const d of [30, 89, 90, 91, 92]) {
      if (chatPurgeDue(chat, at(d, 1))) expect(tradeDeleteDue(facts, at(d, 1))).toBe(true);
    }
  });
});
