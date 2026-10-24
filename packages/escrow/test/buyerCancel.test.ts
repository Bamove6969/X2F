import { describe, expect, it } from 'vitest';
import { buyerCancelDecision, type BuyerCancelFacts } from '../src/index.js';

const REFUND = 'seller-refund-address';
const BALANCE = 1_262_600_000_000n;

function facts(over: Partial<BuyerCancelFacts> = {}): BuyerCancelFacts {
  return {
    cancelSignedByBuyer: true,
    recordedRefundAddress: REFUND,
    balance: BALANCE,
    proposed: [{ address: REFUND, amountAtomic: BALANCE }],
    ...over,
  };
}

describe('buyerCancelDecision', () => {
  it('allows one payout of the whole balance to the recorded refund address', () => {
    expect(buyerCancelDecision(facts())).toEqual({ ok: true });
  });

  it('refuses without the buyer\'s own signed cancel', () => {
    expect(buyerCancelDecision(facts({ cancelSignedByBuyer: false }))).toEqual({ ok: false, reason: 'no-buyer-signal' });
    // Only the literal true counts.
    expect(buyerCancelDecision(facts({ cancelSignedByBuyer: 'yes' as never }))).toEqual({ ok: false, reason: 'no-buyer-signal' });
  });

  it('checks the buyer signal before the destination', () => {
    expect(buyerCancelDecision(facts({ cancelSignedByBuyer: false, proposed: [] }))).toEqual({ ok: false, reason: 'no-buyer-signal' });
  });

  it('refuses two outputs, even if both go to the refund address', () => {
    const half = BALANCE / 2n;
    for (const proposed of [
      [{ address: REFUND, amountAtomic: half }, { address: REFUND, amountAtomic: BALANCE - half }],
      [{ address: REFUND, amountAtomic: BALANCE }, { address: 'fee-wallet', amountAtomic: 1n }],
    ]) {
      expect(buyerCancelDecision(facts({ proposed }))).toEqual({ ok: false, reason: 'wrong-destination' });
    }
  });

  it('refuses no outputs', () => {
    expect(buyerCancelDecision(facts({ proposed: [] }))).toEqual({ ok: false, reason: 'wrong-destination' });
  });

  it('refuses another address, including a near miss', () => {
    for (const address of ['buyer-address', `${REFUND} `, REFUND.toUpperCase(), REFUND.slice(1), '']) {
      expect(buyerCancelDecision(facts({ proposed: [{ address, amountAtomic: BALANCE }] }))).toEqual({ ok: false, reason: 'wrong-destination' });
    }
  });

  it('refuses an amount 1 atomic unit off the balance, either way', () => {
    for (const amountAtomic of [BALANCE - 1n, BALANCE + 1n]) {
      expect(buyerCancelDecision(facts({ proposed: [{ address: REFUND, amountAtomic }] }))).toEqual({ ok: false, reason: 'wrong-destination' });
    }
  });

  it('refuses an empty escrow and an empty recorded address', () => {
    expect(buyerCancelDecision(facts({ balance: 0n, proposed: [{ address: REFUND, amountAtomic: 0n }] }))).toEqual({ ok: false, reason: 'wrong-destination' });
    expect(buyerCancelDecision(facts({ recordedRefundAddress: '', proposed: [{ address: '', amountAtomic: BALANCE }] }))).toEqual({ ok: false, reason: 'wrong-destination' });
  });

  it('refuses a non-bigint amount', () => {
    expect(buyerCancelDecision(facts({ proposed: [{ address: REFUND, amountAtomic: Number(BALANCE) as never }] }))).toEqual({ ok: false, reason: 'wrong-destination' });
  });
});
