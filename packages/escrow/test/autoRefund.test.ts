import { describe, expect, it } from 'vitest';
import { FINAL_ALERT_MS, autoRefundDecision, type AutoRefundFacts } from '../src/index.js';

const REFUND = 'seller-refund-address';
const deadline = new Date('2026-10-17T12:00:00.000Z');
const alert = new Date('2026-10-17T12:00:30.000Z');
const after = (d: Date, ms: number): Date => new Date(d.getTime() + ms);

function facts(over: Partial<AutoRefundFacts> = {}): AutoRefundFacts {
  return {
    paymentDeadline: deadline,
    markedPaidAt: null,
    finalAlertAt: alert,
    now: after(alert, FINAL_ALERT_MS + 1),
    recordedRefundAddress: REFUND,
    proposed: [{ address: REFUND, amountAtomic: 1_000_000_000_000n }],
    ...over,
  };
}

describe('autoRefundDecision', () => {
  it('allows the refund once every condition holds', () => {
    expect(autoRefundDecision(facts())).toEqual({ ok: true });
  });

  it('allows exactly 15 minutes after the alert', () => {
    expect(autoRefundDecision(facts({ now: after(alert, FINAL_ALERT_MS) }))).toEqual({ ok: true });
  });

  it('refuses while the payment window is open, including exactly at the deadline', () => {
    expect(autoRefundDecision(facts({ now: deadline }))).toEqual({ ok: false, reason: 'window-open' });
    expect(autoRefundDecision(facts({ now: after(deadline, -1) }))).toEqual({ ok: false, reason: 'window-open' });
  });

  it('refuses when the buyer marked paid, even late', () => {
    expect(autoRefundDecision(facts({ markedPaidAt: after(deadline, 1) }))).toEqual({ ok: false, reason: 'buyer-marked-paid' });
  });

  it('refuses before the final alert has run for 15 minutes', () => {
    expect(autoRefundDecision(facts({ now: after(alert, FINAL_ALERT_MS - 1) }))).toEqual({ ok: false, reason: 'final-alert-pending' });
  });

  it('refuses when no final alert was sent', () => {
    expect(autoRefundDecision(facts({ finalAlertAt: null }))).toEqual({ ok: false, reason: 'final-alert-pending' });
  });

  it('refuses any destination but the recorded refund address', () => {
    const amountAtomic = 1_000_000_000_000n;
    const refuse = { ok: false, reason: 'wrong-destination' };
    expect(autoRefundDecision(facts({ proposed: [{ address: 'attacker', amountAtomic }] }))).toEqual(refuse);
    expect(autoRefundDecision(facts({ proposed: [{ address: `${REFUND} `, amountAtomic }] }))).toEqual(refuse);
    expect(autoRefundDecision(facts({ proposed: [] }))).toEqual(refuse);
    expect(autoRefundDecision(facts({ proposed: [{ address: REFUND, amountAtomic }, { address: 'attacker', amountAtomic: 1n }] }))).toEqual(refuse);
    expect(autoRefundDecision(facts({ proposed: [{ address: REFUND, amountAtomic: 0n }] }))).toEqual(refuse);
    expect(autoRefundDecision(facts({ recordedRefundAddress: '', proposed: [{ address: '', amountAtomic }] }))).toEqual(refuse);
  });

  it('never allows with invalid dates', () => {
    const bad = new Date(Number.NaN);
    expect(autoRefundDecision(facts({ now: bad })).ok).toBe(false);
    expect(autoRefundDecision(facts({ paymentDeadline: bad })).ok).toBe(false);
    expect(autoRefundDecision(facts({ finalAlertAt: bad })).ok).toBe(false);
  });

  it('checks in order: window, marked paid, alert, destination', () => {
    const all = facts({ now: deadline, markedPaidAt: deadline, finalAlertAt: null, proposed: [] });
    expect(autoRefundDecision(all)).toEqual({ ok: false, reason: 'window-open' });
    expect(autoRefundDecision({ ...all, now: after(alert, FINAL_ALERT_MS) })).toEqual({ ok: false, reason: 'buyer-marked-paid' });
    expect(autoRefundDecision({ ...all, now: after(alert, FINAL_ALERT_MS), markedPaidAt: null })).toEqual({ ok: false, reason: 'final-alert-pending' });
  });
});
