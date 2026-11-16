import { describe, expect, it } from 'vitest';
import { EscrowError, MAX_NETWORK_FEE, checkTxSet, type DescribedTx, type Payout } from '../src/index.js';

const BUYER = 'buyer-address';
const FEE_WALLET = 'fee-address';
const BALANCE = 1_250_000_000_000n;
const NET_FEE = 1_795_200_000n;
const expected: Payout[] = [
  { address: BUYER, amountAtomic: 1_237_500_000_000n },
  { address: FEE_WALLET, amountAtomic: 12_500_000_000n },
];

function goodTx(): DescribedTx {
  return {
    fee: NET_FEE,
    unlockTime: 0n,
    changeAmount: 0n,
    inputSum: BALANCE,
    outputSum: BALANCE - NET_FEE,
    destinations: [
      { address: FEE_WALLET, amountAtomic: 12_500_000_000n },
      { address: BUYER, amountAtomic: 1_237_500_000_000n - NET_FEE },
    ],
  };
}

function refused(txs: DescribedTx[], exp: Payout[] = expected, balance = BALANCE): void {
  let err: unknown;
  try {
    checkTxSet(txs, exp, balance);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(EscrowError);
  expect((err as EscrowError).code).toBe('payout-mismatch');
}

describe('checkTxSet', () => {
  it('accepts the exact sweep, whatever order the outputs come in', () => {
    expect(() => checkTxSet([goodTx()], expected, BALANCE)).not.toThrow();
  });

  it('refuses a set with two transactions', () => {
    refused([goodTx(), goodTx()]);
  });

  it('refuses an empty set', () => {
    refused([]);
  });

  it('refuses a swapped payout address', () => {
    const tx = goodTx();
    tx.destinations[1] = { address: 'attacker', amountAtomic: tx.destinations[1]!.amountAtomic };
    refused([tx]);
  });

  it('refuses a fee output raised by 1 atomic unit', () => {
    const tx = goodTx();
    tx.destinations[0] = { address: FEE_WALLET, amountAtomic: 12_500_000_001n };
    tx.destinations[1] = { address: BUYER, amountAtomic: tx.destinations[1]!.amountAtomic - 1n };
    refused([tx]);
  });

  it('refuses an extra 1-atomic output to an attacker', () => {
    const tx = goodTx();
    tx.destinations.push({ address: 'attacker', amountAtomic: 1n });
    tx.destinations[1] = { address: BUYER, amountAtomic: tx.destinations[1]!.amountAtomic - 1n };
    refused([tx]);
  });

  it('refuses any change output', () => {
    const tx = goodTx();
    tx.changeAmount = 1n;
    refused([tx]);
    tx.changeAmount = undefined;
    refused([tx]);
  });

  it('refuses any unlock time', () => {
    const tx = goodTx();
    tx.unlockTime = 1n;
    refused([tx]);
    tx.unlockTime = 10_000_000n;
    refused([tx]);
    tx.unlockTime = undefined;
    refused([tx]);
  });

  it('refuses a network fee above the cap', () => {
    const fee = MAX_NETWORK_FEE + 1n;
    const tx = goodTx();
    tx.fee = fee;
    tx.outputSum = BALANCE - fee;
    tx.destinations[1] = { address: BUYER, amountAtomic: 1_237_500_000_000n - fee };
    refused([tx]);
  });

  it('accepts a network fee exactly at the cap', () => {
    const fee = MAX_NETWORK_FEE;
    const tx = goodTx();
    tx.fee = fee;
    tx.outputSum = BALANCE - fee;
    tx.destinations[1] = { address: BUYER, amountAtomic: 1_237_500_000_000n - fee };
    expect(() => checkTxSet([tx], expected, BALANCE)).not.toThrow();
  });

  it('refuses a missing or zero fee', () => {
    const tx = goodTx();
    tx.fee = undefined;
    refused([tx]);
    tx.fee = 0n;
    refused([tx]);
  });

  it('refuses when the network fee comes off the X2F fee output', () => {
    const tx = goodTx();
    tx.destinations[0] = { address: FEE_WALLET, amountAtomic: 12_500_000_000n - NET_FEE };
    tx.destinations[1] = { address: BUYER, amountAtomic: 1_237_500_000_000n };
    refused([tx]);
  });

  it('refuses inputs that are not the whole escrow', () => {
    const tx = goodTx();
    tx.inputSum = BALANCE + 1n;
    refused([tx]);
  });

  it('refuses expected payouts that do not sweep the escrow', () => {
    refused([goodTx()], expected, BALANCE + 1n);
  });

  it('refuses a duplicated output address', () => {
    const tx = goodTx();
    tx.destinations.push({ address: BUYER, amountAtomic: 0n });
    refused([tx]);
  });

  it('refuses sums that do not balance', () => {
    const tx = goodTx();
    tx.outputSum = BALANCE;
    refused([tx]);
  });

  it('rejects bad expected payouts before looking at the set', () => {
    expect(() => checkTxSet([goodTx()], [], BALANCE)).toThrow(/bad-payouts/);
    expect(() => checkTxSet([goodTx()], [{ address: BUYER, amountAtomic: 0n }], BALANCE)).toThrow(/bad-payouts/);
    expect(() => checkTxSet([goodTx()], [expected[0]!, expected[0]!], BALANCE)).toThrow(/bad-payouts/);
  });
});

describe('networkFeeShares: what wallet2 subtracts from each subtract-fee-from output', () => {
  it('splits evenly; the odd atomic unit comes off the lowest-indexed bearer', async () => {
    const { networkFeeShares } = await import('../src/index.js');
    expect(networkFeeShares(10n, 2, [0, 1])).toEqual([5n, 5n]);
    expect(networkFeeShares(11n, 2, [0, 1])).toEqual([6n, 5n]);
    expect(networkFeeShares(1n, 2, [0, 1])).toEqual([1n, 0n]);
    expect(networkFeeShares(11n, 1, [0])).toEqual([11n]);
    // three bearers, remainder 2: the first two each take one more
    expect(networkFeeShares(11n, 3, [0, 1, 2])).toEqual([4n, 4n, 3n]);
    // a non-bearer between them takes nothing; order is by output index, not by the list
    expect(networkFeeShares(11n, 3, [0, 2])).toEqual([6n, 0n, 5n]);
    expect(networkFeeShares(11n, 3, [2, 0])).toEqual([6n, 0n, 5n]);
  });
});

describe('checkTxSet: the network fee split between the buyer and the X2F fee output (owner 16 Nov)', () => {
  const NET = 1_795_200_001n; // odd: the buyer's output takes the extra unit
  const BUYER_SHARE = 897_600_001n;
  const FEE_SHARE = 897_600_000n;
  const SELLER = 'seller-address';
  const split: Payout[] = [
    { address: BUYER, amountAtomic: 1_237_400_000_000n, bearsNetworkFee: true },
    { address: FEE_WALLET, amountAtomic: 12_500_000_000n, bearsNetworkFee: true },
    { address: SELLER, amountAtomic: 100_000_000n },
  ];
  function splitTx(buyerOff = BUYER_SHARE, feeOff = FEE_SHARE, sellerOff = 0n): DescribedTx {
    return {
      fee: NET,
      unlockTime: 0n,
      changeAmount: 0n,
      inputSum: BALANCE,
      outputSum: BALANCE - NET,
      destinations: [
        { address: SELLER, amountAtomic: 100_000_000n - sellerOff },
        { address: FEE_WALLET, amountAtomic: 12_500_000_000n - feeOff },
        { address: BUYER, amountAtomic: 1_237_400_000_000n - buyerOff },
      ],
    };
  }

  it('accepts each bearer short by exactly its wallet2 share, the surplus untouched', () => {
    expect(BUYER_SHARE + FEE_SHARE).toBe(NET);
    expect(() => checkTxSet([splitTx()], split, BALANCE)).not.toThrow();
  });

  it('refuses the whole network fee off the buyer when both bear it', () => {
    refused([splitTx(NET, 0n)], split);
  });

  it('refuses the odd unit off the X2F fee output (the fee output short by more than its share)', () => {
    refused([splitTx(FEE_SHARE, BUYER_SHARE)], split);
  });

  it('refuses the whole network fee off the X2F fee output', () => {
    refused([splitTx(0n, NET)], split);
  });

  it('refuses the surplus to the seller paying any part of it', () => {
    refused([splitTx(BUYER_SHARE - 1n, FEE_SHARE, 1n)], split);
  });

  it('an unmarked set keeps the old rule: payout 0 bears the whole fee', () => {
    expect(() => checkTxSet([goodTx()], expected, BALANCE)).not.toThrow();
  });
});

describe('isScalar (review I1: a tx key from a party must be a reduced scalar before monero-ts sees it)', () => {
  it('accepts a reduced non-zero scalar, refuses the rest', async () => {
    const { isScalar } = await import('../src/index.js');
    expect(isScalar('01' + '0'.repeat(62))).toBe(true);
    // l - 1 (little-endian) is the largest scalar; l itself and 0 are not
    expect(isScalar('ecd3f55c1a631258d69cf7a2def9de1400000000000000000000000000000010')).toBe(true);
    expect(isScalar('edd3f55c1a631258d69cf7a2def9de1400000000000000000000000000000010')).toBe(false);
    expect(isScalar('0'.repeat(64))).toBe(false);
    expect(isScalar('1'.repeat(64))).toBe(false);
    expect(isScalar('ff'.repeat(32))).toBe(false);
    expect(isScalar('AB'.repeat(32))).toBe(false);
    expect(isScalar('ab'.repeat(31))).toBe(false);
  });
});

describe('isTxKey (review round 2, R2-I2: a tx paying a subaddress has additional tx keys)', () => {
  it('accepts the main key plus up to one additional key per output (16), every 32-byte chunk a reduced scalar', async () => {
    const { isTxKey } = await import('../src/index.js');
    const k = '01' + '0'.repeat(62);
    const l1 = 'ecd3f55c1a631258d69cf7a2def9de1400000000000000000000000000000010';
    expect(isTxKey(k)).toBe(true);
    expect(isTxKey(k + l1)).toBe(true);
    expect(isTxKey(k + l1 + k)).toBe(true);
    expect(isTxKey(k.repeat(17))).toBe(true);
    expect(isTxKey(k.repeat(18))).toBe(false);
    // any chunk out of range, zero or malformed refuses the whole key
    expect(isTxKey(k + '1'.repeat(64))).toBe(false);
    expect(isTxKey('1'.repeat(64) + k)).toBe(false);
    expect(isTxKey(k + '0'.repeat(64))).toBe(false);
    expect(isTxKey(k + 'ab')).toBe(false);
    expect(isTxKey(k + k.toUpperCase().replace('0', 'A'))).toBe(false);
    expect(isTxKey('')).toBe(false);
  });
});
