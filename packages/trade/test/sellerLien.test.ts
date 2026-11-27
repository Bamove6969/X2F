// Owner 27 Nov 2026, option (a) of docs/lien-recovery.md "Debtor is the seller": "Extra XMR on each
// sale: they keep selling, but each sale's escrow must also hold the lien payment, which goes to the
// person owed until it's paid off." The seller funds amount + fee + sellerRecovery; a completed
// trade pays the extra to the creditor as its own output, every refund returns it to the seller.
import { describe, expect, test } from 'vitest';
import { feeFor } from '@x2f/core';
import {
  LIEN_RECOVERY_MIN_ATOMIC,
  amountForFunds,
  apply,
  attestedSellerRecovery,
  escrowPlan,
  expectedSellerRecovery,
  feeWalletNetworkFee,
  newTrade,
  payoutsFor,
  sellerLienRecoveryCap,
  sweepMinimums,
  type AttestedTerms,
  type RulingKind,
  type SettleKind,
  type Trade,
} from '../src/index.js';

const BUYER = 'buyer-payout-address';
const SELLER = 'seller-refund-address';
const FEE = 'x2f-fee-wallet';
const PAYROLL = 'x2f-payroll-wallet';
const CREDITOR = 'creditor-address';
const BUYER_CREDITOR = 'buyer-creditor-address';
const AMOUNT = 1_250_000_000_000n; // 1.25 XMR
const FEE_AMOUNT = 12_500_000_000n;
const HALF = FEE_AMOUNT / 2n;
const X = 400_000_000_000n; // 0.4 XMR the seller still owes

function facts(kind: SettleKind | RulingKind, poster: 'seller' | 'buyer', balanceAtomic: bigint, extra = X) {
  const plan = escrowPlan({ amountAtomic: AMOUNT, poster, sellerLienRecoveryAtomic: extra });
  return {
    kind, amountAtomic: AMOUNT, feeAtomic: plan.feeAtomic, poster, sellerFundsAtomic: plan.sellerFundsAtomic, balanceAtomic,
    buyerPayout: BUYER, sellerRefund: SELLER, feeWallet: FEE, payrollWallet: PAYROLL,
    sellerLienRecovery: { address: CREDITOR, amountAtomic: extra },
  };
}

describe('escrowPlan with a seller recovery', () => {
  test('the seller funds amount + fee + extra on a seller ad, amount + extra on a buyer ad; the fee is unchanged', () => {
    expect(escrowPlan({ amountAtomic: AMOUNT, poster: 'seller', sellerLienRecoveryAtomic: X })).toEqual({ sellerFundsAtomic: AMOUNT + FEE_AMOUNT + X, feeAtomic: FEE_AMOUNT });
    expect(escrowPlan({ amountAtomic: AMOUNT, poster: 'buyer', sellerLienRecoveryAtomic: X })).toEqual({ sellerFundsAtomic: AMOUNT + X, feeAtomic: FEE_AMOUNT });
    expect(escrowPlan({ amountAtomic: AMOUNT, poster: 'seller', sellerLienRecoveryAtomic: 0n })).toEqual(escrowPlan({ amountAtomic: AMOUNT, poster: 'seller' }));
    expect(() => escrowPlan({ amountAtomic: AMOUNT, poster: 'seller', sellerLienRecoveryAtomic: -1n })).toThrow(RangeError);
  });
});

describe('expectedSellerRecovery: the earnings (the trade amount) at the rate, capped by what is left', () => {
  test('at 100% the extra is the trade amount, capped by what is still owed', () => {
    expect(expectedSellerRecovery({ takeAmountAtomic: AMOUNT, rateBps: 10_000, leftAtomic: 10n * AMOUNT })).toBe(AMOUNT);
    expect(expectedSellerRecovery({ takeAmountAtomic: AMOUNT, rateBps: 10_000, leftAtomic: X })).toBe(X);
    expect(expectedSellerRecovery({ takeAmountAtomic: AMOUNT, rateBps: 5_000, leftAtomic: 10n * AMOUNT })).toBe(AMOUNT / 2n);
  });

  test('nothing under 0.01 XMR (carried forward), and bad input throws', () => {
    expect(expectedSellerRecovery({ takeAmountAtomic: AMOUNT, rateBps: 10_000, leftAtomic: LIEN_RECOVERY_MIN_ATOMIC - 1n })).toBe(0n);
    expect(expectedSellerRecovery({ takeAmountAtomic: AMOUNT, rateBps: 10_000, leftAtomic: LIEN_RECOVERY_MIN_ATOMIC })).toBe(LIEN_RECOVERY_MIN_ATOMIC);
    expect(expectedSellerRecovery({ takeAmountAtomic: LIEN_RECOVERY_MIN_ATOMIC - 1n, rateBps: 10_000, leftAtomic: AMOUNT })).toBe(0n);
    expect(() => expectedSellerRecovery({ takeAmountAtomic: AMOUNT, rateBps: 10_001, leftAtomic: X })).toThrow(RangeError);
    expect(() => expectedSellerRecovery({ takeAmountAtomic: AMOUNT, rateBps: 0, leftAtomic: X })).toThrow(RangeError);
    expect(() => expectedSellerRecovery({ takeAmountAtomic: AMOUNT, rateBps: 10_000, leftAtomic: -1n })).toThrow(RangeError);
    expect(sellerLienRecoveryCap(AMOUNT)).toBe(AMOUNT);
    expect(sellerLienRecoveryCap(0n)).toBe(0n);
  });
});

describe('payoutsFor with a seller recovery', () => {
  test.each(['release', 'dispute-buyer'] as const)('%s: the buyer gets exactly what it would without a lien; the creditor its own output; surplus to the seller', (kind) => {
    const p = payoutsFor(facts(kind, 'seller', AMOUNT + FEE_AMOUNT + X + 5n));
    expect(p).toEqual([
      { address: BUYER, amountAtomic: AMOUNT, bearsNetworkFee: true },
      { address: FEE, amountAtomic: HALF, bearsNetworkFee: true },
      { address: PAYROLL, amountAtomic: HALF, bearsNetworkFee: true },
      { address: CREDITOR, amountAtomic: X },
      { address: SELLER, amountAtomic: 5n },
    ]);
    // A buyer's ad: the buyer gets amount − fee as always.
    expect(payoutsFor(facts(kind, 'buyer', AMOUNT + X))[0]).toEqual({ address: BUYER, amountAtomic: AMOUNT - FEE_AMOUNT, bearsNetworkFee: true });
  });

  test.each(['mutual-cancel', 'buyer-cancel', 'auto-refund', 'lapse-refund', 'dispute-seller'] as const)('%s returns the whole balance, extra included, to the seller', (kind) => {
    expect(payoutsFor(facts(kind, 'seller', AMOUNT + FEE_AMOUNT + X))).toEqual([{ address: SELLER, amountAtomic: AMOUNT + FEE_AMOUNT + X }]);
  });

  test('a release short of the extra is underfunded (the extra is part of what the escrow must hold)', () => {
    expect(() => payoutsFor(facts('release', 'seller', AMOUNT + FEE_AMOUNT + X - 1n))).toThrow(new RangeError('underfunded'));
  });

  test('the seller funds must include the extra (a plan without it is refused)', () => {
    expect(() => payoutsFor({ ...facts('release', 'seller', AMOUNT + FEE_AMOUNT + X), sellerFundsAtomic: AMOUNT + FEE_AMOUNT })).toThrow(new RangeError('seller funds do not match the trade'));
  });

  test('refuses an extra above the amount, under 0.01 XMR, to a trade address or to the buyer recovery address', () => {
    expect(() => payoutsFor(facts('release', 'seller', 3n * AMOUNT, AMOUNT + 1n))).toThrow(RangeError);
    expect(() => payoutsFor(facts('release', 'seller', 3n * AMOUNT, AMOUNT))).not.toThrow();
    expect(() => payoutsFor(facts('release', 'seller', 3n * AMOUNT, LIEN_RECOVERY_MIN_ATOMIC - 1n))).toThrow(RangeError);
    for (const address of [BUYER, SELLER, FEE, PAYROLL, '']) {
      expect(() => payoutsFor({ ...facts('release', 'seller', 3n * AMOUNT), sellerLienRecovery: { address, amountAtomic: X } })).toThrow(RangeError);
    }
    expect(() => payoutsFor({ ...facts('release', 'seller', 3n * AMOUNT), lienRecovery: { address: CREDITOR, amountAtomic: 100_000_000_000n } })).toThrow(RangeError);
  });

  test('both debtors: the buyer recovery comes out of the buyer, the seller extra is its own output', () => {
    const p = payoutsFor({ ...facts('release', 'seller', AMOUNT + FEE_AMOUNT + X), lienRecovery: { address: BUYER_CREDITOR, amountAtomic: 100_000_000_000n } });
    expect(p).toEqual([
      { address: BUYER, amountAtomic: AMOUNT - 100_000_000_000n, bearsNetworkFee: true },
      { address: FEE, amountAtomic: HALF, bearsNetworkFee: true },
      { address: PAYROLL, amountAtomic: HALF, bearsNetworkFee: true },
      { address: BUYER_CREDITOR, amountAtomic: 100_000_000_000n },
      { address: CREDITOR, amountAtomic: X },
    ]);
  });

  test('network fee: the creditor output bears none, so X2F books the same share as without a lien', () => {
    const p = payoutsFor(facts('release', 'seller', AMOUNT + FEE_AMOUNT + X));
    expect(p.find((o) => o.address === CREDITOR)?.bearsNetworkFee).toBeUndefined();
    expect(feeWalletNetworkFee('release', 300_000_000n, FEE_AMOUNT)).toBe(200_000_000n);
  });
});

describe('sweepMinimums with a seller recovery', () => {
  const terms: AttestedTerms = {
    deal: { poster: 'seller', takeAmountAtomic: AMOUNT.toString(), currency: 'USD', centsPerXmr: '16250', maxFiatCents: '100000', methodId: 'ZELLE', instructionsSha256: 'a'.repeat(64) },
    payWindowMin: 90,
    buyerPayout: BUYER,
    sellerRefund: SELLER,
    sellerLienRecovery: { address: CREDITOR, amountAtomic: X.toString() },
  };

  test('a release must pay the buyer in full, the fees and the creditor its extra', () => {
    expect(sweepMinimums({ kind: 'release', terms, feeWallet: FEE, payrollWallet: PAYROLL, sweptAtomic: AMOUNT + FEE_AMOUNT + X })).toEqual([
      { address: BUYER, amountAtomic: AMOUNT, bearsNetworkFee: true },
      { address: FEE, amountAtomic: HALF, bearsNetworkFee: true },
      { address: PAYROLL, amountAtomic: HALF, bearsNetworkFee: true },
      { address: CREDITOR, amountAtomic: X },
    ]);
    expect(attestedSellerRecovery(terms)).toEqual({ address: CREDITOR, amountAtomic: X });
  });

  test('a seller-buyer refund pays everything to the seller', () => {
    expect(sweepMinimums({ kind: 'mutual-cancel', terms, feeWallet: FEE, payrollWallet: PAYROLL, sweptAtomic: AMOUNT + FEE_AMOUNT + X })).toEqual([{ address: SELLER, amountAtomic: AMOUNT + FEE_AMOUNT + X }]);
  });
});

describe('the trade machine with a seller recovery', () => {
  const T0 = new Date('2026-11-27T12:00:00.000Z');
  const at = (min: number) => new Date(T0.getTime() + min * 60_000);
  const TAKE = {
    code: 'ABCD2345EFGH6789', offerId: 'offer-1', sellerId: 'acct-s', buyerId: 'acct-b', methodId: 'revolut', amountAtomic: AMOUNT,
    lockedRate: { currency: 'USD', centsPerXmr: 33000n }, confirmWindowMin: 120, minFiatCents: 10_000n, maxFiatCents: 50_000n,
  };
  const chain = (received: bigint, unlocked: bigint, confirmations: number) => ({ type: 'chain' as const, receivedAtomic: received, unlockedAtomic: unlocked, confirmations });
  const funding = (extra?: bigint): Trade =>
    apply(newTrade({ ...TAKE, poster: 'seller', ...(extra !== undefined ? { sellerLienRecoveryAtomic: extra } : {}) }, T0), { type: 'setup-done', escrowAddress: '4Escrow' }, 'system', at(1));

  test('newTrade keeps the extra and puts it in what the seller funds; a trade without one has no field', () => {
    const t = newTrade({ ...TAKE, poster: 'seller', sellerLienRecoveryAtomic: X }, T0);
    expect(t.sellerLienRecoveryAtomic).toBe(X);
    expect(t.sellerFundsAtomic).toBe(AMOUNT + FEE_AMOUNT + X);
    expect(Object.keys(newTrade({ ...TAKE, poster: 'seller' }, T0))).not.toContain('sellerLienRecoveryAtomic');
    expect(Object.keys(newTrade({ ...TAKE, poster: 'seller', sellerLienRecoveryAtomic: 0n }, T0))).not.toContain('sellerLienRecoveryAtomic');
  });

  test('amount + fee alone is not funded; with the extra it secures', () => {
    const short = apply(funding(X), chain(AMOUNT + FEE_AMOUNT, AMOUNT + FEE_AMOUNT, 10), 'system', at(5));
    expect(short.state).toBe('funding');
    expect(short.amountAtomic).toBe(AMOUNT);
    const full = apply(funding(X), chain(AMOUNT + FEE_AMOUNT + X, AMOUNT + FEE_AMOUNT + X, 10), 'system', at(5));
    expect(full.state).toBe('secured');
    expect(full.amountAtomic).toBe(AMOUNT);
    expect(full.grown).toBeNull();
  });

  test('the funding window lapses an escrow that holds amount + fee but not the extra', () => {
    const short = apply(funding(X), chain(AMOUNT + FEE_AMOUNT, AMOUNT + FEE_AMOUNT, 10), 'system', at(5));
    const lapsed = apply(short, { type: 'tick' }, 'system', at(200));
    expect(lapsed.state).toBe('lapsed');
  });

  test('growth counts only what is above the extra, and keeps the extra', () => {
    const more = 50_000_000_000n;
    const received = AMOUNT + FEE_AMOUNT + X + more;
    const t = apply(funding(X), chain(received, received, 10), 'system', at(5));
    const grown = amountForFunds(received - X, 'seller');
    expect(grown).toBeGreaterThan(AMOUNT);
    expect(t.amountAtomic).toBe(grown);
    expect(t.sellerLienRecoveryAtomic).toBe(X);
    expect(t.sellerFundsAtomic).toBe(grown + feeFor(grown) + X);
    // The extra alone is never growth: amount + fee + extra exactly keeps the trade at its size.
    const exact = apply(funding(X), chain(AMOUNT + FEE_AMOUNT + X, AMOUNT + FEE_AMOUNT + X, 10), 'system', at(5));
    expect(exact.amountAtomic).toBe(AMOUNT);
  });
});
