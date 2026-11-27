import { describe, expect, test } from 'vitest';
import { feeFor, networkFeeShares } from '@x2f/core';
import { MAX_NETWORK_FEE } from '@x2f/escrow';
import { LIEN_BUYER_KEEPS_ATOMIC, LIEN_RECOVERY_MAX_BPS, escrowPlan, feeWalletNetworkFee, lienRecoveryCap, payoutsFor, sweepMinimums, type AttestedTerms, type RulingKind, type SettleKind } from '../src/index.js';

const BUYER = 'buyer-payout-address';
const SELLER = 'seller-refund-address';
const FEE = 'x2f-fee-wallet';
const PAYROLL = 'x2f-payroll-wallet';
const AMOUNT = 1_250_000_000_000n; // 1.25 XMR
const FEE_AMOUNT = 12_500_000_000n; // 0.0125 XMR
const HALF = FEE_AMOUNT / 2n; // owner 26 Nov: half to the fee wallet, half to the payroll wallet

const KINDS: SettleKind[] = ['release', 'mutual-cancel', 'buyer-cancel', 'auto-refund', 'lapse-refund'];
const REFUNDS: SettleKind[] = ['mutual-cancel', 'buyer-cancel', 'auto-refund', 'lapse-refund'];

function args(kind: SettleKind | RulingKind, poster: 'seller' | 'buyer', balanceAtomic: bigint, amountAtomic = AMOUNT) {
  const plan = escrowPlan({ amountAtomic, poster });
  return {
    kind,
    amountAtomic,
    feeAtomic: plan.feeAtomic,
    poster,
    sellerFundsAtomic: plan.sellerFundsAtomic,
    balanceAtomic,
    buyerPayout: BUYER,
    sellerRefund: SELLER,
    feeWallet: FEE,
    payrollWallet: PAYROLL,
  };
}

const sum = (ps: { amountAtomic: bigint }[]) => ps.reduce((s, p) => s + p.amountAtomic, 0n);

describe('payoutsFor: exact funding', () => {
  test('release, poster buyer: the buyer receives amount − fee', () => {
    expect(payoutsFor(args('release', 'buyer', AMOUNT))).toEqual([
      { address: BUYER, amountAtomic: 1_237_500_000_000n, bearsNetworkFee: true },
      { address: FEE, amountAtomic: HALF, bearsNetworkFee: true },
      { address: PAYROLL, amountAtomic: HALF, bearsNetworkFee: true },
    ]);
  });

  test('release, poster seller: the buyer receives the amount, the fee is separate', () => {
    expect(payoutsFor(args('release', 'seller', 1_262_500_000_000n))).toEqual([
      { address: BUYER, amountAtomic: AMOUNT, bearsNetworkFee: true },
      { address: FEE, amountAtomic: HALF, bearsNetworkFee: true },
      { address: PAYROLL, amountAtomic: HALF, bearsNetworkFee: true },
    ]);
  });

  test('release short by one atomic unit throws underfunded', () => {
    expect(() => payoutsFor(args('release', 'buyer', AMOUNT - 1n))).toThrow(new RangeError('underfunded'));
    expect(() => payoutsFor(args('release', 'seller', 1_262_500_000_000n - 1n))).toThrow(new RangeError('underfunded'));
  });

  test('mutual cancel returns everything to the seller', () => {
    expect(payoutsFor(args('mutual-cancel', 'seller', 1_262_500_000_000n))).toEqual([{ address: SELLER, amountAtomic: 1_262_500_000_000n }]);
    expect(payoutsFor(args('mutual-cancel', 'buyer', AMOUNT))).toEqual([{ address: SELLER, amountAtomic: AMOUNT }]);
  });
});

describe('payoutsFor: a surplus the trade did not grow into goes to the seller (spec 11.1, 2026-10-20)', () => {
  test('release, poster seller, balance 1.2626: surplus is its own output to the seller', () => {
    expect(payoutsFor(args('release', 'seller', 1_262_600_000_000n))).toEqual([
      { address: BUYER, amountAtomic: AMOUNT, bearsNetworkFee: true },
      { address: FEE, amountAtomic: HALF, bearsNetworkFee: true },
      { address: PAYROLL, amountAtomic: HALF, bearsNetworkFee: true },
      { address: SELLER, amountAtomic: 100_000_000n },
    ]);
  });

  test('release, poster buyer, balance 1.2501: surplus is its own output to the seller, not the buyer-poster', () => {
    expect(payoutsFor(args('release', 'buyer', 1_250_100_000_000n))).toEqual([
      { address: BUYER, amountAtomic: 1_237_500_000_000n, bearsNetworkFee: true },
      { address: FEE, amountAtomic: HALF, bearsNetworkFee: true },
      { address: PAYROLL, amountAtomic: HALF, bearsNetworkFee: true },
      { address: SELLER, amountAtomic: 100_000_000n },
    ]);
  });

  test('mutual cancel on either ad: everything to the seller', () => {
    expect(payoutsFor(args('mutual-cancel', 'buyer', 1_250_100_000_000n))).toEqual([{ address: SELLER, amountAtomic: 1_250_100_000_000n }]);
    expect(payoutsFor(args('mutual-cancel', 'seller', 1_262_600_000_000n))).toEqual([{ address: SELLER, amountAtomic: 1_262_600_000_000n }]);
  });

  test('release and mutual cancel: fee exact and outputs sum to the balance, for many balances', () => {
    for (const poster of ['seller', 'buyer'] as const) {
      const { sellerFundsAtomic } = escrowPlan({ amountAtomic: AMOUNT, poster });
      for (const extra of [0n, 1n, 7n, 100_000_000n, 5n * 1_000_000_000_000n]) {
        const balance = sellerFundsAtomic + extra;
        const rel = payoutsFor(args('release', poster, balance));
        expect(sum(rel)).toBe(balance);
        // Owner 26 Nov: the 1% in two halves, the fee wallet's and the payroll wallet's, summing to exactly 1%.
        expect(rel.filter((p) => p.address === FEE || p.address === PAYROLL)).toEqual([
          { address: FEE, amountAtomic: feeFor(AMOUNT) - feeFor(AMOUNT) / 2n, bearsNetworkFee: true },
          { address: PAYROLL, amountAtomic: feeFor(AMOUNT) / 2n, bearsNetworkFee: true },
        ]);
        // Owner 16 Nov: the receivers (buyer and X2F) bear the network fee; a surplus to the seller never does.
        expect(rel.filter((p) => p.bearsNetworkFee).map((p) => p.address)).toEqual([BUYER, FEE, PAYROLL]);
        expect(rel[0]?.address).toBe(BUYER);
        expect(rel.find((p) => p.address === BUYER)?.amountAtomic).toBe(poster === 'seller' ? AMOUNT : AMOUNT - FEE_AMOUNT);
        const mc = payoutsFor(args('mutual-cancel', poster, balance));
        expect(mc).toEqual([{ address: SELLER, amountAtomic: balance }]);
      }
    }
  });
});

describe('payoutsFor: every refund pays only the seller refund address', () => {
  for (const kind of REFUNDS) {
    for (const poster of ['seller', 'buyer'] as const) {
      test(`${kind}, poster ${poster}: one payout of the whole balance, surplus included`, () => {
        const { sellerFundsAtomic } = escrowPlan({ amountAtomic: AMOUNT, poster });
        for (const balance of [1n, sellerFundsAtomic - 1n, sellerFundsAtomic, sellerFundsAtomic + 100_000_000n]) {
          expect(payoutsFor(args(kind, poster, balance))).toEqual([{ address: SELLER, amountAtomic: balance }]);
          // Unmarked: the one output to the seller bears the network fee, as before (owner 16 Nov).
          expect(payoutsFor(args(kind, poster, balance))[0]).not.toHaveProperty('bearsNetworkFee');
        }
      });
    }
  }
});

describe('payoutsFor: no zero outputs', () => {
  test('no payout list contains a zero amount', () => {
    for (const kind of KINDS) {
      for (const poster of ['seller', 'buyer'] as const) {
        for (const amountAtomic of [1n, 99n, 100n, AMOUNT]) {
          const { sellerFundsAtomic } = escrowPlan({ amountAtomic, poster });
          for (const extra of [0n, 1n, 1000n]) {
            const ps = payoutsFor(args(kind, poster, sellerFundsAtomic + extra, amountAtomic));
            expect(ps.length).toBeGreaterThan(0);
            for (const p of ps) expect(p.amountAtomic > 0n).toBe(true);
          }
        }
      }
    }
  });

  test('a tiny trade whose fee floors to zero has no fee output', () => {
    expect(payoutsFor(args('release', 'seller', 99n, 99n))).toEqual([{ address: BUYER, amountAtomic: 99n, bearsNetworkFee: true }]);
  });

  test('owner 26 Nov: an odd fee gives the fee wallet the odd unit; a 1-unit fee has no payroll output', () => {
    // 101 atomic units on a seller's ad: fee 1 (floored), all of it to the fee wallet.
    expect(payoutsFor(args('release', 'seller', 101n, 100n))).toEqual([
      { address: BUYER, amountAtomic: 100n, bearsNetworkFee: true },
      { address: FEE, amountAtomic: 1n, bearsNetworkFee: true },
    ]);
    // 300 on a seller's ad: fee 3, 2 to the fee wallet and 1 to the payroll wallet.
    expect(payoutsFor(args('release', 'seller', 303n, 300n))).toEqual([
      { address: BUYER, amountAtomic: 300n, bearsNetworkFee: true },
      { address: FEE, amountAtomic: 2n, bearsNetworkFee: true },
      { address: PAYROLL, amountAtomic: 1n, bearsNetworkFee: true },
    ]);
  });

  test('an empty escrow has nothing to pay', () => {
    for (const kind of KINDS) expect(() => payoutsFor(args(kind, 'seller', 0n))).toThrow(RangeError);
  });
});

describe('payoutsFor: inconsistent inputs fail closed', () => {
  test('a fee that is not exactly 1% of the amount', () => {
    expect(() => payoutsFor({ ...args('release', 'buyer', AMOUNT), feeAtomic: FEE_AMOUNT + 1n })).toThrow(RangeError);
  });

  test('sellerFunds that do not match the poster', () => {
    expect(() => payoutsFor({ ...args('release', 'buyer', AMOUNT), sellerFundsAtomic: AMOUNT + FEE_AMOUNT })).toThrow(RangeError);
  });

  test('sellerFunds below the trade are refused, even when the balance would cover a release (mutant M3)', () => {
    const err = new RangeError('seller funds do not match the trade');
    // Without the check these would pay a made-up "surplus" to the seller out of the buyer's XMR.
    for (const kind of KINDS) {
      expect(() => payoutsFor({ ...args(kind, 'buyer', AMOUNT), sellerFundsAtomic: AMOUNT - 1n })).toThrow(err);
      expect(() => payoutsFor({ ...args(kind, 'seller', 1_262_500_000_000n), sellerFundsAtomic: AMOUNT })).toThrow(err);
    }
  });

  test('a negative balance', () => {
    expect(() => payoutsFor(args('auto-refund', 'buyer', -1n))).toThrow(RangeError);
  });

  test('an unknown kind', () => {
    expect(() => payoutsFor({ ...args('release', 'buyer', AMOUNT), kind: 'steal' as SettleKind })).toThrow(RangeError);
  });

  test('duplicate addresses', () => {
    expect(() => payoutsFor({ ...args('release', 'buyer', AMOUNT), feeWallet: BUYER })).toThrow(RangeError);
    expect(() => payoutsFor({ ...args('release', 'seller', AMOUNT + FEE_AMOUNT), sellerRefund: BUYER })).toThrow(RangeError);
    expect(() => payoutsFor({ ...args('auto-refund', 'seller', AMOUNT), sellerRefund: FEE })).toThrow(RangeError);
    // Owner 26 Nov: the payroll wallet is never the fee wallet or a trader's address.
    expect(() => payoutsFor({ ...args('release', 'buyer', AMOUNT), payrollWallet: FEE })).toThrow(RangeError);
    expect(() => payoutsFor({ ...args('release', 'buyer', AMOUNT), payrollWallet: BUYER })).toThrow(RangeError);
    expect(() => payoutsFor({ ...args('auto-refund', 'seller', AMOUNT), sellerRefund: PAYROLL })).toThrow(RangeError);
    expect(() => payoutsFor({ ...args('release', 'buyer', AMOUNT), payrollWallet: '' })).toThrow(RangeError);
  });

  test('an empty address', () => {
    expect(() => payoutsFor({ ...args('auto-refund', 'buyer', AMOUNT), sellerRefund: '' })).toThrow(RangeError);
  });
});

// Plan 4 Task 15, owner g63 (7 Nov, over Revision 2026-10-29c): a ruling that completes the trade
// pays the 1% (the poster pays); a full reversal pays none. The moderator builds these sets; each
// trader's app co-signs only its own exactly.
describe('payoutsFor: dispute rulings (moderator-built)', () => {
  test('dispute-buyer is the release: the buyer first, then the exact fee, any surplus to the seller', () => {
    for (const poster of ['seller', 'buyer'] as const) {
      const funds = escrowPlan({ amountAtomic: AMOUNT, poster }).sellerFundsAtomic;
      expect(payoutsFor(args('dispute-buyer', poster, funds + 7n))).toEqual(payoutsFor(args('release', poster, funds + 7n)));
    }
  });

  // Owner g63 (7 Nov): a full reversal (all funds back to the original parties) charges no 1% fee;
  // the site pays the moderator itself. The ruling's refund is the whole escrow to the seller.
  test('dispute-seller is a full reversal: the whole balance to the seller, no fee, whoever posted', () => {
    for (const poster of ['seller', 'buyer'] as const) {
      const funds = escrowPlan({ amountAtomic: AMOUNT, poster }).sellerFundsAtomic;
      expect(payoutsFor(args('dispute-seller', poster, funds))).toEqual([{ address: SELLER, amountAtomic: funds }]);
      expect(payoutsFor(args('dispute-seller', poster, funds + 5n))).toEqual([{ address: SELLER, amountAtomic: funds + 5n }]);
      // The same set a refund pays: nothing ever goes to the fee wallet.
      expect(payoutsFor(args('dispute-seller', poster, funds))).toEqual(payoutsFor(args('mutual-cancel', poster, funds)));
    }
  });

  test('dispute-seller with an empty escrow: refused (nothing to pay)', () => {
    expect(() => payoutsFor(args('dispute-seller', 'seller', 0n))).toThrow(RangeError);
  });
});

describe('sweepMinimums: what a sweep shown only through an import must provably pay (review I1)', () => {
  const terms = (poster: 'seller' | 'buyer', take = AMOUNT): AttestedTerms => ({
    deal: { poster, takeAmountAtomic: take.toString(), currency: 'EUR', centsPerXmr: '15000', maxFiatCents: '100000', methodId: 'ZELLE', instructionsSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
    payWindowMin: 90,
    buyerPayout: BUYER,
    sellerRefund: SELLER,
  });

  test('release: at least the take-time buyer payout (fee off it on a buyer ad) and the take-time fee, to the signed addresses', () => {
    expect(sweepMinimums({ kind: 'release', terms: terms('seller'), feeWallet: FEE, payrollWallet: PAYROLL, sweptAtomic: 5n * AMOUNT })).toEqual([
      { address: BUYER, amountAtomic: AMOUNT, bearsNetworkFee: true },
      { address: FEE, amountAtomic: HALF, bearsNetworkFee: true },
      { address: PAYROLL, amountAtomic: HALF, bearsNetworkFee: true },
    ]);
    expect(sweepMinimums({ kind: 'release', terms: terms('buyer'), feeWallet: FEE, payrollWallet: PAYROLL, sweptAtomic: AMOUNT })).toEqual([
      { address: BUYER, amountAtomic: AMOUNT - FEE_AMOUNT, bearsNetworkFee: true },
      { address: FEE, amountAtomic: HALF, bearsNetworkFee: true },
      { address: PAYROLL, amountAtomic: HALF, bearsNetworkFee: true },
    ]);
  });

  test('a grown release only pays more: an honest one always meets the minimums', () => {
    for (const poster of ['seller', 'buyer'] as const) {
      const min = sweepMinimums({ kind: 'release', terms: terms(poster), feeWallet: FEE, payrollWallet: PAYROLL, sweptAtomic: 0n })!;
      const grown = payoutsFor(args('release', poster, 3n * AMOUNT, 2n * AMOUNT));
      for (const m of min) expect(grown.find((g) => g.address === m.address)!.amountAtomic).toBeGreaterThanOrEqual(m.amountAtomic);
    }
  });

  test('a seller-buyer refund (lapse, mutual cancel): everything the sweep spent, to the seller', () => {
    for (const kind of ['lapse-refund', 'mutual-cancel'] as SettleKind[]) {
      expect(sweepMinimums({ kind, terms: terms('seller'), feeWallet: FEE, payrollWallet: PAYROLL, sweptAtomic: 777n })).toEqual([{ address: SELLER, amountAtomic: 777n }]);
    }
  });

  test('a kind the moderator co-signs is never shown through an import: null', () => {
    for (const kind of ['auto-refund', 'buyer-cancel'] as SettleKind[]) {
      expect(sweepMinimums({ kind, terms: terms('seller'), feeWallet: FEE, payrollWallet: PAYROLL, sweptAtomic: 777n })).toBeNull();
    }
  });

  test('bad input fails closed', () => {
    expect(() => sweepMinimums({ kind: 'release', terms: { ...terms('seller'), buyerPayout: FEE }, feeWallet: FEE, payrollWallet: PAYROLL, sweptAtomic: 1n })).toThrow(RangeError);
    expect(() => sweepMinimums({ kind: 'mutual-cancel', terms: terms('seller'), feeWallet: FEE, payrollWallet: PAYROLL, sweptAtomic: 0n })).toThrow(RangeError);
    expect(() => sweepMinimums({ kind: 'nope' as SettleKind, terms: terms('seller'), feeWallet: FEE, payrollWallet: PAYROLL, sweptAtomic: 1n })).toThrow(RangeError);
  });
});

// Lien recovery (owner 16 Nov 2026, docs/lien-recovery.md): when the buyer owes a lien, the signed
// terms carry the recovery and a completed trade pays it to the creditor out of the buyer's proceeds.
describe('payoutsFor: lien recovery', () => {
  const CREDITOR = 'creditor-payout-address';
  const R = 100_000_000_000n; // 0.1 XMR
  const withRec = (kind: SettleKind | RulingKind, poster: 'seller' | 'buyer', balance: bigint, amountAtomic = R) => ({
    ...args(kind, poster, balance),
    lienRecovery: { address: CREDITOR, amountAtomic },
  });

  test.each(['release', 'dispute-buyer'] as const)('%s: buyer gets proceeds − recovery, fee exact, creditor gets the recovery, surplus to the seller', (kind) => {
    const p = payoutsFor(withRec(kind, 'seller', AMOUNT + FEE_AMOUNT + 7n));
    expect(p).toEqual([
      { address: BUYER, amountAtomic: AMOUNT - R, bearsNetworkFee: true },
      { address: FEE, amountAtomic: HALF, bearsNetworkFee: true },
      { address: PAYROLL, amountAtomic: HALF, bearsNetworkFee: true },
      { address: CREDITOR, amountAtomic: R, bearsNetworkFee: true },
      { address: SELLER, amountAtomic: 7n },
    ]);
    expect(sum(p)).toBe(AMOUNT + FEE_AMOUNT + 7n);
  });

  test('on a buyer ad the proceeds are amount − fee', () => {
    const p = payoutsFor(withRec('release', 'buyer', AMOUNT));
    expect(p[0]).toEqual({ address: BUYER, amountAtomic: AMOUNT - FEE_AMOUNT - R, bearsNetworkFee: true });
    expect(p[3]).toEqual({ address: CREDITOR, amountAtomic: R, bearsNetworkFee: true });
  });

  test.each([...REFUNDS, 'dispute-seller'] as const)('%s pays no recovery (nothing was completed)', (kind) => {
    expect(payoutsFor(withRec(kind, 'seller', AMOUNT + FEE_AMOUNT))).toEqual([{ address: SELLER, amountAtomic: AMOUNT + FEE_AMOUNT }]);
  });

  test('refuses a recovery that is not below the proceeds, not positive, or to a party address', () => {
    expect(() => payoutsFor(withRec('release', 'seller', AMOUNT + FEE_AMOUNT, AMOUNT))).toThrow(RangeError);
    expect(() => payoutsFor(withRec('release', 'seller', AMOUNT + FEE_AMOUNT, 0n))).toThrow(RangeError);
    for (const address of [BUYER, SELLER, FEE, '']) {
      expect(() => payoutsFor({ ...args('release', 'seller', AMOUNT + FEE_AMOUNT), lienRecovery: { address, amountAtomic: R } })).toThrow(RangeError);
    }
  });

  test('sweepMinimums: a release with a recovery in the terms checks the buyer short of it and the creditor', () => {
    const terms: AttestedTerms = {
      deal: { poster: 'seller', takeAmountAtomic: AMOUNT.toString(), currency: 'USD', centsPerXmr: '16250', maxFiatCents: '100000', methodId: 'ZELLE', instructionsSha256: 'a'.repeat(64) },
      payWindowMin: 90,
      buyerPayout: BUYER,
      sellerRefund: SELLER,
      lienRecovery: { address: CREDITOR, amountAtomic: R.toString() },
    };
    expect(sweepMinimums({ kind: 'release', terms, feeWallet: FEE, payrollWallet: PAYROLL, sweptAtomic: AMOUNT + FEE_AMOUNT })).toEqual([
      { address: BUYER, amountAtomic: AMOUNT - R, bearsNetworkFee: true },
      { address: FEE, amountAtomic: HALF, bearsNetworkFee: true },
      { address: PAYROLL, amountAtomic: HALF, bearsNetworkFee: true },
      { address: CREDITOR, amountAtomic: R, bearsNetworkFee: true },
    ]);
  });
});

// Review B1 and B3 (lien recovery, 2026-11-16), with the owner's answer of 26 Nov 2026 (Q1: 100%;
// the buyer's output keeps only MAX_NETWORK_FEE + 1 atomic unit, what the payout needs to work; Q5:
// nothing under 0.01 XMR): limits every co-signer and the gate enforce from the signed terms alone,
// so a recovery no honest API would reserve is never paid.
describe('lien recovery limits (review B1, B3)', () => {
  const CREDITOR = 'creditor-payout-address';
  const rec = (amountAtomic: bigint) => ({ ...args('release', 'seller', AMOUNT + FEE_AMOUNT), lienRecovery: { address: CREDITOR, amountAtomic } });
  const CAP = AMOUNT - MAX_NETWORK_FEE - 1n;

  test('the cap: all of the proceeds but the largest network fee + 1 atomic unit (owner 26 Nov 2026: 100%)', () => {
    expect(LIEN_RECOVERY_MAX_BPS).toBe(10_000);
    expect(LIEN_BUYER_KEEPS_ATOMIC).toBe(MAX_NETWORK_FEE + 1n);
    expect(lienRecoveryCap(AMOUNT)).toBe(CAP);
    expect(lienRecoveryCap(1_000_000_000_001n)).toBe(1_000_000_000_001n - LIEN_BUYER_KEEPS_ATOMIC);
    expect(lienRecoveryCap(150_000_000_000n)).toBe(150_000_000_000n - LIEN_BUYER_KEEPS_ATOMIC);
    expect(lienRecoveryCap(LIEN_BUYER_KEEPS_ATOMIC + 1n)).toBe(1n);
    expect(lienRecoveryCap(LIEN_BUYER_KEEPS_ATOMIC)).toBe(0n);
    expect(lienRecoveryCap(1n)).toBe(0n);
    expect(lienRecoveryCap(0n)).toBe(0n);
  });

  test('at the cap the payout set still works: the buyer\'s output stays first, bears its share of any fee up to MAX_NETWORK_FEE and still receives something, and X2F\'s booked share matches', () => {
    const set = payoutsFor(rec(CAP));
    expect(set[0]).toEqual({ address: BUYER, amountAtomic: LIEN_BUYER_KEEPS_ATOMIC, bearsNetworkFee: true });
    const bearers = set.map((p) => p.bearsNetworkFee === true);
    for (const fee of [1n, 7n, 30_720_001n, MAX_NETWORK_FEE - 1n, MAX_NETWORK_FEE]) {
      const shares = networkFeeShares(fee, bearers);
      set.forEach((p, i) => expect(p.amountAtomic - shares[i]!).toBeGreaterThan(0n));
      expect(feeWalletNetworkFee('release', fee, FEE_AMOUNT, 1)).toBe(shares[1]! + shares[2]!);
    }
  });

  test('B1: payoutsFor refuses a recovery above the cap (the API cannot take more by signing it in)', () => {
    expect(payoutsFor(rec(CAP))[3]).toEqual({ address: CREDITOR, amountAtomic: CAP, bearsNetworkFee: true });
    expect(() => payoutsFor(rec(CAP + 1n))).toThrow(/bad recovery amount/);
    expect(() => payoutsFor(rec(AMOUNT))).toThrow(/bad recovery amount/);
  });

  test('B3: payoutsFor refuses a recovery that leaves the buyer no more than the largest network fee', () => {
    const small = 150_000_000_000n;
    const plan = escrowPlan({ amountAtomic: small, poster: 'seller' });
    const at = (r: bigint) => payoutsFor({ ...args('release', 'seller', plan.sellerFundsAtomic, small), lienRecovery: { address: CREDITOR, amountAtomic: r } });
    expect(at(small - LIEN_BUYER_KEEPS_ATOMIC)[0]).toEqual({ address: BUYER, amountAtomic: LIEN_BUYER_KEEPS_ATOMIC, bearsNetworkFee: true });
    expect(() => at(small - LIEN_BUYER_KEEPS_ATOMIC + 1n)).toThrow(/bad recovery amount/);
    expect(() => at(small - MAX_NETWORK_FEE)).toThrow(/bad recovery amount/);
  });

  test('sweepMinimums refuses the same over-cap recovery', () => {
    const terms: AttestedTerms = {
      deal: { poster: 'seller', takeAmountAtomic: AMOUNT.toString(), currency: 'USD', centsPerXmr: '16250', maxFiatCents: '100000', methodId: 'ZELLE', instructionsSha256: 'a'.repeat(64) },
      payWindowMin: 90,
      buyerPayout: BUYER,
      sellerRefund: SELLER,
      lienRecovery: { address: CREDITOR, amountAtomic: (CAP + 1n).toString() },
    };
    expect(() => sweepMinimums({ kind: 'release', terms, feeWallet: FEE, payrollWallet: PAYROLL, sweptAtomic: AMOUNT + FEE_AMOUNT })).toThrow(RangeError);
  });
});

describe('feeWalletNetworkFee: X2F\'s part of a settlement\'s network fee (owner 16 Nov)', () => {
  test('a completed trade: the fee and payroll outputs\' wallet2 shares, fee − ceil(fee / 3) (the odd unit is the buyer\'s)', () => {
    for (const kind of ['release', 'dispute-buyer'] as const) {
      expect(feeWalletNetworkFee(kind, 30_720_000n, FEE_AMOUNT)).toBe(20_480_000n);
      expect(feeWalletNetworkFee(kind, 30_720_001n, FEE_AMOUNT)).toBe(20_480_000n);
      expect(feeWalletNetworkFee(kind, 30_720_002n, FEE_AMOUNT)).toBe(20_480_001n);
      expect(feeWalletNetworkFee(kind, 1n, FEE_AMOUNT)).toBe(0n);
      // A 1-unit 1% has the fee wallet's output only: two bearers, floor(fee / 2).
      expect(feeWalletNetworkFee(kind, 30_720_001n, 1n)).toBe(15_360_000n);
      expect(feeWalletNetworkFee(kind, 30_720_000n, 0n)).toBe(0n);
    }
  });

  test('matches the payout set: the share of the fee wallet\'s output among the marked bearers, surplus or not', () => {
    for (const poster of ['seller', 'buyer'] as const) {
      const funds = escrowPlan({ amountAtomic: AMOUNT, poster }).sellerFundsAtomic;
      for (const extra of [0n, 5n]) {
        const set = payoutsFor(args('release', poster, funds + extra));
        const bearers = set.map((p) => p.bearsNetworkFee === true);
        for (const fee of [30_720_000n, 30_720_001n, 7n]) {
          const shares = networkFeeShares(fee, bearers);
          const x2f = shares[set.findIndex((p) => p.address === FEE)]! + shares[set.findIndex((p) => p.address === PAYROLL)]!;
          expect(feeWalletNetworkFee('release', fee, FEE_AMOUNT)).toBe(x2f);
        }
      }
    }
  });

  test('a refund or a full reversal pays X2F nothing, so none of the fee', () => {
    for (const kind of [...REFUNDS, 'dispute-seller'] as const) expect(feeWalletNetworkFee(kind, 30_720_000n, FEE_AMOUNT)).toBe(0n);
  });

  test('a negative fee is refused', () => {
    expect(() => feeWalletNetworkFee('release', -1n, FEE_AMOUNT)).toThrow(RangeError);
  });
});
