// The shadow trade runs on the trade's own attested time to pay (terms.payWindowMin, owner p9-6),
// never the machine default: a lying API cannot get a seller's refund co-signed before it is over.
import { MAX_PAY_WINDOW_MIN, TIMERS, type AttestedTerms, type Trade } from '@x2f/trade';
import { describe, expect, it } from 'vitest';
import { applyShadow, newShadow } from '../src/shadow.js';

const CODE = 'K7Q2-M9XA-3PRT-W8DN';
const MIN = 60_000;
const TAKEN = new Date('2026-11-09T10:00:00.000Z');
const TERMS: AttestedTerms = {
  deal: { poster: 'seller', takeAmountAtomic: '250000000000', currency: 'USD', centsPerXmr: '16250', maxFiatCents: '100000', methodId: 'ZELLE', instructionsSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
  payWindowMin: 90,
  buyerPayout: '4'.padEnd(95, 'B'),
  sellerRefund: '8'.padEnd(95, 'S'),
};
const at = (min: number): Date => new Date(TAKEN.getTime() + min * MIN);

/** The shadow fed as the moderation service feeds it: setup-done, the coins seen and then unlocked (secured at minute 10). */
function securedShadow(terms: AttestedTerms): Trade {
  let t = newShadow(CODE, terms, TAKEN);
  const step = (e: Parameters<typeof applyShadow>[1], min: number): void => {
    const r = applyShadow(t, e, 'system', at(min));
    expect(r.refused).toBeNull();
    t = r.trade;
  };
  step({ type: 'setup-done', escrowAddress: '5'.padEnd(95, 'E') }, 1);
  step({ type: 'chain', receivedAtomic: t.sellerFundsAtomic, unlockedAtomic: 0n, confirmations: 1 }, 5);
  step({ type: 'chain', receivedAtomic: t.sellerFundsAtomic, unlockedAtomic: t.sellerFundsAtomic, confirmations: 10 }, 10);
  expect(t.state).toBe('secured');
  return t;
}

/** The seller's refund request on the shadow at `min` minutes after take. */
const requestRefund = (t: Trade, min: number) => applyShadow(t, { type: 'request-refund' }, 'seller', at(min));

describe('newShadow: the time to pay', () => {
  it("is the attested one, never TIMERS.payMin: a 24-hour method's payBy is 24 hours after secured", () => {
    for (const m of [TIMERS.payMin, 180, MAX_PAY_WINDOW_MIN]) {
      const t = securedShadow({ ...TERMS, payWindowMin: m });
      expect(t.payWindowMin).toBe(m);
      expect(t.payBy).toEqual(at(10 + m));
    }
  });

  it("refuses the seller's refund request before the trade's own time to pay is over (24 h method at 91 minutes) and takes it after", () => {
    const t = securedShadow({ ...TERMS, payWindowMin: 24 * 60 });
    expect(requestRefund(t, 10 + 91)).toMatchObject({ refused: 'too-early' });
    expect(requestRefund(t, 10 + 24 * 60 - 1)).toMatchObject({ refused: 'too-early' });
    const after = requestRefund(t, 10 + 24 * 60 + 1);
    expect(after.refused).toBeNull();
    expect(after.trade.state).toBe('settling');
    expect(after.trade.settling).toBe('auto-refund');
  });

  it('a 90-minute method still refunds after 90 minutes', () => {
    const t = securedShadow(TERMS);
    expect(requestRefund(t, 10 + 89)).toMatchObject({ refused: 'too-early' });
    expect(requestRefund(t, 10 + 91)).toMatchObject({ refused: null, trade: { settling: 'auto-refund' } });
  });

  it('builds no shadow from terms without a valid time to pay (an attestation from before the field): never the default', () => {
    const { payWindowMin: _p, ...old } = TERMS;
    expect(() => newShadow(CODE, old as AttestedTerms, TAKEN)).toThrow(RangeError);
    for (const m of [0, MAX_PAY_WINDOW_MIN + 1, 90.5]) {
      expect(() => newShadow(CODE, { ...TERMS, payWindowMin: m }, TAKEN)).toThrow(RangeError);
    }
  });
});

// Owner 27 Nov 2026 (docs/lien-recovery.md "Debtor is the seller"): the shadow's funding plan is the
// signed one, the seller's extra included, so the moderation service never counts an escrow as
// funded (or grown) on amount + fee alone.
describe('newShadow: a seller lien recovery', () => {
  const X = 100_000_000_000n;
  const WITH: AttestedTerms = { ...TERMS, sellerLienRecovery: { address: '4'.padEnd(95, 'K'), amountAtomic: X.toString() } };
  it('the shadow funds amount + fee + the signed extra; amount + fee alone stays funding', () => {
    const plain = newShadow(CODE, TERMS, TAKEN);
    const t = newShadow(CODE, WITH, TAKEN);
    expect(t.sellerLienRecoveryAtomic).toBe(X);
    expect(t.sellerFundsAtomic).toBe(plain.sellerFundsAtomic + X);
    expect(plain).not.toHaveProperty('sellerLienRecoveryAtomic');
    let s = applyShadow(t, { type: 'setup-done', escrowAddress: '5'.padEnd(95, 'E') }, 'system', at(1)).trade;
    s = applyShadow(s, { type: 'chain', receivedAtomic: plain.sellerFundsAtomic, unlockedAtomic: plain.sellerFundsAtomic, confirmations: 10 }, 'system', at(5)).trade;
    expect(s.state).toBe('funding');
    expect(s.amountAtomic).toBe(t.amountAtomic);
    expect(securedShadow(WITH).amountAtomic).toBe(t.amountAtomic);
  });
});
