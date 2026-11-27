// Tests for PR #43 (owner 27 Nov 2026, option (a) of docs/lien-recovery.md "Debtor is the seller")
// and PR #37 (100% of what the at-fault trader receives): the extra XMR a selling debtor funds in
// each sale's escrow, in atomic units (piconero), its rounding, a lien smaller than one sale's
// extra, a lien paid across several sales, never collecting more than is owed, and the creditor's
// output on the payout. Pure: the API's reservation (apps/api/src/disputes/recovery.ts pickFor)
// applies these same functions to `owed − recovered − holds that still count`.
import { describe, expect, test } from 'vitest';
import { MAX_NETWORK_FEE } from '@x2f/core';
import {
  ATOMIC_PER_XMR,
  LIEN_BUYER_KEEPS_ATOMIC,
  LIEN_DEFAULT_RATE_BPS,
  LIEN_RECOVERY_MAX_BPS,
  LIEN_RECOVERY_MIN_ATOMIC,
  escrowPlan,
  expectedRecovery,
  expectedSellerRecovery,
  lienRecoveryCap,
  payoutsFor,
  sellerLienRecoveryCap,
} from '../src/index.js';

const BUYER = 'buyer-payout-address';
const SELLER = 'seller-refund-address';
const FEE = 'x2f-fee-wallet';
const PAYROLL = 'x2f-payroll-wallet';
const CREDITOR = 'creditor-address';
const XMR = ATOMIC_PER_XMR;

/** The payout set of a completed sale of `amount` by a debtor who funded `extra` for the creditor. */
function release(amount: bigint, extra: bigint, poster: 'seller' | 'buyer' = 'seller', surplus = 0n) {
  const plan = escrowPlan({ amountAtomic: amount, poster, sellerLienRecoveryAtomic: extra });
  return payoutsFor({
    kind: 'release', amountAtomic: amount, feeAtomic: plan.feeAtomic, poster, sellerFundsAtomic: plan.sellerFundsAtomic,
    balanceAtomic: plan.sellerFundsAtomic + surplus, buyerPayout: BUYER, sellerRefund: SELLER, feeWallet: FEE, payrollWallet: PAYROLL,
    ...(extra > 0n ? { sellerLienRecovery: { address: CREDITOR, amountAtomic: extra } } : {}),
  });
}
const toCreditor = (p: ReturnType<typeof payoutsFor>) => p.filter((o) => o.address === CREDITOR).reduce((s, o) => s + o.amountAtomic, 0n);

/**
 * A debtor owing `owed` sells `sales` one after another, each completed: what each sale funds for
 * the creditor and what the creditor received in all (as the API records the settled release).
 */
function sellAll(owed: bigint, rateBps: number, sales: readonly bigint[]) {
  let recovered = 0n;
  const extras: bigint[] = [];
  for (const amount of sales) {
    const extra = expectedSellerRecovery({ takeAmountAtomic: amount, rateBps, leftAtomic: owed - recovered });
    extras.push(extra);
    recovered += toCreditor(release(amount, extra));
  }
  return { extras, recovered, left: owed - recovered };
}

describe('the extra in atomic units (1 XMR = 10^12 piconero)', () => {
  test('rate × trade amount / 10000, exact in piconero', () => {
    expect(ATOMIC_PER_XMR).toBe(1_000_000_000_000n);
    expect(LIEN_RECOVERY_MIN_ATOMIC).toBe(XMR / 100n);
    const big = 100n * XMR;
    expect(expectedSellerRecovery({ takeAmountAtomic: XMR, rateBps: 10_000, leftAtomic: big })).toBe(1_000_000_000_000n);
    expect(expectedSellerRecovery({ takeAmountAtomic: XMR, rateBps: 2_500, leftAtomic: big })).toBe(250_000_000_000n);
    expect(expectedSellerRecovery({ takeAmountAtomic: XMR, rateBps: 1, leftAtomic: big })).toBe(0n); // 0.0001 XMR: under the minimum
    expect(expectedSellerRecovery({ takeAmountAtomic: 100n * XMR, rateBps: 1, leftAtomic: big })).toBe(10_000_000_000n); // exactly 0.01 XMR
    // The owner's default (100%) and the ceiling are the same.
    expect(LIEN_DEFAULT_RATE_BPS).toBe(10_000);
    expect(LIEN_RECOVERY_MAX_BPS).toBe(10_000);
  });

  test('rounds down (floor) to the piconero, never up', () => {
    // 1.234567890123 XMR at 33.33%: 1_234_567_890_123 × 3333 / 10000 = 411_481_477_777.9959…
    const amount = 1_234_567_890_123n;
    expect(expectedSellerRecovery({ takeAmountAtomic: amount, rateBps: 3_333, leftAtomic: 10n * XMR })).toBe(411_481_477_777n);
    // An amount whose rate share has any fraction is floored for every rate.
    for (const rateBps of [1_234, 3_333, 6_667, 9_999]) {
      const odd = 12_345_678_901_237n;
      const r = expectedSellerRecovery({ takeAmountAtomic: odd, rateBps, leftAtomic: 1_000n * XMR });
      expect(r * 10_000n).toBeLessThanOrEqual(odd * BigInt(rateBps));
      expect((r + 1n) * 10_000n).toBeGreaterThan(odd * BigInt(rateBps));
    }
  });

  test('at the 0.01 XMR line: one piconero under pays nothing, the line itself pays', () => {
    expect(expectedSellerRecovery({ takeAmountAtomic: LIEN_RECOVERY_MIN_ATOMIC - 1n, rateBps: 10_000, leftAtomic: XMR })).toBe(0n);
    expect(expectedSellerRecovery({ takeAmountAtomic: LIEN_RECOVERY_MIN_ATOMIC, rateBps: 10_000, leftAtomic: XMR })).toBe(LIEN_RECOVERY_MIN_ATOMIC);
    // A 50% share that floors to one under the line pays nothing.
    expect(expectedSellerRecovery({ takeAmountAtomic: 2n * LIEN_RECOVERY_MIN_ATOMIC - 1n, rateBps: 5_000, leftAtomic: XMR })).toBe(0n);
    expect(expectedSellerRecovery({ takeAmountAtomic: 2n * LIEN_RECOVERY_MIN_ATOMIC, rateBps: 5_000, leftAtomic: XMR })).toBe(LIEN_RECOVERY_MIN_ATOMIC);
  });

  test('the cap is 100% of the trade amount (nothing kept back, unlike the buyer side)', () => {
    for (const amount of [1n, LIEN_RECOVERY_MIN_ATOMIC, XMR, 1_234_567_890_123n]) expect(sellerLienRecoveryCap(amount)).toBe(amount);
    expect(sellerLienRecoveryCap(-1n)).toBe(0n);
  });

  test('refuses a rate outside 1..10000, a non-integer rate and negative figures', () => {
    for (const rateBps of [0, -1, 10_001, 0.5, 5_000.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => expectedSellerRecovery({ takeAmountAtomic: XMR, rateBps, leftAtomic: XMR })).toThrow(RangeError);
    }
    expect(() => expectedSellerRecovery({ takeAmountAtomic: -1n, rateBps: 10_000, leftAtomic: XMR })).toThrow(RangeError);
    expect(() => expectedSellerRecovery({ takeAmountAtomic: XMR, rateBps: 10_000, leftAtomic: -1n })).toThrow(RangeError);
    expect(expectedSellerRecovery({ takeAmountAtomic: 0n, rateBps: 10_000, leftAtomic: XMR })).toBe(0n);
    expect(expectedSellerRecovery({ takeAmountAtomic: XMR, rateBps: 10_000, leftAtomic: 0n })).toBe(0n);
  });
});

describe('a lien smaller than one sale\'s extra', () => {
  test('the extra is only what is still owed; the seller funds amount + fee + that; the lien is paid off in one sale', () => {
    const owed = 300_000_000_123n; // 0.300000000123 XMR
    const amount = 2n * XMR;
    const extra = expectedSellerRecovery({ takeAmountAtomic: amount, rateBps: 10_000, leftAtomic: owed });
    expect(extra).toBe(owed);
    const plan = escrowPlan({ amountAtomic: amount, poster: 'seller', sellerLienRecoveryAtomic: extra });
    expect(plan.sellerFundsAtomic).toBe(amount + escrowPlan({ amountAtomic: amount, poster: 'seller' }).feeAtomic + owed);
    expect(sellAll(owed, 10_000, [amount])).toEqual({ extras: [owed], recovered: owed, left: 0n });
  });

  test('a lien under 0.01 XMR is never funded (carried forward), whatever the sale', () => {
    const owed = LIEN_RECOVERY_MIN_ATOMIC - 1n;
    for (const amount of [XMR, 10n * XMR]) expect(expectedSellerRecovery({ takeAmountAtomic: amount, rateBps: 10_000, leftAtomic: owed })).toBe(0n);
    expect(sellAll(owed, 10_000, [XMR, XMR, XMR])).toEqual({ extras: [0n, 0n, 0n], recovered: 0n, left: owed });
  });
});

describe('a lien paid across several sales', () => {
  test('2.5 XMR at 50% over 1 XMR sales: 0.5 each until paid, then nothing more', () => {
    const owed = 2n * XMR + XMR / 2n;
    const r = sellAll(owed, 5_000, Array.from({ length: 7 }, () => XMR));
    expect(r.extras).toEqual([XMR / 2n, XMR / 2n, XMR / 2n, XMR / 2n, XMR / 2n, 0n, 0n]);
    expect(r.recovered).toBe(owed);
    expect(r.left).toBe(0n);
  });

  test('uneven sales at 100%: the last sale funds only the remainder', () => {
    const owed = 1_700_000_000_000n;
    const r = sellAll(owed, 10_000, [600_000_000_000n, 900_000_000_000n, 2n * XMR, XMR]);
    expect(r.extras).toEqual([600_000_000_000n, 900_000_000_000n, 200_000_000_000n, 0n]);
    expect(r.recovered).toBe(owed);
  });

  test('a remainder under 0.01 XMR stays owed: no sale funds it, and none over-collects', () => {
    const owed = XMR + LIEN_RECOVERY_MIN_ATOMIC - 1n; // 1.009999999999 XMR
    const r = sellAll(owed, 10_000, [XMR, XMR, XMR]);
    expect(r.extras).toEqual([XMR, 0n, 0n]);
    expect(r.left).toBe(LIEN_RECOVERY_MIN_ATOMIC - 1n);
  });

  test('never collects more than is owed, across many lien sizes, rates and sale sequences', () => {
    const sizes = [1n, LIEN_RECOVERY_MIN_ATOMIC, 123_456_789_012n, XMR, 7n * XMR + 3n];
    const rates = [1, 2_500, 3_333, 5_000, 9_999, 10_000];
    const sequences = [
      [XMR],
      [LIEN_RECOVERY_MIN_ATOMIC, LIEN_RECOVERY_MIN_ATOMIC * 3n, 999_999_999_999n],
      [5n * XMR, 1n, 2n * XMR, 300_000_000_001n],
      Array.from({ length: 30 }, (_, i) => BigInt(i + 1) * 77_777_777_777n),
    ];
    for (const owed of sizes) {
      for (const rate of rates) {
        for (const sales of sequences) {
          const r = sellAll(owed, rate, sales);
          expect(r.recovered).toBeLessThanOrEqual(owed);
          expect(r.left).toBeGreaterThanOrEqual(0n);
          r.extras.forEach((e, i) => {
            expect(e).toBeLessThanOrEqual(sellerLienRecoveryCap(sales[i]!));
            expect(e === 0n || e >= LIEN_RECOVERY_MIN_ATOMIC).toBe(true);
          });
        }
      }
    }
  });
});

describe('the person owed receives the extra', () => {
  test.each(['seller', 'buyer'] as const)('%s ad: one output of exactly the extra to the creditor; the buyer, X2F and the surplus as without the lien', (poster) => {
    const amount = 1_234_567_890_123n;
    const extra = expectedSellerRecovery({ takeAmountAtomic: amount, rateBps: 4_321, leftAtomic: 10n * XMR });
    const withLien = release(amount, extra, poster, 7n);
    const without = release(amount, 0n, poster, 7n);
    expect(withLien.filter((o) => o.address === CREDITOR)).toEqual([{ address: CREDITOR, amountAtomic: extra, bearsNetworkFee: true }]);
    expect(withLien.filter((o) => o.address !== CREDITOR)).toEqual(without);
    // Everything the escrow held is paid out, to the piconero.
    const plan = escrowPlan({ amountAtomic: amount, poster, sellerLienRecoveryAtomic: extra });
    expect(withLien.reduce((s, o) => s + o.amountAtomic, 0n)).toBe(plan.sellerFundsAtomic + 7n);
  });

  test('the creditor output is larger than the largest network-fee share it bears', () => {
    expect(LIEN_RECOVERY_MIN_ATOMIC).toBeGreaterThan(MAX_NETWORK_FEE - 1n);
    expect(toCreditor(release(XMR, LIEN_RECOVERY_MIN_ATOMIC))).toBe(LIEN_RECOVERY_MIN_ATOMIC);
  });

  test.each(['mutual-cancel', 'buyer-cancel', 'auto-refund', 'lapse-refund', 'dispute-seller'] as const)('%s: nothing to the creditor', (kind) => {
    const plan = escrowPlan({ amountAtomic: XMR, poster: 'seller', sellerLienRecoveryAtomic: XMR / 2n });
    const p = payoutsFor({
      kind, amountAtomic: XMR, feeAtomic: plan.feeAtomic, poster: 'seller', sellerFundsAtomic: plan.sellerFundsAtomic, balanceAtomic: plan.sellerFundsAtomic,
      buyerPayout: BUYER, sellerRefund: SELLER, feeWallet: FEE, payrollWallet: PAYROLL, sellerLienRecovery: { address: CREDITOR, amountAtomic: XMR / 2n },
    });
    expect(toCreditor(p)).toBe(0n);
  });
});

// PR #37: the buyer side takes 100% of what the at-fault buyer receives, less only what the payout
// needs (LIEN_BUYER_KEEPS_ATOMIC = MAX_NETWORK_FEE + 1).
describe('PR #37: recovery takes 100% of what the at-fault buyer receives', () => {
  test('the cap is the proceeds less MAX_NETWORK_FEE + 1 piconero', () => {
    expect(LIEN_BUYER_KEEPS_ATOMIC).toBe(MAX_NETWORK_FEE + 1n);
    for (const proceeds of [LIEN_BUYER_KEEPS_ATOMIC + 1n, XMR, 1_234_567_890_123n]) expect(lienRecoveryCap(proceeds)).toBe(proceeds - LIEN_BUYER_KEEPS_ATOMIC);
    expect(lienRecoveryCap(LIEN_BUYER_KEEPS_ATOMIC)).toBe(0n);
    expect(lienRecoveryCap(0n)).toBe(0n);
  });

  test('at 100% a large lien takes all but the kept piconero; a small one takes only what is owed', () => {
    expect(expectedRecovery({ proceedsAtomic: XMR, rateBps: 10_000, leftAtomic: 10n * XMR })).toBe(XMR - LIEN_BUYER_KEEPS_ATOMIC);
    expect(expectedRecovery({ proceedsAtomic: XMR, rateBps: 10_000, leftAtomic: XMR / 3n })).toBe(XMR / 3n);
    // Under 0.01 XMR after the cap: nothing.
    expect(expectedRecovery({ proceedsAtomic: LIEN_BUYER_KEEPS_ATOMIC + LIEN_RECOVERY_MIN_ATOMIC - 1n, rateBps: 10_000, leftAtomic: XMR })).toBe(0n);
    expect(expectedRecovery({ proceedsAtomic: LIEN_BUYER_KEEPS_ATOMIC + LIEN_RECOVERY_MIN_ATOMIC, rateBps: 10_000, leftAtomic: XMR })).toBe(LIEN_RECOVERY_MIN_ATOMIC);
  });

  test('the buyer\'s output keeps exactly LIEN_BUYER_KEEPS_ATOMIC at 100%, and the creditor gets the rest of the proceeds', () => {
    const plan = escrowPlan({ amountAtomic: XMR, poster: 'seller' });
    const rec = expectedRecovery({ proceedsAtomic: XMR, rateBps: 10_000, leftAtomic: 10n * XMR });
    const p = payoutsFor({
      kind: 'release', amountAtomic: XMR, feeAtomic: plan.feeAtomic, poster: 'seller', sellerFundsAtomic: plan.sellerFundsAtomic, balanceAtomic: plan.sellerFundsAtomic,
      buyerPayout: BUYER, sellerRefund: SELLER, feeWallet: FEE, payrollWallet: PAYROLL, lienRecovery: { address: CREDITOR, amountAtomic: rec },
    });
    expect(p[0]).toEqual({ address: BUYER, amountAtomic: LIEN_BUYER_KEEPS_ATOMIC, bearsNetworkFee: true });
    expect(toCreditor(p)).toBe(XMR - LIEN_BUYER_KEEPS_ATOMIC);
    // One piconero more than the cap is refused by the payout builder.
    expect(() =>
      payoutsFor({
        kind: 'release', amountAtomic: XMR, feeAtomic: plan.feeAtomic, poster: 'seller', sellerFundsAtomic: plan.sellerFundsAtomic, balanceAtomic: plan.sellerFundsAtomic,
        buyerPayout: BUYER, sellerRefund: SELLER, feeWallet: FEE, payrollWallet: PAYROLL, lienRecovery: { address: CREDITOR, amountAtomic: rec + 1n },
      }),
    ).toThrow(RangeError);
  });
});
